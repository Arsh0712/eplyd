#!/usr/bin/env bash
# EplyD — backup projects, database, logs and .env into a timestamped tarball.
# Restore:  pm2 stop eplyd && tar -xzf backup.tar.gz -C / && pm2 start eplyd
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="${DATA_DIR:-/opt/eplyd/data}"
BACKUP_DIR="${BACKUP_DIR:-${DATA_DIR}/backups}"
KEEP="${KEEP:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/eplyd-backup-${STAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "[eplyd] backing up data dir: $DATA_DIR"
tar -czf "$OUT" \
  -C "$(dirname "$DATA_DIR")" \
  --exclude '*/cache/*' \
  "$(basename "$DATA_DIR")"

# .env contains ENCRYPTION_KEY — required to decrypt env vars after restore.
if [ -f .env ]; then
  cp .env "${BACKUP_DIR}/.env.${STAMP}"
  chmod 600 "${BACKUP_DIR}/.env.${STAMP}"
fi

echo "[eplyd] pruning old backups (keeping ${KEEP})…"
ls -1t "${BACKUP_DIR}"/eplyd-backup-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[eplyd] backup written: $OUT"
du -h "$OUT"
