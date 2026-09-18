import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, validateTransition } from './delivery.mjs';
import { deliveryDir, runPath } from './lib/paths.mjs';
import { resolveObservations } from './lib/events.mjs';
import { deriveGitObservations } from './lib/git-backfill.mjs';
import { buildFixtureRepo } from './lib/git-fixtures.mjs';

const CLI = fileURLToPath(new URL('./delivery.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'dm-cli-'));
export const run = (repo, args, { input, env = {} } = {}) => {
  try { return { code: 0, stdout: execFileSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', input, env: { ...process.env, DELIVERY_NO_SYNC: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] }), stderr: '' }; }
  catch (e) { return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
};
const git = (repo, ...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
export const initRepo = () => { const r = tmp(); git(r, 'init', '-q', '-b', 'main'); git(r, 'config', 'user.email', 't@x'); git(r, 'config', 'user.name', 'Tester'); return r; };
const EST = { unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tech-lead', proposed_at: '2026-09-16T08:00:00Z', accepted_by: 'Daniel', accepted_at: '2026-09-16T08:30:00Z' };
export const plan = (v = 1, tasks = [{ ref: 'TASK-001', class: 'S', branch: 'task/task-001', estimate: EST }, { ref: 'TASK-002' }]) => ({
  campaign_id: 'sec', run_id: 'run-1', version: v, factory: 'feature-development', observation_start: '2026-09-16T08:00:00Z',
  source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks }],
});
export const writePlan = (repo, p, name = 'plan.md') => { const f = join(repo, name); writeFileSync(f, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`); return f; };
const commitAt = (repo, msg, at) => { writeFileSync(join(repo, `${Math.random()}.txt`), msg); git(repo, 'add', '.'); execFileSync('git', ['commit', '-q', '-m', msg], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at } }); return git(repo, 'rev-parse', 'HEAD'); };
const installAgent = (repo, name) => { const d = join(repo, '.claude', 'agents', name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'AGENT.md'), `# ${name}\n`); };

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['event', 'TASK-1', 'done', '--plan', 'p', '--keep-missing']), { cmd: 'event', sub: null, positional: ['TASK-1', 'done'], flags: { plan: 'p', 'keep-missing': true } });
  assert.equal(parseArgs(['plan', 'register', '--from', 'f']).sub, 'register');
});

test('plan register: block → run file, per-item plan-commit creation, observations; identical retry re-emits with SKIP; reused token with new input → ID-CONFLICT', () => {
  const repo = initRepo();
  writePlan(repo, plan(1, [{ ref: 'TASK-001', class: 'S', branch: 'task/task-001', estimate: EST }]));
  execFileSync('git', ['add', 'plan.md'], { cwd: repo }); execFileSync('git', ['commit', '-q', '-m', 'plan v1'], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-10T08:00:00Z', GIT_AUTHOR_DATE: '2026-09-10T08:00:00Z' } });
  const f = writePlan(repo, plan()); // adds TASK-002 later
  execFileSync('git', ['add', 'plan.md'], { cwd: repo }); execFileSync('git', ['commit', '-q', '-m', 'plan v1 + task 2'], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-12T08:00:00Z', GIT_AUTHOR_DATE: '2026-09-12T08:00:00Z' } });
  const pinnedHead = git(repo, 'rev-parse', 'HEAD');
  const r = run(repo, ['plan', 'register', '--from', f, '--id', 'reg-1']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PLAN sec\/run-1 v1 items=4 created=4 estimated=1 stale-acceptance=0 cancelled=0 reopened=0 accepted=1 unaccepted=0 unestimated=3/);
  const rec = JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8'));
  assert.equal(rec.status, 'open'); assert.equal(rec.versions.length, 1); assert.ok(rec.requests['reg-1']); assert.ok(Array.isArray(rec.roster.agents));
  assert.equal(rec.source.head, pinnedHead); assert.equal(rec.requests['reg-1'].source_head, pinnedHead);
  const { active } = resolveObservations(repo);
  const c1 = active.find((o) => o.event === 'created' && o.ref === 'TASK-001'), c2 = active.find((o) => o.event === 'created' && o.ref === 'TASK-002');
  assert.equal(c1.basis, 'plan-commit'); assert.equal(c1.at, '2026-09-10T08:00:00.000Z'); assert.equal(c2.at, '2026-09-12T08:00:00.000Z', 'creation is per item, not per file');
  commitAt(repo, 'later branch growth', '2026-09-18T00:00:00Z');
  const again = run(repo, ['plan', 'register', '--from', f, '--id', 'reg-1']);
  assert.equal(again.code, 0, again.stderr); assert.match(again.stdout, /\(retry\)/); assert.equal((again.stdout.match(/^SKIP/gm) || []).length, 5);
  assert.equal(resolveObservations(repo).active.length, 5);
  const reused = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'TASK-009' }]), 'other.md'), '--id', 'reg-1']);
  assert.equal(reused.code, 2); assert.match(reused.stderr, /^ID-CONFLICT\(registration token/);
});

test('plan register: v2 re-cut needs --at; cancels removed, stale acceptance on changed range; --keep-missing; lower version rejected; supersedes validated', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const v2 = plan(2, [{ ref: 'TASK-001', class: 'S', branch: 'task/task-001', estimate: { ...EST, high: 5 } }]);
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2']).stderr, /^USAGE\(re-cut requires --at/);
  const r2 = run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2', '--at', '2026-09-17T00:00:00Z']);
  assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /v2 .*stale-acceptance=1 cancelled=1/);
  const { active } = resolveObservations(repo);
  assert.equal(active.find((o) => o.event === 'cancelled').ref, 'TASK-002');
  const ests = active.filter((o) => o.event === 'estimated' && o.ref === 'TASK-001');
  assert.equal(ests.length, 2); assert.equal(ests[1].meta.acceptance, 'stale-acceptance'); assert.equal(ests[1].transition_id, 'sec/run-1/task-task-001/estimated/rev-1');
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1), 'p1.md'), '--id', 'reg-3', '--at', '2026-09-18T00:00:00Z']).stderr, /^USAGE\(version must exceed 2/);
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(3, [{ ref: 'TASK-001' }]), 'p3.md'), '--id', 'reg-4', '--at', '2026-09-18T00:00:00Z', '--keep-missing']).stdout, /cancelled=0/);
  const bad = plan(4, [{ ref: 'TASK-001' }]); bad.supersedes = { run: 'sec/run-1', item_map: { 'sec/run-1/task-nope': 'sec/run-1/task-task-001' } };
  assert.match(run(repo, ['plan', 'register', '--from', writePlan(repo, bad, 'p4.md'), '--id', 'reg-5', '--at', '2026-09-19T00:00:00Z']).stderr, /^MIGRATION-REQUIRED/);
  assert.equal(JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8')).items.find((i) => i.ref === 'TASK-002').version_added, 1);
});

