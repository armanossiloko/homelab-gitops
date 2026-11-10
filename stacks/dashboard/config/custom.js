// Extra scripts for the dashboard. https://gethomepage.dev/configs/custom-css-js/
//
// Shut down / Restart buttons (bottom left). They call the power agent on the
// host (stacks/dashboard/power/server.py, port 10005), after a confirmation.
(() => {
  const AGENT = `${location.protocol}//${location.hostname}:10005/power/`;
  const NAME = "modulab";

  const ICONS = {
    shutdown:
      '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    restart:
      '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  };
  const ACTIONS = {
    shutdown: {
      label: "Shut down",
      confirm:
        `Shut down ${NAME}?\n\nEvery app (Jellyfin, Immich, FUTO Notes, ...) goes offline, ` +
        "also for anyone using it from the internet. It stays off until someone presses " +
        "the power button on the machine.",
      busy: `${NAME} is shutting down. Press its power button to turn it back on.`,
    },
    restart: {
      label: "Restart",
      confirm:
        `Restart ${NAME}?\n\nEvery app goes offline for a few minutes and comes back by itself.`,
      busy: `${NAME} is restarting. This page reloads when it's back.`,
    },
  };

  function overlay(text) {
    let el = document.getElementById("modulab-power-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "modulab-power-overlay";
      document.body.append(el);
    }
    el.textContent = text;
  }

  // After a restart: wait for the dashboard to go away, then to come back.
  async function reloadWhenBack() {
    let wentDown = false;
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      let up = false;
      try {
        up = (await fetch("/api/healthcheck", { cache: "no-store" })).ok;
      } catch {}
      if (!up) wentDown = true;
      // Reload once it's back, or if it never seemed to go down after 5 minutes.
      if (up && (wentDown || Date.now() - started > 300000)) return location.reload();
    }
  }

  async function run(action) {
    const a = ACTIONS[action];
    if (!confirm(a.confirm)) return;
    let res;
    try {
      res = await fetch(AGENT + action, { method: "POST", headers: { "X-Modulab-Power": "1" } });
    } catch {
      return alert(`Could not reach the power agent on port 10005.\n\nOn the server, check: systemctl --user status homelab-power`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(`${a.label} failed: ${body.error || `HTTP ${res.status}`}`);
    }
    overlay(a.busy);
    if (action === "restart") reloadWhenBack();
  }

  function addButtons() {
    if (document.getElementById("modulab-power")) return;
    const bar = document.createElement("div");
    bar.id = "modulab-power";
    for (const [action, a] of Object.entries(ACTIONS)) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = `${a.label} ${NAME}`;
      b.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
        `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[action]}</svg>` +
        `<span>${a.label}</span>`;
      b.addEventListener("click", () => run(action));
      bar.append(b);
    }
    document.body.append(bar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButtons);
  else addButtons();
})();
