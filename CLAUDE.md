# Notes for agents working on this repo

This repo is the live config of a running homelab: pushing to `master` deploys
it (the `homelab-sync` timer pulls every 5 minutes). README.md documents every
stack; read the relevant section before changing one.

## The repo is public: keep private values out of git

Never put the public domain, other domains, the Cloudflare tunnel ID, tunnel
or account names, or the LAN address in tracked files or commit messages. Write
`<domain>`, `<host>` or `<tunnel-id>` in docs. The real values live in
gitignored files:

- `.homelab.env`: `HOMELAB_DOMAIN` (and other machine settings)
- `stacks/<stack>/.env`: secrets, including `TUNNEL_TOKEN` (the tunnel ID is
  decoded from it by `stacks/cloudflared/pre-up`)
- `stacks/cloudflared/ingress.local.yml`: tunnel rules for other domains

Hooks in `.githooks/` (enabled by `./homelab bootstrap` through
`core.hooksPath`) refuse commits containing these values. Don't bypass them
with `--no-verify`. If one fires, replace the value with a placeholder or
template it from `.homelab.env`. Stacks get the domain from `HOMELAB_DOMAIN`
in their hooks (see `stacks/opencloud/pre-up`).

## Making changes

- Run stacks through `./homelab` (`./homelab up <stack>`, `./homelab restart
  <stack>`), not `podman` or `docker compose` directly: it targets the rootless
  Podman socket and runs the stack's pre-up/post-up hooks.
- New web UI: the next free port from 10000 (see the port scheme in README),
  a tile in `stacks/dashboard/config/services.yaml`, a row in the README
  services table.
- Publishing a service: a rule in `stacks/cloudflared/config.template.yml`
  using `{{DOMAIN}}`, plus a proxied DNS CNAME in Cloudflare (README,
  "Cloudflare Tunnel").
- Commit and push when done. Sync only fast-forwards, so never rewrite pushed
  history without the owner's say-so.
