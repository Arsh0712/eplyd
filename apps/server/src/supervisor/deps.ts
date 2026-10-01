import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { parse as shellParse } from 'shell-quote';
import { config } from '../config';
import { sha256hex } from '../lib/crypto';
import { sanitizeBotEnv, findJavaBinary, hasCommand, detectRuntimes } from './runtimes';
import type { RuntimeVersions } from './runtimes';

export type RuntimeKind = 'node' | 'python' | 'java' | 'none';

export interface Cmd {
  cmd: string;
  args: string[];
}

export interface DepPlan {
  runtime: RuntimeKind;
  /** Manifest + lockfile contents used for the fingerprint. */
  manifestFiles: Record<string, string>;
  fingerprint: string;
  installKind: 'pnpm' | 'npm' | 'uv-venv' | 'pip-venv' | 'maven' | 'gradle' | 'jar' | 'none';
  /** Shared venv hash (python only). */
  venvHash?: string;
  venvPath?: string;
  venvPython?: string;
  buildCmd?: Cmd;
  runCmd: Cmd;
  javaVersion?: string;
}

export class DepError extends Error {}

/** Parse a command string safely: no shell, no operators, no substitution. */
export function splitCommand(input: string): Cmd {
  const parts = shellParse(input.trim());
  const tokens: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.length > 0) tokens.push(p);
      continue;
    }
    // shell operator/control — reject, never execute through a shell
    throw new DepError(`Unsupported shell operator in command: ${JSON.stringify(p)}`);
  }
  if (tokens.length === 0) throw new DepError('Empty command');
  return { cmd: tokens[0]!, args: tokens.slice(1) };
}

function readIf(dir: string, rel: string): string | undefined {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return undefined;
  }
}

function existsDir(dir: string, rel: string): boolean {
  try {
    return fs.statSync(path.join(dir, rel)).isDirectory();
  } catch {
    return false;
  }
}

export function sharedVenvPath(hash: string): string {
  return path.join(config.dirs.venvs, hash);
}

const PYTHON_ENTRY_CANDIDATES = ['bot.py', 'main.py', 'app.py', 'src/main.py', 'src/bot.py', 'bot/__main__.py', '__main__.py'];
const NODE_ENTRY_CANDIDATES = ['index.js', 'bot.js', 'src/index.js', 'src/bot.js', 'app.js', 'dist/index.js', 'index.ts', 'src/index.ts'];

const KNOWN_PY_LIBS: Record<string, string> = {
  discord: 'discord.py>=2.3.2',
  nextcord: 'nextcord>=2.6.0',
  disnake: 'disnake>=2.9.0',
  py_cord: 'py-cord>=2.5.0',
  hikari: 'hikari>=2.0.0',
  aiohttp: 'aiohttp>=3.9.0',
  dotenv: 'python-dotenv>=1.0.1',
  requests: 'requests>=2.31.0',
  httpx: 'httpx>=0.27.0',
  motor: 'motor>=3.4.0',
  pymongo: 'pymongo>=4.6.0',
  sqlalchemy: 'sqlalchemy>=2.0.0',
  psutil: 'psutil>=5.9.0'
};

const PY_STDLIB = new Set([
  'os', 'sys', 're', 'json', 'time', 'datetime', 'math', 'random', 'logging', 'asyncio', 'typing',
  'collections', 'itertools', 'functools', 'pathlib', 'subprocess', 'threading', 'uuid', 'hashlib',
  'base64', 'secrets', 'shutil', 'tempfile', 'io', 'abc', 'enum', 'dataclasses', 'contextlib',
  'sqlite3', 'csv', 'socket', 'ssl', 'struct', 'traceback', 'warnings', 'weakref', 'string',
  'textwrap', 'copy', 'glob', 'signal', 'stat', ' statistics', 'heapq', 'bisect', 'array', 'queue'
]);

export interface DetectOpts {
  javaVersion?: string;
  startCommand?: string;
  installCommand?: string;
  buildCommand?: string;
}

/**
 * Detect the runtime, dependency manifests and start command for a project,
 * then compute the dependency fingerprint (hash of manifests + lockfile +
 * runtime versions + platform). Identical fingerprints → shared installs.
 */
