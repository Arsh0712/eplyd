import { Router } from 'express';
import { z } from 'zod';
import { getDb, getSetting } from '../db';
import { aesDecrypt, aesEncrypt, generateGuestKey, randomId, sha256hex } from '../lib/crypto';
import { config } from '../config';
import { recordActivity } from '../activity';
import { requireOwner } from '../auth/middleware';
import type { AuthedRequest } from '../auth/middleware';
import { revokeSessionsForKey } from '../auth/session';

interface KeyRow {
  id: string;
  label: string;
  value_hash: string;
  value_enc: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export const keysRouter = Router();
keysRouter.use(requireOwner);

function maskKey(prefix: string): string {
  // e.g. ep_a····7Qx  — enough to identify, useless to replay.
  const p = prefix.slice(0, 4);
  return `${p}······`;
}

keysRouter.get('/', (_req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM keys ORDER BY created_at DESC')
    .all() as KeyRow[];
  const sessionCount = getDb()
    .prepare('SELECT key_id, COUNT(*) AS c FROM sessions WHERE key_id IS NOT NULL GROUP BY key_id')
    .all() as { key_id: string; c: number }[];
  const countBy = new Map(sessionCount.map((s) => [s.key_id, s.c]));
  const ownerLastUsed = getSetting('owner_last_login');
  res.json({
    keys: rows.map((r) => ({
      id: r.id,
      label: r.label,
      masked: maskKey(r.prefix),
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
      activeSessions: countBy.get(r.id) ?? 0
    })),
    activeCount: rows.filter((r) => !r.revoked_at).length,
    ownerLastUsedAt: ownerLastUsed ? parseInt(ownerLastUsed, 10) : null
  });
});

const createSchema = z.object({ label: z.string().trim().min(1).max(64) });

keysRouter.post('/', (req: AuthedRequest, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'label is required (1-64 chars)' } });
    return;
  }
  const key = generateGuestKey();
  const id = randomId();
  const prefix = key.slice(0, 8);
  getDb()
    .prepare('INSERT INTO keys (id, label, value_hash, value_enc, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, body.data.label, sha256hex(key), aesEncrypt(key, config.encryptionKey), prefix, Date.now());
  recordActivity({ actor: 'owner', action: 'key.create', detail: `guest key "${body.data.label}" created` });
  // The full key is returned exactly once — it can be revealed later via /reveal.
  res.status(201).json({ id, label: body.data.label, key });
});

keysRouter.post('/:id/reveal', (req: AuthedRequest, res) => {
  const row = getDb().prepare('SELECT * FROM keys WHERE id = ? AND revoked_at IS NULL').get(req.params.id) as KeyRow | undefined;
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Key not found' } });
    return;
  }
  try {
    const key = aesDecrypt(row.value_enc, config.encryptionKey);
    recordActivity({ actor: 'owner', action: 'key.reveal', detail: `guest key "${row.label}" revealed` });
    res.json({ key });
  } catch {
    res.status(500).json({ error: { code: 'decrypt_failed', message: 'ENCRYPTION_KEY mismatch — cannot decrypt this key' } });
  }
});

const renameSchema = z.object({ label: z.string().trim().min(1).max(64) });

keysRouter.patch('/:id', (req: AuthedRequest, res) => {
  const body = renameSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'label is required' } });
    return;
  }
  const row = getDb().prepare('SELECT id, label FROM keys WHERE id = ?').get(req.params.id) as KeyRow | undefined;
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Key not found' } });
    return;
  }
  getDb().prepare('UPDATE keys SET label = ? WHERE id = ?').run(body.data.label, row.id);
  recordActivity({ actor: 'owner', action: 'key.rename', detail: `"${row.label}" renamed to "${body.data.label}"` });
  res.json({ ok: true });
});

keysRouter.delete('/:id', (req: AuthedRequest, res) => {
  const row = getDb().prepare('SELECT id, label FROM keys WHERE id = ? AND revoked_at IS NULL').get(req.params.id) as KeyRow | undefined;
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Key not found or already revoked' } });
    return;
  }
  getDb().prepare('UPDATE keys SET revoked_at = ? WHERE id = ?').run(Date.now(), row.id);
  revokeSessionsForKey(row.id);
  recordActivity({ actor: 'owner', action: 'key.revoke', detail: `guest key "${row.label}" revoked` });
  res.json({ ok: true });
});
