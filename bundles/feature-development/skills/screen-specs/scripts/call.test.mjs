// scripts/call.test.mjs
import { test } from 'node:test'; import assert from 'node:assert';
import { createRequire } from 'node:module';
const S=createRequire(import.meta.url)('./screenspec.js');
test('legacy md3/ios and new a/b resolve identically', () => {
  const legacy=S.readCall({topic:'Date',md3:'M',ios:'N',chose:'ios',why:'w'});
  const modern=S.readCall({topic:'Date',a:'M',b:'N',chose:'b',why:'w'});
  assert.deepStrictEqual(legacy, modern);
  assert.strictEqual(legacy.chose,'b');
});
