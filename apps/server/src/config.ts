import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Central configuration. Values come from the environment (optionally a .env
 * file at the repository root, or the path in ENV_FILE). SESSION_SECRET and
 * ENCRYPTION_KEY are auto-generated and persisted to DATA_DIR/secrets.json
 * when not provided, with a loud warning — operators should set them
 * explicitly and back ENCRYPTION_KEY up (env vars cannot be decrypted
 * without it).
 */

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), 'data')),
  CACHE_DIR: z.string().optional(),
  PUBLIC_URL: z.string().default('https://eplyd.dpdns.org'),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  SESSION_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(10240).default(2048),
  MAX_CONCURRENT_INSTALLS: z.coerce.number().int().min(1).max(16).default(3),
  PLATFORM_RESERVED_RAM_MB: z.coerce.number().int().min(0).default(4096),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
  ENV_FILE: z.string().optional()
});

// Load .env before parsing (repo root, or ENV_FILE override).
try {
  const dotenv = require('dotenv') as typeof import('dotenv');
  dotenv.config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env') });
} catch {
  /* dotenv unavailable in some contexts — env vars still work */
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

const dataDir = path.resolve(raw.DATA_DIR);
const cacheDir = path.resolve(raw.CACHE_DIR || path.join(dataDir, 'cache'));

interface PersistedSecrets {
  sessionSecret?: string;
  encryptionKey?: string;
}

function loadOrCreateSecrets(): PersistedSecrets {
  const secretsFile = path.join(dataDir, 'secrets.json');
  let stored: PersistedSecrets = {};
  try {
    stored = JSON.parse(fs.readFileSync(secretsFile, 'utf8')) as PersistedSecrets;
  } catch {
    stored = {};
  }
  let changed = false;
  if (!raw.SESSION_SECRET) {
    if (!stored.sessionSecret) {
      stored.sessionSecret = crypto.randomBytes(32).toString('hex');
      changed = true;
      // eslint-disable-next-line no-console
      console.warn('[eplyd] SESSION_SECRET not set — generated one at ' + secretsFile + '. Set it explicitly in .env for stable sessions.');
    }
  }
  if (!raw.ENCRYPTION_KEY) {
    if (!stored.encryptionKey) {
      stored.encryptionKey = crypto.randomBytes(32).toString('hex');
      changed = true;
      // eslint-disable-next-line no-console
      console.warn('[eplyd] ENCRYPTION_KEY not set — generated one at ' + secretsFile + '. BACK IT UP: env vars cannot be decrypted without it.');
    }
  }
  if (changed) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretsFile, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }
  return stored;
}

const secrets = loadOrCreateSecrets();

export const config = {
  port: raw.PORT,
  host: raw.HOST,
  publicUrl: raw.PUBLIC_URL.replace(/\/+$/, ''),
  isProd: process.env.NODE_ENV === 'production',
  dataDir,
  cacheDir,
  dirs: {
    data: dataDir,
    projects: path.join(dataDir, 'projects'),
    logs: path.join(dataDir, 'logs'),
    cache: cacheDir,
    venvs: path.join(cacheDir, 'venvs'),
    pnpmStore: path.join(cacheDir, 'pnpm-store'),
    npmCache: path.join(cacheDir, 'npm'),
    uvCache: path.join(cacheDir, 'uv'),
    pipCache: path.join(cacheDir, 'pip'),
    mavenRepo: path.join(cacheDir, 'maven'),
    gradleHome: path.join(cacheDir, 'gradle')
  },
  sessionSecret: raw.SESSION_SECRET || secrets.sessionSecret!,
  encryptionKey: raw.ENCRYPTION_KEY || secrets.encryptionKey!,
  adminPassword: raw.ADMIN_PASSWORD || '',
  maxUploadMb: raw.MAX_UPLOAD_MB,
  maxConcurrentInstalls: raw.MAX_CONCURRENT_INSTALLS,
  platformReservedRamMb: raw.PLATFORM_RESERVED_RAM_MB,
  githubWebhookSecret: raw.GITHUB_WEBHOOK_SECRET || '',
  logLevel: raw.LOG_LEVEL,
  logMaxBytes: 10 * 1024 * 1024,
  sessionTtlMs: 24 * 60 * 60 * 1000,
  rememberTtlMs: 30 * 24 * 60 * 60 * 1000
};

export type Config = typeof config;

export function ensureDirs(): void {
  for (const dir of Object.values(config.dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
