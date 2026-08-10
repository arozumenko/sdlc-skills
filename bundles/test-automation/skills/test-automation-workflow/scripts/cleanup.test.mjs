import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planCleanup, applyCleanup, parseList } from './cleanup.mjs';

const SCRIPT = fileURLToPath(new URL('./cleanup.mjs', import.meta.url));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'f.txt'), 'x');
  g('add', '.'); g('commit', '-qm', 'init');
  return { dir, g };
}

/** Run the CLI, capturing stdout (it exits 2 on usage). */
function run(dir, args) {
  try {
    return { out: execFileSync('node', [SCRIPT, ...args, '--repo', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
  } catch (e) {
    return { out: e.stdout ?? '', err: e.stderr ?? '', code: e.status };
  }
}

// THE invariant. A squash merge defeats git's ancestry check, so nothing but a
// supplied merged claim can authorise a delete — and the deletion is
// unrecoverable. An agent that reasoned its way to a wrong branch list must
// still be unable to destroy anything with it.
test('a branch is deletable only when the merged set names it', () => {
  const { dir, g } = repo();
  try {
    g('branch', 'tests/TC-1-x');
    g('branch', 'tests/TC-2-y');
    const plan = planCleanup(dir, {
      candidates: ['tests/TC-1-x', 'tests/TC-2-y'],
      merged: ['tests/TC-1-x'],
    });
    assert.deepEqual(plan.deletable.map((d) => d.branch), ['tests/TC-1-x']);
    assert.ok(plan.kept.some((k) => k.branch === 'tests/TC-2-y' && /no merged change request/.test(k.why)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// "Nothing merged" is a real answer and must authorise nothing — never be
// mistaken for "everything merged".
test('an empty merged set authorises nothing', () => {
  const { dir, g } = repo();
  try {
    g('branch', 'tests/TC-1-x');
    const plan = planCleanup(dir, { candidates: ['tests/TC-1-x'], merged: [] });
    assert.equal(plan.deletable.length, 0);
    assert.equal(plan.kept.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the checked-out branch is never deleted, merged or not', () => {
  const { dir, g } = repo();
  try {
    g('checkout', '-q', '-b', 'tests/TC-1-x');
    const plan = planCleanup(dir, { candidates: ['tests/TC-1-x'], merged: ['tests/TC-1-x'] });
    assert.equal(plan.deletable.length, 0);
    assert.match(plan.kept[0].why, /checked out/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the integration branch goes only once merged; --also covers wave branches', () => {
  const { dir, g } = repo();
  try {
    g('branch', 'tests/batch-b1');
    g('branch', 'tests/batch-b2');
    const plan = planCleanup(dir, {
      candidates: [], integrationBranch: 'tests/batch-b1', also: ['tests/batch-b2'],
      merged: ['tests/batch-b1'],
    });
    assert.deepEqual(plan.integration.map((i) => i.branch), ['tests/batch-b1']);
    assert.ok(plan.kept.some((k) => k.branch === 'tests/batch-b2'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A branch already gone is not an error and not a KEEP — there is nothing to say.
test('branches that no longer exist are silently skipped', () => {
  const { dir } = repo();
  try {
    const plan = planCleanup(dir, { candidates: ['tests/gone'], merged: ['tests/gone'] });
    assert.equal(plan.deletable.length, 0);
    assert.equal(plan.kept.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// This pipeline creates no worktrees; leftovers from hand-run work still need
// clearing, and the periodic sweep skips them forever (unpushed commits).
test('applyCleanup removes a leftover worktree sitting on a deletable branch', () => {
  const { dir, g } = repo();
  const wt = join(dir, '..', `cleanup-wt-${process.pid}`);
  try {
    g('branch', 'tests/TC-1-x');
    execFileSync('git', ['worktree', 'add', '-q', wt, 'tests/TC-1-x'], { cwd: dir, stdio: 'ignore' });
    const plan = planCleanup(dir, { candidates: ['tests/TC-1-x'], merged: ['tests/TC-1-x'] });
    assert.equal(plan.worktrees.length, 1);
    const done = applyCleanup(dir, plan);
    assert.equal(done.worktrees.length, 1);
    assert.deepEqual(done.branches, ['tests/TC-1-x']);
    assert.deepEqual(done.failed, []);
  } finally {
    rmSync(wt, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseList reads a csv or an @file and ignores comments', () => {
  assert.equal(parseList(undefined), null);                     // not supplied
  assert.deepEqual(parseList('a,b'), ['a', 'b']);
  assert.deepEqual(parseList(' a , b '), ['a', 'b']);
  assert.deepEqual(parseList('@x', () => '# none yet\n'), []);  // supplied, empty
  assert.deepEqual(parseList('@x', () => 'one\n# c\ntwo\n'), ['one', 'two']);
});

// --- CLI layer: the guards that must hold before anything is destroyed ------

// The script must not guess the host. Omitting --merged is a usage error, and
// the message has to tell the operator where the answer comes from.
test('--merged is required, and the error says where the answer comes from', () => {
  const { dir } = repo();
  try {
    const r = run(dir, ['--branches', 'tests/TC-1-x']);
    assert.equal(r.code, 2);
    assert.match(r.err, /--merged/);
    assert.match(r.err, /workflow\.md/);        // points at the seed
    assert.match(r.err, /will not guess/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The single most safety-critical behaviour in the file.
test('without --apply nothing is deleted, however clear the plan is', () => {
  const { dir, g } = repo();
  try {
    g('branch', 'tests/TC-1-x');
    const r = run(dir, ['--branches', 'tests/TC-1-x', '--merged', 'tests/TC-1-x']);
    assert.match(r.out, /DELETE branch tests\/TC-1-x/);
    assert.match(r.out, /dry-run/);
    const left = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
      { cwd: dir, encoding: 'utf8' });
    assert.match(left, /tests\/TC-1-x/, 'dry-run must not delete');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--apply deletes exactly what the plan authorised', () => {
  const { dir, g } = repo();
  try {
    g('branch', 'tests/TC-1-x');
    g('branch', 'tests/TC-2-y');
    run(dir, ['--branches', 'tests/TC-1-x,tests/TC-2-y', '--merged', 'tests/TC-1-x', '--apply']);
    const left = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
      { cwd: dir, encoding: 'utf8' });
    assert.doesNotMatch(left, /tests\/TC-1-x/, 'merged branch deleted');
    assert.match(left, /tests\/TC-2-y/, 'unmerged branch survived');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The report only contributes NAMES; the merged set still authorises.
test('--report supplies candidates but does not authorise them', () => {
  const { dir, g } = repo();
  try {
    g('branch', 'tests/TC-1-x');
    g('branch', 'tests/batch-s');
    const rp = join(dir, 'report.json');
    writeFileSync(rp, JSON.stringify({
      cases: [{ id: 'TC-1', branch: 'tests/TC-1-x' }],
      integration_branch: 'tests/batch-s',
    }));
    const kept = run(dir, ['--report', rp, '--merged', '']);
    assert.doesNotMatch(kept.out, /DELETE/, 'nothing merged → nothing authorised');
    const go = run(dir, ['--report', rp, '--merged', 'tests/TC-1-x,tests/batch-s']);
    assert.match(go.out, /DELETE branch tests\/TC-1-x/);
    assert.match(go.out, /DELETE integration tests\/batch-s/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
