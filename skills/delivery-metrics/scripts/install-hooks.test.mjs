import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installClaude, installIgnoreBlocks, doctorReport, bootstrapTelemetry, MARKER } from './install-hooks.mjs';
import { UNCONDITIONAL_CAVEATS } from './lib/report.mjs';

const SCRIPT = fileURLToPath(new URL('./install-hooks.mjs', import.meta.url));
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
const tmp = () => { const r = mkdtempSync(join(tmpdir(), 'dm-install-')); g(r, 'init', '-q', '-b', 'main'); g(r, 'commit', '-q', '--allow-empty', '-m', 'root'); return r; };
const REL = '.claude/skills/delivery-metrics';

test('installClaude: marked entry, foreign entries and later user edits preserved, idempotent, --remove strips ours only', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { SubagentStop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node tok.mjs --dispatch', timeout: 60, async: true }], _tokenomics: true }] } }, null, 2));
  const file = installClaude(repo, REL, {}); let s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.SubagentStop.length, 2); const ours = s.hooks.SubagentStop.find((e) => e[MARKER]); assert.match(ours.hooks[0].command, /dispatch-hook\.mjs" --stop$/); assert.equal(ours.hooks[0].async, true); assert.equal(ours.hooks[0].timeout, 30);
  assert.deepEqual(s.permissions, { allow: ['Bash(npm test)'] });
  installClaude(repo, REL, {}); s = JSON.parse(readFileSync(file, 'utf8')); assert.equal(s.hooks.SubagentStop.length, 2);
  s.hooks.SubagentStop.push({ matcher: 'x', hooks: [], note: 'user edit after install' }); writeFileSync(file, JSON.stringify(s));
  installClaude(repo, REL, { remove: true }); s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.SubagentStop.length, 2); assert.ok(s.hooks.SubagentStop.some((e) => e._tokenomics)); assert.ok(s.hooks.SubagentStop.some((e) => e.note)); assert.ok(!s.hooks.SubagentStop.some((e) => e[MARKER]));
  assert.match(installClaude(repo, REL, { local: true }), /settings\.local\.json$/);
});

test('installIgnoreBlocks: root block replaced in place beside other owners; inner block created when the telemetry dir exists; remove strips ours only', () => {
  const repo = tmp();
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n# >>> tokenomics (managed)\n.agents/telemetry/automation/live/\n# <<< tokenomics\n');
  let r = installIgnoreBlocks(repo, {}); assert.equal(r.inner, 'skipped (no .agents/telemetry)');
  let gi = readFileSync(join(repo, '.gitignore'), 'utf8'); assert.match(gi, /# >>> delivery-metrics \(managed\)[\s\S]*\.agents\/telemetry\/delivery\/\.lock\/[\s\S]*# <<< delivery-metrics/); assert.match(gi, /tokenomics \(managed\)/);
  installIgnoreBlocks(repo, {}); assert.equal((readFileSync(join(repo, '.gitignore'), 'utf8').match(/delivery-metrics \(managed\)/g) || []).length, 1);
  mkdirSync(join(repo, '.agents', 'telemetry'), { recursive: true });
  r = installIgnoreBlocks(repo, {}); assert.equal(r.inner, 'installed'); assert.match(readFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), 'utf8'), /\/delivery\/reports\//, 'created even though no inner .gitignore existed');
  installIgnoreBlocks(repo, { remove: true }); gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(!/delivery-metrics/.test(gi)); assert.match(gi, /node_modules/); assert.match(gi, /tokenomics/); assert.ok(!/delivery/.test(readFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), 'utf8')));
});

test('bootstrapTelemetry: creates the self-referential submodule on the telemetry branch, keeps interim files, idempotent', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.agents', 'telemetry', 'delivery'), { recursive: true }); writeFileSync(join(repo, '.agents', 'telemetry', 'delivery', 'events-u.jsonl'), '{"v":2}\n');
  assert.equal(bootstrapTelemetry(repo).status, 'created');
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', '.git'))); assert.equal(g(repo, 'rev-parse', '--verify', 'refs/heads/telemetry').length, 40);
  assert.match(readFileSync(join(repo, '.gitmodules'), 'utf8'), /ignore = all/); assert.equal(g(join(repo, '.agents', 'telemetry'), 'branch', '--show-current'), 'telemetry');
  assert.ok(existsSync(join(repo, '.agents', 'telemetry', 'delivery', 'events-u.jsonl')), 'interim file restored'); assert.ok(existsSync(join(repo, '.agents', 'telemetry', '.gitignore')));
  assert.equal(bootstrapTelemetry(repo).status, 'already');
  assert.equal(bootstrapTelemetry(mkdtempSync(join(tmpdir(), 'nogit-'))).status, 'no-git');
});

