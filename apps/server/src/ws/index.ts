import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { actorFromRequest } from '../auth/session';
import type { Actor } from '../auth/session';
import { logger } from '../lib/log';
import { canAccessProject } from '../lib/access';
import { handleLogsChannel } from './wslogs';
import { handleTerminalChannel } from './terminal';
import { handleMetricsChannel } from './wsmetrics';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function actorFromUpgrade(req: IncomingMessage): Actor | null {
  const cookies = parseCookies(req.headers.cookie);
  return actorFromRequest({ cookies } as unknown as Parameters<typeof actorFromRequest>[0]);
}

/** Route + authenticate WebSocket channels. Cookies authenticate same-origin upgrades. */
export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  // Heartbeat: drop dead sockets.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if ((client as WebSocket & { isAlive?: boolean }).isAlive === false) {
        client.terminate();
        continue;
      }
      (client as WebSocket & { isAlive?: boolean }).isAlive = false;
      client.ping();
    }
  }, 30_000);
  heartbeat.unref?.();

  wss.on('connection', (ws: WebSocket) => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on('pong', () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });
  });

  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url || '/', 'http://internal');
    } catch {
      socket.destroy();
      return;
    }
    if (!url.pathname.startsWith('/ws/')) {
      socket.destroy();
      return;
    }
    const actor = actorFromUpgrade(req);
    if (!actor) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      const parts = url.pathname.split('/').filter(Boolean); // ['ws', ...]
      try {
        if (parts[1] === 'metrics' && parts.length === 2) {
          if (actor.kind !== 'owner') {
            ws.close(4403, 'owner only');
            return;
          }
          handleMetricsChannel(ws);
          return;
        }
        if (parts[1] === 'projects' && (parts[2] ?? '') .length > 0 && parts[3]) {
          const projectId = parts[2]!;
          const channel = parts[3]!;
          // Access check against the DB (server-side isolation, not just UI).
          const { getDb } = require('../db') as typeof import('../db');
          const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as { created_by: string } | undefined;
          if (!row || !canAccessProject(actor, row)) {
            ws.close(4403, 'forbidden');
            return;
          }
          if (channel === 'logs') {
            handleLogsChannel(ws, projectId);
            return;
          }
          if (channel === 'terminal') {
            handleTerminalChannel(ws, projectId, actor);
            return;
          }
        }
        ws.close(4404, 'unknown channel');
      } catch (err) {
        logger.error({ err }, 'ws channel error');
        try {
          ws.close(1011, 'internal error');
        } catch { /* ignore */ }
      }
    });
  });
}
