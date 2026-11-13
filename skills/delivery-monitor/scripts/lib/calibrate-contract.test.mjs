// Learning-loop contract for effort calibration (spec: docs/superpowers/specs/2026-11-13-learning-loops-design.md,
// implementation contract items 3–6): persistent off switch, cell schema check, immutable state versions, effective sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendObservation, makeObservation } from './events.mjs';
import { deliveryDir, runPath, sha256 } from './paths.mjs';
import { buildCalibration, effectiveN, lookup } from './calibrate.mjs';

const NOW = Date.parse('2026-11-12T12:00:00Z'), DAY = 86_400_000;
const CLI = fileURLToPath(new URL('../delivery.mjs', import.meta.url));
// stderr is kept on success too (WARN lines are part of the contract).
const run = (repo, args, { env = {} } = {}) => {
  const r = spawnSync('node', [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, DELIVERY_NO_SYNC: '1', CLAUDE_CODE_SESSION_ID: '', ...env } });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const initRepo = () => { const r = mkdtempSync(join(tmpdir(), 'dm-calc-')); for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@x'], ['config', 'user.name', 'Tester']]) execFileSync('git', a, { cwd: r }); return r; };
const dd = (repo) => { const d = deliveryDir(repo); mkdirSync(d, { recursive: true }); return d; };
const plan = (v, tasks, runId = 'run-1') => ({ campaign_id: 'sec', run_id: runId, version: v, factory: 'feature-development', observation_start: '2026-11-01T00:00:00Z',
  source_epoch: { from: '2026-11-01T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks }] });
const writePlan = (repo, p, name = 'plan.md') => { const f = join(repo, name); writeFileSync(f, `# p\n\`\`\`json delivery-plan\n${JSON.stringify(p)}\n\`\`\`\n`); return f; };
const obs = (repo, f) => appendObservation(repo, makeObservation({ user: null, host: 'claude', plan: 'sec/run-1', level: 'task', basis: 'observed', ...f }, { now: NOW }), { now: NOW });
function landTask(repo, runId, ref, { cost, at }) {
  const item_id = `${runId}/task-${ref.toLowerCase()}`, agent = `agent-${ref}`, base = { plan: runId, item_id, ref };
  obs(repo, { ...base, event: 'dispatched', at, source: 'hook', source_record_id: `claude:s:${agent}`, transition_id: `${item_id}/dispatched/${agent}`, agentId: agent, meta: { stage: 'build', version: 1 } });
  obs(repo, { ...base, event: 'dispatch_ended', at: new Date(Date.parse(at) + 600_000).toISOString(), source: 'hook', source_record_id: `claude:s:${agent}`, transition_id: `${item_id}/dispatch_ended/${agent}`, agentId: agent,
    meta: { stage: 'build', version: 1, agent: { turns: 10, usage: { 'claude-opus-5-5': { input: 1, output: 1 } }, cost_usd: cost, split: 1 } } });
  obs(repo, { ...base, event: 'done', at: new Date(Date.parse(at) + 3_600_000).toISOString(), source: 'cli', host: 'cli', source_record_id: `done-${ref}`, transition_id: `${item_id}/done/episode-1`, meta: { version: 1 } });
}
/** A repo with 12 landed, costed tasks (enough for cells and classes), plus a planned task T99 not landed yet. */
const landed = () => {
  const repo = initRepo();
  const tasks = [...Array.from({ length: 12 }, (_, k) => ({ ref: `T${k}`, role: 'python-dev', type: 'feature', novel: false })), { ref: 'T99', role: 'python-dev', type: 'feature', novel: false }];
  assert.equal(run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, tasks)), '--id', 'r1', '--created-at', '2026-11-01T00:00:00Z']).code, 0);
  tasks.slice(0, 12).forEach((t, k) => landTask(repo, 'sec/run-1', t.ref, { cost: 2 + k, at: `2026-11-0${2 + (k % 7)}T10:00:00.000Z` }));
  return repo;
};
const profile = (repo, obj) => writeFileSync(join(dd(repo), 'profile.json'), JSON.stringify(obj));
const nextPlan = (repo, name = 'p2.md', id = 'r2', runId = 'run-2') => run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'N1', role: 'python-dev', type: 'feature', novel: false }], runId), name), '--id', id, '--created-at', '2026-11-10T00:00:00Z']);

