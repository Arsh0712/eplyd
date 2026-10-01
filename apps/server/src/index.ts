import http from 'node:http';
import { config, ensureDirs } from './config';
import { logger } from './lib/log';
import { buildApp } from './app';
import { setupWebSocket } from './ws';
import { getManager } from './supervisor/manager';
import { ensureOwnerHash } from './auth/routes';
import { purgeExpiredSessions } from './auth/session';
import { cronManager } from './supervisor/cron';
import { closeDb } from './db';
import { BUILD_INFO } from './lib/buildinfo';

async function main(): Promise<void> {
  ensureDirs();
  await ensureOwnerHash();
  purgeExpiredSessions();

  const app = buildApp();
  const server = http.createServer(app);
  setupWebSocket(server);

  const manager = getManager();
  manager.ensureLoaded();
  cronManager.rescheduleAll();
  manager.reconcile();

  server.listen(config.port, config.host, () => {
    logger.info(
      { port: config.port, host: config.host, publicUrl: config.publicUrl, build: BUILD_INFO.id, builtAt: BUILD_INFO.time },
      'EplyD control plane listening'
    );
  });

  // Housekeeping: purge expired sessions periodically.
  const housekeeper = setInterval(purgeExpiredSessions, 6 * 3600 * 1000);
  housekeeper.unref?.();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await manager.shutdown(); // persists was_running and stops bot processes
      cronManager.stopAll();
      server.close(() => {
        closeDb();
        process.exit(0);
      });
      // Force-exit if close hangs.
      setTimeout(() => {
        closeDb();
        process.exit(0);
      }, 3000).unref?.();
    } catch (err) {
      logger.error({ err }, 'shutdown error');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception');
    // Let PM2 restart a wedged process instead of serving from a broken state.
    void shutdown('uncaughtException');
    setTimeout(() => process.exit(1), 2000).unref?.();
  });
}

void main();
