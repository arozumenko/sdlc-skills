import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installClaude, installIgnoreBlocks, doctorReport, bootstrapTelemetry, MARKER } from './install-hooks.mjs';
import { UNCONDITIONAL_CAVEATS } from './lib/report.mjs';
import { runPath, sessionPath, sessionsDir } from './lib/paths.mjs';

const SCRIPT = fileURLToPath(new URL('./install-hooks.mjs', import.meta.url));
const DELIVERY = fileURLToPath(new URL('./delivery.mjs', import.meta.url));
const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...ENV } }).trim();
const tmp = () => { const r = mkdtempSync(join(tmpdir(), 'dm-install-')); g(r, 'init', '-q', '-b', 'main'); g(r, 'commit', '-q', '--allow-empty', '-m', 'root'); return r; };
const REL = '.claude/skills/delivery-metrics';
/** Seeds the telemetry branch (via plumbing, no checkout) with a single file at `name` — used to
 * force a stash collision in bootstrapTelemetry without an actual clone. */
const seedTelemetryBranchFile = (repo, name, content) => {
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: content, encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  const tree = execFileSync('git', ['mktree'], { cwd: repo, input: `100644 blob ${blob}\t${name}\n`, encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  g(repo, 'update-ref', 'refs/heads/telemetry', g(repo, 'commit-tree', tree, '-m', 'seed collide'));
};

test('installClaude: marked entry, foreign entries and later user edits preserved, idempotent, --remove strips ours only', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { SubagentStop: [{ matcher: '*', hooks: [{ type: 'command', command: 'node tok.mjs --dispatch', timeout: 60, async: true }], _tokenomics: true }] } }, null, 2));
  const file = installClaude(repo, REL, {}); let s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.hooks.SubagentStop.length, 2); const ours = s.hooks.SubagentStop.find((e) => e[MARKER]); assert.match(ours.hooks[0].command, /dispatch-hook\.mjs" --stop$/); assert.ok(ours.hooks[0].command.startsWith('node "${CLAUDE_PROJECT_DIR}/') && ours.hooks[0].command.includes(`${REL}/hooks/dispatch-hook.mjs`), ours.hooks[0].command); assert.equal(ours.hooks[0].async, true); assert.equal(ours.hooks[0].timeout, 30);
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
  // Review fix: the inner .gitignore also seeds tokenomics' four base transient lines (plain,
  // outside our managed block) so a delivery-metrics-only install still ignores tokenomics'
  // transients, alongside our own managed block.
  const innerGi = readFileSync(join(repo, '.agents', 'telemetry', '.gitignore'), 'utf8');
  for (const l of ['*/live/', '*/scopes/.pending-*', '*/scopes/.nagged-*', '*/scopes/.unclosed-*']) assert.ok(innerGi.split('\n').includes(l), `missing tokenomics base line ${l}`);
  assert.match(innerGi, /# >>> delivery-metrics \(managed\)[\s\S]*\/delivery\/reports\/[\s\S]*# <<< delivery-metrics/, 'our own managed block also present');
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

test('F6 fallback: when check-ignore refuses, the fallback reads the real .gitignore (present vs absent pattern), not a tautological probe-vs-itself check', () => {
  // A plain (non-git) directory: `git check-ignore --no-index` refuses with "not a git repository"
  // for every probe, forcing every ROOT_PATTERNS check through the fallback.
  const dir = mkdtempSync(join(tmpdir(), 'dm-norepo-'));
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.agents/telemetry/delivery/reports/\nsomething/else/\n');
  const d = doctorReport(dir, REL);
  // Exactly one of the three ROOT_PATTERNS is a literal line in that file. A tautological
  // probe-derived-from-the-same-pattern check would read either 0/3 or 3/3 regardless of content;
  // reading the real file must land on 1/3.
  assert.ok(d.lines.some((l) => /^ignore root: MISSING \(1\/3\) \(pattern-check\)$/.test(l)), d.lines.join('\n'));
});

test('F6 fallback: a missing .gitignore during the fallback is undetermined, not a false ok/MISSING', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-norepo-'));
  const d = doctorReport(dir, REL);
  assert.ok(d.lines.some((l) => /^ignore root: undetermined \(git refused: .+\)$/.test(l)), d.lines.join('\n'));
  assert.equal(d.ok, false);
});

test('bootstrapTelemetry: an interim file colliding with a name already on the telemetry branch is stranded in the stash dir, surfaced by doctor', () => {
  const repo = tmp();
  seedTelemetryBranchFile(repo, 'collide.txt', 'from branch\n');
  mkdirSync(join(repo, '.agents', 'telemetry'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'telemetry', 'collide.txt'), 'interim content\n');
  assert.equal(bootstrapTelemetry(repo).status, 'created');
  const stash = join(repo, '.agents', 'telemetry.pre-submodule');
  assert.ok(existsSync(stash), 'stash dir left behind for the colliding file');
  assert.equal(readFileSync(join(stash, 'collide.txt'), 'utf8'), 'interim content\n');
  const d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => l === 'stranded interim files: 1 in .agents/telemetry.pre-submodule (collide.txt) — move the files back by hand, then rm -r .agents/telemetry.pre-submodule'), d.lines.join('\n'));
  assert.equal(d.ok, false);
});

