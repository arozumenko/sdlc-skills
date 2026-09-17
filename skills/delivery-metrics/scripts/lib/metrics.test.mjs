import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secondsBetween, toHours, stats, isoWeekUtc, weekKeys, computeMetrics } from './metrics.mjs';

const PROFILE = { zeroDurationSec: 60, minWholeWeeks: 3 };
const H = 3600;
const EST = (low, high, o = {}) => ({ unit: 'h', low, high, tier: 'budgetary', proposed_by: 'tl', proposed_at: '2026-09-01T00:00:00Z', accepted_by: 'D', accepted_at: '2026-09-01T00:00:00Z', ...o });
// Item shape per Task 6 (timeline.mjs). Extended (F17) with the *_source fields so coverage.sources
// can be exercised: created_source/start_source/first_commit_source/done_source, each defaulted from
// the corresponding *_at being set (and independently overridable, e.g. for done_basis proxy tests — F12).
const item = (o) => ({ item_id: o.id, ref: o.id, level: o.level ?? 'task', parent_item_id: o.parent ?? null, class: o.class ?? null, role: null, story: null, sequence: o.sequence ?? null, version_added: o.version_added ?? 1,
  cancelled_in_plan: Boolean(o.cancelled_in_plan), created_at: o.created ?? null, created_basis: o.created_basis ?? (o.created ? 'observed' : null), created_sha: o.created_sha ?? null,
  created_source: o.created_source ?? (o.created ? 'cli' : null),
  estimates: o.est ? [{ revision: 0, at: o.est.accepted_at ?? o.est.proposed_at, estimate: o.est, status: o.est.accepted_by ? 'accepted' : 'unaccepted' }] : [],
  estimate_original: o.est?.accepted_by ? o.est : null, estimate_latest: o.est?.accepted_by ? o.est : null, started_at: o.started ?? null, start_basis: o.started ? (o.start_basis ?? 'observed') : null,
  start_source: o.start_source ?? (o.started ? 'hook' : null),
  first_commit_at: o.commit ?? null, first_commit_source: o.first_commit_source ?? (o.commit ? 'git' : null),
  done_at: o.done ?? null, done_basis: o.done ? (o.done_basis ?? 'observed') : null, done_source: o.done_source ?? (o.done ? 'cli' : null), done_sha: o.done_sha ?? null, landing_at: null, cancelled_at: o.cancelled ?? null,
  state: o.state ?? (o.done ? 'done' : o.cancelled ? 'cancelled' : o.started ? 'in_progress' : 'planned'), dispatch_count: o.started ? 1 : 0, rework_count: o.rework ?? 0, deferred_events: 0, reopened: false,
  children: o.children ?? [], child_summary: { done: 0, cancelled: 0, open: 0, unknown: 0, cancelled_scope: 0 }, flags: o.flags ?? [] });
const toMap = (arr) => new Map(arr.map((i) => [i.item_id, i]));

test('seconds/hours, stats floors, nearest rank on unrounded values', () => {
  assert.equal(secondsBetween('2026-09-16T09:00:00Z', '2026-09-16T11:30:00Z'), 9000); assert.equal(toHours(9000), 2.5); assert.equal(secondsBetween('2026-09-16T09:00:15Z', '2026-09-16T09:00:00Z'), -15);
  const s4 = stats([4, 1, 3, 2]); assert.equal(s4.n, 4); assert.equal(s4.median, null); assert.deepEqual(s4.samples, [1, 2, 3, 4]);
  const s7 = stats([1, 2, 3, 4, 5, 6, 7]); assert.equal(s7.median, 4); assert.equal(s7.p85, 6); assert.equal(s7.p90, null);
  const s10 = stats([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]); assert.equal(s10.p90, 9); assert.equal(s10.p85, 9); assert.equal(s10.median, 5);
  assert.equal(stats([]), null);
  // minor: `samples` is omitted entirely for n >= 5, not merely set to undefined.
  assert.equal('samples' in s7, false); assert.equal('samples' in s10, false); assert.ok('samples' in s4);
});