// ── item 3: persistent off switch ──
test('calibration off: calibrate (and --dry-run) computes and writes nothing; register fills nothing new; earlier fills stay', () => {
  const repo = landed();
  assert.equal(run(repo, ['calibrate']).code, 0);
  const n1 = nextPlan(repo); assert.match(n1.stdout, /CALIBRATED filled=1/);
  profile(repo, { calibration: 'off' });
  const before = readFileSync(join(deliveryDir(repo), 'calibration.json'), 'utf8');
  for (const args of [['calibrate'], ['calibrate', '--dry-run'], ['calibrate', '--json']]) {
    const r = run(repo, args); assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^CALIBRATION-OFF/m); assert.doesNotMatch(r.stdout, /^\|/m);
  }
  assert.equal(readFileSync(join(deliveryDir(repo), 'calibration.json'), 'utf8'), before, 'table untouched');
  const p3 = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(1, [{ ref: 'M1', role: 'python-dev', type: 'feature', novel: false }], 'run-3'), 'p3.md'), '--id', 'r3', '--created-at', '2026-11-10T00:00:00Z']);
  assert.equal(p3.code, 0, p3.stderr); assert.doesNotMatch(p3.stdout, /filled=1/); assert.equal(JSON.parse(readFileSync(runPath(repo, 'sec/run-3'), 'utf8')).items.find((i) => i.ref === 'M1').estimate, null);
  // A re-cut of run-2 keeps the estimate N1 was planned with.
  const r = run(repo, ['plan', 'register', '--from', writePlan(repo, plan(2, [{ ref: 'N1', role: 'python-dev', type: 'feature', novel: false }], 'run-2'), 'p2b.md'), '--id', 'r2b', '--at', '2026-11-11T00:00:00Z', '--created-at', '2026-11-10T00:00:00Z']);
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /kept=1/);
  assert.equal(JSON.parse(readFileSync(runPath(repo, 'sec/run-2'), 'utf8')).items.find((i) => i.ref === 'N1').estimate.tier, 'calibrated');
});

