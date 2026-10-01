import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { timingSafeEqualStr } from './lib/crypto';
import { CSRF_COOKIE } from './auth/session';
import { requireAuth } from './auth/middleware';
import { authRouter } from './auth/routes';
import { keysRouter } from './routes/keys';
import { projectsRouter } from './routes/projects';
import { filesRouter } from './routes/files';
import { envRouter } from './routes/env';
import { platformRouter } from './routes/platform';
import { openApiSpec } from './openapi';
import { logger } from './lib/log';
import { BUILD_INFO } from './lib/buildinfo';

export const VERSION = '1.0.0';

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Cloudflare terminates TLS and forwards the real client IP.
  app.set('trust proxy', true);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  // ---- CSRF: double-submit cookie + same-origin check on mutating /api calls.
  // Login and HMAC-verified webhooks are exempt (they cannot carry a session CSRF).
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    const rel = req.path.replace(/^\/v1/, '');
    if (rel.startsWith('/auth/login') || rel.startsWith('/hooks/')) return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) throw new Error('cross-origin');
      } catch {
        res.status(403).json({ error: { code: 'csrf', message: 'Cross-origin request rejected' } });
        return;
      }
    }
    const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[CSRF_COOKIE];
    const header = req.headers['x-csrf-token'];
    if (typeof cookie !== 'string' || typeof header !== 'string' || !timingSafeEqualStr(cookie, header)) {
      res.status(403).json({ error: { code: 'csrf', message: 'Missing or invalid CSRF token' } });
      return;
    }
    next();
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/keys', keysRouter);
  v1.use('/projects', projectsRouter);
  v1.use('/projects/:id/files', requireAuth, filesRouter);
  v1.use('/projects/:id/env', requireAuth, envRouter);
  v1.use('/', platformRouter);
  v1.get('/openapi.json', (_req, res) => res.json(openApiSpec()));
  app.use('/api/v1', v1);

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      version: VERSION,
      build: BUILD_INFO.id,
      builtAt: BUILD_INFO.time,
      uptime: Math.round(process.uptime())
    });
  });

  app.get('/api/docs', (_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><title>EplyD API docs</title><meta charset="utf-8"></head>
<body style="font-family:ui-monospace,monospace;background:#0b0f0e;color:#d7e2dd;padding:32px;max-width:900px;margin:0 auto">
<h1 style="color:#3DDC97">EplyD API v1</h1>
<p>Machine-readable OpenAPI spec: <a style="color:#3DDC97" href="/api/v1/openapi.json">/api/v1/openapi.json</a></p>
<p>REST endpoints live under <code>/api/v1</code>; WebSocket channels under <code>/ws</code>; health at <code>/healthz</code>.</p>
<p>See <code>docs/ROUTES.md</code> in the repository for the complete route table with access rules.</p>
</body></html>`);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route' } });
  });

  // ---- Static SPA with history fallback (deep links work on refresh) ----
  const candidates = [
    path.resolve(__dirname, '../../../apps/web/dist'),
    path.resolve(__dirname, '../../web/dist')
  ];
  const webDist = candidates.find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (webDist) {
    logger.info({ webDist, build: BUILD_INFO.id }, 'serving web dashboard');
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => {
      // index.html must never be cached: it references content-hashed assets,
      // and a stale cached shell is the #1 cause of "the old interface keeps
      // showing after I deploy".
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    logger.warn(
      { candidates, build: BUILD_INFO.id },
      'web dashboard dist not found — run `pnpm install && pnpm build` on the server, then restart'
    );
    app.get('*', (_req, res) => {
      res
        .status(503)
        .send('EplyD: web dashboard not built. Run `pnpm install && pnpm build` on the server, then `pm2 reload eplyd`.');
    });
  }

  // ---- Error handler ----
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'Payload exceeds the configured upload limit' } });
      return;
    }
    logger.error({ err }, 'unhandled request error');
    if (res.headersSent) return;
    res.status(err.status && err.status < 500 ? err.status : 500).json({
      error: { code: 'internal', message: err.message && err.status ? err.message : 'Internal server error' }
    });
  });

  return app;
}
