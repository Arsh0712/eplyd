# EplyD — Deployment Guide (Ubuntu 24.04 Docker container)

Target: **Ubuntu 24.04 Docker container**, root shell, **no systemd**, no Docker-in-Docker.
The site is deployed at **https://eplyd.dpdns.org**, code comes from your GitHub repo, and the domain's nameservers are on Cloudflare.

Every bot runs on this same machine — EplyD is the control plane *and* the runtime. The platform keeps a small footprint (PM2 `max_memory_restart: 600M`) and leaves the rest to the bots.

---

## Step 1. System packages, Python and Java

```bash
apt update && apt upgrade -y
apt install -y build-essential git curl wget unzip zip nano ca-certificates gnupg sqlite3 \
  python3 python3-venv python3-pip python3-dev \
  openjdk-17-jdk-headless openjdk-21-jdk-headless maven
```

## Step 2. Node 20, pnpm, PM2, uv

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
corepack enable && corepack prepare pnpm@latest --activate
npm i -g pm2
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Step 3. Verify runtimes

```bash
python3 --version; java -version; mvn -v; node -v; pnpm -v; uv --version; pm2 -v
update-alternatives --list java    # must list Java 17 and 21
```

## Step 4. Folders and shared dependency caches

```bash
mkdir -p /opt/eplyd/{app,data,cache/{pnpm-store,uv,pip,npm,maven,gradle,venvs}}
cat >> /etc/environment <<'EOF'
CACHE_DIR=/opt/eplyd/cache
PNPM_STORE_DIR=/opt/eplyd/cache/pnpm-store
UV_CACHE_DIR=/opt/eplyd/cache/uv
PIP_CACHE_DIR=/opt/eplyd/cache/pip
npm_config_cache=/opt/eplyd/cache/npm
GRADLE_USER_HOME=/opt/eplyd/cache/gradle
EOF
source /etc/environment
```

## Step 5. Get the code onto the server

**Option A — git (recommended, enables one-command updates):**

```bash
cd /opt/eplyd
git clone https://github.com/YOUR_USER/YOUR_REPO.git app && cd app
```

Private repo: use a personal access token in the URL, or a deploy key.

**Option B — upload the ZIP:**

```bash
cd /opt/eplyd
# upload eplyd.zip via SFTP/panel, then:
unzip -o eplyd.zip -d app && cd app
chmod +x start.sh scripts/*.sh
```

> The ZIP contains **source code only** — it has no `dist/` build output.
> You MUST run the build in Step 7 on the server itself, or PM2 will keep
> serving whatever old build is still on disk.

## Step 6. Configure `.env`

```bash
cp .env.example .env
nano .env
```

Set:

```ini
PORT=3000
DATA_DIR=/opt/eplyd/data
CACHE_DIR=/opt/eplyd/cache
PUBLIC_URL=https://eplyd.dpdns.org
ADMIN_PASSWORD="@rsh0712"
SESSION_SECRET="<output of openssl rand -hex 32>"
ENCRYPTION_KEY="<output of openssl rand -hex 32>"
```

Notes:

- **Quote** the `ADMIN_PASSWORD` value so the `@` parses correctly.
- `SESSION_SECRET` and `ENCRYPTION_KEY` are each `openssl rand -hex 32`.
- **Back up `ENCRYPTION_KEY`** — without it, stored bot environment variables cannot be decrypted. If both secrets are omitted, EplyD generates and persists them to `DATA_DIR/secrets.json` with a warning, but setting them explicitly is strongly recommended.

## Step 7. Build and start

```bash
pnpm install && pnpm build
pm2 start ecosystem.config.js && pm2 save
curl http://localhost:3000/healthz
# → {"ok":true,"version":"1.0.0","build":"<git-sha-or-zip>","builtAt":"...","uptime":0}
```

`pnpm build` MUST run on the server (it compiles `apps/server` and `apps/web` into
their `dist/` folders). The `build` field in `/healthz` and the footer chip in the
dashboard both show the deployed build id — after every deploy, confirm it changed.

## Step 8. Connect the domain with Cloudflare Tunnel

