import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, validateTransition } from './delivery.mjs';
import { deliveryDir, runPath } from './lib/paths.mjs';
import { resolveObservations } from './lib/events.mjs';

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

  const badType = join(repo, 'profile-bad2.json'); writeFileSync(badType, JSON.stringify({ capturePrompts: 'yes' }));
  const badR = run(repo, ['profile', 'set', '--from', badType]);
  assert.equal(badR.code, 2); assert.match(badR.stderr, /^SCHEMA-INVALID\(profile\.capturePrompts/);
});
