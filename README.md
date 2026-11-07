<img src="assets/icon.svg" width="64" height="64" alt="">

# modulab

A GitOps homelab on **rootless Podman**: [Portainer](https://www.portainer.io/),
[Immich](https://immich.app/) and [Jellyfin](https://jellyfin.org/), all visible
and controllable from **Podman Desktop**.

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
3. Renders each stack's `.env` from `.env.example` (paths, timezone, random secrets).
4. Deploys every stack and enables the `homelab-sync` timer.

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
| `/modulab/media/images`         | `/data`              | Immich (all photos & videos) |

* **Jellyfin:** copy files into the folders and Jellyfin picks them up (or use
  Dashboard → Libraries → Scan). Naming that matches well: `movies/Title (Year)/Title (Year).mkv`
  and `shows/Show Name/Season 01/Show Name S01E01.mkv`. Cartoons is a TV-show
  library, so use the same layout as `shows`. Jellyfin mounts media read-only.
* **Immich:** upload from the web UI or the Immich phone app (server URL
  `http://<host>:2283`). Immich manages the `images` folder itself: it holds
  originals (`upload/` or `library/`), thumbnails, transcodes and nightly DB
  dumps (`backups/`). Don't copy files into it by hand. To import an existing
  photo folder, add it as an
  [external library](https://docs.immich.app/features/libraries).
* App state (Immich's Postgres database, Jellyfin's config and metadata) stays
  in `HOMELAB_DATA` (`~/homelab-data`).

## Services

| Service   | URL                      | Login                                                   |
| --------- | ------------------------ | ------------------------------------------------------- |
| Jellyfin  | http://&lt;host&gt;:8096    | `modulab` / `modulab`                                   |
| Immich    | http://&lt;host&gt;:2283    | `modulab@modulab` / `modulab` (Immich logs in by email) |
| Portainer | https://&lt;host&gt;:9443   | `admin` / `./homelab secret portainer` (random per machine) |

Accounts are created automatically on first start by each stack's `post-up`
hook, so there are no setup wizards. Jellyfin also gets the *Movies*, *Shows*
and *Cartoons* libraries (see [Media storage](#media-storage)). Add accounts
for family members in each app: Jellyfin → Dashboard → Users, Immich →
Administration → Users. Change the defaults in
`stacks/<stack>/.env.example` (for new machines) or `stacks/<stack>/.env` (for
this one) **before** the first start. After that, change passwords in each
app's UI. Portainer enforces a 12-character minimum, which is why it keeps a
generated password.

> These defaults are meant for a trusted home LAN. Change them before exposing
> anything to the internet.

**Podman Desktop:** everything runs on the default rootless Podman engine, so it
shows up under *Containers*, grouped by compose project. Podman Desktop can also
see a Docker daemon if one is running, but none of these stacks use it.

**Portainer:** open the `local` environment. It manages the same Podman engine.
Portainer lists these stacks as created outside Portainer, which is expected:
git, not the Portainer editor, is the place to change them.

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
```

`./homelab` always points compose at the rootless Podman socket
(`$XDG_RUNTIME_DIR/podman/podman.sock`), even if `DOCKER_HOST` or a Docker
daemon is around.

## Layout

```
bootstrap.sh            one-shot setup + deploy (calls ./homelab bootstrap)
homelab                 CLI: up/down/update/sync/status/...
homelab.conf            shared settings: data dir, media root, sync interval
stacks/
  portainer/            Portainer CE (admin password from .env secret)
  immich/               Immich server, ML, Valkey, Postgres (+ upstream hwaccel files)
  jellyfin/             Jellyfin with Intel iGPU passthrough
.homelab.env            machine-local settings (gitignored)
stacks/*/.env           machine-local values and secrets (gitignored)
```

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

* **`/modulab/media`** (SSD): your movies, shows and cartoons, plus `images/`,
  which holds every Immich photo and video and Immich's nightly database
  dumps in `images/backups/`.
* **`~/homelab-data`**: `immich/postgres` (Immich's live database) and
  `jellyfin/config` (users, watch history, metadata).

Both drives are in the same machine, so copy both folders to another disk or
location. Files created by containers that run as a non-root user (for example
Postgres) are owned by a sub-UID on the host. To back them up or inspect them,
use `podman unshare`, e.g. `podman unshare tar czf backup.tgz ~/homelab-data`.
