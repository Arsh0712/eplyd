import fs from 'node:fs';
import path from 'node:path';

/**
 * Build identity, stamped by scripts/write-build-info.mjs at build time.
 * Surfaced at /healthz and in the dashboard footer so an operator can verify
 * at a glance which build is actually deployed (e.g. after a ZIP upload or
 * `scripts/update.sh`) instead of guessing from cache.
 */
export interface BuildInfo {
  id: string;
  sha: string;
  time: string;
}

function load(): BuildInfo {
  const candidates = [
    // Running from compiled output: apps/server/dist/index.js
    path.resolve(__dirname, '..', 'build-info.json'),
    // Running from source (dev/tests) or with the repo root as cwd
    path.resolve(process.cwd(), 'apps', 'server', 'build-info.json'),
    path.resolve(process.cwd(), 'build-info.json')
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<BuildInfo>;
      if (raw && typeof raw.id === 'string' && raw.id.length > 0) {
        return { id: raw.id, sha: raw.sha ?? raw.id, time: raw.time ?? '' };
      }
    } catch {
      // try the next candidate
    }
  }
  return { id: 'dev', sha: 'dev', time: '' };
}

export const BUILD_INFO: BuildInfo = load();
