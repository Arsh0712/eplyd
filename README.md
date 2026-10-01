# EplyD — Discord Bot Hosting Platform

**EplyD** is a production-grade, self-hosted platform for deploying and managing **unlimited Discord bots** from a polished web dashboard — a personal PaaS in the spirit of Railway, suga.app and nexohost.in.

> Built by Eply · https://eplyd.dpdns.org

![status](https://img.shields.io/badge/bots-unlimited-3DDC97) ![license](https://img.shields.io/badge/license-private-lightgrey)

## Features

- **Landing page** — a branded public homepage at `/` (logo, features, quick start) with zero 404 surprises; the dashboard sits behind it.
- **Projects** — create bots by **uploading a ZIP** (auto-extracted, zip-slip-safe, wrapper folder stripped), from **ready-to-run templates** (discord.js, discord.py), or by **importing a Git repo**. No cap on projects or simultaneously running bots — live host capacity is shown instead.
- **Console** — live stdout/stderr with ANSI colors over WebSocket, persistent 10 MB log history per project, timestamps, pause, search, download; **interactive terminal** per project (node-pty) for `npm install`, `pip install`, anything.
- **Files** — Monaco editor with tabs, dirty indicators, `Ctrl/Cmd+S`, Save & Restart; file tree with upload/download/rename/move/duplicate/delete; deps-folder toggle; image previews; deep-linkable `?path=`.
- **Environment** — key/value variables encrypted at rest (AES-256-GCM). Paste a `.env` and every variable is **auto-detected live**: secrets are flagged and masked, `DISCORD_TOKEN` format is validated on the spot, and a Raw `.env` editor keeps the file and the variable table in sync. Restart-required banner included.
- **Smart dependency management** — runtimes auto-detected (Node / Python / Java 17-21 / custom), dependencies installed **automatically on first start** and **skipped on later starts** via fingerprints; **shared caches and shared Python venvs** so identical dependency sets download and install **once per server**; global fingerprint lock + install-concurrency queue.
- **24/7 always-on** — new projects default to `restart_policy: always` + auto-start on boot: bots restart on crash, after platform updates and after full server reboots. No idle sleep — the platform and its bots stay up until the server itself goes down. Tuned defaults for a 32 GB RAM / 98 GB disk host (4 GB platform reserve, 2 GB ZIP uploads).
- **Supervisor** — restart policies with backoff (1s→60s), crash-loop detection, boot reconciliation after platform/container restarts, optional cgroup CPU/RAM limits, per-project cron restarts, Discord webhook notifications.
- **Keys & isolation** — owner password (argon2id) plus revocable **guest keys**; guests only ever see and manage projects they created — enforced server-side on every route and WebSocket channel.
- **Ops** — global activity/audit log, host metrics (CPU/RAM/disk), runtime detection panel, storage & cache management UI, health endpoint, OpenAPI spec, one-command update, backups.

## Quick start (server)

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the exact copy-paste commands for a fresh Ubuntu 24.04 container. The short version:

```bash
# 1. system deps (Python 3.12, JDK 17+21, Maven, Node 20, pnpm, PM2, uv)
./scripts/install.sh

# 2. code + config
cd /opt/eplyd && git clone https://github.com/YOUR_USER/YOUR_REPO.git app && cd app
cp .env.example .env && nano .env        # set ADMIN_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY…

# 3. build + run   (pnpm build MUST run on the server — the repo ships source only)
pnpm install && pnpm build
pm2 start ecosystem.config.js && pm2 save
curl http://localhost:3000/healthz   # shows the deployed build id

# 4. expose via Cloudflare Tunnel (WebSockets On) and log in
```

> **Updating? Deployed and still see the old interface?** That means `pnpm build`
> didn't run on the server (or your browser cached the old shell). Run
> `pnpm install && pnpm build && pm2 reload eplyd --update-env`, then hard-refresh
> (Ctrl/Cmd+Shift+R). The dashboard footer and `/healthz` both show the live build
> id — if it doesn't change after a deploy, the build didn't happen. See
> **docs/DEPLOY.md → Troubleshooting**.

## Local development

```bash
pnpm install
pnpm dev:server        # API + WS on :3000 (uses ./data and ./cache)
pnpm dev:web           # Vite dev server on :5173 (proxies /api and /ws)
pnpm test              # vitest: crypto, path traversal, zip-slip, auth & isolation
pnpm build             # production build (server tsc + web vite)
pnpm start             # run the built platform
```

Open http://localhost:5173, log in with `ADMIN_PASSWORD` from your `.env` (dev default falls back to whatever you set), and go.

## Repository layout

```
eplyd/
├─ apps/
│  ├─ server/            # Express API, WebSocket, supervisor, deps engine, SQLite
│  └─ web/               # React 18 + Vite + Tailwind dashboard (Monaco, xterm)
├─ scripts/
│  ├─ install.sh         # full server bootstrap (runtimes, caches, cloudflared)
│  ├─ update.sh          # git pull + build + graceful reload + health check
│  ├─ write-build-info.mjs  # stamps git sha + time into server & web builds
│  └─ backup.sh          # timestamped data backups with retention
├─ docs/
│  ├─ DEPLOY.md          # copy-paste deployment for eplyd.dpdns.org
│  ├─ ROUTES.md          # every page/API/WS route with access rules
│  └─ ARCHITECTURE.md    # design, security model, dependency caching
├─ ecosystem.config.js   # PM2 process definition
├─ start.sh              # boot helper for containers without systemd
└─ .env.example
```

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` / `HOST` | Listen address (default `127.0.0.1:3000`) |
| `DATA_DIR` | Projects, SQLite DB, logs, backups (default `/opt/eplyd/data`) |
| `CACHE_DIR` | Shared pnpm/uv/pip/npm/maven/gradle caches + shared venvs |
| `PUBLIC_URL` | Canonical URL (enables `Secure` cookies) |
| `ADMIN_PASSWORD` | Owner password — hashed with argon2id, never stored in plaintext |
| `SESSION_SECRET` | (optional) stable session signing — auto-generated if unset |
| `ENCRYPTION_KEY` | AES-256-GCM key for env vars/keys — **back it up** |
| `MAX_UPLOAD_MB` | ZIP upload cap (default 2048) |
| `MAX_CONCURRENT_INSTALLS` | Parallel dependency installs (default 3) |
| `PLATFORM_RESERVED_RAM_MB` | RAM reserved for platform + OS — bot pool = total − reserve (default 4096) |
| `GITHUB_WEBHOOK_SECRET` | Enables the HMAC-verified auto-update webhook |

## Verification checklist

1. `pnpm build && pnpm start` from a clean clone brings the platform up; `/` shows the landing page.
2. Log in with the owner key; upload a discord.js and a discord.py ZIP; edit + save a file; press **Start** — dependencies install automatically (`checking deps → installing → running`) with live logs.
3. Add secrets by pasting a `.env` in the Raw editor — variables are auto-detected, secrets masked, and the table view shows them immediately.
4. Stop and start again — install is skipped (`fingerprint match`) and the bot is live in seconds.
5. Two projects with the same `requirements.txt` share one venv; disk usage and hit rate are visible in Settings → Storage.
6. Create 50+ projects and run many simultaneously — no platform caps.
7. Generate a guest key, log in as guest in a private window — none of the owner's projects are visible.
8. Restart the platform or the whole container — projects, variables, logs and running state survive; bots with auto-start come back on their own.
9. Every route in `docs/ROUTES.md` loads directly by URL; unknown paths render the 404 page.
