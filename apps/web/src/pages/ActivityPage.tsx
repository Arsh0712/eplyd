import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { ActivityEntry } from '../api/types';
import { Badge, EmptyState } from '../components/ui';
import { formatTime, useTitle } from '../lib/format';

const ACTION_STYLE: Record<string, string> = {
  'proc.start': 'text-eplyd',
  'proc.stop': 'text-zinc-300',
  'proc.stop_manual': 'text-zinc-300',
  'proc.crash_loop': 'text-red-300',
  'proc.crashed': 'text-red-300',
  'proc.start_failed': 'text-red-300',
  'deploy.upload': 'text-sky-300',
  'deploy.git_pull': 'text-sky-300',
  'deps.install': 'text-violet-300',
  'deps.install_failed': 'text-red-300',
  'auth.login': 'text-amber-300',
  'auth.login_failed': 'text-red-300',
  'key.create': 'text-amber-300',
  'key.revoke': 'text-red-300',
  'key.reveal': 'text-amber-300',
  'project.create': 'text-eplyd',
  'project.delete': 'text-red-300',
  'platform.update_hook': 'text-sky-300',
  'storage.clear': 'text-amber-300'
};

export default function ActivityPage(): JSX.Element {
  useTitle('Global activity');
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['activity-global'],
    queryFn: () => api<{ activity: ActivityEntry[] }>('/activity'),
    refetchInterval: 10_000
  });

  const entries = data?.activity ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-ink-muted">Audit log across every project, key and platform event.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{entries.length} events</Badge>
          <button onClick={() => void refetch()} className="text-xs text-ink-muted underline hover:text-ink-text" disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton h-12" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          }
          title="No activity yet"
          body="Logins, deploys, installs and project lifecycle events will show up here as you use the platform."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-border">
          {entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-start gap-2 border-b border-ink-border/60 px-4 py-2.5 last:border-0 hover:bg-ink-panel2/40">
              <span className={`mt-0.5 w-44 shrink-0 font-mono text-xs ${ACTION_STYLE[e.action] || 'text-ink-muted'}`}>{e.action}</span>
              <span className="min-w-0 flex-1 break-words text-sm">
                {e.detail || '—'}
                {e.project_id && (
                  <Link to={`/projects/${e.project_id}/console`} className="ml-2 text-xs text-eplyd/80 underline hover:text-eplyd">
                    open project
                  </Link>
                )}
              </span>
              <span className="shrink-0 text-xs text-ink-muted">
                {e.actor.replace('guest:', 'guest ')} · {formatTime(e.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
