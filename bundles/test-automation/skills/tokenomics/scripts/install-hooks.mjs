#!/usr/bin/env node
// install-hooks.mjs — wire (or unwire) the tokenomics capture hook in a
// consumer repo, idempotently. The skill is installed by the sdlc-skills
// installer like any other; THIS script is the explicit opt-in that turns
// capture on — telemetry never activates just by being on disk.
//
//   node <skill>/scripts/install-hooks.mjs [--host all|claude|copilot]
//                                          [--local] [--remove] [--repo <root>]
//
// Claude Code:  adds a SessionEnd entry to .claude/settings.json (shared — the
//               whole team captures once it's committed). --local targets
//               .claude/settings.local.json instead (just you).
// Copilot CLI:  writes .github/hooks/tokenomics.json with a sessionStart sweep
//               (Copilot's stream has no documented session-end hook; the sweep
//               harvests each COMPLETED session on the next session's start).
// Both paths point at hooks/telemetry-capture.mjs inside THIS installed skill —
// the script self-locates, so it works wherever the skill was installed.
//
// Beyond wiring: `--host vscode` adds a folderOpen auto-task (the sidebar's
// "session start hook" — VS Code asks permission once per folder),
// `--git-hook` adds a host-agnostic post-commit sweep, `--otel` writes the
// OpenTelemetry opt-in (Claude settings env + workspace VS Code settings +
// telemetry config), and `--doctor` health-checks the whole telemetry path.
//
// STDLIB ONLY.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKER = '_tokenomics';
const TASK_LABEL = 'tokenomics: telemetry sweep';
const GIT_MARKER = '# tokenomics-sweep';

export function skillRootOf(scriptUrl = import.meta.url) {
  return dirname(dirname(fileURLToPath(scriptUrl))); // scripts/ -> skill root
}

const posix = (p) => p.split('\\').join('/');

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

/**
 * Claude: splice our entries into settings hooks; remove strips them.
 * Two entries: SessionEnd captures the ending session (freshest data, priced
 * while the transcript is guaranteed alive), and SessionStart runs a bounded
 * sweep so sessions that never ended cleanly (killed terminal) are harvested
 * the moment anyone opens the repo again — same rhythm as the Copilot side.
 * The start sweep injects no context, so it runs async where supported.
 */
export function installClaude(repo, rel, { local = false, remove = false } = {}) {
  const file = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const settings = readJson(file, {});
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const script = `\${CLAUDE_PROJECT_DIR}/${posix(rel)}/hooks/telemetry-capture.mjs`;
  const splice = (event, entry) => {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = list.filter((e) => !e || !e[MARKER]);
    if (entry) kept.push(entry);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  };
  splice('SessionEnd', remove ? null : {
    hooks: [{ type: 'command', command: `node "${script}"`, timeout: 120 }],
    [MARKER]: true,
  });
  splice('SessionStart', remove ? null : {
    matcher: 'startup|resume',
    hooks: [{ type: 'command', command: `node "${script}" --sweep`, timeout: 120, async: true }],
    [MARKER]: true,
  });
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(file, settings);
  return file;
}

/** Copilot: a standalone hooks file — Copilot reads every .github/hooks/*.json. */
export function installCopilot(repo, rel, { remove = false } = {}) {
  const file = join(repo, '.github', 'hooks', 'tokenomics.json');
  if (remove) {
    if (existsSync(file)) rmSync(file);
    return file;
  }
  writeJson(file, {
    version: 1,
    hooks: {
      sessionStart: [{
        type: 'command',
        bash: `node "./${posix(rel)}/hooks/telemetry-capture.mjs" --sweep`,
        powershell: `& node "./${posix(rel)}/hooks/telemetry-capture.mjs" --sweep`,
        env: { COPILOT_CLI: '1' },
        timeoutSec: 120,
      }],
    },
  });
  return file;
}

/**
 * VS Code: a folderOpen auto-task running the sweep — the sidebar has no hook
 * mechanism, but tasks.json is its native "on session start". VS Code prompts
 * once per folder to allow automatic tasks; the task runs silently after that.
 * Identified by its label — never touches other tasks.
 */
