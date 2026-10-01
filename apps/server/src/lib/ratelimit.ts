interface Bucket {
  count: number;
  resetAt: number;
  lockUntil: number;
}

/** Fixed-window in-memory rate limiter with lockout (for login brute-force). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private limit: number,
    private windowMs: number,
    private lockoutMs: number = 60_000
  ) {}

  take(key: string): { ok: boolean; retryAfterMs: number } {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { count: 0, resetAt: now + this.windowMs, lockUntil: 0 };
      this.buckets.set(key, b);
    }
    if (b.lockUntil > now) {
      return { ok: false, retryAfterMs: b.lockUntil - now };
    }
    if (now > b.resetAt) {
      b.count = 0;
      b.resetAt = now + this.windowMs;
    }
    b.count += 1;
    if (b.count > this.limit) {
      b.lockUntil = now + this.lockoutMs;
      b.count = 0;
      return { ok: false, retryAfterMs: this.lockoutMs };
    }
    return { ok: true, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Periodic cleanup of stale buckets (call from a timer). */
  sweep(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (b.resetAt < now && b.lockUntil < now) this.buckets.delete(k);
    }
  }
}

export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string }; ip?: string }): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf.split(',')[0]!.trim();
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0]!.trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