export function detectPlan(dir: string, opts: DetectOpts = {}): DepPlan {
  const versions = detectRuntimes();
  const pkgRaw = readIf(dir, 'package.json');
  const requirements = readIf(dir, 'requirements.txt');
  const pyproject = readIf(dir, 'pyproject.toml');
  const pipfile = readIf(dir, 'Pipfile');
  const pom = readIf(dir, 'pom.xml');
  const gradle = readIf(dir, 'build.gradle') ?? readIf(dir, 'build.gradle.kts');

  // ---------- Node ----------
  if (pkgRaw) {
    let pkg: { main?: string; scripts?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      throw new DepError('package.json is not valid JSON');
    }
    const lock =
      readIf(dir, 'pnpm-lock.yaml') ?? readIf(dir, 'package-lock.json') ?? readIf(dir, 'yarn.lock');
    const manifestFiles: Record<string, string> = { 'package.json': pkgRaw };
    if (lock) manifestFiles['_lock'] = lock;
    const installKind: 'pnpm' | 'npm' = hasCommand('pnpm') ? 'pnpm' : 'npm';
    const fingerprint = fingerprintOf('node', manifestFiles, { node: versions.node, pnpm: installKind });
    let runCmd: Cmd;
    if (opts.startCommand && opts.startCommand.trim()) {
      runCmd = splitCommand(opts.startCommand);
    } else if (pkg.scripts?.start) {
      runCmd = { cmd: 'npm', args: ['run', 'start'] };
    } else {
      const entry = pkg.main || NODE_ENTRY_CANDIDATES.find((c) => fs.existsSync(path.join(dir, c))) || 'index.js';
      runCmd = { cmd: 'node', args: [entry] };
    }
    return {
      runtime: 'node',
      manifestFiles,
      fingerprint,
      installKind,
      runCmd
    };
  }

  // ---------- Python ----------
  if (requirements || pyproject || pipfile) {
    const manifestFiles: Record<string, string> = {};
    if (requirements) manifestFiles['requirements.txt'] = requirements;
    if (pyproject) manifestFiles['pyproject.toml'] = pyproject;
    if (pipfile) manifestFiles['Pipfile'] = pipfile;
    const normalized = Object.keys(manifestFiles)
      .sort()
      .map((k) => `${k}:${manifestFiles[k]}`)
      .join('\n');
    const venvHash = sha256hex(`${normalized}|py:${versions.python}|eplyd1`).slice(0, 20);
    const venvPath = sharedVenvPath(venvHash);
    const venvPython = path.join(venvPath, 'bin', 'python');
    const useUv = hasCommand('uv');
    const installKind: 'uv-venv' | 'pip-venv' = useUv ? 'uv-venv' : 'pip-venv';
    const fingerprint = fingerprintOf('python', manifestFiles, { python: versions.python, uv: useUv });
    let runCmd: Cmd;
    if (opts.startCommand && opts.startCommand.trim()) {
      runCmd = splitCommand(opts.startCommand);
    } else {
      const entry = PYTHON_ENTRY_CANDIDATES.find((c) => fs.existsSync(path.join(dir, c))) || 'main.py';
      runCmd = { cmd: fs.existsSync(venvPython) ? venvPython : 'python3', args: [entry] };
    }
    return {
      runtime: 'python',
      manifestFiles,
      fingerprint,
      installKind,
      venvHash,
      venvPath,
      venvPython,
      runCmd
    };
  }

  // ---------- Java ----------
  const hasJar = findPrebuiltJar(dir);
  if (pom || gradle || hasJar) {
    const manifestFiles: Record<string, string> = {};
    if (pom) manifestFiles['pom.xml'] = pom;
    if (gradle) manifestFiles['build.gradle'] = gradle;
    const javaVersion = opts.javaVersion === '17' ? '17' : '21';
    const javaBin = findJavaBinary(javaVersion);
    let installKind: 'maven' | 'gradle' | 'jar' = 'jar';
    let buildCmd: Cmd | undefined;
    if (pom) {
      installKind = 'maven';
      buildCmd = splitCommand(opts.buildCommand?.trim() || 'mvn -q -DskipTests package');
    } else if (gradle) {
      installKind = 'gradle';
      const wrapper = fs.existsSync(path.join(dir, 'gradlew'));
      buildCmd = wrapper
        ? { cmd: './gradlew', args: ['build', '-x', 'test'] }
        : splitCommand(opts.buildCommand?.trim() || 'gradle build -x test');
    }
    const fingerprint = fingerprintOf('java', manifestFiles, {
      java: versions.java_default,
      jdk: javaVersion,
      kind: installKind
    });
    let runCmd: Cmd;
    if (opts.startCommand && opts.startCommand.trim()) {
      runCmd = splitCommand(opts.startCommand);
    } else if (hasJar) {
      runCmd = { cmd: javaBin, args: ['-jar', hasJar] };
    } else {
      runCmd = { cmd: javaBin, args: ['-jar', 'REPLACE_AFTER_BUILD'] };
    }
    return { runtime: 'java', manifestFiles, fingerprint, installKind, buildCmd, runCmd, javaVersion };
  }

  // ---------- Nothing detected ----------
  if (opts.startCommand && opts.startCommand.trim()) {
    return {
      runtime: 'none',
      manifestFiles: {},
      fingerprint: fingerprintOf('custom', {}, {}),
      installKind: 'none',
      runCmd: splitCommand(opts.startCommand)
    };
  }
  throw new DepError(
    'No runnable entry detected. Add a start command in Settings, or include package.json / requirements.txt / a .jar.'
  );
}

