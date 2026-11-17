import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./ui-read.mjs', import.meta.url));
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
function dump(xml, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ui-read-'));
  try {
    const path = join(dir, 'dump.xml');
    writeFileSync(path, xml);
    return run([path, ...args]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function printed(result, expected) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, expected);
}

test('prints labels, short ids, true flags and bounds with centre', () => {
  printed(dump(`<hierarchy><node text="Save" content-desc="Save item" resource-id="org.example:id/save"
    class="android.widget.Button" selected="true" checked="true" enabled="false" focused="true"
    clickable="true" checkable="true" bounds="[10,20][31,61]"/>
    <node text="Plain" content-desc="Plain" selected="false" checked="false" enabled="true"
    focused="false" clickable="false" bounds="[0,0][10,10]"/></hierarchy>`),
  'r1 "Save" desc="Save item" id=save selected checked disabled focused clickable [10,20][31,61] c=21,41\nr2 "Plain" [0,0][10,10] c=5,5\n');
});

test('keeps nested nodes in document order and omits unlabelled inert nodes', () => {
  printed(dump(`<hierarchy><node class="layout"><node content-desc="Menu"/>
    <node resource-id="plain-id"/><node clickable="true"/><node checkable="true"/>
    <node text="" content-desc="" clickable="false" checkable="false"/></node></hierarchy>`),
  'r2 "Menu"\nr3 "" id=plain-id\nr4 "" clickable\nr5 ""\n');
});

test('decodes XML entities once, including decimal character references', () => {
  const result = dump(`<hierarchy><node text="A&amp;B &lt; &gt; &quot; &apos; &#65; &#128512; &amp;lt;"
    content-desc="a &gt; b" resource-id="org.example:id/a&amp;b"/></hierarchy>`);
  printed(result, 'r1 "A&B < > \\" \' A 😀 &lt;" desc="a > b" id=a&b\n');
});

test('grep matches text, description and full id case-insensitively without renumbering', () => {
  const xml = `<hierarchy><node text="Needle"/><node text="Other" content-desc="NEEDLE"/>
    <node resource-id="needle.app:id/item"/><node text="Skip"/></hierarchy>`;
  printed(dump(xml, ['--grep', 'needLE']), 'r1 "Needle"\nr2 "Other" desc="NEEDLE"\nr3 "" id=item\n');
  printed(dump(xml, ['--grep', 'item']), 'r3 "" id=item\n');
  printed(dump(xml, ['--grep', 'absent']), '');
});

test('valid nodes can produce no output', () => {
  printed(dump('<hierarchy><node class="layout"/></hierarchy>'), '');
});

test('empty dump asks for another read and exits 1', () => {
  for (const xml of ['<hierarchy/>', '<hierarchy></hierarchy>']) {
    const result = dump(xml);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'no nodes (empty dump: wait and read again)\n');
  }
});

test('unreadable files and non-dumps exit 1 with a diagnostic', () => {
  for (const result of [run([join(tmpdir(), 'ui-read-missing', 'dump.xml')]),
    dump('not XML'), dump('<other><node text="Wrong"/></other>')]) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /unreadable|not a uiautomator dump/i);
  }
});

test('usage errors exit 2 and print usage on stderr', () => {
  for (const args of [[], ['--grep', 'x'], ['dump.xml', '--grep'],
    ['dump.xml', '--unknown'], ['dump.xml', 'extra'], ['dump.xml', '--grep', 'x', 'extra']]) {
    const result = run(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage:.*<dump.xml>.*\[--grep TEXT\]/);
  }
});
