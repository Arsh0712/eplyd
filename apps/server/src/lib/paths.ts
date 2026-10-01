import path from 'node:path';
import fs from 'node:fs';

/** Thrown when a path escapes its project root. */
export class PathError extends Error {
  constructor(rel: string) {
    super(`Path escapes the project root: ${rel}`);
    this.name = 'PathError';
  }
}

/**
 * Resolve `rel` under `root` and guarantee the result stays inside it.
 * The root itself is allowed (empty relative path).
 */
export function safeResolve(root: string, rel: string): string {
  if (typeof rel !== 'string') throw new PathError(String(rel));
  if (rel.includes('\0')) throw new PathError(rel);
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, rel);
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
    throw new PathError(rel);
  }
  return target;
}

/**
 * Stronger, symlink-aware containment check for existing paths: resolves the
 * realpath of the target (or the nearest existing ancestor) and verifies it
 * is still inside the realpath of the root.
 */
export function assertRealInsideRoot(root: string, target: string): void {
  const rootReal = fs.realpathSync(root);
  let probe = target;
  const missing: string[] = [];
  for (;;) {
    try {
      fs.lstatSync(probe);
      break;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) throw new PathError(target);
      missing.unshift(path.basename(probe));
      probe = parent;
    }
  }
  const probeReal = fs.realpathSync(probe);
  if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) {
    throw new PathError(target);
  }
  // Segments below the existing ancestor did not exist yet, so they cannot be
  // symlinks — re-joining them is safe.
  if (missing.length > 0 && path.resolve(probeReal, ...missing) === probeReal) {
    throw new PathError(target);
  }
}

/** Resolve + verify in one call. Returns the absolute target path. */
export function resolveInsideRoot(root: string, rel: string): string {
  const target = safeResolve(root, rel);
  assertRealInsideRoot(root, target);
  return target;
}