export function installVsCode(repo, rel, { remove = false } = {}) {
  const file = join(repo, '.vscode', 'tasks.json');
  const cfg = readJson(file, { version: '2.0.0', tasks: [] });
  const kept = (Array.isArray(cfg.tasks) ? cfg.tasks : []).filter((t) => !t || t.label !== TASK_LABEL);
  if (remove) {
    const onlyOurs = kept.length === 0 && Object.keys(cfg).every((k) => k === 'version' || k === 'tasks');
    if (onlyOurs) { if (existsSync(file)) rmSync(file); return file; }
    cfg.tasks = kept;
    writeJson(file, cfg);
    return file;
  }
  kept.push({
    label: TASK_LABEL,
    type: 'shell',
    command: 'node',
    args: [`./${posix(rel)}/hooks/telemetry-capture.mjs`, '--sweep'],
    runOptions: { runOn: 'folderOpen' },
    presentation: { reveal: 'never', echo: false },
    problemMatcher: [],
  });
  cfg.version = cfg.version || '2.0.0';
  cfg.tasks = kept;
  writeJson(file, cfg);
  return file;
}

/** The repo's real git hooks dir — handles worktrees (`.git` as a file). */
export function gitHooksDir(repo) {
  const dotGit = join(repo, '.git');
  try {
    if (statSync(dotGit).isDirectory()) return join(dotGit, 'hooks');
    const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
    if (m) return join(isAbsolute(m[1]) ? m[1] : join(repo, m[1]), 'hooks');
  } catch { /* not a git repo */ }
  return null;
}

/**
 * Host-agnostic belt-and-braces: a post-commit hook that sweeps in the
 * background. Never overwrites a hook we don't own — a foreign post-commit is
 * reported, not replaced (chain it manually if wanted).
 */
export function installGitHook(repo, rel, { remove = false } = {}) {
  const dir = gitHooksDir(repo);
  if (!dir) return { file: null, status: 'no-git' };
  const file = join(dir, 'post-commit');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (remove) {
    if (existing && existing.includes(GIT_MARKER)) { rmSync(file); return { file, status: 'removed' }; }
    return { file, status: 'not-ours' };
  }
  if (existing && !existing.includes(GIT_MARKER)) return { file, status: 'exists-foreign' };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, [
    '#!/bin/sh',
    `${GIT_MARKER} — background telemetry harvest (tokenomics skill); safe to delete`,
    `node "./${posix(rel)}/hooks/telemetry-capture.mjs" --sweep >/dev/null 2>&1 &`,
    '',
  ].join('\n'), { mode: 0o755 });
  return { file, status: 'installed' };
}

// The exact settings this skill owns when OTel is enabled. Nothing else in the
// user's settings/env is ever touched; --otel-remove deletes precisely these.
const OTEL_CLAUDE_ENV = (endpoint) => ({
  CLAUDE_CODE_ENABLE_TELEMETRY: '1',
  OTEL_METRICS_EXPORTER: 'otlp',
  OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', // what makes the stdlib sink possible
  OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
});
const OTEL_VSCODE_KEYS = (endpoint) => ({
  'github.copilot.chat.otel.enabled': true,
  'github.copilot.chat.otel.exporterType': 'otlp-http',
  'github.copilot.chat.otel.otlpEndpoint': endpoint,
});

/**
 * Write (or strip) the OTel opt-in across the three config surfaces: the
 * telemetry config (capture hook reads `otel.enabled` to keep the sink alive),
 * Claude Code's settings env block, and the workspace VS Code settings (which
 * cover the sidebar AND are forwarded to Copilot CLI terminals VS Code opens).
 * Standalone-terminal Copilot CLI needs shell exports — printed by main, since
 * editing someone's shell profile is not this script's business.
 */
