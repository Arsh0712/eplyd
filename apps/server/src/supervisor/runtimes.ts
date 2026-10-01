import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { config } from '../config';

export interface RuntimeVersions {
  node?: string;
  npm?: string;
  pnpm?: string;
  python?: string;
  uv?: string;
  java_default?: string;
  java17?: string;
  java21?: string;
  maven?: string;
}

let cache: { at: number; versions: RuntimeVersions } | null = null;

function versionOf(cmd: string, args: string[], rx: RegExp): string | undefined {
  try {
    const r = spawnSync(cmd, args, { timeout: 8000, encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const m = out.match(rx);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

export function detectRuntimes(): RuntimeVersions {
  if (cache && Date.now() - cache.at < 60_000) return cache.versions;
  const versions: RuntimeVersions = {
    node: versionOf('node', ['--version'], /v(\S+)/),
    npm: versionOf('npm', ['--version'], /(\S+)/),
    pnpm: versionOf('pnpm', ['--version'], /(\S+)/),
    python: versionOf('python3', ['--version'], /Python (\S+)/),
    uv: versionOf('uv', ['--version'], /uv (\S+)/),
    java_default: versionOf('java', ['-version'], /version "(\S+)"/),
    java17: javaVersionAt(17),
    java21: javaVersionAt(21),
    maven: versionOf('mvn', ['-v'], /Apache Maven (\S+)/)
  };
  cache = { at: Date.now(), versions };
  return versions;
}

function javaVersionAt(major: number): string | undefined {
  const bin = findJavaBinary(String(major));
  const v = versionOf(bin, ['-version'], /version "(\S+)"/);
  if (v && v.startsWith(String(major))) return v;
  return undefined;
}

/** Resolve a JDK binary for a requested major version, falling back to PATH. */
export function findJavaBinary(version?: string): string {
  if (version === '17' || version === '21') {
    try {
      const roots = fs.readdirSync('/usr/lib/jvm');
      const match = roots.find(
        (d) => d.includes(`java-${version}`) || d.includes(`-${version}-openjdk`) || d.endsWith(`-${version}`)
      );
      if (match) {
        const bin = `/usr/lib/jvm/${match}/bin/java`;
        if (fs.existsSync(bin)) return bin;
      }
    } catch {
      /* /usr/lib/jvm missing — fall through */
    }
  }
  return 'java';
}

export function hasCommand(cmd: string): boolean {
  const dirs = (process.env.PATH || '').split(':').filter(Boolean);
  return dirs.some((d) => {
    try {
      fs.accessSync(`${d}/${cmd}`, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** Shared dependency-cache environment (identical for every bot → shared caches). */
export function cacheEnv(): Record<string, string> {
  return {
    PNPM_STORE_DIR: config.dirs.pnpmStore,
    npm_config_cache: config.dirs.npmCache,
    UV_CACHE_DIR: config.dirs.uvCache,
    PIP_CACHE_DIR: config.dirs.pipCache,
    GRADLE_USER_HOME: config.dirs.gradleHome,
    MAVEN_OPTS: `-Dmaven.repo.local=${config.dirs.mavenRepo}`
  };
}

/**
 * Build the environment for a bot process.
 *
 * SECURITY: this is an ALLOWLIST — the platform's secrets (ADMIN_PASSWORD,
 * SESSION_SECRET, ENCRYPTION_KEY, GITHUB_WEBHOOK_SECRET, etc.) are never
 * passed to bots, and cannot leak through ambient environment variables.
 */
export function sanitizeBotEnv(
  projectEnv: Record<string, string>,
  projectDir: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    LANG: process.env.LANG || 'C.UTF-8',
    TERM: process.env.TERM || 'xterm-256color',
    HOME: projectDir,
    TMPDIR: `${projectDir}/.eplyd/tmp`,
    ...cacheEnv(),
    ...extra,
    ...projectEnv
  };
}
