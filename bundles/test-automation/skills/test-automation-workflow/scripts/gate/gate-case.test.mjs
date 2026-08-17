import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRunCommand, summarize, gateNote, batchSlugOfBranch, appendGateRecord } from './gate-case.mjs';

const SCRIPT = fileURLToPath(new URL('./gate-case.mjs', import.meta.url));

/** A throwaway repo with one commit on `main` and no remote. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'x');
  g('add', '.'); g('commit', '-qm', 'init');
  return { dir, g };
}

/** Run the gate and parse its --json result (it exits 1 on red/error). */
function runGate(dir, args) {
  try {
    return JSON.parse(execFileSync('node', [SCRIPT, ...args, '--repo', dir, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    return JSON.parse(e.stdout);
  }
}

test('buildRunCommand: {spec} is substituted, or the spec is appended', () => {
  assert.equal(
    buildRunCommand('pytest {spec} -v', 'tests/t.py::TestA::test_b'),
    'pytest tests/t.py::TestA::test_b -v'
  );
  // Every placeholder, not just the first.
  assert.equal(buildRunCommand('echo {spec} && pytest {spec}', 'X'), 'echo X && pytest X');
  // No placeholder → append, so the spec is never silently dropped.
  assert.equal(buildRunCommand('pytest -v', 'X'), 'pytest -v X');
  // No spec at all is legal (gate a whole suite).
  assert.equal(buildRunCommand('pytest -v', ''), 'pytest -v');
  assert.throws(() => buildRunCommand('', 'X'), /--cmd is required/);
});

// The contract is N CONSECUTIVE green. A red resets the streak — which is why
// the runner stops at the first failure rather than "best of N".
test('summarize: consecutive green decides the verdict', () => {
  const g = (s) => ({ ok: true, exitCode: 0, seconds: s });
  const r = (s) => ({ ok: false, exitCode: 1, seconds: s });
  assert.equal(summarize([g(1), g(2), g(3)], 3).verdict, 'green');
  assert.equal(summarize([g(1), g(2)], 3).verdict, 'red');
  assert.equal(summarize([g(1), r(2)], 3).verdict, 'red');
  // A red mid-way resets: two greens after one red is still not three.
  const mixed = summarize([g(1), r(2), g(3), g(4)], 3);
  assert.equal(mixed.consecutiveGreen, 2);
  assert.equal(mixed.verdict, 'red');
});

test('gateNote: records timings as evidence, both verdicts', () => {
  const s = summarize([
    { ok: true, exitCode: 0, seconds: 29.04 },
    { ok: true, exitCode: 0, seconds: 29.61 },
    { ok: true, exitCode: 0, seconds: 37.2 },
  ], 3);
  const note = gateNote(s, 'merged origin/automation/base before gating');
  assert.match(note, /Lead gate 3\/3 green/);
  assert.match(note, /29\.04s\/29\.61s\/37\.20s/); // the proof, not a claim
  assert.match(note, /merged origin\/automation\/base before gating/);

  const bad = gateNote(summarize([{ ok: false, exitCode: 1, seconds: 5 }], 3));
  assert.match(bad, /NOT 3\/3 green/);
  assert.match(bad, /1 of 1 run\(s\) failed/);
});

// The gate's independence is the doctrine this script must not erode: it does
// the typing, the lead keeps every decision.
test('the script stays mechanical: no merging, no board writes, no auto-resolve', () => {
  const text = readFileSync(fileURLToPath(new URL('./gate-case.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(text, /gh pr merge/);
  // It may NAME set-status (it emits the --note text the lead pastes there),
  // but it must never invoke the board scripts itself.
  assert.doesNotMatch(text, /set-status\.mjs/);
  assert.doesNotMatch(text, /--ours|--theirs|checkout --theirs/);
  // Base merged BEFORE the runs, or the gate proves nothing about what lands.
  assert.match(text, /Base FIRST/);
  // A conflict stops the gate and reports; it is never resolved here.
  assert.match(text, /verdict = 'conflict'/);
});

// No worktrees anywhere in the pipeline: isolation is branches, safety is
// order. Gating is the finalisation step, so nothing else writes the tree —
// and the real checkout already has the env and dependencies the suite needs,
// which a fresh worktree never carries.
test('the gate runs in the project checkout, not a worktree', () => {
  const text = readFileSync(fileURLToPath(new URL('./gate-case.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(text, /worktree add|ensureWorktree|--worktree/);
  assert.doesNotMatch(text, /envFileState|--fix-env/);       // no env repair needed in the real tree
  assert.match(text, /IT RUNS IN THE PROJECT'S OWN CHECKOUT/);
  // Checking a branch out in the real tree would eat someone's work in progress.
  assert.match(text, /working tree is dirty/);
});

// The gate checks out `origin/<branch>`, but nothing used to push the
// integration branch there — so on a live run the GATE pushed it itself, a
// write its own contract ("you PROVE it, you do not fix it") does not sanction,
// and one it only performed because that agent happened to reason it out.
// The integrator now pushes; these guard the gate's side of the contract.
test('a local-only branch still gates, and the note says what was proved', () => {
  const { dir, g } = repo();
  try {
    g('checkout', '-q', '-b', 'tests/batch-x');
    writeFileSync(join(dir, 'w.txt'), 'w'); g('add', '.'); g('commit', '-qm', 'work');
    g('checkout', '-q', 'main');
    const out = runGate(dir, ['--branch', 'tests/batch-x', '--base', 'main', '--cmd', 'true', '--n', '2']);
    assert.equal(out.verdict, 'green');
    assert.equal(out.localOnly, true);
    assert.match(out.note, /gated LOCAL branch/);
    // This fixture has no remote at all, and the note says exactly that rather
    // than naming a remote that does not exist.
    assert.match(out.note, /not on any remote/);
    // The verdict landed as a script-authored record the moment it existed —
    // no report write-back required for "the gate ran green" to be on disk.
    const rec = JSON.parse(readFileSync(join(dir, '.agents', 'automation', 'x', 'gate-runs.jsonl'), 'utf8').trim());
    assert.equal(rec.verdict, 'green');
    assert.equal(rec.consecutiveGreen, 2);
    assert.equal(rec.branch, 'tests/batch-x');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Dirt policy (reworked 2026-08-17, field case: a foreign bundle's debug log
// and installer-touched configs blocked gates that had nothing to do with
// them). Unrelated dirt — telemetry, logs, foreign bundles' state, stray
// files — never blocks; it rides the verdict record as carriedDirt. What DOES
// refuse: a dirty path among the files the gate is about (base...branch diff)
// — the run would prove the dirt, not the branch.
test('unrelated dirt is carried, not refused; dirt on the gated files refuses', () => {
  const { dir, g } = repo();
  try {
    g('checkout', '-q', '-b', 'tests/batch-t');
    writeFileSync(join(dir, 'w.txt'), 'w'); g('add', '.'); g('commit', '-qm', 'work');
    g('checkout', '-q', 'main');
    // mid-run bookkeeping + a foreign bundle's log + a random stray file
    execFileSync('mkdir', ['-p', join(dir, '.agents', 'telemetry', 'automation', 'scopes')]);
    writeFileSync(join(dir, '.agents', 'telemetry', 'automation', 'scopes', 's1.json'), '{}');
    writeFileSync(join(dir, 'benchmark-debug.log'), 'noise');
    writeFileSync(join(dir, 'src.txt'), 'uncommitted but unrelated');
    const ok = runGate(dir, ['--branch', 'tests/batch-t', '--base', 'main', '--cmd', 'true', '--n', '1']);
    assert.equal(ok.verdict, 'green', 'unrelated dirt does not block the gate');
    // telemetry dir exists in this fixture → the record lands on the telemetry side
    const recs = readFileSync(join(dir, '.agents', 'telemetry', 'automation', 'gate-runs', 't.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
    const rec = recs[recs.length - 1];
    assert.ok(rec.carriedDirt.includes('src.txt'), 'the record names what the tree carried');
    // …but dirt on a file the branch itself changes = the proof would be dirty
    writeFileSync(join(dir, 'w.txt'), 'LOCAL JUNK'); // w.txt is what the branch adds
    const bad = runGate(dir, ['--branch', 'tests/batch-t', '--base', 'main', '--cmd', 'true', '--n', '1']);
    assert.match(bad.notes, /overlap the very files this gate proves/);
    assert.match(bad.notes, /w\.txt/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The mechanical net: a local change git itself refuses to overwrite (a path
// the BASE moved after the branch was cut — not in the base...branch diff, so
// the proof check passes) surfaces as git's own victim list, never a generic
// "setup failed".
test('a checkout/merge blocked by local changes names the exact victim paths', () => {
  const { dir, g } = repo();
  try {
    writeFileSync(join(dir, 'shared.txt'), 'v1'); g('add', '.'); g('commit', '-qm', 'shared v1');
    g('checkout', '-q', '-b', 'tests/batch-m');
    writeFileSync(join(dir, 'w.txt'), 'w'); g('add', '.'); g('commit', '-qm', 'work');
    g('checkout', '-q', 'main');
    writeFileSync(join(dir, 'shared.txt'), 'v2'); g('add', '.'); g('commit', '-qm', 'base moves shared');
    writeFileSync(join(dir, 'shared.txt'), 'LOCAL EDIT'); // dirty, collides with checkout of the branch
    const res = runGate(dir, ['--branch', 'tests/batch-m', '--base', 'main', '--cmd', 'true', '--n', '1']);
    assert.notEqual(res.verdict, 'green');
    assert.match(res.notes, /blocked by local changes to: .*shared\.txt/);
    assert.match(res.notes, /stash BY PATH/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('batchSlugOfBranch + appendGateRecord: slug from the trunk, --batch override, _gates fallback', () => {
  assert.equal(batchSlugOfBranch('tests/batch-skills-w3'), 'skills-w3');
  assert.equal(batchSlugOfBranch('tests/ELITEA-2312-users-tab'), null);
  const dir = mkdtempSync(join(tmpdir(), 'gate-rec-'));
  try {
    const result = { branch: 'tests/ELITEA-1-x', base: 'main', n: 3, verdict: 'red', consecutiveGreen: 1, seconds: [2.5] };
    const withBatch = appendGateRecord(dir, result, { batch: 'b9', now: '2026-08-12T10:00:00Z' });
    assert.ok(withBatch.endsWith(join('b9', 'gate-runs.jsonl')));
    const fallback = appendGateRecord(dir, result, { now: '2026-08-12T10:01:00Z' });
    assert.ok(fallback.endsWith(join('_gates', 'gate-runs.jsonl')), 'unassignable verdicts land, never vanish');
    const rec = JSON.parse(readFileSync(withBatch, 'utf8').trim());
    assert.equal(rec.verdict, 'red');
    assert.deepEqual(rec.seconds, [2.5]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Once the telemetry area exists, mid-run verdicts must land THERE — an append
// into the batch dir after close modifies a committed file, and git checkout
// then refuses the branch switch the next gate run needs.
test('appendGateRecord: prefers telemetry/gate-runs/<slug>.jsonl when the telemetry dir exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-tel-'));
  try {
    execFileSync('mkdir', ['-p', join(dir, '.agents', 'telemetry', 'automation')]);
    const result = { branch: 'tests/batch-w7', base: 'main', n: 3, verdict: 'green', consecutiveGreen: 3, seconds: [1.1] };
    const file = appendGateRecord(dir, result, { now: '2026-08-14T10:00:00Z' });
    assert.ok(file.endsWith(join('telemetry', 'automation', 'gate-runs', 'w7.jsonl')), `landed at ${file}`);
    const rec = JSON.parse(readFileSync(file, 'utf8').trim());
    assert.equal(rec.verdict, 'green');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// `origin` was hardcoded, so a fork checkout (`upstream`) or any renamed remote
// failed the fetch and then reported the branch unreachable — an infrastructure
// fact surfacing as a red gate. The remote is asked for now.
test('a remote that is not called origin is discovered and used', () => {
  const { dir, g } = repo();
  const up = mkdtempSync(join(tmpdir(), 'gate-up-'));
  try {
    // A real, fetchable remote under a non-default name.
    execFileSync('git', ['init', '-q', '--bare', up], { stdio: 'ignore' });
    g('remote', 'add', 'upstream', up);
    g('checkout', '-q', '-b', 'tests/batch-x');
    writeFileSync(join(dir, 'w.txt'), 'w'); g('add', '.'); g('commit', '-qm', 'work');
    g('push', '-q', 'upstream', 'tests/batch-x');
    g('push', '-q', 'upstream', 'main');
    g('checkout', '-q', 'main');
    const out = runGate(dir, ['--branch', 'tests/batch-x', '--base', 'main', '--cmd', 'true', '--n', '1']);
    assert.equal(out.verdict, 'green');
    assert.equal(out.remote, 'upstream', 'the non-default remote was discovered');
    assert.notEqual(out.localOnly, true, 'it resolved upstream/<branch>, not the local ref');
    assert.equal(out.baseRef, 'upstream/main', 'and merged the remote base');
  } finally {
    rmSync(up, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// An infrastructure fact must not masquerade as a test failure.
test('a branch on neither origin nor local errors, naming the real cause', () => {
  const { dir } = repo();
  try {
    const out = runGate(dir, ['--branch', 'tests/ghost', '--base', 'main', '--cmd', 'true', '--n', '2']);
    assert.equal(out.verdict, 'error');
    assert.match(out.notes, /neither origin nor local/);
    assert.match(out.notes, /integrator should have pushed it/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A repo with no remote is still gateable; letting `git fetch` throw killed the
// whole setup block and reported "git setup failed" for a healthy branch.
test('a missing remote is not fatal and the note names the ref actually merged', () => {
  const { dir, g } = repo();
  try {
    g('checkout', '-q', '-b', 'tests/batch-y');
    writeFileSync(join(dir, 'w.txt'), 'w'); g('add', '.'); g('commit', '-qm', 'work');
    g('checkout', '-q', 'main');
    const out = runGate(dir, ['--branch', 'tests/batch-y', '--base', 'main', '--cmd', 'true', '--n', '1']);
    assert.equal(out.verdict, 'green');
    assert.equal(out.baseRef, 'main');            // not origin/main — it doesn't exist
    assert.match(out.note, /merged main before gating/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The half-merge used to be left in place: MERGE_HEAD survived, and the NEXT
// gate invocation refused with a misleading "working tree is dirty". The
// conflict path must leave the tree clean (conflict recorded, merge aborted).
test('a conflicting base merge is aborted — the tree is left clean, not mid-merge', () => {
  const { dir, g } = repo();
  try {
    g('checkout', '-q', '-b', 'tests/TC-9-x');
    writeFileSync(join(dir, 'a.txt'), 'branch-side');
    g('commit', '-aqm', 'branch change');
    g('checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'base-side');
    g('commit', '-aqm', 'base change');
    const res = runGate(dir, ['--branch', 'tests/TC-9-x', '--base', 'main', '--cmd', 'node -e 1']);
    assert.equal(res.verdict, 'conflict');
    assert.ok(res.conflictFiles.includes('a.txt'));
    // The verdict record is the ONE tolerated leftover — everything else clean.
    const status = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .filter((l) => !/gate-runs\.jsonl$/.test(l));
    assert.deepEqual(status, [], 'the half-merge was aborted; nothing is left unmerged');
    // …and that leftover must not deadlock the next run's dirty check.
    const again = runGate(dir, ['--branch', 'tests/TC-9-x', '--base', 'main', '--cmd', 'node -e 1']);
    assert.equal(again.verdict, 'conflict', 'second run proceeds past the dirty check to the same verdict');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A wedged env used to hang the gate forever — exactly the live-env failure
// the gate exists to surface. --timeout kills the run and counts it red.
test('--timeout kills a hung run and reports it red as timed out', () => {
  const { dir, g } = repo();
  try {
    g('branch', 'tests/TC-8-y');
    const res = runGate(dir, ['--branch', 'tests/TC-8-y', '--base', 'main', '--n', '1', '--timeout', '1',
      '--cmd', 'node -e "setTimeout(function () {}, 30000)"']);
    assert.equal(res.verdict, 'red');
    assert.equal(res.runs[0].ok, false);
    assert.equal(res.runs[0].timedOut, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Appended specs get quoted when they need it — a parameterized node id with a
// space or brackets otherwise word-splits under the shell. {spec} substitution
// is verbatim (function replacement), so `$&` never triggers pattern semantics.
test('buildRunCommand: appended specs are quoted when needed; {spec} is verbatim', () => {
  assert.equal(buildRunCommand('pytest -v', 't.py::test[case 1]'), 'pytest -v "t.py::test[case 1]"');
  assert.equal(buildRunCommand('run {spec}', 'a$&b'), 'run a$&b');
});
