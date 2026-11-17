<img src="assets/icon.svg" width="64" height="64" alt="">

# modulab

A GitOps homelab on **rootless Podman**: [Portainer](https://www.portainer.io/),
[Immich](https://immich.app/), [Jellyfin](https://jellyfin.org/) and
[n8n](https://n8n.io/), all visible
and controllable from **Podman Desktop**, plus a [dashboard](#dashboard) that
links to every app and shows its health.

This repo is the source of truth. Clone it, run one command, and every stack in
`stacks/` comes up. After that a systemd timer pulls new commits every 5 minutes
and applies only the stacks that changed.

## Quick start

```bash
git clone https://github.com/armanossiloko/homelab-gitops.git
cd homelab-gitops
./bootstrap.sh
```

Bootstrap is idempotent (safe to re-run). It:

1. Installs Podman if missing (apt/dnf, asks for sudo) and `docker-compose` into
   `~/.local/bin` if no compose tool is present.
2. Enables the rootless Podman API socket (used by Portainer, Podman Desktop and
   compose), `podman-restart.service` and user lingering, so containers come back
   at boot without anyone logging in.
3. If the ufw firewall is active, allows the homelab port range (`10000-10099`)
   from your local subnet only. Otherwise other devices on the network can't
   reach anything.
4. Installs a polkit rule that lets your user shut down and restart the machine
   without a password prompt, for the dashboard's power buttons (sudo; see
   [Shut down and Restart](#shut-down-and-restart)).
5. Renders each stack's `.env` from `.env.example` (paths, timezone, random secrets).
6. Deploys every stack and enables the `homelab-sync` timer.

Shared settings live in [`homelab.conf`](homelab.conf). To override them on
one machine, pass them to bootstrap. They are saved to the gitignored
`.homelab.env`:

```bash
HOMELAB_MEDIA=/srv/media HOMELAB_SYNC_INTERVAL=10min ./bootstrap.sh
```

## Media storage

Media lives on the dedicated 512 GB SSD (`/dev/nvme1n1p1`, label `media`,
mounted at `/mnt/media` and bind-mounted at `/modulab`), not on the OS drive.
`HOMELAB_MEDIA=/modulab/media`:

| Folder on the host              | Inside the container | Used by                    |
| ------------------------------- | -------------------- | -------------------------- |
| `/modulab/media/movies`         | `/media/movies`      | Jellyfin library *Movies*  |
| `/modulab/media/shows`          | `/media/shows`       | Jellyfin library *Shows*   |
| `/modulab/media/cartoons`       | `/media/cartoons`    | Jellyfin library *Cartoons* |
| `/modulab/media/wrestling`      | `/media/wrestling`   | Jellyfin library *Wrestling* |
| `/modulab/media/images`         | `/data`              | Immich (all photos & videos) |

* **Jellyfin:** copy files into the folders and Jellyfin picks them up (or use
  Dashboard → Libraries → Scan). Naming that matches well: `movies/Title (Year)/Title (Year).mkv`
  and `shows/Show Name/Season 01/Show Name S01E01.mkv`. Cartoons is a TV-show
  library, so use the same layout as `shows`. Wrestling is a movies library (TMDb
  lists each event as a movie): `wrestling/WrestleMania XX (2004) [imdbid-tt0403687]/WrestleMania XX (2004).mp4`,
  where the IMDb ID pins the match. Jellyfin mounts media read-only.
* **Immich:** upload from the web UI or the Immich phone app (server URL
  `http://<host>:10002`). Immich manages the `images` folder itself: it holds
  originals (`upload/` or `library/`), thumbnails, transcodes and nightly DB
  dumps (`backups/`). Don't copy files into it by hand. To import an existing
  photo folder, add it as an
  [external library](https://docs.immich.app/features/libraries).
* App state (Immich's Postgres database, Jellyfin's config and metadata) stays
  in `HOMELAB_DATA` (`~/homelab-data`).

## Services

| Port      | Service   | URL                        | Login                                                   |
| --------- | --------- | -------------------------- | ------------------------------------------------------- |
| **10000** | Portainer | https://&lt;host&gt;:10000    | `admin` / `./homelab secret portainer` (random per machine) |
| **10001** | Jellyfin  | http://&lt;host&gt;:10001     | `modulab` / `modulab`                                   |
| **10002** | Immich    | http://&lt;host&gt;:10002     | `modulab@modulab` / `modulab` (Immich logs in by email) |
| **10003** | FUTO Notes | http://&lt;host&gt;:10003    | sync password from `./homelab secret futo-notes` (random per machine) |
| **10004** | Dashboard | http://&lt;host&gt;:10004     | none (LAN only)                                         |
| 10005     | Power agent | (no page)                | used by the dashboard's Shut down / Restart buttons     |
| **10006** | n8n       | http://&lt;host&gt;:10006     | `modulab@modulab.lan` / `Modulab1` (see [n8n](#n8n)) |
| 631       | Printing  | http://&lt;host&gt;:631/printers/ | none; see [Printing](#printing)                  |

**From the internet:** Immich (**https://immich.ossiloko.win**) and
FUTO Notes (**https://futo-notes.ossiloko.win**) are also published
through a Cloudflare Tunnel (see [Cloudflare Tunnel](#cloudflare-tunnel)).
Jellyfin, n8n, Portainer and the dashboard are LAN-only.

**FUTO Notes** is a sync server for the end-to-end encrypted
[FUTO Notes](https://notes.futo.org) apps; the server only stores encrypted
data. In the app, open *Settings → Self-hosted sync*, then enter
`https://futo-notes.ossiloko.win` and the sync password. It's random
rather than `modulab` because the server is on the internet.

**Port scheme:** every web UI gets the next free port from **10000** upwards,
mapped onto the app's own internal port (e.g. `10001:8096`). When you add a
stack, give it the next number (10007, ...), add a row here and a tile to
the [dashboard](#dashboard). Only the
host side changes, so app docs that mention the internal port still apply
inside the container. Jellyfin's LAN auto-discovery (7359/udp) is not
published; enter the server address in the apps manually.

Accounts are created automatically on first start by each stack's `post-up`
hook, so there are no setup wizards. Jellyfin also gets the *Movies*, *Shows*,
*Cartoons* and *Wrestling* libraries (see [Media storage](#media-storage)). Add accounts
for family members in each app: Jellyfin → Dashboard → Users, Immich →
Administration → Users. Change the defaults in
`stacks/<stack>/.env.example` (for new machines) or `stacks/<stack>/.env` (for
this one) **before** the first start. After that, change passwords in each
app's UI. Portainer enforces a 12-character minimum, which is why it keeps a
generated password.

> These defaults are meant for a trusted home LAN. Change them before exposing
> anything to the internet.

## Dashboard

**http://&lt;host&gt;:10004** is the start page: one tile per app (click it to
open the app) with its health, plus the host's CPU, memory, temperature and
free space on the OS drive and media SSD. It's [Homepage](https://gethomepage.dev/).

Each tile shows:

* a **status dot** for the container, read from the Podman socket: green when
  running (and healthy, if the image has a healthcheck), red when stopped or
  unhealthy. Click the dot to see the container's CPU, RAM and network.
* an **HTTP check** with response time: Jellyfin `/health`, Immich
  `/api/server/ping`, FUTO Notes `/health`, n8n `/healthz/readiness` and
  Portainer `/api/system/status`.
  The *Cloudflare Tunnel* tile loads `https://immich.<domain>` from the
  internet side, so it fails if the tunnel or DNS is broken even while the
  container is running.
* Immich's database, machine learning and cache containers, and n8n's task
  runners, get status-only tiles under *Behind the scenes*.

Tiles are in [`stacks/dashboard/config/`](stacks/dashboard/config/)
(`services.yaml`, `settings.yaml`). The header above them (uptime, local and UTC
clock, power buttons, and CPU / memory / temperature / drive cards) is drawn by
`custom.js` and `custom.css` from Homepage's resources API, in place of
Homepage's own info widgets (`widgets.yaml` is left empty). The folder is mounted
read-only and Homepage reloads it on change, so edits apply on the next sync
without a restart. Links use this machine's LAN address, which the dashboard's
`pre-up` hook detects on each deploy. If the address changes, run
`./homelab up dashboard`. To pin an address or use a hostname, set
`HOMELAB_HOST` in `.homelab.env`. Homepage only answers requests for that
address, the hostname (and `<hostname>.local`) and localhost, which guards
against DNS rebinding.

### Shut down and Restart

The **Restart** (amber) and **Shut down** (red) buttons at the top right of the
dashboard reboot or power off the whole machine after a confirmation. After a restart every stack comes back by
itself and the page reloads once the dashboard is up again. After a shutdown,
someone has to press the power button.

Homepage has no buttons that run commands, so these are added by
[`config/custom.js`](stacks/dashboard/config/custom.js) and call a small
power agent, [`power/server.py`](stacks/dashboard/power/server.py). It runs
on the host as the systemd user service `homelab-power` on port 10005, because
shutting down goes through logind, outside any container. The dashboard's
`post-up` hook installs it and restarts it on every deploy.

* **Permission:** logind normally asks for a password before a background
  service may power off. `bootstrap` installs a polkit rule,
  `/etc/polkit-1/rules.d/50-homelab-power.rules` (sudo), that allows it for
  your user only. Without it the buttons show an error telling you to run
  `./bootstrap.sh`.
* **Who can use it:** anyone who can open the dashboard, that is, anyone on
  your LAN (the agent has no password, like the dashboard). Other websites
  can't trigger it: the agent only accepts requests whose `Host` and `Origin`
  are the dashboard's addresses, with a header that forces a browser
  preflight. Shutdowns respect block inhibitors (e.g. a running package
  upgrade).
* Logs: `journalctl --user -u homelab-power`. To try it without powering
  anything off, run the agent by hand with `POWER_DRY_RUN=1` and a spare
  `POWER_PORT`.

**Podman Desktop:** everything runs on the default rootless Podman engine, so it
shows up under *Containers*, grouped by compose project. Podman Desktop can also
see a Docker daemon if one is running, but none of these stacks use it.

**Portainer:** open the `local` environment. It manages the same Podman engine.
Portainer lists these stacks as created outside Portainer, which is expected:
git, not the Portainer editor, is the place to change them.

## n8n

**http://&lt;host&gt;:10006** is [n8n](https://docs.n8n.io/), for automations:
workflows that run on a schedule, on a webhook or by hand and connect apps and
APIs. Log in with `modulab@modulab.lan` / `Modulab1`. The `post-up` hook creates
this owner account on first start, because until an owner exists anyone who
opens n8n could claim it. n8n requires an email with a dot in the domain and a
password with an uppercase letter and a number, so the default differs from the
other apps. Change it under *Settings → Personal*.

* **LAN only:** not published through the Cloudflare tunnel. Webhooks are
  reachable only from the LAN, at `http://<host>:10006/webhook/<path>`. The
  `pre-up` hook sets n8n's `WEBHOOK_URL` to this machine's LAN address on each
  deploy, so the URLs shown in the editor work from other devices. If the
  address changes, run `./homelab up n8n`. Services that call webhooks from the
  internet (GitHub, Stripe, Telegram bots...) can't reach it, and OAuth sign-in
  for providers that insist on https redirect URLs (e.g. Google) won't work;
  use API keys or app passwords for those credentials instead.
* **Code nodes** run in a second container, `n8n-runners`, with JavaScript and
  Python. Python has no imports by default (the sandbox rejects them).
* **Images** come from GHCR (`ghcr.io/n8n-io/...`), the same builds as Docker
  Hub without its anonymous pull limit. `n8n` and `n8n-runners` must be the same
  version; `./homelab update n8n` pulls both.
* **Data:** `~/homelab-data/n8n` holds the SQLite database and `config`, the
  encryption key for saved credentials. Keep the two together: without the key
  the credentials can't be decrypted. The files are owned by your user
  (`userns_mode: keep-id`).

## Printing

Any device on the LAN can print through this machine: pick it in the normal
print dialog (Ctrl+P in a PDF viewer, Word, a browser, or Share → Print on a
phone). The dialog shows the printer's own options, such as two-sided, colour
or black and white, paper size, copies and page range. Nothing needs to be
installed on the device. Windows, macOS, iOS, Android and Linux all find the
printers by themselves, because they are announced on the network as
driverless printers (IPP Everywhere, AirPrint and Mopria).

| Printer | Shows up as | What it does |
| ------- | ----------- | ------------ |
| `PDF` | **Save as PDF @ modulab-800-01** | Saves the job as a PDF in `~/PDF` on this machine. Handy for checking that printing from a device works. |
| USB printers | **&lt;make and model&gt; @ modulab-800-01** | Set up automatically when plugged in. The first one becomes the default. |

**Plugging in a printer:** a udev rule starts `homelab-printers.service`,
which runs [`printing/homelab-printers`](printing/homelab-printers) as root. It
adds a permanent, shared CUPS queue for every USB printer:

* **IPP-over-USB printers** (most printers made since about 2015) get a
  driverless queue through `ipp-usb`. The printer itself reports its options.
* **Older printers** get the best matching installed driver (HP, Brother,
  Samsung, Gutenprint and others ship with Ubuntu). If none matches, the
  journal says so; add the driver, then run `./homelab printing` again.

Queues stay when the printer is unplugged. Jobs wait until it's back. Check
what happened with `journalctl -u homelab-printers`, or try it with
`sudo homelab-printers --dry-run`.

**If a device doesn't list the printer:** add it by address,
`http://<host>:631/printers/<queue>` (on Windows: *Add a printer → The
printer that I want isn't listed → Select a shared printer by name*). Queue
names are listed by `./homelab printing` and on `http://<host>:631/printers/`.

**Setup:** `bootstrap` calls `./homelab printing`, which you can re-run any
time (idempotent, asks for sudo). It runs CUPS on the host, not in a
container, because printers need USB access and system settings that rootless
Podman can't reach. It:

1. Installs CUPS, `ipp-usb` and `cups-pdf` if missing.
2. Turns on printer sharing (`cupsctl --share-printers`). CUPS then listens on
   port 631 and accepts jobs from local subnets only. Changing settings stays
   local to this machine.
3. If ufw is active, allows tcp 631 from the LAN subnet. Discovery uses mDNS,
   which Ubuntu's ufw already allows.
4. Points `cups-pdf` at `~/PDF` (`/etc/cups/cups-pdf.conf`, block marked
   `modulab`). Jobs from devices come from users this machine doesn't know,
   so they're saved as your user.
5. Installs `/usr/local/sbin/homelab-printers`, its service and the udev rule
   `/etc/udev/rules.d/70-homelab-printers.rules`.

GitOps sync doesn't touch the host, so after `printing/homelab-printers`
changes in git, run `./homelab printing` to install the new version. The
printers are reachable on the LAN only, not through the Cloudflare tunnel.

## How GitOps works here

```
git push ──► GitHub ──► homelab-sync.timer (every 5 min) ──► ./homelab sync
                                                             ├─ git fetch + fast-forward
                                                             ├─ diff old..new under stacks/
                                                             ├─ changed stack  → pull + up -d
                                                             └─ deleted stack  → down (data kept)
```

* **Add a service:** create `stacks/<name>/compose.yml` (and `.env.example` if it
  needs settings), then commit and push. It deploys on the next sync.
* **Change a service:** edit its files, then push. Only that stack is redeployed.
* **Remove a service:** delete its folder, then push. Its containers are removed.
  Volumes and data under `HOMELAB_DATA` are kept.
* Sync only **fast-forwards**. If the local checkout has diverged or has
  uncommitted changes to tracked files, it stops with an error and leaves
  everything running as-is.

Logs: `journalctl --user -u homelab-sync -f`

### Placeholders in `.env.example`

`.env` files are generated per machine and never committed. When a key from
`.env.example` is missing from `.env`, it gets added. Existing values are never
overwritten, so secrets and local edits survive syncs.

| Placeholder  | Becomes                                              |
| ------------ | ---------------------------------------------------- |
| `{{DATA}}`   | `$HOMELAB_DATA/<stack>` (default `~/homelab-data/<stack>`) |
| `{{MEDIA}}`  | `$HOMELAB_MEDIA` (shared media root, `/modulab/media`) |
| `{{HOME}}`   | your home directory                                  |
| `{{TZ}}`     | the host timezone                                    |
| `{{UID}}` `{{GID}}` | your user/group id                            |
| `{{RANDOM}}` | a new 32-character alphanumeric secret               |

Values that use `{{DATA}}`, `{{MEDIA}}` or `{{HOME}}` are treated as directories and created
automatically.

### Hooks

If `stacks/<stack>/post-up` exists and is executable, it runs after every
`up`/sync of that stack, from the stack directory, with the stack's `.env`
exported. Hooks must be idempotent. The bundled ones create the admin accounts
and register Portainer's `local` environment, and do nothing once that's done.

### Podman 4.9 note

With Podman 4.9 (Ubuntu 24.04 / Mint 22), compose recreates every container in
a stack on each `up`, because Podman's API reports network IDs differently.
This is harmless for data, and `sync` only touches stacks whose files changed,
but expect a short restart of the whole stack when you change any part of it.
Podman 5 fixes this.

## Day-to-day commands

```bash
./homelab status              # containers, autosync state, deployed revision
./homelab update immich       # pull newer images and recreate
./homelab logs jellyfin       # follow logs
./homelab down immich         # stop a stack (data kept)
./homelab compose immich ps   # any compose command, aimed at Podman
./homelab sync                # sync now instead of waiting for the timer
./homelab autosync off        # pause GitOps on this machine
./homelab printing            # set up network printing (sudo) and list printers
```

`./homelab` always points compose at the rootless Podman socket
(`$XDG_RUNTIME_DIR/podman/podman.sock`), even if `DOCKER_HOST` or a Docker
daemon is around.

## Layout

```
bootstrap.sh            one-shot setup + deploy (calls ./homelab bootstrap)
homelab                 CLI: up/down/update/sync/status/...
homelab.conf            shared settings: data dir, media root, ports, public URLs
stacks/
  portainer/            Portainer CE (admin password from .env secret)
  immich/               Immich server, ML, Valkey, Postgres (+ upstream hwaccel files)
  jellyfin/             Jellyfin with Intel iGPU passthrough
  futo-notes/           FUTO Notes sync server (encrypted blobs + SQLite)
  n8n/                  n8n workflow automation + its Code-node task runners
  dashboard/            Homepage start page; config/ holds the tiles and widgets,
                        power/ the agent behind the Shut down / Restart buttons
  cloudflared/          Cloudflare Tunnel; config.template.yml maps public hostnames
printing/
  homelab-printers      sets up and shares USB printers (installed to /usr/local/sbin)
.homelab.env            machine-local settings (gitignored)
stacks/*/.env           machine-local values and secrets (gitignored)
```

## Cloudflare Tunnel

`stacks/cloudflared` runs a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
named `homelab-modulab-800-01` (account *NebuloraCRM*). The tunnel connects
out to Cloudflare, so no router ports are opened, and Cloudflare provides
HTTPS. The domain is one setting, `HOMELAB_DOMAIN` in `homelab.conf`
(currently `ossiloko.win`).

| Public hostname                    | Goes to                  |
| ---------------------------------- | ------------------------ |
| `immich.ossiloko.win`              | Immich (`localhost:10002`) |
| `futo-notes.ossiloko.win`          | FUTO Notes (`localhost:10003`) |
| `immich.fakegamedevelopers.com`, `notes.fakegamedevelopers.com` | previous domain, kept during the move |

* **Routing is in git:** [`stacks/cloudflared/config.template.yml`](stacks/cloudflared/config.template.yml)
  (a locally managed tunnel). Before each deploy, the `pre-up` hook renders it
  to `config.yml` (gitignored) with `{{DOMAIN}}` replaced, and the tunnel is
  recreated whenever the result changes.
* **Publishing another service:** add an ingress rule to the template, add a
  proxied DNS `CNAME <name> → 6906d45f-8bd1-4cd0-aeea-0627e0013cb1.cfargotunnel.com`
  in Cloudflare, then push. Think twice before publishing admin tools like
  Portainer.
* **Only secret:** `TUNNEL_TOKEN` in `stacks/cloudflared/.env` (gitignored). On a
  new machine the stack refuses to start until it is set. Fetch the token with
  an API token that has *Account → Cloudflare Tunnel: Read*:

  ```bash
  curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
    https://api.cloudflare.com/client/v4/accounts/<account-id>/cfd_tunnel/6906d45f-8bd1-4cd0-aeea-0627e0013cb1/token \
    | python3 -c 'import sys,json; print("TUNNEL_TOKEN=" + json.load(sys.stdin)["result"])' >> stacks/cloudflared/.env
  ./homelab up cloudflared
  ```

  Only run one machine with the same token at a time, unless you deliberately
  want Cloudflare to load-balance between them.
* **Immich's external domain** (used in share links) is set from
  `IMMICH_PUBLIC_URL` in `homelab.conf`.

**Changing the domain:**
1. Add the new domain to the same Cloudflare account and wait until it's
   *Active*. A brand-new registration can take a few hours before the TLD
   publishes it and Cloudflare issues its HTTPS certificate.
2. Create the proxied CNAMEs (`immich`, `futo-notes`, ...) in the new zone
   **before** anything looks the names up. Otherwise resolvers cache "not
   found" for up to 30 minutes.
3. Set `HOMELAB_DOMAIN` in `homelab.conf` and push. Any change to
   `homelab.conf` makes sync re-apply every stack. To keep the old names
   working during the move, add rules for them to the template.
4. In Immich, set *Administration → Settings → Server → External Domain*.
5. Repoint the Immich and FUTO Notes apps on every device.

**Uploading through the tunnel:** Cloudflare's free plan rejects uploads over
**100 MB**, so long phone videos fail over the public URL. In the Immich phone
app, open *Settings → Networking → Automatic URL switching*, add your home
Wi-Fi with the local URL `http://192.168.0.50:10002`, and keep
`https://immich.ossiloko.win` as the external URL. Phones then back
up over the LAN at home and use the tunnel only when away.

**Security:** Immich's login page is now reachable by anyone. Give every
account a strong password (the `modulab` defaults are for the LAN only), and
don't enable public sign-up. For more protection, put a
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/)
policy in front of the hostname. The Immich mobile app then needs custom
headers with an Access service token.

## Hardware acceleration

Jellyfin and the Immich server get `/dev/dri` (Intel Quick Sync / VA-API).

Rootless containers can open the GPU only if your user can. Out of the box
that access comes from a desktop-session ACL, which only exists **while you are
logged in at the machine's desktop**. For it to work headless or at the login
screen, give your user permanent access once:

```bash
sudo usermod -aG render,video "$USER"
sudo apt install crun            # runc can't pass supplementary groups through
mkdir -p ~/.config/containers
printf '[engine]\nruntime = "crun"\n' >> ~/.config/containers/containers.conf
```

Then add `group_add: [keep-groups]` to the Jellyfin and Immich server services
and run `./homelab up`. Without GPU access, transcoding falls back to the CPU.

Turn hardware acceleration on in each app:

* **Jellyfin:** Dashboard → Playback → Transcoding → *Intel QuickSync (QSV)*.
* **Immich:** Administration → Settings → Video Transcoding → Hardware
  Acceleration → *Quick Sync*.

If a machine has no `/dev/dri`, remove the `devices:` entry in
`stacks/jellyfin/compose.yml` and set the Immich `extends.service` to `cpu`.

## Backups

Two places hold everything worth keeping:

* **`/modulab/media`** (SSD): your movies, shows, cartoons and wrestling, plus `images/`,
  which holds every Immich photo and video and Immich's nightly database
  dumps in `images/backups/`.
* **`~/homelab-data`**: `immich/postgres` (Immich's live database),
  `jellyfin/config` (users, watch history, metadata) and `n8n` (workflows,
  credentials and their encryption key).

Both drives are in the same machine, so copy both folders to another disk or
location. Files created by containers that run as a non-root user (for example
Postgres) are owned by a sub-UID on the host. To back them up or inspect them,
use `podman unshare`, e.g. `podman unshare tar czf backup.tgz ~/homelab-data`.
