import type { NextFunction, Request, Response } from 'express';
import { actorFromRequest, type Actor } from './session';

export interface AuthedRequest extends Request {
  actor?: Actor;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const actor = actorFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in required' } });
    return;
  }
  req.actor = actor;
  next();
}

export function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
  const actor = actorFromRequest(req);
  if (!actor) {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in required' } });
    return;
  }
  if (actor.kind !== 'owner') {
    res.status(403).json({ error: { code: 'forbidden', message: 'Owner access required' } });
    return;
  }
  req.actor = actor;
  next();
}
