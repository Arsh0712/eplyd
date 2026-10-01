# EplyD — Routes & Access Rules

Page routes are served by the SPA with a history fallback (`index.html` for any non-`/api`, non-`/ws` GET), so every deep link works on refresh.

## Page routes

| Route | Page | Access |
|---|---|---|
| `/` | Public landing page (logo, features) — signed-in users land on `/projects` instead | Public |
| `/login` | Key/password login | Public |
| `/projects` | Projects dashboard (grid, search, filters, bulk actions) | Auth |
| `/projects/new` | New project wizard (ZIP / template / Git) | Auth |
| `/projects/:id` | Redirects to `/projects/:id/console` | Auth + project owner |
| `/projects/:id/console` | Live logs, terminal, start/stop/restart/kill | Auth + project owner |
| `/projects/:id/files` | File tree + Monaco editor (`?path=src/index.js` deep links) | Auth + project owner |
| `/projects/:id/environment` | Environment variables | Auth + project owner |
| `/projects/:id/settings` | Project settings + danger zone | Auth + project owner |
| `/projects/:id/activity` | Per-project activity feed | Auth + project owner |
| `/keys` | Access keys (generate / reveal / revoke) | **Owner only** |
| `/activity` | Global activity & audit log | **Owner only** |
| `/settings` | Platform settings, redirects to `/settings/general` | **Owner only** |
| `/settings/general` | Editable defaults + read-only host config | Owner only |
| `/settings/runtimes` | Detected runtime versions | Owner only |
| `/settings/storage` | Cache sizes, hit rate, clear / GC | Owner only |
| `/settings/notifications` | Default webhook + test | Owner only |
| `/settings/security` | Sessions + hardening summary | Owner only |
| `/docs` | In-app help | Auth |
| `/403` `/404` `/500` | Friendly error pages; unknown paths render 404 | Public |

"Auth + project owner" = the signed-in actor is the owner, **or** a guest key that created the project. Enforced server-side on every API route and WebSocket channel — never only in the UI.

## REST API — `/api/v1`