1. Cloudflare dashboard: confirm `eplyd.dpdns.org` is **Active** (nameservers set at the registrar).
2. Zero Trust → Networks → Tunnels → Create tunnel (Cloudflared), name `eplyd`, copy the token.
3. Install cloudflared:

   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
   dpkg -i cloudflared.deb
   # use cloudflared-linux-arm64.deb if `uname -m` prints aarch64
   ```

4. Run it under PM2:

   ```bash
   pm2 start "cloudflared tunnel run --token YOUR_TOKEN" --name tunnel && pm2 save
   ```

5. Tunnel → Public Hostname: domain `eplyd.dpdns.org`, subdomain empty, service `HTTP` → `localhost:3000`.
6. SSL/TLS mode **Full**; WebSockets **On** (needed for live logs and the terminal).

**Alternative without a tunnel:** proxied A record (`@` → server public IP) on a Cloudflare-supported port — only if the container has a public IP and exposed port. Set `HOST=0.0.0.0` in `.env` in that case.

## Step 9. Survive container restarts (no systemd)

The repo ships `start.sh` (also copied below). Run `pm2 save` after any process change so the list is restored on boot:

```bash
cat > /opt/eplyd/start.sh <<'EOF'
#!/bin/bash
source /etc/environment
pm2 resurrect
EOF
chmod +x /opt/eplyd/start.sh
```

Hook `/opt/eplyd/start.sh` into the container's start command (or run it manually after a restart). On boot, EplyD performs **boot reconciliation**: every project that was running before shutdown (or has "auto-start" enabled) is started again automatically.

The repo also includes `/opt/eplyd/app/start.sh` which does the same via `pm2 resurrect` with a fallback to `pm2 start ecosystem.config.js`.

## Step 10. Update later

**From git:**

```bash
cd /opt/eplyd/app && ./scripts/update.sh
```

(`git pull` → `pnpm install` → `pnpm build` → `pm2 reload` → health check. You can also wire a GitHub webhook to `POST /api/v1/hooks/github` with `GITHUB_WEBHOOK_SECRET` set — the platform runs the same script on push.)

**From a new ZIP:** replace the app files, rebuild, reload — your bots, env vars,
logs and history all live in `DATA_DIR` and are never touched:

```bash
cd /opt/eplyd
rm -rf app_old && mv app app_old          # keep a rollback copy
unzip -o eplyd-new.zip -d app
cp app_old/.env app/.env                  # carry over secrets
chmod +x app/start.sh app/scripts/*.sh
cd app && pnpm install && pnpm build
pm2 delete eplyd && pm2 start ecosystem.config.js && pm2 save
curl -s http://localhost:3000/healthz     # build id must be the NEW one
```

## Step 11. Verify

1. Log in at `https://eplyd.dpdns.org` with the owner password.
2. Upload a discord.py ZIP (or create one from the template), add `DISCORD_TOKEN`, press **Start** — the Console shows `queued → checking deps → installing → starting → running`.
3. Stop and start again — the install is **skipped** (`Dependencies up to date — fingerprint match`), and the bot is live in seconds.
4. Create a second project with the same `requirements.txt` and start it — it reuses the **shared venv**, no downloads.
5. Generate a guest key in **Keys**, log in as the guest in a private window — you should see none of the owner's projects.
6. Restart the whole container: `pm2 resurrect` restores the platform, and boot reconciliation restarts the bots that were running.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| **Still seeing the old interface after deploying** | The build never ran on the server, or you're seeing cache. 1) `curl -s http://localhost:3000/healthz` — if `build` is the old id, run `cd /opt/eplyd/app && pnpm install && pnpm build && pm2 reload eplyd --update-env`. 2) Hard-refresh the browser (**Ctrl+Shift+R** / **Cmd+Shift+R**). 3) Cloudflare dashboard → Caching → **Purge Everything**. The dashboard footer shows the build id — it must match your latest deploy. |
| `503` — "web dashboard not built" | You skipped `pnpm build` on the server. Run it, then `pm2 reload eplyd`. |
| `502` / Cloudflare error `1033` | Tunnel or app down. `pm2 status` must show `eplyd` (and `tunnel` if used). |
| Login works but logs/terminal freeze | WebSockets off in Cloudflare → set **WebSockets On**, SSL mode **Full**. |
| `pm2 logs eplyd` shows `EADDRINUSE` | Another process holds the port: `PORT` mismatch or a stale `eplyd` process. |
| Env var shows `[decryption failed]` | `ENCRYPTION_KEY` changed. Restore the original key from your backup. |
| Bot keeps crashing | Check the Console: crash-loop detection pauses auto-restarts after 5 crashes/10 min. Fix the error, press Start. |
| Install fails with network errors | Installs need outbound network. Fix connectivity, then use Console → **Install deps** or just Start again. |
| Disk filling up | Settings → Storage → clear caches or GC unused venvs. |

## Backups

```bash
./scripts/backup.sh                 # → $DATA_DIR/backups/eplyd-backup-<stamp>.tar.gz (+ .env copy)
```

Restore: stop the platform, extract the tarball over `DATA_DIR`, restore the matching `.env` (same `ENCRYPTION_KEY`!), start again.
