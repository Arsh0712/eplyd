import type { WebSocket } from 'ws';
import { getManager } from '../supervisor/manager';
import { hostMetrics } from '../lib/metrics';
import { config } from '../config';

/** /ws/metrics — host + per-project metrics, pushed every 2 seconds. */
export function handleMetricsChannel(ws: WebSocket): void {
  const manager = getManager();
  manager.ensureLoaded();

  const send = (): void => {
    if (ws.readyState !== ws.OPEN) return;
    const projects = manager.snapshotAll();
    const running = Object.values(projects).filter((p) => p.status === 'running').length;
    ws.send(
      JSON.stringify({
        type: 'metrics',
        host: hostMetrics(config.dirs.data),
        projects,
        running,
        reservedRamMb: config.platformReservedRamMb,
        queuedInstalls: Object.values(projects).reduce((a, p) => a + (p.queuedInstalls ? 1 : 0), 0)
      })
    );
  };

  send();
  const timer = setInterval(send, 2000);
  ws.on('close', () => clearInterval(timer));
  ws.on('error', () => clearInterval(timer));
}
