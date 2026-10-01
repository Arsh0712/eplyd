import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { Download, Pause, Play, RefreshCcw, Search, TerminalSquare, Trash2, Clock } from 'lucide-react';
import { api, fileDownloadUrl, wsUrl } from '../../api/client';
import type { LogLine } from '../../api/types';
import { useToast } from '../../state/toast';
import { Button, ConfirmDialog, Input, Segmented } from '../../components/ui';
import type { ProjectCtx } from './ProjectLayout';

const TERM_THEME = {
  background: '#0B0F0E',
  foreground: '#D9E4DF',
  cursor: '#3DDC97',
  selectionBackground: '#1C3A2E',
  black: '#0B0F0E',
  green: '#3DDC97',
  red: '#f87171',
  yellow: '#e5c07b',
  blue: '#7cc7ff',
  magenta: '#c792ea',
  cyan: '#89ddff'
};

type View = 'logs' | 'shell';

export default function ConsolePage(): JSX.Element {
  const { project } = useOutletContext<ProjectCtx>();
  const id = project.id;
  const toast = useToast();
  const qc = useQueryClient();

  const [view, setView] = useState<View>('logs');
  const [paused, setPaused] = useState(false);
  const [timestamps, setTimestamps] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const [status, setStatus] = useState(project.proc?.status || 'stopped');
  const [detail, setDetail] = useState<string | undefined>(project.proc?.statusDetail);
  const [killOpen, setKillOpen] = useState(false);

  const logHost = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pausedBuf = useRef<LogLine[]>([]);
  const pausedRef = useRef(false);
  const autoscrollRef = useRef(true);
  const tsRef = useRef(false);

  pausedRef.current = paused;
  autoscrollRef.current = autoscroll;
  tsRef.current = timestamps;

  // ---------- logs terminal ----------
  useEffect(() => {
    const host = logHost.current;
    if (!host) return;
    const term = new Terminal({
      convertEol: true,
      fontSize: 12.5,
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      theme: TERM_THEME,
      scrollback: 8000,
      disableStdin: true,
      allowProposedApi: true
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    term.writeln('\x1b[38;5;71mEplyD console — streaming stdout/stderr with ANSI colors.\x1b[0m');

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(host);
    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    // re-fit when switching views so the hidden pane sizes correctly later
    if (view === 'logs') setTimeout(() => fitRef.current?.fit(), 50);
  }, [view]);

  const writeLine = (line: LogLine): void => {
    const term = termRef.current;
    if (!term) return;
    const ts = tsRef.current ? `[${new Date(line.t).toLocaleTimeString()}] ` : '';
    const text = line.d.endsWith('\n') ? line.d : `${line.d}\r\n`;
    if (line.s === 'err') term.write(`\x1b[38;5;203m${ts}${text}\x1b[0m`);
    else if (line.s === 'sys') term.write(`\x1b[38;5;71m${ts}${text}\x1b[0m`);
    else term.write(`${ts}${text}`);
  };

  // ---------- logs websocket ----------
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = (): void => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl(`/ws/projects/${id}/logs`));
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { type: string; line?: LogLine; status?: string; detail?: string };
          if (msg.type === 'log' && msg.line) {
            if (pausedRef.current) pausedBuf.current.push(msg.line);
            else writeLine(msg.line);
          } else if (msg.type === 'status') {
            setStatus(msg.status || 'stopped');
            setDetail(msg.detail);
            void qc.invalidateQueries({ queryKey: ['project', id] });
          }
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        if (!disposed) retry = setTimeout(connect, 2500);
      };
      wsRef.current = ws;
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!paused && pausedBuf.current.length > 0) {
      const buf = pausedBuf.current;
      pausedBuf.current = [];
      for (const line of buf) writeLine(line);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // ---------- shell terminal ----------
  const shellHost = useRef<HTMLDivElement>(null);
  const shellTermRef = useRef<Terminal | null>(null);
  const shellFitRef = useRef<FitAddon | null>(null);
  const shellWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (view !== 'shell') return;
    const host = shellHost.current;
    if (!host) return;
    const term = new Terminal({
      convertEol: true,
      fontSize: 12.5,
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      theme: TERM_THEME,
      cursorBlink: true,
      scrollback: 5000
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    shellTermRef.current = term;
    shellFitRef.current = fit;

    const ws = new WebSocket(wsUrl(`/ws/projects/${id}/terminal`));
    shellWsRef.current = ws;
    ws.onopen = () => {
      term.writeln('\x1b[38;5;71mInteractive shell in the project directory. Type commands (npm install, pip install…).\x1b[0m\r\n');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (ev) => term.write(ev.data as string);
    ws.onclose = () => term.write('\r\n\x1b[38;5;203m[shell disconnected]\x1b[0m\r\n');
    term.onData((d) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    });
    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });
    ro.observe(host);
    term.focus();
    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
      shellTermRef.current = null;
    };
  }, [view, id]);

  // ---------- actions ----------
  const act = useMutation({
    mutationFn: (action: string) => api(`/projects/${id}/${action}`, { method: 'POST', body: {} }),
    onSuccess: (_d, action) => {
      toast.push(`${action === 'install' ? 'Dependency install' : action} requested`, 'ok');
      void qc.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : 'Action failed', 'error')
  });

  const clearLogs = async (): Promise<void> => {
    try {
      await api(`/projects/${id}/logs`, { method: 'DELETE' });
      termRef.current?.clear();
      toast.push('Log history cleared', 'ok');
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  const doSearch = (): void => {
    if (searchVal && searchRef.current) searchRef.current.findNext(searchVal);
  };

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { id: 'logs', label: 'Logs' },
            { id: 'shell', label: 'Terminal', icon: <TerminalSquare size={13} /> }
          ]}
          ariaLabel="Console views"
        />

        {view === 'logs' ? (
          <>
            <Button variant="subtle" onClick={() => setPaused(!paused)} aria-pressed={paused}>
              {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant={timestamps ? 'primary' : 'subtle'} onClick={() => setTimestamps(!timestamps)} aria-pressed={timestamps}>
              <Clock size={13} /> Timestamps
            </Button>
            <Button variant={autoscroll ? 'primary' : 'subtle'} onClick={() => setAutoscroll(!autoscroll)} aria-pressed={autoscroll}>
              Auto-scroll
            </Button>
            <Button variant="subtle" onClick={() => setSearchOpen(!searchOpen)} aria-expanded={searchOpen}>
              <Search size={13} /> Find
            </Button>
            <a href={fileDownloadUrl(`/projects/${id}/logs/download`)} download className="inline-flex">
              <Button variant="subtle">
                <Download size={13} /> Download
              </Button>
            </a>
            <Button variant="subtle" onClick={() => void clearLogs()}>
              <Trash2 size={13} /> Clear
            </Button>
          </>
        ) : (
          <Button
            variant="subtle"
            onClick={() => {
              shellWsRef.current?.close();
              // force re-open by toggling view
              setView('logs');
              setTimeout(() => setView('shell'), 50);
            }}
          >
            <RefreshCcw size={13} /> Reconnect shell
          </Button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="subtle" onClick={() => act.mutate('install')} loading={act.isPending}>
            Install deps
          </Button>
          {['running', 'starting', 'queued', 'checking_deps', 'installing', 'building'].includes(status) ? (
            <Button variant="subtle" onClick={() => act.mutate('stop')} loading={act.isPending}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={() => act.mutate('start')} loading={act.isPending}>
              Start
            </Button>
          )}
          <Button variant="subtle" onClick={() => act.mutate('restart')} loading={act.isPending}>
            Restart
          </Button>
          <Button variant="danger" onClick={() => setKillOpen(true)}>
            Kill
          </Button>
        </div>
      </div>

      {searchOpen && view === 'logs' && (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="Search logs… (Enter)"
            className="!w-64"
            aria-label="Search logs"
          />
          <Button variant="subtle" onClick={doSearch}>
            Find next
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              searchRef.current?.clearDecorations();
              setSearchOpen(false);
            }}
          >
            Close
          </Button>
        </div>
      )}

      {detail && !['running', 'stopped'].includes(status) && (
        <p className="rounded-lg border border-ink-border bg-ink-panel px-3 py-2 text-xs text-ink-muted">{detail}</p>
      )}

      {/* panes */}
      <div className={`h-[62vh] overflow-hidden rounded-xl border border-ink-border bg-[#0B0F0E] p-2 ${view === 'logs' ? '' : 'hidden'}`}>
        <div ref={logHost} className="xterm-host" />
      </div>
      <div className={`h-[62vh] overflow-hidden rounded-xl border border-ink-border bg-[#0B0F0E] p-2 ${view === 'shell' ? '' : 'hidden'}`}>
        <div ref={shellHost} className="xterm-host" />
      </div>

      <p className="text-xs text-ink-muted">
        Pipeline stages appear here: queued → checking deps → installing → building → starting → running. Replays the last 500 lines on reconnect.
      </p>

      <ConfirmDialog
        open={killOpen}
        title="Kill process?"
        body="Send SIGKILL to the whole process group immediately."
        confirmLabel="Kill now"
        onConfirm={() => {
          act.mutate('kill');
          setKillOpen(false);
        }}
        onClose={() => setKillOpen(false)}
      />
    </div>
  );
}
