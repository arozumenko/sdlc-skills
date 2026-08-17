// Installing bundle A never touches bundle B's installed hooks — by design.
// The cost of that ownership rule is silence: B's hooks can lag a shipped fix
// forever (field case: manual-qa benchmark hooks without the roster guard
// firing in test-automation sessions). checkSiblingBundleHooks is the signal:
// byte-compare installed bundle hook scripts against the package's current
// copies and name what lags. Signal only — a difference may be a deliberate
// local patch, so the caller prints, never overwrites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSiblingBundleHooks } from './init.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sibling-'));
  const pkg = join(root, 'pkg');
  const cwd = join(root, 'repo');
  // package ships two bundles with hook scripts
  mkdirSync(join(pkg, 'bundles', 'manual-qa', 'hooks', 'scripts'), { recursive: true });
  writeFileSync(join(pkg, 'bundles', 'manual-qa', 'hooks', 'scripts', 'benchmark-tc'), 'NEW with roster guard');
  writeFileSync(join(pkg, 'bundles', 'manual-qa', 'hooks', 'scripts', 'benchmark-stop'), 'same');
  mkdirSync(join(pkg, 'bundles', 'test-automation', 'hooks', 'scripts'), { recursive: true });
  writeFileSync(join(pkg, 'bundles', 'test-automation', 'hooks', 'scripts', 'workflow-return.mjs'), 'fresh');
  // repo has both installed under .claude/hooks/<bundle>/ — manual-qa is stale
  mkdirSync(join(cwd, '.claude', 'hooks', 'manual-qa'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'hooks', 'manual-qa', 'benchmark-tc'), 'OLD no guard');
  writeFileSync(join(cwd, '.claude', 'hooks', 'manual-qa', 'benchmark-stop'), 'same');
  mkdirSync(join(cwd, '.claude', 'hooks', 'test-automation'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'hooks', 'test-automation', 'workflow-return.mjs'), 'fresh');
  // a non-bundle hooks dir (core sdlc-skills scripts) must be ignored
  mkdirSync(join(cwd, '.claude', 'hooks', 'sdlc-skills'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'hooks', 'sdlc-skills', 'lib.sh'), 'whatever');
  return { root, pkg, cwd, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('flags only the bundle whose installed hook lags the package copy', () => {
  const f = fixture();
  try {
    const stale = checkSiblingBundleHooks([{ id: 'claude', dir: '.claude' }], f.cwd, f.pkg);
    assert.deepEqual([...stale.keys()], ['manual-qa'], 'up-to-date and non-bundle dirs stay silent');
    assert.deepEqual(stale.get('manual-qa'), ['benchmark-tc'], 'names the lagging script, not the matching one');
  } finally { f.cleanup(); }
});

test('quiet on a repo with no hooks at all, and never throws', () => {
  const f = fixture();
  try {
    const stale = checkSiblingBundleHooks([{ id: 'cursor', dir: '.cursor' }], f.cwd, f.pkg);
    assert.equal(stale.size, 0);
  } finally { f.cleanup(); }
});
