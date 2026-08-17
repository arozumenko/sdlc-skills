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
// Copilot CLI:  writes .github/hooks/tokenomics.json with sessionStart +
//               sessionEnd sweeps and the scope-contract hooks (older CLIs
//               ignore events they don't know).
// Both paths point at hooks/telemetry-capture.mjs inside THIS installed skill —
// the script self-locates, so it works wherever the skill was installed.
//
// Beyond wiring: `--host vscode` adds a folderOpen auto-task (the sidebar's
// "session start hook" — VS Code asks permission once per folder; OPT-IN, NOT
// part of the default install: every sweep already walks the sidebar store, so
// this only matters in a sidebar-ONLY repo — see installVsCode),
// `--git-hook` adds a host-agnostic post-commit sweep, `--otel` writes the
// OpenTelemetry opt-in (Claude settings env + workspace VS Code settings +
// telemetry config), and `--doctor` health-checks the whole telemetry path.
//
// STDLIB ONLY.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, renameSync } from 'node:fs';
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
 * Capture: SessionEnd captures the ending session (freshest data, priced
 * while the transcript is guaranteed alive), and SessionStart runs a bounded
 * sweep so sessions that never ended cleanly (killed terminal) are harvested
 * the moment anyone opens the repo again — same rhythm as the Copilot side.
 * The start sweep injects no context, so it runs async where supported.
 * Scope contract (scope-hook.mjs): SessionStart --announce injects ONE line
 * with the session id (the model cannot name its scope file without it);
 * PreToolUse on Agent|Workflow marks "this session dispatched work"; Stop
 * --gate blocks the turn end ONCE when work was dispatched with no declared
 * scope. All marked, all stripped by --remove.
 */
export function installClaude(repo, rel, { local = false, remove = false } = {}) {
  const file = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const settings = readJson(file, {});
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const script = `\${CLAUDE_PROJECT_DIR}/${posix(rel)}/hooks/telemetry-capture.mjs`;
  const scopeScript = `\${CLAUDE_PROJECT_DIR}/${posix(rel)}/hooks/scope-hook.mjs`;
  const splice = (event, entries) => {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = list.filter((e) => !e || !e[MARKER]);
    for (const entry of [].concat(entries ?? [])) kept.push(entry);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  };
  splice('SessionEnd', remove ? null : {
    hooks: [{ type: 'command', command: `node "${script}"`, timeout: 120 }],
    [MARKER]: true,
  });
  splice('SessionStart', remove ? null : [{
    matcher: 'startup|resume',
    hooks: [{ type: 'command', command: `node "${script}" --sweep`, timeout: 120, async: true }],
    [MARKER]: true,
  }, {
    // sync on purpose: its single stdout line (session id + scope ask/digest)
    // must reach context, and it must survive resume/clear/compact.
    matcher: '*',
    hooks: [{ type: 'command', command: `node "${scopeScript}" --announce`, timeout: 10 }],
    [MARKER]: true,
  }]);
  splice('PreToolUse', remove ? null : {
    // Workflow included: its inner agents never pass through the Agent tool,
    // but the Workflow call itself marks the session as work-dispatching.
    matcher: 'Agent|Workflow',
    hooks: [{ type: 'command', command: `node "${scopeScript}" --mark-dispatch`, timeout: 10, async: true }],
    [MARKER]: true,
  });
  splice('Stop', remove ? null : {
    hooks: [{ type: 'command', command: `node "${scopeScript}" --gate`, timeout: 10 }],
    [MARKER]: true,
  });
  // Measurements update as work finishes: each finished dispatch is metered
  // (its own transcript only) into the session's live dispatch log. Async —
  // it injects nothing and must never delay the run.
  splice('SubagentStop', remove ? null : {
    matcher: '*',
    hooks: [{ type: 'command', command: `node "${script}" --dispatch`, timeout: 60, async: true }],
    [MARKER]: true,
  });
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(file, settings);
  return file;
}

