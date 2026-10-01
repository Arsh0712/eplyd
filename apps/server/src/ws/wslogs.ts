import type { WebSocket } from 'ws';
import { getManager } from '../supervisor/manager';
import { getLogStore } from '../lib/ringbuffer';
import { config } from '../config';

/** /ws/projects/:id/logs — replay recent history, then stream live. */
export function handleLogsChannel(ws: WebSocket, projectId: string): void {
  const manager = getManager();
  manager.ensureLoaded();

  const send = (payload: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  // 1) Replay the last 500 lines from the persistent log store.
  const store = getLogStore(projectId, config.dirs.logs, config.logMaxBytes);
  for (const line of store.tailLines(500)) {
    send({ type: 'log', line });
  }
  // 2) Current status.
  const snap = manager.snapshot(projectId);
  send({ type: 'status', status: snap.status, detail: snap.statusDetail });

  // 3) Live stream.
  const onLog = (id: string, line: unknown): void => {
    if (id === projectId) send({ type: 'log', line });
  };
  const onStatus = (id: string, status: string, detail?: string): void => {
    if (id === projectId) send({ type: 'status', status, detail });
  };
  manager.bus.on('log', onLog);
  manager.bus.on('status', onStatus);
  ws.on('close', () => {
    manager.bus.off('log', onLog);
    manager.bus.off('status', onStatus);
  });
}
