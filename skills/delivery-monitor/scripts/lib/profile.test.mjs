import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POLICY_DEFAULTS, mayPush, readPolicies, readPublishPolicy, validatePolicies } from './profile.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'dm-prof-'));
const put = (r, rel, text) => { const p = join(r, '.agents', 'telemetry', ...rel.split('/')); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); return r; };

test('publish policy: no file is legacy (push, unverified); explicit values; broken file and bad value fail closed', () => {
  assert.deepEqual(readPublishPolicy(repo()), { publish: 'legacy', problem: null });
  assert.deepEqual(readPublishPolicy(put(repo(), 'policy.json', '{}')), { publish: 'legacy', problem: null });
  assert.equal(readPublishPolicy(put(repo(), 'policy.json', '{"publish":"private-remote"}')).publish, 'private-remote');
  assert.equal(readPublishPolicy(put(repo(), 'policy.json', '{"publish":"local-only"}')).publish, 'local-only');
  const broken = readPublishPolicy(put(repo(), 'policy.json', '{nope')); assert.equal(broken.publish, 'local-only'); assert.ok(broken.problem);
  const bad = readPublishPolicy(put(repo(), 'policy.json', '{"publish":"public"}')); assert.equal(bad.publish, 'local-only'); assert.ok(bad.problem);
  assert.equal(readPublishPolicy(put(repo(), 'policy.json', '[]')).publish, 'local-only');
});

test('mayPush: legacy and private-remote push; local-only and DELIVERY_NO_SYNC do not', () => {
  assert.equal(mayPush(repo(), {}), true);
  assert.equal(mayPush(put(repo(), 'policy.json', '{"publish":"private-remote"}'), {}), true);
  assert.equal(mayPush(put(repo(), 'policy.json', '{"publish":"local-only"}'), {}), false);
  assert.equal(mayPush(repo(), { DELIVERY_NO_SYNC: '1' }), false);
});

test('profile policies: none set (existing installs) keeps the shipped behaviour', () => {
  assert.deepEqual(readPolicies(repo()), { ...POLICY_DEFAULTS, problems: [] });
  assert.deepEqual(readPolicies(put(repo(), 'delivery/profile.json', '{"capturePrompts":false,"zeroDurationSec":60}')), { ...POLICY_DEFAULTS, problems: [] });
  assert.deepEqual(POLICY_DEFAULTS, { storeText: true, calibration: 'on', calibrationSample: 'raw' });
});

test('profile policies: valid values read; invalid ignored with a problem; storeText fails closed', () => {
  assert.deepEqual(readPolicies(put(repo(), 'delivery/profile.json', JSON.stringify({ storeText: false, calibration: 'off', calibrationSample: 'effective' }))),
    { storeText: false, calibration: 'off', calibrationSample: 'effective', problems: [] });
  const p = readPolicies(put(repo(), 'delivery/profile.json', JSON.stringify({ storeText: 'yes', calibration: 'maybe', calibrationSample: 'all' })));
  assert.equal(p.storeText, false); assert.equal(p.calibration, 'on'); assert.equal(p.calibrationSample, 'raw'); assert.equal(p.problems.length, 3);
  const broken = readPolicies(put(repo(), 'delivery/profile.json', '{nope'));
  assert.equal(broken.storeText, false); assert.equal(broken.calibration, 'on'); assert.equal(broken.problems.length, 1);
});

test('validatePolicies', () => {
  assert.deepEqual(validatePolicies({ storeText: true, calibration: 'on', calibrationSample: 'raw' }), []);
  assert.equal(validatePolicies({ calibration: true }).length, 1);
});
