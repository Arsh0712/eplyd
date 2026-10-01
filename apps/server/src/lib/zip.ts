import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';

export interface ExtractResult {
  files: number;
  bytes: number;
  /** Top-level folder that was stripped (single wrapper folder). */
  strippedRoot?: string;
  skipped: number;
}

const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/];

const MAX_FILES = 50_000;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB uncompressed
const MAX_RATIO = 300;

function isSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  try {
    const attr = (entry as unknown as { attr?: number }).attr;
    if (typeof attr !== 'number') return false;
    return ((attr >>> 16) & 0o170000) === 0o120000;
  } catch {
    return false;
  }
}

function sanitizeName(name: string): string | null {
  let n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split('/').filter((p) => p.length > 0 && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  n = parts.join('/');
  if (n.length === 0) return null;
  for (const rx of IGNORED) if (rx.test(n + (n.endsWith('/') ? '' : ''))) return null;
  if (/(^|\/)__MACOSX(\/|$)/.test(n)) return null;
  if (/(^|\/)\.DS_Store$/.test(n)) return null;
  return n;
}

/**
 * Extract a ZIP buffer into `destRoot` with zip-slip, symlink, bomb and
 * wrapper-folder defenses. Returns basic stats for the deploy summary.
 */
export function extractZipSafely(
  zipBuf: Buffer,
  destRoot: string,
  opts: { maxFiles?: number; maxTotalBytes?: number } = {}
): ExtractResult {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const maxTotal = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const zip = new AdmZip(zipBuf);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  if (entries.length > maxFiles) {
    throw new Error(`ZIP contains too many files (${entries.length} > ${maxFiles})`);
  }

  let totalUncompressed = 0;
  for (const e of entries) {
    totalUncompressed += e.header.size;
  }
  if (totalUncompressed > maxTotal) {
    throw new Error(`ZIP decompresses to ${totalUncompressed} bytes (limit ${maxTotal})`);
  }
  if (zipBuf.length > 0 && totalUncompressed / zipBuf.length > MAX_RATIO) {
    throw new Error('ZIP decompression ratio too high (possible zip bomb)');
  }

  // Detect a single top-level wrapper folder and strip it.
  const topLevel = new Set<string>();
  for (const e of entries) {
    const clean = sanitizeName(e.entryName);
    if (!clean) continue;
    topLevel.add(clean.split('/')[0]!);
  }
  let strippedRoot: string | undefined;
  if (topLevel.size === 1) {
    const only = [...topLevel][0]!;
    const hasNested = entries.some((e) => {
      const clean = sanitizeName(e.entryName);
      return clean ? clean.includes('/') : false;
    });
    if (hasNested) strippedRoot = only;
  }

  const result: ExtractResult = { files: 0, bytes: 0, skipped: 0, strippedRoot };

  for (const e of entries) {
    const clean = sanitizeName(e.entryName);
    if (!clean) {
      result.skipped += 1;
      continue;
    }
    if (isSymlinkEntry(e)) {
      result.skipped += 1;
      continue;
    }
    const rel = strippedRoot && clean.startsWith(strippedRoot + '/')
      ? clean.slice(strippedRoot.length + 1)
      : clean;
    if (rel.length === 0 || rel.endsWith('/')) {
      result.skipped += 1;
      continue;
    }
    const target = path.resolve(destRoot, rel);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
      // Belt-and-braces: sanitizeName already prevents this.
      result.skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const data = e.getData();
    fs.writeFileSync(target, data, { mode: 0o644 });
    result.files += 1;
    result.bytes += data.length;
  }

  return result;
}
