// Stamps the build with the current git SHA (or "zip" when deployed from an
// archive without git) and a UTC timestamp. The same info is embedded into
// the web bundle (footer chip) and exposed by the server at /healthz, so you
// can always verify WHICH build is actually running on the VPS.
//
// Runs automatically as part of `pnpm build`.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let sha = 'zip';
try {
  sha = execSync('git rev-parse --short HEAD', {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .toString()
    .trim();
} catch {
  // Not a git checkout (deployed from ZIP) — keep the "zip" marker.
}
if (!sha) sha = 'zip';

const info = {
  id: sha,
  sha,
  time: `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`
};

for (const rel of ['apps/server/build-info.json', 'apps/web/build-info.json']) {
  fs.writeFileSync(path.join(root, rel), `${JSON.stringify(info, null, 2)}\n`);
}
console.log(`[eplyd] build info: ${info.id} @ ${info.time}`);
