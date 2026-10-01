#!/usr/bin/env bash
# ============================================================
#  EplyD — full server bootstrap for a fresh Ubuntu 24.04
#  Docker container (root shell, no systemd).
#  Installs every runtime the platform can host, creates the
#  data/cache folders and the shared dependency caches.
# ============================================================
set -euo pipefail

echo "[eplyd] 1/6 — system packages"
apt update && apt upgrade -y
apt install -y build-essential git curl wget unzip zip nano ca-certificates gnupg sqlite3 \
  python3 python3-venv python3-pip python3-dev \
  openjdk-17-jdk-headless openjdk-21-jdk-headless maven

echo "[eplyd] 2/6 — Node.js 20, pnpm, PM2"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
corepack enable && corepack prepare pnpm@latest --activate || npm i -g pnpm@9
npm i -g pm2

echo "[eplyd] 3/6 — uv (fast Python installer with shared cache)"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ln -sf "$HOME/.local/bin/uv" /usr/local/bin/uv 2>/dev/null || true
  ln -sf "$HOME/.local/bin/uvx" /usr/local/bin/uvx 2>/dev/null || true
fi

echo "[eplyd] 4/6 — folders and shared dependency caches"
mkdir -p /opt/eplyd/{app,data,cache/{pnpm-store,uv,pip,npm,maven,gradle,venvs}}
cat >> /etc/environment <<'EOF'
CACHE_DIR=/opt/eplyd/cache
PNPM_STORE_DIR=/opt/eplyd/cache/pnpm-store
UV_CACHE_DIR=/opt/eplyd/cache/uv
PIP_CACHE_DIR=/opt/eplyd/cache/pip
npm_config_cache=/opt/eplyd/cache/npm
GRADLE_USER_HOME=/opt/eplyd/cache/gradle
EOF

echo "[eplyd] 5/6 — optional: cloudflared (Cloudflare Tunnel)"
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) CF_ARCH="amd64" ;;
    aarch64) CF_ARCH="arm64" ;;
    *) CF_ARCH="" ;;
  esac
  if [ -n "$CF_ARCH" ]; then
    curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb" -o /tmp/cloudflared.deb \
      && dpkg -i /tmp/cloudflared.deb || echo "[eplyd] cloudflared install skipped (optional)"
  fi
fi

echo "[eplyd] 6/6 — verify runtimes"
python3 --version
java -version 2>&1 | head -1
mvn -v 2>/dev/null | head -1 || echo "maven missing!"
node -v
pnpm -v
uv --version
pm2 -v
update-alternatives --list java 2>/dev/null || true

echo
echo "[eplyd] done. Next:"
echo "  cd /opt/eplyd && git clone https://github.com/YOUR_USER/YOUR_REPO.git app && cd app"
echo "  cp .env.example .env && nano .env"
echo "  pnpm install && pnpm build && pm2 start ecosystem.config.js && pm2 save"
