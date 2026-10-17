// Project-confined, symlink-refusing reads for `doctor`. Every component from the
// project root to the leaf is lstat'ed; a symlink anywhere is reported, not followed.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, isAbsolute, normalize, sep } from 'node:path';
import { TextDecoder } from 'node:util';

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function createSafeFs(projectDir) {
  const walk = (rel) => {
    if (typeof rel !== 'string' || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return { status: 'escapes', path: String(rel) };
    const parts = normalize(rel).split(sep).filter((s) => s && s !== '.');
    let cur = projectDir;
    for (let i = 0; i < parts.length; i++) {
      cur = join(cur, parts[i]);
      let st;
      try { st = lstatSync(cur); } catch (e) { return { status: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : 'unreadable', path: rel }; }
      if (st.isSymbolicLink()) return { status: 'symlink', path: rel };
      if (i < parts.length - 1 && !st.isDirectory()) return { status: 'missing', path: rel };
      if (i === parts.length - 1) return { status: 'ok', path: rel, abs: cur, st };
    }
    return { status: 'ok', path: rel, abs: projectDir, st: lstatSync(projectDir) };
  };
  const read = (rel) => {
    const w = walk(rel);
    if (w.status !== 'ok') return { status: w.status, path: w.path };
    if (!w.st.isFile()) return { status: 'not-regular', path: rel };
    try { return { status: 'ok', path: rel, content: readFileSync(w.abs) }; } catch { return { status: 'unreadable', path: rel }; }
  };
  return {
    read,
    readText(rel) {
      const r = read(rel);
      if (r.status !== 'ok') return r;
      try { return { status: 'ok', path: rel, content: utf8.decode(r.content) }; } catch { return { status: 'not-text', path: rel }; }
    },
    list(rel) {
      const w = walk(rel);
      if (w.status !== 'ok') return { status: w.status, entries: [] };
      if (!w.st.isDirectory()) return { status: 'not-regular', entries: [] };
      try {
        const entries = readdirSync(w.abs, { withFileTypes: true }).map((e) => ({
          name: e.name,
          type: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
        }));
        return { status: 'ok', entries: entries.sort((a, b) => a.name.localeCompare(b.name)) };
      } catch { return { status: 'unreadable', entries: [] }; }
    },
    exists(rel) { return walk(rel).status === 'ok'; },
  };
}
