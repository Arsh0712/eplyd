import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { extractZipSafely } from '../lib/zip';

/**
 * Minimal stored (uncompressed) ZIP builder — lets the test craft entries
 * that normal libraries normalize away: raw "../" names, symlinks, etc.
 * This is what an attacker-controlled ZIP actually looks like.
 */
interface RawEntry {
  name: string;
  data: Buffer;
  attr?: number; // external attributes (unix: high 16 bits = mode)
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, e.data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.attr ?? 0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += locals[locals.length - 1]!.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

describe('safe zip extraction', () => {
  let dest: string;

  beforeAll(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'eplyd-zip-'));
  });
  afterAll(() => {
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('blocks zip-slip paths, symlinks and junk, strips wrapper folder', () => {
    const zipBuf = makeStoredZip([
      { name: '../../evil.txt', data: Buffer.from('nope') },
      { name: 'bot/../../../escaped.txt', data: Buffer.from('nope') },
      { name: '/absolute.txt', data: Buffer.from('nope') },
      // symlink entry: unix mode S_IFLNK | 0777, content = target
      { name: 'bot/link.txt', data: Buffer.from('/etc/passwd'), attr: (0o120777 << 16) >>> 0 },
      { name: '__MACOSX/bot/._main.py', data: Buffer.from('junk') },
      { name: 'bot/.DS_Store', data: Buffer.from('junk') },
      { name: 'bot/main.py', data: Buffer.from('print("hi")\n') },
      { name: 'bot/requirements.txt', data: Buffer.from('discord.py>=2.3.2\n') },
      { name: 'bot/cogs/utils.py', data: Buffer.from('x = 1\n') }
    ]);

    const result = extractZipSafely(zipBuf, dest);
    expect(result.files).toBe(3);
    expect(result.skipped).toBeGreaterThanOrEqual(4);
    expect(result.strippedRoot).toBe('bot');

    expect(fs.readFileSync(path.join(dest, 'main.py'), 'utf8')).toContain('print');
    expect(fs.existsSync(path.join(dest, 'requirements.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'cogs/utils.py'))).toBe(true);

    // Nothing escaped the destination.
    expect(fs.existsSync(path.join(dest, 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'escaped.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'absolute.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'link.txt'))).toBe(false);
    expect(fs.existsSync(path.join(path.resolve(dest, '..'), 'evil.txt'))).toBe(false);

    // No symlinks made it through.
    for (const e of fs.readdirSync(dest, { withFileTypes: true })) {
      expect(e.isSymbolicLink()).toBe(false);
    }
  });

  it('extracts plain zips with deps folders intact', () => {
    const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'eplyd-zip2-'));
    const zipBuf = makeStoredZip([
      { name: 'package.json', data: Buffer.from('{"name":"bot"}') },
      { name: 'node_modules/.package-lock.json', data: Buffer.from('{}') },
      { name: 'src/index.js', data: Buffer.from('console.log(1)\n') }
    ]);
    const res = extractZipSafely(zipBuf, sub);
    expect(res.files).toBe(3);
    expect(res.strippedRoot).toBeUndefined();
    expect(fs.existsSync(path.join(sub, 'node_modules', '.package-lock.json'))).toBe(true);
    fs.rmSync(sub, { recursive: true, force: true });
  });

  it('rejects decompression bombs by ratio', () => {
    const zip = new AdmZip();
    zip.addFile('big.bin', Buffer.alloc(50 * 1024 * 1024, 0));
    // Compresses to almost nothing → ratio far above the cap.
    expect(() => extractZipSafely(zip.toBuffer(), dest, { maxTotalBytes: 1024 })).toThrow();
  });
});
