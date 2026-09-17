import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendObservation, makeObservation } from './events.mjs';
import { saveRun } from './plan.mjs';
import { deliveryDir, eventsPath, plansDir, runPath, sha256 } from './paths.mjs';
import { assemble, renderMarkdown, renderHtml, renderStatus, loadProfile, escHtml, UNCONDITIONAL_CAVEATS } from './report.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'dm-report-'));
const R = 'sec/run-1';
const seed = (repo) => {
  saveRun(repo, { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-07T00:00:00Z', canonical_sha256: 'c'.repeat(64), items: [
    { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
    { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' }, { item_id: `${R}/task-b`, ref: 'TASK-B', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' }, { item_id: `${R}/task-z`, ref: 'TASK-Z', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' }] });
  const o = (id, ref, level, event, at, over = {}) => appendObservation(repo, makeObservation({ user: 'u', host: over.source === 'hook' ? 'claude' : 'cli', plan: R, item_id: `${R}/${id}`, ref, level, event, at, transition_id: `${R}/${id}/${event}/${over.t ?? 'episode-1'}`, source: over.source ?? 'cli', source_record_id: `${event}-${id}`, meta: { version: 1, ...(over.meta ?? {}) } }, { now: 0 }), { slug: 'u', now: 0 });
  o('task-a', 'TASK-A', 'task', 'created', '2026-09-07T09:00:00Z'); o('task-b', 'TASK-B', 'task', 'created', '2026-09-07T09:00:00Z');
  o('task-a', 'TASK-A', 'task', 'dispatched', '2026-09-09T09:00:00Z', { source: 'hook', t: 'agent-1' }); o('task-a', 'TASK-A', 'task', 'done', '2026-09-09T11:00:00Z');
  o('task-b', 'TASK-B', 'task', 'dispatched', '2026-09-10T09:00:00Z', { source: 'hook', t: 'agent-2' });
  // an observation for an item no run knows
  appendFileSync(eventsPath(repo, 'u'), `${JSON.stringify(makeObservation({ user: 'u', host: 'cli', plan: 'ghost/run-9', item_id: 'ghost/run-9/task-x', ref: 'X', level: 'task', event: 'done', at: '2026-09-09T00:00:00Z', transition_id: 'ghost/run-9/task-x/done/episode-1', source: 'cli', source_record_id: 'g1', meta: { version: 1 } }, { now: 0 }))}\n`);
};
const NOW = Date.parse('2026-09-21T00:00:00Z');

test('historical registration alone supplies per-item creation cohorts and lead time', async () => {
  const { execFileSync } = await import('node:child_process');
  const { main } = await import('../delivery.mjs');
  const repo = tmp();
  const g = (args, at = '2026-09-10T08:00:00Z') => execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } });
  g(['init', '-q', '-b', 'main']);
  const block = { campaign_id: 'sec', run_id: 'run-1', version: 1, factory: 'feature-development', observation_start: '2026-09-01T00:00:00Z', source_epoch: { from: '2026-09-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref: 'TASK-001' }] }] };
  const commit = (at) => { writeFileSync(join(repo, 'plan.json'), JSON.stringify(block)); g(['add', 'plan.json']); g(['commit', '-q', '-m', 'plan'], at); };
  commit('2026-09-10T08:00:00Z'); block.missions[0].tasks.push({ ref: 'TASK-002' }); commit('2026-09-12T08:00:00Z');
  const io = { write() {} }, now = Date.parse('2026-09-18T12:00:00Z');
  const call = (args) => main(args, { repo, now, stdout: io, stderr: io, env: { DELIVERY_NO_SYNC: '1' } });
  assert.equal(await call(['plan', 'register', '--from', 'plan.json', '--id', 'reg']), 0);
  for (const ref of ['TASK-001', 'TASK-002']) assert.equal(await call(['event', ref, 'done', '--id', ref, '--at', '2026-09-16T10:00:00Z']), 0);
  const d = assemble(repo, { since: '2026-09-10T00:00:00Z', cutoff: '2026-09-17T00:00:00Z', now, filters: { level: 'task' } });
  assert.equal(d.plans[0].metrics.flow.task.strata.all.lead_time.min, 98 * 3600);
  assert.equal(d.plans[0].metrics.flow.task.strata.all.lead_time.max, 146 * 3600);
  const creation = assemble(repo, { since: '2026-09-10T00:00:00Z', cutoff: '2026-09-11T00:00:00Z', now, filters: { level: 'task' } });
  assert.equal(creation.plans[0].metrics.cohorts.created, 1);
});

test('assemble: window defaults normalised, read-once provenance, coverage counts (unregistered, registration gaps), unconditional caveats', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  const e = doc.envelope;
  assert.equal(e.window.since, '2026-09-07T00:00:00.000Z'); assert.equal(e.window.effective_end, '2026-09-21T00:00:00.000Z');
  assert.equal(e.sources.events_files.length, 1); assert.match(e.sources.events_files[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(e.sources.plans[0].file_sha256, /^[0-9a-f]{64}$/); assert.equal(e.sources.plans[0].canonical_sha256, 'c'.repeat(64)); assert.equal(e.sources.profile.source, 'template-default');
  assert.equal(e.schema.ledger, 2); assert.equal(e.policy.durations, 'seconds; hours rounded at render');
  assert.equal(e.coverage.unregistered, 1); assert.equal(e.coverage.registration_gaps, 3, 'campaign, G1, TASK-Z have no created');
  for (const c of UNCONDITIONAL_CAVEATS) assert.ok(e.caveats.includes(c), c);
  const m = doc.plans[0].metrics;
  assert.deepEqual(m.flow.task.strata.all.cycle_time.samples, [7200]); assert.equal(m.wip.task, 1);
  assert.equal(doc.plans[0].items.find((i) => i.ref === 'TASK-B').state, 'in_progress');
  assert.throws(() => assemble(repo, { now: NOW, since: '2026-09-22T00:00:00Z' }), (x) => x.code === 'USAGE');
  assert.throws(() => assemble(repo, { now: NOW, plans: ['nope/x'] }), (x) => x.code === 'NO-PLAN');
  assert.throws(() => assemble(repo, { now: Date.parse('2026-09-01T00:00:00Z'), until: '2026-09-02T00:00:00Z', since: '2026-08-01T00:00:00Z' }), (x) => x.code === 'NO-EVENTS', 'no observations before the effective end');
  assert.equal(assemble(repo, { now: NOW, since: '2026-09-15T00:00:00Z' }).plans[0].metrics.cohorts.completed, 0, 'events exist but none in the window → measurable zero');
});

test('renderMarkdown: sections, n beside figures, strata, per-item estimate rows, em-dash reasons, no byPerson/mean headline', () => {
  const repo = tmp(); seed(repo);
  const md = renderMarkdown(assemble(repo, { now: NOW }));
  for (const h of ['## Flow Time', '## Throughput', '## Quality', '## Estimates', '## Coverage & caveats', '## Open items']) assert.ok(md.includes(h), h);
  assert.match(md, /cycle_time \| all \| n=1 \| — \(n<5\)/); assert.match(md, /cycle_time \| S \| n=1/);
  assert.match(md, /velocity[^\n]*— \(2 whole weeks < 3\)/); assert.match(md, /quality: reviewed=unknown eligible=unknown done=1/);
  assert.match(md, /registration_gaps=3/); assert.match(md, /unregistered=1/);
  assert.ok(!/byPerson/i.test(md)); assert.ok(!/^\|\s*mean/m.test(md)); assert.match(md, /no baseline/); assert.match(md, /acceptance: unauthenticated/);
});

test('review fix: lead_time carries its "plan-tracked, not idea-to-done" label beside every Markdown row and in the JSON envelope policy', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  assert.equal(doc.envelope.policy.labels.lead_time, 'plan-tracked, not idea-to-done');
  assert.equal(doc.envelope.policy.labels.time_to_merge, 'PR open to merge — not lead time, not cycle time');
  const md = renderMarkdown(doc);
  const leadTimeRows = md.split('\n').filter((l) => /\blead_time\b/.test(l));
  assert.ok(leadTimeRows.length > 0, 'seed fixture has at least one lead_time row');
  for (const row of leadTimeRows) assert.match(row, /\(plan-tracked, not idea-to-done\)/, row);
});

test('renderStatus: one-screen counts and open ages (255 h); loadProfile merges template', () => {
  const repo = tmp(); seed(repo);
  const s = renderStatus(assemble(repo, { now: NOW }));
  assert.match(s, /STATUS sec\/run-1 v1/); assert.match(s, /task: done=1 in_progress=1 planned=1 cancelled=0/); assert.match(s, /TASK-B[^\n]*age=255h/);
  assert.equal(loadProfile(repo).profile.minWholeWeeks, 3);
  // Minor (f): the derived, count-bearing caveats (not just the unconditional ones) are printed too.
  assert.match(s, /caveat: acceptance: unauthenticated/, 'unconditional caveats still present');
  assert.match(s, /caveat: 1 observation\(s\) for unregistered items — excluded/, 'derived caveat now printed by status');
});

// --- Round-3 review obligations (F15, F17, F18, F19, F20) -----------------------------------

test('F15: cancelled_share uses the creation cohort (metrics.cohorts.created), not the whole catalogue, and respects --class; same numerator/denominator in Markdown and JSON', () => {
  const repo = tmp();
  saveRun(repo, { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-01T00:00:00Z', canonical_sha256: 'c'.repeat(64), items: [
    { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
    // OLD: created and cancelled entirely BEFORE the window — must never move the window's cancelled_share.
    { item_id: `${R}/task-old`, ref: 'TASK-OLD', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' },
    // IN-WINDOW S class: one created+cancelled in window, one created+done in window.
    { item_id: `${R}/task-s1`, ref: 'TASK-S1', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' },
    { item_id: `${R}/task-s2`, ref: 'TASK-S2', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' },
    // IN-WINDOW M class: created and cancelled in window — must not leak into an S-class filter.
    { item_id: `${R}/task-m1`, ref: 'TASK-M1', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' },
  ] });
  const o = (id, ref, event, at) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: `${R}/${id}`, ref, level: 'task', event, at, transition_id: `${R}/${id}/${event}/episode-1`, source: 'cli', source_record_id: `${event}-${id}`, meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });
  o('task-old', 'TASK-OLD', 'created', '2026-09-01T00:00:00Z'); o('task-old', 'TASK-OLD', 'cancelled', '2026-09-01T01:00:00Z');
  o('task-s1', 'TASK-S1', 'created', '2026-09-10T00:00:00Z'); o('task-s1', 'TASK-S1', 'cancelled', '2026-09-10T01:00:00Z');
  o('task-s2', 'TASK-S2', 'created', '2026-09-10T00:00:00Z'); o('task-s2', 'TASK-S2', 'done', '2026-09-10T02:00:00Z');
  o('task-m1', 'TASK-M1', 'created', '2026-09-10T00:00:00Z'); o('task-m1', 'TASK-M1', 'cancelled', '2026-09-10T01:00:00Z');

  const win = { since: '2026-09-05T00:00:00Z', cutoff: '2026-09-15T00:00:00Z', now: NOW };
  const unfiltered = assemble(repo, win).plans[0].metrics;
  // Whole-catalogue-wrong answer would be 3/5 (TASK-OLD + TASK-S1 + TASK-M1 cancelled of 5 total).
  // Creation-cohort-correct answer is 2/3 (TASK-S1 + TASK-M1 of the 3 created inside the window).
  assert.equal(unfiltered.cohorts.created, 3);
  assert.equal(unfiltered.quality.cancelled_share.denominator, unfiltered.cohorts.created);
  assert.equal(unfiltered.quality.cancelled_share.numerator, 2);
  assert.equal(unfiltered.quality.cancelled_share.ratio, 0.6667);

  const filtered = assemble(repo, { ...win, filters: { class: 'S' } }).plans[0].metrics;
  assert.equal(filtered.cohorts.created, 2, 'class filter narrows the creation cohort to S');
  assert.equal(filtered.quality.cancelled_share.denominator, 2);
  assert.equal(filtered.quality.cancelled_share.numerator, 1, 'only TASK-S1 is S-class and cancelled');
  assert.equal(filtered.quality.cancelled_share.ratio, 0.5);

  const md = renderMarkdown(assemble(repo, { ...win, filters: { class: 'S' } }));
  assert.match(md, /cancelled_share: 1\/2 \(50%\)/);
});

test('F17: every stratum renders (flow strata.<class>, estimates strata.<class>/tier:*/class|tier), per-stratum quality denominators, coverage.sources + done_basis', () => {
  const repo = tmp();
  const EST = (low, high) => ({ unit: 'h', low, high, tier: 'budgetary', proposed_by: 'lead', proposed_at: '2026-09-09T00:00:00Z', accepted_by: 'lead', accepted_at: '2026-09-09T00:00:00Z' });
  saveRun(repo, { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-01T00:00:00Z', canonical_sha256: 'c'.repeat(64), items: [
    { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
    { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S', estimate: EST(1, 2) },
    { item_id: `${R}/task-b`, ref: 'TASK-B', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M', estimate: EST(2, 4) },
  ] });
  const o = (id, ref, event, at, meta = {}) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: `${R}/${id}`, ref, level: 'task', event, at, transition_id: `${R}/${id}/${event}/episode-1`, source: 'cli', source_record_id: `${event}-${id}`, meta: { version: 1, ...meta } }, { now: 0 }), { slug: 'u', now: 0 });
  const est = (id, ref, e) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: `${R}/${id}`, ref, level: 'task', event: 'estimated', at: '2026-09-09T00:00:00Z', transition_id: `${R}/${id}/estimated/rev-0`, source: 'cli', source_record_id: `est-${id}`, estimate: e, meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });
  o('task-a', 'TASK-A', 'created', '2026-09-09T00:00:00Z'); o('task-b', 'TASK-B', 'created', '2026-09-09T00:00:00Z');
  est('task-a', 'TASK-A', EST(1, 2)); est('task-b', 'TASK-B', EST(2, 4));
  o('task-a', 'TASK-A', 'dispatched', '2026-09-10T00:00:00Z'); o('task-a', 'TASK-A', 'done', '2026-09-10T02:00:00Z');
  o('task-b', 'TASK-B', 'dispatched', '2026-09-11T00:00:00Z'); o('task-b', 'TASK-B', 'done', '2026-09-11T03:00:00Z');

  const doc = assemble(repo, { now: NOW });
  const m = doc.plans[0].metrics;
  const flowKeys = Object.keys(m.flow.task.strata);
  assert.deepEqual(flowKeys.sort(), ['S', 'M', 'all'].sort(), 'flow strata: all + every class present');
  for (const st of flowKeys) assert.ok('quality' in m.flow.task.strata[st] && typeof m.flow.task.strata[st].quality.done === 'number', `${st} carries a quality denominator`);

  const estKeys = Object.keys(m.estimates.task.strata);
  for (const k of ['all', 'S', 'M', 'tier:budgetary', 'S|budgetary', 'M|budgetary']) assert.ok(estKeys.includes(k), `estimates strata missing ${k}`);

  assert.ok('sources' in m.coverage.task); assert.ok('done_basis' in m.coverage.task);
  assert.equal(m.coverage.task.done_basis.observed, 2);

  const md = renderMarkdown(doc);
  for (const st of flowKeys) assert.match(md, new RegExp(`task quality \\| ${st} \\| quality: reviewed=unknown eligible=unknown done=\\d+`));
  for (const k of ['all', 'S', 'M', 'tier:budgetary', 'S\\|budgetary', 'M\\|budgetary']) assert.match(md, new RegExp(`\\| task \\| ${k} \\|`), `estimates row missing ${k}`);
  assert.match(md, /done_basis observed=2 derived-child=0 proxy=0/);
  assert.match(md, /sources \{/);
});

test('F18: run/profile hashes describe the bytes actually read (single read); compact items carry evidence {created, started, done} = occurrence provenance {path, line, observation_id}', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  const e = doc.envelope;
  // The bytes on disk right now hash to the same value the envelope reports — proving the hash
  // describes the file as read, not a re-read of a possibly-different later state.
  const onDisk = sha256(readFileSync(runPath(repo, R)));
  assert.equal(e.sources.plans[0].file_sha256, onDisk);

  const a = doc.plans[0].items.find((i) => i.ref === 'TASK-A');
  assert.ok(a.evidence.created, 'created evidence present'); assert.match(a.evidence.created.observation_id, /created-task-a/);
  assert.equal(typeof a.evidence.created.line, 'number');
  assert.ok(a.evidence.started, 'started evidence present (observed dispatch)'); assert.match(a.evidence.started.observation_id, /dispatched-task-a/);
  assert.ok(a.evidence.done, 'done evidence present'); assert.match(a.evidence.done.observation_id, /done-task-a/);
  // The mission has no explicit done occurrence (never terminal in the seed) so its done evidence is
  // honestly null rather than invented.
  const g1 = doc.plans[0].items.find((i) => i.ref === 'G1');
  assert.equal(g1.evidence.done, null);
});

test('F18 (part 2): a plan file changed after an earlier read is never re-opened for hashing — the hash always matches the bytes assemble itself just read, and the module never calls loadRun/listRuns at all', () => {
  const text = readFileSync(new URL('./report.mjs', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/plan\.mjs'/.test(text), 'report.mjs must not import anything from plan.mjs (no loadRun/listRuns) — it reads run files itself, once, for both parsing and hashing');

  const repo = tmp(); seed(repo);
  const first = assemble(repo, { now: NOW }).envelope.sources.plans[0].file_sha256;
  // Mutate the run file on disk (simulating another writer) between two assemble() calls.
  const rec = JSON.parse(readFileSync(runPath(repo, R), 'utf8')); rec.status = 'closed';
  writeFileSync(runPath(repo, R), `${JSON.stringify(rec, null, 2)}\n`);
  const second = assemble(repo, { now: NOW }).envelope.sources.plans[0].file_sha256;
  assert.notEqual(first, second, 'the hash tracks the bytes actually on disk at read time, not a stale cached value');
  assert.equal(second, sha256(readFileSync(runPath(repo, R))));
});

test('F19: hook diagnostics counted by kind; admitted-but-unattributed dispatches counted with a share; unregistered is checked against ALL registered runs even when --plan selects one', () => {
  const repo = tmp(); seed(repo);
  // A second, unselected run — an item registered only here must not be miscounted as unregistered
  // when the report selects only run-1.
  const R2 = 'sec/run-2';
  saveRun(repo, { run: R2, campaign_id: 'sec', run_id: 'run-2', version: 1, status: 'open', observation_start: '2026-09-07T00:00:00Z', canonical_sha256: 'd'.repeat(64), items: [
    { item_id: `${R2}/campaign`, ref: 'sec2', level: 'campaign', parent_item_id: null },
    { item_id: `${R2}/task-q`, ref: 'TASK-Q', level: 'task', parent_item_id: `${R2}/campaign`, class: 'S' },
  ] });
  appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R2, item_id: `${R2}/task-q`, ref: 'TASK-Q', level: 'task', event: 'created', at: '2026-09-08T00:00:00Z', transition_id: `${R2}/task-q/created/0`, source: 'cli', source_record_id: 'q1', meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });

  // An admitted-but-unattributed dispatch (hook couldn't resolve the item, but recorded the fact).
  appendObservation(repo, makeObservation({ user: 'u', host: 'claude', plan: R, item_id: null, ref: null, level: null, event: 'dispatched', at: '2026-09-11T00:00:00Z', transition_id: `${R}/unattributed/dispatched/episode-1`, source: 'hook', source_record_id: 'unatt-1', meta: { version: 1, unattributed: true } }, { now: 0 }), { slug: 'u', now: 0 });

  mkdirSync(deliveryDir(repo), { recursive: true });
  const diagPath = join(deliveryDir(repo), 'diagnostics-u.jsonl');
  writeFileSync(diagPath, [
    JSON.stringify({ at: '2026-09-09T00:00:00Z', kind: 'unbound-session', session: 's1', agent_id: 'a1', detail: 'no plan bound' }),
    JSON.stringify({ at: '2026-09-09T00:01:00Z', kind: 'incomplete-transcript', session: 's2', agent_id: 'a2', detail: 'truncated' }),
    JSON.stringify({ at: '2026-09-09T00:02:00Z', kind: 'incomplete-transcript', session: 's3', agent_id: 'a3', detail: 'truncated' }),
    'not json at all',
    JSON.stringify({ at: '2026-09-09T00:03:00Z', kind: 'no-such-kind', session: 's4', agent_id: 'a4', detail: 'x' }),
  ].join('\n') + '\n');

  const doc = assemble(repo, { plans: [R], now: NOW });
  const cov = doc.envelope.coverage;
  assert.equal(cov.diagnostics['unbound-session'], 1);
  assert.equal(cov.diagnostics['incomplete-transcript'], 2);
  assert.equal(cov.diagnostics.malformed, 2, 'invalid json line + unknown kind both fold into malformed');
  assert.equal(cov.diagnostics['unknown-role'], 0);

  assert.equal(cov.unattributed_dispatches, 1);
  // attributed dispatches in the ledger: TASK-A + TASK-B (from seed) = 2; unattributed = 1 → 1/3.
  assert.equal(cov.unattributed_share, 0.3333);

  // TASK-Q belongs to run-2, which is registered but NOT selected — its `created` occurrence must
  // not be counted as unregistered, and run-1's own unregistered count (the `ghost/run-9` item from
  // seed()) is unaffected by run-2 existing.
  assert.equal(cov.unregistered, 1, 'still only the ghost/run-9 observation — TASK-Q is registered (in run-2), not unregistered');
});

test('Important fix 1: unattributed_share is scoped to the selected runs and the window — a dispatch on another registered (unselected) run, and one after `end`, must not count', () => {
  const repo = tmp(); seed(repo);
  const R2 = 'sec/run-2';
  saveRun(repo, { run: R2, campaign_id: 'sec', run_id: 'run-2', version: 1, status: 'open', observation_start: '2026-09-07T00:00:00Z', canonical_sha256: 'e'.repeat(64), items: [
    { item_id: `${R2}/campaign`, ref: 'sec2', level: 'campaign', parent_item_id: null },
    { item_id: `${R2}/task-r`, ref: 'TASK-R', level: 'task', parent_item_id: `${R2}/campaign`, class: 'S' },
  ] });
  const dispatchOn = (plan, id, ref, at, meta = {}) => appendObservation(repo, makeObservation({ user: 'u', host: 'claude', plan, item_id: id, ref, level: id ? 'task' : null, event: 'dispatched', at, transition_id: `${plan}/${ref ?? 'x'}/dispatched/${at}`, source: 'hook', source_record_id: `d-${ref ?? 'x'}-${at}`, meta: { version: 1, ...meta } }, { now: 0 }), { slug: 'u', now: 0 });

  // A dispatch on run-2 — NOT selected (--plan selects only run-1) — must not count at all.
  dispatchOn(R2, `${R2}/task-r`, 'TASK-R', '2026-09-11T00:00:00Z');
  // An unattributed dispatch on run-1 but AFTER the window's effective_end (NOW = 2026-09-21) — must
  // not count either.
  dispatchOn(R, null, null, '2026-09-25T00:00:00Z', { unattributed: true });
  // An unattributed dispatch on run-1 INSIDE the window — this one must count.
  dispatchOn(R, null, null, '2026-09-11T00:00:00Z', { unattributed: true });

  const cov = assemble(repo, { plans: [R], now: NOW }).envelope.coverage;
  // In-window attributed dispatches on run-1 (from seed): TASK-A + TASK-B = 2. In-window unattributed
  // on run-1: 1. run-2's dispatch and the post-window unattributed dispatch are invisible to both the
  // numerator and the denominator — a pre-fix implementation counting the whole ledger would instead
  // report unattributed_dispatches=2 and a share of 2/5.
  assert.equal(cov.unattributed_dispatches, 1);
  assert.equal(cov.unattributed_share, 0.3333);
});

test('Important fix 2: evidence.done for a landed non-task item matches on landing_at, not done_at — a child finishing after the explicit landing must not blank the landing evidence', () => {
  const repo = tmp();
  saveRun(repo, { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-01T00:00:00Z', canonical_sha256: 'c'.repeat(64), items: [
    { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null },
    { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
    { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S' },
    { item_id: `${R}/task-b`, ref: 'TASK-B', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'M' },
  ] });
  const o = (id, ref, level, event, at, over = {}) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: id ? `${R}/${id}` : null, ref, level, event, at, transition_id: `${R}/${id ?? 'mission-g1'}/${event}/${over.t ?? 'episode-1'}`, source: 'cli', source_record_id: `${event}-${id ?? 'g1'}`, meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });
  o('task-a', 'TASK-A', 'task', 'created', '2026-09-07T09:00:00Z'); o('task-b', 'TASK-B', 'task', 'created', '2026-09-07T09:00:00Z');
  o('task-a', 'TASK-A', 'task', 'dispatched', '2026-09-08T09:00:00Z'); o('task-a', 'TASK-A', 'task', 'done', '2026-09-08T11:00:00Z');
  // Explicit mission landing BEFORE task-b's own completion — timeline.mjs will later bump the
  // mission's rolled-up done_at to task-b's later done_at, but landing_at stays pinned to this
  // occurrence's own `at`.
  o('mission-g1', 'G1', 'mission', 'done', '2026-09-09T00:00:00Z');
  o('task-b', 'TASK-B', 'task', 'dispatched', '2026-09-10T09:00:00Z'); o('task-b', 'TASK-B', 'task', 'done', '2026-09-10T11:00:00Z');

  const doc = assemble(repo, { now: NOW });
  const g1 = doc.plans[0].items.find((i) => i.ref === 'G1');
  assert.equal(g1.landing_at, '2026-09-09T00:00:00.000Z');
  assert.equal(g1.done_at, '2026-09-10T11:00:00.000Z', 'done_at rolled up to the later child completion');
  assert.notEqual(g1.done_at, g1.landing_at, 'precondition: this only proves the fix if the two clocks differ');
  assert.ok(g1.evidence.done, 'landing evidence must not be null just because a child finished later');
  assert.equal(g1.evidence.done.observation_id, 'cli:done-mission-g1:sec%2Frun-1%2Fmission-g1:done');
});

test('F20: invalid --since/--until/--cutoff and unknown --level are USAGE; --plan naming an unknown/malformed run is NO-PLAN; a malformed run file elsewhere is counted and skipped, never INTERNAL', () => {
  const repo = tmp(); seed(repo);
  assert.throws(() => assemble(repo, { now: NOW, since: 'not-a-date' }), (x) => x.code === 'USAGE');
  assert.throws(() => assemble(repo, { now: NOW, until: 'not-a-date' }), (x) => x.code === 'USAGE');
  assert.throws(() => assemble(repo, { now: NOW, cutoff: 'not-a-date' }), (x) => x.code === 'USAGE');
  assert.throws(() => assemble(repo, { now: NOW, filters: { level: 'sprint' } }), (x) => x.code === 'USAGE');
  assert.throws(() => assemble(repo, { now: NOW, plans: ['sec/run-1', 'sec/run-9'] }), (x) => x.code === 'NO-PLAN');

  // A second run file that is simply not valid JSON.
  mkdirSync(plansDir(repo), { recursive: true });
  writeFileSync(runPath(repo, 'sec/run-broken'), '{ not json');
  const doc = assemble(repo, { now: NOW });
  assert.equal(doc.envelope.coverage.malformed_runs, 1);
  assert.equal(doc.plans.length, 1, 'the malformed run is skipped, not thrown');
  assert.match(doc.envelope.caveats.join('\n'), /1 registered run file\(s\) malformed/);
  assert.throws(() => assemble(repo, { now: NOW, plans: ['sec/run-broken'] }), (x) => x.code === 'NO-PLAN', 'naming the malformed run by id is NO-PLAN, never INTERNAL');
});

test('minor (e): a run file with valid JSON but an item missing item_id is treated as malformed, not indexed with an undefined key', () => {
  const repo = tmp(); seed(repo);
  writeFileSync(runPath(repo, 'sec/run-noid'), `${JSON.stringify({ run: 'sec/run-noid', campaign_id: 'sec', run_id: 'run-noid', version: 1, status: 'open', observation_start: '2026-09-07T00:00:00Z', items: [{ ref: 'no-id-here', level: 'task', parent_item_id: null }] })}\n`);
  const doc = assemble(repo, { now: NOW });
  assert.equal(doc.envelope.coverage.malformed_runs, 1);
  assert.equal(doc.plans.length, 1, 'only sec/run-1 is usable');
  assert.throws(() => assemble(repo, { now: NOW, plans: ['sec/run-noid'] }), (x) => x.code === 'NO-PLAN');
});

// --- HTML renderer (brief: .superpowers/sdd/html-report/brief.md) --------------------------

test('renderHtml: self-contained document — no external assets, no script', () => {
  const repo = tmp(); seed(repo);
  const html = renderHtml(assemble(repo, { now: NOW }));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.match(html, /<title>Delivery report/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<link/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<img/i);
});

test('renderHtml: every section and figure of the Markdown render is present', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  const html = renderHtml(doc);
  for (const r of doc.plans[0].metrics.estimate_rows) assert.match(html, new RegExp(`>${escHtml(r.ref)}<`), r.ref);
  const leadTimePresent = Object.values(doc.plans[0].metrics.flow).some((f) => Object.values(f.strata).some((s) => s.lead_time));
  if (leadTimePresent) assert.match(html, /plan-tracked, not idea-to-done/);
  for (const heading of ['cycle_time', 'Flow time', 'Throughput', 'Estimates', 'Coverage', 'Open items', 'Envelope', 'Caveats']) assert.ok(html.includes(heading), heading);
  assert.match(html, /registration_gaps/);
});

