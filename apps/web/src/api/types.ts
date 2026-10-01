export interface Me {
  authenticated: boolean;
  role?: 'owner' | 'guest';
  keyId?: string;
  keyLabel?: string;
}

export interface ProcSnapshot {
  status: string;
  statusDetail?: string;
  pid: number | null;
  uptimeMs: number;
  restartCount: number;
  totalRestarts: number;
  cpuPercent: number;
  rssBytes: number;
  queuedInstalls: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  runtime: string;
  start_command: string;
  install_command: string;
  build_command: string;
  java_version: string;
  restart_policy: string;
  max_restarts: number;
  autostart: number;
  cron_restart: string;
  cpu_limit: number;
  ram_limit_mb: number;
  webhook_url: string;
  git_url: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  last_deploy_at: number | null;
  envCount: number;
  envUpdatedAt: number | null;
  proc: ProcSnapshot;
}

export interface LogLine {
  t: number;
  s: 'out' | 'err' | 'sys';
  d: string;
}

export interface ActivityEntry {
  id: number;
  project_id: string | null;
  actor: string;
  action: string;
  detail: string;
  created_at: number;
}

export interface KeyEntry {
  id: string;
  label: string;
  masked: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  activeSessions: number;
}

export interface EnvVar {
  key: string;
  value: string;
  masked: boolean;
  updatedAt: number;
  isToken: boolean;
  secret?: boolean;
  discordTokenValid?: boolean;
}

export interface HostMetrics {
  cpuPercent: number;
  cores: number;
  loadavg: number[];
  totalMem: number;
  freeMem: number;
  usedMem: number;
  diskTotal: number;
  diskFree: number;
  uptimeSec: number;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: number;
  image: boolean;
}

export interface SessionEntry {
  id: string;
  kind: string;
  keyId: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

export const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  running: { label: 'Running', cls: 'bg-eplyd/10 text-eplyd border-eplyd/30', dot: 'bg-eplyd' },
  stopped: { label: 'Stopped', cls: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30', dot: 'bg-zinc-400' },
  crashed: { label: 'Crashed', cls: 'bg-red-500/10 text-red-300 border-red-500/30', dot: 'bg-red-400' },
  crash_loop: { label: 'Crash loop', cls: 'bg-red-500/15 text-red-300 border-red-500/40', dot: 'bg-red-500' },
  queued: { label: 'Queued', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' },
  checking_deps: { label: 'Checking deps', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30', dot: 'bg-sky-400' },
  installing: { label: 'Installing deps', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30', dot: 'bg-sky-400' },
  building: { label: 'Building', cls: 'bg-violet-500/10 text-violet-300 border-violet-500/30', dot: 'bg-violet-400' },
  starting: { label: 'Starting', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' },
  stopping: { label: 'Stopping', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' }
};

export function statusMeta(status: string): { label: string; cls: string; dot: string } {
  return (
    STATUS_META[status] || {
      label: status,
      cls: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30',
      dot: 'bg-zinc-400'
    }
  );
}
