import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Dynamic imports in beforeAll avoid module hoisting: loading routes/env pulls
// in config/db, which must observe the temp DATA_DIR first.
let parseDotenv: (t: string) => Record<string, string>;
let isSecretKey: (k: string) => boolean;
let discordTokenShape: (v: string) => boolean;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eplyd-env-'));
  process.env.SESSION_SECRET = 's'.repeat(64);
  process.env.ENCRYPTION_KEY = 'e'.repeat(64);
  ({ parseDotenv, isSecretKey, discordTokenShape } = await import('../routes/env'));
});

describe('dotenv parsing + secret detection', () => {
  it('parses comments, export prefixes and quotes', () => {
    const text = [
      '# a comment',
      'export DISCORD_TOKEN=MTIz.NDU2.aGVsbG8',
      'PLAIN=hello',
      'QUOTED="with spaces and # not a comment"',
      "SINGLE='single quoted'",
      'SPACED  =  trimmed  ',
      'invalid line without equals',
      'BAD-NAME=x'
    ].join('\n');
    const parsed = parseDotenv(text);
    expect(parsed.DISCORD_TOKEN).toBe('MTIz.NDU2.aGVsbG8');
    expect(parsed.PLAIN).toBe('hello');
    expect(parsed.QUOTED).toBe('with spaces and # not a comment');
    expect(parsed.SINGLE).toBe('single quoted');
    expect(parsed.SPACED).toBe('trimmed');
    expect(parsed['BAD-NAME']).toBeUndefined();
  });

  it('flags secret-looking keys and passes public ones', () => {
    for (const k of ['DISCORD_TOKEN', 'API_KEY', 'DATABASE_URL', 'MY_PASSWORD', 'WEBHOOK_SECRET', 'client_secret'])
      expect(isSecretKey(k), k).toBe(true);
    for (const k of ['LOG_LEVEL', 'GREETING', 'TZ', 'PREFIX']) expect(isSecretKey(k), k).toBe(false);
  });

  it('validates Discord token shape loosely', () => {
    expect(discordTokenShape('MTIzNDU2Nzg5MDEyMzQ1Njc4.client6.secretsecretsecretsecretsecretsecre')).toBe(true);
    expect(discordTokenShape('short.nope.x')).toBe(false);
    expect(discordTokenShape('only-one-segment')).toBe(false);
    expect(discordTokenShape('')).toBe(false);
  });
});