test('plan register: schema error → SCHEMA-INVALID; markdown import prints block and needs --yes', () => {
  const repo = initRepo();
  const bad = plan(); bad.factory = 'ops';
  const r = run(repo, ['plan', 'register', '--from', writePlan(repo, bad), '--id', 'x']);
  assert.equal(r.code, 2); assert.match(r.stderr, /^SCHEMA-INVALID\(factory/);
  const md = join(repo, 'tasks.md'); writeFileSync(md, '## 1. Execution plan\n\n```\nG0   001 t\n```\n\n#### TASK-001: t\n**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S\n');
  const dry = run(repo, ['plan', 'register', '--from', md, '--id', 'imp-1', '--campaign', 'sec', '--run', 'run-1', '--observation-start', '2026-09-16T00:00:00Z']);
  assert.equal(dry.code, 0); assert.match(dry.stdout, /DRY-RUN/); assert.ok(!existsSync(runPath(repo, 'sec/run-1')));
  const yes = run(repo, ['plan', 'register', '--from', md, '--id', 'imp-1', '--campaign', 'sec', '--run', 'run-1', '--observation-start', '2026-09-16T00:00:00Z', '--yes']);
  assert.equal(yes.code, 0, yes.stderr); assert.match(yes.stdout, /unestimated=3/);
});

test('review fix: a freshly registered plan (created events only, no dispatch) never promotes mission/campaign to in_progress', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const r = run(repo, ['report', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  const items = doc.plans[0].items;
  for (const i of items.filter((i) => i.level !== 'task')) assert.equal(i.state, 'planned', `${i.ref} (${i.level}) should stay planned on bare registration`);
  assert.equal(doc.plans[0].metrics.wip.mission, 0);
  assert.equal(doc.plans[0].metrics.wip.campaign, 0);
  const status = run(repo, ['status']);
  assert.equal(status.code, 0, status.stderr);
  assert.doesNotMatch(status.stdout, /mission: done=\d+ in_progress=[1-9]/);
  assert.ok(!/open G1/.test(status.stdout), 'no open mission listed');
});

test('event: --sha clock, SKIP, correction via --revision, at/sha disagreement, transition validation, errors are exit 2/3 never INTERNAL', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const sha = commitAt(repo, 'TASK-001: work', '2026-09-16T12:00:00Z');
  const r = run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--id', 'done-1']);
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^EVENT cli:done-1:sec%2Frun-1%2Ftask-task-001:done 2026-09-16T12:00:00.000Z/);
  assert.match(run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--id', 'done-1']).stdout, /^SKIP/);
  const dis = run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--at', '2026-09-16T11:00:00Z', '--id', 'done-1']);
  assert.equal(dis.code, 2); assert.match(dis.stderr, /^USAGE\(at and sha disagree/);
  const fix = run(repo, ['event', 'TASK-001', 'done', '--sha', sha, '--at', '2026-09-16T11:00:00Z', '--id', 'done-1', '--revision', '1']);
  assert.equal(fix.code, 0, fix.stderr);
  const d = resolveObservations(repo).active.find((o) => o.event === 'done'); assert.equal(d.at, '2026-09-16T11:00:00.000Z'); assert.equal(d.meta.git_sha, sha); assert.equal(d.meta.clock, 'corrected');
  const inv = run(repo, ['event', 'TASK-001', 'cancelled', '--id', 'c1']);
  assert.equal(inv.code, 2); assert.match(inv.stderr, /^INVALID-TRANSITION\(.*done/);
  assert.match(run(repo, ['event', 'TASK-002', 'reopened', '--id', 'r1']).stderr, /^INVALID-TRANSITION/);
  assert.match(run(repo, ['event', 'TASK-9', 'done', '--id', 'z']).stderr, /^USAGE\(unknown ref TASK-9/);
  assert.match(run(repo, ['event', 'TASK-002', 'merged', '--id', 'z']).stderr, /^USAGE\(unknown event/);
  assert.match(run(repo, ['event', 'TASK-002', 'done', '--at', 'yesterday', '--id', 'z']).stderr, /^USAGE\(invalid --at/);
  const empty = initRepo(); const np = run(empty, ['event', 'TASK-1', 'done', '--id', 'z']); assert.equal(np.code, 3); assert.match(np.stderr, /^NO-PLAN/);
  mkdirSync(join(deliveryDir(repo), '.lock'), { recursive: true });
  const busy = run(repo, ['event', 'TASK-002', 'dispatched', '--id', 'l1']); assert.equal(busy.code, 2); assert.match(busy.stderr, /^LOCK-BUSY/);
});

test('event: CLI CONFLICT guard — two equal-rank cli records disagreeing on the same occurrence are rejected (ledger unchanged); equivalent facts under a different token still coalesce', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const a = run(repo, ['event', 'TASK-001', 'done', '--id', 'A', '--at', '2026-09-16T11:00:00Z']);
  assert.equal(a.code, 0, a.stderr);
  const b = run(repo, ['event', 'TASK-001', 'done', '--id', 'B', '--at', '2026-09-16T12:00:00Z']);
  assert.equal(b.code, 2);
  assert.match(b.stderr, /^CONFLICT\(TASK-001 done: an equal-priority record disagrees \(cli:A:sec%2Frun-1%2Ftask-task-001:done rev 0\); record a correction with --revision or retract it\)/);
  const afterConflict = resolveObservations(repo).active.filter((o) => o.event === 'done');
  assert.equal(afterConflict.length, 1, 'the conflicting record was never appended — ledger unchanged');
  assert.equal(afterConflict[0].at, '2026-09-16T11:00:00.000Z');
  const c = run(repo, ['event', 'TASK-001', 'done', '--id', 'C', '--at', '2026-09-16T11:00:00Z']);
  assert.equal(c.code, 0, c.stderr, 'same at as token A, different token — equivalent facts coalesce, allowed');
  assert.match(c.stdout, /^EVENT/);
  assert.equal(resolveObservations(repo).active.filter((o) => o.event === 'done').length, 2, 'A and C are both recorded as separate observations of the identical fact');
});

test('validateTransition rules', () => {
  const h = (...evs) => evs.map((e, i) => ({ event: e, at: `2026-09-1${i}T00:00:00.000Z` }));
  assert.equal(validateTransition(h('created', 'done'), 'done'), null, 'second done is the same occurrence (retry/correction), not a transition error');
  assert.match(validateTransition(h('created', 'done'), 'cancelled'), /done/);
  assert.match(validateTransition(h('created', 'cancelled'), 'done'), /cancelled/);
  assert.equal(validateTransition(h('created', 'cancelled', 'reopened'), 'done'), null);
  assert.match(validateTransition(h('created'), 'reopened'), /not terminal/);
  assert.equal(validateTransition(h('created', 'done'), 'dispatched'), null);
});

test('event --from jsonl (invalid line counted, exit 2); session set; plan list/show/close/roster (F3: roster requires the installed union)', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const f = join(repo, 'ev.jsonl');
  writeFileSync(f, `${JSON.stringify({ ref: 'TASK-001', event: 'dispatched', at: '2026-09-16T09:00:00Z', id: 'd1' })}\n${JSON.stringify({ ref: 'TASK-001', event: 'done', at: '2026-09-16T10:00:00Z', id: 'd2' })}\n{oops\n`);
  const r = run(repo, ['event', '--from', f]);
  assert.equal(r.code, 2); assert.match(r.stdout, /EVENTS appended=2 skipped=0 conflicts=0 invalid=1/); assert.match(r.stderr, /line 3: invalid json/);
  assert.equal(run(repo, ['session', 'set', '--host', 'claude', '--session', 'sess-1', '--plan', 'sec/run-1']).code, 0);
  assert.ok(existsSync(join(deliveryDir(repo), 'sessions', 'claude%3Asess-1.json')));
  assert.match(run(repo, ['plan', 'list']).stdout, /PLAN sec\/run-1 v1 status=open items=4/);
  assert.equal(JSON.parse(run(repo, ['plan', 'show', '--plan', 'sec/run-1']).stdout).campaign_id, 'sec');
  // F3: makeRoster asserts --agents equals the *installed* participating-factory union — the fixture
  // must install the two agent dirs before the union can equal ['js-dev', 'tech-lead'].
  installAgent(repo, 'js-dev'); installAgent(repo, 'tech-lead');
  const okRoster = run(repo, ['plan', 'roster', '--plan', 'sec/run-1', '--agents', 'js-dev,tech-lead']);
  assert.equal(okRoster.code, 0, okRoster.stderr);
  assert.deepEqual(JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8')).roster.agents, ['js-dev', 'tech-lead']);
  // Negative: a foreign or absent role is rejected, not silently accepted (Task 1's new roster boundary).
  const badRoster = run(repo, ['plan', 'roster', '--plan', 'sec/run-1', '--agents', 'js-dev,tech-lead,ghost-role']);
  assert.equal(badRoster.code, 2); assert.match(badRoster.stderr, /^USAGE\(roster must equal installed/);
  run(repo, ['plan', 'close', '--plan', 'sec/run-1']);
  assert.equal(JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8')).status, 'closed');
});

// F9: capture-version changes must not break retries. Register v1, re-cut to v2 (which bumps
// run.version and appends new observations under meta.version:2), then retry v1's original
// registration token unchanged — the replayed v1 records (meta.version:1) must still SKIP against
// the ledger rather than ID-CONFLICT, because semantic identity (events.mjs factKey) excludes
// meta.version.
test('plan register: CLI retry for an earlier token still SKIPs after the run has been re-cut to a later version (F9)', () => {
  const repo = initRepo();
  const v1file = writePlan(repo, plan());
  run(repo, ['plan', 'register', '--from', v1file, '--id', 'reg-1']);
  const before = resolveObservations(repo).active.length;
  const v2 = plan(2, [{ ref: 'TASK-001', class: 'S', branch: 'task/task-001', estimate: { ...EST, high: 5 } }]);
  const v2r = run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2', '--at', '2026-09-17T00:00:00Z']);
  assert.equal(v2r.code, 0, v2r.stderr);
  const afterV2 = resolveObservations(repo).active.length;
  assert.ok(afterV2 > before);
  const retry = run(repo, ['plan', 'register', '--from', v1file, '--id', 'reg-1']);
  assert.equal(retry.code, 0, retry.stderr); assert.match(retry.stdout, /\(retry\)/);
  assert.ok((retry.stdout.match(/^SKIP/gm) || []).length > 0, 'the v1 retry must SKIP, not ID-CONFLICT, even though the run is now at v2');
  assert.equal(resolveObservations(repo).active.length, afterV2, 'retry appends nothing new');
});

// F10: (1) a bulk batch must validate each row against history including rows appended earlier in
// the same batch — a batch containing done-then-cancelled for the same item must reject the second
// row, not append an invalid chain. (2) a correction (--revision >= 1) still runs validateTransition
// (it passes here because correcting the same event is "the same occurrence", not a new transition).
// (3) plan register must never blindly cancel a removed item that is already done — it is counted as
// scope_removed_delivered and no `cancelled` observation is minted for it.
test('event --from validates against accumulated batch history (F10.1); --revision correction still validates (F10.2)', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const f = join(repo, 'batch.jsonl');
  writeFileSync(f, [
    JSON.stringify({ ref: 'TASK-001', event: 'done', at: '2026-09-16T10:00:00Z', id: 'b1' }),
    JSON.stringify({ ref: 'TASK-001', event: 'cancelled', at: '2026-09-16T11:00:00Z', id: 'b2' }),
  ].join('\n') + '\n');
  const r = run(repo, ['event', '--from', f]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /EVENTS appended=1 skipped=0 conflicts=0 invalid=1/, 'the second row (cancelled after done, same batch) is rejected, not appended');
  assert.match(r.stderr, /done/);
  const { active } = resolveObservations(repo);
  assert.equal(active.filter((o) => o.ref === 'TASK-001' && o.event === 'cancelled').length, 0);
  assert.equal(active.filter((o) => o.ref === 'TASK-001' && o.event === 'done').length, 1);
  // Correction: revision 1 on the same 'done' event (still validated, passes as "same occurrence").
  const corrected = run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T10:30:00Z', '--id', 'b1', '--revision', '1']);
  assert.equal(corrected.code, 0, corrected.stderr);
});

// Minor (a): the accumulated batch history must be re-sorted by `at` after each push, not left in
// file/push order — otherwise a later row's fold can land on the wrong "current state". Here row 2
// ('cancelled' at 09:00 on the 17th) is appended *after* row 1 ('reopened' at 12:00 on the 17th) in
// file order, even though 09:00 < 12:00. Without re-sorting, row 3's fold sees the array in push
// order (done, reopened, cancelled) and ends on 'cancelled' — wrongly rejecting row 3's 'done'. With
// re-sorting, the array folds in true timeline order (done, cancelled, reopened) and correctly ends
// on 'open', so row 3's 'done' is accepted.
test('event --from folds out-of-order batch rows in timeline order, not push order (minor a)', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const seed = run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T08:00:00Z', '--id', 'seed-done']);
  assert.equal(seed.code, 0, seed.stderr);
  const f = join(repo, 'unordered.jsonl');
  writeFileSync(f, [
    JSON.stringify({ ref: 'TASK-001', event: 'reopened', at: '2026-09-17T12:00:00Z', id: 'ro1' }),
    JSON.stringify({ ref: 'TASK-001', event: 'cancelled', at: '2026-09-17T09:00:00Z', id: 'c1' }),
    JSON.stringify({ ref: 'TASK-001', event: 'done', at: '2026-09-17T15:00:00Z', id: 'd3' }),
  ].join('\n') + '\n');
  const r = run(repo, ['event', '--from', f]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /EVENTS appended=3 skipped=0 conflicts=0 invalid=0/);
});

// Issue 1: a line that parses as valid JSON but is not a plain object (null / array / a bare
// scalar) must not reach `j.ref` (undefined) and crash — it is counted as an invalid line, same as
// malformed JSON, and the batch still exits 2.
test('event --from: a non-object JSON line (null/array/scalar) is counted invalid, not INTERNAL (issue 1)', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const f = join(repo, 'nonobj.jsonl');
  writeFileSync(f, [
    JSON.stringify({ ref: 'TASK-001', event: 'dispatched', at: '2026-09-16T09:00:00Z', id: 'ok-1' }),
    JSON.stringify(null),
    JSON.stringify([1, 2, 3]),
    JSON.stringify('just a string'),
  ].join('\n') + '\n');
  const r = run(repo, ['event', '--from', f]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /EVENTS appended=1 skipped=0 conflicts=0 invalid=3/);
  assert.match(r.stderr, /line 2: not an object/);
  assert.match(r.stderr, /line 3: not an object/);
  assert.match(r.stderr, /line 4: not an object/);
});

// Issue 2: a real system error (a thrown fs Error carrying a string .code like EACCES) must not be
// swallowed as "invalid line" — it must propagate to main()'s INTERNAL/exit-1 catch-all, using the
// same predicate main() itself uses (`e.code && e.exit`), not a bare `!e.code` check.
test('event --from: a thrown fs error with a string .code (EACCES) propagates to INTERNAL, not invalid-line (issue 2)', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) { t.skip('root ignores permission bits'); return; }
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const eventsFile = join(deliveryDir(repo), 'events-tester.jsonl');
  assert.ok(existsSync(eventsFile), 'the cli registration already wrote this user\'s events file');
  chmodSync(eventsFile, 0o444);
  try {
    const f = join(repo, 'perm.jsonl');
    writeFileSync(f, `${JSON.stringify({ ref: 'TASK-001', event: 'dispatched', at: '2026-09-16T09:00:00Z', id: 'perm-1' })}\n`);
    const r = run(repo, ['event', '--from', f]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /^INTERNAL\(/);
  } finally { chmodSync(eventsFile, 0o644); }
});

test('plan register: removing an already-done item never cancels its history (F10.3, scope_removed_delivered)', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const done = run(repo, ['event', 'TASK-002', 'done', '--id', 'done-002']);
  assert.equal(done.code, 0, done.stderr);
  const v2 = plan(2, [{ ref: 'TASK-001' }]); // TASK-002 removed from scope, but it is already done
  const r2 = run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2', '--at', '2026-09-17T00:00:00Z']);
  assert.equal(r2.code, 0, r2.stderr);
  assert.match(r2.stdout, /cancelled=0/);
  assert.match(r2.stdout, /scope_removed_delivered=1/);
  const { active } = resolveObservations(repo);
  assert.equal(active.filter((o) => o.ref === 'TASK-002' && o.event === 'cancelled').length, 0, 'no cancelled observation is minted for delivered scope');
  assert.equal(active.filter((o) => o.ref === 'TASK-002' && o.event === 'done').length, 1, 'the done history survives untouched');
});

// Issue 5: a delivered-removed item's catalogue row must not be `cancelled: true` (mergeCatalogue's
// default for anything missing from the new plan), or the ledger and the catalogue disagree — the
// ledger says 'done', the catalogue says 'cancelled'. It must instead carry `removed_delivered: true`
// / `cancelled: false`, so resolveRef keeps accepting it, and so a later re-add never mints a
// spurious `reopened` (planDelta's own `if (old.cancelled) reopened.push(i)` only fires when the
// saved row says cancelled). Once the item is back in scope, `removed_delivered` is cleared.
test('plan register: removed_delivered rows stay resolvable, and re-adding them never mints reopened (issue 5)', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  run(repo, ['event', 'TASK-002', 'done', '--id', 'done-002']);
  const v2 = plan(2, [{ ref: 'TASK-001' }]); // TASK-002 removed from scope, but it is already done
  const r2 = run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2', '--at', '2026-09-17T00:00:00Z']);
  assert.equal(r2.code, 0, r2.stderr);
  const recV2 = JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8'));
  const rowV2 = recV2.items.find((i) => i.ref === 'TASK-002');
  assert.equal(rowV2.cancelled, false, 'a delivered-removed row is never marked cancelled');
  assert.equal(rowV2.removed_delivered, true);
  // resolveRef still accepts it (only `cancelled` items are refused) — a further event on it succeeds
  // without needing --allow-cancelled.
  const evOnRemoved = run(repo, ['event', 'TASK-002', 'blocked', '--id', 'blk-1']);
  assert.equal(evOnRemoved.code, 0, evOnRemoved.stderr);

  const v3 = plan(3, [{ ref: 'TASK-001' }, { ref: 'TASK-002' }]); // re-add
  const r3 = run(repo, ['plan', 'register', '--from', writePlan(repo, v3, 'p3.md'), '--id', 'reg-3', '--at', '2026-09-18T00:00:00Z']);
  assert.equal(r3.code, 0, r3.stderr);
  const { active } = resolveObservations(repo);
  assert.equal(active.filter((o) => o.ref === 'TASK-002' && o.event === 'reopened').length, 0, 're-adding delivered-removed scope never mints reopened');
  const recV3 = JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8'));
  const rowV3 = recV3.items.find((i) => i.ref === 'TASK-002');
  assert.equal(rowV3.cancelled, false);
  assert.ok(!rowV3.removed_delivered, 'removed_delivered is cleared once the item is back in scope');
});

// F16: supersedes carries an item's history forward under a genuinely renamed item_id (a validated
// 1:1 identity rename — the conceptual item is the same, only its stable id string differs).
test('plan register: supersedes carries item history under a renamed item_id (F16)', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const oldId = 'sec/run-1/task-task-002';
  const newId = 'sec/run-1/task-renamed-002';
  const v2 = plan(2, [{ ref: 'TASK-001' }, { ref: 'TASK-002-RENAMED', item_id: newId }]);
  v2.supersedes = { run: 'sec/run-1', item_map: { [oldId]: newId } };
  const r2 = run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'p2.md'), '--id', 'reg-2', '--at', '2026-09-17T00:00:00Z']);
  assert.equal(r2.code, 0, r2.stderr);
  const rec = JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8'));
  const renamed = rec.items.find((i) => i.item_id === newId);
  assert.ok(renamed, 'the renamed item exists under its new id');
  assert.equal(renamed.version_added, 1, 'history (version_added) is carried forward through the rename');
  assert.equal(renamed.cancelled, false);
  assert.equal(rec.items.find((i) => i.item_id === oldId), undefined, 'the old id no longer exists as a distinct row');
});

