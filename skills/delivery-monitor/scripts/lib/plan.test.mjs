import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPlanBlock, validatePlan, validateIds, runIdOf, assignIds, toCatalogue, canonicalHash, saveRun, loadRun, listRuns, mergeCatalogue, estimateChange, estimateStatus, planDelta, registrationObservations, validateSupersedes } from './plan.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-plan-'));
const EST = { unit: 'h', low: 1, high: 3, tier: 'budgetary', proposed_by: 'tech-lead', proposed_at: '2026-09-16T08:00:00Z', accepted_by: 'Daniel', accepted_at: '2026-09-16T08:30:00Z' };
const PLAN = () => ({
  campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development',
  observation_start: '2026-09-16T08:00:00Z', source_epoch: { from: '2026-09-16T08:00:00Z', until: null, integration_ref: 'main' },
  campaign: { ref: 'sec', estimate: { ...EST, low: 100, high: 200 } }, mission_kind: 'group',
  missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001', story: 'US-001', class: 'S', role: 'js-dev', branch: 'task/task-001', estimate: EST }, { ref: 'TASK-002', class: 'M' }] }],
});
const MD = '# plan\n\n```json delivery-plan\n' + JSON.stringify(PLAN()) + '\n```\n';

test('extractPlanBlock reads the fenced block or bare JSON', () => {
  assert.equal(extractPlanBlock(MD).campaign_id, 'sec');
  assert.equal(extractPlanBlock(JSON.stringify(PLAN())).run_id, 'run-1');
  assert.equal(extractPlanBlock('# nothing here'), null);
});

test('validatePlan / validateIds: duplicates, bad fields, explicit id collisions, injective supersedes', () => {
  assert.deepEqual(validatePlan(PLAN()), []);
  const p = PLAN(); p.missions[0].tasks.push({ ref: 'TASK-001' }); p.version = 0; p.factory = 'ops';
  const errs = validatePlan(p);
  assert.ok(errs.some((e) => /duplicate ref TASK-001/.test(e))); assert.ok(errs.some((e) => /version/.test(e))); assert.ok(errs.some((e) => /factory/.test(e)));
  const q = PLAN(); q.missions[0].tasks[1].item_id = 'sec/run-1/task-task-001';
  assert.ok(validateIds(assignIds(q)).some((e) => /duplicate item_id/.test(e)));
  const s = PLAN(); s.supersedes = { run: 'sec/run-1', item_map: { a: 'x', b: 'x' } };
  assert.ok(validatePlan(s).some((e) => /injective/.test(e)));
  const g = PLAN(); g.missions[0].tasks[0].ref = 'TASK-00 1'; g.missions[0].tasks[1].ref = 'TASK-00-1';
  assert.ok(validateIds(assignIds(g)).some((e) => /duplicate item_id/.test(e)), 'distinct refs that slug to the same id are rejected');
});

// F20: validatePlan must return errors, never throw, on malformed array/object shapes.
test('validatePlan does not throw on malformed shapes (F20)', () => {
  for (const bad of [{ ...PLAN(), missions: {} }, { ...PLAN(), missions: [{ ...PLAN().missions[0], tasks: 'x' }] }, { ...PLAN(), campaign: null }]) {
    let errs;
    assert.doesNotThrow(() => { errs = validatePlan(bad); }, `must not throw on ${JSON.stringify(Object.keys(bad))}`);
    assert.ok(Array.isArray(errs) && errs.length > 0, 'malformed shape must yield at least one error');
  }
  assert.deepEqual(validatePlan(null), ['plan: not an object']);
  assert.deepEqual(validatePlan('nope'), ['plan: not an object']);
});

test('assignIds + toCatalogue: run-scoped stable ids, parent links, version_added', () => {
  const p = assignIds(PLAN());
  assert.equal(runIdOf(p), 'sec/run-1');
  const cat = toCatalogue(p, { version: 1 });
  assert.deepEqual(cat.map((i) => [i.item_id, i.level, i.parent_item_id]), [
    ['sec/run-1/campaign', 'campaign', null], ['sec/run-1/mission-g1', 'mission', 'sec/run-1/campaign'],
    ['sec/run-1/task-task-001', 'task', 'sec/run-1/mission-g1'], ['sec/run-1/task-task-002', 'task', 'sec/run-1/mission-g1']]);
  assert.equal(cat[2].branch, 'task/task-001'); assert.equal(cat[1].sequence, 1); assert.equal(cat[3].version_added, 1); assert.equal(cat[3].cancelled, false);
  assert.equal(canonicalHash(PLAN()), canonicalHash({ ...PLAN(), campaign_id: 'sec' }));
  assert.deepEqual(validateIds(p), []);
});