test('first parent delivery drives throughput/accuracy while endpoint scope drives WIP', () => {
  const est = { unit: 'h', low: 2, high: 6, tier: 'budgetary', accepted_by: 'D', accepted_at: '2026-09-13T01:00:00.000Z' };
  const parent = item({ id: 'parent', level: 'mission', started: '2026-09-14T09:00:00.000Z', start_basis: 'derived-child', done: '2026-09-14T13:00:00.000Z', est });
  const plan = { observation_start: '2026-09-14T00:00:00.000Z' };
  for (const state of ['done', 'in_progress']) {
    const i = { ...parent, state, flags: state === 'done' ? [] : ['scope-pending-after-first-completion'] };
    const m = computeMetrics({ items: toMap([i]), plan, since: '2026-09-14T00:00:00Z', end: '2026-09-17T00:00:00Z' });
    assert.equal(m.throughput.mission.weeks.reduce((n, w) => n + w.count, 0), 1);
    assert.equal(m.estimate_rows[0].actual_s, 14400); assert.equal(m.estimate_rows[0].ratio, 1); assert.equal(m.estimate_rows[0].hit, true);
    assert.equal(m.wip.mission, state === 'done' ? 0 : 1);
  }
});

test('isoWeekUtc across a year boundary; weekKeys whole/covered with a late coverage start', () => {
  assert.equal(isoWeekUtc('2026-01-01T00:00:00Z'), '2026-W01'); assert.equal(isoWeekUtc('2027-01-01T00:00:00Z'), '2026-W53'); assert.equal(isoWeekUtc('2026-09-16T23:59:59Z'), '2026-W38');
  assert.deepEqual(weekKeys('2026-09-09T12:00:00Z', '2026-09-28T00:00:00Z', '2026-09-09T12:00:00Z').map((k) => [k.key, k.whole, k.covered]), [['2026-W37', false, false], ['2026-W38', true, true], ['2026-W39', true, true]]);
  assert.deepEqual(weekKeys('2026-08-31T00:00:00Z', '2026-09-21T00:00:00Z', '2026-09-08T00:00:00Z').map((k) => [k.key, k.whole, k.covered]), [['2026-W36', false, false], ['2026-W37', false, false], ['2026-W38', true, true]], 'weeks before declared coverage are never whole');
});

