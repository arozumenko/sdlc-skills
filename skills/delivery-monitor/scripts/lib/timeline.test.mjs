import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeObservation } from './events.mjs';
import { selectOccurrences, buildTimelines, estimateOriginal, estimateLatest } from './timeline.mjs';

const R = 'sec/run-1';
const plan = { run: R, items: [
  { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null },
  { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
  { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' },
  { item_id: `${R}/task-b`, ref: 'TASK-B', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' },
  { item_id: `${R}/task-c`, ref: 'TASK-C', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M', cancelled: true },
] };
const it = (k) => plan.items.find((i) => i.item_id === `${R}/${k}`);
const obs = (k, event, at, o = {}) => makeObservation({ user: 'u', host: o.source === 'hook' ? 'claude' : (o.source === 'git' ? 'git' : 'cli'), plan: R, item_id: it(k).item_id, ref: it(k).ref, level: it(k).level, event, at,
  transition_id: o.transition_id ?? `${it(k).item_id}/${event}/episode-1`, source: o.source ?? 'cli', source_record_id: o.token ?? `${event}-${k}-${o.source ?? 'cli'}`, meta: { version: 1, ...(o.meta ?? {}) }, estimate: o.estimate, basis: o.basis }, { now: 0 });
const EST = (o = {}) => ({ unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-14T00:00:00Z', accepted_by: 'D', accepted_at: '2026-09-15T00:00:00Z', ...o });
const END = '2026-09-30T00:00:00Z';
const tl = (o, conflicts = []) => buildTimelines({ occurrences: selectOccurrences(o, conflicts).occurrences, plan, end: END });
// resolveObservations().conflicts[] shape (F8): {observation_id, revision, plan, paths, variants: [{item_id, transition_id, basis, source, plan}, ...]}.
const ledgerConflict = (variants, o = {}) => ({ observation_id: o.observation_id ?? 'cli:tok:x:done', revision: o.revision ?? 0, plan: R, paths: [], variants });

test('selectOccurrences: cli beats git both orders; provenance keeps git; equal-rank disagreement → CONFLICT; ledger conflict at higher rank blocks fallback', () => {
  const g = obs('task-a', 'done', '2026-09-16T12:00:00Z', { source: 'git' }), c = obs('task-a', 'done', '2026-09-16T11:00:00Z');
  for (const order of [[g, c], [c, g]]) { const r = selectOccurrences(order); assert.equal(r.conflicts.length, 0); assert.equal(r.occurrences.length, 1); assert.equal(r.occurrences[0].source, 'cli'); assert.deepEqual(r.occurrences[0].provenance.map((p) => p.source).sort(), ['cli', 'git']); }
  const c2 = obs('task-a', 'done', '2026-09-16T10:00:00Z', { token: 't2' });
  const r = selectOccurrences([g, c, c2]); assert.equal(r.occurrences.length, 0); assert.equal(r.conflicts[0].reason, 'equal-rank-disagreement');
  const r2 = selectOccurrences([g], [ledgerConflict([{ item_id: it('task-a').item_id, transition_id: `${R}/task-a/done/episode-1`, basis: 'observed', source: 'cli', plan: R }])]);
  assert.equal(r2.occurrences.length, 0, 'a conflicting current CLI observation blocks git for that occurrence'); assert.equal(r2.conflicts[0].reason, 'ledger-conflict');
  const r3 = selectOccurrences([g], [ledgerConflict([{ item_id: it('task-a').item_id, transition_id: `${R}/task-a/done/episode-1`, basis: 'observed', source: 'git', plan: R }])]);
  assert.equal(r3.occurrences.length, 0, 'same-rank ledger conflict also blocks');
  const d1 = obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/a1`, meta: { stage: 'build' }, token: 'h1' });
  const d2 = obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/a1`, meta: { stage: 'review' }, token: 'h2' });
  assert.equal(selectOccurrences([d1, d2]).conflicts.length, 1, 'stage is a semantic fact');
});

// F8: `resolveObservations().conflicts[]` carries the *union* of every disagreeing variant, not
// just the first one read. A ledger conflict entry whose two variants dispute two DIFFERENT
// occurrence keys (a transition renamed from A to B by conflicting revisions) must quarantine
// fallback for BOTH keys — a consumer that only inspected variants[0] would let a lower-ranked
// record win the second key, and which key "won" would depend on file/arrival order within the
// conflict entry.
test('F8: ledger-conflict variants union quarantines every disputed occurrence key, not only the first variant', () => {
  const gA = obs('task-a', 'done', '2026-09-16T09:00:00Z', { source: 'git', transition_id: `${R}/task-a/done/ep-A`, token: 'gA' });
  const gB = obs('task-a', 'cancelled', '2026-09-16T10:00:00Z', { source: 'git', transition_id: `${R}/task-a/cancelled/ep-B`, token: 'gB' });
  const conflict = ledgerConflict([
    { item_id: it('task-a').item_id, transition_id: `${R}/task-a/done/ep-A`, basis: 'observed', source: 'cli', plan: R },
    { item_id: it('task-a').item_id, transition_id: `${R}/task-a/cancelled/ep-B`, basis: 'observed', source: 'cli', plan: R },
  ]);
  const r = selectOccurrences([gA, gB], [conflict]);
  assert.equal(r.occurrences.length, 0, 'both keys blocked by the union of variants, not only variants[0]');
  assert.equal(r.conflicts.length, 2);
  assert.ok(r.conflicts.every((c) => c.reason === 'ledger-conflict'));
  assert.deepEqual(r.conflicts.map((c) => c.transition_id).sort(), [`${R}/task-a/cancelled/ep-B`, `${R}/task-a/done/ep-A`]);
  // A same-rank (cli) correction for one of the two disputed keys does NOT clear its block — the
  // conflict's variant for ep-A is itself cli rank, so a same-rank local record still satisfies
  // `conflictRank <= best` and stays quarantined (F8 only lets a STRICTLY higher-ranked local
  // record clear a ledger conflict; see the dedicated survives-a-lower-priority-conflict test).
  const cA = obs('task-a', 'done', '2026-09-16T09:30:00Z', { transition_id: `${R}/task-a/done/ep-A`, token: 'cA' });
  const r2 = selectOccurrences([gA, gB, cA], [conflict]);
  assert.equal(r2.occurrences.length, 0, 'ep-A is a ledger conflict at cli rank too — a same-rank cli record does not clear it');
});

// F8 (clearing case): a ledger conflict only quarantines an occurrence key when the conflict's own
// best rank is <= the best rank among the surviving local records at that key. A LOWER-priority
// (higher-numbered, e.g. git) ledger conflict must not block a HIGHER-priority (cli) local record —
// and this must hold regardless of where in `variants[]` the disputed key appears.
test('F8: a lower-priority (git-rank) ledger conflict does not block a higher-priority (cli) local record, regardless of variants[] order', () => {
  const c = obs('task-a', 'done', '2026-09-16T11:00:00Z'); // cli, default source, rank 0
  const conflict = ledgerConflict([{ item_id: it('task-a').item_id, transition_id: `${R}/task-a/done/episode-1`, basis: 'observed', source: 'git', plan: R }]);
  const r = selectOccurrences([c], [conflict]);
  assert.equal(r.occurrences.length, 1, 'the cli local record outranks a git-rank ledger conflict for the same key and survives');
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.occurrences[0].source, 'cli');

  // A multi-variant conflict entry disputes two keys: one (done/episode-1) the cli record clears,
  // the other (cancelled/other) is itself contested at git rank by a local git record and stays
  // quarantined. Reversing the variants[] array must not change which key survives.
  const gOther = obs('task-a', 'cancelled', '2026-09-16T09:00:00Z', { source: 'git', transition_id: `${R}/task-a/cancelled/other`, token: 'gOther' });
  const variants = [
    { item_id: it('task-a').item_id, transition_id: `${R}/task-a/cancelled/other`, basis: 'observed', source: 'git', plan: R },
    { item_id: it('task-a').item_id, transition_id: `${R}/task-a/done/episode-1`, basis: 'observed', source: 'git', plan: R },
  ];
  for (const ordered of [variants, [...variants].reverse()]) {
    const rr = selectOccurrences([c, gOther], [ledgerConflict(ordered)]);
    assert.equal(rr.occurrences.length, 1, 'variants[] order does not change which key survives');
    assert.equal(rr.occurrences[0].event, 'done');
    assert.equal(rr.conflicts.length, 1);
    assert.equal(rr.conflicts[0].transition_id, `${R}/task-a/cancelled/other`);
  }
});

test('replay: spec §12 example (dispatch → cycle start, first_commit proxy), review dispatch is activity, dispatch after done is not a start', () => {
  const o = [obs('task-a', 'created', '2026-09-14T09:00:00Z'), obs('task-a', 'estimated', '2026-09-15T00:00:00Z', { transition_id: `${R}/task-a/estimated/rev-0`, estimate: EST(), meta: { estimate_revision: 0, acceptance: 'accepted' } }),
    obs('task-a', 'first_commit', '2026-09-16T08:00:00Z', { source: 'git', transition_id: `${R}/task-a/first_commit/0` }),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/agent-1`, meta: { stage: 'build' } }),
    obs('task-a', 'dispatched', '2026-09-16T10:30:00Z', { source: 'hook', transition_id: `${R}/task-a/dispatched/agent-2`, meta: { stage: 'review' } }),
    obs('task-a', 'done', '2026-09-16T11:00:00Z', { meta: { git_sha: 'abc' } }),
    obs('task-b', 'created', '2026-09-14T09:00:00Z'), obs('task-b', 'done', '2026-09-16T11:00:00Z'), obs('task-b', 'dispatched', '2026-09-16T12:00:00Z', { source: 'hook', transition_id: `${R}/task-b/dispatched/x` })];
  const { items } = tl(o);
  const a = items.get(it('task-a').item_id);
  assert.equal(a.created_at, '2026-09-14T09:00:00.000Z'); assert.equal(a.first_commit_at, '2026-09-16T08:00:00.000Z'); assert.equal(a.started_at, '2026-09-16T09:00:00.000Z'); assert.equal(a.start_basis, 'observed');
  assert.equal(a.done_at, '2026-09-16T11:00:00.000Z'); assert.equal(a.done_sha, 'abc'); assert.equal(a.state, 'done'); assert.equal(a.dispatch_count, 2); assert.equal(a.estimate_original.low, 1);
  assert.equal(a.proxy_dispatches, 0, 'both dispatches were basis observed');
  const b = items.get(it('task-b').item_id); assert.equal(b.started_at, null, 'dispatch after done is activity only'); assert.equal(b.dispatch_count, 1);
});

test('replay: cutoff, invalid chain, deferred episode (reopened), rework count', () => {
  const o = [obs('task-a', 'created', '2026-09-14T09:00:00Z'), obs('task-a', 'cancelled', '2026-09-15T00:00:00Z'), obs('task-a', 'done', '2026-09-16T00:00:00Z', { source: 'git' }),
    obs('task-b', 'created', '2026-09-14T09:00:00Z'), obs('task-b', 'done', '2026-09-16T11:00:00Z'), obs('task-b', 'reopened', '2026-09-17T09:00:00Z', { transition_id: `${R}/task-b/reopened/1` }), obs('task-b', 'rework_observed', '2026-09-17T10:00:00Z', { source: 'git', transition_id: `${R}/task-b/rework_observed/1` }),
    obs('task-c', 'created', '2026-09-14T09:00:00Z'), obs('task-c', 'done', '2026-10-05T00:00:00Z')];
  const { items, counts } = tl(o);
  const a = items.get(it('task-a').item_id); assert.ok(a.flags.includes('invalid-chain')); assert.equal(a.state, 'cancelled'); assert.equal(counts.invalidChains, 1);
  const b = items.get(it('task-b').item_id); assert.ok(b.flags.includes('deferred-episode')); assert.equal(b.done_at, '2026-09-16T11:00:00.000Z'); assert.equal(b.state, 'done', 'M1 keeps the first episode'); assert.equal(b.rework_count, 1); assert.equal(counts.deferredEpisodes, 1);
  assert.equal(items.get(it('task-c').item_id).state, 'planned', 'done after cutoff not replayed');
});

test('rollups: derived start (explicit parent dispatch ignored), landing required, PARENT-INCOMPLETE, awaiting-landing, partial-cancelled, scope-cancelled child, unknown child, campaign derived', () => {
  const A = it('task-a').item_id, B = it('task-b').item_id, M = it('mission-g1').item_id, C = it('campaign').item_id;
  const base = [obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-b', 'created', '2026-09-14T00:00:00Z'),
    obs('mission-g1', 'dispatched', '2026-09-15T00:00:00Z', { source: 'hook', transition_id: `${M}/dispatched/x` }),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${A}/dispatched/x` }), obs('task-a', 'done', '2026-09-16T11:00:00Z')];
  let r = tl(base); let m = r.items.get(M);
  assert.equal(m.started_at, '2026-09-16T09:00:00.000Z'); assert.equal(m.start_basis, 'derived-child'); assert.equal(m.state, 'in_progress'); assert.equal(m.child_summary.open, 1); assert.equal(m.child_summary.cancelled_scope, 1);
  const bothDone = [...base, obs('task-b', 'dispatched', '2026-09-16T10:00:00Z', { source: 'hook', transition_id: `${B}/dispatched/y` }), obs('task-b', 'done', '2026-09-17T13:00:00Z')];
  r = tl(bothDone); m = r.items.get(M);
  assert.equal(m.state, 'in_progress'); assert.ok(m.flags.includes('awaiting-landing')); assert.equal(m.done_at, null); assert.equal(r.counts.awaitingLanding, 1);
  r = tl([...bothDone, obs('mission-g1', 'done', '2026-09-17T15:00:00Z', { meta: { git_sha: 'land' } })]); m = r.items.get(M);
  assert.equal(m.state, 'done'); assert.equal(m.landing_at, '2026-09-17T15:00:00.000Z'); assert.equal(m.done_at, '2026-09-17T15:00:00.000Z'); assert.equal(m.done_basis, 'observed');
  assert.equal(r.items.get(C).state, 'done'); assert.equal(r.items.get(C).done_basis, 'derived-child'); assert.equal(r.items.get(C).done_at, '2026-09-17T15:00:00.000Z');
  r = tl([...bothDone, obs('mission-g1', 'done', '2026-09-17T12:00:00Z')]); m = r.items.get(M);
  assert.equal(m.done_at, '2026-09-17T13:00:00.000Z', 'landing earlier than the last child terminal → completion is the later clock');
  r = tl([...base, obs('mission-g1', 'done', '2026-09-16T12:00:00Z')]); m = r.items.get(M);
  assert.equal(m.state, 'in_progress'); assert.ok(m.flags.includes('PARENT-INCOMPLETE')); assert.equal(m.done_at, null); assert.equal(r.counts.parentIncomplete, 1);
  r = tl([...base, obs('task-b', 'cancelled', '2026-09-17T00:00:00Z'), obs('mission-g1', 'done', '2026-09-17T15:00:00Z')]); m = r.items.get(M);
  assert.equal(m.state, 'done'); assert.ok(m.flags.includes('partial-cancelled')); assert.equal(m.child_summary.cancelled, 1);
  r = tl([obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-a', 'done', '2026-09-15T00:00:00Z')]); m = r.items.get(M);
  assert.equal(m.child_summary.unknown, 1); assert.equal(m.state, 'in_progress');
  r = tl([obs('task-a', 'cancelled', '2026-09-15T00:00:00Z'), obs('task-b', 'cancelled', '2026-09-15T00:00:00Z')]);
  assert.equal(r.items.get(M).state, 'cancelled');
});

// F11 (part 1): landing evidence must never turn wholly cancelled scope into delivered throughput —
// a mission/campaign with zero delivered children is 'cancelled' even when an explicit parent
// `done` (landing) was observed. F11 (part 2): a scope-cancelled (`cancelled_in_plan`) child still
// contributes its own historical `started_at` to the parent's descendant-start derivation — removing
// an already-started child from scope must not erase the parent's earliest start.
test('F11: all-cancelled children stay cancelled despite landing; a scope-cancelled child still supplies the earliest descendant start', () => {
  const M = it('mission-g1').item_id;
  const allCancelledWithLanding = [
    obs('task-a', 'cancelled', '2026-09-15T00:00:00Z'),
    obs('task-b', 'cancelled', '2026-09-15T00:00:00Z'),
    obs('mission-g1', 'done', '2026-09-16T00:00:00Z', { meta: { git_sha: 'land' } }),
  ];
  const m = tl(allCancelledWithLanding).items.get(M);
  assert.equal(m.state, 'cancelled', 'landing evidence never promotes zero delivered children to done');
  assert.equal(m.done_at, null);
  assert.equal(m.landing_at, '2026-09-16T00:00:00.000Z', 'the landing occurrence is still recorded, just not honored as completion');

  const earliestStartFromScopeCancelledChild = [
    // task-c is cancelled_in_plan (Boolean(cancelled) === true) in the fixture plan from the start,
    // but it was dispatched (and thus started) before task-a — its start must still set the
    // mission's earliest derived started_at even though it is excluded from the all-terminal test.
    obs('task-c', 'dispatched', '2026-09-15T00:00:00Z', { source: 'hook', transition_id: `${it('task-c').item_id}/dispatched/x`, meta: { stage: 'build' } }),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', transition_id: `${it('task-a').item_id}/dispatched/x` }),
    obs('task-a', 'done', '2026-09-16T11:00:00Z'),
  ];
  const m2 = tl(earliestStartFromScopeCancelledChild).items.get(M);
  assert.equal(m2.started_at, '2026-09-15T00:00:00.000Z', 'the scope-cancelled child started first and still sets the derived start');
  assert.equal(m2.child_summary.cancelled_scope, 1, 'task-c remains excluded from the all-terminal/child_summary accounting');
});

// F11 (part 2, versioned-removal fixture): the shared-plan fixture above proves the mechanism with
// a task that was ALWAYS cancelled_in_plan; this fixture proves the realistic path — a child that
// was in scope and started under plan v1, then removed from scope in plan v2 (a real run record
// `versions[]` history whose v2 items[] omits it, so `mergeCatalogue`'s removal branch marks it
// `cancelled: true` in the resulting catalogue row). The parent's derived-child `started_at` must
// still reflect that child's pre-removal start.
test('F11 (versioned removal): a started child removed via a later plan version still supplies the derived-child start', () => {
  const A = it('task-a').item_id, M = it('mission-g1').item_id, C = it('campaign').item_id;
  const v1 = plan.items.filter((i) => [C, M, A].includes(i.item_id));
  const v2 = plan.items.filter((i) => [C, M].includes(i.item_id)); // task-a removed from scope in v2
  const history = { ...plan, items: v2, versions: [
    { version: 1, at: '2026-09-13T00:00:00.000Z', items: v1 },
    { version: 2, at: '2026-09-15T00:00:00.000Z', items: v2 },
  ] };
  const occurrences = selectOccurrences([
    obs('task-a', 'created', '2026-09-13T09:00:00Z'),
    obs('task-a', 'dispatched', '2026-09-14T09:00:00Z', { meta: { stage: 'build' } }),
  ]).occurrences;
  const { items } = buildTimelines({ occurrences, plan: history, end: END });
  const m = items.get(M);
  assert.equal(m.started_at, '2026-09-14T09:00:00.000Z', "the removed child's pre-removal start still sets the derived parent start");
  assert.equal(m.start_basis, 'derived-child');
  assert.equal(m.child_summary.cancelled_scope, 1, 'the removed (mergeCatalogue-cancelled) child is excluded from the all-terminal test post-removal');
});

// Minor: a parent whose entire (non-scope-cancelled) child set is empty — every child is
// cancelled_in_plan — has nothing it could ever deliver. An explicit landing over that empty
// required scope must close it as 'cancelled', not strand it as PARENT-INCOMPLETE forever.
test('minor: zero non-scope-cancelled children plus landing is cancelled, not PARENT-INCOMPLETE', () => {
  const M = it('mission-g1').item_id;
  const allScopeCancelled = { run: R, items: plan.items.map((i) => (i.level === 'task' ? { ...i, cancelled: true } : i)) };
  const landing = obs('mission-g1', 'done', '2026-09-16T00:00:00Z');
  const { items } = buildTimelines({ occurrences: selectOccurrences([landing]).occurrences, plan: allScopeCancelled, end: END });
  const m = items.get(M);
  assert.equal(m.state, 'cancelled', 'zero non-scope-cancelled children can never be delivered, landing notwithstanding');
  assert.ok(!m.flags.includes('PARENT-INCOMPLETE'));
  assert.equal(m.child_summary.cancelled_scope, 3);
});

// F10: a child quarantined `invalid-chain` (done-after-cancelled or cancelled-after-done without an
// intervening reopened) keeps its `state` at whichever terminal it reached first, but that terminal
// is explicitly NOT trustworthy per the replay rules — it must never, by itself, let its parent
// complete. The rollup's done/cancelled child_summary counts must exclude it (treat it as open)
// regardless of its `state`.
test('F10: an invalid-chain child never closes its mission — counted as open (PARENT-INCOMPLETE) even with landing', () => {
  const M = it('mission-g1').item_id;
  const o = [
    obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-a', 'dispatched', '2026-09-14T09:00:00Z', { meta: { stage: 'build' } }), obs('task-a', 'done', '2026-09-14T11:00:00Z'),
    // task-b: cancelled then done without a reopened in between → invalid-chain, state stays at the
    // first terminal ('cancelled'), per the replay rules already proven in the cutoff/invalid-chain
    // test above.
    obs('task-b', 'created', '2026-09-14T00:00:00Z'), obs('task-b', 'cancelled', '2026-09-15T00:00:00Z'), obs('task-b', 'done', '2026-09-16T00:00:00Z', { source: 'git' }),
    obs('mission-g1', 'done', '2026-09-17T00:00:00Z'),
  ];
  const { items, counts } = tl(o);
  const b = items.get(it('task-b').item_id);
  assert.ok(b.flags.includes('invalid-chain'));
  assert.equal(counts.invalidChains, 1);
  const m = items.get(M);
  assert.equal(m.child_summary.done, 1, 'only task-a; the invalid-chain task-b is excluded from done');
  assert.equal(m.child_summary.cancelled, 0, 'the invalid-chain task-b is excluded from cancelled too');
  assert.equal(m.child_summary.open, 1, 'the invalid-chain task-b is counted as open instead');
  assert.ok(m.flags.includes('PARENT-INCOMPLETE'), 'landing exists but the child set is not all-terminal because of the quarantined child');
  assert.equal(m.state, 'in_progress');
  assert.equal(m.done_at, null, 'never closes as done off the back of a quarantined child');
});

// Review fix: a non-task `done` only counts as landing evidence when its own basis is 'observed' —
// a scope/gate/receipt-proxy "done" on a mission/campaign is not a witnessed landing. done_basis
// also now carries the explicit occurrence's own basis rather than a hard-coded 'observed' literal.
test('landing basis: a proxy-basis parent done is not landing evidence; an observed one sets done_basis from its own basis', () => {
  const M = it('mission-g1').item_id;
  const bothDone = [
    obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-a', 'dispatched', '2026-09-14T09:00:00Z', { meta: { stage: 'build' } }), obs('task-a', 'done', '2026-09-14T11:00:00Z'),
    obs('task-b', 'created', '2026-09-14T00:00:00Z'), obs('task-b', 'dispatched', '2026-09-14T09:00:00Z', { meta: { stage: 'build' }, transition_id: `${it('task-b').item_id}/dispatched/x` }), obs('task-b', 'done', '2026-09-15T11:00:00Z'),
  ];
  const proxyLanding = obs('mission-g1', 'done', '2026-09-16T00:00:00Z', { basis: 'gate-proxy' });
  const proxy = tl([...bothDone, proxyLanding]).items.get(M);
  assert.equal(proxy.state, 'in_progress');
  assert.ok(proxy.flags.includes('awaiting-landing'), 'all children terminal but no OBSERVED landing yet');
  assert.equal(proxy.done_at, null);
  assert.equal(proxy.landing_at, null, 'a proxy-basis done is not landing evidence at all — landing_at is never set from it');

  const observedLanding = obs('mission-g1', 'done', '2026-09-16T00:00:00Z');
  const observed = tl([...bothDone, observedLanding]).items.get(M);
  assert.equal(observed.state, 'done');
  assert.equal(observed.done_basis, 'observed', 'done_basis carries the explicit occurrence\'s own basis');
  assert.equal(observed.landing_at, '2026-09-16T00:00:00.000Z');
});

// F12: replay must not silently promote proxy evidence into measured facts. A `dispatched`
// occurrence only starts the cycle when its basis is 'observed' — every other supported basis
// (scope/gate/receipt-proxy, plan-commit, derived-child) is activity only, counted in
// `proxy_dispatches`. A task `done` carries its own occurrence's basis into `done_basis` rather
// than being hard-coded 'observed', so a proxy completion stays identifiable (and excludable) by
// downstream metrics (Task 7) instead of leaking into measured cycle time/throughput/accuracy.
test('F12: a proxy-basis dispatch never sets a start (counted in proxy_dispatches); a proxy-basis done keeps its own basis', () => {
  const o = [
    obs('task-a', 'created', '2026-09-14T09:00:00Z'),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', basis: 'scope-proxy', meta: { stage: 'build' } }),
    obs('task-a', 'dispatched', '2026-09-16T09:30:00Z', { source: 'hook', basis: 'scope-proxy', transition_id: `${R}/task-a/dispatched/2`, meta: { stage: 'build' } }),
    obs('task-a', 'done', '2026-09-16T11:00:00Z', { basis: 'gate-proxy' }),
  ];
  const { items } = tl(o);
  const a = items.get(it('task-a').item_id);
  assert.equal(a.started_at, null, 'no observed-basis dispatch was ever seen');
  assert.equal(a.start_basis, null);
  assert.equal(a.dispatch_count, 2);
  assert.equal(a.proxy_dispatches, 2, 'both dispatches were non-observed basis');
  assert.equal(a.done_at, '2026-09-16T11:00:00.000Z', 'done still records the terminal state');
  assert.equal(a.done_basis, 'gate-proxy', 'a proxy done is never promoted to observed');
  assert.equal(a.state, 'done');

  // A subsequent OBSERVED dispatch after proxy evidence is the real measured start.
  const o2 = [...o.slice(0, 2), obs('task-b', 'created', '2026-09-14T09:00:00Z'),
    obs('task-b', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', basis: 'scope-proxy', meta: { stage: 'build' } }),
    obs('task-b', 'dispatched', '2026-09-16T10:00:00Z', { source: 'hook', transition_id: `${R}/task-b/dispatched/2`, meta: { stage: 'build' } })];
  const b = tl(o2).items.get(it('task-b').item_id);
  assert.equal(b.started_at, '2026-09-16T10:00:00.000Z', 'the first observed-basis dispatch, not the earlier proxy one, is the start');
  assert.equal(b.start_basis, 'observed'); assert.equal(b.proxy_dispatches, 1); assert.equal(b.dispatch_count, 2);
});

// F17 (Task 6's slice): the timeline must not drop which occurrence *source* (cli/git/hook/
// automation-sync) produced each clock — Item now carries a *_source field alongside each *_at,
// distinct from *_basis, so Task 7/8 can build the promised per-source coverage shares instead of
// substituting basis counts.
test('F17: Item preserves the selected occurrence source per clock, not only its basis', () => {
  const o = [
    obs('task-a', 'created', '2026-09-14T09:00:00Z', { source: 'git' }),
    obs('task-a', 'first_commit', '2026-09-15T08:00:00Z', { source: 'git' }),
    obs('task-a', 'dispatched', '2026-09-16T09:00:00Z', { source: 'hook', meta: { stage: 'build' } }),
    obs('task-a', 'done', '2026-09-16T11:00:00Z'),
  ];
  const { items } = tl(o);
  const a = items.get(it('task-a').item_id);
  assert.equal(a.created_source, 'git'); assert.equal(a.first_commit_source, 'git'); assert.equal(a.start_source, 'hook'); assert.equal(a.done_source, 'cli');
  assert.equal(a.created_basis, 'observed', 'source is additional to basis, not a replacement for it');
});

test('a removed_delivered row (cancelled: false) is a normal terminal child, never counted as scope-cancelled', () => {
  const withRemovedDelivered = { run: R, items: [
    plan.items[0], plan.items[1],
    { ...plan.items[2] }, // task-a, cancelled: undefined
    { ...plan.items[3], cancelled: false, removed_delivered: true }, // task-b: delivered scope a later version removed
  ] };
  const o = [
    obs('task-a', 'created', '2026-09-14T00:00:00Z'), obs('task-a', 'done', '2026-09-15T00:00:00Z'),
    obs('task-b', 'created', '2026-09-14T00:00:00Z'), obs('task-b', 'done', '2026-09-15T00:00:00Z'),
  ];
  const { items } = buildTimelines({ occurrences: selectOccurrences(o).occurrences, plan: withRemovedDelivered, end: END });
  const m = items.get(it('mission-g1').item_id);
  assert.equal(m.child_summary.cancelled_scope, 0, 'removed_delivered rows are not cancelled_in_plan');
  assert.equal(m.child_summary.done, 2);
  assert.ok(m.flags.includes('awaiting-landing'), 'all-terminal, all delivered, no landing yet');
});

test('rollups: derived start (explicit parent dispatch ignored), Monday completion survives Tuesday scope addition; endpoint remains pending through Wednesday', () => {
  const A = it('task-a').item_id, B = it('task-b').item_id, M = it('mission-g1').item_id, C = it('campaign').item_id;
  const v1 = plan.items.filter((i) => [C, M, A].includes(i.item_id));
  const v2 = [...v1, { ...it('task-b'), version_added: 2 }];
  const history = { ...plan, items: v2, observation_start: '2026-09-14T00:00:00.000Z', versions: [
    { version: 1, at: '2026-09-13T00:00:00.000Z', items: v1 },
    { version: 2, at: '2026-09-15T09:00:00.000Z', items: v2 },
  ] };
  const es = EST({ low: 2, high: 6, proposed_at: '2026-09-13T00:00:00Z', accepted_at: '2026-09-13T01:00:00Z' });
  const occurrences = selectOccurrences([
    obs('mission-g1', 'estimated', es.accepted_at, { estimate: es }),
    obs('task-a', 'dispatched', '2026-09-14T09:00:00Z', { meta: { stage: 'build' } }),
    obs('task-a', 'done', '2026-09-14T11:00:00Z'),
    obs('mission-g1', 'done', '2026-09-14T13:00:00Z'),
    obs('task-b', 'created', '2026-09-15T09:00:00Z', { meta: { version: 2 } }),
  ]).occurrences;
  const early = buildTimelines({ occurrences, plan: history, end: '2026-09-15T00:00:00Z' });
  const late = buildTimelines({ occurrences, plan: history, end: '2026-09-17T00:00:00Z' });
  for (const id of [M, C]) {
    assert.equal(early.items.get(id).state, 'done');
    const i = late.items.get(id);
    assert.equal(i.done_at, '2026-09-14T13:00:00.000Z');
    assert.equal(i.first_completion.started_at, '2026-09-14T09:00:00.000Z');
    assert.equal(i.state, 'in_progress'); assert.equal(i.current_scope.done_at, null);
    assert.equal(i.current_scope.pending, true); assert.ok(i.flags.includes('scope-pending-after-first-completion'));
  }
  assert.equal(late.items.get(M).child_summary.open, 1);
  const later = [...occurrences, ...selectOccurrences([obs('task-b', 'done', '2026-09-16T11:00:00Z', { meta: { version: 2 } })]).occurrences];
  const noNewLanding = buildTimelines({ occurrences: later, plan: history, end: END }).items.get(M);
  assert.equal(noNewLanding.current_scope.done_at, null); assert.equal(noNewLanding.done_at, '2026-09-14T13:00:00.000Z');
  const removed = { ...history, versions: [{ ...history.versions[0], items: v2 }, { ...history.versions[1], items: v1 }] };
  const afterRemoval = buildTimelines({ occurrences, plan: removed, end: END }).items.get(M);
  assert.equal(afterRemoval.first_completion.done_at, '2026-09-15T09:00:00.000Z', 'removal qualifies Tuesday, never backdates completion to Monday');
});

test('estimateOriginal / estimateLatest', () => {
  const es = [{ revision: 0, at: '2026-09-15T00:00:00.000Z', estimate: EST({ accepted_by: null, accepted_at: null }), status: 'unaccepted' },
    { revision: 1, at: '2026-09-15T12:00:00.000Z', estimate: EST(), status: 'accepted' }, { revision: 2, at: '2026-09-16T12:00:00.000Z', estimate: EST({ high: 5 }), status: 'accepted' }];
  assert.equal(estimateOriginal(es).high, 3); assert.equal(estimateLatest(es, '2026-09-16T09:00:00.000Z').high, 3); assert.equal(estimateLatest(es, '2026-09-17T00:00:00.000Z').high, 5); assert.equal(estimateOriginal([es[0]]), null);
});

test('research-09: a git "address review" rework inside a hook fix-dispatch span is the same episode — counted once; outside any span it counts', () => {
  const hook = (event, at, agent, stage = 'fix') => makeObservation({ user: 'u', host: 'claude', plan: R, item_id: it('task-a').item_id, ref: it('task-a').ref, level: 'task', event, at, transition_id: `${it('task-a').item_id}/${event}/${agent}`, source: 'hook', source_record_id: `claude:s:${agent}`, agentId: agent, meta: { version: 1, stage } }, { now: 0 });
  const gitRework = (at, round) => obs('task-a', 'rework_observed', at, { source: 'git', transition_id: `${it('task-a').item_id}/rework_observed/${round}`, meta: { round, git_sha: `sha-${round}` } });
  const o = [obs('task-a', 'created', '2026-09-14T09:00:00Z'),
    hook('dispatched', '2026-09-15T09:00:00Z', 'a1', 'build'), hook('dispatch_ended', '2026-09-15T09:30:00Z', 'a1', 'build'),
    // fix round 1: hook span 10:00–10:20 with its own rework_observed; the git commit lands inside the span
    hook('dispatched', '2026-09-15T10:00:00Z', 'a2'), hook('rework_observed', '2026-09-15T10:00:00Z', 'a2'), gitRework('2026-09-15T10:12:00Z', 1), hook('dispatch_ended', '2026-09-15T10:20:00Z', 'a2'),
    // a later hand-made "address review 2" commit with no hook dispatch around it is a second episode
    gitRework('2026-09-15T12:00:00Z', 2),
    obs('task-a', 'done', '2026-09-15T13:00:00Z')];
  const { items } = tl(o); const a = items.get(it('task-a').item_id);
  assert.equal(a.rework_count, 2, 'one hook-witnessed episode (git duplicate folded in) + one git-only episode');
  assert.equal(a.fix_spans.length, 1); assert.equal(a.fix_spans[0].to, '2026-09-15T10:20:00.000Z');
});
