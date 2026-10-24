import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../src/editor.js';
test('save prepares text', async () => {
  const writes = [];
  const editor = createEditor(s => s.trim(), s => { writes.push(s); });
  await editor.saveAs(' new ');
  assert.deepEqual(writes, ['new']);
});