test('computeMetrics: hand-computed flow, throughput, estimates (rows, strata, exclusions, band), coverage, rework', () => {
  const items = toMap([
    item({ id: 'c', level: 'campaign', children: ['m1', 'm2'], created: '2026-09-01T00:00:00Z' }),
    item({ id: 'm1', level: 'mission', parent: 'c', sequence: 1, children: ['t1', 't2', 't3'], started: '2026-09-07T09:00:00Z', start_basis: 'derived-child', done: '2026-09-09T17:00:00Z', est: EST(40, 60), created: '2026-09-01T00:00:00Z' }),
    item({ id: 'm2', level: 'mission', parent: 'c', sequence: 2, children: ['t4', 't5', 't6', 't7', 't8'], started: '2026-09-10T09:00:00Z', start_basis: 'derived-child', state: 'in_progress', created: '2026-09-01T00:00:00Z' }),
    // t1: created Mon 09:00, commit Wed 08:00, dispatch Wed 09:00, done Wed 11:00 → lead 50 h, cycle 2 h; est 1–3 → ratio 1, hit
    item({ id: 't1', parent: 'm1', class: 'S', created: '2026-09-07T09:00:00Z', commit: '2026-09-09T08:00:00Z', started: '2026-09-09T09:00:00Z', done: '2026-09-09T11:00:00Z', est: EST(1, 3) }),
    // t2: no dispatch, commit→done 3 h; estimate → missing_actual
    item({ id: 't2', parent: 'm1', class: 'S', created: '2026-09-07T09:00:00Z', commit: '2026-09-09T14:00:00Z', done: '2026-09-09T17:00:00Z', est: EST(1, 3) }),
    // t3: cycle 4 h, estimate accepted after the start → late_accepted
    item({ id: 't3', parent: 'm1', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T13:00:00Z', est: EST(1, 3, { accepted_at: '2026-09-08T10:00:00Z' }) }),
    // t4: cycle 6 h, unestimated, one rework proxy
    item({ id: 't4', parent: 'm2', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-10T09:00:00Z', done: '2026-09-10T15:00:00Z', rework: 1 }),
    // t5: cycle clock skewed (done before start) but lead valid: lead = 4 days; counted in throughput
    item({ id: 't5', parent: 'm2', class: 'M', created: '2026-09-07T09:00:00Z', started: '2026-09-11T12:00:00Z', done: '2026-09-11T09:00:00Z', est: EST(1, 3) }),
    // t6: open, WIP; point estimate
    item({ id: 't6', parent: 'm2', class: 'L', created: '2026-09-07T09:00:00Z', started: '2026-09-14T09:00:00Z', est: EST(2, 2) }),
    // t7: retrospective plan proxy: same commit created+done, 30 s apart → lead excluded; no start → missing_start
    item({ id: 't7', parent: 'm2', class: 'S', created: '2026-09-12T10:00:00Z', created_basis: 'plan-commit', created_sha: 'p1', done: '2026-09-12T10:00:30Z', done_sha: 'p1' }),
    // t8: genuine 15-second cycle with a narrow range 0–0.01 h (36 s) → hit, ratio 15/18 = 0.8333…; short lead but different commits → NOT retrospective
    item({ id: 't8', parent: 'm2', class: 'S', created: '2026-09-12T11:00:00Z', created_basis: 'plan-commit', created_sha: 'p2', started: '2026-09-12T11:00:00Z', done: '2026-09-12T11:00:15Z', done_sha: 'p3', est: EST(0, 0.01) }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  const T = d.flow.task.strata.all;
  assert.equal(d.cohorts.completed, 8, 't1 t2 t3 t4 t5 t7 t8 + m1');
  assert.deepEqual(T.cycle_time.samples, [15, 2 * H, 4 * H, 6 * H], 'seconds, unrounded: t8 t1 t3 t4');
  assert.deepEqual(T.commit_to_done.samples, [3 * H]);
  assert.equal(T.lead_time.n, 6, 't1 t2 t3 t4 t5 t8 (t7 retrospective)');
  assert.deepEqual(d.flow.task.excluded, { clock_skew_cycle: 1, clock_skew_commit: 0, clock_skew_lead: 0, retrospective_plan_proxy: 1, missing_start: 1 });
  assert.deepEqual(d.flow.task.strata.S.cycle_time.samples, [15, 2 * H]);
  assert.equal(d.flow.mission.strata.all.cycle_time, null); assert.deepEqual(d.flow.mission.strata.all.parent_elapsed.samples, [56 * H]);
  // minor: quality lives in exactly one place — per-stratum (strata.<class>.quality, including
  // 'all') — no level-level duplicate. F17: quality denominators also per class stratum, not only
  // per level. S = t1,t2,t7,t8 (4); M = t3,t4,t5 (3); L = t6 is WIP not done (0).
  assert.deepEqual(d.flow.task.strata.all.quality, { reviewed: null, eligible: null, done: 7, unknown: 7 });
  assert.deepEqual(d.flow.task.strata.S.quality, { reviewed: null, eligible: null, done: 4, unknown: 4 });
  assert.deepEqual(d.flow.task.strata.M.quality, { reviewed: null, eligible: null, done: 3, unknown: 3 });
  assert.deepEqual(d.throughput.task.weeks.map((w) => [w.key, w.count, w.whole]), [['2026-W37', 7, true], ['2026-W38', 0, true]]);
  assert.equal(d.throughput.task.velocity, null); assert.match(d.throughput.task.caveat, /2 whole weeks < 3/);
  assert.equal(d.throughput.mission.weeks[0].count, 1); assert.equal(d.wip.task, 1);
  const e = d.estimates.task.strata.all;
  assert.equal(e.n, 5, 'items carrying an estimate: t1 t2 t3 t5 t8');
  assert.equal(e.eligible, 2, 't1 and t8');
  assert.deepEqual(e.excluded, { excluded_item: 0, unestimated: 2, unaccepted: 0, no_eligible_latest: 0, unit_mismatch: 0, missing_actual: 1, late_accepted: 1, zero_midpoint: 0, zero_actual: 0, point: 0, clock_skew: 1 });
  assert.deepEqual(e.work_ratio.samples.map((x) => Math.round(x * 10000) / 10000), [0.8333, 1]);
  // MdMRE = median(|15-18|/15, |7200-7200|/7200) = median(0.2, 0): sorted [0, 0.2], nearest-rank q=.5 → index ceil(1)-1 = 0 → 0
  assert.equal(e.mdmre, 0); assert.equal(e.pred25, 1); assert.equal(e.mae_s, 1.5, 'mean(|15-18|, |7200-7200|) = 1.5 s');
  assert.deepEqual(e.hit_rate, { hits: 2, ranged: 2, rate: 1 });
  assert.equal(d.estimates.task.strata.S.eligible, 2); assert.equal(d.estimates.task.strata['tier:budgetary'].eligible, 2);
  // F17: joint class|tier stratum in addition to 'all', per-class, and 'tier:' marginals — t1 and t8 are both S/budgetary.
  assert.equal(d.estimates.task.strata['S|budgetary'].eligible, 2);
  const rows = Object.fromEntries(d.estimate_rows.map((r) => [r.ref, r]));
  assert.equal(rows.t1.hit, true); assert.equal(rows.t1.ratio, 1); assert.equal(rows.t1.actual_s, 2 * H); assert.equal(rows.t1.reason, null);
  assert.equal(rows.t2.reason, 'missing_actual'); assert.equal(rows.t3.reason, 'late_accepted'); assert.equal(rows.t5.reason, 'clock_skew'); assert.equal(rows.t4, undefined, 'unestimated items have no row');
  assert.equal(rows.m1.ratio, 1.12); assert.equal(rows.m1.hit, true); assert.equal(rows.m1.actual_basis, 'derived-child');
  assert.deepEqual(d.schedule_variance[0].band, { vs_high_s: -4 * H, vs_low_s: 16 * H });
  assert.deepEqual(d.mission_turnaround.pairs, [{ from: 'm1', to: 'm2', gap_s: 16 * H, overlap_s: null }]);
  assert.equal(d.coverage.task.done, 7); assert.equal(d.coverage.task.with_dispatched, 5); assert.equal(d.coverage.task.start_source.none, 2);
  // F17: coverage.sources is keyed from the *_source fields (cli/hook/git/…), not the *_basis fields (observed/plan-commit/…).
  // done cohort at task level: t1 t2 t3 t4 t5 t7 t8, all defaulted done_source='cli' by the item() helper (none override it) → all 7 land in 'cli'.
  assert.deepEqual(d.coverage.task.sources.done, { cli: 7 });
  // created_source: same 7 items, all defaulted 'cli' → {cli: 7}. Distinct from created_basis values (observed/plan-commit) which would fail this shape.
  assert.deepEqual(d.coverage.task.sources.created, { cli: 7 });
  // dispatched (start_source): only items with started_at get a source — t1 t3 t4 t5 (t8 has started_at too) = 5, all default 'hook'.
  assert.deepEqual(d.coverage.task.sources.dispatched, { hook: 5 });
  // first_commit (first_commit_source): t1 and t2 are the only done tasks with a first_commit_at set.
  assert.deepEqual(d.coverage.task.sources.first_commit, { git: 2 });
  assert.equal(d.rework_proxy_items, 1);
  assert.ok(d.caveats.some((c) => /velocity\(task\)/.test(c)));
});

test('computeMetrics: velocity over whole covered weeks; overlap; filters; latest base', () => {
  const items = toMap([
    item({ id: 'm1', level: 'mission', sequence: 1, started: '2026-09-01T00:00:00Z', start_basis: 'derived-child', done: '2026-09-20T00:00:00Z' }),
    item({ id: 'm2', level: 'mission', sequence: 2, started: '2026-09-15T00:00:00Z', start_basis: 'derived-child', done: '2026-09-25T00:00:00Z' }),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => item({ id: `t${i}`, class: i % 2 ? 'S' : 'M', started: '2026-09-01T00:00:00Z', done: `2026-09-${String(i + 6).padStart(2, '0')}T12:00:00Z` })),
  ]);
  const plan = { run: 'p', observation_start: '2026-08-31T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-08-31T00:00:00Z', end: '2026-09-28T00:00:00Z', profile: PROFILE });
  assert.deepEqual(d.throughput.task.weeks.map((w) => [w.key, w.count, w.whole]), [['2026-W36', 0, true], ['2026-W37', 7, true], ['2026-W38', 0, true], ['2026-W39', 0, true]]);
  assert.deepEqual(d.throughput.task.velocity, { median: 0, mean: 1.75, whole_weeks: 4 });
  assert.deepEqual(d.mission_turnaround.pairs, [{ from: 'm1', to: 'm2', gap_s: null, overlap_s: 120 * H }]);
  const late = computeMetrics({ items, plan: { ...plan, observation_start: '2026-09-08T00:00:00Z' }, since: '2026-08-31T00:00:00Z', end: '2026-09-28T00:00:00Z', profile: PROFILE });
  assert.deepEqual(late.throughput.task.weeks.map((w) => [w.key, w.whole]), [['2026-W36', false], ['2026-W37', false], ['2026-W38', true], ['2026-W39', true]]);
  assert.equal(late.throughput.task.velocity, null, 'only 2 whole covered weeks');
  const f = computeMetrics({ items, plan, since: '2026-08-31T00:00:00Z', end: '2026-09-28T00:00:00Z', profile: PROFILE, filters: { class: 'S' } });
  assert.equal(f.coverage.task.done, 4);
});

// F10: items flagged invalid-chain are excluded from throughput as well as durations/estimates
// (counted in cohorts.excluded_items.invalid_chain). A deferred-episode item is still excluded from
// durations/estimates but DOES still count once in throughput by its first completion.
test('F10: invalid-chain items excluded from throughput too; deferred-episode still counts once in throughput', () => {
  const items = toMap([
    item({ id: 'bad', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T11:00:00Z', flags: ['invalid-chain'] }),
    item({ id: 'defe', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T13:00:00Z', flags: ['deferred-episode'] }),
    item({ id: 'good', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T15:00:00Z' }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  assert.equal(d.cohorts.excluded_items.invalid_chain, 1);
  assert.equal(d.cohorts.excluded_items.deferred_episode, 1);
  const totalThroughput = d.throughput.task.weeks.reduce((n, w) => n + w.count, 0);
  assert.equal(totalThroughput, 2, 'invalid-chain excluded; deferred-episode still counted once; good counted');
  assert.equal(d.flow.task.strata.all.cycle_time.n, 1, 'only "good" feeds durations — bad=invalid-chain, defe=deferred-episode both excluded');
});

// F12: only start_basis === 'observed' feeds cycle_time (already true), AND done_basis other than
// observed/derived-child (a proxy done — scope-proxy/gate-proxy/receipt-proxy/plan-commit) excludes
// the item from measured durations, throughput, and estimate accuracy; counted in
// cohorts.excluded_items.proxy_completions.
test('F12: proxy done_basis excludes an item from measured durations, throughput and estimate accuracy', () => {
  const est = EST(1, 3);
  const items = toMap([
    item({ id: 'px', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T11:00:00Z', done_basis: 'gate-proxy', est }),
    item({ id: 'ok', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T12:00:00Z', est }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  assert.equal(d.cohorts.excluded_items.proxy_completions, 1);
  assert.equal(d.flow.task.strata.all.cycle_time.n, 1, 'only the reliable (observed done_basis) item feeds cycle_time');
  const totalThroughput = d.throughput.task.weeks.reduce((n, w) => n + w.count, 0);
  assert.equal(totalThroughput, 1, 'proxy-basis completion excluded from throughput');
  const row = d.estimate_rows.find((r) => r.ref === 'px');
  assert.equal(row.reason, 'excluded_item', 'proxy completion excluded from estimate accuracy too');
  assert.equal(d.estimates.task.strata.all.eligible, 1, 'only "ok" is eligible');
  // minor: coverage.done_basis reconciles with throughput — observed(1) + derived-child(0) + proxy(1) = coverage.done(2);
  // throughput's total(1) equals just the observed+derived-child slice, matching totalThroughput above.
  assert.deepEqual(d.coverage.task.done_basis, { observed: 1, 'derived-child': 0, proxy: 1 });
});

// F17: source shares are read from the Item's *_source fields (cli/hook/git/webhook/…), independent
// of the *_basis fields (observed/derived-child/plan-commit/…) already exercised above.
test('F17: coverage.sources reads the *_source fields (distinct values from *_basis) across created/dispatched/first_commit/done', () => {
  const estA = EST(2, 4, { tier: 'firm' });
  const estB = EST(2, 4, { tier: 'firm' });
  const items = toMap([
    item({ id: 'a', class: 'S', created: '2026-09-07T09:00:00Z', created_source: 'hook', started: '2026-09-08T09:00:00Z', start_source: 'cli', commit: '2026-09-08T08:00:00Z', first_commit_source: 'git', done: '2026-09-08T12:00:00Z', done_source: 'webhook', est: estA }),
    item({ id: 'b', class: 'S', created: '2026-09-07T09:00:00Z', created_source: 'hook', started: '2026-09-08T09:00:00Z', start_source: 'cli', done: '2026-09-08T13:00:00Z', done_source: 'webhook', est: estB }),
    item({ id: 'c', class: 'M', created: '2026-09-07T09:00:00Z', created_source: 'git', started: '2026-09-08T09:00:00Z', start_source: 'hook', done: '2026-09-08T15:00:00Z', done_source: 'cli' }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  assert.deepEqual(d.coverage.task.sources.created, { hook: 2, git: 1 });
  assert.deepEqual(d.coverage.task.sources.dispatched, { cli: 2, hook: 1 });
  assert.deepEqual(d.coverage.task.sources.first_commit, { git: 1 });
  assert.deepEqual(d.coverage.task.sources.done, { webhook: 2, cli: 1 });
  // F17: joint class|tier estimate strata in addition to 'all', per-class, and 'tier:' marginals.
  assert.equal(d.estimates.task.strata['S|firm'].eligible, 2);
  assert.equal(d.estimates.task.strata['tier:firm'].eligible, 2);
  assert.equal(d.estimates.task.strata.S.eligible, 2);
});

// Important fix: cohorts.excluded_items must be scoped to the windowed done cohort — an item whose
// done_at falls outside [since,end) must not inflate a count that otherwise can't exceed
// cohorts.completed. The window-independent total moves to a separate `inventory.excluded_items`.
test('Important fix: cohorts.excluded_items is windowed; inventory.excluded_items keeps the window-independent total', () => {
  const items = toMap([
    // done_at is well before `since` — an excluded item that completes outside the window.
    item({ id: 'outside', class: 'S', created: '2026-08-01T09:00:00Z', started: '2026-08-01T10:00:00Z', done: '2026-08-01T12:00:00Z', flags: ['invalid-chain'] }),
    item({ id: 'inside', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T11:00:00Z', flags: ['invalid-chain'] }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  assert.equal(d.cohorts.completed, 1, 'only "inside" completed within the window');
  assert.equal(d.cohorts.excluded_items.invalid_chain, 1, 'windowed: only "inside" — never exceeds cohorts.completed');
  assert.equal(d.inventory.excluded_items.invalid_chain, 2, 'window-independent: both "outside" and "inside"');
});

// Minor fix: late_accepted must compare epoch numbers, not ISO strings — the equality case
// (accepted_at === started_at, both already the same ISO representation) must still trigger
// late_accepted, which a buggy `new Date(...).toISOString() >= raw string` comparison can miss
// once one side has been re-normalized to millisecond precision.
test('minor: late_accepted fires on accepted_at === started_at (numeric clock equality)', () => {
  const est = EST(1, 3, { accepted_at: '2026-09-08T09:00:00Z' });
  const items = toMap([
    item({ id: 'eq', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T13:00:00Z', est }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  const row = d.estimate_rows.find((r) => r.ref === 'eq');
  assert.equal(row.reason, 'late_accepted');
});

// Minor fix: zero_midpoint is a mutually exclusive reason (brief order: …, late_accepted,
// zero_midpoint, zero_actual, …) — the item is not eligible and contributes no MAE/ratio/MRE.
test('minor: zero_midpoint is a mutually exclusive exclusion reason, not an eligible-but-flagged item', () => {
  const est = EST(0, 0);
  const items = toMap([
    item({ id: 'zm', class: 'S', created: '2026-09-07T09:00:00Z', started: '2026-09-08T09:00:00Z', done: '2026-09-08T10:00:00Z', est }),
  ]);
  const plan = { run: 'p', observation_start: '2026-09-07T00:00:00Z', items: [...items.values()] };
  const d = computeMetrics({ items, plan, since: '2026-09-07T00:00:00Z', end: '2026-09-21T00:00:00Z', profile: PROFILE });
  const row = d.estimate_rows.find((r) => r.ref === 'zm');
  assert.equal(row.reason, 'zero_midpoint');
  assert.equal(row.ratio, null); assert.equal(row.hit, null);
  const e = d.estimates.task.strata.all;
  assert.equal(e.eligible, 0);
  assert.deepEqual(e.excluded, { excluded_item: 0, unestimated: 0, unaccepted: 0, no_eligible_latest: 0, unit_mismatch: 0, missing_actual: 0, late_accepted: 0, zero_midpoint: 1, zero_actual: 0, point: 0, clock_skew: 0 });
  assert.equal(e.work_ratio, null); assert.equal(e.mae_s, null);
});
