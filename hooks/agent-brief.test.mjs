// agent-brief (PreToolUse on Agent/Task) saves the dispatch brief; agent-start then
// ranks an over-budget MEMORY.md against it, so a relevant OLD lesson is injected
// instead of being cut by the newest-first slice. Consumer mining (2026-11): with
// newest-only, ~7% of injected lessons applied to the task, and the read-list for
// the rest was opened in ~0 of ~1,500 dispatches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, renameSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = fileURLToPath(new URL('./agent-start', import.meta.url));
const BRIEF = fileURLToPath(new URL('./agent-brief', import.meta.url));
const UID = process.getuid ? process.getuid() : 'u';

const OLD = '- [Early](early.md) — Pricing changes (src/pricing.js): run `node tools/audit-rounding.mjs` before committing.\n';
const filler = (i) => `- [Build ${i}](build_${i}.md) — Re-check the build cache state after changes; a cached output once hid failure ${i}.\n`;

function project(lines = Array.from({ length: 150 }, (_, i) => filler(i)).join('')) {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-brief-'));
  const mem = join(dir, '.agents', 'memory', 'js-dev');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'MEMORY.md'), `# Memory index — js-dev\n\n${OLD}${lines}`);
  return { dir, tmp: mkdtempSync(join(tmpdir(), 'sdlc-spool-')) };
}
const env = (p, extra = {}) => ({ ...process.env, CLAUDE_PROJECT_DIR: p.dir, TMPDIR: p.tmp, COPILOT_CLI: '', CODEX_HOOK: '', SDLC_HOOK_RAW: '', ...extra });
const brief = (p, role, prompt, session = 's1', extra = {}) => execFileSync('bash', [BRIEF], { input: JSON.stringify({ session_id: session, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: role, description: 'x', prompt } }), env: env(p, extra), encoding: 'utf8' });
const start = (p, role = 'js-dev', session = 's1', extra = {}) => JSON.parse(execFileSync('bash', [START], { input: JSON.stringify({ session_id: session, agent_type: role }), env: env(p, extra), encoding: 'utf8' })).hookSpecificOutput.additionalContext;
const root = (p) => join(p.tmp, `sdlc-skills-briefs-${UID}`);
function spoolDirs(p) {
  const r = root(p); const out = [];
  try { for (const k of readdirSync(r)) for (const s of readdirSync(join(r, k))) out.push(join(r, k, s)); } catch { /* none */ }
  return out;
}
const payloads = (p) => spoolDirs(p).flatMap((d) => readdirSync(d).filter((f) => /\.\d+\.\d+$/.test(f)).map((f) => join(d, f)));
const spool = (p) => payloads(p).filter((f) => !existsSync(`${f}.claim`));   // unclaimed (pending) briefs
const PRICING = 'Fix bug B-12. The pricing rules are in docs/pricing.md; keep priceOrder exported from src/pricing.js.';

test('agent-brief prints nothing (no decision) and spools one private file per dispatch', () => {
  const p = project();
  assert.equal(brief(p, 'js-dev', PRICING), '');
  const files = spool(p);
  assert.equal(files.length, 1);
  assert.match(files[0], /js-dev\.\d+\.\d+$/);
  assert.equal(statSync(root(p)).mode & 0o777, 0o700, 'spool root is 0700');
  assert.equal(statSync(files[0]).mode & 0o077, 0, 'brief is not readable by group/other');
});

test('the same payload spooled twice in one second (plugin + settings wiring) is one file', () => {
  const p = project();
  const now = { SDLC_TEST_NOW: String(Math.floor(Date.now() / 1000)) };
  brief(p, 'js-dev', PRICING, 's1', now); brief(p, 'js-dev', PRICING, 's1', now);
  assert.equal(spool(p).length, 1);
});

