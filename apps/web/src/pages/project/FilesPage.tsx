import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import {
  ChevronDown, ChevronRight, Download, FileCode2, FilePlus2, FolderPlus, FolderTree,
  Pencil, RotateCcw, Save, Trash2, Upload, Copy, Eye, EyeOff
} from 'lucide-react';
import { api, uploadWithProgress, fileDownloadUrl } from '../../api/client';
import type { FileEntry } from '../../api/types';
import '../../lib/monaco';
import { useToast } from '../../state/toast';
import { Button, ConfirmDialog, Input, Modal, Toggle } from '../../components/ui';
import type { ProjectCtx } from './ProjectLayout';

interface OpenTab {
  path: string;
  content: string;
  dirty: boolean;
  image?: boolean;
}

const LANGS: [RegExp, string][] = [
  [/\.(js|mjs|cjs)$/, 'javascript'],
  [/\.(ts|tsx)$/, 'typescript'],
  [/\.py$/, 'python'],
  [/\.java$/, 'java'],
  [/\.json$/, 'json'],
  [/\.md$/, 'markdown'],
  [/\.(css|scss)$/, 'css'],
  [/\.html?$/, 'html'],
  [/\.(yml|yaml)$/, 'yaml'],
  [/\.env/, 'ini'],
  [/\.toml$/, 'ini'],
  [/\.(sh|bash)$/, 'shell'],
  [/\.(sql)$/, 'sql']
];

function langOf(path: string): string {
  for (const [rx, lang] of LANGS) if (rx.test(path)) return lang;
  return 'plaintext';
}

