import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Bell, Cpu, HardDrive, Package, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { useToast } from '../../state/toast';
import { Badge, Button, Card, Field, Input, Spinner } from '../../components/ui';
import { formatBytes, formatDuration } from '../../lib/format';

interface PlatformSettingsShape {
  defaultWebhookUrl: string;
  cacheGcDays: number;
  publicUrl: string;
  maxUploadMb: number;
  maxConcurrentInstalls: number;
  platformReservedRamMb: number;
  githubWebhookConfigured: boolean;
}

interface RuntimeVersions {
  node?: string;
  npm?: string;
  pnpm?: string;
  python?: string;
  uv?: string;
  java_default?: string;
  java17?: string;
  java21?: string;
  maven?: string;
}

interface StorageInfo {
  scopes: { id: string; label: string; bytes: number }[];
  venvCount: number;
  projectsBytes: number;
  logsBytes: number;
  stats: { installs: number; cacheHits: number; fingerprintJoins: number };
}

interface SessionEntry {
  id: string;
  kind: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

function General(): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<PlatformSettingsShape>('/settings') });
  const [webhook, setWebhook] = useState('');
  const [gcDays, setGcDays] = useState(7);
  useEffect(() => {
    if (data) {
      setWebhook(data.defaultWebhookUrl);
      setGcDays(data.cacheGcDays);
    }
  }, [data]);

  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-medium">Editable defaults</h2>
        <Field label="Default Discord webhook" hint="Used when a project has no webhook of its own">
          <Input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
        </Field>
        <Field label="Unused venv garbage-collect after (days)">
          <Input type="number" min={1} max={365} value={gcDays} onChange={(e) => setGcDays(Number(e.target.value))} />
        </Field>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await api('/settings', { method: 'PUT', body: { defaultWebhookUrl: webhook, cacheGcDays: gcDays } });
              toast.push('Settings saved', 'ok');
              void qc.invalidateQueries({ queryKey: ['platform-settings'] });
            } catch (e) {
              toast.push(e instanceof Error ? e.message : 'Save failed', 'error');
            }
          }}
        >
          Save
        </Button>
      </Card>
      <Card className="space-y-2 p-5 text-sm">
        <h2 className="text-base font-medium">Read-only host configuration</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-ink-muted">Public URL</dt>
          <dd className="font-mono text-xs">{data.publicUrl}</dd>
          <dt className="text-ink-muted">Max upload</dt>
          <dd className="font-mono text-xs">{data.maxUploadMb} MB</dd>
          <dt className="text-ink-muted">Concurrent installs</dt>
          <dd className="font-mono text-xs">{data.maxConcurrentInstalls}</dd>
          <dt className="text-ink-muted">Reserved RAM for platform</dt>
          <dd className="font-mono text-xs">{data.platformReservedRamMb} MB</dd>
          <dt className="text-ink-muted">GitHub update webhook</dt>
          <dd className="font-mono text-xs">{data.githubWebhookConfigured ? 'configured' : 'not configured'}</dd>
        </dl>
        <p className="text-xs text-ink-muted">These are set by environment variables in the server's .env file.</p>
      </Card>
    </div>
  );
}

function Runtimes(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['runtimes'], queryFn: () => api<{ runtimes: RuntimeVersions }>('/runtimes') });
  if (isLoading) return <Spinner />;
  const r = data?.runtimes ?? {};
  const cards = [
    { label: 'Node.js', v: r.node, icon: Cpu },
    { label: 'npm', v: r.npm },
    { label: 'pnpm', v: r.pnpm },
    { label: 'Python', v: r.python },
    { label: 'uv', v: r.uv },
    { label: 'Java (default)', v: r.java_default },
    { label: 'OpenJDK 17', v: r.java17 },
    { label: 'OpenJDK 21', v: r.java21 },
    { label: 'Maven', v: r.maven }
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-xs text-ink-muted">{c.label}</p>
            <p className={`mt-1 font-mono text-sm ${c.v ? 'text-eplyd' : 'text-ink-muted'}`}>{c.v || 'not detected'}</p>
          </Card>
        ))}
      </div>
      <p className="text-xs text-ink-muted">Detected live from PATH. Install missing runtimes with scripts/install.sh, then refresh.</p>
    </div>
  );
}

