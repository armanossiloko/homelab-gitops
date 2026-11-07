#!/usr/bin/env bash
# One command to go from a fresh clone to a running homelab:
#
#   git clone <repo> && cd <repo> && ./bootstrap.sh
#
# Optional overrides on first run: HOMELAB_DATA=/path HOMELAB_SYNC_INTERVAL=10min
exec "$(dirname "$(readlink -f "$0")")/homelab" bootstrap "$@"