/**
 * Copilot: a standalone hooks file — Copilot reads every .github/hooks/*.json.
 * Since the CLI hooks-reference added the full event set, the scope contract
 * gets the SAME three moments as Claude (hooks-reference, checked 2026-08-12):
 * sessionStart may return {additionalContext} (the announce — hence --json),
 * subagentStart fires per dispatch (better than a tool matcher: named agents
 * only, exactly the work we mean), and agentStop takes the identical
 * {decision:'block', reason} shape with its own stop_hook_active guard and a
 * runaway cap. Older CLIs simply ignore events they don't know — the
 * `open --session auto` pending-record path stays as their fallback.
 */
export function installCopilot(repo, rel, { remove = false } = {}) {
  const file = join(repo, '.github', 'hooks', 'tokenomics.json');
  if (remove) {
    if (existsSync(file)) rmSync(file);
    return file;
  }
  const cmd = (script, args) => ({
    type: 'command',
    bash: `node "./${posix(rel)}/hooks/${script}" ${args}`,
    powershell: `& node "./${posix(rel)}/hooks/${script}" ${args}`,
    env: { COPILOT_CLI: '1' },
    timeoutSec: script === 'telemetry-capture.mjs' ? 120 : 10,
  });
  writeJson(file, {
    version: 1,
    hooks: {
      sessionStart: [
        cmd('telemetry-capture.mjs', '--sweep'),
        cmd('scope-hook.mjs', '--announce --json'),
      ],
      // sessionEnd exists per the hooks-reference: capture the ending session
      // NOW instead of waiting for the next session's start. Just a sweep —
      // the Copilot path has no live-grace (it keys on session.shutdown being
      // written), so the ended session qualifies immediately; if shutdown
      // races the hook, the start sweep remains the safety net, as before.
      sessionEnd: [cmd('telemetry-capture.mjs', '--sweep')],
      subagentStart: [cmd('scope-hook.mjs', '--mark-dispatch')],
      // per-dispatch measurement, same as Claude's SubagentStop
      subagentStop: [cmd('telemetry-capture.mjs', '--dispatch')],
      agentStop: [cmd('scope-hook.mjs', '--gate')],
    },
  });
  return file;
}

