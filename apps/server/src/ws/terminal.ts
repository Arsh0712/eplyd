import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { WebSocket } from 'ws';
import { projectDir } from '../lib/projdir';
import { getManager } from '../supervisor/manager';
import { sanitizeBotEnv } from '../supervisor/runtimes';
import type { Actor } from '../auth/session';
import { logger } from '../lib/log';

type PtyModule = typeof import('node-pty') | null;
let ptyModule: PtyModule | undefined;

/** node-pty is optional (native build). Falls back to piped bash without TTY. */
function getPty(): PtyModule {
  if (ptyModule !== undefined) return ptyModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ptyModule = require('node-pty') as typeof import('node-pty');
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

interface TermMessage {
  type?: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

/**
 * /ws/projects/:id/terminal — interactive shell scoped to the project
 * directory, with the same sanitized env as the bot. Only the project owner
 * reaches this point (checked during upgrade).
 */
export function handleTerminalChannel(ws: WebSocket, projectId: string, actor: Actor): void {
  const manager = getManager();
  manager.ensureLoaded();

  let dir: string;
  try {
    dir = projectDir(projectId);
    if (!fs.existsSync(dir)) throw new Error('missing');
  } catch {
    ws.close(4404, 'project missing');
    return;
  }

  const send = (data: string): void => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  };

  const env = sanitizeBotEnv(manager.loadEnvVars(projectId), dir, { TERM: 'xterm-256color' });
  const note = `EplyD terminal — ${actor.kind === 'owner' ? 'owner' : 'guest'} — cwd: project root\r\n`;

  const pty = getPty();
  let cleanup = (): void => {};

  if (pty) {
    try {
      const term = pty.spawn('/bin/bash', ['-i'], {
        name: 'xterm-256color',
        cwd: dir,
        env: env as Record<string, string>,
        cols: 80,
        rows: 24
      });
      send(note);
      term.onData((d: string) => send(d));
      term.onExit(() => {
        try {
          ws.close();
        } catch { /* ignore */ }
      });
      cleanup = () => {
        try {
          term.kill();
        } catch { /* ignore */ }
      };
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as TermMessage;
          if (msg.type === 'input' && typeof msg.data === 'string') term.write(msg.data);
          else if (msg.type === 'resize' && msg.cols && msg.rows) term.resize(msg.cols, msg.rows);
        } catch {
          term.write(raw.toString());
        }
      });
    } catch (err) {
      logger.error({ err }, 'pty spawn failed');
      ws.close(1011, 'terminal spawn failed');
    }
  } else {
    // Fallback: piped bash (no TTY line editing, but install commands work).
    const child = spawn('/bin/bash', ['-i'], { cwd: dir, env: env as Record<string, string>, stdio: ['pipe', 'pipe', 'pipe'] });
    send(`${note}note: node-pty unavailable — running in basic pipe mode\r\n`);
    child.stdout?.on('data', (d: Buffer) => send(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => send(d.toString('utf8')));
    child.on('exit', () => {
      try {
        ws.close();
      } catch { /* ignore */ }
    });
    cleanup = () => {
      try {
        child.kill('SIGKILL');
      } catch { /* ignore */ }
    };
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as TermMessage;
        if (msg.type === 'input' && typeof msg.data === 'string') child.stdin?.write(msg.data);
      } catch {
        child.stdin?.write(raw.toString());
      }
    });
  }

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
