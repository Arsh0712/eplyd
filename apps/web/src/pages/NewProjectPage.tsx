import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudUpload, FileArchive, GitBranch, Package } from 'lucide-react';
import { api, uploadWithProgress } from '../api/client';
import { useToast } from '../state/toast';
import { Button, Card, Field, Input, Select } from '../components/ui';
import { useTitle } from '../lib/format';
import type { Project } from '../api/types';

type Tab = 'zip' | 'template' | 'git';

export default function NewProjectPage(): JSX.Element {
  useTitle('New project');
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('zip');

  // zip
  const [zipName, setZipName] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // template
  const [tplName, setTplName] = useState('');
  const [tpl, setTpl] = useState<'discordpy' | 'discordjs' | 'empty'>('discordpy');

  // git
  const [gitName, setGitName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [busy, setBusy] = useState(false);

  const pickFile = (f: File | null): void => {
    if (!f) return;
    if (!/\.(zip)$/i.test(f.name)) {
      toast.push('Please choose a .zip file', 'error');
      return;
    }
    setZipFile(f);
    if (!zipName) setZipName(f.name.replace(/\.zip$/i, '').slice(0, 64));
  };

  const createZip = async (): Promise<void> => {
    if (!zipFile) return;
    setBusy(true);
    try {
      const created = await api<{ project: Project }>('/projects', {
        method: 'POST',
        body: { name: zipName || 'ZIP import', description: 'Imported from ZIP' }
      });
      const id = created.project.id;
      setProgress(0);
      const buf = await zipFile.arrayBuffer();
      await uploadWithProgress(`/projects/${id}/upload-zip?mode=replace`, buf, (f) => setProgress(f));
      toast.push('ZIP imported — files extracted', 'ok');
      navigate(`/projects/${id}/console`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Import failed', 'error');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const createTemplate = async (): Promise<void> => {
    setBusy(true);
    try {
      const created = await api<{ project: Project }>('/projects', {
        method: 'POST',
        body: { name: tplName || 'My bot', template: tpl }
      });
      toast.push('Project created — press Start to install dependencies and run', 'ok');
      navigate(`/projects/${created.project.id}/console`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const createGit = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api<{ project: Project; gitWarning?: string }>('/projects', {
        method: 'POST',
        body: { name: gitName || 'Git import', gitUrl, gitToken: gitToken || undefined }
      });
      if (res.gitWarning) toast.push(`Cloned with warning: ${res.gitWarning}`, 'info');
      else toast.push('Repository cloned', 'ok');
      navigate(`/projects/${res.project.id}/console`);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Git import failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof FileArchive }[] = [
    { id: 'zip', label: 'Upload ZIP', icon: FileArchive },
    { id: 'template', label: 'Empty / template', icon: Package },
    { id: 'git', label: 'Import from Git', icon: GitBranch }
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-ink-muted">Every project runs on this host with its own files, variables and console.</p>
      </div>

      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
              tab === t.id ? 'border-eplyd/40 bg-eplyd/10 text-eplyd' : 'border-ink-border bg-ink-panel text-ink-muted hover:text-ink-text'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'zip' && (
        <Card className="p-6">
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload ZIP drop zone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files[0] ?? null);
            }}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? 'border-eplyd/60 bg-eplyd/5' : 'border-ink-border hover:border-eplyd/40'
            }`}
          >
            <CloudUpload size={28} className="text-eplyd" />
            {zipFile ? (
              <p className="text-sm">
                <span className="font-medium">{zipFile.name}</span>{' '}
                <span className="text-ink-muted">({(zipFile.size / 1024 / 1024).toFixed(1)} MB) — click to change</span>
              </p>
            ) : (
              <p className="text-sm text-ink-muted">
                Drag & drop your bot ZIP here, or click to browse.
                <br />
                <span className="text-xs">Up to 500 MB — extracted safely with zip-slip protection.</span>
              </p>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {progress !== null && (
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink-panel2" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full bg-eplyd transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <div className="mt-4 flex items-end gap-3">
            <Field label="Project name">
              <Input value={zipName} onChange={(e) => setZipName(e.target.value)} placeholder="my-discord-bot" />
            </Field>
            <Button variant="primary" disabled={!zipFile || busy || progress !== null} onClick={createZip} loading={busy}>
              Upload & create
            </Button>
          </div>
        </Card>
      )}

      {tab === 'template' && (
        <Card className="space-y-4 p-6">
          <p className="text-sm text-ink-muted">
            Start from a ready-to-run Discord bot. Dependencies are detected from the manifest and installed automatically on first start.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                { id: 'discordpy', title: 'discord.py', desc: 'Python 3.12 · requirements.txt' },
                { id: 'discordjs', title: 'discord.js', desc: 'Node 20 · package.json' },
                { id: 'empty', title: 'Empty', desc: 'Bring your own files' }
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTpl(t.id)}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  tpl === t.id ? 'border-eplyd/50 bg-eplyd/10' : 'border-ink-border bg-ink-panel2 hover:border-eplyd/30'
                }`}
              >
                <p className="font-mono text-sm">{t.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{t.desc}</p>
              </button>
            ))}
          </div>
          <div className="flex items-end gap-3">
            <Field label="Project name">
              <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="My awesome bot" />
            </Field>
            <Button variant="primary" onClick={createTemplate} loading={busy}>
              Create project
            </Button>
          </div>
        </Card>
      )}

      {tab === 'git' && (
        <Card className="space-y-4 p-6">
          <p className="text-sm text-ink-muted">Clone a public repository (or a private one with a personal access token) into a new project.</p>
          <Field label="Repository URL">
            <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/user/my-bot.git" />
          </Field>
          <Field label="Access token (optional — for private repos)" hint="Used once for this clone; never stored.">
            <Input type="password" value={gitToken} onChange={(e) => setGitToken(e.target.value)} placeholder="ghp_…" />
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Project name">
              <Input value={gitName} onChange={(e) => setGitName(e.target.value)} placeholder="my-bot" />
            </Field>
            <Button variant="primary" disabled={!gitUrl || busy} onClick={createGit} loading={busy}>
              Clone & create
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
