import crypto from 'node:crypto';
import argon2 from 'argon2';

/** Argon2id hash for passwords / access keys. */
export async function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}

/** Constant-time verification; never throws on malformed hashes. */
export async function verifySecret(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function sha256hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Opaque URL-safe session token. */
export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** ≥32-char guest access key. */
export function generateGuestKey(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'ep_';
  const rnd = crypto.randomBytes(40);
  for (let i = 0; i < 40; i++) out += alphabet[rnd[i]! % alphabet.length];
  return out;
}

export function randomId(): string {
  return crypto.randomBytes(9).toString('base64url');
}

function keyBytes(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/** AES-256-GCM encryption. Output: base64(iv(12) | authTag(16) | ciphertext). */
export function aesEncrypt(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function aesDecrypt(payload: string, secret: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < 29) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Length-independent string comparison. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still burn comparable time to avoid a trivial length oracle.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** HMAC-SHA256 hex signature for webhook verification. */
export function hmacSha256hex(secret: string, body: Buffer): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