function Storage(): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['storage'], queryFn: () => api<StorageInfo>('/storage'), refetchInterval: 15000 });
  const [busy, setBusy] = useState(false);

  if (isLoading || !data) return <Spinner />;
  const total = data.scopes.reduce((a, s) => a + s.bytes, 0);
  const hits = data.stats.cacheHits + data.stats.fingerprintJoins;
  const totalStarts = data.stats.installs + hits;
  const hitRate = totalStarts > 0 ? Math.round((hits / totalStarts) * 100) : 0;

  const clear = async (scope: string): Promise<void> => {
    setBusy(true);
    try {
      await api('/storage/clear', { method: 'POST', body: { scope } });
      toast.push(`Cleared: ${scope}`, 'ok');
      void qc.invalidateQueries({ queryKey: ['storage'] });
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Clear failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-ink-muted">Shared caches</p>
          <p className="mt-1 font-mono text-lg">{formatBytes(total)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-muted">Shared venvs</p>
          <p className="mt-1 font-mono text-lg">{data.venvCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-muted">Cache hit rate</p>
          <p className="mt-1 font-mono text-lg text-eplyd">{hitRate}%</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-muted">Fingerprint joins</p>
          <p className="mt-1 font-mono text-lg">{data.stats.fingerprintJoins}</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-border bg-ink-panel2/50 text-left text-xs uppercase text-ink-muted">
              <th className="px-4 py-2">Cache</th>
              <th className="px-4 py-2">Size</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.scopes.map((s) => (
              <tr key={s.id} className="border-b border-ink-border/60 last:border-0">
                <td className="px-4 py-2">{s.label}</td>
                <td className="px-4 py-2 font-mono text-xs">{formatBytes(s.bytes)}</td>
                <td className="px-2 py-2 text-right">
                  <Button variant="subtle" onClick={() => void clear(s.id)} disabled={busy || s.bytes === 0} aria-label={`Clear ${s.label}`}>
                    <Trash2 size={12} /> Clear
                  </Button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-4 py-2">Project files</td>
              <td className="px-4 py-2 font-mono text-xs">{formatBytes(data.projectsBytes)}</td>
              <td />
            </tr>
            <tr>
              <td className="px-4 py-2">Log history</td>
              <td className="px-4 py-2 font-mono text-xs">{formatBytes(data.logsBytes)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button variant="subtle" onClick={() => void clear('unused')} disabled={busy}>
          <Package size={13} /> GC unused venvs (7d)
        </Button>
        <Button variant="danger" onClick={() => void clear('all')} disabled={busy}>
          <Trash2 size={13} /> Clear ALL caches
        </Button>
        <p className="text-xs text-ink-muted self-center">Clearing caches is safe — the next start re-downloads missing packages into the shared store.</p>
      </div>
    </div>
  );
}

function Notifications(): JSX.Element {
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<PlatformSettingsShape>('/settings') });
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (data) setUrl(data.defaultWebhookUrl);
  }, [data]);
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-base font-medium">Discord webhook notifications</h2>
      <p className="text-sm text-ink-muted">
        EplyD posts crash, restart and deploy events to Discord webhooks. Set a default here; per-project webhooks in project Settings override it.
      </p>
      <Field label="Default webhook URL">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await api('/settings', { method: 'PUT', body: { defaultWebhookUrl: url } });
              toast.push('Saved', 'ok');
            } catch (e) {
              toast.push(e instanceof Error ? e.message : 'Save failed', 'error');
            }
          }}
        >
          Save
        </Button>
        <Button
          variant="subtle"
          onClick={async () => {
            try {
              await api('/notifications/test', { method: 'POST', body: { url } });
              toast.push('Test notification sent — check your Discord channel', 'ok');
            } catch (e) {
              toast.push(e instanceof Error ? e.message : 'Test failed', 'error');
            }
          }}
        >
          <Bell size={13} /> Send test
        </Button>
      </div>
    </Card>
  );
}

function Security(): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ sessions: SessionEntry[] }>('/sessions') });
  if (isLoading) return <Spinner />;
  const sessions = data?.sessions ?? [];
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-5 text-sm">
        <h2 className="text-base font-medium">Active sessions</h2>
        <p className="text-xs text-ink-muted">Signed-in owner and guest sessions. Revoking a guest key also kills its sessions.</p>
      </Card>
      <div className="overflow-hidden rounded-xl border border-ink-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-border bg-ink-panel2/50 text-left text-xs uppercase text-ink-muted">
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Last seen</th>
              <th className="px-4 py-2">Expires</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-ink-border/60 last:border-0">
                <td className="px-4 py-2">
                  {s.kind === 'owner' ? 'Owner' : 'Guest'} {s.current && <Badge className="!border-eplyd/30 !text-eplyd">this session</Badge>}
                </td>
                <td className="px-4 py-2 text-xs text-ink-muted">{new Date(s.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2 text-xs text-ink-muted">{formatDuration(Date.now() - s.lastSeenAt)} ago</td>
                <td className="px-4 py-2 text-xs text-ink-muted">{new Date(s.expiresAt).toLocaleDateString()}</td>
                <td className="px-2 py-2 text-right">
                  <Button
                    variant="subtle"
                    onClick={async () => {
                      try {
                        await api(`/sessions/${s.id}`, { method: 'DELETE' });
                        toast.push(s.current ? 'Session revoked — redirecting to login…' : 'Session revoked', 'ok');
                        void qc.invalidateQueries({ queryKey: ['sessions'] });
                        if (s.current) setTimeout(() => navigate('/login'), 800);
                      } catch (e) {
                        toast.push(e instanceof Error ? e.message : 'Failed', 'error');
                      }
                    }}
                  >
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card className="space-y-2 p-5 text-sm">
        <h2 className="text-base font-medium">Hardening in place</h2>
        <ul className="list-inside list-disc space-y-1 text-xs text-ink-muted">
          <li>argon2id password hashing, constant-time comparisons</li>
          <li>login rate limit: 5 attempts/min/IP with lockout</li>
          <li>CSRF double-submit cookies + same-origin enforcement</li>
          <li>AES-256-GCM encryption for env vars and keys at rest</li>
          <li>zip-slip, symlink, traversal and zip-bomb defenses</li>
          <li>bot processes run with a sanitized environment (platform secrets never leak)</li>
        </ul>
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-eplyd underline">
          <ArrowDownToLine size={12} /> OpenAPI spec
        </a>
      </Card>
    </div>
  );
}

const MAP: Record<string, () => JSX.Element> = {
  general: General,
  runtimes: Runtimes,
  storage: Storage,
  notifications: Notifications,
  security: Security
};

export function SettingsSection({ name }: { name: string }): JSX.Element {
  const Comp = MAP[name] || General;
  return <Comp />;
}

export function HardDriveIcon(): JSX.Element {
  return <HardDrive size={14} />;
}