export function configureOtel(repo, { endpoint = 'http://localhost:4318', remove = false, local = false } = {}) {
  const touched = [];
  const cfgPath = seedConfig(repo);
  const cfg = readJson(cfgPath, {});
  cfg.otel = remove ? { enabled: false } : { enabled: true, endpoint };
  writeJson(cfgPath, cfg);
  touched.push(cfgPath);

  const sPath = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const settings = readJson(sPath, {});
  settings.env = settings.env && typeof settings.env === 'object' ? settings.env : {};
  for (const [k, v] of Object.entries(OTEL_CLAUDE_ENV(endpoint))) {
    if (remove) delete settings.env[k]; else settings.env[k] = v;
  }
  if (!Object.keys(settings.env).length) delete settings.env;
  writeJson(sPath, settings);
  touched.push(sPath);

  const vPath = join(repo, '.vscode', 'settings.json');
  const vs = readJson(vPath, {});
  for (const [k, v] of Object.entries(OTEL_VSCODE_KEYS(endpoint))) {
    if (remove) delete vs[k]; else vs[k] = v;
  }
  if (Object.keys(vs).length || existsSync(vPath)) { writeJson(vPath, vs); touched.push(vPath); }
  return touched;
}

/** Seed the telemetry dir + default config (never overwrites an existing one). */
export function seedConfig(repo) {
  const dir = join(repo, '.agents', 'telemetry');
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, 'config.json');
  if (!existsSync(cfg)) {
    writeJson(cfg, { capturePrompts: false, priceAtCapture: true, maxSweep: 10 });
  }
  return cfg;
}

/**
 * Health-check the whole telemetry path: wiring, stores, pricing, OTel flow.
 * Prints one line per check; returns the number of warnings. Read-only except
 * that `--fix` may start the local sink when OTel points at localhost with
 * nothing listening.
 */
export async function doctor(repo, { fix = false } = {}) {
  const cap = await import('../hooks/telemetry-capture.mjs');
  const cfg = cap.loadConfig(repo);
  let warns = 0;
  const say = (ok, name, note) => {
    if (!ok) warns++;
    process.stderr.write(`  ${ok ? 'ok  ' : 'WARN'} ${name}${note ? ` — ${note}` : ''}\n`);
  };
  process.stderr.write(`tokenomics doctor — ${repo}\n`);

  const readJ = (p) => readJson(p, {});
  const claudeWired = ['settings.json', 'settings.local.json'].some((f) => {
    const h = readJ(join(repo, '.claude', f)).hooks ?? {};
    return [...(h.SessionEnd ?? []), ...(h.SessionStart ?? [])].some((e) => e && e[MARKER]);
  });
  say(claudeWired, 'claude hooks', claudeWired ? undefined : 'not wired (run install-hooks.mjs)');
  say(existsSync(join(repo, '.github', 'hooks', 'tokenomics.json')), 'copilot hook', undefined);
  const tasks = readJ(join(repo, '.vscode', 'tasks.json')).tasks ?? [];
  say(tasks.some((t) => t?.label === TASK_LABEL), 'vscode folderOpen task', 'sidebar sessions rely on this or on other hosts’ sweeps');
  const hooksDir = gitHooksDir(repo);
  const gitHook = hooksDir && existsSync(join(hooksDir, 'post-commit')) && readFileSync(join(hooksDir, 'post-commit'), 'utf8').includes(GIT_MARKER);
  process.stderr.write(`  info git post-commit sweep ${gitHook ? 'installed' : 'not installed (optional; --git-hook)'}\n`);

  const claudeDirs = cap.claudeProjectDirs(repo);
  const copRoots = cap.copilotRoots(repo);
  const vsRoots = cap.vscodeStorageRoots(repo, process.env, cfg);
  let vsHashes = 0;
  for (const root of vsRoots) {
    try {
      for (const h of readdirSync(root)) {
        const folder = cap.workspaceFolderOf(join(root, h));
        if (folder && (cap.sameCwdOrUnder(folder, repo) || cap.sameCwdOrUnder(repo, folder))) vsHashes++;
      }
    } catch { /* ignore */ }
  }
  process.stderr.write(`  info stores — claude: ${claudeDirs.length} project dir(s), copilot: ${copRoots.length} root(s), vscode: ${vsRoots.length} root(s) / ${vsHashes} matching workspace(s)\n`);

  let ccusage = 'via npx at capture time';
  try {
    execFileSync('ccusage', ['--version'], { stdio: 'ignore', timeout: 5000 });
    ccusage = 'on PATH';
  } catch { /* npx fallback is the documented default */ }
  process.stderr.write(`  info ccusage ${ccusage}\n`);

  if (cfg.otel?.enabled) {
    const endpoint = cfg.otel.endpoint || 'http://localhost:4318';
    const probe = async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1000);
        const res = await fetch(`${endpoint.replace(/\/$/, '')}/healthz`, { signal: ctl.signal }).catch(() => null);
        clearTimeout(t);
        return !!res; // any HTTP answer means something is listening
      } catch { return false; }
    };
    let listening = await probe();
    if (!listening && fix) {
      cap.ensureSink(cfg.otel);
      await new Promise((r) => setTimeout(r, 400));
      listening = await probe();
    }
    say(listening, `otel endpoint ${endpoint}`, listening ? undefined : 'configured but NOTHING is listening — emitted telemetry is being dropped (sink autostarts at the next capture; or rerun with --fix)');
  } else {
    process.stderr.write('  info otel not enabled (optional; --otel)\n');
  }
  process.stderr.write(warns ? `${warns} warning(s)\n` : 'all good\n');
  return warns;
}

