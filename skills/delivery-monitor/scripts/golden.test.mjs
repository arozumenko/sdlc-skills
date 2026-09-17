import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFixtureRepo } from '../fixtures/security-testing/build-fixture-repo.mjs';

const CLI = fileURLToPath(new URL('./delivery.mjs', import.meta.url));
const DS = JSON.parse(readFileSync(new URL('../fixtures/security-testing/dataset.json', import.meta.url), 'utf8'));
const GOLDEN = fileURLToPath(new URL('../fixtures/security-testing/golden.json', import.meta.url));
const run = (repo, args) => execFileSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, DELIVERY_NO_SYNC: '1' } });
const CUTOFF = '2026-09-17T00:00:00Z';

test('golden: 59 tasks, 30 missions, 33 first completions, 11 rework proxies; cycle_time absent; re-run is a no-op', () => {
  const { repo, head, planFile } = buildFixtureRepo(DS);
  run(repo, ['plan', 'register', '--from', planFile, '--id', 'reg-1']);
  assert.match(run(repo, ['backfill', '--git', '--head', head, '--cutoff', CUTOFF]), /BACKFILL events=\d+ skipped=0 conflicts=0/);
  const doc = JSON.parse(run(repo, ['report', '--json', '--cutoff', CUTOFF]));
  const p = doc.plans[0]; const tasks = p.items.filter((i) => i.level === 'task');
  assert.equal(tasks.length, 59); assert.equal(p.items.filter((i) => i.level === 'mission').length, 30); assert.equal(tasks.filter((i) => i.state === 'done').length, 33);
  assert.equal(p.metrics.flow.task.strata.all.cycle_time, null); assert.equal(p.metrics.flow.task.strata.all.commit_to_done.n, 33); assert.equal(p.metrics.coverage.task.start_source.none, 33);
  assert.equal(p.metrics.rework_proxy_items, 11);
  // F5 (round-3 obligation): the plan brief's `.superpowers` draft expected 31 registration gaps
  // (campaign + 30 missions never getting a `created` observation). That is not what the landed
  // code does — `plan register`'s first version has no predecessor, so `planDelta` puts EVERY
  // catalogue row (campaign, all 30 missions, all 59 tasks) into `delta.created`, and
  // `registrationObservations` (plan.mjs) emits a `created` observation for every row in
  // `delta.created`, not just tasks (see plan.mjs `for (const i of delta.created) ... event:
  // 'created'`). `report.mjs`'s `registration_gaps` counts items with no `created_at` timeline
  // clock at all — after registration every one of the 90 catalogue rows has one. The correct,
  // observed number for this register-then-backfill fixture is 0.
  assert.equal(p.registration_gaps, 0, 'registration writes a created observation for every catalogue row (campaign + missions + tasks), not tasks only — 0 gaps, not 31');
  assert.ok(doc.envelope.caveats.some((c) => /no observed dispatch start/.test(c)));
  // Task-10 obligations doc's sanity-check note anticipated throughput weeks 2026-W37/2026-W38.
  // The actual fixture has since=observation_start=plan_commit_at (2026-09-16T05:43:42Z) and
  // end=cutoff (2026-09-17T00:00:00Z) — under 24h, entirely inside ISO week 2026-W38 (Mon
  // 2026-09-14 .. Sun 2026-09-20) — so `weekKeys` (metrics.mjs) legitimately emits a single
  // 2026-W38 entry, count 33. Cross-checked independently: exactly 12 of the 30 groups have every
  // task merged, matching `awaiting_landing: 12` below (mission-level landing evidence never
  // observed for a fully-merged group in this fixture).
  const golden = { tasks: 59, missions: 30, done: 33, rework_proxy_items: 11, commit_to_done: p.metrics.flow.task.strata.all.commit_to_done, lead_time: p.metrics.flow.task.strata.all.lead_time, throughput: p.metrics.throughput.task.weeks, awaiting_landing: doc.envelope.coverage.awaiting_landing };
  if (!existsSync(GOLDEN)) { writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`); assert.fail('golden.json written — re-run to compare'); }
  assert.deepEqual(golden, JSON.parse(readFileSync(GOLDEN, 'utf8')));
  assert.match(run(repo, ['backfill', '--git', '--head', head, '--cutoff', CUTOFF]), /BACKFILL events=0 skipped=\d+ conflicts=0/);
});
