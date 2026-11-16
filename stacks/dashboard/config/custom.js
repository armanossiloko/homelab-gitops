// Extra scripts for the dashboard. https://gethomepage.dev/configs/custom-css-js/
//
// Draws the page header: the server name and uptime, a clock (local and UTC),
// Restart / Shut down buttons and a row of stat cards (CPU, memory, temperature,
// both drives). Homepage's own info widgets are too cramped, so widgets.yaml
// is empty and the numbers come from Homepage's resources API instead.
//
// The power buttons call the power agent on the host
// (stacks/dashboard/power/server.py, port 10005), after a confirmation.
(() => {
  const NAME = "modulab";
  const AGENT = `${location.protocol}//${location.hostname}:10005/power/`;
  const API = "/api/widgets/resources";
  // Paths as the dashboard container sees them (compose.yml mounts the media SSD).
  const DRIVES = [
    { id: "os", label: "OS drive", target: "/" },
    { id: "media", label: "Media SSD", target: "/mnt/media" },
  ];

  const svg = (paths, cls = "") =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const ICON = {
    power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    restart: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
    cpu:
      '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    memory:
      '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01M6 17v2M10 17v2M14 17v2M18 17v2"/>',
    temp: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/>',
    drive:
      '<path d="M22 12H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/><path d="M6 16h.01M10 16h.01"/>',
  };

  const ACTIONS = {
    restart: {
      label: "Restart",
      hint: "Back by itself in a few minutes",
      title: `Restart ${NAME}?`,
      body: "Every app goes offline for a few minutes and comes back by itself.",
      busyTitle: `${NAME} is restarting`,
      busy: "This page reloads when it's back.",
      tone: "warn",
    },
    shutdown: {
      label: "Shut down",
      hint: "Stays off until the power button is pressed",
      title: `Shut down ${NAME}?`,
      body:
        "Every app (Jellyfin, Immich, FUTO Notes, ...) goes offline, also for anyone using it " +
        "from the internet. It stays off until someone presses the power button on the machine.",
      busyTitle: `${NAME} is shutting down`,
      busy: "Press its power button to turn it back on.",
      tone: "danger",
    },
  };

  // ---------- formatting ----------

  const pct = (n) => `${Math.round(n)}%`;
  const gib = (b) => `${(b / 2 ** 30).toFixed(1)} GiB`;
  const gb = (b) => (b >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : `${Math.round(b / 1e9)} GB`);
  function duration(s) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d} day${d > 1 ? "s" : ""}${h ? `, ${h} h` : ""}`;
    if (h) return `${h} h ${m} min`;
    return `${m} min`;
  }
  // ok / warn / bad, for the bar colour.
  const level = (v, warn, bad) => (v >= bad ? "bad" : v >= warn ? "warn" : "ok");

  // ---------- building the header ----------

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function stat(id, label, icon) {
    const card = el("div", "ml-stat");
    card.dataset.stat = id;
    card.innerHTML =
      `<div class="ml-stat-head">${svg(ICON[icon])}<span>${label}</span></div>` +
      `<div class="ml-stat-value">–</div>` +
      `<div class="ml-stat-sub">&nbsp;</div>` +
      `<div class="ml-bar"><div></div></div>`;
    return card;
  }

  function setStat(id, value, sub, fill, lvl) {
    const card = document.querySelector(`.ml-stat[data-stat="${id}"]`);
    if (!card) return;
    card.querySelector(".ml-stat-value").textContent = value;
    card.querySelector(".ml-stat-sub").textContent = sub;
    const bar = card.querySelector(".ml-bar > div");
    bar.style.width = `${Math.max(0, Math.min(100, fill))}%`;
    card.dataset.level = lvl;
  }

  function buildHeader() {
    const header = el("header", "", "");
    header.id = "ml-header";

    const top = el("div", "ml-top");
    top.innerHTML =
      `<div class="ml-brand">` +
      `<img src="/images/modulab.svg" alt="" width="40" height="40">` +
      `<div><h1>${NAME}</h1><p class="ml-uptime">Home server</p></div>` +
      `</div>` +
      `<div class="ml-right">` +
      `<div class="ml-clock"><div class="ml-time">–</div>` +
      `<div class="ml-date"><span class="ml-day"></span><span class="ml-utc" title="Coordinated Universal Time"></span></div></div>` +
      `<div class="ml-power"></div>` +
      `</div>`;
    header.append(top);

    // Restart (amber) and Shut down (red), each behind a confirmation.
    const power = top.querySelector(".ml-power");
    for (const [action, a] of Object.entries(ACTIONS)) {
      const b = el("button", `ml-power-btn ml-${a.tone}`, svg(ICON[action === "shutdown" ? "power" : "restart"]) + `<span>${a.label}</span>`);
      b.type = "button";
      b.title = `${a.label} ${NAME}: ${a.hint.toLowerCase()}`;
      b.addEventListener("click", () => confirmThen(action));
      power.append(b);
    }

    const stats = el("div", "ml-stats");
    stats.append(
      stat("cpu", "CPU", "cpu"),
      stat("memory", "Memory", "memory"),
      stat("temp", "Temperature", "temp"),
      ...DRIVES.map((d) => stat(d.id, d.label, "drive")),
    );
    header.append(stats);
    return header;
  }

  // ---------- live data ----------

  async function get(query) {
    const res = await fetch(`${API}?${query}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  const hms = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  function tickClock() {
    const header = document.getElementById("ml-header");
    if (!header) return;
    const now = new Date();
    header.querySelector(".ml-time").textContent = now.toLocaleTimeString(undefined, hms);
    header.querySelector(".ml-day").textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    header.querySelector(".ml-utc").textContent = `UTC ${now.toLocaleTimeString(undefined, { ...hms, timeZone: "UTC" })}`;
  }

  async function refreshFast() {
    await Promise.allSettled([
      get("type=cpu").then(({ cpu }) =>
        setStat("cpu", pct(cpu.usage), `Load ${cpu.load.toFixed(2)}`, cpu.usage, level(cpu.usage, 75, 90)),
      ),
      get("type=memory").then(({ memory: m }) => {
        const used = m.total - m.available;
        const p = (used / m.total) * 100;
        setStat("memory", pct(p), `${gib(used)} of ${gib(m.total)}`, p, level(p, 80, 92));
      }),
      get("type=cputemp&units=metric").then(({ cputemp: t }) => {
        const max = t.max ?? t.main;
        // Bar spans 20–100 °C.
        setStat("temp", `${Math.round(t.main)}°C`, `Hottest core ${Math.round(max)}°C`, ((max - 20) / 80) * 100, level(max, 75, 88));
      }),
      get("type=uptime").then(({ uptime }) => {
        const u = document.querySelector("#ml-header .ml-uptime");
        if (u) u.textContent = `Home server · up ${duration(uptime)}`;
      }),
    ]);
  }

  async function refreshDrives() {
    await Promise.allSettled(
      DRIVES.map((d) =>
        get(`type=disk&target=${encodeURIComponent(d.target)}`).then(({ drive }) =>
          setStat(d.id, `${gb(drive.available)} free`, `${pct(drive.use)} of ${gb(drive.size)} used`, drive.use, level(drive.use, 80, 92)),
        ),
      ),
    );
  }

  // ---------- power ----------

  function confirmThen(action) {
    const a = ACTIONS[action];
    const dlg = el("dialog", "ml-dialog");
    dlg.innerHTML =
      `<h2>${a.title}</h2><p>${a.body}</p>` +
      `<div class="ml-dialog-buttons">` +
      `<button type="button" value="cancel">Cancel</button>` +
      `<button type="button" value="ok" class="ml-btn-${a.tone}">${a.label}</button>` +
      `</div>`;
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) return dlg.close(); // backdrop
      const b = e.target.closest("button");
      if (!b) return;
      dlg.close();
      if (b.value === "ok") run(action);
    });
    dlg.showModal();
    dlg.querySelector('button[value="cancel"]').focus();
  }

  function message(title, text, error = false) {
    const dlg = el("dialog", "ml-dialog");
    dlg.innerHTML =
      `<h2${error ? ' class="ml-error"' : ""}>${title}</h2><p></p>` +
      `<div class="ml-dialog-buttons"><button type="button" class="ml-btn-primary">OK</button></div>`;
    dlg.querySelector("p").textContent = text;
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.querySelector("button").addEventListener("click", () => dlg.close());
    dlg.showModal();
  }

  function overlay(title, text) {
    let o = document.getElementById("ml-overlay");
    if (!o) {
      o = el("div", "");
      o.id = "ml-overlay";
      document.body.append(o);
    }
    o.innerHTML = `<div><div class="ml-spinner"></div><h2></h2><p></p></div>`;
    o.querySelector("h2").textContent = title;
    o.querySelector("p").textContent = text;
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
    let res;
    try {
      res = await fetch(AGENT + action, { method: "POST", headers: { "X-Modulab-Power": "1" } });
    } catch {
      return message(
        "Power agent unreachable",
        "Could not reach the power agent on port 10005. On the server, check: systemctl --user status homelab-power",
        true,
      );
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return message(`${a.label} failed`, body.error || `HTTP ${res.status}`, true);
    }
    overlay(a.busyTitle, a.busy);
    if (action === "restart") reloadWhenBack();
  }

  // ---------- mount ----------

  // Homepage renders client side and may re-render its container, so put the
  // header back whenever it goes missing.
  let header;
  function mount() {
    const container = document.querySelector("#inner_wrapper > .container");
    if (!container || container.contains(header)) return;
    header ??= buildHeader();
    container.prepend(header);
    tickClock();
  }

  function start() {
    mount();
    new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
    refreshFast();
    refreshDrives();
    setInterval(tickClock, 1000);
    setInterval(refreshFast, 5000);
    setInterval(refreshDrives, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