// ── item 5: cell schema check ──
test('a table with a malformed cell is CALIBRATION-INVALID; a generated table passes', () => {
  const repo = landed(); assert.equal(run(repo, ['calibrate']).code, 0);
  const file = join(deliveryDir(repo), 'calibration.json'), good = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(nextPlan(repo).code, 0, 'generated table accepted');
  const bads = [
    (c) => { delete c.cells.all.p80_usd; },
    (c) => { c.cells.all.p80_usd = c.cells.all.p50_usd / 2; },
    (c) => { c.cells.all.n = 2.5; },
    (c) => { c.cells.all.p50_usd = 0; },
    (c) => { c.cells.all.effort_class = 'E9'; },
    (c) => { c.cells.all.n_eff = -1; },
    (c) => { c.cells.all = 'x'; },
  ];
  bads.forEach((mut, k) => {
    const c = structuredClone(good); mut(c); writeFileSync(file, JSON.stringify(c));
    const r = nextPlan(repo, `bad${k}.md`, `b${k}`, `run-bad${k}`); assert.equal(r.code, 2, `case ${k}: ${r.stdout}`); assert.match(r.stderr, /^CALIBRATION-INVALID\(.*cell "all"/, `case ${k}`);
  });
  // A v1 table from before n_eff/newest_at existed is still valid.
  const legacy = structuredClone(good); for (const c of Object.values(legacy.cells)) { delete c.n_eff; delete c.newest_at; } delete legacy.sample_rule;
  writeFileSync(file, JSON.stringify(legacy)); const lg = nextPlan(repo, 'legacy.md', 'lg', 'run-legacy'); assert.equal(lg.code, 0, lg.stderr);
});

// ── item 6: immutable state versions ──
test('calibrate keeps every table version as an immutable content-addressed snapshot; dry-run writes none', () => {
  const repo = landed(), d = deliveryDir(repo), snaps = () => (existsSync(join(d, 'calibration')) ? readdirSync(join(d, 'calibration')).sort() : []);
  assert.equal(run(repo, ['calibrate', '--dry-run']).code, 0); assert.deepEqual(snaps(), [], 'dry-run writes no snapshot');
  assert.equal(run(repo, ['calibrate']).code, 0);
  const t1 = readFileSync(join(d, 'calibration.json'), 'utf8');
  assert.deepEqual(snaps(), [`${sha256(t1)}.json`]); assert.equal(readFileSync(join(d, 'calibration', `${sha256(t1)}.json`), 'utf8'), t1);
  // A newer table (more landed work) gets its own snapshot; the older one stays byte-identical.
  landTask(repo, 'sec/run-1', 'T99', { cost: 50, at: '2026-11-09T10:00:00.000Z' });
  assert.equal(run(repo, ['calibrate']).code, 0);
  const t2 = readFileSync(join(d, 'calibration.json'), 'utf8'); assert.notEqual(t2, t1);
  assert.deepEqual(snaps(), [`${sha256(t1)}.json`, `${sha256(t2)}.json`].sort());
  assert.equal(readFileSync(join(d, 'calibration', `${sha256(t1)}.json`), 'utf8'), t1);
  // The estimate's digest resolves to a snapshot.
  const reg = nextPlan(repo); assert.equal(reg.code, 0);
  const ref = JSON.parse(readFileSync(runPath(repo, 'sec/run-2'), 'utf8')).items.find((i) => i.ref === 'N1').estimate.reference;
  assert.ok(existsSync(join(d, 'calibration', `${ref.sha256}.json`)));
});

test('a calibration.json written before snapshots existed is preserved as its own snapshot before the first replacement', () => {
  const repo = landed(), d = deliveryDir(repo);
  const old = `${JSON.stringify(buildCalibration([{ run: 'x', ref: 'X', role: null, type: null, novel: null, cost_usd: 1, done_at: '2026-11-01T00:00:00Z', returned: false, model: null }], { now: NOW }), null, 2)}\n`;
  writeFileSync(join(d, 'calibration.json'), old);
  assert.equal(run(repo, ['calibrate']).code, 0);
  assert.equal(readFileSync(join(d, 'calibration', `${sha256(old)}.json`), 'utf8'), old);
});

// ── item 4: effective sample + freshness ──
test('effectiveN is Kish: equal weights give n; one dominant weight gives about 1', () => {
  assert.equal(effectiveN([1, 1, 1, 1, 1]), 5);
  assert.ok(effectiveN([1, 1e-6, 1e-6, 1e-6, 1e-6]) < 1.01);
  assert.equal(effectiveN([]), 0);
});

const sample = (k, daysAgo, extra = {}) => ({ run: 'r', ref: `S${k}`, role: 'python-dev', type: 'feature', novel: false, cost_usd: 1 + k, done_at: new Date(NOW - daysAgo * DAY).toISOString(), returned: false, model: null, ...extra });

test('cells carry n_eff and newest_at; raw mode (default) is unchanged by them', () => {
  const cal = buildCalibration(Array.from({ length: 5 }, (_, k) => sample(k, k)), { now: NOW });
  const cell = cal.cells['role=python-dev|type=feature|novel=false'];
  assert.ok(cell.n_eff > 4 && cell.n_eff <= 5); assert.equal(cell.newest_at, new Date(NOW).toISOString());
  assert.equal(cal.sample_rule, 'raw');
  assert.equal(lookup(cal, { role: 'python-dev', type: 'feature', novel: false }).key, 'role=python-dev|type=feature|novel=false');
});

test('effective mode: 4 stale + 1 fresh sample passes raw n but not n_eff; stale cells are not used; legacy cells are not eligible', () => {
  const samples = [...Array.from({ length: 4 }, (_, k) => sample(k, 365)), sample(9, 0)];
  const raw = buildCalibration(samples, { now: NOW });
  assert.ok(lookup(raw, { role: 'python-dev', type: 'feature', novel: false }), 'raw mode: n=5 passes (legacy behaviour)');
  const eff = buildCalibration(samples, { now: NOW, sampleRule: 'effective' });
  assert.equal(eff.sample_rule, 'effective');
  assert.equal(lookup(eff, { role: 'python-dev', type: 'feature', novel: false }, { rule: 'effective', now: NOW }), null, 'n_eff ≈ 1 < 5');
  // Five fresh samples pass, but not once they are older than two half-lives at registration time.
  const fresh = buildCalibration(Array.from({ length: 5 }, (_, k) => sample(k, 0)), { now: NOW, sampleRule: 'effective' });
  assert.ok(lookup(fresh, { role: 'python-dev' }, { rule: 'effective', now: NOW }));
  assert.equal(lookup(fresh, { role: 'python-dev' }, { rule: 'effective', now: NOW + 85 * DAY }), null, 'older than 2 × 42 days');
  // A table built in raw mode (or before n_eff existed) cannot satisfy effective mode.
  assert.equal(lookup(raw, { role: 'python-dev' }, { rule: 'effective', now: NOW }), null);
});

test('effective mode: class boundaries need a total effective sample of 12', () => {
  const twelveStale = [...Array.from({ length: 11 }, (_, k) => sample(k, 400)), sample(20, 0)];
  assert.ok(buildCalibration(twelveStale, { now: NOW }).class_bounds_usd, 'raw: 12 samples give classes');
  assert.equal(buildCalibration(twelveStale, { now: NOW, sampleRule: 'effective' }).class_bounds_usd, null, 'effective: n_eff ≈ 1');
});

test('CLI: profile calibrationSample effective → calibrate builds an effective table and register applies it', () => {
  const repo = landed(); profile(repo, { calibrationSample: 'effective' });
  assert.equal(run(repo, ['calibrate']).code, 0);
  assert.equal(JSON.parse(readFileSync(join(deliveryDir(repo), 'calibration.json'), 'utf8')).sample_rule, 'effective');
  const r = nextPlan(repo); assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /CALIBRATED filled=1/);
  // Switching to effective mode with a table built in raw mode fills nothing and says why.
  const repo2 = landed(); assert.equal(run(repo2, ['calibrate']).code, 0); profile(repo2, { calibrationSample: 'effective' });
  const r2 = nextPlan(repo2); assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /CALIBRATED filled=0 .*no-cell=1/); assert.match(r2.stderr, /re-run `delivery.mjs calibrate`/);
});

