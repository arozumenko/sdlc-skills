import { test } from 'node:test';
import assert from 'node:assert/strict';
import { save } from '../src/editor.js';
test('successful save', async () => assert.equal((await save(async () => {})).status, 'saved'));