test('installer and doctor use the same main owner from a linked worktree', () => {
  const repo = tmp();
  const wt = join(mkdtempSync(join(tmpdir(), 'dm-linked-')), 'linked'); g(repo, 'commit', '-q', '--allow-empty', '-m', 'init'); g(repo, 'worktree', 'add', '-q', '-b', 'linked', wt);
  execFileSync('node', [SCRIPT, '--no-submodule'], { cwd: wt, env: { ...process.env, CLAUDE_PROJECT_DIR: wt } });
  assert.equal(existsSync(join(repo, '.claude', 'settings.json')), true);
  assert.equal(existsSync(join(wt, '.claude', 'settings.json')), false);
  assert.deepEqual(doctorReport(wt, 'skills/delivery-metrics'), doctorReport(repo, 'skills/delivery-metrics'));
});

test('doctorReport: wiring, plans, every ignore pattern in its owner, tracked transients, git state, caveats', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  let d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => /hook: not wired/.test(l))); assert.ok(d.lines.some((l) => /plans: 0 open/.test(l))); assert.ok(d.lines.some((l) => /telemetry: plain-dir/.test(l))); assert.equal(d.ok, false);
  bootstrapTelemetry(repo); installClaude(repo, REL, {}); installIgnoreBlocks(repo, {});
  d = doctorReport(repo, REL);
  // F6: proving fixture for the blocker — after bootstrap turns .agents/telemetry into a real
  // submodule, a naive `git check-ignore -q <probe>` from the MAIN repo hits git's
  // "Pathspec '...' is in submodule" refusal and silently reports 0/3. This must read 3/3.
  assert.ok(d.lines.some((l) => /hook: wired/.test(l))); assert.ok(d.lines.some((l) => /ignore root: ok \(3\/3\)/.test(l))); assert.ok(d.lines.some((l) => /ignore inner: ok \(3\/3\)/.test(l))); assert.ok(d.lines.some((l) => /telemetry: submodule/.test(l))); assert.ok(d.lines.some((l) => /caveat: concurrency: best-effort/.test(l)));
  // F6: disposable-index staging check — proves git would actually skip these paths on a real
  // `add -A` in the telemetry repo (not just that a pattern string matches).
  assert.ok(d.lines.some((l) => /^staging: ok/.test(l)));
  // F6: git-state inspection, diagnostic only — never modifies the telemetry repo.
  assert.ok(d.lines.some((l) => /^telemetry git: unmerged=0 merging=false dirty=false/.test(l)));
  // F19: every unconditional caveat from the shared list is printed, not a hand-picked subset.
  for (const c of UNCONDITIONAL_CAVEATS) assert.ok(d.lines.includes(`caveat: ${c}`), `missing caveat: ${c}`);
  mkdirSync(join(repo, '.agents', 'telemetry', 'delivery', 'reports'), { recursive: true }); writeFileSync(join(repo, '.agents', 'telemetry', 'delivery', 'reports', 'x.html'), 'x');
  g(join(repo, '.agents', 'telemetry'), 'add', '-f', 'delivery/reports/x.html');
  d = doctorReport(repo, REL); assert.ok(d.lines.some((l) => /tracked transients: 1/.test(l))); assert.equal(d.ok, false);
});

test('doctorReport: git-state surfaces an unmerged conflict and a dirty tree in the telemetry repo without touching either', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  bootstrapTelemetry(repo); installClaude(repo, REL, {}); installIgnoreBlocks(repo, {});
  const tel = join(repo, '.agents', 'telemetry');
  writeFileSync(join(tel, 'README.md'), 'dirty edit\n');
  const d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => /^telemetry git: unmerged=0 merging=false dirty=true/.test(l)));
  // g() trims output, so the leading unstaged-status space is gone; the surviving 'M' (not
  // staged-and-unstaged 'MM', and not committed away) proves doctor read but never touched it.
  assert.equal(g(tel, 'status', '--porcelain'), 'M README.md', 'doctor must never stage/commit/discard — dirty state left exactly as found');
  assert.equal(g(tel, 'diff', '--cached'), '', 'doctor must never stage the dirty file');
});

test('script: --host copilot exits 2 UNSUPPORTED-HOST; default installs and prints INSTALLED', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  let code = 0, err = ''; try { execFileSync('node', [SCRIPT, '--host', 'copilot'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; err = e.stderr; }
  assert.equal(code, 2); assert.match(err, /^UNSUPPORTED-HOST\(copilot\)/);
  const out = execFileSync('node', [SCRIPT, '--no-submodule'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(out, /INSTALLED .*settings\.json/); assert.match(out, /telemetry: plain-dir/); assert.ok(existsSync(join(repo, '.claude', 'settings.json')));
});
