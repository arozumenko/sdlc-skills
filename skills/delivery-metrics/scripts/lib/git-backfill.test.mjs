import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveGitObservations, matchMergeSubject } from './git-backfill.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-git-'));
const mkGit = (clock0) => { let clock = Date.parse(clock0); return (repo, args, minutes = 60) => { clock += minutes * 60000; const d = new Date(clock).toISOString(); return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim(); }; };

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
const run = (repo, from = '2026-09-15T00:00:00Z', integrationRef = 'main') => ({ run: 'sec/run-1', version: 1, source: { path: join(repo, 'plan.md'), rel: 'plan.md' }, source_epoch: { from, until: null, integration_ref: integrationRef }, items: [
  { item_id: 'sec/run-1/task-task-001', ref: 'TASK-001', level: 'task', branch: 'task/task-001' }, { item_id: 'sec/run-1/task-task-002', ref: 'TASK-002', level: 'task', branch: 'task/task-002' },
  { item_id: 'sec/run-1/task-task-003', ref: 'TASK-003', level: 'task', branch: 'task/task-003' }, { item_id: 'sec/run-1/task-task-004', ref: 'TASK-004', level: 'task', branch: 'task/task-004' }] });

test('matchMergeSubject: alias and task/task-NNN, case-insensitive', () => {
  const r = run('/x');
  assert.equal(matchMergeSubject('merge task/task-001 (Rio: PASS)', r).ref, 'TASK-001'); assert.equal(matchMergeSubject('Merge TASK/TASK-002', r).ref, 'TASK-002'); assert.equal(matchMergeSubject('merge feature/x', r), null);
});

test('deriveGitObservations: created/first_commit/rework/done; earliest merge is episode-1; head pins history; unnumbered rework', () => {
  const { repo, head, t1, t2, t4 } = buildFixtureRepo();
  const { records, notes } = deriveGitObservations({ repo, run: run(repo), head, cutoff: '2026-12-31T00:00:00Z' });
  const of = (ref, ev) => records.filter((r) => r.ref === ref && r.event === ev);
  assert.equal(of('TASK-001', 'created').length, 1); assert.equal(of('TASK-001', 'created')[0].basis, 'plan-commit');
  assert.equal(of('TASK-001', 'first_commit')[0].meta.git_sha, t1.first);
  assert.deepEqual(of('TASK-001', 'rework_observed').map((r) => r.meta.round), [1]); assert.equal(of('TASK-001', 'rework_observed')[0].transition_id, 'sec/run-1/task-task-001/rework_observed/1');
  assert.equal(of('TASK-001', 'done').length, 1); assert.equal(of('TASK-001', 'done')[0].meta.git_sha, t1.merge, 'earliest merge, not the later re-landing');
  assert.ok(notes.some((n) => /later merge .* TASK-001/.test(n)));
  assert.equal(of('TASK-002', 'done')[0].meta.git_sha, t2.merge); assert.equal(of('TASK-002', 'rework_observed').length, 0);
  assert.equal(of('TASK-004', 'rework_observed')[0].meta.round, null); assert.match(of('TASK-004', 'rework_observed')[0].transition_id, /rework_observed\/x[0-9a-f]{7}$/); assert.equal(of('TASK-004', 'done')[0].meta.git_sha, t4.merge);
  assert.equal(of('TASK-003', 'done').length, 0); assert.equal(of('TASK-003', 'first_commit').length, 0); assert.equal(of('TASK-003', 'created').length, 1);
  assert.ok(records.every((r) => r.source === 'git' && r.host === 'git' && r.meta.version === 1 && r.meta.head === head));
});

