import { describe, it, expect } from 'vitest';
import { hashSecret, verifySecret, aesEncrypt, aesDecrypt, generateGuestKey, hmacSha256hex, timingSafeEqualStr } from '../lib/crypto';

describe('crypto', () => {
  it('argon2id hash + verify roundtrip and rejects wrong secrets', async () => {
    const hash = await hashSecret('@rsh0712');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifySecret(hash, '@rsh0712')).toBe(true);
    expect(await verifySecret(hash, 'wrong')).toBe(false);
    expect(await verifySecret('not-a-hash', 'x')).toBe(false);
  });

  it('AES-256-GCM roundtrip; tampering fails', () => {
    const secret = 'k'.repeat(64);
    const ct = aesEncrypt('DISCORD_TOKEN_VALUE', secret);
    expect(ct).not.toContain('DISCORD_TOKEN_VALUE');
    expect(aesDecrypt(ct, secret)).toBe('DISCORD_TOKEN_VALUE');
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1]! ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => aesDecrypt(tampered, secret)).toThrow();
  });

  it('guest keys are >= 32 chars and unique', () => {
    const a = generateGuestKey();
    const b = generateGuestKey();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(b.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  it('hmac + timing safe compare', () => {
    const sig = hmacSha256hex('secret', Buffer.from('payload'));
    expect(sig).toHaveLength(64);
    expect(timingSafeEqualStr(sig, sig)).toBe(true);
    expect(timingSafeEqualStr(sig, sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a'))).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
  });
});