test('without a brief the slice is newest-only: the old lesson is cut', () => {
  const p = project();
  const c = start(p);
  assert.doesNotMatch(c, /audit-rounding/);
  assert.match(c, /\(LAST \d+ ENTRIES, newest/);
});

test('with a matching brief the old lesson is injected, within the cap, and the brief is consumed', () => {
  const p = project();
  brief(p, 'js-dev', PRICING);
  const c = start(p);
  assert.match(c, /audit-rounding/);
  assert.match(c, /\d+ ENTRIES: 1 MATCHING THIS TASK \+ THE NEWEST/);
  assert.match(c, /Build 149/, 'newest lines still fill the rest');
  assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 9000, 'escaped payload stays under the default cap');
  assert.equal(spool(p).length, 0);
  assert.doesNotMatch(start(p), /audit-rounding/, 'a second dispatch does not reuse the brief');
});

test('tab-indented and control-character lines are sized as emitted: payload stays under the cap', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `\t- [T ${i}](t_${i}.md) — \t"quoted"\\path\x01 pricing-free filler ${i}\t\n`).join('');
  const p = project(lines);
  brief(p, 'js-dev', PRICING);
  const c = start(p);
  assert.match(c, /audit-rounding/);
  assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 9000, `escaped payload ${Buffer.byteLength(JSON.stringify(c))} > 9000`);
});

test('a brief for another role is left for that role', () => {
  const p = project();
  brief(p, 'qa-engineer', 'Verify src/pricing.js rounding');
  assert.doesNotMatch(start(p), /audit-rounding/);
  assert.equal(spool(p).length, 1);
});

test('briefs are per session: another session never pairs with them', () => {
  const p = project();
  brief(p, 'js-dev', PRICING, 'session-A');
  assert.doesNotMatch(start(p, 'js-dev', 'session-B'), /audit-rounding/);
  assert.match(start(p, 'js-dev', 'session-A'), /audit-rounding/);
});

test('briefs from different seconds pair in order (oldest first)', () => {
  const p = project();
  brief(p, 'js-dev', 'Update the README wording');
  const [first] = spool(p);
  renameSync(first, first.replace(/\.(\d+)\.(\d+)$/, (_, s, h) => `.${Number(s) - 5}.${h}`));
  brief(p, 'js-dev', 'Fix rounding in src/pricing.js');
  assert.doesNotMatch(start(p), /audit-rounding/, 'first dispatch gets the README brief');
  assert.match(start(p), /audit-rounding/, 'second dispatch gets the pricing brief');
});

test('same-second siblings are ambiguous: each dispatch ranks against all of them', () => {
  const p = project();
  brief(p, 'js-dev', 'Update the README wording');
  brief(p, 'js-dev', 'Fix rounding in src/pricing.js');
  const files = spool(p);
  const sec = files[0].match(/\.(\d+)\.\d+$/)[1];
  for (const f of files) renameSync(f, f.replace(/\.(\d+)\.(\d+)$/, (_, s, h) => `.${sec}.${h}`));
  assert.match(start(p), /audit-rounding/);
  assert.match(start(p), /audit-rounding/);
  assert.equal(spool(p).length, 0);
});

test('two agent-starts racing for one brief: exactly one claims it', async () => {
  const p = project();
  brief(p, 'js-dev', PRICING);
  const { spawn } = await import('node:child_process');
  const runOne = () => new Promise((res) => {
    const ch = spawn('bash', [START], { env: env(p) });
    let out = ''; ch.stdout.on('data', (d) => { out += d; });
    ch.on('close', () => res(JSON.parse(out).hookSpecificOutput.additionalContext));
    ch.stdin.end(JSON.stringify({ session_id: 's1', agent_type: 'js-dev' }));
  });
  const outs = await Promise.all([runOne(), runOne(), runOne()]);
  assert.equal(outs.filter((c) => /audit-rounding/.test(c)).length, 1);
});

test('expiry is 600 s: 597 s is paired (3 s slack for a loaded runner), 600 and 601 s are discarded', () => {
  for (const [age, paired] of [[597, true], [600, false], [601, false]]) {
    const p = project();
    brief(p, 'js-dev', PRICING);
    const [f] = spool(p);
    const now = Math.floor(Date.now() / 1000);
    renameSync(f, f.replace(/\.(\d+)\.(\d+)$/, (_, s, h) => `.${now - age}.${h}`));
    if (paired) assert.match(start(p), /audit-rounding/, `${age}s should pair`);
    else { assert.doesNotMatch(start(p), /audit-rounding/, `${age}s should expire`); assert.equal(spool(p).length, 0); }
  }
});

