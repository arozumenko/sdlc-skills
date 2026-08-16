import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const S=require('./styles.js');
test('every style emits its signature flag vars', () => {
  for (const k of ['material','neo-flat','minimal-neutral','fluent']) {
    const css=S.styleVars(k);
    assert.match(css, /--shadow-1:/, k+' has shadow var');
    assert.match(css, /--border-w:/, k+' has border var');
    assert.match(css, /--radius-scale:/, k+' has radius var');
  }
  assert.match(S.styleVars('neo-flat'), /--shadow-1:\s*none/);   // flat = no shadow
  assert.doesNotMatch(S.styleVars('material'), /--shadow-1:\s*none/);// material has shadow
});
test('unknown style falls back to material', () => {
  assert.strictEqual(S.styleVars('nope'), S.styleVars('material'));
  assert.strictEqual(S.styleVars(undefined), S.styleVars('material'));
});
