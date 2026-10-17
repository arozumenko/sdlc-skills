import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSafeFs } from './fsx.mjs';

function proj() {
  const root = mkdtempSync(join(tmpdir(), 'dfs-'));
  const p = join(root, 'my proj é'); mkdirSync(join(p, 'a', 'b'), { recursive: true });
  writeFileSync(join(p, 'a', 'b', 'f.txt'), 'hi');
  writeFileSync(join(root, 'outside.txt'), 'secret');
  return { root, p };
}

test('reads a regular file; missing is distinct', () => {
  const { root, p } = proj();
  try {
    const fs = createSafeFs(p);
    assert.equal(fs.readText('a/b/f.txt').content, 'hi');
    assert.equal(fs.read('a/b/nope').status, 'missing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('leaf and ancestor symlinks are reported, never followed', () => {
  const { root, p } = proj();
  try {
    symlinkSync(join(root, 'outside.txt'), join(p, 'leaf-link'));
    symlinkSync(join(p, 'a'), join(p, 'dir-link'));
    const fs = createSafeFs(p);
    assert.equal(fs.read('leaf-link').status, 'symlink');
    assert.equal(fs.read('dir-link/b/f.txt').status, 'symlink');
    assert.equal(fs.list('dir-link').status, 'symlink');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('escaping paths and directories are refused', () => {
  const { root, p } = proj();
  try {
    const fs = createSafeFs(p);
    assert.equal(fs.read('../outside.txt').status, 'escapes');
    assert.equal(fs.read('/etc/passwd').status, 'escapes');
    assert.equal(fs.read('a').status, 'not-regular');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unreadable and non-UTF-8 files', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const { root, p } = proj();
  try {
    writeFileSync(join(p, 'bin.dat'), Buffer.from([0xff, 0xfe, 0x00, 0xc3]));
    writeFileSync(join(p, 'locked.md'), 'x'); chmodSync(join(p, 'locked.md'), 0o000);
    const fs = createSafeFs(p);
    assert.equal(fs.readText('bin.dat').status, 'not-text');
    assert.equal(fs.read('locked.md').status, 'unreadable');
  } finally { chmodSync(join(p, 'locked.md'), 0o644); rmSync(root, { recursive: true, force: true }); }
});
