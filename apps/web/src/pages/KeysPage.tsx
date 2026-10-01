import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { KeyEntry } from '../api/types';
import { useToast } from '../state/toast';
import { Badge, Button, Card, ConfirmDialog, CopyButton, EmptyState, Field, Input, Modal } from '../components/ui';
import { timeAgo, useTitle } from '../lib/format';

interface OwnerKeyInfo {
  ownerLastUsedAt: number | null;
}

export default function KeysPage(): JSX.Element {
  useTitle('Access keys');
  const toast = useToast();
  const qc = useQueryClient();
  const [genOpen, setGenOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [freshKey, setFreshKey] = useState<{ id: string; key: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameLabel, setRenameLabel] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['keys'],
    queryFn: () => api<{ keys: KeyEntry[]; activeCount: number; ownerLastUsedAt?: number | null }>('/keys')
  });

  const create = useMutation({
    mutationFn: () => api<{ id: string; key: string }>('/keys', { method: 'POST', body: { label } }),
    onSuccess: (res) => {
      setFreshKey(res);
      setGenOpen(false);
      setLabel('');
      void qc.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Failed', 'error')
  });

  const reveal = useMutation({
    mutationFn: (id: string) => api<{ key: string }>(`/keys/${id}/reveal`, { method: 'POST', body: {} }),
    onSuccess: (res, id) => {
      setRevealed((r) => ({ ...r, [id]: res.key }));
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Reveal failed', 'error')
  });

  const rename = useMutation({
    mutationFn: () => api(`/keys/${renameId}`, { method: 'PATCH', body: { label: renameLabel } }),
    onSuccess: () => {
      toast.push('Key renamed', 'ok');
      setRenameId(null);
      void qc.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Failed', 'error')
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.push('Key revoked — its sessions were signed out', 'ok');
      setRevokeId(null);
      void qc.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Failed', 'error')
  });

  const keys = data?.keys ?? [];
  const active = keys.filter((k) => !k.revokedAt);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Access keys</h1>
          <p className="text-sm text-ink-muted">Guests log in with a key and only see projects they create themselves.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge>{active.length} active</Badge>
          <Button variant="subtle" onClick={() => void refetch()} aria-label="Refresh keys">
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </Button>
          <Button variant="primary" onClick={() => setGenOpen(true)}>
            <Plus size={15} /> Generate guest key
          </Button>
        </div>
      </div>

      {/* owner key card */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-eplyd/10 p-2.5 text-eplyd">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              Owner password <Badge className="!border-eplyd/30 !text-eplyd">full access</Badge>
            </p>
            <p className="mt-0.5 font-mono text-sm text-ink-muted">@r······ · last used {timeAgo(data?.ownerLastUsedAt)}</p>
            <p className="mt-1 text-xs text-ink-muted">
              Set via <code>ADMIN_PASSWORD</code> in the server's .env — stored only as an argon2id hash, never displayed in full.
            </p>
          </div>
        </div>
      </Card>

      {/* guest keys */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound size={26} />}
          title="No guest keys yet"
          body="Generate a key for a friend or a second machine. They can upload bots, edit files and watch consoles — but only for projects they create."
          action={
            <Button variant="primary" onClick={() => setGenOpen(true)}>
              <Plus size={15} /> Generate guest key
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <Card key={k.id} className={`flex flex-wrap items-center gap-3 p-4 ${k.revokedAt ? 'opacity-50' : ''}`}>
              <span className="rounded-lg bg-ink-panel2 p-2.5 text-ink-muted">
                <KeyRound size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {k.label} {k.revokedAt && <Badge>revoked {timeAgo(k.revokedAt)}</Badge>}
                </p>
                <p className="font-mono text-xs text-ink-muted">{revealed[k.id] || k.masked}</p>
                <p className="text-xs text-ink-muted">
                  last used {timeAgo(k.lastUsedAt)} · {k.activeSessions} active session{k.activeSessions === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {revealed[k.id] ? (
                  <CopyButton value={revealed[k.id]} label="Copy key" />
                ) : (
                  !k.revokedAt && (
                    <Button variant="subtle" onClick={() => reveal.mutate(k.id)} loading={reveal.isPending} aria-label={`Reveal ${k.label}`}>
                      <Eye size={13} /> Reveal
                    </Button>
                  )
                )}
                <Button
                  variant="subtle"
                  aria-label={`Rename ${k.label}`}
                  onClick={() => {
                    setRenameId(k.id);
                    setRenameLabel(k.label);
                  }}
                >
                  <Pencil size={13} />
                </Button>
                {!k.revokedAt && (
                  <Button variant="danger" aria-label={`Revoke ${k.label}`} onClick={() => setRevokeId(k.id)}>
                    <Trash2 size={13} /> Revoke
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* generate modal */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generate guest key">
        <Field label="Label" hint="Who or what is this key for? e.g. 'Stream helper'">
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Friend's laptop" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setGenOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!label.trim()} onClick={() => create.mutate()} loading={create.isPending}>
            Generate key
          </Button>
        </div>
      </Modal>

      {/* fresh key modal */}
      <Modal open={freshKey !== null} onClose={() => setFreshKey(null)} title="Guest key generated">
        <p className="mb-3 text-sm text-ink-muted">Copy it now — this is shown once in full. You can reveal it later from this page.</p>
        <code className="block break-all rounded-lg border border-eplyd/30 bg-eplyd/5 p-3 font-mono text-sm text-eplyd">{freshKey?.key}</code>
        <div className="mt-4 flex justify-end gap-2">
          <CopyButton value={freshKey?.key || ''} label="Copy key" className="!bg-eplyd !text-[#06110c] hover:!bg-eplyd-dim" />
          <Button variant="primary" onClick={() => setFreshKey(null)}>
            Done
          </Button>
        </div>
      </Modal>

      {/* rename modal */}
      <Modal open={renameId !== null} onClose={() => setRenameId(null)} title="Rename key">
        <Input autoFocus value={renameLabel} onChange={(e) => setRenameLabel(e.target.value)} aria-label="New label" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenameId(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!renameLabel.trim()} onClick={() => rename.mutate()} loading={rename.isPending}>
            Save
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={revokeId !== null}
        title="Revoke key?"
        body="All sessions signed in with this key are signed out immediately. Projects created by this guest stay on the server (owner can manage them)."
        confirmLabel="Revoke key"
        onConfirm={() => revokeId && revoke.mutate(revokeId)}
        onClose={() => setRevokeId(null)}
      />
    </div>
  );
}
