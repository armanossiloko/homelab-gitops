#!/usr/bin/env python3
"""Power agent for the dashboard's Shut down / Restart buttons.

Runs on the host as the systemd user service homelab-power (installed by the
dashboard's post-up hook), because shutting down needs logind, outside any
container. Listens on POWER_PORT and accepts:

    POST /power/shutdown    POST /power/restart

Only from the dashboard page: the browser must send the X-Modulab-Power header
(which forces a CORS preflight that only dashboard origins pass), and the Host
and Origin headers must name one of the dashboard's allowed hosts. That blocks
other websites, and DNS rebinding, from triggering it. Anyone on the LAN can
still call it directly, like every other service here.

Permission comes from the polkit rule ./homelab bootstrap installs; without it
logind answers "challenge" and the request fails with a hint. Set
POWER_DRY_RUN=1 to log actions instead of running them.
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("POWER_PORT", "10005"))
DASHBOARD_PORT = os.environ.get("DASHBOARD_PORT", "10004")
DRY_RUN = os.environ.get("POWER_DRY_RUN") == "1"
HEADER = "X-Modulab-Power"
# action → (logind Can* method, systemctl verb)
ACTIONS = {"shutdown": ("CanPowerOff", "poweroff"), "restart": ("CanReboot", "reboot")}

# Hostnames the dashboard answers to, from HOMEPAGE_ALLOWED_HOSTS (host:port,...).
HOSTS = {h.rsplit(":", 1)[0] for h in os.environ.get("HOMEPAGE_ALLOWED_HOSTS", "").split(",") if h}
ORIGINS = {f"http://{h}:{DASHBOARD_PORT}" for h in HOSTS}

pending = threading.Lock()  # held once an action is scheduled; later requests get 409


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def logind_allows(method):
    """logind's verdict for this user: yes, challenge (needs polkit rule), no, na."""
    try:
        out = subprocess.run(
            ["busctl", "call", "org.freedesktop.login1", "/org/freedesktop/login1",
             "org.freedesktop.login1.Manager", method],
            capture_output=True, text=True, timeout=10, check=True).stdout
        return out.split('"')[1]  # 's "yes"'
    except (subprocess.SubprocessError, IndexError, OSError) as e:
        log(f"{method} failed: {e}")
        return "error"


def run_later(verb):
    if DRY_RUN:
        log(f"dry run: would run systemctl {verb}")
        pending.release()
        return
    # Respect block inhibitors (e.g. a package upgrade): systemctl refuses then.
    r = subprocess.run(["systemctl", verb], capture_output=True, text=True)
    if r.returncode != 0:
        log(f"systemctl {verb} failed: {r.stderr.strip()}")
        pending.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "modulab-power"

    def log_message(self, fmt, *args):
        log(f"{self.address_string()} {fmt % args}")

    def reply(self, code, body=None):
        origin = self.headers.get("Origin", "")
        self.send_response(code)
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", HEADER)
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
        data = json.dumps(body).encode() if body is not None else b""
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def trusted(self):
        host = self.headers.get("Host", "").rsplit(":", 1)[0]
        return host in HOSTS and self.headers.get("Origin", "") in ORIGINS

    def do_OPTIONS(self):
        self.reply(204 if self.trusted() else 403)

    def do_POST(self):
        action = self.path.removeprefix("/power/")
        if action not in ACTIONS:
            return self.reply(404, {"error": "unknown action"})
        if not self.trusted() or self.headers.get(HEADER) != "1":
            return self.reply(403, {"error": "only the dashboard can do this"})
        method, verb = ACTIONS[action]
        verdict = logind_allows(method)
        if verdict != "yes":
            hint = ("run ./bootstrap.sh on the server once to allow it (installs a polkit rule)"
                    if verdict == "challenge" else f"the system said '{verdict}'")
            return self.reply(503, {"error": f"not allowed to {action}: {hint}"})
        if not pending.acquire(blocking=False):
            return self.reply(409, {"error": "a shutdown or restart is already under way"})
        log(f"{action} requested by {self.address_string()}")
        # Answer first, so the page can show what's happening.
        threading.Timer(2, run_later, [verb]).start()
        self.reply(202, {"ok": True, "action": action})


if __name__ == "__main__":
    if not HOSTS:
        sys.exit("HOMEPAGE_ALLOWED_HOSTS is empty; run ./homelab up dashboard")
    log(f"listening on :{PORT} for {', '.join(sorted(ORIGINS))}" + (" (dry run)" if DRY_RUN else ""))
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
