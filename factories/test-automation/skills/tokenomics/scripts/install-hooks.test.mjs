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
  configureOtel, seedConfig, doctor, main,
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
  assert.equal(s.hooks.SessionStart.length, 2, 'pre-existing SessionStart entry preserved, ours added once');
  const sweep = s.hooks.SessionStart.find((e) => e._tokenomics);
  assert.ok(sweep.hooks[0].command.endsWith('--sweep'), 'start hook sweeps, never captures the opening session');
  assert.equal(sweep.hooks[0].async, true, 'sweep injects no context — background it');
  assert.equal(sweep.matcher, 'startup|resume');
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
});

test('installClaude --local targets settings.local.json', () => {
  const repo = tmp();
  installClaude(repo, REL, { local: true });
  assert.ok(existsSync(join(repo, '.claude', 'settings.local.json')));
  assert.ok(!existsSync(join(repo, '.claude', 'settings.json')));
});

test('installCopilot: standalone hooks file with sweep command; remove deletes it', () => {
  const repo = tmp();
  const rel = '.github/skills/tokenomics';
  installCopilot(repo, rel, {});
  const file = join(repo, '.github', 'hooks', 'tokenomics.json');
  const cfg = read(file);
  assert.equal(cfg.version, 1);
  const entry = cfg.hooks.sessionStart[0];
  assert.ok(entry.bash.includes(`${rel}/hooks/telemetry-capture.mjs" --sweep`), entry.bash);
  assert.equal(entry.env.COPILOT_CLI, '1');
  installCopilot(repo, rel, { remove: true });
  assert.ok(!existsSync(file));
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
  assert.equal(read(join(repo, '.agents', 'telemetry', 'config.json')).otel.enabled, true);
  configureOtel(repo, { remove: true });
  const s2 = read(join(repo, '.claude', 'settings.json'));
  assert.equal(s2.env.KEEP, '1');
  assert.ok(!('CLAUDE_CODE_ENABLE_TELEMETRY' in s2.env));
  const v2 = read(join(repo, '.vscode', 'settings.json'));
  assert.equal(v2['editor.fontSize'], 14);
  assert.ok(!('github.copilot.chat.otel.enabled' in v2));
  assert.equal(read(join(repo, '.agents', 'telemetry', 'config.json')).otel.enabled, false);
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
