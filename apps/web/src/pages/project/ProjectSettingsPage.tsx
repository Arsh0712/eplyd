import { useEffect, useState } from 'react';
import { useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { Project } from '../../api/types';
import { useToast } from '../../state/toast';
import { Button, Card, ConfirmDialog, Field, Input, Select, Toggle } from '../../components/ui';
import type { ProjectCtx } from './ProjectLayout';

export default function ProjectSettingsPage(): JSX.Element {
  const { project } = useOutletContext<ProjectCtx>();
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState(project);
  useEffect(() => setForm(project), [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [wipeOpen, setWipeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api(`/projects/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      toast.push('Settings saved', 'ok');
      void qc.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Save failed', 'error')
  });

  const set = (patch: Partial<Project>): void => setForm((f) => ({ ...f, ...patch }));

  const saveButton = (patch: Partial<Project>): void => save.mutate(patch as Record<string, unknown>);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* identity */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-medium">Identity</h2>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What does this bot do?" />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={form.color}
            onChange={(e) => set({ color: e.target.value })}
            className="h-9 w-20 cursor-pointer rounded-lg border border-ink-border bg-ink-panel"
            aria-label="Project color"
          />
        </Field>
        <Button variant="primary" onClick={() => saveButton({ name: form.name, description: form.description, color: form.color })} loading={save.isPending}>
          Save identity
        </Button>
      </Card>

      {/* runtime */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-medium">Runtime & commands</h2>
        <Field label="Runtime" hint="auto-detect reads package.json / requirements.txt / pom.xml">
          <Select value={form.runtime} onChange={(e) => set({ runtime: e.target.value })}>
            <option value="auto">Auto-detect</option>
            <option value="node">Node.js</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="custom">Custom command</option>
          </Select>
        </Field>
        {form.runtime === 'java' && (
          <Field label="JDK version">
            <Select value={form.java_version} onChange={(e) => set({ java_version: e.target.value })}>
              <option value="21">OpenJDK 21</option>
              <option value="17">OpenJDK 17</option>
            </Select>
          </Field>
        )}
        <Field label="Start command" hint="Empty = auto-detected (e.g. node index.js, venv python main.py, java -jar …)">
          <Input value={form.start_command} onChange={(e) => set({ start_command: e.target.value })} placeholder="auto" className="font-mono text-xs" />
        </Field>
        <Field label="Install command override" hint="Advanced: replaces the auto install (pnpm/uv/maven)">
          <Input value={form.install_command} onChange={(e) => set({ install_command: e.target.value })} placeholder="auto" className="font-mono text-xs" />
        </Field>
        <Field label="Build command override" hint="Java/TS builds; empty = auto">
          <Input value={form.build_command} onChange={(e) => set({ build_command: e.target.value })} placeholder="auto" className="font-mono text-xs" />
        </Field>
        <Button
          variant="primary"
          onClick={() =>
            saveButton({
              runtime: form.runtime,
              java_version: form.java_version,
              start_command: form.start_command,
              install_command: form.install_command,
              build_command: form.build_command
            })
          }
          loading={save.isPending}
        >
          Save runtime
        </Button>
      </Card>

      {/* behavior */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-medium">Process behavior</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Restart policy" hint="Use 'always' to keep the bot online 24/7">
            <Select value={form.restart_policy} onChange={(e) => set({ restart_policy: e.target.value })}>
              <option value="always">always — 24/7 uptime</option>
              <option value="on-failure">on-failure — crash only</option>
              <option value="never">never</option>
            </Select>
          </Field>
          <Field label="Max restarts">
            <Input type="number" min={0} max={1000} value={form.max_restarts} onChange={(e) => set({ max_restarts: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-ink-border bg-ink-field px-3.5 py-3">
          <div>
            <p className="text-sm">Auto-start on platform boot</p>
            <p className="text-xs text-ink-muted">Bot comes back by itself after server restarts — true 24/7.</p>
          </div>
          <Toggle
            checked={!!form.autostart}
            label="Auto-start on boot"
            onChange={(v) => {
              set({ autostart: v ? 1 : 0 });
              saveButton({ autostart: v ? 1 : 0 });
            }}
          />
        </div>
        <Field label="Scheduled restart (cron)" hint="5-field cron in UTC, e.g. 0 4 * * * — empty to disable">
          <Input value={form.cron_restart} onChange={(e) => set({ cron_restart: e.target.value })} placeholder="0 4 * * *" className="font-mono text-xs" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPU limit %" hint="0 = unlimited (cgroup, best-effort)">
            <Input type="number" min={0} max={100} value={form.cpu_limit} onChange={(e) => set({ cpu_limit: Number(e.target.value) })} />
          </Field>
          <Field label="RAM limit (MB)" hint="0 = unlimited">
            <Input type="number" min={0} max={96000} value={form.ram_limit_mb} onChange={(e) => set({ ram_limit_mb: Number(e.target.value) })} />
          </Field>
        </div>
        <Button
          variant="primary"
          onClick={() =>
            saveButton({
              restart_policy: form.restart_policy,
              max_restarts: form.max_restarts,
              cron_restart: form.cron_restart,
              cpu_limit: form.cpu_limit,
              ram_limit_mb: form.ram_limit_mb
            })
          }
          loading={save.isPending}
        >
          Save behavior
        </Button>
      </Card>

      {/* integrations */}
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-medium">Integrations</h2>
        <Field label="Discord webhook URL (this project)" hint="Notifies crash, restart and deploy events">
          <Input value={form.webhook_url} onChange={(e) => set({ webhook_url: e.target.value })} placeholder="https://discord.com/api/webhooks/…" />
        </Field>
        <Field label="Git repository URL" hint="Enables “Pull latest & restart” in the console">
          <Input value={form.git_url} onChange={(e) => set({ git_url: e.target.value })} placeholder="https://github.com/user/bot.git" />
        </Field>
        <Button variant="primary" onClick={() => saveButton({ webhook_url: form.webhook_url, git_url: form.git_url })} loading={save.isPending}>
          Save integrations
        </Button>
        {form.git_url && (
          <Button
            variant="subtle"
            onClick={async () => {
              try {
                const r = await api<{ output: string }>(`/projects/${id}/git-pull`, { method: 'POST', body: {} });
                toast.push(`Pulled: ${r.output.slice(0, 120)}`, 'ok');
                await api(`/projects/${id}/restart`, { method: 'POST', body: {} });
              } catch (e) {
                toast.push(e instanceof Error ? e.message : 'Pull failed', 'error');
              }
            }}
          >
            Pull latest & restart
          </Button>
        )}
      </Card>

      {/* danger zone */}
      <Card className="space-y-3 border-red-500/30 p-5 lg:col-span-2">
        <h2 className="text-base font-medium text-red-300">Danger zone</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api(`/projects/${id}/logs`, { method: 'DELETE' });
                toast.push('Logs cleared', 'ok');
              } catch (e) {
                toast.push(e instanceof Error ? e.message : 'Failed', 'error');
              }
            }}
          >
            Clear logs
          </Button>
          <Button variant="danger" onClick={() => setWipeOpen(true)}>
            Wipe all files
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={13} /> Delete project
          </Button>
        </div>
        <p className="text-xs text-ink-muted">
          Wiping removes every file (keeps settings and variables). Deleting removes the project, its files and its variables permanently.
        </p>
      </Card>

      <ConfirmDialog
        open={wipeOpen}
        title="Wipe all files?"
        body="Every file in this project will be deleted. Settings, environment variables and logs are kept."
        confirmLabel="Wipe files"
        requireText={form.name}
        onConfirm={() => {
          setWipeOpen(false);
          void api(`/projects/${id}/wipe-files`, { method: 'POST', body: {} }).then(() => {
            toast.push('Files wiped', 'ok');
            void qc.invalidateQueries({ queryKey: ['project', id] });
          }).catch((e) => toast.push(e instanceof Error ? e.message : 'Wipe failed', 'error'));
        }}
        onClose={() => setWipeOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete project?"
        body="This permanently deletes the project, its files and environment variables. The bot must be stopped first."
        confirmLabel="Delete forever"
        requireText={form.name}
        onConfirm={() => {
          setDeleteOpen(false);
          void api(`/projects/${id}`, { method: 'DELETE' })
            .then(() => {
              toast.push('Project deleted', 'ok');
              void qc.invalidateQueries({ queryKey: ['projects'] });
              navigate('/projects');
            })
            .catch((e) => toast.push(e instanceof Error ? e.message : 'Delete failed — stop the project first', 'error'));
        }}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
