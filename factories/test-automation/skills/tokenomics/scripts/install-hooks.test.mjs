// Tests for install-hooks.mjs — idempotent wiring in temp repos; never touches
// this repo's own settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installClaude, installCopilot, installVsCode, installGitHook, gitHooksDir,
  configureOtel, seedConfig, doctor, main, migrateTelemetryLayout,
} from './install-hooks.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tokenomics-install-'));
const REL = '.claude/skills/tokenomics';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('installClaude: marked SessionEnd capture + SessionStart sweep, preserves existing settings, idempotent', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({
    model: 'sonnet',
    hooks: { SessionStart: [{ matcher: '*', hooks: [] }] },
  }));
  installClaude(repo, REL, {});
  installClaude(repo, REL, {}); // second run must not duplicate
  const s = read(join(repo, '.claude', 'settings.json'));
  assert.equal(s.model, 'sonnet', 'unrelated settings preserved');
  assert.equal(s.hooks.SessionEnd.length, 1, 'idempotent');
  assert.equal(s.hooks.SessionEnd[0]._tokenomics, true);
  const endCmd = s.hooks.SessionEnd[0].hooks[0].command;
  assert.ok(endCmd.includes('${CLAUDE_PROJECT_DIR}') && endCmd.includes(`${REL}/hooks/telemetry-capture.mjs`), endCmd);
  assert.equal(s.hooks.SessionStart.length, 3, 'pre-existing SessionStart entry preserved, sweep + announce added once');
  const sweep = s.hooks.SessionStart.find((e) => e._tokenomics && e.hooks[0].command.endsWith('--sweep'));
  assert.ok(sweep, 'start hook sweeps, never captures the opening session');
  assert.equal(sweep.hooks[0].async, true, 'sweep injects no context — background it');
  assert.equal(sweep.matcher, 'startup|resume');
  // Scope contract wiring: announce (sync — its one line must reach context),
  // dispatch marker on BOTH dispatch styles, and the one-time Stop gate.
  const announce = s.hooks.SessionStart.find((e) => e._tokenomics && e.hooks[0].command.includes('--announce'));
  assert.ok(announce && announce.hooks[0].command.includes('scope-hook.mjs'));
  assert.notEqual(announce.hooks[0].async, true, 'announce must be sync to inject the session id');
  const pre = s.hooks.PreToolUse.find((e) => e._tokenomics);
  assert.equal(pre.matcher, 'Agent|Workflow', 'covers sequential dispatches AND Workflow runs');
  assert.ok(pre.hooks[0].command.includes('--mark-dispatch'));
  const stop = s.hooks.Stop.find((e) => e._tokenomics);
  assert.ok(stop.hooks[0].command.includes('--gate'));
  // Measurements update as dispatches finish, not only at session end.
  const subStop = s.hooks.SubagentStop.find((e) => e._tokenomics);
  assert.ok(subStop.hooks[0].command.includes('telemetry-capture.mjs') && subStop.hooks[0].command.includes('--dispatch'));
  assert.equal(subStop.hooks[0].async, true, 'per-dispatch metering must never delay the run');
});

test('installClaude --remove: strips only our entries from both events', () => {
  const repo = tmp();
  installClaude(repo, REL, {});
  const file = join(repo, '.claude', 'settings.json');
  const s = read(file);
  s.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: 'echo other' }] });
  writeFileSync(file, JSON.stringify(s));
  installClaude(repo, REL, { remove: true });
  const after = read(file);
  assert.equal(after.hooks.SessionEnd.length, 1);
  assert.equal(after.hooks.SessionEnd[0].hooks[0].command, 'echo other');
  assert.ok(!after.hooks.SessionStart, 'our sweep entry removed; empty event key dropped');
  assert.ok(!after.hooks.PreToolUse, 'dispatch-marker entry removed');
  assert.ok(!after.hooks.Stop, 'scope-gate entry removed');
});

test('installClaude --local targets settings.local.json', () => {
  const repo = tmp();
  installClaude(repo, REL, { local: true });
  assert.ok(existsSync(join(repo, '.claude', 'settings.local.json')));
  assert.ok(!existsSync(join(repo, '.claude', 'settings.json')));
});

test('installCopilot: sweep + the same three scope moments as Claude; remove deletes it', () => {
  const repo = tmp();
  const rel = '.github/skills/tokenomics';
  installCopilot(repo, rel, {});
  const file = join(repo, '.github', 'hooks', 'tokenomics.json');
  const cfg = read(file);
  assert.equal(cfg.version, 1);
  const entry = cfg.hooks.sessionStart[0];
  assert.ok(entry.bash.includes(`${rel}/hooks/telemetry-capture.mjs" --sweep`), entry.bash);
  assert.equal(entry.env.COPILOT_CLI, '1');
  // Copilot parses hook stdout as JSON — announce must run in --json mode.
  const announce = cfg.hooks.sessionStart[1];
  assert.ok(announce.bash.includes('scope-hook.mjs" --announce --json'), announce.bash);
  assert.ok(cfg.hooks.subagentStart[0].bash.includes('--mark-dispatch'));
  assert.ok(cfg.hooks.subagentStop[0].bash.includes('--dispatch'), 'per-dispatch measurement on Copilot too');
  assert.ok(cfg.hooks.agentStop[0].bash.includes('--gate'));
  // sessionEnd captures the ending session now; older CLIs ignore the event.
  assert.ok(cfg.hooks.sessionEnd[0].bash.includes('--sweep'));
  installCopilot(repo, rel, { remove: true });
  assert.ok(!existsSync(file));
});

