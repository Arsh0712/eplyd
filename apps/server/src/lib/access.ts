import type { Actor } from '../auth/session';

/** Owner sees everything; guests see only projects they created. */
export function canAccessProject(actor: Actor, project: { created_by: string }): boolean {
  if (actor.kind === 'owner') return true;
  return !!actor.keyId && project.created_by === actor.keyId;
}
