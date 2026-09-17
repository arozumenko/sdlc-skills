import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitTime, firstCommitContaining, isAncestor, gitState, relPath } from './git.mjs';

const mk = () => { const r = mkdtempSync(join(tmpdir(), 'dm-git-')); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r }); execFileSync('git', ['config', 'user.email', 't@x'], { cwd: r }); execFileSync('git', ['config', 'user.name', 'T'], { cwd: r }); return r; };
const commit = (r, file, text, msg, at) => { writeFileSync(join(r, file), text); execFileSync('git', ['add', file], { cwd: r }); execFileSync('git', ['commit', '-q', '-m', msg], { cwd: r, env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }); return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r, encoding: 'utf8' }).trim(); };

test('commitTime, firstCommitContaining (per item, whole word), isAncestor, gitState', () => {
  const r = mk();
  const c1 = commit(r, 'plan.md', '#### TASK-001: a\n', 'plan v1', '2026-09-10T08:00:00Z');
  const c2 = commit(r, 'plan.md', '#### TASK-001: a\n#### TASK-002: b\n', 'plan v2', '2026-09-12T08:00:00Z');
  assert.deepEqual(commitTime(r, c1), { sha: c1, at: '2026-09-10T08:00:00.000Z' });
  assert.equal(commitTime(r, 'nope'), null);
  assert.deepEqual(firstCommitContaining(r, 'HEAD', 'plan.md', 'TASK-002'), { sha: c2, at: '2026-09-12T08:00:00.000Z' });
  assert.deepEqual(firstCommitContaining(r, 'HEAD', 'plan.md', 'TASK-001'), { sha: c1, at: '2026-09-10T08:00:00.000Z' });
  assert.equal(firstCommitContaining(r, 'HEAD', 'plan.md', 'TASK-00'), null, 'whole word only');
  assert.equal(isAncestor(r, c1, c2), true); assert.equal(isAncestor(r, c2, c1), false);
  assert.equal(relPath(r, join(r, 'plan.md')), 'plan.md');
  const s = gitState(r); assert.equal(s.available, true); assert.deepEqual(s.unmerged, []); assert.equal(s.merging, false); assert.equal(s.dirty, false); assert.equal(s.unpushed, null);
});

test('gitState reports unavailable for a non-git directory', () => {
  const r = mkdtempSync(join(tmpdir(), 'dm-nogit-'));
  const s = gitState(r);
  assert.equal(s.available, false); assert.deepEqual(s.unmerged, []); assert.equal(s.merging, false); assert.equal(s.dirty, false); assert.equal(s.unpushed, null);
});