test('renderHtml: every envelope caveat is rendered, in order', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  const html = renderHtml(doc);
  const expected = doc.envelope.caveats.map((c) => `<li>${escHtml(c)}</li>`);
  let cursor = -1;
  for (const li of expected) {
    const idx = html.indexOf(li);
    assert.ok(idx >= 0, li);
    assert.ok(idx > cursor, `${li} rendered out of order`);
    cursor = idx;
  }
});

test('renderHtml: escapes user-controlled strings', () => {
  const repo = tmp(); seed(repo);
  const doc = assemble(repo, { now: NOW });
  const mutated = JSON.parse(JSON.stringify(doc));
  const evil = '<b>TASK-9</b>&"x"';
  // TASK-B is in_progress in the seed fixture — its ref is rendered in the Open items table.
  mutated.plans[0].items.find((i) => i.ref === 'TASK-B').ref = evil;
  const html = renderHtml(mutated);
  assert.ok(!html.includes('<b>TASK-9</b>'), 'raw markup must not appear unescaped');
  assert.ok(html.includes('&lt;b&gt;TASK-9&lt;/b&gt;&amp;&quot;x&quot;'), 'escaped form must appear');
});

// Fix round 1 (task review, "important"): `estimateRowsHtml` (the per-item Estimates table) is
// never exercised by the shared `seed()` fixture — it has no estimates, so `m.estimate_rows` is
// always `[]` there. Build a dedicated fixture WITH a real, fully-eligible estimate row (pattern
// from the F17 test above: EST(low, high) + an `estimated` observation + a `done` so an actual
// exists), and check the HTML table's row matches renderMarkdown's own cells for the same doc —
// cross-checked against renderMarkdown's actual output rather than against a re-implementation of
// its private `h()` formatting, so the two can never silently disagree.
test('renderHtml: estimateRowsHtml renders a real per-item estimate row matching renderMarkdown, and escapes a malicious ref there', () => {
  const repo = tmp();
  const EST = (low, high) => ({ unit: 'h', low, high, tier: 'budgetary', proposed_by: 'lead', proposed_at: '2026-09-09T00:00:00Z', accepted_by: 'lead', accepted_at: '2026-09-09T00:00:00Z' });
  saveRun(repo, { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-01T00:00:00Z', canonical_sha256: 'c'.repeat(64), items: [
    { item_id: `${R}/campaign`, ref: 'sec', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1 },
    { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S', estimate: EST(1, 3) },
  ] });
  const o = (id, ref, event, at) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: `${R}/${id}`, ref, level: 'task', event, at, transition_id: `${R}/${id}/${event}/episode-1`, source: 'cli', source_record_id: `${event}-${id}`, meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });
  const est = (id, ref, e) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: `${R}/${id}`, ref, level: 'task', event: 'estimated', at: '2026-09-09T00:00:00Z', transition_id: `${R}/${id}/estimated/rev-0`, source: 'cli', source_record_id: `est-${id}`, estimate: e, meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });
  o('task-a', 'TASK-A', 'created', '2026-09-09T00:00:00Z');
  est('task-a', 'TASK-A', EST(1, 3));
  o('task-a', 'TASK-A', 'dispatched', '2026-09-10T00:00:00Z'); o('task-a', 'TASK-A', 'done', '2026-09-10T02:00:00Z');

  const doc = assemble(repo, { now: NOW });
  const row = doc.plans[0].metrics.estimate_rows[0];
  assert.equal(doc.plans[0].metrics.estimate_rows.length, 1, 'precondition: fixture yields exactly one real (non-excluded) estimate row');
  assert.equal(row.ref, 'TASK-A'); assert.equal(row.reason, null, 'precondition: a fully eligible row, not an excluded one — exercises every cell');

  const md = renderMarkdown(doc);
  const mdLine = md.split('\n').find((l) => l.startsWith(`| ${row.ref} | ${row.level} |`));
  assert.ok(mdLine, 'renderMarkdown per-item estimate row present');
  const [mref, mlevel, mclass, mtier, mbase, mrange, mactual, mbasis, mratio, mhit, mreason] = mdLine.split('|').slice(1, -1).map((c) => c.trim());
  assert.equal(mrange, '[1, 3]'); assert.equal(mhit, 'yes'); assert.equal(mreason, '—');

  const html = renderHtml(doc);
  const expectedHtmlRow = `<tr><td>${escHtml(mref)}</td><td>${escHtml(mlevel)}</td><td>${escHtml(mclass)}</td><td>${escHtml(mtier)}</td><td>${escHtml(mbase)}</td><td>${mrange}</td><td>${mactual}</td><td>${escHtml(mbasis)}</td><td>${mratio}</td><td>${mhit}</td><td>${escHtml(mreason)}</td></tr>`;
  assert.ok(html.includes(expectedHtmlRow), 'HTML estimate row must match renderMarkdown\'s cells for the same doc, field for field');

  // Escaping, specifically in the estimate table: mutate a copy of doc so TASK-A's ref carries
  // markup, in both `items` and the matching `estimate_rows` entry the table renders from.
  const mutated = JSON.parse(JSON.stringify(doc));
  const evil = '<b>TASK-9</b>&"x"';
  mutated.plans[0].items.find((i) => i.ref === 'TASK-A').ref = evil;
  mutated.plans[0].metrics.estimate_rows.find((r) => r.ref === 'TASK-A').ref = evil;
  const evilHtml = renderHtml(mutated);
  assert.ok(!evilHtml.includes('<b>TASK-9</b>'), 'raw markup must not appear unescaped in the estimate table');
  assert.ok(evilHtml.includes(`<tr><td>${escHtml(evil)}</td>`), 'escaped form must appear as the estimate table row\'s ref cell');
});