test('installClaude --remove never creates settings.json (or settings.local.json) when none existed', () => {
  const repo = tmp();
  const file = installClaude(repo, REL, { remove: true });
  assert.equal(existsSync(file), false);
  const localFile = installClaude(repo, REL, { remove: true, local: true });
  assert.equal(existsSync(localFile), false);
});

// Review fix (spec §6.5/D21): doctor always exits 0, whether or not it is `ok` — `ok` is purely
// informational, surfaced as the trailing `doctor: ok`/`doctor: attention` line. This replaces the
// earlier "doctor exits 1 when not ok" contract.
test('doctor always exits 0, not ok — both the standalone script and `delivery.mjs doctor` — with an informational doctor: ok/attention line', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  const notOk = execFileSync('node', [SCRIPT, '--doctor'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(notOk, /doctor: attention/);
  const dNotOk = execFileSync('node', [DELIVERY, 'doctor'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(dNotOk, /doctor: attention/);
  execFileSync('node', [SCRIPT, '--no-submodule'], { cwd: repo, env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  const okOut = execFileSync('node', [SCRIPT, '--doctor'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(okOut, /doctor: ok/);
  const dOkOut = execFileSync('node', [DELIVERY, 'doctor'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(dOkOut, /doctor: ok/);
});

test('doctorReport: git-state surfaces a dirty telemetry tree without touching it (no unmerged/merging state exercised here)', () => {
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

test('doctorReport: per-open-run roster validity (tampered map_sha256 → INVALID) and per-session ok/closed/missing lines', () => {
  const repo = tmp();
  const cli = (...args) => execFileSync('node', [DELIVERY, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo, DELIVERY_NO_SYNC: '1' } });
  const block = (runId, ref) => ({ campaign_id: 'sec', run_id: runId, version: 1, factory: 'feature-development', observation_start: '2026-09-14T00:00:00Z', source_epoch: { from: '2026-09-14T00:00:00Z', until: null, integration_ref: 'main' }, campaign: { ref: 'sec' }, mission_kind: 'group', missions: [{ ref: 'G1', sequence: 1, tasks: [{ ref }] }] });
  const write = (name, obj) => { writeFileSync(join(repo, name), `\`\`\`json delivery-plan\n${JSON.stringify(obj)}\n\`\`\`\n`); return name; };
  cli('plan', 'register', '--from', write('p1.md', block('run-1', 'TASK-001')), '--id', 'reg-1', '--created-at', '2026-09-14T00:00:00Z');
  cli('plan', 'register', '--from', write('p2.md', block('run-2', 'TASK-002')), '--id', 'reg-2', '--created-at', '2026-09-14T00:00:00Z');
  cli('session', 'set', '--host', 'claude', '--session', 's1', '--plan', 'sec/run-1');
  cli('session', 'set', '--host', 'claude', '--session', 's2', '--plan', 'sec/run-2');
  // A session file can name a plan that no longer resolves (e.g. an orphaned/hand-edited file) —
  // `session set` itself always validates the plan exists, so this is written directly.
  mkdirSync(sessionsDir(repo), { recursive: true });
  writeFileSync(sessionPath(repo, 'claude', 'ghost'), `${JSON.stringify({ host: 'claude', session: 'ghost', plan: 'sec/does-not-exist', at: '2026-09-14T00:00:00.000Z' })}\n`);
  cli('plan', 'close', '--plan', 'sec/run-2');
  // Tamper run-1's saved roster snapshot — a stale/hand-edited `map_sha256` must be caught by
  // `validRoster`, not silently trusted.
  const runFile = runPath(repo, 'sec/run-1');
  const rec = JSON.parse(readFileSync(runFile, 'utf8'));
  rec.roster = { ...rec.roster, map_sha256: 'deadbeef'.repeat(8) };
  writeFileSync(runFile, `${JSON.stringify(rec, null, 2)}\n`);
  const d = doctorReport(repo, REL);
  assert.ok(d.lines.some((l) => /^roster: sec\/run-1 INVALID \(refresh with plan roster\)$/.test(l)), d.lines.join('\n'));
  // run-2 is closed, so it no longer appears in the open-run roster check.
  assert.ok(!d.lines.some((l) => l.startsWith('roster: sec/run-2 ')));
  assert.ok(d.lines.some((l) => l === 'session: claude:s1 -> sec/run-1 ok'), d.lines.join('\n'));
  assert.ok(d.lines.some((l) => l === 'session: claude:s2 -> sec/run-2 closed'), d.lines.join('\n'));
  assert.ok(d.lines.some((l) => l === 'session: claude:ghost -> sec/does-not-exist missing'), d.lines.join('\n'));
  assert.equal(d.ok, false);
  assert.match(d.lines.join('\n'), /doctor: attention/);
});

test('script: --host copilot exits 2 UNSUPPORTED-HOST; default installs and prints INSTALLED', () => {
  const repo = tmp(); mkdirSync(join(repo, '.claude'), { recursive: true });
  let code = 0, err = ''; try { execFileSync('node', [SCRIPT, '--host', 'copilot'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; err = e.stderr; }
  assert.equal(code, 2); assert.match(err, /^UNSUPPORTED-HOST\(copilot\)/);
  const out = execFileSync('node', [SCRIPT, '--no-submodule'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  assert.match(out, /INSTALLED .*settings\.json/); assert.match(out, /telemetry: plain-dir/); assert.ok(existsSync(join(repo, '.claude', 'settings.json')));
});
