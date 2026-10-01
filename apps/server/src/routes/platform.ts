import { Router, raw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { getDb, getSetting, setSetting } from '../db';
import { config } from '../config';
import { hmacSha256hex, timingSafeEqualStr } from '../lib/crypto';
import { requireOwner } from '../auth/middleware';
import type { AuthedRequest } from '../auth/middleware';
import { recordActivity, listActivity } from '../activity';
import { detectRuntimes } from '../supervisor/runtimes';
import { installStats } from '../supervisor/deps';
import { getManager } from '../supervisor/manager';
import { hostMetrics } from '../lib/metrics';
import { notifyEvent } from '../supervisor/notify';
import { logger } from '../lib/log';

export const platformRouter = Router();

// ---------- global activity (owner) ----------

platformRouter.get('/activity', requireOwner, (req: AuthedRequest, res) => {
  const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
  res.json({ activity: listActivity({ before, limit: 150 }) });
});

// ---------- metrics (owner) ----------

platformRouter.get('/metrics', requireOwner, (_req, res) => {
  const projects = getManager().snapshotAll();
  const running = Object.values(projects).filter((p) => p.status === 'running').length;
  res.json({
    host: hostMetrics(config.dirs.data),
    projects,
    running,
    reservedRamMb: config.platformReservedRamMb
  });
});

// ---------- runtimes (owner) ----------

platformRouter.get('/runtimes', requireOwner, (_req, res) => {
  res.json({ runtimes: detectRuntimes() });
});

// ---------- storage (owner) ----------

function dirSize(root: string, depth = 0): number {
  if (depth > 20) return 0;
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    try {
      if (e.isDirectory()) total += dirSize(p, depth + 1);
      else total += fs.statSync(p).size;
    } catch { /* ignore */ }
    if (total > 2 * 1024 * 1024 * 1024 * 1024) break; // sanity cap
  }
  return total;
}

platformRouter.get('/storage', requireOwner, (_req, res) => {
  const d = config.dirs;
  const scopes = [
    { id: 'pnpm-store', label: 'pnpm store (shared node packages)', path: d.pnpmStore },
    { id: 'npm', label: 'npm cache', path: d.npmCache },
    { id: 'uv', label: 'uv cache (python wheels)', path: d.uvCache },
    { id: 'pip', label: 'pip cache', path: d.pipCache },
    { id: 'maven', label: 'maven repository', path: d.mavenRepo },
    { id: 'gradle', label: 'gradle home', path: d.gradleHome },
    { id: 'venvs', label: 'shared virtualenvs', path: d.venvs }
  ];
  const sizes = scopes.map((s) => ({ ...s, bytes: dirSize(s.path) }));
  let venvCount = 0;
  try {
    venvCount = fs.readdirSync(d.venvs).length;
  } catch { /* ignore */ }
  const projectsBytes = dirSize(d.projects);
  const logsBytes = dirSize(d.logs);
  res.json({
    scopes,
    venvCount,
    projectsBytes,
    logsBytes,
    stats: installStats()
  });
});

const clearSchema = z.object({ scope: z.string().min(1).max(32) });

platformRouter.post('/storage/clear', requireOwner, (req: AuthedRequest, res) => {
  const body = clearSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'scope required' } });
    return;
  }
  const scope = body.data.scope;
  const map: Record<string, string> = {
    'pnpm-store': config.dirs.pnpmStore,
    npm: config.dirs.npmCache,
    uv: config.dirs.uvCache,
    pip: config.dirs.pipCache,
    maven: config.dirs.mavenRepo,
    gradle: config.dirs.gradleHome,
    venvs: config.dirs.venvs
  };
  try {
    if (scope === 'all') {
      for (const dir of Object.values(map)) clearDirContents(dir);
    } else if (scope === 'unused') {
      gcUnusedVenvs(7);
    } else if (scope === 'unused-30') {
      gcUnusedVenvs(30);
    } else if (map[scope]) {
      clearDirContents(map[scope]!);
    } else {
      res.status(400).json({ error: { code: 'bad_request', message: 'unknown scope' } });
      return;
    }
    recordActivity({ actor: 'owner', action: 'storage.clear', detail: scope });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { code: 'clear_failed', message: err instanceof Error ? err.message : 'clear failed' } });
  }
});

function clearDirContents(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const e of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  }
}

