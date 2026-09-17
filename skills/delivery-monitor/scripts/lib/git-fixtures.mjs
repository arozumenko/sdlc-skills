// STDLIB ONLY. Shared git test fixtures — NOT a *.test.mjs file itself, so importing these helpers
// (e.g. from delivery.test.mjs) never re-registers git-backfill.test.mjs's own test() calls in the
// importing file's process.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-git-'));
export const mkGit = (clock0) => { let clock = Date.parse(clock0); return (repo, args, minutes = 60) => { clock += minutes * 60000; const d = new Date(clock).toISOString(); return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim(); }; };

/** Replays the observed local-branch harness: plan commit, task branches, `address review N`, merge
 * `task/task-NNN (Rio: PASS)`. task/task-003 is the exception (see the `t3` comment below): it is
 * deliberately never merged, so it stays a genuine off-`main` descendant of `head` (obligation F4). */
export function buildFixtureRepo() {
  const repo = tmp(); const git = mkGit('2026-09-15T08:00:00Z');
  const commit = (file, msg, minutes) => { writeFileSync(join(repo, file), `${msg}\n${Math.random()}`); git(repo, ['add', file]); git(repo, ['commit', '-q', '-m', msg], minutes); return git(repo, ['rev-parse', 'HEAD'], 0); };
  git(repo, ['init', '-q', '-b', 'main'], 0);
  writeFileSync(join(repo, 'plan.md'), '# plan\n#### TASK-001: a\n#### TASK-002: b\n#### TASK-003: c\n#### TASK-004: d\n');
  git(repo, ['add', 'plan.md']); git(repo, ['commit', '-q', '-m', 'plan: tasks'], 0);
  const task = (n, rework, unnumbered = false) => {
    git(repo, ['checkout', '-q', '-b', `task/task-${n}`, 'main'], 0);
    const first = commit(`f${n}.txt`, `TASK-${n}: implement`, 30);
    if (rework) commit(`f${n}.txt`, unnumbered ? `TASK-${n}: address review` : `TASK-${n}: address review 1`, 45);
    git(repo, ['checkout', '-q', 'main'], 0);
    git(repo, ['merge', '--no-ff', '-q', '-m', `merge task/task-${n} (Rio: PASS)`, `task/task-${n}`], 20);
    return { first, merge: git(repo, ['rev-parse', 'HEAD'], 0) };
  };
  const t1 = task('001', true), t2 = task('002', false), t4 = task('004', true, true);
  // a second, later merge of TASK-001 (re-landing) — must NOT become episode-1
  git(repo, ['checkout', '-q', 'task/task-001'], 0); commit('f001.txt', 'TASK-001: more', 30); git(repo, ['checkout', '-q', 'main'], 0); git(repo, ['merge', '--no-ff', '-q', '-m', 'merge task/task-001 (Rio: PASS)', 'task/task-001'], 20);
  const head = git(repo, ['rev-parse', 'HEAD'], 0);
  // F4(i): every commit built via `task()` above ends up merged into `main`, so it IS an ancestor of
  // `main` and can never exercise the "head not on the integration ref" branch. task/task-003 is
  // branched off `head` and committed to, but deliberately left UNMERGED — a genuine descendant of
  // `head` (created strictly after it) that never lands on `main`. `git log <head>` cannot see it
  // either, so it also proves the "after head → must not appear" created/first_commit/done cases.
  git(repo, ['checkout', '-q', '-b', 'task/task-003', 'main'], 0);
  const t3first = commit('f003.txt', 'TASK-003: implement', 30);
  git(repo, ['checkout', '-q', 'main'], 0);
  const t3 = { first: t3first };
  return { repo, head, t1, t2, t3, t4 };
}
/** A branch merged under a task alias whose commits never mention the ref → no second-parent evidence. */
export function buildNoEvidenceRepo() {
  const repo = tmp(); const git = mkGit('2026-09-15T08:00:00Z');
  git(repo, ['init', '-q', '-b', 'main'], 0); writeFileSync(join(repo, 'plan.md'), '#### TASK-001: a\n'); git(repo, ['add', 'plan.md']); git(repo, ['commit', '-q', '-m', 'plan'], 0);
  git(repo, ['checkout', '-q', '-b', 'task/task-001', 'main'], 0); writeFileSync(join(repo, 'x.txt'), 'x'); git(repo, ['add', 'x.txt']); git(repo, ['commit', '-q', '-m', 'unrelated work'], 30);
  git(repo, ['checkout', '-q', 'main'], 0); git(repo, ['merge', '--no-ff', '-q', '-m', 'merge task/task-001 (Rio: PASS)', 'task/task-001'], 20);
  return { repo, head: git(repo, ['rev-parse', 'HEAD'], 0) };
}
