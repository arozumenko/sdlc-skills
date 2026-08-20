import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const S=require('./screenspec.js');
test('device resolution', () => {
  assert.strictEqual(S.deviceOf({}).id,'iphone');            // default
  assert.strictEqual(S.deviceOf({device:'nope'}).id,'iphone');// fallback
  assert.strictEqual(S.deviceOf({device:'android'}).id,'android');
  assert.strictEqual(S.deviceOf({device:'iphone'}).w, 390);  // today's width
  assert.ok(S.deviceOf({device:'iphone-max'}).w > 390);
});
