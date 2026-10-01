import path from 'node:path';
import { config } from '../config';
import { PathError } from './paths';

const ID_RX = /^[A-Za-z0-9_-]{6,40}$/;

/** Resolve a project's directory, validating the id shape first. */
export function projectDir(id: string): string {
  if (!ID_RX.test(id)) throw new PathError(id);
  return path.join(config.dirs.projects, id);
}