test('no second-parent evidence → note, no done; head off the integration ref → USAGE; epoch filtering happens before "first" selection', () => {
  const { repo, head } = buildNoEvidenceRepo();
  const r = deriveGitObservations({ repo, run: run(repo), head, cutoff: '2026-12-31T00:00:00Z' });
  assert.equal(r.records.filter((x) => x.event === 'done').length, 0); assert.ok(r.notes.some((n) => /lacks second-parent evidence/.test(n)));

  // F4(i): fx.t1.first is merged into main by buildFixtureRepo, so isAncestor(t1.first, main) is
  // true and it cannot exercise the "head not on the integration ref" branch. fx.t3.first is a
  // genuine descendant of `head` on an unmerged branch — not an ancestor of main's tip.
  const fx = buildFixtureRepo();
  assert.throws(() => deriveGitObservations({ repo: fx.repo, run: run(fx.repo), head: fx.t3.first, cutoff: '2026-12-31T00:00:00Z' }), (e) => e.code === 'USAGE' && /not on integration ref/.test(e.message), 'an unmerged branch tip is not on main');

  // F4(ii): mkGit's shared clock advances on EVERY call it makes — including `add`/`checkout`, which
  // pass no third argument and so take the default 60-minute step — not only on `commit`/`merge`.
  // Replaying buildFixtureRepo's exact call sequence up to TASK-001's first commit:
  //   init(+0)=08:00 -> add plan.md(+60 default)=09:00 -> commit "plan: tasks"(+0)=09:00
  //   -> checkout -b task-001(+0)=09:00 -> add f001.txt(+60 default)=10:00
  //   -> commit "TASK-001: implement"(+30)=10:30  [[ t1.first ]]
  //   -> rev-parse(+0)=10:30 -> add f001.txt rework(+60 default)=11:30
  //   -> commit "TASK-001: address review 1"(+45)=12:15 -> rev-parse(+0)=12:15
  //   -> checkout main(+0)=12:15 -> merge(+20)=12:35  [[ t1.merge ]]
  // TASK-001's true first commit is therefore 10:30 (not the plan draft's assumed 08:30). With
  // source_epoch.from = 11:00 (after 10:30, before 12:15) that true-earliest commit is genuinely
  // outside the epoch — proving epoch filtering must happen BEFORE "first" selection: the item is
  // never simply dropped, and the excluded 10:30 commit is never treated as "first" either. Instead
  // the earliest commit that IS in epoch (12:15, "address review 1") becomes first_commit.
  const late = deriveGitObservations({ repo: fx.repo, run: run(fx.repo, '2026-09-15T11:00:00Z'), head: fx.head, cutoff: '2026-12-31T00:00:00Z' });
  const t1First = late.records.find((x) => x.ref === 'TASK-001' && x.event === 'first_commit');
  assert.ok(t1First, 'the earliest in-epoch same-ref commit still yields a first_commit record');
  assert.notEqual(t1First.meta.git_sha, fx.t1.first, 'the true-earliest commit (10:30) is before the 11:00 epoch and must not be selected');
  assert.match(t1First.raw, /address review 1/, 'the earliest IN-EPOCH same-ref commit (12:15) is selected instead of the excluded 10:30 one');
  assert.ok(late.skippedOutsideEpoch >= 1);
});

test('F14: --since gates emission only, not episode-1 selection; an unresolvable integration_ref is a hard USAGE error, never accepted unverified', () => {
  const fx = buildFixtureRepo();
  // TASK-001's episode-1 merge is t1.merge (12:35); its later re-landing merge is `head` (19:50).
  // TASK-002's episode-1 merge is t2.merge (14:25). TASK-004's episode-1 merge is t4.merge (18:00).
  // --since = 15:00 therefore falls strictly between TASK-002's/TASK-001's episode-1 and TASK-004's.
  const r = deriveGitObservations({ repo: fx.repo, run: run(fx.repo), head: fx.head, since: '2026-09-15T15:00:00Z', cutoff: '2026-12-31T00:00:00Z' });
  assert.equal(r.records.filter((x) => x.ref === 'TASK-001' && x.event === 'done').length, 0, 'episode-1 (12:35) predates --since (15:00) → no done record emitted this run');
  assert.equal(r.records.filter((x) => x.ref === 'TASK-002' && x.event === 'done').length, 0, 'episode-1 (14:25) predates --since (15:00) → no done record emitted this run');
  assert.ok(r.notes.some((n) => /later merge .* TASK-001/.test(n)), 'the later re-landing merge (19:50) is still only a reopen-evidence note — --since never promotes it to episode-1');
  assert.equal(r.records.filter((x) => x.ref === 'TASK-004' && x.event === 'done')[0].meta.git_sha, fx.t4.merge, 'TASK-004 episode-1 (18:00) is after --since (15:00) → emitted normally');

  assert.throws(
    () => deriveGitObservations({ repo: fx.repo, run: run(fx.repo, '2026-09-15T00:00:00Z', 'not-a-real-ref'), head: fx.head, cutoff: '2026-12-31T00:00:00Z' }),
    (e) => e.code === 'USAGE' && /integration ref not-a-real-ref not found/.test(e.message),
    'an unresolvable declared integration_ref is USAGE, never "accepted unverified"',
  );
});