// A file that is neither committed nor ignored blocks the pipeline's gate, so
// the installer owns the ignore rules for the transient state it writes — and
// deliberately does NOT ignore the records team reporting depends on.
test('installGitignore: owned block, preserves the rest, idempotent, clean remove', async () => {
  const { installGitignore } = await import('./install-hooks.mjs');
  const repo = tmp();
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.env\n');
  installGitignore(repo);
  installGitignore(repo);                                   // second run must not duplicate
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.match(gi, /^node_modules\/$/m, 'existing rules preserved');
  assert.match(gi, /^\.env$/m);
  assert.equal(gi.match(/tokenomics \(managed\)/g).length, 1, 'idempotent');
  for (const p of ['.agents/telemetry/automation/live/', '.agents/telemetry/automation/scopes/.pending-*', '.agents/telemetry/automation/scopes/.nagged-*']) {
    assert.ok(gi.includes(p), p);
  }
  // the RECORDS must stay committable — ignoring them would kill team reporting
  assert.ok(!/^\.agents\/telemetry\/automation\/$/m.test(gi), 'never ignores the whole telemetry dir');
  assert.ok(!gi.includes('usage-'), 'never ignores the ledger');
  assert.ok(!/scopes\/$/m.test(gi), 'never ignores the scope records themselves');

  installGitignore(repo, { remove: true });
  const after = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.equal(after, 'node_modules/\n.env\n', 'block stripped, the rest untouched');
});

test('installGitignore: creates the file when absent, removes it when only ours', async () => {
  const { installGitignore } = await import('./install-hooks.mjs');
  const repo = tmp();
  installGitignore(repo);
  assert.ok(existsSync(join(repo, '.gitignore')));
  installGitignore(repo, { remove: true });
  assert.ok(!existsSync(join(repo, '.gitignore')), 'no orphan empty file left behind');
});

test('seedConfig: creates defaults once, never overwrites', () => {
  const repo = tmp();
  const cfgPath = seedConfig(repo);
  const first = read(cfgPath);
  assert.equal(first.capturePrompts, false);
  assert.equal(first.priceAtCapture, true);
  writeFileSync(cfgPath, JSON.stringify({ capturePrompts: true }));
  seedConfig(repo);
  assert.equal(read(cfgPath).capturePrompts, true, 'existing config untouched');
});

test('main: refuses a repo that does not contain the installed skill', async () => {
  assert.equal(await main(['--repo', tmp()]), 1);
});

test('installVsCode: folderOpen sweep task, preserves other tasks, idempotent, clean remove', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.vscode'), { recursive: true });
  writeFileSync(join(repo, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{ label: 'build', type: 'shell', command: 'make' }] }));
  installVsCode(repo, REL, {});
  installVsCode(repo, REL, {});
  const cfg = read(join(repo, '.vscode', 'tasks.json'));
  assert.equal(cfg.tasks.length, 2, 'idempotent, build task preserved');
  const ours = cfg.tasks.find((t) => t.label === 'tokenomics: telemetry sweep');
  assert.equal(ours.runOptions.runOn, 'folderOpen');
  assert.ok(ours.args.join(' ').includes('--sweep'));
  installVsCode(repo, REL, { remove: true });
  const after = read(join(repo, '.vscode', 'tasks.json'));
  assert.equal(after.tasks.length, 1);
  assert.equal(after.tasks[0].label, 'build');
});

