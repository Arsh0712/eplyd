# EplyD — Architecture

EplyD is a personal PaaS for Discord bots: a single Node.js process acts as both the **control plane** (API, dashboard, auth, database) and the **runtime host** (supervises bot processes on the same machine). It is designed for a beefy Ubuntu container (e.g. 12 cores / 96 GiB) exposed through Cloudflare, with no systemd and no Docker-in-Docker.

```
Browser (React SPA, dark-first, green accent)
   │  REST /api/v1  ·  WebSocket /ws/*  (same-origin, cookie auth)
   ▼
Cloudflare (TLS, WebSockets) → cloudflared tunnel → 127.0.0.1:3000
   ▼
Express + ws  ── helmet/CSP · CSRF double-submit · argon2id sessions · rate limits
   │
   ├── better-sqlite3 (WAL)     projects · env (AES-GCM) · keys · sessions · activity · settings
   ├── ProjectManager           state machine, restart policy, backoff, crash-loop, cgroups
   │     └── child_process.spawn (detached process group per bot)
   ├── Deps engine              detect → fingerprint → (queue + fp-lock) install → stamp
   ├── LogStore                 per-project JSONL ring on disk (10 MB rotate) → WS fan-out
   └── node-pty (optional)      interactive terminals; piped-bash fallback
```

## Process supervisor

Every project runs as a **detached process group** (`spawn(..., { detached: true })`), so stop/kill addresses the whole tree via `kill(-pid)`. The manager persists `status`, `pid`, `started_at`, `restart_count`, exit codes and a `was_running` flag to SQLite.

