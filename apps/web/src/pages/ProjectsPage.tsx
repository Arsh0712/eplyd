import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Cpu, MemoryStick, Plus, RefreshCw, RotateCw, Search, Play, Square, Timer } from 'lucide-react';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Badge, Button, ConfirmDialog, EmptyState, Input, Select, Spinner, StatusPill } from '../components/ui';
import { formatBytes, formatDuration, timeAgo, useTitle } from '../lib/format';

type StatusFilter = 'all' | 'running' | 'stopped' | 'crashed' | 'other';
type SortKey = 'name' | 'status' | 'cpu' | 'mem' | 'deployed';

const RUNNING_STATES = ['running', 'starting', 'queued', 'checking_deps', 'installing', 'building'];

export default function ProjectsPage(): JSX.Element {
  useTitle('Projects');
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState<'start' | 'stop' | 'restart' | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: Project[] }>('/projects'),
    refetchInterval: 5000
  });

  const action = useMutation({
    mutationFn: ({ id, act }: { id: string; act: string }) => api(`/projects/${id}/${act}`, { method: 'POST', body: {} }),
    onSuccess: (_d, v) => {
      toast.push(`Project ${v.act} requested`, 'ok');
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Action failed', 'error')
  });

  const bulk = useMutation({
    mutationFn: (v: { action: string; ids: string[] }) =>
      api<{ results: { ok: boolean; error?: string }[] }>('/projects/bulk', { method: 'POST', body: v }),
    onSuccess: (res) => {
      const failed = res.results.filter((r) => !r.ok).length;
      toast.push(failed ? `Bulk action finished with ${failed} skipped` : 'Bulk action done', failed ? 'info' : 'ok');
      setConfirmBulk(null);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Bulk failed', 'error')
  });

  const projects = data?.projects ?? [];
  const filtered = useMemo(() => {
    let list = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (status === 'running') list = list.filter((p) => RUNNING_STATES.includes(p.proc?.status || 'stopped'));
    else if (status === 'stopped') list = list.filter((p) => p.proc?.status === 'stopped');
    else if (status === 'crashed') list = list.filter((p) => ['crashed', 'crash_loop'].includes(p.proc?.status || ''));
    else if (status === 'other') list = list.filter((p) => !RUNNING_STATES.includes(p.proc?.status || '') && !['stopped', 'crashed', 'crash_loop'].includes(p.proc?.status || ''));
    const rank = (s: string): number => (s === 'running' ? 0 : ['installing', 'building', 'starting', 'queued', 'checking_deps', 'stopping'].includes(s) ? 1 : s === 'crashed' || s === 'crash_loop' ? 2 : 3);
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'status') return rank(a.proc?.status) - rank(b.proc?.status);
      if (sort === 'cpu') return (b.proc?.cpuPercent || 0) - (a.proc?.cpuPercent || 0);
      if (sort === 'mem') return (b.proc?.rssBytes || 0) - (a.proc?.rssBytes || 0);
      return (b.last_deploy_at || 0) - (a.last_deploy_at || 0);
    });
  }, [projects, search, status, sort]);

  const runningCount = projects.filter((p) => RUNNING_STATES.includes(p.proc?.status || '')).length;

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-ink-muted">
            {projects.length} project{projects.length === 1 ? '' : 's'} · {runningCount} running · no platform caps
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-48 pl-8" aria-label="Search projects" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="!w-36" aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
            <option value="crashed">Crashed</option>
            <option value="other">In transition</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="!w-36" aria-label="Sort">
            <option value="name">Sort: Name</option>
            <option value="status">Sort: Status</option>
            <option value="cpu">Sort: CPU</option>
            <option value="mem">Sort: Memory</option>
            <option value="deployed">Sort: Last deploy</option>
          </Select>
          <Button variant="subtle" onClick={() => void refetch()} aria-label="Refresh">
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </Button>
          <Button variant="primary" onClick={() => navigate('/projects/new')}>
            <Plus size={15} /> New project
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-eplyd/25 bg-eplyd/5 px-4 py-2.5 text-sm">
          <span>{selected.size} selected</span>
          <Button variant="subtle" onClick={() => setConfirmBulk('start')}>
            <Play size={13} /> Start all
          </Button>
          <Button variant="subtle" onClick={() => setConfirmBulk('restart')}>
            <RotateCw size={13} /> Restart all
          </Button>
          <Button variant="danger" onClick={() => setConfirmBulk('stop')}>
            <Square size={13} /> Stop all
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Bot size={28} />}
          title={projects.length === 0 ? 'No projects yet' : 'Nothing matches your filters'}
          body={
            projects.length === 0
              ? 'Upload a ZIP with your bot, start from a Discord template, or import from GitHub. Dependencies install automatically on first start.'
              : 'Try clearing the search or status filter.'
          }
          action={
            projects.length === 0 ? (
              <Button variant="primary" onClick={() => navigate('/projects/new')}>
                <Plus size={15} /> Create your first project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const s = p.proc?.status || 'stopped';
            return (
              <div key={p.id} className="group relative rounded-xl border border-ink-border bg-ink-panel p-4 transition-colors hover:border-eplyd/30">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#3DDC97]"
                    aria-label={`Select ${p.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                      <Link to={`/projects/${p.id}/console`} className="truncate font-medium hover:text-eplyd">
                        {p.name}
                      </Link>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{p.description || 'No description'}</p>
                  </div>
                  <StatusPill status={s} detail={p.proc?.statusDetail} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-muted">
                  <span className="flex items-center gap-1">
                    <Timer size={12} /> {s === 'running' ? `up ${formatDuration(p.proc?.uptimeMs)}` : '—'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Cpu size={12} /> {p.proc?.cpuPercent || 0}%
                  </span>
                  <span className="flex items-center gap-1">
                    <MemoryStick size={12} /> {formatBytes(p.proc?.rssBytes || 0)}
                  </span>
                  <span className="flex items-center gap-1">
                    <RotateCw size={12} /> {p.proc?.totalRestarts || 0} restarts
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <Badge>{p.runtime === 'auto' ? 'auto-detect' : p.runtime}</Badge>
                  <Badge>deployed {timeAgo(p.last_deploy_at)}</Badge>
                  <div className="ml-auto flex gap-1">
                    {RUNNING_STATES.includes(s) ? (
                      <Button variant="subtle" onClick={() => action.mutate({ id: p.id, act: 'stop' })} aria-label="Stop">
                        <Square size={13} />
                      </Button>
                    ) : (
                      <Button variant="subtle" onClick={() => action.mutate({ id: p.id, act: 'start' })} aria-label="Start">
                        <Play size={13} />
                      </Button>
                    )}
                    <Button variant="subtle" onClick={() => action.mutate({ id: p.id, act: 'restart' })} aria-label="Restart">
                      <RotateCw size={13} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmBulk !== null}
        title={`Bulk ${confirmBulk}`}
        body={`Run "${confirmBulk}" on ${selected.size} selected project(s)?`}
        confirmLabel={`Confirm ${confirmBulk}`}
        onConfirm={() => confirmBulk && bulk.mutate({ action: confirmBulk, ids: [...selected] })}
        onClose={() => setConfirmBulk(null)}
      />
      {me?.role === 'guest' && (
        <p className="text-xs text-ink-muted">Guest session — you only see projects you created with your key.</p>
      )}
      {action.isPending && (
        <div className="fixed bottom-4 left-4">
          <Spinner />
        </div>
      )}
    </div>
  );
}
