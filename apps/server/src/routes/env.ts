import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { config } from '../config';
import { aesDecrypt, aesEncrypt } from '../lib/crypto';
import { recordActivity } from '../activity';
import { loadProject } from '../lib/guard';
import type { AuthedRequest } from '../auth/middleware';

export const envRouter = Router({ mergeParams: true });
envRouter.use(loadProject);

const KEY_RX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

/**
 * Heuristic secret detection: any variable whose name suggests it carries a
 * credential (tokens, secrets, passwords, keys, DSNs, private material).
 * Used to auto-flag rows in the UI and to mask values.
 */
export function isSecretKey(key: string): boolean {
  return /token|secret|password|passwd|\bpass\b|api[_-]?key|auth|credential|private[_-]?key|dsn|uri|url|webhook/i.test(key);
}

/**
 * Loose Discord bot token shape check: `<id>.<timestamp>.<hmac>`.
 * Used for a friendly validity hint — the platform never validates against
 * the Discord API (that is the bot's job at runtime).
 */
export function discordTokenShape(value: string): boolean {
  const parts = value.trim().split('.');
  return (
    parts.length === 3 &&
    /^[A-Za-z0-9_-]{16,}$/.test(parts[0]!) &&
    /^[A-Za-z0-9_-]{6,}$/.test(parts[1]!) &&
    /^[A-Za-z0-9_-]{26,}$/.test(parts[2]!)
  );
}

function actorOf(req: AuthedRequest): string {
  return req.actor!.kind === 'owner' ? 'owner' : `guest:${req.actor!.keyId}`;
}

interface EnvRow {
  key: string;
  value_enc: string;
  updated_at: number;
}

/** GET /env?reveal=1 — list variables (masked unless explicitly revealed). */
envRouter.get('/', (req: AuthedRequest, res) => {
  const reveal = req.query.reveal === '1';
  const rows = getDb()
    .prepare('SELECT key, value_enc, updated_at FROM env_vars WHERE project_id = ? ORDER BY key')
    .all(req.params.id) as EnvRow[];
  const out = rows.map((r) => {
    let value = MASK;
    if (reveal) {
      try {
        value = aesDecrypt(r.value_enc, config.encryptionKey);
      } catch {
        value = '[decryption failed]';
      }
    }
    return {
      key: r.key,
      value,
      masked: !reveal,
      updatedAt: r.updated_at,
      isToken: /token/i.test(r.key),
      secret: isSecretKey(r.key),
      discordTokenValid: reveal && /discord[\w-]*token|^DISCORD_TOKEN$/i.test(r.key) ? discordTokenShape(value) : undefined
    };
  });
  res.json({ vars: out });
});

const putSchema = z.object({
  set: z.record(z.string().max(10000)).optional(),
  delete: z.array(z.string()).optional()
});

envRouter.put('/', (req: AuthedRequest, res) => {
  const body = putSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'invalid payload' } });
    return;
  }
  const db = getDb();
  const now = Date.now();
  const changed: string[] = [];
  for (const [k, v] of Object.entries(body.data.set ?? {})) {
    if (!KEY_RX.test(k)) {
      res.status(400).json({ error: { code: 'bad_key', message: `Invalid variable name: ${k}` } });
      return;
    }
    if (v === null || v === undefined) continue;
    db.prepare(
      'INSERT INTO env_vars (project_id, key, value_enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at'
    ).run(req.params.id, k, aesEncrypt(String(v), config.encryptionKey), now);
    changed.push(k);
  }
  for (const k of body.data.delete ?? []) {
    if (!KEY_RX.test(k)) continue;
    db.prepare('DELETE FROM env_vars WHERE project_id = ? AND key = ?').run(req.params.id, k);
    changed.push(`-${k}`);
  }
  recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'env.update', detail: changed.join(', ').slice(0, 300) });
  res.json({ ok: true, changed });
});

/** POST /env/import — bulk paste in .env format. mode=replace syncs the full set. */
const importSchema = z.object({
  text: z.string().min(1).max(100_000),
  mode: z.enum(['merge', 'replace']).default('merge')
});

envRouter.post('/import', (req: AuthedRequest, res) => {
  const body = importSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'text required' } });
    return;
  }
  const parsed = parseDotenv(body.data.text);
  if (Object.keys(parsed).length === 0) {
    res.status(400).json({ error: { code: 'bad_request', message: 'No KEY=VALUE pairs found' } });
    return;
  }
  const db = getDb();
  const now = Date.now();
  let count = 0;
  for (const [k, v] of Object.entries(parsed)) {
    if (!KEY_RX.test(k)) continue;
    db.prepare(
      'INSERT INTO env_vars (project_id, key, value_enc, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at'
    ).run(req.params.id, k, aesEncrypt(v, config.encryptionKey), now);
    count += 1;
  }
  let removed = 0;
  if (body.data.mode === 'replace') {
    const existing = getDb().prepare('SELECT key FROM env_vars WHERE project_id = ?').all(req.params.id) as { key: string }[];
    for (const { key } of existing) {
      if (!(key in parsed)) {
        db.prepare('DELETE FROM env_vars WHERE project_id = ? AND key = ?').run(req.params.id, key);
        removed += 1;
      }
    }
  }
  const secrets = Object.keys(parsed).filter(isSecretKey).length;
  recordActivity({ project_id: req.params.id, actor: actorOf(req), action: 'env.import', detail: `${count} variables${removed ? `, ${removed} removed` : ''} (${secrets} auto-flagged as secret)` });
  res.json({ ok: true, count, removed, secrets, keys: Object.keys(parsed) });
});

/** GET /env/raw — the full .env as plain text (for the raw editor). */
envRouter.get('/raw', (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare('SELECT key, value_enc FROM env_vars WHERE project_id = ? ORDER BY key')
    .all(req.params.id) as EnvRow[];
  const lines: string[] = [];
  for (const r of rows) {
    try {
      const v = aesDecrypt(r.value_enc, config.encryptionKey);
      lines.push(`${r.key}=${v.includes('\n') ? JSON.stringify(v) : v}`);
    } catch {
      lines.push(`# ${r.key}=[decryption failed]`);
    }
  }
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.send(lines.length ? lines.join('\n') + '\n' : '');
});

/** GET /env/export — download as .env (decrypted). */
envRouter.get('/export', (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare('SELECT key, value_enc FROM env_vars WHERE project_id = ? ORDER BY key')
    .all(req.params.id) as EnvRow[];
  const lines: string[] = ['# exported by EplyD'];
  for (const r of rows) {
    try {
      const v = aesDecrypt(r.value_enc, config.encryptionKey);
      lines.push(`${r.key}=${v.includes('\n') ? JSON.stringify(v) : v}`);
    } catch {
      lines.push(`# ${r.key}=[decryption failed]`);
    }
  }
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename=".env"');
  res.send(lines.join('\n') + '\n');
});

/** Minimal .env parser: supports comments, `export`, quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2] ?? '';
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[m[1]!] = value;
  }
  return out;
}
