import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config';
import { logger } from '../lib/log';

/**
 * SQLite (WAL) storage. The schema is intentionally simple and portable so
 * it can be moved to Postgres later: no SQLite-specific column types beyond
 * TEXT/INTEGER, no triggers.
 */

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#3DDC97',
    runtime TEXT NOT NULL DEFAULT 'auto',
    start_command TEXT NOT NULL DEFAULT '',
    install_command TEXT NOT NULL DEFAULT '',
    build_command TEXT NOT NULL DEFAULT '',
    java_version TEXT NOT NULL DEFAULT '21',
    restart_policy TEXT NOT NULL DEFAULT 'always',
    max_restarts INTEGER NOT NULL DEFAULT 10,
    autostart INTEGER NOT NULL DEFAULT 1,
    cron_restart TEXT NOT NULL DEFAULT '',
    cpu_limit REAL NOT NULL DEFAULT 0,
    ram_limit_mb INTEGER NOT NULL DEFAULT 0,
    webhook_url TEXT NOT NULL DEFAULT '',
    git_url TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'owner',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_deploy_at INTEGER,
    status TEXT NOT NULL DEFAULT 'stopped',
    pid INTEGER,
    started_at INTEGER,
    restart_count INTEGER NOT NULL DEFAULT 0,
    last_exit_code INTEGER,
    last_exit_signal TEXT,
    was_running INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS env_vars (
    project_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_enc TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, key)
  );

  CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    value_hash TEXT NOT NULL UNIQUE,
    value_enc TEXT NOT NULL,
    prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    key_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key_id);
  `,
  /**
   * Migration 002 — 24/7 always-on defaults.
   * Existing projects move to `always` + `autostart` so bots survive crashes
   * and full platform/server restarts without manual intervention (SQLite
   * cannot ALTER a column DEFAULT, so rows are updated directly; fresh
   * installs already get the new defaults from migration 001).
   */
  `
  UPDATE projects SET restart_policy = 'always' WHERE restart_policy = 'on-failure';
  UPDATE projects SET autostart = 1 WHERE autostart = 0;
  `
];

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(config.dirs.data, { recursive: true });
  db = new Database(path.join(config.dirs.data, 'eplyd.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(d: Database.Database): void {
  const current = d.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]!;
    const apply = d.transaction(() => {
      d.exec(sql);
      d.pragma(`user_version = ${v + 1}`);
    });
    apply();
    logger.info({ migration: v + 1 }, 'database migration applied');
  }
}

export function closeDb(): void {
  try {
    db?.close();
  } catch { /* ignore */ }
  db = null;
}

// ---- settings helpers ----

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT v FROM settings WHERE k = ?').get(key) as { v: string } | undefined;
  return row ? row.v : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
    )
    .run(key, value);
}
