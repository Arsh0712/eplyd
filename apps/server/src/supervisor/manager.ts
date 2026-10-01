import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { config } from '../config';
import { logger } from '../lib/log';
import { getLogStore } from '../lib/ringbuffer';
import type { LogLine } from '../lib/ringbuffer';
import { recordActivity } from '../activity';
import { projectDir } from '../lib/projdir';
import { sampleTree, clearTreeSample } from '../lib/metrics';
import { sanitizeBotEnv } from './runtimes';
import {
  detectPlan,
  validateEnvironment,
  readStamp,
  writeStamp,
  installDependencies,
  generateRequirementsFromImports,
  findPrebuiltJar,
  noteCacheHit,
  noteFingerprintJoin,
  DepError,
  type DepPlan
} from './deps';
import { findJavaBinary } from './runtimes';
import { aesDecrypt } from '../lib/crypto';
import { notifyEvent } from './notify';

export type ProcStatus =
  | 'stopped'
  | 'queued'
  | 'checking_deps'
  | 'installing'
  | 'building'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'crash_loop';

const BUSY: ProcStatus[] = ['queued', 'checking_deps', 'installing', 'building', 'starting', 'running', 'stopping'];
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 60_000];
const CRASH_LOOP_WINDOW_MS = 10 * 60_000;
const CRASH_LOOP_MAX = 5;

/**
 * True when the project directory contains at least one user file (anything
 * besides the .eplyd bookkeeping folder). Used by boot reconciliation so
 * empty projects are never auto-started.
 */
function hasProjectFiles(id: string): boolean {
  const dir = projectDir(id);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((e) => e.name !== '.eplyd');
}

export interface ProjectRow {
  id: string;
  name: string;
  runtime: string;
  start_command: string;
  install_command: string;
  build_command: string;
  java_version: string;
  restart_policy: 'never' | 'on-failure' | 'always';
  max_restarts: number;
  cpu_limit: number;
  ram_limit_mb: number;
  webhook_url: string;
  created_by: string;
  autostart: number;
  was_running: number;
  restart_count: number;
  last_deploy_at: number | null;
}

interface State {
  id: string;
  status: ProcStatus;
  statusDetail?: string;
  proc?: ChildProcess;
  pid?: number;
  startedAt?: number;
  restartCount: number; // consecutive auto restarts in this run
  totalRestarts: number;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  stopRequested: boolean;
  generation: number;
  cpuPercent: number;
  rssBytes: number;
  recentExits: number[];
  ramWarned: boolean;
  cgroupPath?: string;
}

export class BusyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BusyError';
  }
}

class InstallQueue {
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(private concurrency: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = (): void => {
        this.running += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.running -= 1;
            const next = this.waiting.shift();
            if (next) next();
          });
      };
      if (this.running < this.concurrency) task();
      else this.waiting.push(task);
    });
  }

  get pending(): number {
    return this.waiting.length;
  }
}

export class ProjectManager {
  /** 'log' (projectId, line), 'status' (projectId, status, detail) */
  readonly bus = new EventEmitter();