/**
 * VS Code: a folderOpen auto-task running the sweep — the sidebar has no hook
 * mechanism, but tasks.json is its native "on session start". VS Code prompts
 * once per folder to allow automatic tasks; the task runs silently after that.
 * Identified by its label — never touches other tasks.
 *
 * OPT-IN (`--host vscode`), deliberately NOT part of `--host all`: every sweep
 * walks all three stores, so a repo where anyone runs Claude Code or Copilot
 * CLI already harvests sidebar sessions on those sweeps. This task only earns
 * its keep in a SIDEBAR-ONLY repo — and it is the one thing the installer
 * writes into SHARED editor config, so it costs every teammate a "allow
 * automatic tasks?" prompt for a benefit most repos already have.
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

// The README committed INSIDE the telemetry submodule — the first thing anyone
// sees when they open the folder or browse the `telemetry` branch on the host.
const TELEMETRY_README = `# Team telemetry (auto-written)

Machine-written usage data: what each AI session cost, which cases it worked
on. Hooks write here; commits go to the \`telemetry\` branch of THIS repo —
never to main.

One subfolder per bundle — \`automation/\` is the test-automation bundle's;
other bundles add their own and ride the same branch and sync.

- Don't edit by hand. Don't commit this folder to main.
- See the team picture:  \`git -C .agents/telemetry pull\`  → then run team-report
- Empty after clone? run:  \`git submodule update --init\`
`;

// Transient files never worth committing even to the telemetry branch.
// Generic on purpose: any bundle's subfolder gets the same transient handling.
const TELEMETRY_INNER_GITIGNORE = `*/live/
*/scopes/.pending-*
*/scopes/.nagged-*
*/scopes/.unclosed-*
`;

/**
 * Telemetry as a SELF-referential submodule: .agents/telemetry is a checkout
 * of this same repository's orphan `telemetry` branch (.gitmodules url = ./).
 *
 * WHY. Telemetry is written continuously; the main tree lives in transactions
 * (checkout/stash/gate demand cleanliness). Two lifecycles in one tree
 * conflict by construction — measured: a stash swept the ledger, ` M usage-*`
 * blocked a gate, cost.json rewrites dirtied the tree on every session end.
 * A submodule gives the continuous writer its own branch and working dir the
 * parent never scans (`ignore = all`), on any git, any OS, with the native
 * clone story (`git clone --recurse-submodules` → team history in place).
 *
 * Degradation ladder: no git → plain dir (everything works locally); cloned
 * without --recurse → empty dir, plain-dir behavior until this installer
 * re-runs and initializes it (moving any interim files back in).
 */
export function installTelemetrySubmodule(repo, { remove = false } = {}) {
  // The submodule sits at the telemetry ROOT — shared across bundles, one
  // branch, one sync. Each bundle keeps to its own subfolder (ours:
  // automation/), so others join later with zero extra machinery.
  const dir = join(repo, '.agents', 'telemetry');
  const git = (args, opts = {}) =>
    execFileSync('git', args, { cwd: opts.cwd ?? repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  const inRepo = () => { try { git(['rev-parse', '--git-dir']); return true; } catch { return false; } };
  if (remove || !inRepo()) return { status: remove ? 'kept' : 'no-git' }; // --remove never deletes data
  if (existsSync(join(dir, '.git'))) return { status: 'already' };

  // Interim files (plain-dir phase) move aside before the checkout — and MUST
  // move back on ANY exit. Field lesson from the old-instance dry run: a
  // failed `submodule add` left the whole flat-era history stranded in the
  // stash dir while seedConfig planted a fresh config over the void.
  const stash = `${dir}.pre-submodule`;
  let stashed = false;
  const restoreStash = () => {
    if (!stashed || !existsSync(stash)) return;
    try {
      mkdirSync(dir, { recursive: true });
      for (const name of readdirSync(stash)) {
        const to = join(dir, name);
        if (!existsSync(to)) renameSync(join(stash, name), to);
      }
      if (readdirSync(stash).length === 0) rmSync(stash, { recursive: true, force: true });
      stashed = false;
    } catch { /* stash left in place — data preserved, doctor will surface it */ }
  };
  try {
    // 1. The orphan branch, created empty via plumbing if absent (no checkout,
    //    the main tree never moves).
    let hasBranch = true;
    try { git(['rev-parse', '--verify', 'refs/heads/telemetry']); } catch {
      try { git(['rev-parse', '--verify', 'refs/remotes/origin/telemetry']);
        git(['branch', 'telemetry', 'origin/telemetry']);
      } catch {
        const emptyTree = git(['hash-object', '-t', 'tree', '/dev/null']).trim();
        const commit = git(['commit-tree', emptyTree, '-m', 'telemetry: root']).trim();
        git(['update-ref', 'refs/heads/telemetry', commit]);
        hasBranch = false; // fresh — seed files below
      }
    }

    // 2. Move the interim files aside.
    const hadFiles = existsSync(dir) && readdirSync(dir).length > 0;
    if (hadFiles) { renameSync(dir, stash); stashed = true; }

    // 2b. The flat era COMMITTED telemetry to main, and `submodule add`
    //     refuses a tracked path outright — so the index entries must go
    //     first. Index-only (`--cached`): files stay on disk (in the stash),
    //     nothing is committed by us — the user's single review commit
    //     records the removal together with the gitlink.
    let untracked = false;
    try {
      if (git(['ls-files', '.agents/telemetry']).trim()) {
        git(['rm', '-r', '-q', '--cached', '.agents/telemetry']);
        untracked = true;
      }
    } catch { /* nothing tracked */ }

    // 3. Publish the branch where teammates will clone it from (best-effort —
    //    offline just means their first `submodule update` waits for a push).
    try { git(['push', 'origin', 'refs/heads/telemetry:refs/heads/telemetry']); } catch { /* no remote / offline */ }

    // 4. Register + materialize. url './' = this same repository (resolved
    //    against origin, where the branch was just pushed; with no remote it
    //    resolves to the local repo, which also has it).
    git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '--force', '-b', 'telemetry', '--', './', '.agents/telemetry']);
    git(['config', '-f', '.gitmodules', 'submodule..agents/telemetry.ignore', 'all']);
    git(['add', '.gitmodules']); // the ignore=all edit must ride the same staged version

    // 5. Move the interim files back in, seed README + inner gitignore.
    restoreStash();
    if (!existsSync(join(dir, 'README.md'))) writeFileSync(join(dir, 'README.md'), TELEMETRY_README);
    if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), TELEMETRY_INNER_GITIGNORE);
    if (!hasBranch || hadFiles) {
      git(['add', '-A'], { cwd: dir });
      try { git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'commit', '-m', 'telemetry: seed'], { cwd: dir }); } catch { /* nothing to commit */ }
      // The seed commit moved the branch PAST the SHA that `submodule add`
      // staged. Publish it and re-stage the gitlink, or a teammate's
      // `clone --recurse-submodules` pins an empty (or unpushed) commit.
      try { git(['push', 'origin', 'HEAD:telemetry'], { cwd: dir }); } catch { /* no remote / offline */ }
      git(['add', '.agents/telemetry']);
    }

    // `migrate` now means: the flat era had committed this data to main, and
    // step 2b already STAGED its removal — the user's one commit records it.
    return { status: 'installed', migrate: untracked };
  } catch (err) {
    restoreStash(); // a failed setup must never leave history stranded aside
    return { status: 'failed', error: String(err?.message ?? err).split('\n')[0] };
  }
}

/**
 * Layout migration: the flat era wrote this bundle's files at the telemetry
 * ROOT (usage-*.jsonl, scopes/, live/, config.json, factory-profile.json);
 * the shared-submodule era puts them under automation/. Readers look ONLY in
 * automation/, so un-migrated history silently vanishes from every report —
 * hence this runs on every install, idempotent, plain dir or submodule alike.
 * Never clobbers: an entry already present in automation/ wins (it is newer);
 * directory moves merge file-by-file on the same rule.
 */
export function migrateTelemetryLayout(repo) {
  const root = join(repo, '.agents', 'telemetry');
  if (!existsSync(root)) return 0;
  const auto = join(root, 'automation');
  const OLD_FILES = (n) => /^usage-.*\.jsonl$/.test(n) || n === 'config.json' || n === 'factory-profile.json';
  const OLD_DIRS = new Set(['scopes', 'live']);
  let moved = 0;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const old = e.isDirectory() ? OLD_DIRS.has(e.name) : OLD_FILES(e.name);
    if (!old) continue;
    const src = join(root, e.name);
    const dest = join(auto, e.name);
    try {
      mkdirSync(auto, { recursive: true });
      if (!existsSync(dest)) {
        renameSync(src, dest);
        moved++;
      } else if (e.isDirectory()) {
        for (const f of readdirSync(src)) {
          const d2 = join(dest, f);
          if (!existsSync(d2)) { renameSync(join(src, f), d2); moved++; }
        }
        if (readdirSync(src).length === 0) rmSync(src, { recursive: true, force: true });
      } // a same-named FILE already in automation/: keep both untouched — surfaced by doctor, never merged blindly
    } catch { /* best-effort per entry — a locked file must not abort the rest */ }
  }
  return moved;
}

/**
 * The chief lead's "give me everyone's telemetry NOW" button. Sync (in the
 * capture hooks) only PUSHES this machine's state — a clean local branch
 * fast-forwards nowhere and never fetches, so teammates' pushes sit unseen
 * until something merges them. Pull is that something: commit anything local,
 * fetch, merge (per-user files → conflict-free), push the merge back.
 */
export function pullTelemetry(repo) {
  const dir = join(repo, '.agents', 'telemetry'); // submodule root — all bundles
  if (!existsSync(join(dir, '.git'))) return { status: 'no-submodule' };
  const git = (args, timeout = 20000) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
  try {
    git(['add', '-A']);
    if (git(['status', '--porcelain']).trim()) {
      git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'commit', '-m', 'telemetry: capture']);
    }
    if (git(['branch', '--show-current']).trim() !== 'telemetry') git(['checkout', '-B', 'telemetry']);
    git(['fetch', 'origin', 'telemetry']);
    git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'merge', '--no-edit', 'FETCH_HEAD']);
    try { git(['push', 'origin', 'HEAD:telemetry']); } catch { /* offline push-back — next sync retries */ }
    return { status: 'pulled' };
  } catch (err) {
    return { status: 'failed', error: String(err?.message ?? err).split('\n')[0] };
  }
}

/**
 * Ignore the WORKING STATE this skill writes, so it never blocks a gate.
 *
 * The constraint that forces this: `gate-case.mjs` refuses a dirty tree, so a
 * file that is neither committed nor ignored stops the pipeline. Everything
 * tokenomics writes falls in one of two classes and this block encodes the
 * split — the RECORDS (ledger, scope files, config, factory profile) are
 * deliberately NOT ignored, because team-wide reporting is exactly their
 * point; only the transient per-run state is.
 *
 * Owned block, replaced in place on re-run and stripped by --remove; the rest
 * of the file is never touched. Artifacts written by OTHER skills
 * (.agents/automation/_returns/, case snapshots, browser scratch) are the
 * project's call — the skill README lists them.
 */
const GI_START = '# >>> tokenomics (managed) — working state only; the ledger/scopes/receipts stay COMMITTED';
const GI_END = '# <<< tokenomics';
export const GITIGNORE_BLOCK = [
  GI_START,
  '.agents/telemetry/automation/live/',
  '.agents/telemetry/automation/scopes/.pending-*',
  '.agents/telemetry/automation/scopes/.nagged-*',
  '.agents/telemetry/automation/scopes/.unclosed-*',
  GI_END,
].join('\n');

export function installGitignore(repo, { remove = false } = {}) {
  const file = join(repo, '.gitignore');
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
  // Drop any previous block (start..end inclusive), keeping everything else.
  const kept = [];
  let skipping = false;
  for (const line of prev.split('\n')) {
    if (line.startsWith(GI_START.slice(0, 24))) { skipping = true; continue; }
    if (skipping) { if (line.trim() === GI_END) skipping = false; continue; }
    kept.push(line);
  }
  let body = kept.join('\n').replace(/\n{3,}$/, '\n\n').trimEnd();
  if (!remove) body = `${body ? `${body}\n\n` : ''}${GITIGNORE_BLOCK}`;
  if (!body.trim()) { if (existsSync(file)) rmSync(file); return file; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${body}\n`);
  return file;
}