function fingerprintOf(runtime: string, manifests: Record<string, string>, extra: Record<string, unknown>): string {
  const seed = JSON.stringify({
    runtime,
    manifests,
    extra,
    platform: `${process.platform}-${process.arch}`,
    eplyd: 1
  });
  return sha256hex(seed);
}

export function findPrebuiltJar(dir: string): string | undefined {
  const roots = [dir, path.join(dir, 'target'), path.join(dir, 'build', 'libs'), path.join(dir, 'build')];
  let best: { p: string; m: number } | undefined;
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jar') || n.startsWith('original-') || n.includes('javadoc') || n.includes('sources')) continue;
      const p = path.join(root, n);
      try {
        const m = fs.statSync(p).mtimeMs;
        if (!best || m > best.m) best = { p: path.relative(dir, p), m };
      } catch { /* ignore */ }
    }
  }
  return best?.p;
}

/** Validate that a previously installed environment still exists and works. */
export function validateEnvironment(plan: DepPlan, dir: string): boolean {
  switch (plan.installKind) {
    case 'pnpm':
    case 'npm':
      return existsDir(dir, 'node_modules');
    case 'uv-venv':
    case 'pip-venv':
      return !!plan.venvPython && fs.existsSync(plan.venvPython);
    case 'maven':
      return !!findPrebuiltJar(dir);
    case 'gradle':
      return !!findPrebuiltJar(dir);
    case 'jar':
      return true;
    default:
      return true;
  }
}

export interface StampData {
  fingerprint: string;
  venvHash?: string;
  runtime: string;
  at: number;
}

export function readStamp(dir: string): StampData | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '.eplyd', 'deps.stamp'), 'utf8')) as StampData;
  } catch {
    return undefined;
  }
}

