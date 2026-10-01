import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, Eye, EyeOff, FileWarning, KeyRound, Lock, Plus, RotateCw, ScanSearch, Table2, Trash2, Upload, XCircle } from 'lucide-react';
import { api, fileDownloadUrl } from '../../api/client';
import type { EnvVar } from '../../api/types';
import { useToast } from '../../state/toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, PasswordInput, Segmented, TextArea } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { detectEnv } from '../../lib/dotenv';
import type { ProjectCtx } from './ProjectLayout';

type View = 'table' | 'raw';

export default function EnvironmentPage(): JSX.Element {
  const { project } = useOutletContext<ProjectCtx>();
  const id = project.id;
  const toast = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('table');
  const [revealed, setRevealed] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  // raw editor state
  const [rawText, setRawText] = useState<string | null>(null);
  const [rawDirty, setRawDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['env', id, revealed],
    queryFn: () => api<{ vars: EnvVar[] }>(`/projects/${id}/env${revealed ? '?reveal=1' : ''}`)
  });

  const rawQuery = useQuery({
    queryKey: ['env-raw', id],
    queryFn: () => api<string>(`/projects/${id}/env/raw`).catch(() => ''),
    enabled: view === 'raw' && rawText === null,
    staleTime: 0,
    gcTime: 0
  });

  // when the raw view opens, hydrate the editor from the server response
  useEffect(() => {
    if (view === 'raw' && rawText === null && rawQuery.data !== undefined) {
      setRawText(String(rawQuery.data));
      setRawDirty(false);
    }
  }, [view, rawQuery.data, rawText]);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['env', id] });
    void qc.invalidateQueries({ queryKey: ['env-raw', id] });
    void qc.invalidateQueries({ queryKey: ['project', id] });
  };

  const update = useMutation({
    mutationFn: (body: { set?: Record<string, string>; delete?: string[] }) => api(`/projects/${id}/env`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.push('Variables saved — restart to apply', 'ok');
      setNewKey('');
      setNewValue('');
      invalidate();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Save failed', 'error')
  });

  const doImport = useMutation({
    mutationFn: (opts: { text: string; mode: 'merge' | 'replace' }) =>
      api<{ count: number; removed?: number; secrets: number }>(`/projects/${id}/env/import`, { method: 'POST', body: opts }),
    onSuccess: (res, opts) => {
      const removedNote = res.removed ? `, ${res.removed} removed` : '';
      toast.push(`Detected ${res.count} variables${removedNote} · ${res.secrets} secret${res.secrets === 1 ? '' : 's'} auto-flagged`, 'ok');
      setImportOpen(false);
      setImportText('');
      setRawDirty(false);
      invalidate();
      if (opts.mode === 'replace') setView('table');
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Import failed', 'error')
  });

  const vars = data?.vars ?? [];
  const tokenVar = vars.find((v) => /^DISCORD_TOKEN$/i.test(v.key) || (/discord/i.test(v.key) && /token/i.test(v.key)));
  const secretCount = vars.filter((v) => v.secret).length;

  // live detection on the raw editor / import modal
  const rawSource = importOpen ? importText : (rawText ?? '');
  const detection = useMemo(() => detectEnv(rawSource), [rawSource]);
  const importDetection = useMemo(() => detectEnv(importText), [importText]);

  const openRaw = (): void => {
    setView('raw');
    if (rawText === null && rawQuery.data !== undefined) setRawText(String(rawQuery.data));
  };

  const saveRaw = (): void => {
    if (rawText === null) return;
    if (detection.keys.length === 0) {
      toast.push('No KEY=VALUE pairs detected', 'error');
      return;
    }
    doImport.mutate({ text: rawText, mode: 'replace' });
  };

  const keyInvalid = newKey.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newKey);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">Environment variables</h2>
        {vars.length > 0 && (
          <>
            <Badge>{vars.length} vars</Badge>
            {secretCount > 0 && (
              <Badge className="!border-eplyd/30 !text-eplyd">
                <Lock size={10} /> {secretCount} secret{secretCount === 1 ? '' : 's'}
              </Badge>
            )}
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            value={view}
            onChange={(v) => (v === 'raw' ? openRaw() : setView(v))}
            options={[
              { id: 'table', label: 'Variables', icon: <Table2 size={13} /> },
              { id: 'raw', label: 'Raw .env', icon: <FileWarning size={13} /> }
            ]}
            ariaLabel="Environment view"
          />
          <Button variant={revealed ? 'primary' : 'subtle'} onClick={() => setRevealed(!revealed)}>
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />} {revealed ? 'Hide values' : 'Reveal values'}
          </Button>
          <Button variant="subtle" onClick={() => setImportOpen(true)}>
            <Upload size={13} /> Paste .env
          </Button>
          <a href={fileDownloadUrl(`/projects/${id}/env/export`)} download className="inline-flex">
            <Button variant="subtle">
              <Download size={13} /> Export
            </Button>
          </a>
        </div>
      </div>

      {/* status hint */}
      <Card className="p-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          Variables are encrypted at rest (AES-256-GCM) and injected into the process at start. Paste a{' '}
          <code className="rounded bg-ink-field px-1 py-0.5 font-mono text-xs text-ink-text">.env</code> file below or in the Raw
          editor — every variable is <span className="text-eplyd">detected automatically</span> and secrets are flagged for masking.{' '}
          {tokenVar ? (
            tokenVar.discordTokenValid === false ? (
              <span className="text-amber-300">DISCORD_TOKEN is set but does not look like a valid Discord token — double-check it.</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-eplyd">
                <CheckCircle2 size={13} /> DISCORD_TOKEN is set{tokenVar.discordTokenValid === true ? ' and well-formed' : ''}.
              </span>
            )
          ) : (
            <span className="text-amber-300">Tip: add DISCORD_TOKEN — most Discord bots refuse to start without it.</span>
          )}
        </p>
      </Card>

      {view === 'table' ? (
        <>
          {/* add new */}
          <Card className="p-4">
            <div className="grid gap-2 sm:grid-cols-[240px_1fr_auto]">
              <Input
                mono
                placeholder="KEY (e.g. DISCORD_TOKEN)"
                value={newKey}
                invalid={keyInvalid}
                onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                aria-label="Variable name"
              />
              <PasswordInput
                placeholder={/secret|token|password|key/i.test(newKey) ? 'value — stored encrypted' : 'value'}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                aria-label="Variable value"
              />
              <Button
                variant="primary"
                disabled={!newKey.trim() || keyInvalid}
                loading={update.isPending}
                onClick={() => update.mutate({ set: { [newKey.trim()]: newValue } })}
              >
                <Plus size={14} /> Add
              </Button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
              {keyInvalid ? (
                <span className="text-red-300">Variable names must be UPPER_SNAKE_CASE (letters, digits, underscores).</span>
              ) : newKey && /token|secret|password|key|auth/i.test(newKey) ? (
                <>
                  <Lock size={11} className="text-eplyd" /> Auto-detected as a secret — it will be encrypted (AES-256-GCM) and never echoed to logs.
                </>
              ) : (
                'Secret-looking keys are detected automatically and encrypted at rest.'
              )}
            </p>
          </Card>

          {/* list */}
          <div className="overflow-hidden rounded-xl border border-ink-border">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="skeleton h-9" />
                ))}
              </div>
            ) : vars.length === 0 ? (
              <p className="p-8 text-center text-sm text-ink-muted">
                No variables yet. Paste a .env file, or add DISCORD_TOKEN above — everything is detected and encrypted automatically.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-border bg-ink-panel2/50 text-left text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-4 py-2">Key</th>
                    <th className="px-4 py-2">Value</th>
                    <th className="px-4 py-2">Updated</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {vars.map((v) => (
                    <tr key={v.key} className="border-b border-ink-border/60 transition-colors last:border-0 hover:bg-ink-panel2/30">
                      <td className="px-4 py-2 font-mono text-[13px]">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {v.secret && <Lock size={11} className="text-eplyd" />}
                          {v.key}
                          {v.secret && (
                            <Badge className="!border-eplyd/25 !text-eplyd" >
                              secret
                            </Badge>
                          )}
                          {v.discordTokenValid === true && (
                            <Badge className="!border-eplyd/40 !text-eplyd">
                              <CheckCircle2 size={10} /> valid format
                            </Badge>
                          )}
                          {v.discordTokenValid === false && (
                            <Badge className="!border-amber-500/40 !text-amber-300">
                              <XCircle size={10} /> check format
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {revealed ? (
                          <code className="break-all rounded bg-ink-field px-1.5 py-0.5 text-xs">{v.value}</code>
                        ) : (
                          <code className="select-all text-xs text-ink-muted">{v.value}</code>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-muted">{timeAgo(v.updatedAt)}</td>
                      <td className="px-2 py-2 text-right">
                        <Button variant="ghost" aria-label={`Delete ${v.key}`} onClick={() => setDeleteKey(v.key)} className="!text-red-300">
                          <Trash2 size={13} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {update.isSuccess && (
            <Button variant="primary" onClick={() => api(`/projects/${id}/restart`, { method: 'POST', body: {} }).then(() => toast.push('Restarting…', 'ok'))}>
              <RotateCw size={13} /> Restart now to apply
            </Button>
          )}
        </>
      ) : (
        /* ---------------- Raw .env editor ---------------- */
        <Card className="overflow-hidden">
          <div className="border-b border-ink-border bg-ink-panel2/40 px-4 py-2.5">
            <p className="flex items-center gap-2 text-xs text-ink-muted">
              <ScanSearch size={13} className="text-eplyd" />
              Paste or edit <code className="rounded bg-ink-field px-1 font-mono text-ink-text">KEY=VALUE</code> lines — variables are detected live and synced on save.
            </p>
          </div>
          <div className="p-4">
            {rawText === null ? (
              <div className="space-y-2 py-6">
                <div className="skeleton h-8" />
                <div className="skeleton h-8" />
                <div className="skeleton h-8 w-2/3" />
              </div>
            ) : (
              <>
                <TextArea
                  mono
                  rows={12}
                  className="min-h-[280px]"
                  value={rawText}
                  spellCheck={false}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setRawDirty(true);
                  }}
                  placeholder={'DISCORD_TOKEN=MTIz…\nDATABASE_URL=postgres://…\n# comments and quotes are supported'}
                  aria-label=".env content"
                />
                {/* live detection */}
                <div className="mt-3 rounded-lg border border-ink-border bg-ink-field px-3.5 py-3">
                  {detection.keys.length === 0 ? (
                    <p className="text-xs text-ink-muted">Nothing detected yet — start typing KEY=VALUE lines.</p>
                  ) : (
                    <div className="space-y-2 text-xs">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1 font-medium text-ink-text">
                          <ScanSearch size={12} className="text-eplyd" /> Detected {detection.keys.length} variable{detection.keys.length === 1 ? '' : 's'}
                        </span>
                        {detection.secrets.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-eplyd">
                            <Lock size={11} /> {detection.secrets.length} secret{detection.secrets.length === 1 ? '' : 's'} will be encrypted &amp; masked
                          </span>
                        )}
                        {detection.invalidKeys.length > 0 && (
                          <span className="text-red-300">
                            Invalid names skipped: <span className="font-mono">{detection.invalidKeys.slice(0, 4).join(', ')}</span>
                          </span>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {detection.keys.slice(0, 12).map((k) => (
                          <span
                            key={k}
                            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                              detection.secrets.includes(k) ? 'border-eplyd/30 bg-eplyd/10 text-eplyd' : 'border-ink-border bg-ink-panel2 text-ink-muted'
                            }`}
                          >
                            {detection.secrets.includes(k) && <Lock size={9} />}
                            {k}
                          </span>
                        ))}
                        {detection.keys.length > 12 && <span className="self-center text-[11px] text-ink-muted">+{detection.keys.length - 12} more</span>}
                      </div>
                      {detection.discordToken?.present && (
                        <p className={`inline-flex items-center gap-1.5 ${detection.discordToken.valid ? 'text-eplyd' : 'text-amber-300'}`}>
                          {detection.discordToken.valid ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          DISCORD_TOKEN detected — format {detection.discordToken.valid ? 'looks valid' : 'looks invalid (expected id.secret.hmac)'}
                        </p>
                      )}
                      <p className="text-[11px] text-ink-muted">
                        Saving replaces the full variable set — keys you delete from this file are removed from the project too.
                      </p>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRawText(rawQuery.data !== undefined ? String(rawQuery.data) : '');
                      setRawDirty(false);
                    }}
                    disabled={!rawDirty}
                  >
                    Reset changes
                  </Button>
                  <Button variant="primary" loading={doImport.isPending} disabled={detection.keys.length === 0} onClick={saveRaw}>
                    <CheckCircle2 size={14} /> Save {detection.keys.length > 0 ? `${detection.keys.length} variables` : ''}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* paste .env modal (merge) */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Paste .env — auto-detect variables" wide>
        <TextArea
          mono
          value={importText}
          spellCheck={false}
          onChange={(e) => setImportText(e.target.value)}
          rows={10}
          placeholder={'DISCORD_TOKEN=MTIz…\nDATABASE_URL=postgres://…\n# comments and quotes are supported'}
          aria-label=".env content"
        />
        {importDetection.keys.length > 0 && (
          <div className="mt-3 rounded-lg border border-ink-border bg-ink-field px-3.5 py-2.5 text-xs">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1 font-medium text-ink-text">
                <ScanSearch size={12} className="text-eplyd" /> Detected {importDetection.keys.length} variable{importDetection.keys.length === 1 ? '' : 's'}
              </span>
              {importDetection.secrets.length > 0 && (
                <span className="inline-flex items-center gap-1 text-eplyd">
                  <Lock size={11} /> {importDetection.secrets.length} secret{importDetection.secrets.length === 1 ? '' : 's'}
                </span>
              )}
              {importDetection.discordToken?.present && (
                <span className={importDetection.discordToken.valid ? 'text-eplyd' : 'text-amber-300'}>
                  DISCORD_TOKEN {importDetection.discordToken.valid ? 'looks valid' : 'format looks off'}
                </span>
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {importDetection.keys.slice(0, 10).map((k) => (
                <span key={k} className="rounded border border-ink-border bg-ink-panel2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                  {k}
                </span>
              ))}
              {importDetection.keys.length > 10 && <span className="self-center text-[11px] text-ink-muted">+{importDetection.keys.length - 10} more</span>}
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setImportOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!importText.trim()} onClick={() => doImport.mutate({ text: importText, mode: 'merge' })} loading={doImport.isPending}>
            Import {importDetection.keys.length > 0 ? `${importDetection.keys.length} variables` : ''}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteKey !== null}
        title="Delete variable?"
        body={`Remove "${deleteKey}"? The running process keeps it until the next restart.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteKey) update.mutate({ delete: [deleteKey] });
          setDeleteKey(null);
        }}
        onClose={() => setDeleteKey(null)}
      />
    </div>
  );
}