test('validateIds flags an explicit parent_item_id that does not exist', () => {
  const p = assignIds(PLAN());
  p.missions[0].tasks[0].parent_item_id = 'sec/run-1/mission-nope';
  assert.ok(validateIds(p).some((e) => /parent_item_id/.test(e)));
  p.missions[0].tasks[0].parent_item_id = p.missions[0].item_id;
  assert.deepEqual(validateIds(p), []);
});

test('save/load/list runs; mergeCatalogue keeps history and version_added', () => {
  const repo = tmp();
  const items = toCatalogue(assignIds(PLAN()), { version: 1 });
  saveRun(repo, { run: 'sec/run-1', campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', items });
  assert.equal(loadRun(repo, 'sec/run-1').items.length, 4); assert.equal(listRuns(repo).length, 1); assert.equal(loadRun(repo, 'nope/x'), null);
  const next = toCatalogue(assignIds({ ...PLAN(), version: 2, missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001' }, { ref: 'TASK-003' }] }] }), { version: 2 });
  const merged = mergeCatalogue(items, next, {});
  assert.deepEqual(merged.map((i) => [i.ref, i.cancelled, i.version_added]), [['sec', false, 1], ['G1', false, 1], ['TASK-001', false, 1], ['TASK-003', false, 2], ['TASK-002', true, 1]]);
  assert.equal(mergeCatalogue(items, next, { keepMissing: true }).find((i) => i.ref === 'TASK-002').cancelled, false);
});

// F10/F16: supersedes — pure validation against a predecessor's saved catalogue, plus mergeCatalogue's
// renameMap carrying history (version_added) forward under an identity-renamed id.
test('validateSupersedes: run equality, key/value existence, injectivity, identity-only mappings (F10/F16)', () => {
  const prevPlan = assignIds(PLAN());
  const prevItems = toCatalogue(prevPlan, { version: 1 });
  const prevRun = 'sec/run-1';
  const oldTaskId = prevPlan.missions[0].tasks[1].item_id; // sec/run-1/task-task-002

  // A new run ('sec/run-2') where TASK-002 is renamed to TASK-002-RENAMED but keeps its explicit,
  // stable item_id carried over from the predecessor (M1's only supported continuity: an identity
  // carry of the same conceptual item across a run boundary).
  const nextPlan = assignIds({
    ...PLAN(), run_id: 'run-2', version: 1,
    missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-002-RENAMED', item_id: oldTaskId }, { ref: 'TASK-003' }] }],
  });

  const good = { run: prevRun, item_map: { [oldTaskId]: oldTaskId } };
  assert.deepEqual(validateSupersedes({ ...nextPlan, supersedes: good }, prevItems), []);

  // Wrong predecessor run.
  const wrongRun = { run: 'sec/run-0', item_map: { [oldTaskId]: oldTaskId } };
  assert.ok(validateSupersedes({ ...nextPlan, supersedes: wrongRun }, prevItems).some((e) => /run/.test(e)));

  // Unknown key (not in predecessor) / unknown value (not in this plan).
  const badKey = { run: prevRun, item_map: { 'sec/run-1/task-ghost': oldTaskId } };
  assert.ok(validateSupersedes({ ...nextPlan, supersedes: badKey }, prevItems).some((e) => /unknown predecessor item/.test(e)));
  const badVal = { run: prevRun, item_map: { [oldTaskId]: 'sec/run-2/task-ghost' } };
  assert.ok(validateSupersedes({ ...nextPlan, supersedes: badVal }, prevItems).some((e) => /unknown item .* in this plan/.test(e)));

  // Non-injective map.
  const other = prevPlan.missions[0].item_id;
  const nonInjective = { run: prevRun, item_map: { [oldTaskId]: oldTaskId, [other]: oldTaskId } };
  assert.ok(validateSupersedes({ ...nextPlan, supersedes: nonInjective }, prevItems).some((e) => /injective/.test(e)));

  // Non-identity mapping whose new id already existed as a distinct predecessor item: mapping
  // TASK-002's old id to the predecessor's own campaign id (forced, via explicit override, to also
  // be present in this plan) is a merge/collision, not a rename.
  const campaignId = prevPlan.campaign.item_id;
  const nextWithBoth = assignIds({
    ...PLAN(), run_id: 'run-2', version: 1,
    missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-002', item_id: oldTaskId }, { ref: 'TASK-EXTRA', item_id: campaignId }] }],
  });
  const nonIdentity = { run: prevRun, item_map: { [oldTaskId]: campaignId } };
  const errs = validateSupersedes({ ...nextWithBoth, supersedes: nonIdentity }, prevItems);
  assert.ok(errs.some((e) => /non-identity/.test(e)));
});

test('mergeCatalogue renameMap carries version_added under an identity-renamed item_id (F16)', () => {
  const prevPlan = assignIds(PLAN());
  const prevItems = toCatalogue(prevPlan, { version: 1 });
  const oldTaskId = prevPlan.missions[0].tasks[1].item_id;
  const nextPlan = assignIds({
    ...PLAN(), run_id: 'run-2', version: 1,
    missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-002-RENAMED', item_id: oldTaskId }] }],
  });
  const nextItems = toCatalogue(nextPlan, { version: 1 });
  const merged = mergeCatalogue(prevItems, nextItems, { renameMap: { [oldTaskId]: oldTaskId } });
  const renamed = merged.find((i) => i.item_id === oldTaskId);
  assert.equal(renamed.ref, 'TASK-002-RENAMED');
  assert.equal(renamed.version_added, 1);
  assert.equal(renamed.cancelled, false);
});

test('estimateChange / estimateStatus: a changed range needs a NEW acceptance pair', () => {
  assert.equal(estimateChange(null, EST), 'new'); assert.equal(estimateChange(EST, EST), 'none');
  assert.equal(estimateChange(EST, { ...EST, high: 5 }), 'changed-stale-acceptance');
  assert.equal(estimateChange(EST, { ...EST, high: 5, accepted_at: '2026-09-17T08:00:00Z' }), 'changed');
  assert.equal(estimateChange(EST, { ...EST, high: 5, accepted_by: null, accepted_at: null }), 'changed-stale-acceptance');
  assert.equal(estimateStatus(EST), 'accepted'); assert.equal(estimateStatus({ ...EST, accepted_at: null }), 'unaccepted');
  assert.equal(estimateStatus(EST, { stale: true }), 'unaccepted'); assert.equal(estimateStatus(undefined), 'none');
});

// F7: proposal -> human acceptance (same range) and stale -> fresh re-acceptance (same range) must
// both surface as 'accepted', not 'none' — otherwise the ledger never records the acceptance.
test('estimateChange: acceptance-only updates on an unchanged range are not silently dropped (F7)', () => {
  const proposed = { ...EST, accepted_by: null, accepted_at: null };
  assert.equal(estimateChange(proposed, EST), 'accepted', 'newly-present acceptance on the same range');
  assert.equal(estimateChange(EST, { ...EST, accepted_by: 'Someone Else', accepted_at: '2026-09-17T09:00:00Z' }), 'accepted', 'a newer acceptance on the same range');
  assert.equal(estimateChange(EST, { ...EST, accepted_at: EST.accepted_at }), 'none', 'unchanged acceptance stays none');
  assert.equal(estimateChange(EST, proposed), 'none', 'acceptance withdrawn without a range change stays none (no new fact to register)');
});

test('planDelta + registrationObservations: acceptance-only update emits an accepted estimated revision (F7)', () => {
  const prevPlan = { ...PLAN() };
  prevPlan.missions[0].tasks[0].estimate = { ...EST, accepted_by: null, accepted_at: null };
  const prev = toCatalogue(assignIds(prevPlan), { version: 1 });
  const nextPlan = { ...PLAN(), version: 2 };
  const next = toCatalogue(assignIds(nextPlan), { version: 2 }); // TASK-001 estimate now carries the accepted pair, same range
  const d = planDelta(prev, next, {});
  const est = d.estimated.find((e) => e.item.ref === 'TASK-001');
  assert.ok(est, 'acceptance-only change must still appear in the estimated delta');
  assert.equal(est.stale, false);
  const run = { run: 'sec/run-1', items: next };
  const recs = registrationObservations({ run, version: 2, delta: d, token: 'reg-acc', at: '2026-09-17T00:00:00Z', createdAtOf: () => null, now: 0 });
  const rec = recs.find((r) => r.event === 'estimated' && r.ref === 'TASK-001');
  assert.equal(rec.meta.acceptance, 'accepted');
});

test('planDelta and registrationObservations: created/estimated/cancelled/reopened with stable identities', () => {
  const prev = toCatalogue(assignIds(PLAN()), { version: 1 });
  const nextPlan = { ...PLAN(), version: 2, missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001', class: 'S', estimate: { ...EST, high: 4 } }, { ref: 'TASK-003' }] }] };
  const next = toCatalogue(assignIds(nextPlan), { version: 2 });
  const d = planDelta(prev, next, {});
  assert.deepEqual(d.created.map((i) => i.ref), ['TASK-003']);
  assert.deepEqual(d.estimated.map((e) => [e.item.ref, e.stale]), [['TASK-001', true]], 'changed range with the old pair is a stale acceptance');
  assert.deepEqual(d.cancelled.map((i) => i.ref), ['TASK-002']);
  assert.deepEqual(planDelta(prev, next, { keepMissing: true }).cancelled, []);
  const d0 = planDelta([], next, {});
  assert.equal(d0.created.length, 4); assert.equal(d0.estimated.length, 2);
  const run = { run: 'sec/run-1', items: prev };
  const recs = registrationObservations({ run, version: 1, delta: planDelta([], prev, {}), token: 'reg-1', at: '2026-09-16T09:00:00Z', createdAtOf: () => ({ at: '2026-09-15T12:00:00Z', sha: 'abc' }), now: 0 });
  const created = recs.filter((r) => r.event === 'created');
  assert.equal(created.length, 4); assert.equal(created[0].basis, 'plan-commit'); assert.equal(created[0].at, '2026-09-15T12:00:00.000Z'); assert.equal(created[0].meta.git_sha, 'abc');
  assert.equal(created[0].observation_id, 'cli:reg-1:sec%2Frun-1%2Fcampaign:created'); assert.equal(created[0].plan, 'sec/run-1'); assert.equal(created[0].meta.version, 1);
  const est = recs.find((r) => r.event === 'estimated' && r.ref === 'TASK-001');
  assert.equal(est.transition_id, 'sec/run-1/task-task-001/estimated/rev-0'); assert.equal(est.at, '2026-09-16T08:30:00.000Z'); assert.equal(est.meta.acceptance, 'accepted');
  // F2: registrationObservations never computes estimate_revision itself — Task 5 (the CLI) assigns
  // it from the count of prior `estimated` observations for the item before calling this function.
  // `d.estimated[*].item` is the same object reference as an element of `next`, so mutating it here
  // simulates that caller contract for this unit test.
  next.find((i) => i.ref === 'TASK-001').estimate_revision = 1;
  const recs2 = registrationObservations({ run: { run: 'sec/run-1', items: next }, version: 2, delta: d, token: 'reg-2', at: '2026-09-17T00:00:00Z', createdAtOf: () => null, now: 0 });
  const est2 = recs2.find((r) => r.event === 'estimated'); assert.equal(est2.meta.acceptance, 'stale-acceptance'); assert.equal(est2.transition_id, 'sec/run-1/task-task-001/estimated/rev-1');
  assert.equal(recs2.find((r) => r.event === 'created').basis, 'observed');
  assert.equal(recs2.find((r) => r.event === 'cancelled').ref, 'TASK-002');
  const same = registrationObservations({ run, version: 1, delta: planDelta([], prev, {}), token: 'reg-1', at: '2026-09-16T09:00:00Z', createdAtOf: () => ({ at: '2026-09-15T12:00:00Z', sha: 'abc' }), now: 99 });
  assert.equal(same[0].observation_id, recs[0].observation_id);
});
