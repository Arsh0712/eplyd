import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ChevronRight, FileCode2, Package, Play, RotateCw, Settings2, Square, TerminalSquare, Variable, Zap } from 'lucide-react';
import { api } from '../../api/client';
import type { Project } from '../../api/types';
import { useToast } from '../../state/toast';
import { Button, ConfirmDialog, Spinner, StatusPill } from '../../components/ui';
import { useEffect, useState } from 'react';
import { useTitle } from '../../lib/format';

export interface ProjectCtx {
  project: Project;
}

const TABS = [
  { to: 'console', label: 'Console', icon: TerminalSquare },
  { to: 'files', label: 'Files', icon: FileCode2 },
  { to: 'environment', label: 'Environment', icon: Variable },
  { to: 'activity', label: 'Activity', icon: Activity },
  { to: 'settings', label: 'Settings', icon: Settings2 }
];

export default function ProjectLayout(): JSX.Element {
  const { id = '' } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [killOpen, setKillOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api<{ project: Project }>(`/projects/${id}`),
    refetchInterval: 5000,
    retry: false
  });

  useTitle(data?.project.name || 'Project');

  const act = useMutation({
    mutationFn: ({ action }: { action: string }) => api(`/projects/${id}/${action}`, { method: 'POST', body: {} }),
    onSuccess: (_d, v) => {
      toast.push(`${v} requested`, 'ok');
      void qc.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Action failed', 'error')
  });

  const project = data?.project;
  const status = project?.proc?.status || 'stopped';
  const neverStarted = !project?.proc?.pid && project?.last_deploy_at == null;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (isError || !project) {
    const msg = error instanceof Error ? error.message : 'Failed to load project';
    const notFound = /not found/i.test(msg);
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg">{notFound ? 'Project not found' : 'You do not have access to this project'}</p>
        <p className="text-sm text-ink-muted">{notFound ? 'It may have been deleted.' : 'Guests can only open projects they created.'}</p>
        <Button onClick={() => navigate(notFound ? '/projects' : '/403')}>Go back</Button>
      </div>
    );
  }

  const running = ['running', 'starting', 'queued', 'checking_deps', 'installing', 'building'].includes(status);

  return (
    <div className="space-y-4">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 text-sm text-ink-muted" aria-label="Breadcrumb">
        <NavLink to="/projects" className="hover:text-ink-text">
          Projects
        </NavLink>
        <ChevronRight size={13} />
        <span className="flex items-center gap-1.5 text-ink-text">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
          {project.name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        <StatusPill status={status} detail={project.proc?.statusDetail} />
        {running && project.proc?.statusDetail && <span className="hidden text-xs text-ink-muted sm:inline">{project.proc.statusDetail}</span>}
        <div className="ml-auto flex items-center gap-2">
          {!running && (
            <Button
              variant="subtle"
              onClick={() => act.mutate({ action: 'install' })}
              loading={act.isPending}
              aria-label="Install dependencies"
              title="Install dependencies now (runs automatically on first start too)"
            >
              <Package size={13} /> Install deps
            </Button>
          )}
          {running ? (
            <Button variant="subtle" onClick={() => act.mutate({ action: 'stop' })} loading={act.isPending} aria-label="Stop project">
              <Square size={13} /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={() => act.mutate({ action: 'start' })} loading={act.isPending} aria-label="Start project">
              <Play size={13} /> Start
            </Button>
          )}
          <Button variant="subtle" onClick={() => act.mutate({ action: 'restart' })} aria-label="Restart project">
            <RotateCw size={13} /> Restart
          </Button>
          <Button variant="danger" onClick={() => setKillOpen(true)} aria-label="Kill project">
            <Zap size={13} /> Kill
          </Button>
        </div>
      </div>

      {/* Restart-required banner */}
      {status === 'running' && !!project.envUpdatedAt && project.proc?.pid && project.envUpdatedAt > (project.proc.uptimeMs ? Date.now() - project.proc.uptimeMs : 0) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          Environment variables changed since this process started — restart the project to apply them.
        </div>
      )}

      {/* First-start hint: deps install in place */}
      {neverStarted && !running && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-eplyd/25 bg-eplyd/5 px-4 py-2.5 text-sm text-ink-muted">
          <Package size={14} className="text-eplyd" />
          <span>
            <span className="text-ink-text">First start?</span> Dependencies install automatically while it boots — or hit{' '}
            <button className="font-medium text-eplyd underline-offset-2 hover:underline" onClick={() => act.mutate({ action: 'install' })}>
              Install deps
            </button>{' '}
            first. Installs are fingerprinted, so the next start is instant.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-ink-border" role="tablist" aria-label="Project tabs">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            role="tab"
            className={({ isActive }) =>
              `flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-sm transition-colors ${
                isActive ? 'border-eplyd text-eplyd' : 'border-transparent text-ink-muted hover:text-ink-text'
              }`
            }
          >
            <t.icon size={14} /> {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet context={{ project } satisfies ProjectCtx} />

      <ConfirmDialog
        open={killOpen}
        title="Kill process?"
        body="Send SIGKILL to the whole process group. Unsaved process state is lost. The bot will not auto-restart from a kill."
        confirmLabel="Kill now"
        onConfirm={() => {
          act.mutate({ action: 'kill' });
          setKillOpen(false);
        }}
        onClose={() => setKillOpen(false)}
      />
    </div>
  );
}