export function writeStamp(dir: string, plan: DepPlan): void {
  const data: StampData = {
    fingerprint: plan.fingerprint,
    venvHash: plan.venvHash,
    runtime: plan.runtime,
    at: Date.now()
  };
  fs.mkdirSync(path.join(dir, '.eplyd'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.eplyd', 'deps.stamp'), JSON.stringify(data, null, 2));
}

export interface InstallStats {
  installs: number;
  cacheHits: number;
  fingerprintJoins: number;
}

const stats: InstallStats = { installs: 0, cacheHits: 0, fingerprintJoins: 0 };

export function installStats(): InstallStats {
  return { ...stats };
}

/** Called when a start skipped installation because the stamp matched. */
export function noteCacheHit(): void {
  stats.cacheHits += 1;
}

/** Called when a second project joined an in-flight identical install. */
export function noteFingerprintJoin(): void {
  stats.fingerprintJoins += 1;
}

/** Run a child, streaming combined output to `onLine`. Resolves on code 0. */
export function runStreaming(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  onLine: (chunk: string, stream: 'out' | 'err') => void,
  timeoutMs = 20 * 60_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch { /* ignore */ }
      reject(new DepError(`${cmd} timed out after ${Math.round(timeoutMs / 60000)} min`));
    }, timeoutMs);
    let bufOut = '';
    let bufErr = '';
    child.stdout?.on('data', (d: Buffer) => {
      bufOut += d.toString('utf8');
      for (;;) {
        const i = bufOut.indexOf('\n');
        if (i < 0) break;
        onLine(bufOut.slice(0, i), 'out');
        bufOut = bufOut.slice(i + 1);
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      bufErr += d.toString('utf8');
      for (;;) {
        const i = bufErr.indexOf('\n');
        if (i < 0) break;
        onLine(bufErr.slice(0, i), 'err');
        bufErr = bufErr.slice(i + 1);
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (bufOut) onLine(bufOut, 'out');
      if (bufErr) onLine(bufErr, 'err');
      if (code === 0) resolve();
      else reject(new DepError(`${cmd} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

/**
 * Install dependencies for a plan. Uses shared caches and shared venvs so
 * identical dependency sets are downloaded/installed once per server.
 */
export async function installDependencies(
  plan: DepPlan,
  dir: string,
  projectEnv: Record<string, string>,
  onLine: (chunk: string, stream: 'out' | 'err' | 'sys') => void,
  installCommandOverride?: string
): Promise<void> {
  const env = sanitizeBotEnv(projectEnv, dir);
  stats.installs += 1;

  const wrap = async (fn: () => Promise<void>): Promise<void> => {
    await fn();
  };

  switch (plan.installKind) {
    case 'pnpm': {
      // --ignore-workspace is critical: pnpm walks up looking for a
      // pnpm-workspace.yaml and would otherwise attach bot projects to the
      // PLATFORM's own workspace root (they share an ancestor when EplyD is
      // deployed as a pnpm monorepo), installing bot deps into the wrong
      // node_modules. CI=1 keeps pnpm fully non-interactive.
      const args = plan.manifestFiles['_lock']
        ? ['install', '--frozen-lockfile', '--ignore-workspace']
        : ['install', '--ignore-workspace'];
      onLine(`$ pnpm ${args.join(' ')} (shared store: ${config.dirs.pnpmStore})`, 'sys');
      await wrap(() => runStreaming('pnpm', args, dir, { ...env, CI: '1' }, onLine));
      return;
    }
    case 'npm': {
      const args = plan.manifestFiles['_lock'] ? ['ci'] : ['install'];
      onLine(`$ npm ${args.join(' ')} (shared cache: ${config.dirs.npmCache})`, 'sys');
      await wrap(() => runStreaming('npm', args, dir, env, onLine));
      return;
    }
    case 'uv-venv': {
      if (!plan.venvPath || !plan.venvPython) throw new DepError('venv plan incomplete');
      if (!fs.existsSync(plan.venvPython)) {
        onLine(`$ uv venv ${plan.venvPath} (shared venv for this dependency set)`, 'sys');
        await runStreaming('uv', ['venv', '--python', 'python3', plan.venvPath], dir, env, onLine);
      }
      const input = plan.manifestFiles['requirements.txt'] ? '-r requirements.txt' : '-r pyproject.toml';
      onLine(`$ uv pip install ${input} → shared venv ${plan.venvHash}`, 'sys');
      await wrap(() =>
        runStreaming('uv', ['pip', 'install', '--python', plan.venvPython!, ...input.split(' ')], dir, env, onLine)
      );
      return;
    }
    case 'pip-venv': {
      if (!plan.venvPath || !plan.venvPython) throw new DepError('venv plan incomplete');
      if (!fs.existsSync(plan.venvPython)) {
        onLine(`$ python3 -m venv ${plan.venvPath}`, 'sys');
        await runStreaming('python3', ['-m', 'venv', plan.venvPath], dir, env, onLine);
      }
      onLine(`$ pip install (shared cache: ${config.dirs.pipCache})`, 'sys');
      await wrap(() =>
        runStreaming(
          plan.venvPython!,
          ['-m', 'pip', 'install', '--upgrade', 'pip', '-r', plan.manifestFiles['requirements.txt'] ? 'requirements.txt' : 'pyproject.toml'],
          dir,
          env,
          onLine
        )
      );
      return;
    }
    case 'maven': {
      const cmd = splitCommand(installCommandOverride?.trim() || 'mvn -q -DskipTests package');
      onLine(`$ ${cmd.cmd} ${cmd.args.join(' ')} (repo: ${config.dirs.mavenRepo})`, 'sys');
      await wrap(() => runStreaming(cmd.cmd, cmd.args, dir, { ...env, MAVEN_OPTS: `-Dmaven.repo.local=${config.dirs.mavenRepo}` }, onLine));
      return;
    }
    case 'gradle': {
      const cmd = plan.buildCmd ?? { cmd: 'gradle', args: ['build', '-x', 'test'] };
      onLine(`$ ${cmd.cmd} ${cmd.args.join(' ')} (GRADLE_USER_HOME: ${config.dirs.gradleHome})`, 'sys');
      await wrap(() => runStreaming(cmd.cmd, cmd.args, dir, env, onLine));
      return;
    }
    case 'jar':
    case 'none':
    default:
      onLine('No dependency installation required.', 'sys');
      return;
  }
}

/**
 * If the project has Python code but no dependency manifest, scan entry files
 * for well-known Discord libraries and generate a requirements.txt.
 * Returns the generated content, or null.
 */
export function generateRequirementsFromImports(dir: string): string | null {
  const found = new Set<string>();
  const candidates = [...PYTHON_ENTRY_CANDIDATES.map((c) => path.join(dir, c))];
  try {
    for (const n of fs.readdirSync(dir)) {
      if (n.endsWith('.py') && !PYTHON_ENTRY_CANDIDATES.includes(n)) {
        candidates.push(path.join(dir, n));
      }
    }
  } catch { /* ignore */ }
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rx = /^\s*(?:import|from)\s+([a-zA-Z0-9_]+)/gm;
    for (const m of text.matchAll(rx)) {
      const mod = m[1]!;
      if (PY_STDLIB.has(mod)) continue;
      const known = KNOWN_PY_LIBS[mod];
      if (known) found.add(known);
    }
  }
  if (found.size === 0) return null;
  return [...found].sort().join('\n') + '\n';
}
