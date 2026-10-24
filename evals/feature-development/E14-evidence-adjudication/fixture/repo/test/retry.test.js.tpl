import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/editor.js';
test('retry sends the edited draft', () => {
  assert.equal(retry({ draft: 'edited', cached: 'old' }, value => value), 'edited');
});