test('role names that are not plain are refused', () => {
  const p = project();
  for (const r of ['../evil', '-rf', 'a.b', 'a\\b', 'a\nb', '']) assert.equal(brief(p, r, 'x'), '');
  assert.equal(spool(p).length, 0);
});

test('a spool dir that is a symlink is refused: nothing is written through it', () => {
  const p = project();
  const elsewhere = mkdtempSync(join(tmpdir(), 'sdlc-elsewhere-'));
  symlinkSync(elsewhere, root(p));
  brief(p, 'js-dev', PRICING);
  assert.equal(readdirSync(elsewhere).length, 0);
  rmSync(root(p));
});

test('other hosts do not consume Claude briefs', () => {
  const p = project();
  brief(p, 'js-dev', PRICING);
  start(p, 'js-dev', 's1', { CODEX_HOOK: '1' });
  assert.equal(spool(p).length, 1, 'Codex agent-start left the brief');
});

test('an oversized brief (2 MB) is truncated and kept, not lost', () => {
  const p = project();
  brief(p, 'js-dev', `${PRICING} ${'x'.repeat(2 * 1024 * 1024)}`);
  assert.equal(spool(p).length, 1);
  assert.ok(statSync(spool(p)[0]).size <= 20000);
  assert.match(start(p), /audit-rounding/);
});

test('a same-second duplicate arriving after the first copy was consumed is not re-published', () => {
  const p = project();
  const now = { SDLC_TEST_NOW: String(Math.floor(Date.now() / 1000)) };
  brief(p, 'js-dev', PRICING, 's1', now);
  assert.match(start(p, 'js-dev', 's1', now), /audit-rounding/);
  brief(p, 'js-dev', PRICING, 's1', now);   // the late second wiring of the same dispatch
  assert.equal(spool(p).length, 0);
});

test('concurrent starts over distinct same-second siblings: each claims one, each ranks against all', async () => {
  const p = project();
  brief(p, 'js-dev', 'Update the README wording');
  brief(p, 'js-dev', 'Tidy the changelog headings');
  brief(p, 'js-dev', 'Fix rounding in src/pricing.js');
  const files = spool(p);
  const sec = files[0].match(/\.(\d+)\.\d+$/)[1];
  for (const f of files) renameSync(f, f.replace(/\.(\d+)\.(\d+)$/, (_, s, h) => `.${sec}.${h}`));
  const { spawn } = await import('node:child_process');
  const runOne = () => new Promise((res) => {
    const ch = spawn('bash', [START], { env: env(p) });
    let out = ''; ch.stdout.on('data', (d) => { out += d; });
    ch.on('close', () => res(JSON.parse(out).hookSpecificOutput.additionalContext));
    ch.stdin.end(JSON.stringify({ session_id: 's1', agent_type: 'js-dev' }));
  });
  const outs = await Promise.all([runOne(), runOne(), runOne()]);
  assert.equal(outs.filter((c) => /audit-rounding/.test(c)).length, 3, 'every same-second dispatch sees the pricing lesson');
  assert.equal(spool(p).length, 0, 'all three claimed exactly once');
  assert.equal(payloads(p).filter((f) => existsSync(`${f}.claim`)).length, 3);
});

test('concurrent first publishers on a fresh spool all land', async () => {
  const p = project();
  const { spawn } = await import('node:child_process');
  const pub = (i) => new Promise((res) => {
    const ch = spawn('bash', [BRIEF], { env: env(p) });
    ch.on('close', res);
    ch.stdin.end(JSON.stringify({ session_id: 's1', tool_input: { subagent_type: 'js-dev', prompt: `task ${i}` } }));
  });
  await Promise.all([0, 1, 2, 3, 4, 5].map(pub));
  assert.equal(spool(p).length, 6);
});