/** Seed the telemetry dir + default config (never overwrites an existing one). */
export function seedConfig(repo) {
  const dir = join(repo, '.agents', 'telemetry', 'automation');
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
  const claudeSettings = ['settings.json', 'settings.local.json'].map((f) => readJ(join(repo, '.claude', f)).hooks ?? {});
  const claudeHas = (event) => claudeSettings.some((h) => (h[event] ?? []).some((e) => e && e[MARKER]));
  const claudeWired = claudeHas('SessionEnd') || claudeHas('SessionStart');
  say(claudeWired, 'claude hooks', claudeWired ? undefined : 'not wired (run install-hooks.mjs)');
  const claudeScope = claudeHas('Stop') && claudeHas('PreToolUse');
  say(claudeScope, 'claude scope contract', claudeScope ? undefined : 'announce/gate not wired (re-run install-hooks.mjs — older install)');
  const copFile = join(repo, '.github', 'hooks', 'tokenomics.json');
  const copHooks = readJ(copFile).hooks ?? {};
  say(existsSync(copFile), 'copilot hook', undefined);
  if (existsSync(copFile)) {
    const copScope = !!(copHooks.agentStop && copHooks.subagentStart && copHooks.sessionEnd);
    say(copScope, 'copilot scope contract + sessionEnd capture', copScope ? undefined : 're-run install-hooks.mjs (older install; old CLIs ignore unknown events, safe to write)');
  }
  // A file that is neither committed nor ignored blocks the pipeline's gate.
  const gi = existsSync(join(repo, '.gitignore')) ? readFileSync(join(repo, '.gitignore'), 'utf8') : '';
  const giOk = gi.includes('.agents/telemetry/automation/live/');
  say(giOk, 'gitignore (working state)', giOk ? undefined : 'transient telemetry files are not ignored — they will dirty the tree and block the gate; re-run install-hooks.mjs');
  // Telemetry submodule: the difference between "my numbers" and "the team's".
  {
    const telDir = join(repo, '.agents', 'telemetry');
    const gm = existsSync(join(repo, '.gitmodules')) ? readFileSync(join(repo, '.gitmodules'), 'utf8') : '';
    const registered = gm.includes('.agents/telemetry');
    const materialized = existsSync(join(telDir, '.git'));
    if (registered && materialized) {
      let note = '';
      try {
        const g = (args) => execFileSync('git', ['-C', telDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
        const branch = g(['branch', '--show-current']);
        if (branch !== 'telemetry') note = `detached/off-branch (${branch || 'detached'}) — the next capture sync re-pins it`;
        else {
          let ahead = 0;
          try { ahead = Number(g(['rev-list', '--count', 'origin/telemetry..HEAD'])) || 0; } catch { /* no remote-tracking yet */ }
          note = ahead ? `${ahead} unpushed commit(s) — sync pushes at the next capture` : 'in sync';
        }
      } catch { note = 'state unreadable'; }
      process.stderr.write(`  info telemetry submodule — ${note}; team view: install-hooks.mjs --pull before a team report\n`);
      // Local-only era leaves the submodule's origin pointing at the repo's own
      // directory. The moment a REAL remote appears, every sync still lands
      // only in the local branch — silently unshared — until `git submodule
      // sync` re-resolves the './' url against the new origin. Detect exactly
      // that transition.
      try {
        const originOf = (cwd) => execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim().replace(/\/+$/, '');
        const superRemote = originOf(repo); // throws when the repo has no remote → local-only, no warning
        const subRemote = originOf(telDir);
        if (subRemote !== superRemote) {
          say(false, 'telemetry submodule remote',
            `points at ${subRemote} while the repo's origin is ${superRemote} — captures stay local-only; run: git submodule sync .agents/telemetry`);
        }
      } catch { /* no remote at all — local-only mode, nothing to warn about */ }
    } else if (registered && !materialized) {
      say(false, 'telemetry submodule', 'registered but empty — cloned without --recurse-submodules; run: git submodule update --init');
    } else if (existsSync(telDir)) {
      process.stderr.write('  info telemetry — plain dir (local-only); re-run install-hooks.mjs in a git repo to get the shared branch\n');
    }
  }
  const scopeDir = join(repo, '.agents', 'telemetry', 'automation', 'scopes');
  if (existsSync(scopeDir)) {
    const names = readdirSync(scopeDir);
    const records = names.filter((n) => n.endsWith('.json')).length;
    const pendings = names.filter((n) => n.startsWith('pending-')).length;
    const markers = names.filter((n) => n.startsWith('.pending-') || n.startsWith('.nagged-')).length;
    process.stderr.write(`  info scopes — ${records} record(s)${pendings ? `, ${pendings} unclaimed pending (a sweep claims them)` : ''}${markers ? `, ${markers} marker(s)` : ''}\n`);
  } else {
    process.stderr.write('  info scopes — none yet (sessions declare via work-scope.mjs; see SKILL.md § Session scope)\n');
  }
  const vsTaskInstalled = (readJ(join(repo, '.vscode', 'tasks.json')).tasks ?? []).some((t) => t?.label === TASK_LABEL);
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

  // The sidebar task is opt-in because every sweep walks the sidebar store —
  // so it only matters when NOTHING ELSE ever sweeps in this repo. Decide from
  // the evidence rather than nagging: warn only for a genuine sidebar-only repo.
  if (vsTaskInstalled) {
    process.stderr.write('  info vscode folderOpen task installed (sidebar sweeps on folder open)\n');
  } else if (vsHashes && !claudeDirs.length && !copRoots.length) {
    say(false, 'vscode sidebar capture',
      `${vsHashes} sidebar workspace(s) for this repo and no Claude/Copilot store — nothing will sweep them here; run install-hooks.mjs --host vscode (adds a folderOpen task to shared .vscode/tasks.json; each teammate allows auto-tasks once)`);
  } else if (vsHashes) {
    process.stderr.write(`  info vscode sidebar — ${vsHashes} workspace(s), swept by the other host(s)' sweeps (no task needed; --host vscode adds one anyway)\n`);
  } else {
    process.stderr.write('  info vscode sidebar — no workspaces for this repo (task not needed)\n');
  }

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

  if (argv.includes('--pull')) {
    const r = pullTelemetry(repo);
    const note = {
      pulled: 'telemetry pulled — the team\'s pushes are merged in; reports now see everyone',
      'no-submodule': 'no telemetry submodule here — nothing to pull (plain-dir mode is local-only)',
      failed: `pull failed (${r.error}) — offline, or no telemetry branch on the remote yet`,
    }[r.status];
    process.stderr.write(`tokenomics: ${note}\n`);
    return r.status === 'failed' ? 1 : 0;
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
  // vscode is opt-in only (see installVsCode) — but --remove still strips it
  // from `all`, so uninstalling never leaves our task behind.
  if (host === 'vscode' || (remove && host === 'all')) touched.push(installVsCode(repo, rel, { remove }));
  // Always: without it, the transient files this skill writes would block the
  // pipeline's gate (dirty tree) the first time a batch runs.
  touched.push(installGitignore(repo, { remove }));
  // Old flat-layout data moves into automation/ BEFORE the submodule step, so
  // its interim-files stash/restore already carries the migrated shape.
  if (!remove) {
    const migrated = migrateTelemetryLayout(repo);
    if (migrated) process.stderr.write(`tokenomics: migrated ${migrated} old-layout telemetry entr${migrated === 1 ? 'y' : 'ies'} → .agents/telemetry/automation/\n`);
  }
  const sub = installTelemetrySubmodule(repo, { remove });
  if (sub.status === 'installed') {
    process.stderr.write('\ntokenomics: telemetry set up as a submodule (.agents/telemetry → branch \'telemetry\', same repo; this bundle writes automation/)\n'
      + '\n  what this means, once:\n'
      + '  • hooks write usage data there; it commits to its OWN branch — your working tree never gets dirty\n'
      + '  • one commit to make now (adds .gitmodules + the pointer):\n'
      + '        git add .gitmodules .agents/telemetry && git commit -m "chore: telemetry submodule"\n'
      + (sub.migrate ? '    (old telemetry files were tracked on main — their removal is ALREADY STAGED and rides this same commit; the data itself lives on in the telemetry branch)\n' : '')
      + '  • teammates: git clone --recurse-submodules   (forgot? this installer fixes it on next run)\n'
      + '  • team report anytime:  git -C .agents/telemetry pull && node …/team-report.mjs --html\n');
  } else if (sub.status === 'failed') {
    process.stderr.write(`tokenomics: telemetry submodule setup skipped (${sub.error}) — plain-dir mode, everything still works locally\n`);
  }
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
