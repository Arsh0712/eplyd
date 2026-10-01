import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../db';
import { canAccessProject } from './access';

export interface ProjectRowLite {
  id: string;
  name: string;
  created_by: string;
  [k: string]: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      project?: ProjectRowLite;
    }
  }
}

/** Auth + project access guard for /projects/:id/* routes. */
export function loadProject(req: Request, res: Response, next: NextFunction): void {
  const actor = (req as Request & { actor?: { kind: string; keyId?: string } }).actor;
  if (!actor) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in required' } });
    return;
  }
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as ProjectRowLite | undefined;
  if (!row) {
    res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
    return;
  }
  if (!canAccessProject(actor as never, row)) {
    res.status(403).json({ error: { code: 'forbidden', message: 'You do not have access to this project' } });
    return;
  }
  req.project = row;
  next();
}
