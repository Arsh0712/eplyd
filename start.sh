#!/usr/bin/env bash
# EplyD boot helper for containers WITHOUT systemd.
# Source shared cache env vars, then restore the PM2 process list.
set -e
cd "$(dirname "$0")"

if [ -f /etc/environment ]; then
  set -a
  . /etc/environment
  set +a
fi

command -v pm2 >/dev/null 2>&1 || { echo "[eplyd] pm2 not found — run scripts/install.sh first" >&2; exit 1; }

# Restore saved process list; fall back to a fresh start.
pm2 resurrect 2>/dev/null || pm2 start ecosystem.config.js
echo "[eplyd] platform restored"
