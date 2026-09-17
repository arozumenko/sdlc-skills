// STDLIB ONLY. Thin git helpers; every failure → null (never a guess).
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
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
export function gitState(dir) {
  const gitDir = git(dir, ['rev-parse', '--git-dir']);
  if (gitDir == null) return { available: false, unmerged: [], merging: false, dirty: false, unpushed: null };
  const unmerged = (git(dir, ['ls-files', '-u']) ?? '').split('\n').filter(Boolean).map((l) => l.split('\t')[1]).filter((v, i, a) => a.indexOf(v) === i);
  const merging = existsSync(join(resolve(dir, gitDir), 'MERGE_HEAD'));
  const dirty = Boolean(git(dir, ['status', '--porcelain']));
  const up = git(dir, ['rev-list', '--count', '@{u}..HEAD']);
  return { available: true, unmerged, merging, dirty, unpushed: up == null ? null : Number(up) };
}