/** Remove shared venvs not referenced by any project for > N days. */
function gcUnusedVenvs(days: number): number {
  const referenced = new Set<string>();
  const projectsRoot = config.dirs.projects;
  try {
    for (const id of fs.readdirSync(projectsRoot)) {
      try {
        const stamp = JSON.parse(fs.readFileSync(path.join(projectsRoot, id, '.eplyd', 'deps.stamp'), 'utf8')) as { venvHash?: string };
        if (stamp.venvHash) referenced.add(stamp.venvHash);
      } catch { /* no stamp */ }
    }
  } catch { /* ignore */ }
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let removed = 0;
  try {
    for (const v of fs.readdirSync(config.dirs.venvs)) {
      if (referenced.has(v)) continue;
      const p = path.join(config.dirs.venvs, v);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) {
          fs.rmSync(p, { recursive: true, force: true });
          removed += 1;
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return removed;
}

// ---------- platform settings (owner) ----------

platformRouter.get('/settings', requireOwner, (_req, res) => {
  res.json({
    defaultWebhookUrl: getSetting('default_webhook_url') || '',
    cacheGcDays: parseInt(getSetting('cache_gc_days') || '7', 10) || 7,
    publicUrl: config.publicUrl,
    maxUploadMb: config.maxUploadMb,
    maxConcurrentInstalls: config.maxConcurrentInstalls,
    platformReservedRamMb: config.platformReservedRamMb,
    githubWebhookConfigured: !!config.githubWebhookSecret
  });
});

const putSettingsSchema = z.object({
  defaultWebhookUrl: z.string().trim().max(500).optional(),
  cacheGcDays: z.coerce.number().int().min(1).max(365).optional()
});

platformRouter.put('/settings', requireOwner, (req: AuthedRequest, res) => {
  const body = putSettingsSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'invalid settings' } });
    return;
  }
  if (body.data.defaultWebhookUrl !== undefined) setSetting('default_webhook_url', body.data.defaultWebhookUrl);
  if (body.data.cacheGcDays !== undefined) setSetting('cache_gc_days', String(body.data.cacheGcDays));
  recordActivity({ actor: 'owner', action: 'settings.update', detail: Object.keys(body.data).join(', ') });
  res.json({ ok: true });
});

platformRouter.post('/notifications/test', requireOwner, async (req: AuthedRequest, res) => {
  const url = typeof req.body?.url === 'string' && req.body.url ? req.body.url : getSetting('default_webhook_url') || '';
  if (!url) {
    res.status(400).json({ error: { code: 'bad_request', message: 'No webhook URL configured' } });
    return;
  }
  try {
    await notifyEvent({ id: 'test', name: 'EplyD platform', webhook_url: url }, 'deploy', 'This is a test notification from your EplyD dashboard.');
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

// ---------- sessions (owner) ----------

platformRouter.get('/sessions', requireOwner, (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare('SELECT id, kind, key_id, created_at, last_seen_at, expires_at FROM sessions ORDER BY last_seen_at DESC LIMIT 200')
    .all() as { id: string; kind: string; key_id: string | null; created_at: number; last_seen_at: number; expires_at: number }[];
  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      keyId: r.key_id,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
      current: r.id === req.actor!.sessionId
    }))
  });
});

platformRouter.delete('/sessions/:id', requireOwner, (req, res) => {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- GitHub auto-update webhook ----------

platformRouter.post(
  '/hooks/github',
  raw({ type: () => true, limit: 1024 * 1024 }),
  (req, res) => {
    if (!config.githubWebhookSecret) {
      res.status(503).json({ error: { code: 'not_configured', message: 'GITHUB_WEBHOOK_SECRET is not set' } });
      return;
    }
    const sig = req.headers['x-hub-signature-256'];
    const expected = 'sha256=' + hmacSha256hex(config.githubWebhookSecret, req.body as Buffer);
    if (typeof sig !== 'string' || !timingSafeEqualStr(sig, expected)) {
      res.status(401).json({ error: { code: 'invalid_signature', message: 'HMAC verification failed' } });
      return;
    }
    // Run the update script detached; output goes to DATA_DIR/update.log
    const log = fs.openSync(path.join(config.dirs.data, 'update.log'), 'a');
    const script = path.resolve(process.cwd(), 'scripts', 'update.sh');
    if (!fs.existsSync(script)) {
      res.status(500).json({ error: { code: 'missing_script', message: 'scripts/update.sh not found' } });
      return;
    }
    const child = spawn('bash', [script], { detached: true, stdio: ['ignore', log, log] });
    child.unref();
    fs.closeSync(log);
    recordActivity({ actor: 'system', action: 'platform.update_hook', detail: 'GitHub webhook triggered update.sh' });
    logger.info('github webhook accepted — update.sh spawned');
    res.status(202).json({ ok: true, message: 'update started' });
  }
);
