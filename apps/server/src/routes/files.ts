import { Router, raw } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { recordActivity } from '../activity';
import { loadProject } from '../lib/guard';
import { projectDir } from '../lib/projdir';
import type { AuthedRequest } from '../auth/middleware';
import { safeResolve, assertRealInsideRoot, PathError } from '../lib/paths';

export const filesRouter = Router({ mergeParams: true });
filesRouter.use(loadProject);

const DEPS_DIRS = new Set(['node_modules', 'venv', '.git', '__pycache__', '.eplyd/tmp']);

function actorOf(req: AuthedRequest): string {
  return req.actor!.kind === 'owner' ? 'owner' : `guest:${req.actor!.keyId}`;
}

function resolveTarget(req: AuthedRequest, rel: string): string {
  const root = projectRoot(req);
  const target = safeResolve(root, rel || '.');
  assertRealInsideRoot(root, target);
  return target;
}

function projectRoot(req: AuthedRequest): string {
  return projectDir(req.params.id);
}

function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
}

/** GET /files?path= — one-level directory listing. */
filesRouter.get('/', (req: AuthedRequest, res) => {
  const rel = String(req.query.path || '.');
  let target: string;
  try {
    target = resolveTarget(req, rel);
  } catch (err) {
    res.status(400).json({ error: { code: 'bad_path', message: err instanceof Error ? err.message : 'Invalid path' } });
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    res.status(400).json({ error: { code: 'bad_path', message: 'Cannot read directory' } });
    return;
  }
  const hideDeps = req.query.deps !== '1';
  const out = [];
  for (const e of entries) {
    if (hideDeps && DEPS_DIRS.has(e.name)) continue;
    const childRel = rel === '.' || rel === '' ? e.name : `${rel.replace(/\/+$/, '')}/${e.name}`;
    const abs = path.join(target, e.name);
    let size = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(abs);
      size = st.size;
      mtime = st.mtimeMs;
    } catch { /* broken symlink etc. */ }
    out.push({
      name: e.name,
      path: childRel,
      type: e.isDirectory() ? 'dir' : 'file',
      size,
      mtime,
      image: !e.isDirectory() && isImage(e.name)
    });
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  res.json({ path: rel === '.' ? '' : rel, entries: out });
});

/** GET /files/content?path= — text file content for the editor. */
filesRouter.get('/content', (req: AuthedRequest, res) => {
  const rel = String(req.query.path || '');
  if (!rel) {
    res.status(400).json({ error: { code: 'bad_request', message: 'path is required' } });
    return;
  }
  let target: string;
  try {
    target = resolveTarget(req, rel);
  } catch (err) {
    res.status(400).json({ error: { code: 'bad_path', message: err instanceof Error ? err.message : 'Invalid path' } });
    return;
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(target);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    res.status(404).json({ error: { code: 'not_found', message: 'File not found' } });
    return;
  }
  if (st.size > 2 * 1024 * 1024) {
    res.status(413).json({ error: { code: 'too_large', message: 'File exceeds the 2 MB editor limit — use the terminal instead' } });
    return;
  }
  const buf = fs.readFileSync(target);
  const isBinary = buf.subarray(0, 8000).includes(0);
  if (isBinary) {
    res.json({ binary: true, size: st.size, image: isImage(rel), path: rel });
    return;
  }
  res.json({ binary: false, content: buf.toString('utf8'), size: st.size, path: rel });
});

/** GET /files/raw?path= — serve the file as-is (image previews, downloads). */
filesRouter.get('/raw', (req: AuthedRequest, res) => {
  const rel = String(req.query.path || '');
  if (!rel) {
    res.status(400).json({ error: { code: 'bad_request', message: 'path is required' } });
    return;
  }
  let target: string;
  try {
    target = resolveTarget(req, rel);
  } catch (err) {
    res.status(400).json({ error: { code: 'bad_path', message: err instanceof Error ? err.message : 'Invalid path' } });
    return;
  }
  try {
    if (!fs.statSync(target).isFile()) throw new Error();
  } catch {
    res.status(404).json({ error: { code: 'not_found', message: 'File not found' } });
    return;
  }
  if (req.query.download === '1') {
    res.setHeader('content-disposition', `attachment; filename="${path.basename(target)}"`);
  }
  res.sendFile(target);
});

const writeSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string().max(3 * 1024 * 1024)
});

filesRouter.put('/content', (req: AuthedRequest, res) => {
  const body = writeSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'path and content required' } });
    return;
  }
  try {
    const target = resolveTarget(req, body.data.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body.data.content, { mode: 0o644 });
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'file.save', detail: body.data.path });
    res.json({ ok: true, size: Buffer.byteLength(body.data.content, 'utf8') });
  } catch (err) {
    if (err instanceof PathError) {
      res.status(400).json({ error: { code: 'bad_path', message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: 'write_failed', message: 'Could not save file' } });
  }
});

const mkdirSchema = z.object({ path: z.string().min(1).max(1000) });

filesRouter.post('/mkdir', (req: AuthedRequest, res) => {
  const body = mkdirSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'path required' } });
    return;
  }
  try {
    const target = resolveTarget(req, body.data.path);
    fs.mkdirSync(target, { recursive: true });
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'file.mkdir', detail: body.data.path });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: { code: 'bad_path', message: err instanceof Error ? err.message : 'mkdir failed' } });
  }
});

const moveSchema = z.object({
  from: z.string().min(1).max(1000),
  to: z.string().min(1).max(1000)
});

filesRouter.post('/move', (req: AuthedRequest, res) => {
  const body = moveSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'from and to required' } });
    return;
  }
  try {
    const from = resolveTarget(req, body.data.from);
    const to = resolveTarget(req, body.data.to);
    if (from === projectRoot(req)) throw new PathError('cannot move the project root');
    fs.renameSync(from, to);
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'file.move', detail: `${body.data.from} → ${body.data.to}` });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: { code: 'move_failed', message: err instanceof Error ? err.message : 'move failed' } });
  }
});

filesRouter.post('/copy', (req: AuthedRequest, res) => {
  const body = moveSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'from and to required' } });
    return;
  }
  try {
    const from = resolveTarget(req, body.data.from);
    const to = resolveTarget(req, body.data.to);
    fs.cpSync(from, to, { recursive: true });
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'file.copy', detail: `${body.data.from} → ${body.data.to}` });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: { code: 'copy_failed', message: err instanceof Error ? err.message : 'copy failed' } });
  }
});

filesRouter.delete('/', (req: AuthedRequest, res) => {
  const rel = String(req.query.path || '');
  if (!rel || rel === '.' || rel === '/') {
    res.status(400).json({ error: { code: 'bad_request', message: 'Refusing to delete the project root' } });
    return;
  }
  try {
    const target = resolveTarget(req, rel);
    if (target === projectRoot(req)) throw new PathError('refusing to delete project root');
    fs.rmSync(target, { recursive: true, force: true });
    recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'file.delete', detail: rel });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: { code: 'delete_failed', message: err instanceof Error ? err.message : 'delete failed' } });
  }
});

/** POST /files/upload?path=<dir>&name=<name> — raw single-file upload. */
filesRouter.post(
  '/upload',
  raw({ type: () => true, limit: 100 * 1024 * 1024 }),
  (req: AuthedRequest, res) => {
    const dirRel = String(req.query.path || '.');
    const name = String(req.query.name || '').replace(/[\\/]/g, '_');
    if (!name || name.startsWith('.')) {
      res.status(400).json({ error: { code: 'bad_request', message: 'name query param required' } });
      return;
    }
    try {
      const dirTarget = resolveTarget(req, dirRel);
      const target = safeResolve(dirTarget, name);
      assertRealInsideRoot(projectRoot(req), target);
      fs.writeFileSync(target, req.body as Buffer, { mode: 0o644 });
      recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'file.upload', detail: `${dirRel}/${name}` });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: { code: 'upload_failed', message: err instanceof Error ? err.message : 'upload failed' } });
    }
  }
);
