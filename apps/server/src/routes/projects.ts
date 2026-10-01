import { Router, raw } from 'express';
import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { getDb } from '../db';
import { config } from '../config';
import { randomId } from '../lib/crypto';
import { projectDir } from '../lib/projdir';
import { extractZipSafely } from '../lib/zip';
import { recordActivity, listActivity } from '../activity';
import { loadProject } from '../lib/guard';
import { requireAuth } from '../auth/middleware';
import type { AuthedRequest } from '../auth/middleware';
import { getManager, BusyError } from '../supervisor/manager';
import { getLogStore } from '../lib/ringbuffer';
import { writeTemplate, type TemplateKind } from '../lib/templates';
import { notifyEvent } from '../supervisor/notify';
import { cronManager } from '../supervisor/cron';
import { logger } from '../lib/log';

const execFileAsync = promisify(execFile);

/** Wrap async route handlers so rejections reach the error handler (Express 4 does not). */
const aw = (fn: (req: AuthedRequest, res: import('express').Response) => Promise<unknown> | unknown) =>
  (req: AuthedRequest, res: import('express').Response, next: import('express').NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  color: string;
  runtime: string;
  start_command: string;
  install_command: string;
  build_command: string;
  java_version: string;
  restart_policy: 'never' | 'on-failure' | 'always';
  max_restarts: number;
  autostart: number;
  cron_restart: string;
  cpu_limit: number;
  ram_limit_mb: number;
  webhook_url: string;
  git_url: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  last_deploy_at: number | null;
}

function actorOf(req: AuthedRequest): string {
  return req.actor!.kind === 'owner' ? 'owner' : `guest:${req.actor!.keyId}`;
}

function withSnapshot(row: ProjectRow): Record<string, unknown> {
  const mgr = getManager();
  let snap: Record<string, unknown> = { status: 'stopped' };
  try {
    snap = mgr.snapshot(row.id) as unknown as Record<string, unknown>;
  } catch { /* not loaded yet */ }
  const envAgg = getDb()
    .prepare('SELECT MAX(updated_at) AS u, COUNT(*) AS c FROM env_vars WHERE project_id = ?')
    .get(row.id) as { u: number | null; c: number };
  return { ...row, proc: snap, envCount: envAgg.c, envUpdatedAt: envAgg.u };
}

// ---------- list + create ----------

projectsRouter.get('/', (req: AuthedRequest, res) => {
  const actor = req.actor!;
  const rows =
    actor.kind === 'owner'
      ? (getDb().prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as unknown as ProjectRow[])
      : (getDb()
          .prepare('SELECT * FROM projects WHERE created_by = ? ORDER BY created_at DESC')
          .all(actor.keyId!) as unknown as ProjectRow[]);
  res.json({ projects: rows.map(withSnapshot) });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(300).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  template: z.enum(['empty', 'discordpy', 'discordjs']).optional(),
  gitUrl: z.string().trim().url().max(500).optional(),
  gitToken: z.string().trim().max(200).optional()
});

projectsRouter.post('/', aw(async (req: AuthedRequest, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'name is required' } });
    return;
  }
  const actor = req.actor!;
  const id = randomId();
  const now = Date.now();
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.eplyd', 'tmp'), { recursive: true });
  if (body.data.template) writeTemplate(dir, body.data.template);

  getDb()
    .prepare(
      `INSERT INTO projects (id, name, description, color, created_by, created_at, updated_at, git_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, body.data.name, body.data.description ?? '', body.data.color ?? '#3DDC97', actor.kind === 'owner' ? 'owner' : actor.keyId!, now, now, body.data.gitUrl ?? '');

  recordActivity({ project_id: id, actor: actorOf(req), action: 'project.create', detail: body.data.template ? `from ${body.data.template} template` : 'empty project' });

  // Optional Git import (clone-on-create).
  let gitWarning: string | undefined;
  if (body.data.gitUrl) {
    let url = body.data.gitUrl;
    if (body.data.gitToken) {
      url = url.replace(/^https:\/\//i, `https://x-access-token:${encodeURIComponent(body.data.gitToken)}@`);
    }
    try {
      await execFileAsync('git', ['clone', '--depth', '1', url, '.'], {
        cwd: dir,
        timeout: 180_000,
        env: { PATH: process.env.PATH || '', HOME: dir, GIT_TERMINAL_PROMPT: '0' }
      });
      recordActivity({ project_id: id, actor: actorOf(req), action: 'project.git_import', detail: body.data.gitUrl });
    } catch (err) {
      gitWarning = err instanceof Error ? err.message.slice(0, 300) : 'git clone failed';
      logger.warn({ err, id }, 'git clone on create failed');
    }
  }

  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow;
  res.status(201).json({ project: withSnapshot(row), gitWarning });
}));

