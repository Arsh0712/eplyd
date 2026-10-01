import { getSetting } from '../db';

export type NotifyEvent =
  | 'crash'
  | 'restart'
  | 'deploy'
  | 'start'
  | 'stop'
  | 'install_failed'
  | 'crash_loop';

/**
 * Fire-and-forget Discord webhook notification for lifecycle events.
 * Uses the project webhook URL, falling back to the platform default.
 * HTTPS only, 5s timeout, errors ignored (notifications must never
 * take a bot down).
 */
export async function notifyEvent(
  project: { id: string; name: string; webhook_url?: string },
  event: NotifyEvent,
  detail: string
): Promise<void> {
  try {
    const url = (project.webhook_url || '').trim() || (getSetting('default_webhook_url') || '').trim();
    if (!url || !/^https:\/\//i.test(url)) return;
    const content = `[EplyD] ${event.toUpperCase()} — ${project.name}\n${detail}`.slice(0, 1900);
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    /* notifications are best-effort */
  }
}