- **Start pipeline (state machine):** `queued → checking_deps → installing (or building for Java) → starting → running`; every transition is broadcast over the project's logs WebSocket and written to the activity feed.
- **Restart policy:** `never` / `on-failure` / `always` with backoff `1s, 2s, 5s, 15s, 60s`, a per-session `max_restarts` cap, and **crash-loop detection** (5 unclean exits in 10 minutes → paused with a clear status).
- **Boot reconciliation:** on platform start, projects with `autostart` or `was_running` are restarted with staggered delays; orphans are marked stopped.
- **Graceful shutdown:** SIGTERM → mark `was_running`, terminate groups, wait up to 8s, then SIGKILL.
- **Resource limits:** best-effort cgroup v2 (`memory.max`, `cpu.max` under `/sys/fs/cgroup/eplyd.d/<id>` when the host delegates controllers) plus soft RAM warnings sampled from `/proc` every 3s. The platform reserves headroom for itself via PM2 `max_memory_restart`.
- **Environment hygiene:** bots get an **allowlisted** environment (PATH, LANG, TERM, HOME=project dir, shared-cache variables, project vars). Platform secrets (`ADMIN_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `GITHUB_WEBHOOK_SECRET`) can never leak into a bot.

## Smart, shared dependency management

On every start (and manual "Install deps"):

1. **Detect** the runtime from manifests: `package.json` (+ lockfile) → Node; `requirements.txt` / `pyproject.toml` / `Pipfile` → Python; `pom.xml` / `build.gradle(.kts)` / prebuilt `*.jar` → Java (JDK 17 or 21 from project settings). Python projects with no manifest get a `requirements.txt` generated from imports of well-known Discord libraries.
2. **Fingerprint** = SHA-256 over manifests + lockfile + runtime versions + install strategy + platform. Stored in `.eplyd/deps.stamp` inside the project.
3. **Skip-if-unchanged:** fingerprint matches **and** the installed environment validates (`node_modules` present / shared venv exists / built jar present) → **no install**, start immediately (`Dependencies up to date — fingerprint match` in the Console).
4. **Install otherwise**, through two global limiters:
   - **Per-fingerprint lock** — 20 bots with identical requirements starting at once install **once**; the others wait and reuse the result (`fingerprintJoins` stat).
   - **Concurrency queue** — at most `MAX_CONCURRENT_INSTALLS` installs at a time (default 3). Install output streams into the project Console; failures surface with the tail of the log and a Retry via the same button.
5. **Shared caches** (identical for every bot, exported in `/etc/environment`):
   - Node: `pnpm` with one global store `CACHE_DIR/pnpm-store` (hard links → identical packages stored once); npm fallback with shared `npm_config_cache`.
   - Python: `uv` (fallback `pip`) with `UV_CACHE_DIR` / `PIP_CACHE_DIR`, plus **shared virtualenvs** `CACHE_DIR/venvs/<hash(normalized requirements + python version)>` — projects with identical requirements run the *same* interpreter; different requirements get their own venv.
   - Java: `MAVEN_OPTS=-Dmaven.repo.local=CACHE/maven`, `GRADLE_USER_HOME=CACHE/gradle`.
6. **Storage UI:** Settings → Storage shows per-cache sizes, shared venv count, cache hit rate and fingerprint joins, with per-scope clear and garbage-collection of venvs unreferenced by any project for N days.

Because the cache env vars are always present, the offline case degrades gracefully: if the shared venv / store already satisfies the fingerprint, the install step is skipped and the bot starts without network.

## Security model

- **Auth:** single-field login; owner password from `ADMIN_PASSWORD` hashed with **argon2id** (re-hashed on boot when the env value changes); guest keys are ≥32 chars, stored as SHA-256 (lookup) **and** AES-256-GCM (reveal later). Login is rate-limited (5/min/IP, 60s lockout) with constant-time verification.
- **Sessions:** opaque 48-byte tokens, stored hashed; httpOnly + SameSite=Lax (+ Secure when `PUBLIC_URL` is https); 24h default, 30-day "remember me"; revoking a key kills its sessions instantly.
- **CSRF:** double-submit cookie (`eplyd_csrf` + `x-csrf-token` header) plus same-origin enforcement on mutating `/api` requests. Login and the HMAC webhook are exempt.
- **Isolation:** enforced server-side on every REST route (`loadProject`) and WS channel (upgrade-time check) — guests see and manage only projects they created.
- **File safety:** every path passes `safeResolve` (lexical) + `assertRealInsideRoot` (symlink-aware realpath) checks; ZIP extraction guards against zip-slip, absolute paths, symlinks, `__MACOSX` junk, file-count/decompression-ratio bombs, and strips a single wrapper folder; uploads capped by `MAX_UPLOAD_MB`.
- **Secrets at rest:** env vars and guest keys encrypted with AES-256-GCM keyed by `ENCRYPTION_KEY` (auto-generated + persisted with a warning if unset). Secrets are never echoed to logs (pino redaction) and never injected into bot environments.
- **Headers/CSP:** helmet with a strict CSP (self-only scripts, bundled Monaco workers via blob:, same-origin WebSockets) — the dashboard works fully offline, no CDN.

## Why this stack (instead of Next.js)

The platform is a **long-running supervisor** on a dedicated host: it needs a persistent process pool, raw WebSocket upgrades with cookie auth, `node-pty`, filesystem control and SQLite in WAL mode. A React+Vite SPA behind an Express API keeps the runtime simple (one PM2 process), matches the deployment target exactly, and avoids framework request lifecycles that fight long-lived child processes and pty sessions. Vite bundles Monaco and xterm locally, so the dashboard is CSP-strict and CDN-independent.

## Repository layout

```
eplyd/
├─ apps/
│  ├─ server/            # Express API, WS, supervisor, deps engine, SQLite, tests
│  │  └─ src/{auth,routes,supervisor,ws,lib,db,tests}
│  └─ web/               # React 18 + Vite + Tailwind dashboard (Monaco, xterm)
├─ scripts/              # install.sh · update.sh · backup.sh
├─ docs/                 # DEPLOY.md · ROUTES.md · ARCHITECTURE.md
├─ ecosystem.config.js   # PM2 process definition
├─ start.sh              # no-systemd boot helper (pm2 resurrect)
└─ .env.example
```