// ---------- bulk actions ----------

const bulkSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
  ids: z.array(z.string()).min(1).max(500)
});

projectsRouter.post('/bulk', aw(async (req: AuthedRequest, res) => {
  const body = bulkSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'action and ids required' } });
    return;
  }
  const mgr = getManager();
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of body.data.ids) {
    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!row || (req.actor!.kind !== 'owner' && row.created_by !== req.actor!.keyId)) {
      results.push({ id, ok: false, error: 'not accessible' });
      continue;
    }
    try {
      if (body.data.action === 'start') await mgr.start(id, { actor: actorOf(req) });
      else if (body.data.action === 'stop') await mgr.stop(id);
      else await mgr.restart(id, { actor: actorOf(req) });
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : 'failed' });
    }
  }
  res.json({ results });
}));

// ---------- single project ----------

projectsRouter.get('/:id', loadProject, (req: AuthedRequest, res) => {
  res.json({ project: withSnapshot(req.project as unknown as ProjectRow) });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().max(300).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  runtime: z.enum(['auto', 'node', 'python', 'java', 'custom']).optional(),
  start_command: z.string().max(500).optional(),
  install_command: z.string().max(500).optional(),
  build_command: z.string().max(500).optional(),
  java_version: z.enum(['17', '21']).optional(),
  restart_policy: z.enum(['never', 'on-failure', 'always']).optional(),
  max_restarts: z.coerce.number().int().min(0).max(1000).optional(),
  autostart: z.boolean().optional(),
  cron_restart: z.string().max(100).optional(),
  cpu_limit: z.coerce.number().min(0).max(100).optional(),
  ram_limit_mb: z.coerce.number().int().min(0).max(96000).optional(),
  webhook_url: z.string().trim().max(500).optional(),
  git_url: z.string().trim().max(500).optional()
});

projectsRouter.patch('/:id', loadProject, (req: AuthedRequest, res) => {
  const body = patchSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'invalid fields', details: body.error.flatten().fieldErrors } });
    return;
  }
  const fields = body.data;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(k === 'autostart' ? (v ? 1 : 0) : v);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    vals.push(Date.now(), req.params.id);
    getDb().prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  if (fields.cron_restart !== undefined) {
    cronManager.reschedule(req.params.id, fields.cron_restart);
  }
  recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'project.update', detail: Object.keys(fields).join(', ') });
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as unknown as ProjectRow;
  res.json({ project: withSnapshot(row) });
});

projectsRouter.delete('/:id', loadProject, aw(async (req: AuthedRequest, res) => {
  const mgr = getManager();
  const snap = mgr.snapshot(req.params.id);
  if (['running', 'starting', 'installing', 'building', 'checking_deps', 'queued', 'stopping'].includes(snap.status)) {
    res.status(409).json({ error: { code: 'conflict', message: `Stop the project before deleting (current: ${snap.status})` } });
    return;
  }
  const name = (req.project as unknown as ProjectRow).name;
  try {
    fs.rmSync(projectDir(req.params.id), { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err }, 'project dir removal failed');
  }
  getDb().prepare('DELETE FROM env_vars WHERE project_id = ?').run(req.params.id);
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  cronManager.remove(req.params.id);
  recordActivity({ actor: actorOf(req), action: 'project.delete', detail: `deleted project "${name}"` });
  res.json({ ok: true });
}));

// ---------- ZIP upload / download ----------