test('calibration off: the command does not run the closing sync (pending telemetry is not committed)', () => {
  const repo = landed(); profile(repo, { calibration: 'off' });
  // Make the telemetry dir a git repo so a sync would commit; DELIVERY_NO_SYNC is cleared for this run.
  const tel = join(repo, '.agents', 'telemetry'); execFileSync('git', ['init', '-q'], { cwd: tel }); execFileSync('git', ['-c', 'user.email=t@x', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'root'], { cwd: tel });
  const r = run(repo, ['calibrate'], { env: { DELIVERY_NO_SYNC: '' } }); assert.equal(r.code, 0, r.stderr);
  assert.notEqual(execFileSync('git', ['status', '--porcelain'], { cwd: tel, encoding: 'utf8' }).trim(), '', 'pending files left uncommitted');
});

test('profile set: accepts and validates the policy keys; an unrelated profile change keeps policies already set', () => {
  const repo = initRepo(); const f = join(repo, 'prof.json');
  writeFileSync(f, JSON.stringify({ calibration: 'off', storeText: false })); assert.equal(run(repo, ['profile', 'set', '--from', f]).code, 0);
  writeFileSync(f, JSON.stringify({ zeroDurationSec: 30 })); assert.equal(run(repo, ['profile', 'set', '--from', f]).code, 0);
  const p = JSON.parse(readFileSync(join(deliveryDir(repo), 'profile.json'), 'utf8'));
  assert.equal(p.calibration, 'off'); assert.equal(p.storeText, false); assert.equal(p.zeroDurationSec, 30); assert.equal(p.calibrationSample, 'raw');
  writeFileSync(f, JSON.stringify({ calibration: 'on' })); assert.equal(run(repo, ['profile', 'set', '--from', f]).code, 0);
  assert.equal(JSON.parse(readFileSync(join(deliveryDir(repo), 'profile.json'), 'utf8')).calibration, 'on', 'an explicit value replaces it');
  writeFileSync(f, JSON.stringify({ calibrationSample: 'all' })); const bad = run(repo, ['profile', 'set', '--from', f]);
  assert.equal(bad.code, 2); assert.match(bad.stderr, /calibrationSample/);
});