// The sidebar task is the one thing written into SHARED editor config (and it
// costs every teammate an "allow automatic tasks?" prompt), while every sweep
// already walks the sidebar store — so it is opt-in, and only --remove touches
// it from `all` so an uninstall never leaves it behind. main() refuses a repo
// that does not contain the installed skill (tested below), so the host
// dispatch is pinned at the source, as the workflow scripts' tests do.
test('vscode task is opt-in: excluded from --host all, still stripped by --remove', () => {
  const src = readFileSync(new URL('./install-hooks.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(host === 'all' \|\| host === 'claude'\) touched\.push\(installClaude/);
  assert.match(src, /if \(host === 'all' \|\| host === 'copilot'\) touched\.push\(installCopilot/);
  assert.match(src, /if \(host === 'vscode' \|\| \(remove && host === 'all'\)\) touched\.push\(installVsCode/);
  assert.doesNotMatch(src, /host === 'all' \|\| host === 'vscode'/, 'vscode must not ride the default install');
});

test('installVsCode: remove deletes the file when only our task existed', () => {
  const repo = tmp();
  installVsCode(repo, REL, {});
  assert.ok(existsSync(join(repo, '.vscode', 'tasks.json')));
  installVsCode(repo, REL, { remove: true });
  assert.ok(!existsSync(join(repo, '.vscode', 'tasks.json')));
});

function gitRepo() {
  const repo = tmp();
  execFileSync('git', ['-C', repo, 'init', '-q']);
  return repo;
}

test('installGitHook: installs, never overwrites a foreign hook, removes only ours', () => {
  const repo = gitRepo();
  const r1 = installGitHook(repo, REL, {});
  assert.equal(r1.status, 'installed');
  const txt = readFileSync(r1.file, 'utf8');
  assert.ok(txt.includes('# tokenomics-sweep') && txt.includes('--sweep'));
  assert.equal(installGitHook(repo, REL, {}).status, 'installed', 'reinstall over our own hook is fine');
  assert.equal(installGitHook(repo, REL, { remove: true }).status, 'removed');
  writeFileSync(join(gitHooksDir(repo), 'post-commit'), '#!/bin/sh\necho mine\n');
  assert.equal(installGitHook(repo, REL, {}).status, 'exists-foreign');
  assert.equal(installGitHook(repo, REL, { remove: true }).status, 'not-ours');
  assert.equal(installGitHook(tmp(), REL, {}).status, 'no-git');
});

test('configureOtel: writes exactly its keys across the three surfaces; remove strips only them', () => {
  const repo = tmp();
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet', env: { KEEP: '1' } }));
  mkdirSync(join(repo, '.vscode'), { recursive: true });
  writeFileSync(join(repo, '.vscode', 'settings.json'), JSON.stringify({ 'editor.fontSize': 14 }));
  configureOtel(repo, { endpoint: 'http://localhost:4318' });
  const s = read(join(repo, '.claude', 'settings.json'));
  assert.equal(s.model, 'sonnet');
  assert.equal(s.env.KEEP, '1');
  assert.equal(s.env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.equal(s.env.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/json');
  const v = read(join(repo, '.vscode', 'settings.json'));
  assert.equal(v['editor.fontSize'], 14);
  assert.equal(v['github.copilot.chat.otel.enabled'], true);
  assert.equal(read(join(repo, '.agents', 'telemetry', 'automation', 'config.json')).otel.enabled, true);
  configureOtel(repo, { remove: true });
  const s2 = read(join(repo, '.claude', 'settings.json'));
  assert.equal(s2.env.KEEP, '1');
  assert.ok(!('CLAUDE_CODE_ENABLE_TELEMETRY' in s2.env));
  const v2 = read(join(repo, '.vscode', 'settings.json'));
  assert.equal(v2['editor.fontSize'], 14);
  assert.ok(!('github.copilot.chat.otel.enabled' in v2));
  assert.equal(read(join(repo, '.agents', 'telemetry', 'automation', 'config.json')).otel.enabled, false);
});

test('doctor: runs clean on a temp repo without throwing (warnings expected, hermetic)', async () => {
  const repo = tmp();
  const warns = await doctor(repo, {});
  assert.ok(typeof warns === 'number' && warns >= 1, 'unwired repo reports warnings');
  installClaude(repo, REL, {});
  installCopilot(repo, REL, {});
  installVsCode(repo, REL, {});
  const after = await doctor(repo, {});
  assert.ok(after < warns, 'wiring reduces warnings');
});

// The flat era wrote at the telemetry root; readers look only in automation/.
// Un-migrated history silently vanishes from reports — so every install run
// migrates, idempotently, without ever clobbering newer automation/ data.
test('migrateTelemetryLayout: moves flat-era files into automation/, merges dirs, never clobbers', () => {
  const repo = tmp();
  const root = join(repo, '.agents', 'telemetry');
  mkdirSync(join(root, 'scopes'), { recursive: true });
  writeFileSync(join(root, 'usage-alice.jsonl'), '{"v":1}\n');
  writeFileSync(join(root, 'config.json'), '{}');
  writeFileSync(join(root, 'scopes', 'sess-1.json'), '{}');
  writeFileSync(join(root, 'README.md'), 'seeded');       // submodule seed — must stay put
  // automation/ already holds a NEWER scopes record with a clashing name
  mkdirSync(join(root, 'automation', 'scopes'), { recursive: true });
  writeFileSync(join(root, 'automation', 'scopes', 'sess-1.json'), '{"newer":true}');
  const moved = migrateTelemetryLayout(repo);
  assert.ok(moved >= 2, `usage + config moved (got ${moved})`);
  assert.ok(existsSync(join(root, 'automation', 'usage-alice.jsonl')));
  assert.ok(existsSync(join(root, 'automation', 'config.json')));
  assert.ok(!existsSync(join(root, 'usage-alice.jsonl')), 'nothing left at the flat root');
  assert.equal(readFileSync(join(root, 'automation', 'scopes', 'sess-1.json'), 'utf8'), '{"newer":true}',
    'existing automation/ data wins over the flat-era clash');
  assert.ok(existsSync(join(root, 'README.md')), 'non-telemetry seeds untouched');
  assert.equal(migrateTelemetryLayout(repo), 0, 'idempotent — second run is a no-op');
  assert.equal(migrateTelemetryLayout(tmp()), 0, 'no telemetry dir → quiet no-op');
});
