import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeResolve, resolveInsideRoot, PathError } from '../lib/paths';

describe('path traversal protection', () => {
  it('safeResolve rejects escapes', () => {
    const root = '/tmp/eplyd-root';
    expect(() => safeResolve(root, '../..')).toThrow(PathError);
    expect(() => safeResolve(root, 'a/../../b')).toThrow(PathError);
    expect(() => safeResolve(root, '/etc/passwd')).toThrow(PathError);
    expect(() => safeResolve(root, 'sub/../../x')).toThrow(PathError);
    expect(safeResolve(root, 'sub/file.txt')).toBe(path.resolve(root, 'sub/file.txt'));
    expect(safeResolve(root, '.')).toBe(path.resolve(root));
  });

  describe('symlink-aware containment', () => {
    let root: string;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'eplyd-paths-'));
      fs.mkdirSync(path.join(root, 'real'));
      fs.symlinkSync('/etc', path.join(root, 'evil-link'));
      fs.writeFileSync(path.join(root, 'real', 'ok.txt'), 'hello');
    });
    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('rejects reading through a symlink escaping the root', () => {
      expect(() => resolveInsideRoot(root, 'evil-link/passwd')).toThrow(PathError);
      expect(() => resolveInsideRoot(root, 'evil-link')).toThrow(PathError);
    });

    it('allows normal files and new files under the root', () => {
      expect(resolveInsideRoot(root, 'real/ok.txt')).toBe(path.join(root, 'real', 'ok.txt'));
      expect(resolveInsideRoot(root, 'real/new-file.txt')).toBe(path.join(root, 'real', 'new-file.txt'));
      expect(resolveInsideRoot(root, 'brand/new/dir/f.txt')).toBe(path.join(root, 'brand/new/dir/f.txt'));
    });
  });
});