projectsRouter.post(
  '/:id/upload-zip',
  loadProject,
  raw({ type: () => true, limit: config.maxUploadMb * 1024 * 1024 }),
  aw(async (req: AuthedRequest, res) => {
    const buf = req.body as Buffer;
    if (!buf || buf.length === 0) {
      res.status(400).json({ error: { code: 'bad_request', message: 'ZIP body is empty' } });
      return;
    }
    const mode = req.query.mode === 'merge' ? 'merge' : 'replace';
    const dir = projectDir(req.params.id);
    const staging = path.join(config.dirs.data, 'tmp', `zip-${randomId()}`);

    let result;
    try {
      fs.mkdirSync(staging, { recursive: true });
      result = extractZipSafely(buf, staging);
      if (result.files === 0) throw new Error('ZIP contained no usable files');
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      res.status(400).json({ error: { code: 'bad_zip', message: err instanceof Error ? err.message : 'ZIP extraction failed' } });
      return;
    }

    // Platform-owned bookkeeping never comes from an uploaded ZIP.
    fs.rmSync(path.join(staging, '.eplyd'), { recursive: true, force: true });
    result.files = countFiles(staging);

    try {
      if (mode === 'replace') {
        // Remove everything except .eplyd bookkeeping, then move files in.
        for (const entry of fs.readdirSync(dir)) {
          if (entry === '.eplyd') continue;
          fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        }
        try {
          fs.rmSync(path.join(dir, '.eplyd', 'deps.stamp'), { force: true });
        } catch { /* ignore */ }
      }
      for (const entry of fs.readdirSync(staging)) {
        const target = path.join(dir, entry);
        // Overwrite same-named entries in both modes; never rename onto an existing dir.
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(path.join(staging, entry), target);
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }

    const now = Date.now();
    getDb().prepare('UPDATE projects SET last_deploy_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);
    const detail = `${result.files} files, ${Math.round(result.bytes / 1024)} KiB${result.strippedRoot ? `, stripped root "${result.strippedRoot}"` : ''}`;
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'deploy.upload', detail: `${mode}: ${detail}` });
    void notifyEvent(req.project as unknown as ProjectRow, 'deploy', `ZIP upload (${mode}) — ${detail}`);
    res.json({ ok: true, files: result.files, bytes: result.bytes, strippedRoot: result.strippedRoot, skipped: result.skipped, mode });
  })
);

function countFiles(root: string, depth = 0): number {
  if (depth > 20) return 0;
  let n = 0;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(root, e.name), depth + 1);
    else n += 1;
  }
  return n;
}

projectsRouter.post('/:id/wipe-files', loadProject, (req: AuthedRequest, res) => {
  const dir = projectDir(req.params.id);
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === '.eplyd') continue;
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
      count += 1;
    }
    try {
      fs.rmSync(path.join(dir, '.eplyd', 'deps.stamp'), { force: true });
    } catch { /* ignore */ }
  } catch (err) {
    res.status(500).json({ error: { code: 'wipe_failed', message: err instanceof Error ? err.message : 'wipe failed' } });
    return;
  }
  recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'project.wipe_files', detail: `${count} top-level entries removed` });
  res.json({ ok: true, removed: count });
});

