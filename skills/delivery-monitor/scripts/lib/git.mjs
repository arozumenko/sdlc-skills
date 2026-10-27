// STDLIB ONLY. Thin git helpers; every failure → null (never a guess).
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function git(repo, args, { cwd } = {}) {
  try { return execFileSync('git', ['-C', cwd ?? repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 20000 }).trim(); } catch { return null; }
}
export function relPath(repo, file) { const physical = (p) => { try { return realpathSync(p); } catch { return resolve(p); } }; const abs = physical(file), root = physical(repo); return abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : file; }
export function commitTime(repo, sha) {
  const out = git(repo, ['show', '-s', '--format=%H%x1f%cI', `${sha}^{commit}`]);
  if (!out) return null; const [full, iso] = out.split('\x1f'); return full && iso ? { sha: full, at: new Date(iso).toISOString() } : null;
}
const wordRe = (ref) => new RegExp(`(^|[^A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`);
export function firstCommitContaining(repo, head, rel, ref) {
  if (!head) return null;
  const out = git(repo, ['log', '--reverse', '--format=%H%x1f%cI', head, '--', rel]);
  if (!out) return null;
  const re = wordRe(ref);
  for (const line of out.split('\n')) { const [sha, at] = line.split('\x1f'); const blob = git(repo, ['show', `${sha}:${rel}`]); if (blob != null && re.test(blob)) return { sha, at: new Date(at).toISOString() }; }
  return null;
}
export function isAncestor(repo, a, b) {
  try { execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch (e) { return e.status === 1 ? false : null; }
}
export function gitState(dir, run = git) {
  const gitDir = run(dir, ['rev-parse', '--git-dir']);
  if (gitDir == null) return { available: false, unmerged: [], merging: false, dirty: false, unpushed: null };
  const unmerged = (run(dir, ['ls-files', '-u']) ?? '').split('\n').filter(Boolean).map((l) => l.split('\t')[1]).filter((v, i, a) => a.indexOf(v) === i);
  const merging = existsSync(join(resolve(dir, gitDir), 'MERGE_HEAD'));
  // Plumbing instead of `status --porcelain` (which can run fsmonitor and refresh the index).
  // Staged: index vs HEAD, an exact object compare. Unstaged: `diff-files` compares stat data and never
  // refreshes, so a file written in the same second as the index is listed "racily"; each candidate is
  // confirmed by hashing its content (no filters, nothing written) against its index blob. A
  // non-regular candidate (symlink, deleted) is never hashed — it counts as dirty.
  const staged = run(dir, ['diff-index', '--cached', '--name-only', 'HEAD', '--']);
  const candidates = (run(dir, ['diff-files', '--name-only', '-z']) ?? '').split('\0').filter(Boolean);
  let changed = Boolean((staged ?? '').trim());
  if (!changed && candidates.length) {
    const regular = (p) => { try { return lstatSync(join(dir, p)).isFile(); } catch { return false; } };
    const blobs = new Map((run(dir, ['ls-files', '-s', '-z']) ?? '').split('\0').filter(Boolean).map((l) => { const [meta, path] = l.split('\t'); return [path, meta.split(' ')[1]]; }));
    const hashes = candidates.every(regular) ? run(dir, ['hash-object', '--no-filters', '--', ...candidates]) : null;
    changed = hashes == null || hashes.split('\n').some((h, i) => h !== blobs.get(candidates[i]));
  }
  const untracked = run(dir, ['ls-files', '--others', '--exclude-standard']);
  const dirty = Boolean(changed || (untracked ?? '').trim());
  const up = run(dir, ['rev-list', '--count', '@{u}..HEAD']);
  return { available: true, unmerged, merging, dirty, unpushed: up == null ? null : Number(up) };
}