| Method & path | Purpose | Access |
|---|---|---|
| `POST /auth/login` | Login (owner password or guest key); sets session + CSRF cookies. Rate-limited 5/min/IP with lockout | Public |
| `POST /auth/logout` | Destroy current session | Auth |
| `GET /auth/me` | Current actor (`owner` / `guest` / unauthenticated) | Public |
| `GET /keys` | List guest keys (masked) | Owner |
| `POST /keys` | Generate guest key — full value returned **once** | Owner |
| `PATCH /keys/:id` | Rename a key | Owner |
| `POST /keys/:id/reveal` | Decrypt + reveal key | Owner |
| `DELETE /keys/:id` | Revoke key (kills its sessions) | Owner |
| `GET /projects` | List visible projects + live status | Auth (guests: own only) |
| `POST /projects` | Create (template / Git import) | Auth |
| `POST /projects/bulk` | Bulk start/stop/restart by ids | Auth (per-project check) |
| `GET /projects/:id` | Detail + process snapshot | Auth + project owner |
| `PATCH /projects/:id` | Update settings | Auth + project owner |
| `DELETE /projects/:id` | Delete (must be stopped) | Auth + project owner |
| `POST /projects/:id/upload-zip?mode=replace\|merge` | Upload ZIP (raw body, ≤ `MAX_UPLOAD_MB`) | Auth + project owner |
| `GET /projects/:id/download` | Download project as ZIP | Auth + project owner |
| `POST /projects/:id/start` | Full pipeline: deps → build → run | Auth + project owner |
| `POST /projects/:id/stop` | Graceful stop (SIGTERM → SIGKILL after 10s) | Auth + project owner |
| `POST /projects/:id/restart` | Stop + start | Auth + project owner |
| `POST /projects/:id/kill` | SIGKILL the process group | Auth + project owner |
| `POST /projects/:id/install` | Install deps without starting | Auth + project owner |
| `POST /projects/:id/git-pull` | Pull latest from configured remote | Auth + project owner |
| `POST /projects/:id/wipe-files` | Delete all files (keeps `.eplyd`) | Auth + project owner |
| `GET /projects/:id/logs` | Tail recent log lines (`?n=`) | Auth + project owner |
| `GET /projects/:id/logs/download` | Download full log | Auth + project owner |
| `DELETE /projects/:id/logs` | Clear persisted logs | Auth + project owner |
| `GET /projects/:id/files?path=` | List a directory (`deps=1` shows `node_modules` etc.) | Auth + project owner |
| `GET /projects/:id/files/content?path=` | Read file text (2 MB editor limit; binary detection) | Auth + project owner |
| `PUT /projects/:id/files/content` | Save file | Auth + project owner |
| `GET /projects/:id/files/raw?path=` | Raw file (image preview / download) | Auth + project owner |
| `POST /projects/:id/files/mkdir` | Create folder | Auth + project owner |
| `POST /projects/:id/files/move` | Rename / move | Auth + project owner |
| `POST /projects/:id/files/copy` | Duplicate | Auth + project owner |
| `POST /projects/:id/files/upload?path=&name=` | Upload single file (raw) | Auth + project owner |
| `DELETE /projects/:id/files?path=` | Delete file/folder | Auth + project owner |
| `GET /projects/:id/env?reveal=1` | List env vars (masked unless revealed) | Auth + project owner |
| `PUT /projects/:id/env` | Set/delete vars (encrypted at rest) | Auth + project owner |
| `POST /projects/:id/env/import` | Bulk import `.env` text (`mode=merge\|replace`; returns detected keys + auto-flagged secret count) | Auth + project owner |
| `GET /projects/:id/env/raw` | Full `.env` as plain text (raw editor) | Auth + project owner |
| `GET /projects/:id/env/export` | Export `.env` | Auth + project owner |
| `GET /projects/:id/activity` | Per-project activity feed | Auth + project owner |
| `GET /activity` | Global activity feed | Owner |
| `GET /metrics` | Host + per-project metrics | Owner |
| `GET /runtimes` | Detected runtime versions | Owner |
| `GET /storage` | Cache sizes + install stats | Owner |
| `POST /storage/clear` | Clear scope / GC unused venvs (`all`, `pnpm-store`, `uv`, …, `unused`) | Owner |
| `GET /settings` / `PUT /settings` | Platform defaults | Owner |
| `POST /notifications/test` | Send test webhook | Owner |
| `GET /sessions` / `DELETE /sessions/:id` | Active sessions | Owner |
| `POST /hooks/github` | HMAC-SHA256-verified platform auto-update | HMAC signature |
| `GET /openapi.json` | Machine-readable API spec | Auth |
| `GET /api/docs` | Human API landing page | Public |
| `GET /healthz` | Health check (outside `/api`) | Public, unauthenticated |

## WebSocket channels — `/ws`

Cookies authenticate the upgrade handshake (same-origin only).

| Channel | Purpose | Access |
|---|---|---|
| `/ws/projects/:id/logs` | Replay last 500 lines + live stdout/stderr + status transitions | Auth + project owner |
| `/ws/projects/:id/terminal` | Interactive shell (node-pty; piped-bash fallback) scoped to the project dir, sanitized env | Auth + project owner |
| `/ws/metrics` | Host + per-project metrics every 2s | Owner |

Close codes: `4401` unauthenticated, `4403` forbidden, `4404` unknown channel/project.

## Security notes

- Mutating `/api` requests require the double-submit CSRF header (`x-csrf-token` matching the `eplyd_csrf` cookie) and a same-origin `Origin` header when present. Login and the HMAC webhook are exempt.
- All file paths are resolved and verified inside the project root (including symlink realpath checks).
- Bot processes and shells run with an allowlisted environment — platform secrets never leak.