projectsRouter.get('/:id/download', loadProject, (req: AuthedRequest, res) => {
  const dir = projectDir(req.params.id);
  const includeDeps = req.query.deps === '1';
  res.setHeader('content-type', 'application/zip');
  res.setHeader('content-disposition', `attachment; filename="${(req.project as unknown as ProjectRow).name.replace(/[^a-zA-Z0-9_-]+/g, '_')}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => res.destroy());
  archive.pipe(res);
  const skip = includeDeps ? [] : ['node_modules', '.git', '.eplyd/tmp', '__pycache__', 'venv'];
  for (const entry of fs.readdirSync(dir)) {
    if (skip.includes(entry)) continue;
    const p = path.join(dir, entry);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    fs.statSync(p).isDirectory() ? archive.directory(p, entry) : archive.file(p, { name: entry });
  }
  void archive.finalize();
});

// ---------- lifecycle controls ----------

projectsRouter.post('/:id/start', loadProject, aw(async (req: AuthedRequest, res) => {
  try {
    await getManager().start(req.params.id, { actor: actorOf(req) });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BusyError) {
      res.status(409).json({ error: { code: 'conflict', message: err.message } });
      return;
    }
    res.status(400).json({ error: { code: 'start_failed', message: err instanceof Error ? err.message : 'start failed' } });
  }
}));

projectsRouter.post('/:id/stop', loadProject, aw(async (req: AuthedRequest, res) => {
  try {
    await getManager().stop(req.params.id, { reason: 'stopped via dashboard' });
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'proc.stop_manual', detail: 'stop requested' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: { code: 'stop_failed', message: err instanceof Error ? err.message : 'stop failed' } });
  }
}));

projectsRouter.post('/:id/restart', loadProject, aw(async (req: AuthedRequest, res) => {
  try {
    await getManager().restart(req.params.id, { actor: actorOf(req), reason: 'restarted via dashboard' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BusyError) {
      res.status(409).json({ error: { code: 'conflict', message: err.message } });
      return;
    }
    res.status(400).json({ error: { code: 'restart_failed', message: err instanceof Error ? err.message : 'restart failed' } });
  }
}));

projectsRouter.post('/:id/kill', loadProject, aw(async (req: AuthedRequest, res) => {
  await getManager().kill(req.params.id);
  recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'proc.kill', detail: 'SIGKILL requested' });
  res.json({ ok: true });
}));

projectsRouter.post('/:id/install', loadProject, aw(async (req: AuthedRequest, res) => {
  try {
    await getManager().installOnly(req.params.id, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BusyError) {
      res.status(409).json({ error: { code: 'conflict', message: err.message } });
      return;
    }
    res.status(400).json({ error: { code: 'install_failed', message: err instanceof Error ? err.message : 'install failed' } });
  }
}));

projectsRouter.post('/:id/git-pull', loadProject, aw(async (req: AuthedRequest, res) => {
  const row = req.project as unknown as ProjectRow;
  const url = typeof req.body?.url === 'string' && req.body.url ? req.body.url : row.git_url;
  if (!url) {
    res.status(400).json({ error: { code: 'bad_request', message: 'No git URL configured for this project' } });
    return;
  }
  const dir = projectDir(req.params.id);
  try {
    getManager().logLine(req.params.id, 'sys', `$ git pull (from remote)`);
    const { stdout, stderr } = await execFileAsync('git', ['pull', '--ff-only'], {
      cwd: dir,
      timeout: 180_000,
      env: { PATH: process.env.PATH || '', HOME: dir, GIT_TERMINAL_PROMPT: '0' }
    });
    getManager().logLine(req.params.id, 'out', `${stdout}${stderr}`);
    getDb().prepare('UPDATE projects SET last_deploy_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), req.params.id);
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'deploy.git_pull', detail: stdout.trim().slice(0, 200) });
    res.json({ ok: true, output: `${stdout}${stderr}`.slice(0, 4000) });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    getManager().logLine(req.params.id, 'err', `git pull failed: ${e.stderr || e.message}`);
    res.status(400).json({ error: { code: 'git_failed', message: (e.stderr || e.message || 'git pull failed').slice(0, 500) } });
  }
}));

// ---------- logs ----------

projectsRouter.get('/:id/logs', loadProject, (req: AuthedRequest, res) => {
  const n = Math.min(parseInt(String(req.query.n) || '500', 10) || 500, 5000);
  res.json({ lines: getLogStore(req.params.id, config.dirs.logs, config.logMaxBytes).tailLines(n) });
});

projectsRouter.get('/:id/logs/download', loadProject, (req: AuthedRequest, res) => {
  const store = getLogStore(req.params.id, config.dirs.logs, config.logMaxBytes);
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${req.params.id}-log.txt"`);
  try {
    res.send(fs.readFileSync(store.file));
  } catch {
    res.send('');
  }
});

projectsRouter.delete('/:id/logs', loadProject, (req: AuthedRequest, res) => {
  getLogStore(req.params.id, config.dirs.logs, config.logMaxBytes).clear();
  recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'logs.clear', detail: 'logs cleared' });
  res.json({ ok: true });
});

// ---------- activity ----------

projectsRouter.get('/:id/activity', loadProject, (req: AuthedRequest, res) => {
  const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
  res.json({ activity: listActivity({ projectId: req.params.id, before, limit: 100 }) });
});