export async function main(argv = process.argv.slice(2)) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const remove = argv.includes('--remove');
  const local = argv.includes('--local');
  const repo = resolve(arg('--repo') || process.cwd());
  const skillRoot = skillRootOf();
  const rel = relative(repo, skillRoot);
  if (rel.startsWith('..')) {
    process.stderr.write(`tokenomics: the installed skill (${skillRoot}) is outside the repo (${repo}) — run from the consumer repo the skill was installed into, or pass --repo.\n`);
    return 1;
  }

  if (argv.includes('--doctor')) {
    const warns = await doctor(repo, { fix: argv.includes('--fix') });
    return argv.includes('--strict') && warns ? 1 : 0;
  }

  if (argv.includes('--otel') || argv.includes('--otel-remove')) {
    const off = argv.includes('--otel-remove');
    const endpoint = arg('--endpoint') || 'http://localhost:4318';
    const touched = configureOtel(repo, { endpoint, remove: off, local });
    process.stderr.write(`tokenomics: OTel ${off ? 'disabled' : `enabled → ${endpoint}`}\n${touched.map((f) => `  ${relative(repo, f)}`).join('\n')}\n`);
    if (!off) {
      process.stderr.write('for STANDALONE Copilot CLI terminals also export (shell profile):\n'
        + '  export COPILOT_OTEL_ENABLED=true\n'
        + `  export OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}\n`
        + '(VS Code terminals get these forwarded automatically.)\n');
    }
    return 0;
  }

  if (argv.includes('--git-hook')) {
    const r = installGitHook(repo, rel, { remove });
    const note = { installed: 'installed', removed: 'removed', 'no-git': 'SKIPPED — not a git repo', 'exists-foreign': 'SKIPPED — a post-commit hook we do not own exists; chain the sweep manually', 'not-ours': 'nothing of ours to remove' }[r.status];
    process.stderr.write(`tokenomics: git post-commit sweep ${note}${r.file ? ` (${r.file})` : ''}\n`);
    return r.status === 'exists-foreign' ? 1 : 0;
  }

  const host = arg('--host') || 'all';
  const touched = [];
  if (host === 'all' || host === 'claude') touched.push(installClaude(repo, rel, { local, remove }));
  if (host === 'all' || host === 'copilot') touched.push(installCopilot(repo, rel, { remove }));
  if (host === 'all' || host === 'vscode') touched.push(installVsCode(repo, rel, { remove }));
  if (!remove) touched.push(seedConfig(repo));
  process.stderr.write(`tokenomics: ${remove ? 'removed hooks from' : 'wired hooks into'}\n${touched.map((f) => `  ${relative(repo, f)}`).join('\n')}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(main()).then((code) => process.exit(code), (err) => {
    process.stderr.write(`tokenomics: ${err?.message || err}\n`);
    process.exit(1);
  });
}
