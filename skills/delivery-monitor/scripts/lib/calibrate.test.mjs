import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendObservation, makeObservation } from './events.mjs';
import { deliveryDir, runPath } from './paths.mjs';
import { mkdirSync } from 'node:fs';
const deliveryDirOf = (repo) => { const d = deliveryDir(repo); mkdirSync(d, { recursive: true }); return d; };
import { buildCalibration, cellKeys, classOf, fillEstimates, lookup } from './calibrate.mjs';
import { costOf, loadPrices, loadPricesChecked as loadPricesCheckedFor, priceFor } from './cost.mjs';

const NOW = Date.parse('2026-11-12T12:00:00Z');
// Same shapes as delivery.test.mjs (not imported: importing a test file re-runs its tests).
const CLI = fileURLToPath(new URL('../delivery.mjs', import.meta.url));
const run = (repo, args, { env = {} } = {}) => {
  try { return { code: 0, stdout: execFileSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, DELIVERY_NO_SYNC: '1', CLAUDE_CODE_SESSION_ID: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] }), stderr: '' }; }
  catch (e) { return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
};
const initRepo = () => { const r = mkdtempSync(join(tmpdir(), 'dm-cal-')); for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@x'], ['config', 'user.name', 'Tester']]) execFileSync('git', a, { cwd: r }); return r; };
const plan = (v, tasks) => ({ campaign_id: 'sec', run_id: 'run-1', version: v, factory: 'feature-development', observation_start: '2026-11-01T00:00:00Z',
  source_epoch: { from: '2026-11-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks }] });
const writePlan = (repo, p, name = 'plan.md') => { const f = join(repo, name); writeFileSync(f, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`); return f; };
const DAY = 86_400_000;

test('cost: list prices, date-suffixed ids, 1h cache writes at 2x input, fast mode doubled, unknown models listed not guessed', () => {
  const P = loadPrices();
  assert.equal(priceFor(P, 'claude-sonnet-5-5-20261001').input, 2);
  assert.equal(priceFor(P, 'claude-opus-5-5[1m]').output, 20);
  assert.equal(priceFor(P, 'claude-opus-5-9'), null, 'an unknown version of a known family is not guessed');
  assert.equal(priceFor(P, 'claude-opus-5-5-preview'), null);
  const { cost_usd, unpriced } = costOf({ 'claude-opus-5-5': { input: 1e6, output: 1e6, cache_write: 1e6, cache_write_1h: 1e6, cache_read: 1e6 }, 'claude-opus-5-5#fast': { output: 1e6 }, 'other-model': { input: 9 } }, P);
  assert.equal(cost_usd, 4 + 20 + 5 + 8 + 0.2 + 40);
  assert.deepEqual(unpriced, ['other-model']);
  assert.deepEqual(costOf({ '<synthetic>': { input: 0, output: 0 }, 'claude-haiku-5-5': { output: 1e6 } }, P), { cost_usd: 0.5, unpriced: [] }, 'zero-token host rows are not an unpriced gap');
});

const sample = (o) => ({ run: 'r', ref: o.ref ?? 'T', role: 'python-dev', type: 'feature', novel: false, size: 'M', returned: false, model: 'claude-opus-5-5', done_at: new Date(NOW - DAY).toISOString(), ...o });

test('buildCalibration: cells fall back from role|type|novel to all; classes from quartiles; recency halves weight per half-life', () => {
  const samples = [];
  for (let k = 0; k < 6; k++) samples.push(sample({ ref: `P${k}`, cost_usd: 2 + k * 0.1 }));
  for (let k = 0; k < 6; k++) samples.push(sample({ ref: `A${k}`, role: 'android-dev', cost_usd: 10 + k, returned: k < 3 }));
  const cal = buildCalibration(samples, { now: NOW });
  assert.equal(cal.samples, 12); assert.ok(cal.class_bounds_usd, '12 samples are enough to learn classes');
  assert.equal(cal.cells['role=python-dev|type=feature|novel=false'].n, 6);
  assert.equal(cal.cells['role=android-dev|type=feature'].return_rate, 0.5);
  const py = lookup(cal, { role: 'python-dev', type: 'feature', novel: false });
  assert.equal(py.key, 'role=python-dev|type=feature|novel=false'); assert.equal(py.cell.effort_class, 'E1');
  assert.equal(lookup(cal, { role: 'android-dev', type: 'feature' }).cell.effort_class, 'E3', 'median $12 sits on the 75th-percentile bound');
  assert.equal(lookup(cal, { role: 'js-dev', type: 'bugfix' }).key, 'all', 'an unseen role falls back to the whole population');
  assert.deepEqual(cellKeys({ role: 'x', novel: true }), ['role=x', 'all'], 'a missing feature is skipped, not matched as null');
  assert.equal(classOf(1, [1, 2, 3]), 'E1'); assert.equal(classOf(3.01, [1, 2, 3]), 'E4');
  // Recency: one fresh expensive sample outweighs four year-old cheap ones in the median.
  const old = new Date(NOW - 365 * DAY).toISOString();
  const rc = buildCalibration([...[1, 1, 1, 1].map((c, k) => sample({ ref: `o${k}`, cost_usd: c, done_at: old })), sample({ ref: 'new', cost_usd: 9 })], { now: NOW });
  assert.equal(rc.cells.all.p50_usd, 9);
  assert.equal(rc.class_bounds_usd, null, 'fewer than 12 samples: no learned classes');
});

test('fillEstimates: unestimated tasks get a calibrated, auto-accepted usd range; planner estimates and previous calibrated estimates are kept', () => {
  const samples = Array.from({ length: 12 }, (_, k) => sample({ ref: `S${k}`, cost_usd: 1 + k }));
  const calib = { cal: buildCalibration(samples, { now: NOW }), sha256: 'a'.repeat(64) };
  const p = { missions: [{ tasks: [
    { ref: 'NEW', item_id: 'c/r/task-new', role: 'python-dev', type: 'feature', novel: false },
    { ref: 'OWN', item_id: 'c/r/task-own', estimate: { unit: 'h', low: 1, high: 2, tier: 'ROM', proposed_by: 'tl', proposed_at: '2026-11-01T00:00:00Z' } },
    { ref: 'OLD', item_id: 'c/r/task-old', role: 'python-dev' },
  ] }] };
  const prevEst = { unit: 'usd', low: 3, high: 4, tier: 'calibrated', proposed_by: 'calibrate', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'calibrate (auto)', accepted_at: '2026-11-01T00:00:00Z', reference: { path: 'x', sha256: 'b'.repeat(64), population: 'all n=9' } };
  const res = fillEstimates(p, calib, { now: NOW, prevItems: [{ item_id: 'c/r/task-old', estimate: prevEst, effort_class: 'E2' }] });
  assert.deepEqual(res, { filled: 1, kept: 1, no_cell: 0, planner: 1 });
  const e = p.missions[0].tasks[0].estimate;
  assert.equal(e.unit, 'usd'); assert.equal(e.tier, 'calibrated'); assert.equal(e.accepted_by, 'calibrate (auto)'); assert.ok(e.low <= e.high);
  assert.match(e.reference.population, /^role=python-dev\|type=feature\|novel=false n=12$/);
  assert.ok(p.missions[0].tasks[0].effort_class);
  assert.equal(p.missions[0].tasks[2].estimate, prevEst, 'a re-cut keeps the estimate the task was planned with');
});

// End to end through the CLI: hooked cost on landed tasks → calibrate → next plan registers with calibrated estimates →
// the report scores them against measured cost.
const obs = (repo, f) => appendObservation(repo, makeObservation({ user: null, host: 'claude', plan: 'sec/run-1', level: 'task', basis: 'observed', ...f }, { now: NOW }), { now: NOW });
// One hooked dispatch (start + end) on an item. `agent` overrides the effort payload (null = an older hook with no cost).
function dispatch(repo, runId, ref, { at, id = ref, agent: effort, stage = 'build' }) {
  const item_id = `${runId}/task-${ref.toLowerCase()}`, agent = `agent-${id}`;
  const base = { plan: runId, item_id, ref };
  obs(repo, { ...base, event: 'dispatched', at, source: 'hook', source_record_id: `claude:s:${agent}`, transition_id: `${item_id}/dispatched/${agent}`, agentId: agent, meta: { stage, version: 1 } });
  obs(repo, { ...base, event: 'dispatch_ended', at: new Date(Date.parse(at) + 600_000).toISOString(), source: 'hook', source_record_id: `claude:s:${agent}`, transition_id: `${item_id}/dispatch_ended/${agent}`, agentId: agent,
    meta: { stage, version: 1, agent: { turns: 10, ...(effort === null ? {} : effort) } } });
}
const done = (repo, runId, ref, at) => { const item_id = `${runId}/task-${ref.toLowerCase()}`; obs(repo, { plan: runId, item_id, ref, event: 'done', at, source: 'cli', host: 'cli', source_record_id: `done-${ref}`, transition_id: `${item_id}/done/episode-1`, meta: { version: 1 } }); };
function landTask(repo, runId, ref, { cost, returned = false, at }) {
  const item_id = `${runId}/task-${ref.toLowerCase()}`, agent = `agent-${ref}`;
  const base = { plan: runId, item_id, ref };
  dispatch(repo, runId, ref, { at, agent: { usage: { 'claude-opus-5-5': { input: 1, output: 1 } }, cost_usd: cost, split: 1 } });
  if (returned) obs(repo, { ...base, event: 'rework_observed', at: new Date(Date.parse(at) + 700_000).toISOString(), source: 'hook', source_record_id: `claude:s:${agent}-fix`, transition_id: `${item_id}/rework_observed/${agent}-fix`, meta: { stage: 'fix', version: 1, round: null } });
  obs(repo, { ...base, event: 'done', at: new Date(Date.parse(at) + 3_600_000).toISOString(), source: 'cli', host: 'cli', source_record_id: `done-${ref}`, transition_id: `${item_id}/done/episode-1`, meta: { version: 1 } });
}

test('CLI: calibrate writes the table from landed tasks; plan register fills calibrated estimates; report scores them in usd strata', () => {
  const repo = initRepo();
  const tasks = Array.from({ length: 12 }, (_, k) => ({ ref: `T${k}`, role: 'python-dev', type: k < 8 ? 'feature' : 'bugfix', novel: false }));
  const p1 = plan(1, tasks);
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, p1), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  tasks.forEach((t, k) => landTask(repo, 'sec/run-1', t.ref, { cost: 2 + k, returned: k % 4 === 0, at: `2026-11-0${2 + (k % 7)}T10:00:00.000Z` }));

  const none = run(initRepo(), ['calibrate']); assert.equal(none.code, 3, 'no plan yet: nothing to calibrate');
  const dry = run(repo, ['calibrate', '--dry-run'], { env: {} });
  assert.equal(dry.code, 0, dry.stderr); assert.match(dry.stdout, /CALIBRATION samples=12 half-life=42d classes=E1<=\$/); assert.match(dry.stdout, /DRY-RUN not written/);
  const c = run(repo, ['calibrate']); assert.equal(c.code, 0, c.stderr);
  const cal = JSON.parse(readFileSync(join(deliveryDir(repo), 'calibration.json'), 'utf8'));
  assert.equal(cal.cells['role=python-dev|type=feature|novel=false'].n, 8);
  assert.equal(cal.cells['role=python-dev'].return_rate > 0, true);
  assert.equal(cal.outliers.length, 3);

  const p2 = { ...p1, run_id: 'run-2', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'N1', role: 'python-dev', type: 'feature', novel: false }, { ref: 'N2', role: 'qa-engineer', type: 'test' }] }] };
  const reg = run(repo, ['plan', 'register', '--from', writePlan(repo, p2, 'p2.md'), '--id', 'r2', '--created-at', '2026-11-10T00:00:00Z']);
  assert.equal(reg.code, 0, reg.stderr); assert.match(reg.stdout, /CALIBRATED filled=2 kept=0 planner=0 no-cell=0/); assert.match(reg.stdout, /accepted=2 unaccepted=0 unestimated=2/);
  const rec = JSON.parse(readFileSync(runPath(repo, 'sec/run-2'), 'utf8'));
  const n1 = rec.items.find((i) => i.ref === 'N1');
  assert.equal(n1.estimate.unit, 'usd'); assert.equal(n1.estimate.tier, 'calibrated'); assert.match(n1.estimate.reference.population, /^role=python-dev\|type=feature\|novel=false n=8$/);
  assert.ok(n1.effort_class); assert.equal(rec.items.find((i) => i.ref === 'N2').estimate.reference.population.split(' ')[0], 'all');
  assert.match(run(repo, ['plan', 'register', '--from', join(repo, 'p2.md'), '--id', 'r2', '--created-at', '2026-11-10T00:00:00Z']).stdout, /\(retry\)/, 'a retry is still recognised after the fill');

  // Registration stamps the real clock on the auto-accepted estimate, so the task starts after it and the report cuts off later.
  const start = new Date(Date.now() + 3_600_000).toISOString(), cutoff = new Date(Date.now() + 2 * DAY).toISOString();
  landTask(repo, 'sec/run-2', 'N1', { cost: n1.estimate.low, at: start });
  const rep = run(repo, ['report', '--json', '--plan', 'sec/run-2', '--cutoff', cutoff]);
  assert.equal(rep.code, 0, rep.stderr);
  const doc = JSON.parse(rep.stdout);
  const rows = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (v.ref === 'N1' && 'actual_usd' in v) rows.push(v); Object.values(v).forEach(walk); } }; walk(doc);
  assert.equal(rows.length, 1, 'one N1 estimate row');
  assert.equal(rows[0].actual_usd, n1.estimate.low); assert.equal(rows[0].reason, null); assert.equal(rows[0].hit, true); assert.equal(rows[0].effort_class, n1.effort_class);
  assert.ok(JSON.stringify(doc).includes('"usd:all"'), 'usd estimates are scored in their own strata');
  const md = run(repo, ['report', '--plan', 'sec/run-2', '--cutoff', cutoff]).stdout;
  assert.match(md, new RegExp(`\\| N1 \\| task \\| — \\| calibrated \\| original \\| \\[\\$${n1.estimate.low}, \\$${n1.estimate.high}\\] \\| \\$${n1.estimate.low} \\|`));
  assert.match(md, /\| task \| usd:all \| 1 \| 1 \|/);
  const html = run(repo, ['report', '--html', '--plan', 'sec/run-2', '--cutoff', cutoff]).stdout;
  assert.match(html, /Cost estimates/); assert.ok(html.includes(`$${n1.estimate.low}–$${n1.estimate.high}`), 'task row shows the dollar range, not hours');

  // A calibrated range accepted after the task already started is not a forecast: late_accepted, not a hit.
  const p3 = { ...p1, run_id: 'run-3', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'L1', role: 'python-dev', type: 'feature', novel: false }] }] };
  landTask(repo, 'sec/run-3', 'L1', { cost: 3, at: '2026-11-05T10:00:00.000Z' });
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, p3, 'p3.md'), '--id', 'r3', '--created-at', '2026-11-04T00:00:00Z']).code, 0);
  const late = []; const walk3 = (v) => { if (Array.isArray(v)) v.forEach(walk3); else if (v && typeof v === 'object') { if (v.ref === 'L1' && 'actual_usd' in v) late.push(v); Object.values(v).forEach(walk3); } };
  walk3(JSON.parse(run(repo, ['report', '--json', '--plan', 'sec/run-3', '--cutoff', cutoff]).stdout));
  assert.equal(late.length, 1); assert.equal(late[0].reason, 'late_accepted'); assert.equal(late[0].hit, null);
});

// Astra round 1 regressions.
test('cost completeness: an uncosted, malformed, unpriced or unfinished dispatch keeps the task out; a split dispatch is charged once', async () => {
  const { collectSamples } = await import('./calibrate.mjs');
  const repo = initRepo();
  const refs = ['OK', 'OLD', 'NEG', 'STR', 'UNP', 'OPEN', 'A', 'B'];
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, refs.map((ref) => ({ ref })))), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const at = '2026-11-03T10:00:00.000Z', end = '2026-11-03T12:00:00.000Z', good = { usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: 2, split: 1 };
  dispatch(repo, 'sec/run-1', 'OK', { at, agent: good });
  dispatch(repo, 'sec/run-1', 'OLD', { at, id: 'OLD-build', agent: null }); dispatch(repo, 'sec/run-1', 'OLD', { at: '2026-11-03T10:30:00.000Z', id: 'OLD-fix', agent: good });
  dispatch(repo, 'sec/run-1', 'NEG', { at, agent: { ...good, cost_usd: -10 } });
  dispatch(repo, 'sec/run-1', 'STR', { at, agent: { ...good, split: '0.5' } });
  dispatch(repo, 'sec/run-1', 'UNP', { at, agent: { ...good, unpriced_models: ['x'] } });
  // OPEN: a hooked dispatch that started but never ended.
  obs(repo, { plan: 'sec/run-1', item_id: 'sec/run-1/task-open', ref: 'OPEN', event: 'dispatched', at, source: 'hook', source_record_id: 'claude:s:agent-OPEN-2', transition_id: 'sec/run-1/task-open/dispatched/agent-OPEN-2', agentId: 'agent-OPEN-2', meta: { stage: 'build', version: 1 } });
  dispatch(repo, 'sec/run-1', 'OPEN', { at, agent: good });
  // One agent attributed to A and B (split 2): $6 → $3 each.
  for (const ref of ['A', 'B']) dispatch(repo, 'sec/run-1', ref, { at, id: 'AB', agent: { ...good, cost_usd: 6, split: 2 } });
  for (const ref of refs) done(repo, 'sec/run-1', ref, end);
  const got = Object.fromEntries(collectSamples(repo, { now: NOW }).map((s) => [s.ref, s.cost_usd]));
  assert.deepEqual(got, { OK: 2, A: 3, B: 3 });
});

test('identity: a re-priced dispatch is a new fact (ID-CONFLICT at the same revision, so the hook revises it)', async () => {
  const { factKey } = await import('./events.mjs');
  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'T1' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const rec = (cost) => makeObservation({ user: null, host: 'claude', plan: 'sec/run-1', level: 'task', basis: 'observed', item_id: 'sec/run-1/task-t1', ref: 'T1', event: 'dispatch_ended', at: '2026-11-03T10:10:00.000Z', source: 'hook', source_record_id: 'claude:s:a1', transition_id: 'sec/run-1/task-t1/dispatch_ended/a1', agentId: 'a1', meta: { stage: 'build', version: 1, agent: { turns: 1, cost_usd: cost, split: 1 } } }, { now: NOW });
  assert.notEqual(factKey(rec(1)), factKey(rec(2)));
  assert.equal(appendObservation(repo, rec(1), { now: NOW }).result, 'EVENT');
  assert.equal(appendObservation(repo, rec(1), { now: NOW }).result, 'SKIP');
  assert.equal(appendObservation(repo, rec(2), { now: NOW }).result, 'ID-CONFLICT');
  assert.equal(appendObservation(repo, { ...rec(2), revision: 1 }, { now: NOW }).result, 'EVENT');
});

test('calibration math: classes compare unrounded values; quantiles do not depend on absolute weight size', () => {
  const same = buildCalibration(Array.from({ length: 12 }, (_, k) => sample({ ref: `S${k}`, cost_usd: 1.234 })), { now: NOW });
  assert.equal(same.cells.all.effort_class, 'E1', 'identical samples sit in the lowest class, not E4');
  const at = (days) => Array.from({ length: 5 }, (_, k) => sample({ ref: `W${k}`, cost_usd: k + 1, done_at: new Date(NOW - days * DAY).toISOString() }));
  const young = buildCalibration(at(1), { now: NOW, halfLifeDays: 1 }), old = buildCalibration(at(60), { now: NOW, halfLifeDays: 1 });
  assert.deepEqual([old.cells.all.p50_usd, old.cells.all.p80_usd], [young.cells.all.p50_usd, young.cells.all.p80_usd]);
  assert.deepEqual([young.cells.all.p50_usd, young.cells.all.p80_usd], [3, 4]);
  const ancient = buildCalibration(at(5000), { now: NOW, halfLifeDays: 1 });
  assert.equal(ancient.cells.all.p50_usd, 3, 'no underflow to zero weights');
});

// Astra round 2 regressions.
test('reopened tasks count only after landing again, with the final landing as their date; an unended dispatch is excluded from cost accuracy too', async () => {
  const { collectSamples } = await import('./calibrate.mjs');
  const { buildTimelines, selectOccurrences } = await import('./timeline.mjs');
  const { resolveObservations } = await import('./events.mjs');
  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'R1' }, { ref: 'R2' }, { ref: 'U1' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const good = { usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: 2, split: 1 };
  const reopen = (ref, at) => obs(repo, { plan: 'sec/run-1', item_id: `sec/run-1/task-${ref.toLowerCase()}`, ref, event: 'reopened', at, source: 'cli', host: 'cli', source_record_id: `reopen-${ref}`, transition_id: `sec/run-1/task-${ref.toLowerCase()}/reopened/episode-1`, meta: { version: 1 } });
  for (const ref of ['R1', 'R2']) { dispatch(repo, 'sec/run-1', ref, { at: '2026-11-03T10:00:00.000Z', agent: good }); done(repo, 'sec/run-1', ref, '2026-11-03T12:00:00.000Z'); reopen(ref, '2026-11-04T09:00:00.000Z'); }
  // R2 lands again; R1 does not.
  obs(repo, { plan: 'sec/run-1', item_id: 'sec/run-1/task-r2', ref: 'R2', event: 'done', at: '2026-11-05T12:00:00.000Z', source: 'cli', host: 'cli', source_record_id: 'done-R2-2', transition_id: 'sec/run-1/task-r2/done/episode-2', meta: { version: 1 } });
  const s = collectSamples(repo, { now: NOW });
  assert.deepEqual(s.map((x) => x.ref), ['R2']); assert.equal(s[0].done_at, '2026-11-05T12:00:00.000Z'); assert.equal(s[0].returned, true);
  // U1: one finished $2 dispatch plus one that never ended → incomplete for reporting as well.
  dispatch(repo, 'sec/run-1', 'U1', { at: '2026-11-03T10:00:00.000Z', agent: good });
  obs(repo, { plan: 'sec/run-1', item_id: 'sec/run-1/task-u1', ref: 'U1', event: 'dispatched', at: '2026-11-03T10:30:00.000Z', source: 'hook', source_record_id: 'claude:s:agent-U1-b', transition_id: 'sec/run-1/task-u1/dispatched/agent-U1-b', agentId: 'agent-U1-b', meta: { stage: 'build', version: 1 } });
  done(repo, 'sec/run-1', 'U1', '2026-11-03T12:00:00.000Z');
  const res = resolveObservations(repo); const { occurrences } = selectOccurrences(res.active, res.conflicts);
  const runRec = JSON.parse(readFileSync(runPath(repo, 'sec/run-1'), 'utf8'));
  const { items } = buildTimelines({ occurrences: occurrences.filter((o) => o.plan === 'sec/run-1'), plan: runRec, end: new Date(NOW).toISOString() });
  assert.equal(items.get('sec/run-1/task-u1').cost_incomplete, true);
});

test('return rates use the same equal-weight fallback as quantiles when weights underflow', () => {
  const old = new Date(NOW - 5000 * DAY).toISOString();
  const cal = buildCalibration([...Array.from({ length: 5 }, (_, k) => sample({ ref: `O${k}`, role: 'old-role', cost_usd: 1, returned: true, done_at: old })), sample({ ref: 'F', role: 'fresh-role', cost_usd: 1 })], { now: NOW, halfLifeDays: 1 });
  assert.equal(cal.cells['role=old-role'].return_rate, 1);
  assert.equal(cal.cells['role=old-role'].by_model['claude-opus-5-5'].return_rate, 1);
});

// Astra round 3 regressions.
test('hook pricing uses each message\'s final usage, not its first streamed record', async () => {
  const { parseTranscript } = await import('../../hooks/dispatch-hook.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'dm-tr-')), p = join(dir, 'agent-x.jsonl');
  const ts = (s) => `2026-11-03T10:00:${String(s).padStart(2, '0')}.000Z`;
  const a = (s, id, out, text) => ({ type: 'assistant', timestamp: ts(s), message: { id, model: 'claude-sonnet-5-5', role: 'assistant', content: text ? [{ type: 'text', text }] : [{ type: 'tool_use', id: 't' }], usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  writeFileSync(p, [{ type: 'user', timestamp: ts(0), message: { role: 'user', content: 'go' } }, a(1, 'm1', 1), a(2, 'm1', 1000), a(3, 'm2', 5, 'done')].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const t = parseTranscript(p);
  assert.equal(t.stats.turns, 2, 'turns still count each message once');
  assert.deepEqual(t.usage['claude-sonnet-5-5'], { input: 20, output: 1005, cache_write: 0, cache_write_1h: 0, cache_read: 0 });
});

test('a reopened task needs an observed second landing; a re-cut keeps calibrated estimates even with no table on disk', async () => {
  const { collectSamples } = await import('./calibrate.mjs');
  const repo = initRepo();
  const p1 = plan(1, [{ ref: 'P1' }, { ref: 'K1' }]);
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, p1), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo, 'sec/run-1', 'P1', { at: '2026-11-03T10:00:00.000Z', agent: { usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: 2, split: 1 } });
  done(repo, 'sec/run-1', 'P1', '2026-11-03T12:00:00.000Z');
  obs(repo, { plan: 'sec/run-1', item_id: 'sec/run-1/task-p1', ref: 'P1', event: 'reopened', at: '2026-11-04T09:00:00.000Z', source: 'cli', host: 'cli', source_record_id: 'reopen-P1', transition_id: 'sec/run-1/task-p1/reopened/episode-1', meta: { version: 1 } });
  obs(repo, { plan: 'sec/run-1', item_id: 'sec/run-1/task-p1', ref: 'P1', event: 'done', at: '2026-11-05T12:00:00.000Z', basis: 'receipt-proxy', source: 'cli', host: 'cli', source_record_id: 'done-P1-2', transition_id: 'sec/run-1/task-p1/done/episode-2', meta: { version: 1 } });
  assert.deepEqual(collectSamples(repo, { now: NOW }).map((s) => s.ref), [], 'a proxy second landing is not an observed one');

  // K1 carries a calibrated estimate in v1 (as plan register would have filled it); v2 is cut with no calibration.json present.
  const est = { unit: 'usd', low: 3, high: 4, tier: 'calibrated', proposed_by: 'calibrate', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'calibrate (auto)', accepted_at: '2026-11-01T00:00:00Z', reference: { path: 'x', sha256: 'b'.repeat(64), population: 'all n=9' } };
  const repo2 = initRepo();
  assert.equal(run(repo2, ['plan', 'register', '--from', writePlan(repo2, plan(1, [{ ref: 'K1', estimate: est, effort_class: 'E2' }])), '--id', 'k1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const r2 = run(repo2, ['plan', 'register', '--from', writePlan(repo2, plan(2, [{ ref: 'K1' }]), 'v2.md'), '--id', 'k2', '--at', '2026-11-02T00:00:00Z', '--created-at', '2026-11-01T00:00:00Z']);
  assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /CALIBRATED filled=0 kept=1 .*no calibration table/);
  const k1 = JSON.parse(readFileSync(runPath(repo2, 'sec/run-1'), 'utf8')).items.find((i) => i.ref === 'K1');
  assert.deepEqual(k1.estimate, est); assert.equal(k1.effort_class, 'E2');
});

// Astra round 4 regressions.
test('sub-cent costs keep their value; a renamed task keeps its calibrated estimate; zero-token rows do not make a dispatch mixed', async () => {
  const tiny = buildCalibration(Array.from({ length: 5 }, (_, k) => sample({ ref: `t${k}`, cost_usd: 0.003 })), { now: NOW });
  assert.equal(tiny.cells.all.p50_usd, 0.003); assert.equal(tiny.cells.all.p80_usd, 0.003);
  const est = { unit: 'usd', low: 3, high: 4, tier: 'calibrated', proposed_by: 'calibrate', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'calibrate (auto)', accepted_at: '2026-11-01T00:00:00Z', reference: { path: 'x', sha256: 'b'.repeat(64), population: 'all n=9' } };
  const p = { missions: [{ tasks: [{ ref: 'NEW', item_id: 'c/r/task-new' }] }] };
  const res = fillEstimates(p, null, { now: NOW, prevItems: [{ item_id: 'c/r/task-old', estimate: est, effort_class: 'E3' }], renameMap: { 'c/r/task-old': 'c/r/task-new' } });
  assert.equal(res.kept, 1); assert.equal(p.missions[0].tasks[0].estimate, est); assert.equal(p.missions[0].tasks[0].effort_class, 'E3');

  const { collectSamples } = await import('./calibrate.mjs');
  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'S1' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo, 'sec/run-1', 'S1', { at: '2026-11-03T10:00:00.000Z', agent: { usage: { 'claude-opus-5-5': { output: 9 }, '<synthetic>': { input: 0, output: 0 } }, cost_usd: 2, split: 1 } });
  done(repo, 'sec/run-1', 'S1', '2026-11-03T12:00:00.000Z');
  assert.equal(collectSamples(repo, { now: NOW })[0].model, 'claude-opus-5-5');
});

// Astra round 5 regressions.
test('a renamed task keeps the cost recorded under its old id; unattributable cost leaves the run out; sub-cent actuals keep their value', async () => {
  const { collectSamples } = await import('./calibrate.mjs');
  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'OLD' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const priced = (c) => ({ usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: c, split: 1 });
  dispatch(repo, 'sec/run-1', 'OLD', { at: '2026-11-03T10:00:00.000Z', agent: priced(10) });
  const v2 = { ...plan(2, [{ ref: 'NEW' }]), supersedes: { run: 'sec/run-1', item_map: { 'sec/run-1/task-old': 'sec/run-1/task-new' } } };
  const r = run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'v2.md'), '--id', 'r2', '--at', '2026-11-03T11:00:00Z', '--created-at', '2026-11-01T00:00:00Z']);
  assert.equal(r.code, 0, r.stderr);
  dispatch(repo, 'sec/run-1', 'NEW', { at: '2026-11-03T12:00:00.000Z', agent: priced(2) });
  done(repo, 'sec/run-1', 'NEW', '2026-11-03T14:00:00.000Z');
  assert.deepEqual(collectSamples(repo, { now: NOW }).map((s) => [s.ref, s.cost_usd]), [['NEW', 12]]);
  // Cost under an id the run no longer knows: the run is left out instead of training on part of a task.
  dispatch(repo, 'sec/run-1', 'GONE', { at: '2026-11-03T12:00:00.000Z', agent: priced(5) });
  assert.deepEqual(collectSamples(repo, { now: NOW }), []);
  // usd accuracy rows keep sub-cent precision.
  const { computeMetrics } = await import('./metrics.mjs');
  const item = { item_id: 'x/task-a', ref: 'A', level: 'task', class: null, flags: [], estimates: [{}], estimate_original: { unit: 'usd', low: 0.002, high: 0.004, tier: 'calibrated', accepted_at: '2026-11-01T00:00:00.000Z' }, estimate_latest: null, cost_usd: 0.003, cost_incomplete: false,
    done_at: '2026-11-03T12:00:00.000Z', done_basis: 'observed', started_at: '2026-11-02T00:00:00.000Z', start_basis: 'observed', created_at: null, children: [], rework_count: 0, state: 'done' };
  const m = computeMetrics({ items: new Map([[item.item_id, item]]), plan: { observation_start: '2026-11-01T00:00:00Z' }, since: '2026-11-01T00:00:00Z', end: '2026-11-10T00:00:00Z' });
  const row = m.estimate_rows.find((x) => x.ref === 'A');
  assert.equal(row.actual_usd, 0.003); assert.equal(row.hit, true);
});

test('report: a renamed task with cost under its old id is not scored on part of its cost', () => {
  const repo = initRepo();
  const est = { unit: 'usd', low: 1, high: 3, tier: 'calibrated', proposed_by: 'calibrate', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'calibrate (auto)', accepted_at: '2026-11-01T00:00:00Z', reference: { path: 'x', sha256: 'b'.repeat(64), population: 'all n=9' } };
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'OLD', estimate: est }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const priced = (c) => ({ usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: c, split: 1 });
  dispatch(repo, 'sec/run-1', 'OLD', { at: '2026-11-03T10:00:00.000Z', agent: priced(10) });
  const v2 = { ...plan(2, [{ ref: 'NEW', estimate: est }]), supersedes: { run: 'sec/run-1', item_map: { 'sec/run-1/task-old': 'sec/run-1/task-new' } } };
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'v2.md'), '--id', 'r2', '--at', '2026-11-03T11:00:00Z', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo, 'sec/run-1', 'NEW', { at: '2026-11-03T12:00:00.000Z', agent: priced(2) });
  done(repo, 'sec/run-1', 'NEW', '2026-11-03T14:00:00.000Z');
  const rows = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (v.ref === 'NEW' && 'actual_usd' in v) rows.push(v); Object.values(v).forEach(walk); } };
  walk(JSON.parse(run(repo, ['report', '--json', '--cutoff', '2026-11-10T00:00:00Z']).stdout));
  assert.equal(rows.length, 1); assert.equal(rows[0].reason, 'missing_actual', 'the $2 visible here is not the task\'s $12');
});

test('report rename guard survives a later re-cut; an identity mapping does not withhold a complete cost', () => {
  const est = { unit: 'usd', low: 1, high: 3, tier: 'calibrated', proposed_by: 'calibrate', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'calibrate (auto)', accepted_at: '2026-11-01T00:00:00Z', reference: { path: 'x', sha256: 'b'.repeat(64), population: 'all n=9' } };
  const priced = (c) => ({ usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: c, split: 1 });
  const rowsFor = (repo, ref) => { const rows = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (v.ref === ref && 'actual_usd' in v) rows.push(v); Object.values(v).forEach(walk); } }; walk(JSON.parse(run(repo, ['report', '--json', '--cutoff', '2026-11-10T00:00:00Z']).stdout)); return rows; };

  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'OLD', estimate: est }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo, 'sec/run-1', 'OLD', { at: '2026-11-03T10:00:00.000Z', agent: priced(10) });
  const v2 = { ...plan(2, [{ ref: 'NEW', estimate: est }]), supersedes: { run: 'sec/run-1', item_map: { 'sec/run-1/task-old': 'sec/run-1/task-new' } } };
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'v2.md'), '--id', 'r2', '--at', '2026-11-03T11:00:00Z', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo, 'sec/run-1', 'NEW', { at: '2026-11-03T12:00:00.000Z', agent: priced(2) });
  done(repo, 'sec/run-1', 'NEW', '2026-11-03T14:00:00.000Z');
  // v3: an ordinary re-cut with no supersedes.
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(3, [{ ref: 'NEW', estimate: est }]), 'v3.md'), '--id', 'r3', '--at', '2026-11-04T00:00:00Z', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  assert.equal(rowsFor(repo, 'NEW')[0].reason, 'missing_actual');

  const repo2 = initRepo();
  assert.equal(run(repo2, ['plan', 'register', '--from', writePlan(repo2, plan(1, [{ ref: 'SAME', estimate: est }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const id2 = { ...plan(2, [{ ref: 'SAME', estimate: est }]), supersedes: { run: 'sec/run-1', item_map: { 'sec/run-1/task-same': 'sec/run-1/task-same' } } };
  assert.equal(run(repo2, ['plan', 'register', '--from', writePlan(repo2, id2, 'v2.md'), '--id', 'r2', '--at', '2026-11-02T00:00:00Z', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo2, 'sec/run-1', 'SAME', { at: '2026-11-03T10:00:00.000Z', agent: priced(2) });
  done(repo2, 'sec/run-1', 'SAME', '2026-11-03T12:00:00.000Z');
  const same = rowsFor(repo2, 'SAME')[0];
  assert.equal(same.reason, null); assert.equal(same.hit, true); assert.equal(same.actual_usd, 2);
});

test('report: unknown-id cost after the cutoff does not withhold earlier cost accuracy', () => {
  const est = { unit: 'usd', low: 1, high: 3, tier: 'calibrated', proposed_by: 'calibrate', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'calibrate (auto)', accepted_at: '2026-11-01T00:00:00Z', reference: { path: 'x', sha256: 'b'.repeat(64), population: 'all n=9' } };
  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'T1', estimate: est }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo, 'sec/run-1', 'T1', { at: '2026-11-02T10:00:00.000Z', agent: { usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: 2, split: 1 } });
  done(repo, 'sec/run-1', 'T1', '2026-11-02T12:00:00.000Z');
  dispatch(repo, 'sec/run-1', 'GHOST', { at: '2026-11-05T10:00:00.000Z', agent: { usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: 5, split: 1 } });
  const rowAt = (cutoff) => { const rows = []; const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (v.ref === 'T1' && 'actual_usd' in v) rows.push(v); Object.values(v).forEach(walk); } }; walk(JSON.parse(run(repo, ['report', '--json', '--cutoff', cutoff]).stdout)); return rows[0]; };
  assert.equal(rowAt('2026-11-03T00:00:00Z').reason, null);
  assert.equal(rowAt('2026-11-06T00:00:00Z').reason, 'missing_actual');
});

// PR #105 review: broken files are reported, never silently ignored; --no-calibrate stops new fills only.
test('CLI: a broken calibration.json is CALIBRATION-INVALID; a broken price override is PRICES-INVALID; --no-calibrate keeps earlier calibrated estimates', () => {
  const repo = initRepo();
  writeFileSync(join(deliveryDirOf(repo), 'calibration.json'), '<<<<<<< HEAD\n{"cells":{}}\n');
  const bad = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'T1' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']);
  assert.equal(bad.code, 2); assert.match(bad.stderr, /^CALIBRATION-INVALID\(.*not valid JSON/);
  writeFileSync(join(deliveryDirOf(repo), 'calibration.json'), '{"samples": 3}');
  assert.match(run(repo, ['plan', 'register', '--from', join(repo, 'plan.md'), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).stderr, /^CALIBRATION-INVALID\(.*no "cells" object/);
  const ok = run(repo, ['plan', 'register', '--from', join(repo, 'plan.md'), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z', '--no-calibrate']);
  assert.equal(ok.code, 0, ok.stderr);

  writeFileSync(join(deliveryDirOf(repo), 'prices.json'), '{"model": {}}');
  const pr = run(repo, ['calibrate']); assert.equal(pr.code, 2); assert.match(pr.stderr, /^PRICES-INVALID\(project override/);

  // A re-cut with --no-calibrate keeps the calibrated estimate the task was planned with.
  const est = { unit: 'usd', low: 3, high: 4, tier: 'calibrated', proposed_by: 'calibrate', proposed_at: '2026-11-01T00:00:00Z', accepted_by: 'calibrate (auto)', accepted_at: '2026-11-01T00:00:00Z', reference: { path: 'x', sha256: 'b'.repeat(64), population: 'all n=9' } };
  const repo2 = initRepo();
  assert.equal(run(repo2, ['plan', 'register', '--from', writePlan(repo2, plan(1, [{ ref: 'K1', estimate: est }])), '--id', 'k1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const r2 = run(repo2, ['plan', 'register', '--from', writePlan(repo2, plan(2, [{ ref: 'K1' }]), 'v2.md'), '--id', 'k2', '--at', '2026-11-02T00:00:00Z', '--created-at', '2026-11-01T00:00:00Z', '--no-calibrate']);
  assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /CALIBRATED filled=0 kept=1/);
  assert.deepEqual(JSON.parse(readFileSync(runPath(repo2, 'sec/run-1'), 'utf8')).items.find((i) => i.ref === 'K1').estimate, est);
});

test('a permission error is not "no file": unreadable calibration.json and price override are reported', { skip: process.getuid?.() === 0 }, () => {
  const repo = initRepo();
  const locked = join(repo, 'locked'); mkdirSync(locked); writeFileSync(join(locked, 'calibration.json'), '{"cells":{}}'); writeFileSync(join(locked, 'prices.json'), '{"models":{}}');
  const d = deliveryDirOf(repo);
  execFileSync('ln', ['-s', join(locked, 'calibration.json'), join(d, 'calibration.json')]);
  execFileSync('ln', ['-s', join(locked, 'prices.json'), join(d, 'prices.json')]);
  execFileSync('chmod', ['000', locked]);
  try {
    const reg = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'T1' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']);
    assert.equal(reg.code, 2); assert.match(reg.stderr, /^CALIBRATION-INVALID\(.*EACCES/);
    const p = loadPricesCheckedFor(repo); assert.match(p.problem, /unreadable \(EACCES\)/);
  } finally { execFileSync('chmod', ['755', locked]); }
});

// Review of the calibration loop (2026-11-13): cases where part of a task's work was priced and the rest was not.
const GOOD = { usage: { 'claude-opus-5-5': { output: 1 } }, cost_usd: 2, split: 1 };
const samplesOf = async (repo) => { const { collectSamples } = await import('./calibrate.mjs'); return Object.fromEntries(collectSamples(repo, { now: NOW }).map((s) => [s.ref, s.cost_usd])); };

test('a task whose first hooked dispatch is a review or a fix round is left out: the work it reviews was not measured', async () => {
  const repo = initRepo();
  const refs = ['BLD', 'REV', 'FIX', 'LATE', 'GATE', 'OTH'];
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, refs.map((ref) => ({ ref })))), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const t = (h) => `2026-11-03T${h}:00:00.000Z`;
  // BLD: build then review, both priced: the whole task.
  dispatch(repo, 'sec/run-1', 'BLD', { at: t('10'), id: 'BLD-b', agent: GOOD }); dispatch(repo, 'sec/run-1', 'BLD', { at: t('11'), id: 'BLD-r', agent: { ...GOOD, cost_usd: 1 }, stage: 'review' });
  // REV: only a review was hooked (the build ran in an unbound session, or outside Claude Code).
  dispatch(repo, 'sec/run-1', 'REV', { at: t('10'), agent: GOOD, stage: 'review' });
  // FIX: the first thing the hook saw was a fix round.
  dispatch(repo, 'sec/run-1', 'FIX', { at: t('10'), id: 'FIX-f', agent: GOOD, stage: 'fix' }); dispatch(repo, 'sec/run-1', 'FIX', { at: t('11'), id: 'FIX-b', agent: GOOD });
  // LATE: a build span exists, but a review came before it, so an earlier build is missing.
  dispatch(repo, 'sec/run-1', 'LATE', { at: t('11'), id: 'LATE-b', agent: GOOD }); dispatch(repo, 'sec/run-1', 'LATE', { at: t('10'), id: 'LATE-r', agent: GOOD, stage: 'review' });
  // GATE and OTH: a gate task's own work is its gate dispatch, and an unclassified brief is not evidence of a gap.
  dispatch(repo, 'sec/run-1', 'GATE', { at: t('10'), agent: GOOD, stage: 'gate' });
  dispatch(repo, 'sec/run-1', 'OTH', { at: t('10'), agent: GOOD, stage: 'other' });
  for (const ref of refs) done(repo, 'sec/run-1', ref, t('14'));
  assert.deepEqual(await samplesOf(repo), { BLD: 3, GATE: 2, OTH: 2 });
});

test('a dispatch that crossed into another task leaves both tasks out: one was charged for the other', async () => {
  const repo = initRepo();
  const refs = ['A', 'B', 'C'];
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, refs.map((ref) => ({ ref })))), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const at = '2026-11-03T10:00:00.000Z';
  // The agent briefed for A was later sent B: its whole cost sits on A, and B's own dispatch misses that share.
  dispatch(repo, 'sec/run-1', 'A', { at, agent: { ...GOOD, cost_usd: 9, crossed: ['B'] } });
  dispatch(repo, 'sec/run-1', 'B', { at, agent: GOOD });
  dispatch(repo, 'sec/run-1', 'C', { at, agent: GOOD });
  for (const ref of refs) done(repo, 'sec/run-1', ref, '2026-11-03T14:00:00.000Z');
  assert.deepEqual(await samplesOf(repo), { C: 2 });
  // A malformed marker is treated as a crossing, never as a clean dispatch.
  const repo2 = initRepo();
  assert.equal(run(repo2, ['plan', 'register', '--from', writePlan(repo2, plan(1, [{ ref: 'A' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo2, 'sec/run-1', 'A', { at, agent: { ...GOOD, crossed: 'B' } }); done(repo2, 'sec/run-1', 'A', '2026-11-03T14:00:00.000Z');
  assert.deepEqual(await samplesOf(repo2), {});
});

test('a reopen recorded before a rename still counts as a return for the renamed task', async () => {
  const { collectSamples } = await import('./calibrate.mjs');
  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'OLD' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  const old = 'sec/run-1/task-old';
  obs(repo, { item_id: old, ref: 'OLD', event: 'reopened', at: '2026-11-03T09:00:00.000Z', source: 'cli', host: 'cli', source_record_id: 'reopen-OLD', transition_id: `${old}/reopened/episode-1`, meta: { version: 1 } });
  const v2 = { ...plan(2, [{ ref: 'NEW' }]), supersedes: { run: 'sec/run-1', item_map: { [old]: 'sec/run-1/task-new' } } };
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, v2, 'v2.md'), '--id', 'r2', '--at', '2026-11-03T11:00:00Z', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  dispatch(repo, 'sec/run-1', 'NEW', { at: '2026-11-03T12:00:00.000Z', agent: GOOD });
  done(repo, 'sec/run-1', 'NEW', '2026-11-03T14:00:00.000Z');
  assert.deepEqual(collectSamples(repo, { now: NOW }).map((s) => [s.ref, s.returned]), [['NEW', true]]);
});

test('a malformed cell in calibration.json is CALIBRATION-INVALID and names the cell, on a dry run too', async () => {
  const { cellProblem } = await import('./calibrate.mjs');
  const cell = { n: 9, p50_usd: 3, p80_usd: 4, return_rate: 0.1, effort_class: null, by_model: {} };
  assert.equal(cellProblem(cell), null); assert.equal(cellProblem({ ...cell, effort_class: 'E3' }), null); assert.equal(cellProblem({ ...cell, p80_usd: 3 }), null);
  const bad = { 'no p80': { ...cell, p80_usd: undefined }, 'p80 below p50': { ...cell, p80_usd: 2 }, 'negative p50': { ...cell, p50_usd: -1 }, 'string p50': { ...cell, p50_usd: '3' },
    'NaN p50': { ...cell, p50_usd: NaN }, 'bad class': { ...cell, effort_class: 'E9' }, 'fraction n': { ...cell, n: 2.5 }, 'not an object': 7, 'an array': [] };
  for (const [why, c] of Object.entries(bad)) assert.equal(typeof cellProblem(c), 'string', why);
  const repo = initRepo(), file = writePlan(repo, plan(1, [{ ref: 'T1', role: 'python-dev' }]));
  const table = (cells) => writeFileSync(join(deliveryDirOf(repo), 'calibration.json'), JSON.stringify({ v: 1, min_n: 5, cells }));
  table({ all: cell, 'role=python-dev': { n: 9, p50_usd: 3 } });
  for (const extra of [[], ['--dry-run']]) {
    const r = run(repo, ['plan', 'register', '--from', file, '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z', ...extra]);
    assert.equal(r.code, 2, extra.join()); assert.match(r.stderr, /^CALIBRATION-INVALID\(.*cell "role=python-dev": p80_usd/, extra.join());
  }
  // The same table with the cell repaired registers and fills.
  table({ all: cell, 'role=python-dev': cell });
  assert.match(run(repo, ['plan', 'register', '--from', file, '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).stdout, /CALIBRATED filled=1/);
});

test('a price override with an incomplete model entry is a problem, not a silent NaN cost', () => {
  const repo = initRepo();
  const full = { input: 1, output: 2, cache_write: 3, cache_read: 4 };
  const write = (models) => writeFileSync(join(deliveryDirOf(repo), 'prices.json'), JSON.stringify({ models }));
  write({ 'my-model': full, 'x#fast': { ...full, cache_write_1h: 9 } });
  assert.equal(loadPricesCheckedFor(repo).problem, null);
  for (const [why, entry] of Object.entries({ 'missing cache_read': { input: 1, output: 2, cache_write: 3 }, 'one field of a built-in': { output: 99 }, 'negative': { ...full, input: -1 }, 'string': { ...full, output: '2' }, 'bad 1h rate': { ...full, cache_write_1h: null }, 'not an object': 5 })) {
    write({ 'my-model': full, 'claude-opus-5-5': entry });
    const got = loadPricesCheckedFor(repo);
    assert.match(got.problem ?? '', /model "claude-opus-5-5"/, why);
    assert.equal(got.prices['claude-opus-5-5'].input, 4, `${why}: the broken override is not applied`);
    const c = run(repo, ['calibrate']); assert.equal(c.code, 2, why); assert.match(c.stderr, /^PRICES-INVALID\(project override .*model "claude-opus-5-5"/, why);
  }
});

test('priceFor: a table\'s own "<model>#fast" entry wins over doubling; inherited object keys are not models', () => {
  const rate = (n) => ({ input: n, output: n, cache_write: n, cache_read: n });
  const P = { x: rate(1), 'x#fast': rate(9), y: rate(1) };
  assert.equal(priceFor(P, 'x#fast').input, 9); assert.equal(priceFor(P, 'y#fast').input, 2);
  for (const id of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(priceFor(P, id), null, id);
    assert.deepEqual(costOf({ [id]: { input: 10 } }, P), { cost_usd: 0, unpriced: [id] }, id);
  }
});

const usdItem = (o) => ({ item_id: `x/task-${o.ref.toLowerCase()}`, level: 'task', class: null, flags: [], estimates: [{}], estimate_latest: null, cost_usd: 3, cost_incomplete: false, hook_spans: [],
  estimate_original: { unit: 'usd', low: 2, high: 4, tier: 'calibrated', accepted_at: '2026-11-02T06:00:00.000Z' },
  done_at: '2026-11-03T12:00:00.000Z', done_basis: 'observed', started_at: null, start_basis: null, first_commit_at: null, created_at: null, children: [], rework_count: 0, state: 'done', ...o });
const metricsOf = async (items, opts = {}) => { const { computeMetrics } = await import('./metrics.mjs');
  return computeMetrics({ items: new Map(items.map((i) => [i.item_id, i])), plan: { observation_start: '2026-11-01T00:00:00Z' }, since: '2026-11-01T00:00:00Z', end: '2026-11-10T00:00:00Z', ...opts }); };

test('a dollar estimate accepted after the work began is late even when no dispatch gave the task a measured start', async () => {
  const span = (from) => [{ from, to: '2026-11-02T03:00:00.000Z', agent: 'a', stage: 'other' }];
  const m = await metricsOf([
    usdItem({ ref: 'SPAN', hook_spans: span('2026-11-02T02:00:00.000Z') }),                 // hooked work began 4h before acceptance
    usdItem({ ref: 'COMMIT', first_commit_at: '2026-11-02T05:00:00.000Z' }),                // a commit landed before acceptance
    usdItem({ ref: 'TIMELY', hook_spans: span('2026-11-02T07:00:00.000Z') }),               // accepted first: a forecast
    usdItem({ ref: 'NOEVID' }),                                                             // nothing witnessed before the landing
    usdItem({ ref: 'START', started_at: '2026-11-02T08:00:00.000Z', start_basis: 'observed', hook_spans: span('2026-11-02T01:00:00.000Z') }), // a measured start decides
  ]);
  const reason = Object.fromEntries(m.estimate_rows.map((r) => [r.ref, r.reason]));
  assert.deepEqual(reason, { SPAN: 'late_accepted', COMMIT: 'late_accepted', TIMELY: null, NOEVID: null, START: null });
});

test('a dollar estimate that cannot be scored stays in the dollar strata, not the hours ones', async () => {
  const proposed = { unit: 'usd', low: 2, high: 4, tier: 'rough' };
  const items = [
    usdItem({ ref: 'UNACC', estimates: [{ estimate: proposed, status: 'unaccepted' }], estimate_original: null }),
    usdItem({ ref: 'SCORED', started_at: '2026-11-02T08:00:00.000Z', start_basis: 'observed' }),
  ];
  const m = await metricsOf(items);
  const strata = m.estimates.task.strata;
  assert.deepEqual(Object.keys(strata).filter((k) => !k.startsWith('usd:')), [], 'no hours stratum is created by dollar estimates');
  assert.equal(strata['usd:all'].n, 2); assert.equal(strata['usd:all'].eligible, 1); assert.equal(strata['usd:all'].excluded.unaccepted, 1);
  assert.equal(strata['usd:tier:rough'].excluded.unaccepted, 1);
  const row = m.estimate_rows.find((r) => r.ref === 'UNACC');
  assert.equal(row.reason, 'unaccepted'); assert.equal(row.estimate, null); assert.equal(row.actual_usd, 3); assert.ok('effort_class' in row, 'a dollar-shaped row');
  // --estimate-base latest with no accepted estimate before the start.
  const latest = await metricsOf([usdItem({ ref: 'NOLATEST', started_at: '2026-11-02T01:00:00.000Z', start_basis: 'observed' })], { estimateBase: 'latest' });
  assert.equal(latest.estimates.task.strata['usd:all'].excluded.no_eligible_latest, 1); assert.equal(latest.estimates.task.strata.all, undefined);
  assert.equal(latest.estimate_rows[0].reason, 'no_eligible_latest');
  // Hours estimates are untouched: an unaccepted hours estimate is still counted in `all`.
  const hours = await metricsOf([usdItem({ ref: 'HRS', estimates: [{ estimate: { unit: 'h', low: 1, high: 2, tier: 'rough' }, status: 'unaccepted' }], estimate_original: null })]);
  assert.equal(hours.estimates.task.strata.all.excluded.unaccepted, 1); assert.equal(hours.estimates.task.strata['usd:all'], undefined);
});

test('identity: a dispatch found to have crossed into another task is a new fact; records without the marker keep their key', async () => {
  const { factKey } = await import('./events.mjs');
  const rec = (agent) => makeObservation({ user: null, host: 'claude', plan: 'sec/run-1', level: 'task', basis: 'observed', item_id: 'sec/run-1/task-t1', ref: 'T1', event: 'dispatch_ended', at: '2026-11-03T10:10:00.000Z', source: 'hook', source_record_id: 'claude:s:a1', transition_id: 'sec/run-1/task-t1/dispatch_ended/a1', agentId: 'a1', meta: { stage: 'build', version: 1, agent: { turns: 1, cost_usd: 1, split: 1, ...agent } } }, { now: NOW });
  assert.notEqual(factKey(rec({})), factKey(rec({ crossed: ['T2'] })), 'same cost, now known to cover a second task');
  assert.notEqual(factKey(rec({ crossed: ['T2'] })), factKey(rec({ crossed: ['T2', 'T3'] })));
  // A ledger written before the marker existed must compare equal to the same dispatch seen again.
  assert.ok(!JSON.stringify(JSON.parse(factKey(rec({}))).facts.effort).includes('crossed'));
  const repo = initRepo();
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'T1' }])), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  assert.equal(appendObservation(repo, rec({}), { now: NOW }).result, 'EVENT');
  assert.equal(appendObservation(repo, rec({ crossed: ['T2'] }), { now: NOW }).result, 'ID-CONFLICT', 'so the hook revises the record');
});