  private states = new Map<string, State>();
  private plans = new Map<string, DepPlan>();
  private fpLocks = new Map<string, Promise<void>>();
  private queue: InstallQueue;
  private loaded = false;
  private metricTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.queue = new InstallQueue(config.maxConcurrentInstalls);
    this.bus.setMaxListeners(0);
  }

  ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const rows = this.allProjects();
    for (const row of rows) {
      this.states.set(row.id, this.newState(row));
    }
    this.metricTimer = setInterval(() => this.sampleAll(), 3000);
    this.metricTimer.unref?.();
  }

  private newState(row: Pick<ProjectRow, 'id' | 'restart_count'>): State {
    return {
      id: row.id,
      status: 'stopped',
      restartCount: 0,
      totalRestarts: row.restart_count ?? 0,
      lastExitCode: null,
      lastExitSignal: null,
      stopRequested: false,
      generation: 0,
      cpuPercent: 0,
      rssBytes: 0,
      recentExits: [],
      ramWarned: false
    };
  }

  private allProjects(): ProjectRow[] {
    return getDb().prepare('SELECT * FROM projects').all() as unknown as ProjectRow[];
  }

  private project(id: string): ProjectRow {
    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow | undefined;
    if (!row) throw new DepError('Project not found');
    return row;
  }

  private get(id: string): State {
    let st = this.states.get(id);
    if (!st) {
      st = this.newState(this.project(id));
      this.states.set(id, st);
    }
    return st;
  }

  // ------------------------------------------------------------------
  // Logging + status broadcast
  // ------------------------------------------------------------------

  logLine(id: string, stream: LogLine['s'], chunk: string): void {
    try {
      const line = getLogStore(id, config.dirs.logs, config.logMaxBytes).append(stream, chunk);
      this.bus.emit('log', id, line);
    } catch (err) {
      logger.error({ err, id }, 'log append failed');
    }
  }

  private setStatus(id: string, status: ProcStatus, detail?: string): void {
    const st = this.get(id);
    st.status = status;
    st.statusDetail = detail;
    try {
      getDb()
        .prepare('UPDATE projects SET status = ?, pid = ?, started_at = ? WHERE id = ?')
        .run(status, st.pid ?? null, status === 'running' ? st.startedAt ?? null : null, id);
    } catch (err) {
      logger.error({ err }, 'status persist failed');
    }
    this.bus.emit('status', id, status, detail);
  }

  // ------------------------------------------------------------------
  // Fingerprint-scoped install lock: identical dependency sets install once.
  // ------------------------------------------------------------------

  private withFingerprintLock(fp: string, fn: () => Promise<void>): Promise<void> {
    const existing = this.fpLocks.get(fp);
    if (existing) {
      noteFingerprintJoin(); // a concurrent project reuses this install
      return existing;
    }
    const p = fn().finally(() => this.fpLocks.delete(fp));
    this.fpLocks.set(fp, p);
    return p;
  }

  // ------------------------------------------------------------------
  // Public control API
  // ------------------------------------------------------------------

  async start(id: string, opts: { reason?: string; actor?: string } = {}): Promise<void> {
    this.ensureLoaded();
    const st = this.get(id);
    if (BUSY.includes(st.status)) {
      throw new BusyError(`Project is ${st.status}`);
    }
    // Make sure a directory exists before doing anything.
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) {
      throw new DepError('Project files are missing on disk');
    }
    st.stopRequested = false;
    st.restartCount = 0;
    st.generation += 1;
    st.recentExits = [];
    st.ramWarned = false;
    this.setStatus(id, 'queued', opts.reason || 'manual start');
    this.logLine(id, 'sys', opts.reason ? `Start requested (${opts.reason})` : 'Start requested');
    void this.pipeline(id, st.generation).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logLine(id, 'err', `Start failed: ${msg}`);
      this.setStatus(id, 'crashed', msg);
      await notifyEvent(this.project(id), 'crash', `start failed: ${msg}`);
      recordActivity({ project_id: id, actor: opts.actor || 'system', action: 'proc.start_failed', detail: msg });
    });
  }

  async stop(id: string, opts: { reason?: string } = {}): Promise<void> {
    this.ensureLoaded();
    const st = this.get(id);
    st.generation += 1; // cancels queued pipelines and pending restarts
    st.stopRequested = true;
    if (st.status === 'stopped') return;
    if (!st.proc && st.status !== 'stopping') {
      this.setStatus(id, 'stopped', opts.reason || 'stopped');
      this.clearWasRunning(id);
      return;
    }
    this.setStatus(id, 'stopping', opts.reason || 'stopping');
    this.signalTree(st, 'SIGTERM');
    const gen = st.generation;
    setTimeout(() => {
      if (st.generation === gen && st.proc) this.signalTree(st, 'SIGKILL');
    }, 10_000).unref?.();
  }

  async kill(id: string): Promise<void> {
    this.ensureLoaded();
    const st = this.get(id);
    st.generation += 1;
    st.stopRequested = true;
    if (st.proc) {
      this.setStatus(id, 'stopping', 'killed');
      this.signalTree(st, 'SIGKILL');
    } else {
      this.setStatus(id, 'stopped', 'killed');
      this.clearWasRunning(id);
    }
  }

  async restart(id: string, opts: { reason?: string; actor?: string } = {}): Promise<void> {
    this.ensureLoaded();
    const st = this.get(id);
    if (BUSY.includes(st.status)) {
      await this.stop(id, { reason: opts.reason || 'restart' });
      // wait for the process to fully exit (bounded)
      await this.waitForExit(st, 15_000);
    }
    await this.start(id, { reason: opts.reason || 'restart', actor: opts.actor });
  }

  async installOnly(id: string, actor?: string): Promise<void> {
    this.ensureLoaded();
    const st = this.get(id);
    if (BUSY.includes(st.status)) throw new BusyError(`Project is ${st.status}`);
    st.generation += 1;
    st.stopRequested = false;
    this.setStatus(id, 'installing', 'manual install');
    const gen = st.generation;
    void this.runInstallPhase(id, gen)
      .then(() => {
        if (st.generation === gen) {
          this.logLine(id, 'sys', 'Install finished.');
          this.setStatus(id, 'stopped', 'install finished');
          recordActivity({ project_id: id, actor: actor || 'system', action: 'deps.install', detail: 'manual install completed' });
        }
      })
      .catch((err) => {
        if (st.generation !== gen) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.logLine(id, 'err', `Install failed: ${msg}`);
        this.setStatus(id, 'stopped', `install failed: ${msg}`);
        recordActivity({ project_id: id, actor: actor || 'system', action: 'deps.install_failed', detail: msg });
        void notifyEvent(this.project(id), 'install_failed', msg);
      });
  }

  // ------------------------------------------------------------------
  // Boot reconciliation + graceful shutdown
  // ------------------------------------------------------------------

  reconcile(): void {
    this.ensureLoaded();
    const rows = this.allProjects();
    let delay = 1500;
    for (const row of rows) {
      const shouldRun = row.autostart === 1 || row.was_running === 1;
      const st = this.get(row.id);
      if (BUSY.includes(st.status)) continue;
      // States loaded from disk are always 'stopped' here; anything persisted
      // as "running" was an orphan process that died with the platform.
      st.status = 'stopped';
      if (shouldRun) {
        // Skip empty projects (created but never deployed) — starting them
        // would just crash-loop. A project is "deployable" once its directory
        // contains at least one file besides bookkeeping.
        if (!hasProjectFiles(row.id)) {
          logger.debug({ id: row.id }, 'reconcile skipped — project has no files');
          continue;
        }
        setTimeout(() => {
          this.start(row.id, { reason: 'boot reconciliation' }).catch((err) =>
            logger.warn({ err, id: row.id }, 'boot reconcile start failed')
          );
        }, delay);
        delay += 2000;
      }
    }
    logger.info({ projects: rows.length }, 'boot reconciliation complete');
  }

  async shutdown(): Promise<void> {
    logger.info('graceful shutdown initiated');
    if (this.metricTimer) clearInterval(this.metricTimer);
    const running = [...this.states.values()].filter((s) => s.proc);
    for (const st of running) {
      try {
        getDb().prepare('UPDATE projects SET was_running = 1 WHERE id = ?').run(st.id);
      } catch { /* ignore */ }
      this.signalTree(st, 'SIGTERM');
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && running.some((s) => s.proc)) {
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const st of running) {
      if (st.proc) this.signalTree(st, 'SIGKILL');
    }
  }

  // ------------------------------------------------------------------
  // Pipeline
  // ------------------------------------------------------------------

  private async pipeline(id: string, gen: number): Promise<void> {
    const st = this.get(id);
    const project = this.project(id);
    const dir = projectDir(id);

    const stale = (): boolean => st.generation !== gen || st.stopRequested;

    // ---- Stage: checking deps ----
    if (stale()) return;
    this.setStatus(id, 'checking_deps');
    let plan: DepPlan;
    try {
      plan = detectPlan(dir, {
        javaVersion: project.java_version,
        startCommand: project.start_command,
        installCommand: project.install_command,
        buildCommand: project.build_command
      });
    } catch (err) {
      // Python projects without a manifest: offer auto-generated requirements.
      const generated = generateRequirementsFromImports(dir);
      if (generated) {
        fs.writeFileSync(path.join(dir, 'requirements.txt'), generated, { mode: 0o644 });
        this.logLine(id, 'sys', `No dependency manifest found — generated requirements.txt:\n${generated.trim()}`);
        recordActivity({ project_id: id, actor: 'system', action: 'deps.generated', detail: 'requirements.txt generated from imports' });
        plan = detectPlan(dir, {
          javaVersion: project.java_version,
          startCommand: project.start_command,
          installCommand: project.install_command,
          buildCommand: project.build_command
        });
      } else {
        throw err;
      }
    }
    this.plans.set(id, plan);

    // ---- Stage: install (only when fingerprint changed or env broken) ----
    const stamp = readStamp(dir);
    const valid = validateEnvironment(plan, dir);
    if (!stamp || stamp.fingerprint !== plan.fingerprint || !valid) {
      if (stale()) return;
      if (plan.runtime === 'java') this.setStatus(id, 'building', 'building project');
      else this.setStatus(id, 'installing', 'installing dependencies');
      await this.withFingerprintLock(plan.fingerprint, () =>
        this.queue.run(() =>
          installDependencies(
            plan,
            dir,
            this.loadEnvVars(id),
            (chunk, stream) => this.logLine(id, stream, chunk),
            project.install_command
          )
        )
      );
      if (stale()) return;
      writeStamp(dir, plan);
      recordActivity({ project_id: id, actor: 'system', action: 'deps.install', detail: `dependencies installed (${plan.installKind})` });
    } else {
      noteCacheHit();
      this.logLine(id, 'sys', 'Dependencies up to date — skipping install (fingerprint match).');
    }

    // ---- Java: resolve the built jar ----
    if (plan.runtime === 'java' && plan.runCmd.args.includes('REPLACE_AFTER_BUILD')) {
      const jar = findPrebuiltJar(dir);
      if (!jar) throw new DepError('Build produced no runnable .jar in target/ or build/libs');
      plan.runCmd = { cmd: findJavaBinary(project.java_version), args: ['-jar', jar] };
    }

    // ---- Stage: spawn ----
    if (stale()) return;
    this.spawnProcess(id, plan, gen);
  }

  private async runInstallPhase(id: string, gen: number): Promise<void> {
    const st = this.get(id);
    const project = this.project(id);
    const dir = projectDir(id);
    const plan = detectPlan(dir, {
      javaVersion: project.java_version,
      startCommand: project.start_command,
      installCommand: project.install_command,
      buildCommand: project.build_command
    });
    this.plans.set(id, plan);
    await this.withFingerprintLock(plan.fingerprint, () =>
      this.queue.run(() =>
        installDependencies(
          plan,
          dir,
          this.loadEnvVars(id),
          (chunk, stream) => this.logLine(id, stream, chunk),
          project.install_command
        )
      )
    );
    if (st.generation === gen) writeStamp(dir, plan);
  }

  // ------------------------------------------------------------------
  // Process management
  // ------------------------------------------------------------------

  private spawnProcess(id: string, plan: DepPlan, gen: number): void {
    const st = this.get(id);
    const project = this.project(id);
    const dir = projectDir(id);

    fs.mkdirSync(path.join(dir, '.eplyd', 'tmp'), { recursive: true });
    const env = sanitizeBotEnv(this.loadEnvVars(id), dir);

    this.logLine(id, 'sys', `$ ${plan.runCmd.cmd} ${plan.runCmd.args.join(' ')}`);
    let proc: ChildProcess;
    try {
      proc = spawn(plan.runCmd.cmd, plan.runCmd.args, {
        cwd: dir,
        env,
        detached: true, // own process group → tree-wide stop/kill
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logLine(id, 'err', `spawn failed: ${msg}`);
      this.setStatus(id, 'crashed', msg);
      return;
    }

    st.proc = proc;
    st.pid = proc.pid;
    st.startedAt = Date.now();
    st.ramWarned = false;
    this.setStatus(id, 'running');
    this.markWasRunning(id);
    recordActivity({ project_id: id, actor: 'system', action: 'proc.start', detail: `pid ${proc.pid}` });

    this.attachCgroup(id, proc.pid!, project);

    proc.stdout?.on('data', (d: Buffer) => this.logLine(id, 'out', d.toString('utf8')));
    proc.stderr?.on('data', (d: Buffer) => this.logLine(id, 'err', d.toString('utf8')));

    proc.on('error', (err) => {
      this.logLine(id, 'err', `process error: ${err.message}`);
    });

    proc.on('exit', (code, signal) => {
      if (st.proc !== proc) return; // replaced meanwhile
      const exitedPid = st.pid;
      st.proc = undefined;
      st.pid = undefined;
      st.lastExitCode = code;
      st.lastExitSignal = signal ?? null;
      if (exitedPid) clearTreeSample(exitedPid);
      st.cpuPercent = 0;
      st.rssBytes = 0;
      this.detachCgroup(id);
      this.persistExit(id, code, signal ?? null);
      void this.handleExit(id, gen, code, signal);
    });
  }

  private async handleExit(id: string, gen: number, code: number | null, signal: string | null): Promise<void> {
    const st = this.get(id);
    const project = this.project(id);

    // A newer run replaced this one — its own exit handler will finalize state.
    if (st.proc) return;
    this.clearWasRunning(id);

    const unclean = (code ?? 1) !== 0 || signal !== null;

    // stop()/kill()/restart() bumped the generation: never auto-restart here,
    // but ALWAYS finalize the status so the UI does not stay in 'stopping'.
    if (st.stopRequested || st.generation !== gen) {
      this.setStatus(id, 'stopped', `exit ${signal ?? `code ${code}`}`);
      recordActivity({ project_id: id, actor: 'system', action: 'proc.stop', detail: `exit ${signal ?? `code ${code}`}` });
      return;
    }

    const policy = project.restart_policy;
    if (policy === 'never' || (policy === 'on-failure' && !unclean)) {
      this.setStatus(id, 'stopped', `exit ${signal ?? `code ${code}`}`);
      recordActivity({ project_id: id, actor: 'system', action: 'proc.exit', detail: `exit ${signal ?? `code ${code}`}` });
      return;
    }

    // Crash-loop detection: 5 unclean exits within 10 minutes.
    const now = Date.now();
    if (unclean) {
      st.recentExits.push(now);
      st.recentExits = st.recentExits.filter((t) => now - t < CRASH_LOOP_WINDOW_MS);
      if (st.recentExits.length >= CRASH_LOOP_MAX) {
        this.setStatus(id, 'crash_loop', `${CRASH_LOOP_MAX} crashes in 10 minutes — auto-restarts paused`);
        this.logLine(id, 'err', `Crash loop detected: ${CRASH_LOOP_MAX} unclean exits in 10 minutes. Fix the error, then press Start.`);
        recordActivity({ project_id: id, actor: 'system', action: 'proc.crash_loop', detail: 'auto-restarts paused' });
        void notifyEvent(project, 'crash_loop', `${CRASH_LOOP_MAX} crashes in 10 minutes`);
        return;
      }
    }

    if (st.restartCount >= project.max_restarts) {
      this.setStatus(id, 'crashed', `max restarts (${project.max_restarts}) reached — exit ${signal ?? `code ${code}`}`);
      recordActivity({ project_id: id, actor: 'system', action: 'proc.crashed', detail: 'max restarts reached' });
      void notifyEvent(project, 'crash', `max restarts (${project.max_restarts}) reached`);
      return;
    }

    const delay = BACKOFF_MS[Math.min(st.restartCount, BACKOFF_MS.length - 1)]!;
    st.restartCount += 1;
    st.totalRestarts += 1;
    getDb().prepare('UPDATE projects SET restart_count = ? WHERE id = ?').run(st.totalRestarts, id);

    if (unclean) void notifyEvent(project, 'crash', `exit ${signal ?? `code ${code}`}`);
    this.setStatus(id, 'crashed', `exit ${signal ?? `code ${code}`} — restarting in ${delay / 1000}s (attempt ${st.restartCount}/${project.max_restarts})`);
    recordActivity({ project_id: id, actor: 'system', action: 'proc.restart_scheduled', detail: `backoff ${delay}ms` });

    const curGen = st.generation;
    setTimeout(() => {
      if (st.generation !== curGen || st.stopRequested) return;
      void notifyEvent(project, 'restart', `auto-restart attempt ${st.restartCount}`);
      this.setStatus(id, 'queued', 'auto-restart');
      void this.pipeline(id, st.generation).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logLine(id, 'err', `Restart failed: ${msg}`);
        this.setStatus(id, 'crashed', msg);
      });
    }, delay).unref?.();
  }

  private signalTree(st: State, sig: NodeJS.Signals): void {
    if (!st.pid) return;
    try {
      process.kill(-st.pid, sig); // negative pid → whole process group
    } catch {
      try {
        st.proc?.kill(sig);
      } catch { /* already gone */ }
    }
  }

  private async waitForExit(st: State, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (st.proc && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ------------------------------------------------------------------
  // Resource limits (best-effort cgroup v2)
  // ------------------------------------------------------------------

  private attachCgroup(id: string, pid: number, project: ProjectRow): void {
    try {
      const base = '/sys/fs/cgroup';
      const controllers = fs.readFileSync(`${base}/cgroup.controllers`, 'utf8');
      const dir = `${base}/eplyd.d/${id}`;
      fs.mkdirSync(dir, { recursive: true });
      if (project.ram_limit_mb > 0 && controllers.includes('memory')) {
        fs.writeFileSync(`${dir}/memory.max`, String(project.ram_limit_mb * 1024 * 1024));
      }
      if (project.cpu_limit > 0 && controllers.includes('cpu')) {
        const quota = Math.max(1000, Math.round((project.cpu_limit / 100) * 100_000));
        fs.writeFileSync(`${dir}/cpu.max`, `${quota} 100000`);
      }
      fs.writeFileSync(`${dir}/cgroup.procs`, String(pid));
      this.states.get(id)!.cgroupPath = dir;
      this.logLine(id, 'sys', `cgroup limits applied: cpu ${project.cpu_limit || '∞'}%, ram ${project.ram_limit_mb || '∞'} MB`);
    } catch {
      this.logLine(id, 'sys', 'cgroup limits unavailable on this host — running with soft limits only');
    }
  }

  private detachCgroup(id: string): void {
    const st = this.states.get(id);
    if (!st?.cgroupPath) return;
    try {
      fs.rmdirSync(st.cgroupPath);
    } catch { /* not empty or already gone — harmless */ }
    st.cgroupPath = undefined;
  }

  // ------------------------------------------------------------------
  // Metrics + persistence helpers
  // ------------------------------------------------------------------

  private sampleAll(): void {
    for (const st of this.states.values()) {
      if (st.status === 'running' && st.pid) {
        const s = sampleTree(st.pid);
        st.cpuPercent = s.cpuPercent;
        st.rssBytes = s.rssBytes;
        const project = this.states.has(st.id) ? this.tryProject(st.id) : undefined;
        if (project && project.ram_limit_mb > 0 && s.rssBytes > project.ram_limit_mb * 1024 * 1024 && !st.ramWarned) {
          st.ramWarned = true;
          this.logLine(st.id, 'err', `RAM usage (${Math.round(s.rssBytes / 1048576)} MB) exceeds the configured limit (${project.ram_limit_mb} MB). Hard limit enforced only when cgroups are available.`);
        }
      }
    }
  }

  private tryProject(id: string): ProjectRow | undefined {
    try {
      return this.project(id);
    } catch {
      return undefined;
    }
  }

  private markWasRunning(id: string): void {
    try {
      getDb().prepare('UPDATE projects SET was_running = 1 WHERE id = ?').run(id);
    } catch { /* ignore */ }
  }

  private clearWasRunning(id: string): void {
    try {
      getDb().prepare('UPDATE projects SET was_running = 0 WHERE id = ?').run(id);
    } catch { /* ignore */ }
  }

  private persistExit(id: string, code: number | null, signal: string | null): void {
    try {
      getDb()
        .prepare('UPDATE projects SET last_exit_code = ?, last_exit_signal = ? WHERE id = ?')
        .run(code, signal, id);
    } catch { /* ignore */ }
  }

  loadEnvVars(id: string): Record<string, string> {
    const rows = getDb().prepare('SELECT key, value_enc FROM env_vars WHERE project_id = ?').all(id) as { key: string; value_enc: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) {
      try {
        out[r.key] = aesDecrypt(r.value_enc, config.encryptionKey);
      } catch {
        this.logLine(id, 'err', `Environment variable "${r.key}" could not be decrypted (ENCRYPTION_KEY changed?)`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Snapshots for the API
  // ------------------------------------------------------------------

  snapshot(id: string): {
    status: ProcStatus;
    statusDetail?: string;
    pid: number | null;
    uptimeMs: number;
    restartCount: number;
    totalRestarts: number;
    cpuPercent: number;
    rssBytes: number;
    queuedInstalls: number;
  } {
    this.ensureLoaded();
    const st = this.get(id);
    return {
      status: st.status,
      statusDetail: st.statusDetail,
      pid: st.pid ?? null,
      uptimeMs: st.status === 'running' && st.startedAt ? Date.now() - st.startedAt : 0,
      restartCount: st.restartCount,
      totalRestarts: st.totalRestarts,
      cpuPercent: Math.round(st.cpuPercent * 10) / 10,
      rssBytes: st.rssBytes,
      queuedInstalls: this.queue.pending
    };
  }

  snapshotAll(): Record<string, ReturnType<ProjectManager['snapshot']>> {
    this.ensureLoaded();
    const out: Record<string, ReturnType<ProjectManager['snapshot']>> = {};
    for (const id of this.states.keys()) out[id] = this.snapshot(id);
    return out;
  }

  planFor(id: string): DepPlan | undefined {
    return this.plans.get(id);
  }
}

let singleton: ProjectManager | null = null;

export function getManager(): ProjectManager {
  if (!singleton) singleton = new ProjectManager();
  return singleton;
}
