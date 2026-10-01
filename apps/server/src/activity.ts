import { getDb } from './db';
import { logger } from './lib/log';

export type Actor = 'owner' | `guest:${string}` | 'system';

export interface ActivityEntry {
  id?: number;
  project_id?: string | null;
  actor: string;
  action: string;
  detail?: string;
  created_at?: number;
}

const MAX_ROWS = 8000;

export function recordActivity(entry: ActivityEntry): void {
  try {
    getDb()
      .prepare('INSERT INTO activity (project_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(entry.project_id ?? null, entry.actor, entry.action, entry.detail ?? '', Date.now());
    // Prune occasionally to keep the table bounded.
    if (Math.random() < 0.05) {
      getDb()
        .prepare(
          'DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY created_at DESC LIMIT ?)'
        )
        .run(MAX_ROWS);
    }
  } catch (err) {
    logger.error({ err }, 'failed to record activity');
  }
}

export function listActivity(opts: { projectId?: string; limit?: number; before?: number } = {}): ActivityEntry[] {
  const limit = Math.min(opts.limit ?? 100, 500);
  if (opts.projectId) {
    return getDb()
      .prepare(
        'SELECT * FROM activity WHERE project_id = ? AND (? IS NULL OR created_at < ?) ORDER BY created_at DESC, id DESC LIMIT ?'
      )
      .all(opts.projectId, opts.before ?? null, opts.before ?? null, limit) as ActivityEntry[];
  }
  return getDb()
    .prepare(
      'SELECT * FROM activity WHERE (? IS NULL OR created_at < ?) ORDER BY created_at DESC, id DESC LIMIT ?'
    )
    .all(opts.before ?? null, opts.before ?? null, limit) as ActivityEntry[];
}
