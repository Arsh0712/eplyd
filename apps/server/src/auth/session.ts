import type { Request, Response } from 'express';
import { getDb } from '../db';
import { sha256hex, randomToken } from '../lib/crypto';
import { config } from '../config';

export const SESSION_COOKIE = 'eplyd_session';
export const CSRF_COOKIE = 'eplyd_csrf';

export interface Actor {
  sessionId: string;
  kind: 'owner' | 'guest';
  keyId?: string;
  keyLabel?: string;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  kind: 'owner' | 'guest';
  key_id: string | null;
  expires_at: number;
  created_at: number;
  last_seen_at: number;
}

export function cookieSecure(): boolean {
  return config.publicUrl.startsWith('https://');
}

export function createSession(kind: 'owner' | 'guest', keyId: string | null, remember: boolean): { token: string; session: SessionRow } {
  const token = randomToken(48);
  const now = Date.now();
  const ttl = remember ? config.rememberTtlMs : config.sessionTtlMs;
  const row: SessionRow = {
    id: sha256hex(token).slice(0, 16),
    token_hash: sha256hex(token),
    kind,
    key_id: keyId,
    expires_at: now + ttl,
    created_at: now,
    last_seen_at: now
  };
  getDb()
    .prepare('INSERT INTO sessions (id, token_hash, kind, key_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.token_hash, row.kind, row.key_id, row.expires_at, row.created_at, row.last_seen_at);
  return { token, session: row };
}

export function setAuthCookies(res: Response, token: string, remember: boolean): void {
  const maxAge = remember ? config.rememberTtlMs : config.sessionTtlMs;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge
  });
  // Double-submit CSRF token: readable by the SPA, echoed back in a header.
  res.cookie(CSRF_COOKIE, randomToken(16), {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

export function destroySession(sessionId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function revokeSessionsForKey(keyId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE key_id = ?').run(keyId);
}

export function purgeExpiredSessions(): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

/** Resolve the actor from the session cookie. Returns null when unauthenticated. */
export function actorFromRequest(req: Request): Actor | null {
  const token = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
  if (!token || typeof token !== 'string') return null;
  const hash = sha256hex(token);
  const row = getDb().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    destroySession(row.id);
    return null;
  }
  // Throttled touch of last_seen_at.
  if (now - row.last_seen_at > 60_000) {
    getDb().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, row.id);
    if (row.kind === 'owner') {
      getDb().prepare("UPDATE settings SET v = ? WHERE k = 'owner_last_login'").run(String(now));
    }
  }
  let keyLabel: string | undefined;
  if (row.kind === 'guest' && row.key_id) {
    const key = getDb().prepare('SELECT label, revoked_at FROM keys WHERE id = ?').get(row.key_id) as { label: string; revoked_at: number | null } | undefined;
    if (!key || key.revoked_at) {
      // Key was revoked — session dies with it.
      destroySession(row.id);
      return null;
    }
    keyLabel = key.label;
  }
  return { sessionId: row.id, kind: row.kind, keyId: row.key_id ?? undefined, keyLabel };
}
