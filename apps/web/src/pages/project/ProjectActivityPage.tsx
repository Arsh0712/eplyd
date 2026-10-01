import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ActivityEntry } from '../../api/types';
import { Badge, EmptyState } from '../../components/ui';
import { formatTime, useTitle } from '../../lib/format';
import type { ProjectCtx } from './ProjectLayout';

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
  'deps.generated': 'text-violet-300',
  'env.update': 'text-amber-300',
  'file.save': 'text-ink-muted'
};

export default function ProjectActivityPage(): JSX.Element {
  const { project } = useOutletContext<ProjectCtx>();
  useTitle(`${project.name} activity`);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['activity', project.id],
    queryFn: () => api<{ activity: ActivityEntry[] }>(`/projects/${project.id}/activity`),
    refetchInterval: 10_000
  });

  const entries = data?.activity ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Activity</h2>
        <div className="flex items-center gap-2">
          <Badge>{entries.length} events</Badge>
          <button onClick={() => void refetch()} className="text-xs text-ink-muted underline hover:text-ink-text" disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
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
          body="Deploys, starts, crashes, file saves and env changes will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-border">
          {entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-start gap-2 border-b border-ink-border/60 px-4 py-2.5 last:border-0 hover:bg-ink-panel2/40">
              <span className={`mt-0.5 font-mono text-xs ${ACTION_STYLE[e.action] || 'text-ink-muted'}`}>{e.action}</span>
              <span className="min-w-0 flex-1 break-words text-sm text-ink-text">{e.detail || '—'}</span>
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