// F20: user-input failures always exit 2, never INTERNAL — malformed plan shapes, a missing --from
// file for event --from, and out-of-range profile values.
test('F20: malformed plan shape, missing event --from file, and profile range validation all exit 2 (never INTERNAL)', () => {
  const repo = initRepo();
  const bad = plan(); bad.missions = {}; // malformed shape, not an array
  const shapeR = run(repo, ['plan', 'register', '--from', writePlan(repo, bad), '--id', 'shape-1']);
  assert.equal(shapeR.code, 2); assert.match(shapeR.stderr, /^SCHEMA-INVALID/);

  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const missingR = run(repo, ['event', '--from', join(repo, 'does-not-exist.jsonl')]);
  assert.equal(missingR.code, 2); assert.match(missingR.stderr, /^USAGE\(no such file/);

  const lowFloor = join(repo, 'profile-bad.json'); writeFileSync(lowFloor, JSON.stringify({ minWholeWeeks: 1 }));
  const profR = run(repo, ['profile', 'set', '--from', lowFloor]);
  assert.equal(profR.code, 2); assert.match(profR.stderr, /^SCHEMA-INVALID\(profile\.minWholeWeeks/);

  const goodProfile = join(repo, 'profile-ok.json'); writeFileSync(goodProfile, JSON.stringify({ minWholeWeeks: 4, capturePrompts: true, zeroDurationSec: 30, baselines: { cycle_time_task_h: 12 }, tokenomics: 'manual' }));
  const okProf = run(repo, ['profile', 'set', '--from', goodProfile]);
  assert.equal(okProf.code, 0, okProf.stderr);
  const saved = JSON.parse(readFileSync(join(deliveryDir(repo), 'profile.json'), 'utf8'));
  assert.equal(saved.minWholeWeeks, 4); assert.equal(saved.baselines.cycle_time_task_h, 12);
  // Issue 3: baselines merges one level deep — the template's other baseline keys must survive a
  // profile write that only mentions one of them, not be dropped by a whole-object replacement.
  assert.equal(saved.baselines.cycle_time_mission_h, null);
  assert.equal(saved.baselines.throughput_task_per_week, null);
  assert.equal(saved.baselines.first_pass_rate, null);
  assert.equal(saved.baselines.hit_rate, null);

  const badType = join(repo, 'profile-bad2.json'); writeFileSync(badType, JSON.stringify({ capturePrompts: 'yes' }));
  const badR = run(repo, ['profile', 'set', '--from', badType]);
  assert.equal(badR.code, 2); assert.match(badR.stderr, /^SCHEMA-INVALID\(profile\.capturePrompts/);
});

// Minor (b): a bare `--from`/`--at`/`--revision` (no value — parseArgs sets it to boolean true) must
// be USAGE, not a raw TypeError reaching INTERNAL; `plan register --from <directory>` must also be
// USAGE, not a raw EISDIR reaching INTERNAL.
test('minor (b): bare --from/--at/--revision and a directory --from all exit USAGE, never INTERNAL', () => {
  const repo = initRepo();
  const planFile = writePlan(repo, plan());
  const bareFrom = run(repo, ['plan', 'register', '--from', '--id', 'x']);
  assert.equal(bareFrom.code, 2); assert.match(bareFrom.stderr, /^USAGE\(--from requires a value/);

  const dirFrom = run(repo, ['plan', 'register', '--from', repo, '--id', 'x']);
  assert.equal(dirFrom.code, 2); assert.match(dirFrom.stderr, /^USAGE\(.*is not a file/);

  run(repo, ['plan', 'register', '--from', planFile, '--id', 'reg-1']);

  // A v2 re-cut with a bare --at: f.at is boolean `true` (truthy), so the "re-cut requires --at"
  // guard (`!f.at`) does not fire — it must still be rejected once isoOrThrow/requireValue sees it.
  const v2File = writePlan(repo, plan(2, [{ ref: 'TASK-001' }]), 'p2.md');
  const bareAt = run(repo, ['plan', 'register', '--from', v2File, '--id', 'reg-2', '--at']);
  assert.equal(bareAt.code, 2); assert.match(bareAt.stderr, /^USAGE\(--at requires a value/);

  const bareEventAt = run(repo, ['event', 'TASK-001', 'done', '--id', 'z', '--at']);
  assert.equal(bareEventAt.code, 2); assert.match(bareEventAt.stderr, /^USAGE\(--at requires a value/);

  const bareRevision = run(repo, ['event', 'TASK-001', 'done', '--id', 'z', '--revision']);
  assert.equal(bareRevision.code, 2); assert.match(bareRevision.stderr, /^USAGE\(--revision requires a value/);

  const bareEventFrom = run(repo, ['event', '--from']);
  assert.equal(bareEventFrom.code, 2); assert.match(bareEventFrom.stderr, /^USAGE\(--from requires a value/);

  const dirEventFrom = run(repo, ['event', '--from', repo]);
  assert.equal(dirEventFrom.code, 2); assert.match(dirEventFrom.stderr, /^USAGE\(.*is not a file/);
});

test('report/status commands: markdown, --json, --out, --level/--class filters, --calibrate refused (M1), NO-PLAN exit 3', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  run(repo, ['event', 'TASK-001', 'dispatched', '--at', '2026-09-16T09:00:00Z', '--id', 'd1']); run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T11:00:00Z', '--id', 'd2']);
  const md = run(repo, ['report', '--cutoff', '2026-09-21T00:00:00Z']); assert.equal(md.code, 0, md.stderr); assert.match(md.stdout, /## Flow Time/);
  const js = run(repo, ['report', '--json', '--cutoff', '2026-09-21T00:00:00Z', '--out', join(repo, 'r.json')]); assert.match(js.stdout, /^REPORT /);
  const doc = JSON.parse(readFileSync(join(repo, 'r.json'), 'utf8')); assert.equal(doc.plans[0].metrics.flow.task.strata.all.cycle_time.samples[0], 7200);
  assert.equal(JSON.parse(run(repo, ['report', '--json', '--cutoff', '2026-09-21T00:00:00Z', '--class', 'M']).stdout).plans[0].metrics.coverage.task?.done ?? 0, 0);
  assert.match(run(repo, ['report', '--calibrate', 'x']).stderr, /is not in M1/);
  assert.match(run(repo, ['status']).stdout, /STATUS sec\/run-1 v1/);
  assert.equal(run(initRepo(), ['report']).code, 3);
});

// html-report brief: `report --html` self-contained page (CLI wiring; renderHtml itself is unit
// tested in lib/report.test.mjs), `--out` and stdout paths, `--json`/`--html` mutual exclusion.
test('report --html: --out writes a self-contained page and prints REPORT <path>; without --out writes the same to stdout; --json --html is USAGE', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  run(repo, ['event', 'TASK-001', 'dispatched', '--at', '2026-09-16T09:00:00Z', '--id', 'd1']); run(repo, ['event', 'TASK-001', 'done', '--at', '2026-09-16T11:00:00Z', '--id', 'd2']);
  const withOut = run(repo, ['report', '--html', '--cutoff', '2026-09-21T00:00:00Z', '--out', join(repo, 'r.html')]);
  assert.equal(withOut.code, 0, withOut.stderr); assert.match(withOut.stdout, /^REPORT /);
  assert.match(readFileSync(join(repo, 'r.html'), 'utf8'), /^<!doctype html>/);
  const toStdout = run(repo, ['report', '--html', '--cutoff', '2026-09-21T00:00:00Z']);
  assert.equal(toStdout.code, 0, toStdout.stderr); assert.match(toStdout.stdout, /^<!doctype html>/);
  const exclusive = run(repo, ['report', '--json', '--html']);
  assert.equal(exclusive.code, 2, exclusive.stderr); assert.match(exclusive.stderr, /^USAGE\(--json and --html are exclusive/);
});

// html-report brief: `--from-json` re-renders an archived `report --json` doc without recomputation
// — same `now` on both sides makes the direct and from-json renders byte-for-byte comparable. Uses
// main() directly (not the execFileSync `run()` helper) so `now` is pinned across both invocations.
test('report --from-json: markdown/html byte-for-byte match a direct report using the same now; non-report/malformed input and disallowed flag combos are USAGE', async () => {
  const repo = initRepo();
  const now = Date.parse('2026-09-20T00:00:00Z');
  const call = async (args) => {
    let stdout = '', stderr = '';
    const code = await main(args, { repo, now, stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } }, env: { DELIVERY_NO_SYNC: '1' } });
    return { code, stdout, stderr };
  };
  assert.equal((await call(['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1'])).code, 0);
  assert.equal((await call(['event', 'TASK-001', 'dispatched', '--at', '2026-09-16T09:00:00Z', '--id', 'd1'])).code, 0);
  assert.equal((await call(['event', 'TASK-001', 'done', '--at', '2026-09-16T11:00:00Z', '--id', 'd2'])).code, 0);

  const directMd = await call(['report', '--cutoff', '2026-09-21T00:00:00Z']);
  assert.equal(directMd.code, 0, directMd.stderr);
  const jsonOut = await call(['report', '--json', '--cutoff', '2026-09-21T00:00:00Z', '--out', 'r.json']);
  assert.equal(jsonOut.code, 0, jsonOut.stderr);
  const fromJsonMd = await call(['report', '--from-json', 'r.json']);
  assert.equal(fromJsonMd.code, 0, fromJsonMd.stderr);
  assert.equal(fromJsonMd.stdout, directMd.stdout, 'from-json markdown must byte-for-byte match a direct report using the same now');

  const directHtml = await call(['report', '--html', '--cutoff', '2026-09-21T00:00:00Z']);
  assert.equal(directHtml.code, 0, directHtml.stderr);
  const fromJsonHtml = await call(['report', '--from-json', 'r.json', '--html']);
  assert.equal(fromJsonHtml.code, 0, fromJsonHtml.stderr);
  assert.equal(fromJsonHtml.stdout, directHtml.stdout, 'from-json html must byte-for-byte match a direct html report using the same now');

  writeFileSync(join(repo, 'bad.json'), '{"a":1}');
  const bad = await call(['report', '--from-json', 'bad.json']);
  assert.equal(bad.code, 2, bad.stderr); assert.match(bad.stderr, /^USAGE\(from-json: not a delivery report/);

  writeFileSync(join(repo, 'broken.json'), '{ not json');
  const broken = await call(['report', '--from-json', 'broken.json']);
  assert.equal(broken.code, 2, broken.stderr); assert.match(broken.stderr, /^USAGE\(from-json: not a delivery report/);

  const withJson = await call(['report', '--from-json', 'r.json', '--json']);
  assert.equal(withJson.code, 2, withJson.stderr); assert.match(withJson.stderr, /^USAGE\(--from-json re-renders/);

  const withSince = await call(['report', '--from-json', 'r.json', '--since', '2026-01-01']);
  assert.equal(withSince.code, 2, withSince.stderr); assert.match(withSince.stderr, /^USAGE\(--from-json takes the archived window as-is/);
});

// F20: report/status input failures must map to a proper cliError exit code (never INTERNAL/exit 1) —
// invalid --since/--until/--cutoff and an unknown --level are USAGE (exit 2); --plan naming an
// unknown run is NO-PLAN (exit 3, the same mapping resolveRun already uses for every other command —
// paths.mjs's EXIT table is shared and intentionally left unchanged here).
test('F20: report exits 2 (USAGE) on invalid date flags and unknown --level, exits 3 (NO-PLAN) on an unknown --plan, never INTERNAL', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  for (const flag of ['--since', '--until', '--cutoff']) {
    const r = run(repo, ['report', flag, 'not-a-date']);
    assert.equal(r.code, 2, `${flag}: ${r.stderr}`); assert.match(r.stderr, /^USAGE\(/);
  }
  const badLevel = run(repo, ['report', '--level', 'sprint']);
  assert.equal(badLevel.code, 2, badLevel.stderr); assert.match(badLevel.stderr, /^USAGE\(/);
  const badPlan = run(repo, ['report', '--plan', 'sec/run-9']);
  assert.equal(badPlan.code, 3, badPlan.stderr); assert.match(badPlan.stderr, /^NO-PLAN\(/);
  for (const r of [run(repo, ['report', '--since', 'x']), badLevel, badPlan]) assert.ok(!/^INTERNAL/.test(r.stderr));
});

// Minor (a): --out/--plan bare flags are USAGE (via the shared requireValue guard), and --out
// resolves against the repo the same way --from does elsewhere.
test('minor (a): report/status bare --out/--plan are USAGE; --out resolves relative to repo', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  const bareOut = run(repo, ['report', '--out']);
  assert.equal(bareOut.code, 2, bareOut.stderr); assert.match(bareOut.stderr, /^USAGE\(--out requires a value/);
  const barePlan = run(repo, ['report', '--plan']);
  assert.equal(barePlan.code, 2, barePlan.stderr); assert.match(barePlan.stderr, /^USAGE\(--plan requires a value/);
  const bareStatusPlan = run(repo, ['status', '--plan']);
  assert.equal(bareStatusPlan.code, 2, bareStatusPlan.stderr); assert.match(bareStatusPlan.stderr, /^USAGE\(--plan requires a value/);
  const rel = run(repo, ['report', '--out', 'report.md']);
  assert.equal(rel.code, 0, rel.stderr); assert.ok(existsSync(join(repo, 'report.md')));
  assert.match(rel.stdout, /^REPORT .*[/\\]report\.md\n$/, 'resolved (not left relative) against repo, like --from');
});

// Task 9: `backfill --git` wires lib/git-backfill.mjs's deriveGitObservations into the CLI —
// registers a delivery-plan block INSIDE the git-backfill fixture repo (committed there, so the
// plan register command's own git-derived `created` basis works off the same history), backfills
// against the fixture's pinned `head`, and checks: the CLI's own event count matches a direct
// deriveGitObservations() call; a second run is fully idempotent (events=0, same skipped count);
// and the resulting report shows commit_to_done (first_commit -> done, no dispatched events were
// ever recorded) rather than cycle_time.
test('backfill --git: CLI event count matches deriveGitObservations directly; idempotent retry; report shows commit_to_done not cycle_time', () => {
  const fx = buildFixtureRepo();
  const tasks = [
    { ref: 'TASK-001', branch: 'task/task-001' },
    { ref: 'TASK-002', branch: 'task/task-002' },
    { ref: 'TASK-003', branch: 'task/task-003' },
    { ref: 'TASK-004', branch: 'task/task-004' },
  ];
  const p = plan(1, tasks);
  p.observation_start = '2026-09-15T00:00:00Z';
  p.source_epoch = { from: '2026-09-15T00:00:00Z', until: null, integration_ref: 'main' };
  // The fixture's own plan.md already carries the `#### TASK-NNN: x` headings buildFixtureRepo used
  // for `created` git-derivation — keep them, and append the fenced delivery-plan block register needs.
  const planText = `# plan\n#### TASK-001: a\n#### TASK-002: b\n#### TASK-003: c\n#### TASK-004: d\n\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`;
  writeFileSync(join(fx.repo, 'plan.md'), planText);
  execFileSync('git', ['-C', fx.repo, 'add', 'plan.md']);
  execFileSync('git', ['-C', fx.repo, 'commit', '-q', '-m', 'plan: register block'], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });

  const reg = run(fx.repo, ['plan', 'register', '--from', join(fx.repo, 'plan.md'), '--id', 'reg-1']);
  assert.equal(reg.code, 0, reg.stderr);
  const registered = JSON.parse(readFileSync(runPath(fx.repo, 'sec/run-1'), 'utf8'));

  const direct = deriveGitObservations({ repo: fx.repo, run: registered, head: fx.head, cutoff: '2026-12-31T00:00:00Z' });
  assert.ok(direct.records.length > 0);

  const bf1 = run(fx.repo, ['backfill', '--git', '--head', fx.head, '--cutoff', '2026-12-31T00:00:00Z']);
  assert.equal(bf1.code, 0, bf1.stderr);
  assert.match(bf1.stdout, new RegExp(`BACKFILL events=${direct.records.length} skipped=0 conflicts=0`));

  const bf2 = run(fx.repo, ['backfill', '--git', '--head', fx.head, '--cutoff', '2026-12-31T00:00:00Z']);
  assert.equal(bf2.code, 0, bf2.stderr);
  assert.match(bf2.stdout, new RegExp(`BACKFILL events=0 skipped=${direct.records.length} conflicts=0`));

  const rec = JSON.parse(readFileSync(runPath(fx.repo, 'sec/run-1'), 'utf8'));
  assert.equal(rec.backfill.head, fx.head);

  const rpt = JSON.parse(run(fx.repo, ['report', '--json', '--cutoff', '2026-12-31T00:00:00Z']).stdout);
  const taskAll = rpt.plans[0].metrics.flow.task.strata.all;
  assert.ok(taskAll.commit_to_done, 'commit_to_done measured from first_commit -> done (no dispatched events recorded)');
  assert.equal(taskAll.cycle_time, null, 'no dispatched events were ever observed -> no cycle_time');
});

// Review fix (F20, CLI level): every backfill user-input failure must exit 2 with a USAGE( prefix —
// previously only proven against deriveGitObservations directly, never through the CLI's own flag
// parsing/guards. Also proves --plan is routed through the same requireValue guard as --head.
test('F20: backfill --git input guards all exit 2 (USAGE) — --pr, missing/bare --head, unresolvable --head, invalid --since, bare --plan', () => {
  const repo = initRepo();
  run(repo, ['plan', 'register', '--from', writePlan(repo, plan()), '--id', 'reg-1']);
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'init'); // initRepo() itself makes no commit — need a resolvable HEAD
  const head = git(repo, 'rev-parse', 'HEAD');

  const noGit = run(repo, ['backfill', '--pr']);
  assert.equal(noGit.code, 2, noGit.stderr); assert.match(noGit.stderr, /^USAGE\(/);

  const pr = run(repo, ['backfill', '--git', '--pr']);
  assert.equal(pr.code, 2, pr.stderr); assert.match(pr.stderr, /^USAGE\(--pr is not in M1/);

  const noHead = run(repo, ['backfill', '--git']);
  assert.equal(noHead.code, 2, noHead.stderr); assert.match(noHead.stderr, /^USAGE\(backfill needs --head/);

  const bareHead = run(repo, ['backfill', '--git', '--head']);
  assert.equal(bareHead.code, 2, bareHead.stderr); assert.match(bareHead.stderr, /^USAGE\(--head requires a value/);

  const badHead = run(repo, ['backfill', '--git', '--head', 'deadbeef']);
  assert.equal(badHead.code, 2, badHead.stderr); assert.match(badHead.stderr, /^USAGE\(head deadbeef not found/);

  const badSince = run(repo, ['backfill', '--git', '--head', head, '--since', 'not-a-date']);
  assert.equal(badSince.code, 2, badSince.stderr); assert.match(badSince.stderr, /^USAGE\(invalid --since/);

  const barePlan = run(repo, ['backfill', '--git', '--plan']);
  assert.equal(barePlan.code, 2, barePlan.stderr); assert.match(barePlan.stderr, /^USAGE\(--plan requires a value/);
});

// Minor: --dry-run prints WOULD lines (never EVENT/SKIP/ID-CONFLICT) and never writes run.backfill —
// a real backfill pass must still be required to actually record anything.
test('minor: backfill --git --dry-run prints WOULD lines and never writes run.backfill or ledger events', () => {
  const fx = buildFixtureRepo();
  const tasks = [
    { ref: 'TASK-001', branch: 'task/task-001' }, { ref: 'TASK-002', branch: 'task/task-002' },
    { ref: 'TASK-003', branch: 'task/task-003' }, { ref: 'TASK-004', branch: 'task/task-004' },
  ];
  const p = plan(1, tasks);
  p.observation_start = '2026-09-15T00:00:00Z';
  p.source_epoch = { from: '2026-09-15T00:00:00Z', until: null, integration_ref: 'main' };
  const planText = `# plan\n#### TASK-001: a\n#### TASK-002: b\n#### TASK-003: c\n#### TASK-004: d\n\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`;
  writeFileSync(join(fx.repo, 'plan.md'), planText);
  execFileSync('git', ['-C', fx.repo, 'add', 'plan.md']);
  execFileSync('git', ['-C', fx.repo, 'commit', '-q', '-m', 'plan: register block'], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  const reg = run(fx.repo, ['plan', 'register', '--from', join(fx.repo, 'plan.md'), '--id', 'reg-1']);
  assert.equal(reg.code, 0, reg.stderr);
  const registeredCount = resolveObservations(fx.repo).active.length;

  const dry = run(fx.repo, ['backfill', '--git', '--head', fx.head, '--cutoff', '2026-12-31T00:00:00Z', '--dry-run']);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /^WOULD /m);
  assert.ok(!/^(EVENT|SKIP|ID-CONFLICT) /m.test(dry.stdout), 'dry-run never appends to the ledger');
  assert.match(dry.stdout, /BACKFILL events=0 /, 'dry-run counts nothing as actually appended');

  const rec = JSON.parse(readFileSync(runPath(fx.repo, 'sec/run-1'), 'utf8'));
  assert.equal(rec.backfill, undefined, 'dry-run never writes run.backfill');
  assert.equal(resolveObservations(fx.repo).active.length, registeredCount, 'dry-run leaves the ledger exactly as registration left it');
});
