import fs from 'node:fs';
import path from 'node:path';

export interface LogLine {
  /** epoch ms */
  t: number;
  /** stream */
  s: 'out' | 'err' | 'sys';
  /** decoded text chunk (may contain ANSI escapes) */
  d: string;
}

/**
 * Disk-backed append log with size rotation (JSON lines).
 * Keeps the current file plus one rotated generation `.old`.
 */
export class LogStore {
  constructor(
    public readonly file: string,
    private maxBytes: number = 10 * 1024 * 1024
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  append(stream: LogLine['s'], data: Buffer | string): LogLine {
    const text = typeof data === 'string' ? data : data.toString('utf8');
    const line: LogLine = { t: Date.now(), s: stream, d: text };
    try {
      const st = fs.statSync(this.file);
      if (st.size + text.length > this.maxBytes) this.rotate();
    } catch {
      /* file does not exist yet */
    }
    fs.appendFileSync(this.file, JSON.stringify(line) + '\n');
    return line;
  }

  rotate(): void {
    const old = this.file + '.old';
    try {
      fs.rmSync(old, { force: true });
      fs.renameSync(this.file, old);
    } catch {
      /* nothing to rotate */
    }
  }

  clear(): void {
    try {
      fs.rmSync(this.file, { force: true });
    } catch { /* ignore */ }
    try {
      fs.rmSync(this.file + '.old', { force: true });
    } catch { /* ignore */ }
  }

  /** Read the last `n` lines (newest last). Tolerates truncated/partial lines. */
  tailLines(n = 1000): LogLine[] {
    let raw: Buffer;
    try {
      raw = fs.readFileSync(this.file);
    } catch {
      return [];
    }
    if (raw.length === 0) return [];
    const text = raw.toString('utf8');
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const slice = lines.slice(-n);
    const out: LogLine[] = [];
    for (const l of slice) {
      try {
        const parsed = JSON.parse(l) as LogLine;
        if (parsed && typeof parsed.d === 'string') out.push(parsed);
      } catch {
        /* skip malformed line */
      }
    }
    return out;
  }

  sizeBytes(): number {
    try {
      return fs.statSync(this.file).size;
    } catch {
      return 0;
    }
  }
}

const stores = new Map<string, LogStore>();

export function getLogStore(projectId: string, dataLogsDir: string, maxBytes?: number): LogStore {
  let store = stores.get(projectId);
  if (!store) {
    store = new LogStore(path.join(dataLogsDir, `${projectId}.log`), maxBytes);
    stores.set(projectId, store);
  }
  return store;
}
