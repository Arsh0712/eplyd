import { Router } from 'express';
import { z } from 'zod';
import { getDb, getSetting, setSetting } from '../db';
import { hashSecret, verifySecret, sha256hex } from '../lib/crypto';
import { logger } from '../lib/log';
import { clientIp, RateLimiter } from '../lib/ratelimit';
import { recordActivity } from '../activity';
import {
  actorFromRequest,
  clearAuthCookies,
  createSession,
  destroySession,
  setAuthCookies
} from './session';
import type { AuthedRequest } from './middleware';
import { config } from '../config';

const loginSchema = z.object({
  password: z.string().min(1).max(512),
  remember: z.boolean().optional()
});

const loginLimiter = new RateLimiter(5, 60_000, 60_000);

/**
 * Ensure the owner hash exists and matches the current ADMIN_PASSWORD env
 * value. Runs at boot and lazily on first login. The plaintext is never
 * stored, logged or returned.
 */
export async function ensureOwnerHash(): Promise<void> {
  if (!config.adminPassword) {
    logger.warn('ADMIN_PASSWORD is not set — owner login is disabled until it is configured');
    return;
  }
  const existing = getSetting('owner_hash');
  if (existing && (await verifySecret(existing, config.adminPassword))) return;
  const hash = await hashSecret(config.adminPassword);
  setSetting('owner_hash', hash);
  logger.info(existing ? 'ADMIN_PASSWORD changed — owner hash re-hashed' : 'owner hash created');
}

export const authRouter = Router();

authRouter.post('/login', (req: AuthedRequest, res, next) => {
  Promise.resolve(handleLogin(req, res)).catch(next);
});

async function handleLogin(req: AuthedRequest, res: import('express').Response): Promise<void> {
  const ip = clientIp(req);
  const rl = loginLimiter.take(ip);
  if (!rl.ok) {
    res.status(429).json({
      error: { code: 'rate_limited', message: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterMs / 1000)}s.` }
    });
    return;
  }

  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: { code: 'bad_request', message: 'password is required' } });
    return;
  }
  const password = body.data.password;
  const remember = body.data.remember === true;

  // 1) Owner password (argon2id, constant-time verification).
  const ownerHash = getSetting('owner_hash');
  if (ownerHash && (await verifySecret(ownerHash, password))) {
    const { token } = createSession('owner', null, remember);
    setAuthCookies(res, token, remember);
    loginLimiter.reset(ip);
    recordActivity({ actor: 'owner', action: 'auth.login', detail: 'owner signed in' });
    res.json({ ok: true, role: 'owner' });
    return;
  }

  // 2) Guest access key (hashed lookup).
  const keyRow = getDb()
    .prepare('SELECT id, label FROM keys WHERE value_hash = ? AND revoked_at IS NULL')
    .get(sha256hex(password)) as { id: string; label: string } | undefined;
  if (keyRow) {
    const { token } = createSession('guest', keyRow.id, remember);
    getDb().prepare('UPDATE keys SET last_used_at = ? WHERE id = ?').run(Date.now(), keyRow.id);
    setAuthCookies(res, token, remember);
    loginLimiter.reset(ip);
    recordActivity({ actor: `guest:${keyRow.id}`, action: 'auth.login', detail: `guest key "${keyRow.label}" signed in` });
    res.json({ ok: true, role: 'guest', keyLabel: keyRow.label });
    return;
  }

  recordActivity({ actor: 'anonymous', action: 'auth.login_failed', detail: `ip ${ip}` });
  res.status(401).json({ error: { code: 'invalid_credentials', message: 'Invalid access key or password' } });
}

authRouter.post('/logout', (req: AuthedRequest, res) => {
  const actor = actorFromRequest(req);
  if (actor) destroySession(actor.sessionId);
  clearAuthCookies(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req: AuthedRequest, res) => {
  const actor = actorFromRequest(req);
  if (!actor) {
    res.json({ authenticated: false });
    return;
  }
  res.json({
    authenticated: true,
    role: actor.kind,
    keyId: actor.keyId,
    keyLabel: actor.keyLabel
  });
});
