import { Cron } from 'croner';
import { getDb } from '../db';
import { logger } from '../lib/log';
import { getManager } from './manager';
import { recordActivity } from '../activity';

/** Scheduled (cron) restarts for projects. */
class CronManager {
  private jobs = new Map<string, Cron>();

  rescheduleAll(): void {
    try {
      const rows = getDb()
        .prepare("SELECT id, cron_restart FROM projects WHERE cron_restart IS NOT NULL AND cron_restart != ''")
        .all() as { id: string; cron_restart: string }[];
      for (const row of rows) this.reschedule(row.id, row.cron_restart);
      // Clear schedules for projects that no longer have one.
      for (const id of this.jobs.keys()) {
        if (!rows.some((r) => r.id === id)) this.remove(id);
      }
    } catch (err) {
      logger.error({ err }, 'cron rescheduleAll failed');
    }
  }

  reschedule(id: string, expr: string): void {
    this.remove(id);
    const exprTrimmed = expr.trim();
    if (!exprTrimmed) return;
    try {
      const job = new Cron(exprTrimmed, { timezone: 'UTC' }, () => {
        const mgr = getManager();
        const snap = mgr.snapshot(id);
        if (snap.status === 'running') {
          recordActivity({ project_id: id, actor: 'system', action: 'proc.scheduled_restart', detail: `cron "${exprTrimmed}"` });
          void mgr.restart(id, { reason: 'scheduled restart' });
        }
      });
      this.jobs.set(id, job);
    } catch (err) {
      logger.warn({ err, id, expr: exprTrimmed }, 'invalid cron expression — schedule skipped');
    }
  }

  remove(id: string): void {
    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
  }

  stopAll(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }
}

export const cronManager = new CronManager();
