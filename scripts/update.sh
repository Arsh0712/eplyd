#!/usr/bin/env bash
# EplyD — one-command platform update (git pull + build + graceful reload).
# Also used by the GitHub auto-update webhook (POST /api/v1/hooks/github).
#
# DATA SAFETY: everything that matters lives in DATA_DIR (default
# /opt/eplyd/data) — the SQLite database, every project's files, encrypted
# env vars and log rings. This script never touches DATA_DIR, so your bots,
# variables and history survive every update. After the reload, running bots
# are reconciled back to the running state automatically.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[eplyd] pulling latest source…"
git pull --ff-only

echo "[eplyd] installing dependencies…"
pnpm install

echo "[eplyd] building server + web…"
pnpm build

echo "[eplyd] reloading platform (graceful — bots, data and env vars are preserved)…"
if pm2 describe eplyd > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save

echo "[eplyd] waiting for health check…"
for i in $(seq 1 30); do
  PORT="${PORT:-3000}"
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" > /dev/null 2>&1; then
    BUILD=$(curl -fsS "http://127.0.0.1:${PORT}/healthz" | grep -o '"build":"[^"]*"' | cut -d'"' -f4 || true)
    echo "[eplyd] update complete — platform healthy (deployed build: ${BUILD:-unknown})."
    echo "[eplyd] Verify live build any time:  curl -s http://127.0.0.1:${PORT}/healthz"
    echo "[eplyd] Bots marked 24/7 are being brought back online automatically."
    exit 0
  fi
  sleep 1
done
echo "[eplyd] WARNING: platform did not become healthy in 30s — check 'pm2 logs eplyd'" >&2
exit 1