export default function FilesPage(): JSX.Element {
  const { project } = useOutletContext<ProjectCtx>();
  const id = project.id;
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const [tree, setTree] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [hideDeps, setHideDeps] = useState(true);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<'newfile' | 'newfolder' | 'rename' | null>(null);
  const [modalName, setModalName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  const loadDir = useCallback(
    async (path: string): Promise<FileEntry[]> => {
      try {
        const res = await api<{ entries: FileEntry[] }>(`/projects/${id}/files?path=${encodeURIComponent(path || '.')}${hideDeps ? '' : '&deps=1'}`);
        setTree((t) => ({ ...t, [path]: res.entries }));
        return res.entries;
      } catch (e) {
        toast.push(e instanceof Error ? e.message : 'Failed to list directory', 'error');
        return [];
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, hideDeps]
  );

  useEffect(() => {
    void loadDir('');
    setExpanded(new Set(['']));
    setTabs([]);
    setActive(null);
  }, [loadDir]);

  const entriesAt = (path: string): FileEntry[] => tree[path] ?? [];

  const toggleDir = (path: string): void => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!tree[path]) void loadDir(path);
    }
    setExpanded(next);
  };

  const openFile = useCallback(
    async (path: string): Promise<void> => {
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setActive(path);
        return;
      }
      try {
        const res = await api<{ binary: boolean; content?: string; image?: boolean }>(
          `/projects/${id}/files/content?path=${encodeURIComponent(path)}`
        );
        if (res.binary) {
          if (res.image) {
            setTabs((t) => [...t, { path, content: '', dirty: false, image: true }]);
            setActive(path);
          } else {
            toast.push('Binary file — too large or non-text. Download it instead.', 'info');
          }
          return;
        }
        setTabs((t) => [...t, { path, content: res.content ?? '', dirty: false }]);
        setActive(path);
        setParams((p) => {
          const np = new URLSearchParams(p);
          np.set('path', path);
          return np;
        });
      } catch (e) {
        toast.push(e instanceof Error ? e.message : 'Cannot open file', 'error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, tabs]
  );

  // deep link ?path=
  useEffect(() => {
    const p = params.get('path');
    if (p && !tabs.some((t) => t.path === p)) {
      // open parent dirs
      const parts = p.split('/');
      const next = new Set<string>(['']);
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
        next.add(acc);
        void loadDir(acc);
      }
      setExpanded((e) => new Set([...e, ...next]));
      void openFile(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (restart = false): Promise<void> => {
    const path = activeRef.current;
    const tab = tabs.find((t) => t.path === path);
    if (!tab || tab.image) return;
    setSaving(true);
    try {
      await api(`/projects/${id}/files/content`, { method: 'PUT', body: { path: tab.path, content: tab.content } });
      setTabs((t) => t.map((x) => (x.path === tab.path ? { ...x, dirty: false } : x)));
      toast.push(restart ? 'Saved — restarting…' : 'Saved', 'ok');
      void qc.invalidateQueries({ queryKey: ['project', id] });
      if (restart) await api(`/projects/${id}/restart`, { method: 'POST', body: {} });
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  const closeTab = (path: string): void => {
    const tab = tabs.find((t) => t.path === path);
    if (tab?.dirty && !window.confirm(`"${path}" has unsaved changes. Close anyway?`)) return;
    setTabs((t) => t.filter((x) => x.path !== path));
    if (active === path) {
      const rest = tabs.filter((x) => x.path !== path);
      setActive(rest.length > 0 ? rest[rest.length - 1]!.path : null);
    }
  };

  // mutations: create/rename/move/copy/delete/upload
  const mutate = useMutation({
    mutationFn: async ({ op, data }: { op: string; data?: Record<string, unknown> }) => {
      switch (op) {
        case 'mkdir':
          return api(`/projects/${id}/files/mkdir`, { method: 'POST', body: data });
        case 'move':
          return api(`/projects/${id}/files/move`, { method: 'POST', body: data });
        case 'copy':
          return api(`/projects/${id}/files/copy`, { method: 'POST', body: data });
        case 'delete':
          return api(`/projects/${id}/files?path=${encodeURIComponent(String(data?.path))}`, { method: 'DELETE' });
        default:
          throw new Error('unknown op');
      }
    },
    onSuccess: (_d, v) => {
      if (v.op === 'delete') toast.push('Deleted', 'ok');
      if (v.op === 'mkdir') toast.push('Folder created', 'ok');
      // refresh affected dirs
      const paths = new Set<string>(['']);
      const collect = (p: string): void => {
        const i = p.lastIndexOf('/');
        if (i > 0) {
          paths.add(p.slice(0, i));
          collect(p.slice(0, i));
        }
      };
      if (selected) collect(selected);
      if (modalName) collect(modalName.includes('/') ? modalName : `${selected || ''}/${modalName}`);
      for (const p of paths) void loadDir(p);
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Operation failed', 'error')
  });

  const submitModal = (): void => {
    if (!modal) return;
    const base = selected && (tree[selected.split('/').slice(0, -1).join('/')] || []).some((e) => e.path === selected && e.type === 'dir') ? selected : '';
    if (modal === 'newfile' || modal === 'newfolder') {
      const path = `${base ? base + '/' : ''}${modalName}`.replace(/^\/+/, '');
      if (modal === 'newfolder') {
        mutate.mutate({ op: 'mkdir', data: { path } });
      } else {
        // create empty file via save
        void api(`/projects/${id}/files/content`, { method: 'PUT', body: { path, content: '' } }).then(() => {
          toast.push('File created', 'ok');
          void loadDir(base);
        });
      }
    } else if (modal === 'rename' && selected) {
      const parent = selected.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '';
      const to = `${parent ? parent + '/' : ''}${modalName}`;
      mutate.mutate({ op: 'move', data: { from: selected, to } });
    }
    setModal(null);
    setModalName('');
  };

  const duplicate = async (): Promise<void> => {
    if (!selected) return;
    const i = selected.lastIndexOf('.');
    const parent = selected.includes('/') ? selected.slice(0, selected.lastIndexOf('/')) : '';
    const base = selected.slice((parent ? parent.length + 1 : 0));
    const to = i > 0 ? `${base.slice(0, base.lastIndexOf('.'))}-copy${base.slice(base.lastIndexOf('.'))}` : `${base}-copy`;
    mutate.mutate({ op: 'copy', data: { from: selected, to: `${parent ? parent + '/' : ''}${to}` } });
  };

  const uploadFile = async (f: File): Promise<void> => {
    const dir = selected && entriesAt(dirOf(selected)).some((e) => e.path === selected && e.type === 'dir') ? selected : '';
    try {
      const buf = await f.arrayBuffer();
      await uploadWithProgress(`/projects/${id}/files/upload?path=${encodeURIComponent(dir || '.')}&name=${encodeURIComponent(f.name)}`, buf, () => {});
      toast.push(`Uploaded ${f.name}`, 'ok');
      void loadDir(dir);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Upload failed', 'error');
    }
  };

  const wipeFiles = async (): Promise<void> => {
    try {
      const entries = await api<{ entries: FileEntry[] }>(`/projects/${id}/files?path=.&deps=1`);
      for (const e of entries.entries) {
        if (e.name === '.eplyd') continue;
        await api(`/projects/${id}/files?path=${encodeURIComponent(e.path)}`, { method: 'DELETE' });
      }
      toast.push('All files wiped', 'ok');
      setTree({});
      setTabs([]);
      setActive(null);
      void loadDir('');
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Wipe failed', 'error');
    }
  };

  const activeTab = tabs.find((t) => t.path === active);

  const Tree = useMemo(
    () =>
      function TreeNodes({ path, depth }: { path: string; depth: number }): JSX.Element {
        const entries = entriesAt(path);
        return (
          <>
            {entries
              .filter((e) => hideDeps || !['node_modules', 'venv', '.git', '__pycache__'].includes(e.name))
              .map((e) => (
                <div key={e.path}>
                  <button
                    onClick={() => {
                      setSelected(e.path);
                      if (e.type === 'dir') toggleDir(e.path);
                      else void openFile(e.path);
                    }}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] hover:bg-ink-panel2 ${
                      selected === e.path ? 'bg-ink-panel2 text-eplyd' : e.type === 'dir' ? 'text-ink-text' : 'text-ink-muted'
                    }`}
                    style={{ paddingLeft: depth * 14 + 6 }}
                  >
                    {e.type === 'dir' ? (
                      expanded.has(e.path) ? (
                        <ChevronDown size={13} className="shrink-0" />
                      ) : (
                        <ChevronRight size={13} className="shrink-0" />
                      )
                    ) : (
                      <FileCode2 size={13} className="shrink-0" />
                    )}
                    <span className="truncate">{e.name}</span>
                    {e.type === 'file' && <span className="ml-auto shrink-0 text-[10px] text-ink-muted">{e.size > 1024 ? `${(e.size / 1024).toFixed(0)}K` : e.size}</span>}
                  </button>
                  {e.type === 'dir' && expanded.has(e.path) && <TreeNodes path={e.path} depth={depth + 1} />}
                </div>
              ))}
          </>
        );
      },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, expanded, selected, hideDeps, tabs]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* tree panel */}
      <div className="rounded-xl border border-ink-border bg-ink-panel">
        <div className="flex items-center gap-1 border-b border-ink-border p-2">
          <FolderTree size={14} className="text-ink-muted" />
          <span className="text-xs text-ink-muted">/root</span>
          <div className="ml-auto flex items-center gap-1">
            <button title={hideDeps ? 'Show node_modules/venv/.git' : 'Hide deps'} onClick={() => setHideDeps(!hideDeps)} className="rounded p-1 text-ink-muted hover:text-ink-text" aria-label="Toggle dependency folders">
              {hideDeps ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
        </div>
        <div className="max-h-[30vh] overflow-y-auto p-1.5 lg:max-h-[58vh]">
          <Tree path="" depth={0} />
        </div>
        <div className="flex flex-wrap gap-1 border-t border-ink-border p-2">
          <Button variant="subtle" title="New file" onClick={() => { setModal('newfile'); setModalName(''); }}>
            <FilePlus2 size={13} />
          </Button>
          <Button variant="subtle" title="New folder" onClick={() => { setModal('newfolder'); setModalName(''); }}>
            <FolderPlus size={13} />
          </Button>
          <Button variant="subtle" title="Upload file" onClick={() => uploadRef.current?.click()}>
            <Upload size={13} />
          </Button>
          <input ref={uploadRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0])} />
          <Button variant="subtle" title="Rename" disabled={!selected} onClick={() => { setModal('rename'); setModalName(selected?.split('/').pop() || ''); }}>
            <Pencil size={13} />
          </Button>
          <Button variant="subtle" title="Duplicate" disabled={!selected} onClick={() => void duplicate()}>
            <Copy size={13} />
          </Button>
          <Button
            variant="subtle"
            title="Download"
            disabled={!selected || !selected.includes('.')}
            onClick={() => selected && window.open(fileDownloadUrl(`/projects/${id}/files/raw?path=${encodeURIComponent(selected)}&download=1`), '_blank')}
          >
            <Download size={13} />
          </Button>
          <Button variant="subtle" title="Delete" disabled={!selected} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={13} />
          </Button>
          <Button
            variant="subtle"
            title="Refresh"
            onClick={() => {
              setTree({});
              void loadDir('');
            }}
          >
            <RotateCcw size={13} />
          </Button>
        </div>
        {selected && <p className="border-t border-ink-border px-3 py-1.5 text-[11px] text-ink-muted">Selected: {selected}</p>}
      </div>

      {/* editor panel */}
      <div className="min-w-0 rounded-xl border border-ink-border bg-ink-panel">
        {/* tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-border p-1.5">
          {tabs.length === 0 && <span className="px-2 text-xs text-ink-muted">No file open — pick one from the tree</span>}
          {tabs.map((t) => (
            <div
              key={t.path}
              className={`group flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                active === t.path ? 'border-eplyd/40 bg-eplyd/10 text-eplyd' : 'border-ink-border text-ink-muted hover:text-ink-text'
              }`}
            >
              <button onClick={() => setActive(t.path)} className="max-w-[180px] truncate font-mono">
                {t.path.split('/').pop()}
                {t.dirty && <span className="ml-1 text-amber-400">●</span>}
              </button>
              <button onClick={() => closeTab(t.path)} aria-label={`Close ${t.path}`} className="opacity-50 hover:opacity-100">
                ×
              </button>
            </div>
          ))}
          {activeTab && !activeTab.image && (
            <div className="ml-auto flex shrink-0 gap-1.5 pr-1">
              <Button variant="primary" onClick={() => void save(false)} loading={saving} title="Ctrl/Cmd+S">
                <Save size={13} /> Save
              </Button>
              <Button variant="subtle" onClick={() => void save(true)} loading={saving}>
                <RotateCcw size={13} /> Save & Restart
              </Button>
            </div>
          )}
        </div>

        {/* editor / preview */}
        <div className="h-[58vh]">
          {!activeTab ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-muted">Select a file to edit. Changes are saved with Ctrl/Cmd+S.</div>
          ) : activeTab.image ? (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              <img src={fileDownloadUrl(`/projects/${id}/files/raw?path=${encodeURIComponent(activeTab.path)}`)} alt={activeTab.path} className="max-h-full max-w-full rounded-lg" />
            </div>
          ) : (
            <Editor
              height="100%"
              theme="eplyd-dark"
              language={langOf(activeTab.path)}
              value={activeTab.content}
              onChange={(v) => setTabs((t) => t.map((x) => (x.path === activeTab.path ? { ...x, content: v ?? '', dirty: true } : x)))}
              options={{ fontSize: 13.5, fontFamily: '"JetBrains Mono", monospace', minimap: { enabled: true }, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, renderWhitespace: 'selection' }}
            />
          )}
        </div>
      </div>

      {/* modals */}
      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === 'rename' ? 'Rename' : modal === 'newfolder' ? 'New folder' : 'New file'}>
        <Input
          autoFocus
          value={modalName}
          onChange={(e) => setModalName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitModal()}
          placeholder={modal === 'rename' ? 'new-name.ext' : 'name or path/to/name'}
          aria-label="Name"
        />
        <p className="mt-2 text-xs text-ink-muted">Created inside: {selected && treeEntriesHasDir(selected) ? selected : 'project root'}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submitModal} disabled={!modalName.trim()}>
            {modal === 'rename' ? 'Rename' : 'Create'}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete file/folder?"
        body={`Delete "${selected}"? Folders are deleted recursively. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (selected) mutate.mutate({ op: 'delete', data: { path: selected } });
          setTabs((t) => t.filter((x) => x.path !== selected));
          setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );

  function dirOf(p: string): string {
    return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  }

  function treeEntriesHasDir(p: string): boolean {
    const parent = dirOf(p);
    const list = tree[parent] || [];
    return list.some((e) => e.path === p && e.type === 'dir');
  }
}
