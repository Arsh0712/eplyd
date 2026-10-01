import os from 'node:os';
import fs from 'node:fs';

const CLK_TCK = 100; // standard Linux userspace Hz
const PAGE_SIZE = 4096; // x86_64/aarch64 Linux page size

export interface PidStat {
  ppid: number;
  utime: number;
  stime: number;
  rssPages: number;
}

export function readPidStat(pid: number): PidStat | undefined {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // comm may contain spaces/parens — parse after the last ')'
    const close = text.lastIndexOf(')');
    const rest = text.slice(close + 2).split(' ');
    // rest[0] = state(3). ppid = field 4 → rest[1]
    return {
      ppid: parseInt(rest[1]!, 10),
      utime: parseInt(rest[11]!, 10),
      stime: parseInt(rest[12]!, 10),
      rssPages: parseInt(rest[21]!, 10)
    };
  } catch {
    return undefined;
  }
}

/** All descendant PIDs of rootPid (process tree), including rootPid. */
export function treePids(rootPid: number): number[] {
  const parentOf = new Map<number, number>();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n));
  } catch {
    return [rootPid];
  }
  for (const e of entries) {
    const st = readPidStat(parseInt(e, 10));
    if (st) parentOf.set(parseInt(e, 10), st.ppid);
  }
  const out = [rootPid];
  const queue = [rootPid];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [pid, ppid] of parentOf) {
      if (ppid === cur && !out.includes(pid)) {
        out.push(pid);
        queue.push(pid);
      }
    }
  }
  return out;
}

export interface TreeSample {
  cpuPercent: number; // % of total machine capacity
  rssBytes: number;
}

const lastTicks = new Map<number, { at: number; ticks: number }>();

/** Sample CPU/RSS of a process tree, delta-based against the previous call. */
export function sampleTree(rootPid: number): TreeSample {
  const pids = treePids(rootPid);
  let ticks = 0;
  let rssBytes = 0;
  for (const pid of pids) {
    const st = readPidStat(pid);
    if (!st) continue;
    ticks += st.utime + st.stime;
    rssBytes += st.rssPages * PAGE_SIZE;
  }
  const now = Date.now();
  const prev = lastTicks.get(rootPid);
  lastTicks.set(rootPid, { at: now, ticks });
  let cpuPercent = 0;
  if (prev && now > prev.at) {
    const intervalSec = (now - prev.at) / 1000;
    const totalCapacity = intervalSec * CLK_TCK * os.cpus().length;
    cpuPercent = Math.max(0, Math.min(100, ((ticks - prev.ticks) / totalCapacity) * 100));
  }
  return { cpuPercent, rssBytes };
}

export function clearTreeSample(rootPid: number): void {
  lastTicks.delete(rootPid);
}

export interface HostMetrics {
  cpuPercent: number;
  cores: number;
  loadavg: number[];
  totalMem: number;
  freeMem: number;
  usedMem: number;
  diskTotal: number;
  diskFree: number;
  uptimeSec: number;
}

let lastCpuTimes: { idle: number; total: number } | null = null;

export function hostMetrics(diskPath: string): HostMetrics {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  let cpuPercent = 0;
  if (lastCpuTimes && total > lastCpuTimes.total) {
    cpuPercent = Math.max(0, Math.min(100, (1 - (idle - lastCpuTimes.idle) / (total - lastCpuTimes.total)) * 100));
  }
  lastCpuTimes = { idle, total };

  let diskTotal = 0;
  let diskFree = 0;
  try {
    const syncStat = (fs as unknown as { statfsSync?: (p: string) => { blocks: number; bsize: number; bavail: number } }).statfsSync;
    if (syncStat) {
      const st = syncStat(diskPath);
      diskTotal = st.blocks * st.bsize;
      diskFree = st.bavail * st.bsize;
    }
  } catch { /* disk metrics unavailable */ }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cpuPercent,
    cores: cpus.length,
    loadavg: os.loadavg(),
    totalMem,
    freeMem,
    usedMem: totalMem - freeMem,
    diskTotal,
    diskFree,
    uptimeSec: Math.round(process.uptime())
  };
}