test('renderHtml: human sections — campaign header, KPI cards, per-task bar rows in natural units, assessor tables collapsed', () => {
  const repo = tmp();
  const EST = (low, high) => ({ unit: 'h', low, high, tier: 'budgetary', proposed_by: 'lead', proposed_at: '2026-09-09T00:00:00Z', accepted_by: 'lead', accepted_at: '2026-09-09T00:00:00Z' });
  saveRun(repo, { run: R, campaign_id: 'sec', run_id: 'run-1', version: 1, status: 'open', observation_start: '2026-09-01T00:00:00Z', canonical_sha256: 'c'.repeat(64), items: [
    { item_id: `${R}/campaign`, ref: 'sec-campaign', level: 'campaign', parent_item_id: null }, { item_id: `${R}/mission-g1`, ref: 'G1', level: 'mission', parent_item_id: `${R}/campaign`, sequence: 1, estimate: EST(2, 4) },
    { item_id: `${R}/task-a`, ref: 'TASK-A', level: 'task', parent_item_id: `${R}/mission-g1`, class: 'S', estimate: EST(1, 3) },
  ] });
  const o = (id, ref, level, event, at) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: `${R}/${id}`, ref, level, event, at, transition_id: `${R}/${id}/${event}/episode-1`, source: 'cli', source_record_id: `${event}-${id}`, meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });
  const est = (id, ref, level, e) => appendObservation(repo, makeObservation({ user: 'u', host: 'cli', plan: R, item_id: `${R}/${id}`, ref, level, event: 'estimated', at: '2026-09-09T00:00:00Z', transition_id: `${R}/${id}/estimated/rev-0`, source: 'cli', source_record_id: `est-${id}`, estimate: e, meta: { version: 1 } }, { now: 0 }), { slug: 'u', now: 0 });
  o('campaign', 'sec-campaign', 'campaign', 'created', '2026-09-09T00:00:00Z'); o('mission-g1', 'G1', 'mission', 'created', '2026-09-09T00:00:00Z'); o('task-a', 'TASK-A', 'task', 'created', '2026-09-09T00:00:00Z');
  est('mission-g1', 'G1', 'mission', EST(2, 4)); est('task-a', 'TASK-A', 'task', EST(1, 3));
  o('task-a', 'TASK-A', 'task', 'dispatched', '2026-09-10T00:00:00Z'); o('task-a', 'TASK-A', 'task', 'done', '2026-09-10T02:00:00Z'); o('mission-g1', 'G1', 'mission', 'done', '2026-09-10T02:00:00Z');
  const html = renderHtml(assemble(repo, { now: NOW }));
  // Header names the campaign, not the run id; the run id is the muted sub-line.
  assert.match(html, /<h2>sec-campaign <span class="sub">campaign sec\/run-1 · plan v1 · in progress<\/span><\/h2>/);
  // KPI cards: one bold value per stat, natural-unit durations, floors spelled out.
  for (const label of ['Tasks done', 'Missions done', 'Median', 'Range', 'Tasks this week', 'Within range', 'Typical error']) assert.ok(html.includes(`<span class="stat-label">${label}`), label);
  assert.ok(html.includes('<span class="stat-value">1 / 1</span>'), 'tasks done 1 / 1');
  assert.ok(html.includes('needs ≥5 <span class="stat-sub">(have 1)</span>'), 'median floor is explained, not a bare n<5');
  assert.ok(html.includes('2 h–2 h'), 'range in natural units');
  assert.doesNotMatch(html.split('<details>')[0], /\d\.\d\dh\b/, 'no two-decimal-hours in the human sections');
  // Per-task bar row: ref + state chip + bar + duration + estimate verdict.
  assert.match(html, /<div class="row"><div class="lbl" title="sec\/run-1\/task-a">TASK-A<span class="oc oc-done">done<\/span><\/div><div class="track"><div class="bar" style="width:100%"><\/div><\/div><div class="num">2 h<span class="sub"> · class S · mission G1 · estimate 1 h–3 h · <span class="oc oc-done">within range<\/span><\/span><\/div><\/div>/);
  // Per-mission row carries the schedule-variance verdict in words.
  assert.match(html, /G1<span class="oc oc-done">done<\/span>.*1\/1 tasks done · estimate 2 h–4 h · <span class="oc oc-done">within the estimate<\/span>/);
  // Assessor tables are still all there, but collapsed.
  const details = html.split('<details>');
  assert.ok(details.length >= 3, 'statistics + envelope are <details> blocks');
  assert.ok(details[1].includes('<h2>Flow time</h2>') && details[1].includes('<h2>Coverage</h2>'), 'assessor panels live inside the first details block');
  assert.ok(!details[0].includes('<h2>Flow time</h2>'), 'flow-time strata are not in the human part');
  assert.ok(html.includes('<strong>Caveats</strong> — standing limitations'), 'caveats stay visible with a preface');
});
