#!/usr/bin/env node
// STDLIB ONLY. Opt-in Claude SubagentStop capture + shared telemetry submodule (spec §6.1, §6.6, D15). Installing the skill never wires this.
import { realpathSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentSession, deliveryDir, sessionPath, sessionsDir, resolveOwnerRepo } from './lib/paths.mjs';
import { listRuns } from './lib/plan.mjs';
import { git as gitq, gitState } from './lib/git.mjs';
import { validRoster } from './lib/roster.mjs';
import { UNCONDITIONAL_CAVEATS, readDiagnostics } from './lib/report.mjs';

export const MARKER = '_delivery';
export const skillRootOf = (url = import.meta.url) => dirname(dirname(fileURLToPath(url)));
const posix = (p) => p.split('\\').join('/');
const readJson = (p, fb) => { if (!existsSync(p)) return fb; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
/** Why a settings file cannot be read as settings, or null. Writing it back would drop every key it holds, so install and
 * --remove stop on this instead. A missing or empty file holds nothing to lose and is not a problem. */
export function settingsProblem(file) {
  if (!existsSync(file)) return null;
  let text; try { text = readFileSync(file, 'utf8'); } catch (e) { return `cannot be read (${e.code ?? 'error'})`; }
  if (!text.trim()) return null;
  let parsed; try { parsed = JSON.parse(text); } catch (e) { return `is not valid JSON (${String(e.message).split('\n')[0]})`; }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : 'is not a JSON object';
}
const settingsFile = (repo, local) => join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
const HOOK_FILES = ['dispatch-hook.mjs', 'budget-hook.mjs'];
const DEFAULT_REL = '.claude/skills/delivery-monitor';
const inside = (rel) => rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
const gitTop = (dir) => { try { return realpathSync(execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim()); } catch { return null; } };

/** Where, relative to the target, the hook commands point. Always a copy INSIDE the target: a copy in another checkout or a
 * linked worktree would wire the target to files it does not own, and every SubagentStop fails once that worktree is gone.
 * The running copy is used when it lives in the target; otherwise the target's copy at the same place in its checkout, else
 * at the default install place. Null when the target has no copy of the hooks. */
export function hookRel(target, root = skillRootOf()) {
  const t = realpathSync(target), r = realpathSync(root);
  const own = posix(relative(t, r)); if (inside(own)) return own;
  const top = gitTop(r);
  for (const rel of [top && posix(relative(top, r)), DEFAULT_REL]) if (rel && inside(rel) && HOOK_FILES.every((h) => existsSync(join(t, rel, 'hooks', h)))) return rel;
  return null;
}

/** An explicit --repo must name a repository root, a linked worktree root, or a folder outside any repository. A folder
 * inside a repository would otherwise resolve to that repository, and the install would write a project nobody named. */
function explicitRepoProblem(dir) {
  if (!existsSync(dir)) return `--repo ${dir} does not exist`;
  const top = gitTop(dir);
  return top && top !== realpathSync(dir) ? `--repo ${dir} is inside the repository ${top}, not its root; pass the root` : null;
}

const writeJson = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`); };

export function installClaude(repo, rel, { local = false, remove = false } = {}) {
  const file = settingsFile(repo, local);
  const problem = settingsProblem(file); if (problem) throw new Error(`${file} ${problem}`);
  const existed = existsSync(file);
  const settings = readJson(file, {}); settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  for (const [event, script, flag] of [['SubagentStop', 'dispatch-hook.mjs', ' --stop'], ['PreToolUse', 'budget-hook.mjs', '']]) {
    const kept = (Array.isArray(settings.hooks[event]) ? settings.hooks[event] : []).filter(e => !e || !e[MARKER]);
    if (!remove) kept.push({ matcher: '*', hooks: [{ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/${posix(join(rel, 'hooks', script))}"${flag}`, timeout: 30 }], [MARKER]: true });
    if (kept.length) settings.hooks[event] = kept; else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  // --remove on a settings file that never existed, with nothing else left to write, must not
  // conjure an empty settings.json into existence.
  if (remove && !existed && !Object.keys(settings).length) return file;
  writeJson(file, settings); return file;
}

const BEGIN = '# >>> delivery-monitor (managed)', END = '# <<< delivery-monitor';
const ROOT_PATTERNS = ['.agents/telemetry/delivery/reports/', '.agents/telemetry/delivery/.lock/', '.agents/telemetry/delivery/.pending-*'];
const INNER_PATTERNS = ['/delivery/reports/', '/delivery/.lock/', '/delivery/.pending-*'];
// tokenomics install-hooks.mjs:307-311 — the four base transient patterns EVERY factory's
// subfolder needs, plain (unmanaged) lines outside any BEGIN/END block since both skills' owned
// blocks share this one inner .gitignore. Seeded once on bootstrap so a delivery-monitor-only
// install still ignores tokenomics' own transients (and vice versa) even before tokenomics ever
// runs its own installer.
const TOKENOMICS_BASE_LINES = ['*/live/', '*/scopes/.pending-*', '*/scopes/.nagged-*', '*/scopes/.unclosed-*'];
function seedTokenomicsBaseLines(file) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const have = new Set(text.split('\n').map((l) => l.trim()));
  const missing = TOKENOMICS_BASE_LINES.filter((l) => !have.has(l));
  if (!missing.length) return;
  mkdirSync(dirname(file), { recursive: true });
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  writeFileSync(file, `${text}${sep}${missing.join('\n')}\n`);
}
function spliceBlock(file, lines, remove) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const re = new RegExp(`\\n?${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*[\\s\\S]*?${END}\\n?`);
  const stripped = text.replace(re, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  if (remove) { if (!text) return 'absent'; writeFileSync(file, stripped); return 'removed'; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${stripped.replace(/\n*$/, stripped ? '\n\n' : '')}${BEGIN} — transients only; plans/events/calibration stay COMMITTED\n${lines.join('\n')}\n${END}\n`);
  return 'installed';
}
export function installIgnoreBlocks(repo, { remove = false } = {}) {
  const root = spliceBlock(join(repo, '.gitignore'), ROOT_PATTERNS, remove);
  const tel = join(repo, '.agents', 'telemetry');
  const inner = existsSync(tel) ? spliceBlock(join(tel, '.gitignore'), INNER_PATTERNS, remove) : 'skipped (no .agents/telemetry)';
  return { root, inner };
}

const TELEMETRY_README = '# telemetry\n\nShared durable telemetry submodule (branch `telemetry`), one subfolder per factory or cross-factory concern: `automation/` (tokenomics), `delivery/` (delivery-monitor). Nobody hand-commits here; each capture moment commits and pushes best-effort.\n';
/** Ported from tokenomics install-hooks.mjs:329-404 — same branch, same layout, so both skills share one submodule. */
export function bootstrapTelemetry(repo) {
  const dir = join(repo, '.agents', 'telemetry');
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }).trim();
  try { git(['rev-parse', '--git-dir']); } catch { return { status: 'no-git' }; }
  if (existsSync(join(dir, '.git'))) return { status: 'already' };
  const stash = `${dir}.pre-submodule`; let stashed = false;
  const restore = () => { if (!stashed || !existsSync(stash)) return; try { mkdirSync(dir, { recursive: true }); for (const n of readdirSync(stash)) if (!existsSync(join(dir, n))) renameSync(join(stash, n), join(dir, n)); if (!readdirSync(stash).length) rmSync(stash, { recursive: true, force: true }); stashed = false; } catch { /* data preserved in stash; doctor surfaces it */ } };
  try {
    try { git(['rev-parse', '--verify', 'refs/heads/telemetry']); } catch {
      try { git(['rev-parse', '--verify', 'refs/remotes/origin/telemetry']); git(['branch', 'telemetry', 'origin/telemetry']); }
      catch { const tree = git(['hash-object', '-t', 'tree', '/dev/null']); const commit = git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'commit-tree', tree, '-m', 'telemetry: root']); git(['update-ref', 'refs/heads/telemetry', commit]); }
    }
    const hadFiles = existsSync(dir) && readdirSync(dir).length > 0;
    if (hadFiles) { renameSync(dir, stash); stashed = true; }
    try { if (git(['ls-files', '.agents/telemetry'])) git(['rm', '-r', '-q', '--cached', '.agents/telemetry']); } catch { /* nothing tracked */ }
    try { git(['push', 'origin', 'refs/heads/telemetry:refs/heads/telemetry']); } catch { /* no remote / offline */ }
    git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '--force', '-b', 'telemetry', '--', './', '.agents/telemetry']);
    git(['config', '-f', '.gitmodules', 'submodule..agents/telemetry.ignore', 'all']); git(['add', '.gitmodules']);
    restore();
    if (!existsSync(join(dir, 'README.md'))) writeFileSync(join(dir, 'README.md'), TELEMETRY_README);
    seedTokenomicsBaseLines(join(dir, '.gitignore'));
    spliceBlock(join(dir, '.gitignore'), INNER_PATTERNS, false);
    // Same as tokenomics: seed content (README + inner .gitignore, plus any restored interim files)
    // must land as a real commit on the telemetry branch, not sit untracked in the checkout — an
    // untracked seed leaves `gitState` permanently "dirty" and a teammate's first
    // `clone --recurse-submodules` would pin an empty/unpushed commit. Always attempt it (not just
    // when a fresh branch or interim files triggered it) — the README/.gitignore writes above can
    // themselves be the only change (e.g. bootstrapping onto a telemetry branch another factory
    // already created), and `git commit` failing on "nothing to commit" is caught, so this is a
    // no-op when there truly is nothing new.
    git(['add', '-A'], dir);
    try { git(['-c', 'user.email=telemetry@local', '-c', 'user.name=telemetry', 'commit', '-m', 'telemetry: seed'], dir); } catch { /* nothing to commit */ }
    try { git(['push', 'origin', 'HEAD:telemetry'], dir); } catch { /* no remote / offline */ }
    git(['add', '.agents/telemetry']); // re-stage the gitlink at the commit the seed just moved it to
    return { status: 'created' };
  } catch (e) { restore(); return { status: 'failed', reason: String(e.message).split('\n')[0] }; }
}

export function telemetryMode(repo) { return existsSync(join(repo, '.agents', 'telemetry', '.git')) ? 'submodule' : 'plain-dir'; }

// F6: `--no-index` answers purely from the .gitignore files on disk, so it works both before and
// after bootstrapTelemetry() turns .agents/telemetry into a submodule (unlike a plain
// `git check-ignore -q <probe>`, which refuses any pathspec inside a registered submodule's working
// tree). If check-ignore refuses for some other reason, `checkIgnoreOne` returns `hit: null` rather
// than guessing, and the fallback in `checkPatterns` reads the owner's actual `.gitignore` and looks
// for the pattern as a literal line, in any block — never a probe compared against itself.
// Default `gitExec(cwd, args) → { ok, status, reason? }`: the direct spawn, with git's first stderr
// line as `reason`; doctor injects its hardened runner (no `reason`, so the exit status stands in).
function gitExecq(cwd, args) {
  try { execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }); return { ok: true, status: 0 }; }
  catch (e) { return { ok: false, status: typeof e.status === 'number' ? e.status : null, reason: (e.stderr ? String(e.stderr) : String(e.message)).trim().split('\n')[0] || null }; }
}
function checkIgnoreOne(cwd, probe, gitExec) {
  const r = gitExec(cwd, ['check-ignore', '-q', '--no-index', '--', probe]);
  if (r.ok) return { hit: true };
  if (r.status === 1) return { hit: false };
  return { hit: null, reason: r.reason || `exit ${r.status}` };
}
function gitignoreLines(cwd) {
  const file = join(cwd, '.gitignore');
  if (!existsSync(file)) return null;
  try { return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()); } catch { return null; }
}
function checkPatterns(cwd, patterns, probeOf, gitExec) {
  let fellBack = false, undetermined = null;
  const okCount = patterns.reduce((n, p) => {
    const r = checkIgnoreOne(cwd, probeOf(p), gitExec);
    let hit = r.hit;
    if (hit === null) {
      fellBack = true;
      const lines = gitignoreLines(cwd);
      if (lines === null) { undetermined = undetermined ?? r.reason; hit = false; } else hit = lines.includes(p.trim());
    }
    return n + (hit ? 1 : 0);
  }, 0);
  return { okCount, total: patterns.length, fellBack, undetermined };
}
function renderIgnoreLine(label, res) {
  if (res.undetermined) return `ignore ${label}: undetermined (git refused: ${res.undetermined})`;
  return `ignore ${label}: ${res.okCount === res.total ? 'ok' : 'MISSING'} (${res.okCount}/${res.total})${res.fellBack ? ' (pattern-check)' : ''}`;
}

// F6: check-ignore only proves the PATTERN matches a probe path; it never proves git would actually
// skip these paths on a real `git add -A` inside the telemetry repo (e.g. a typo'd pattern can still
// look right to the eye). Untracked, unignored transients are exactly what `git add -A` would stage;
// `ls-files --others --exclude-standard` lists them read-only, with no index of any kind written.
const TRANSIENT = ['delivery/reports', 'delivery/.lock', 'delivery/.pending-*'];
function stagingLeaks(tel, git) {
  const out = git(tel, ['ls-files', '--others', '--exclude-standard', '--', ...TRANSIENT]);
  return out == null ? null : out.split('\n').filter(Boolean);
}

/** One structured finding per doctor line. `git(cwd, args) → string|null` (lib/git.mjs `git` contract) and
 * `gitExec(cwd, args) → { ok, status, reason? }` default to direct spawns; doctor injects its hardened runner. */
export function doctorFindings(repo, rel, { env = process.env, git = gitq, gitExec = gitExecq } = {}) {
  const physical = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const asked = physical(repo);
  repo = resolveOwnerRepo(repo, git);
  const checkout = asked === physical(repo) ? 'main' : 'linked';
  const findings = [];
  const add = (severity, line, fix = null) => findings.push({ severity, message: line, fix, checkout, line });
  // A settings file that does not parse reads as "no hooks" below; say why, so "not wired" is not taken for "never installed".
  for (const name of ['settings.json', 'settings.local.json']) {
    const problem = settingsProblem(join(repo, '.claude', name));
    if (problem) add('warning', `settings: .claude/${name} ${problem} — its hooks are not read and install-hooks.mjs will not replace it; fix the file by hand`);
  }
  const asObject = (v) => (v && typeof v === 'object' ? v : {});
  const settings = asObject(readJson(join(repo, '.claude', 'settings.json'), {})), local = asObject(readJson(join(repo, '.claude', 'settings.local.json'), {}));
  const entries = (event, script, flag = '') => [...(settings.hooks?.[event] ?? []), ...(local.hooks?.[event] ?? [])].flatMap(e =>
    e?.matcher === '*' ? (e.hooks ?? []).filter(h => h.type === 'command' && h.command?.includes(`${posix(join(rel, 'hooks', script))}"${flag}`)) : []);
  const fix = `node ${rel}/scripts/install-hooks.mjs --no-submodule`;
  const stops = entries('SubagentStop', 'dispatch-hook.mjs', ' --stop');
  if (stops.some(h => h.async !== true)) add('ok', `hook: wired (Claude SubagentStop, marker ${MARKER})`);
  else if (stops.length) add('info', 'hook: wired (async) - re-run install-hooks.mjs --no-submodule to make it synchronous', fix);
  else add('warning', `hook: not wired (Claude SubagentStop, marker ${MARKER})`, fix);
  // The budget hook must be synchronous to deny, so an async entry does not count.
  const budget = entries('PreToolUse', 'budget-hook.mjs').some(h => h.async !== true);
  add(budget ? 'ok' : 'warning', `budget hook: ${budget ? 'wired' : 'MISSING'} (Claude PreToolUse, synchronous Agent|Task + subagent calls)`, budget ? null : fix);
  const runs = listRuns(repo); add('info', `plans: ${runs.filter((r) => r.status === 'open').length} open, ${runs.length} total`);
  add('info', `sessions bound: ${existsSync(sessionsDir(repo)) ? readdirSync(sessionsDir(repo)).length : 0}`);
  // The count alone hid that the orchestrating session was never bound — say so for THIS session.
  const me = currentSession(env);
  if (me) {
    let mine = null; try { mine = JSON.parse(readFileSync(sessionPath(repo, me.host, me.session), 'utf8')).plan; } catch { /* unbound */ }
    const open = runs.filter((r) => r.status === 'open').map((r) => r.run);
    if (mine) add('info', `this session: ${me.host}:${me.session} -> ${mine}${open.includes(mine) ? '' : ' (not open — the hook records nothing for it)'}`);
    else add('info', `this session: ${me.host}:${me.session} unbound${open.length ? ` — the hook records this session's dispatches only once bound (or when its branch maps to one open run): delivery.mjs session set --plan <${open.join('|')}>` : ''}`);
  }
  const rootRes = checkPatterns(repo, ROOT_PATTERNS, (p) => p.replace(/\*$/, 'x').replace(/\/$/, '/x'), gitExec);
  add(rootRes.undetermined || rootRes.okCount !== rootRes.total ? 'warning' : 'ok', renderIgnoreLine('root', rootRes));
  const tel = join(repo, '.agents', 'telemetry'); const mode = telemetryMode(repo); add('info', `telemetry: ${mode}${mode === 'plain-dir' ? ' (records ride the main tree until install-hooks.mjs bootstraps the shared submodule)' : ''}`);
  // F6/restore(): a bootstrap that found a same-named file already checked out on the telemetry
  // branch leaves that interim file stranded in the sibling stash dir instead of silently dropping
  // it — surfaced here (regardless of submodule/plain-dir mode) rather than only promised in a code
  // comment.
  const stash = `${tel}.pre-submodule`;
  if (existsSync(stash)) {
    const stranded = readdirSync(stash);
    add('warning', `stranded interim files: ${stranded.length} in .agents/telemetry.pre-submodule (${stranded.join(', ')}) — move the files back by hand, then rm -r .agents/telemetry.pre-submodule`);
  }
  if (mode === 'submodule') {
    const innerRes = checkPatterns(tel, INNER_PATTERNS, (p) => p.replace(/^\//, '').replace(/\*$/, 'x').replace(/\/$/, '/x'), gitExec);
    add(innerRes.undetermined || innerRes.okCount !== innerRes.total ? 'warning' : 'ok', renderIgnoreLine('inner', innerRes));
    const tracked = (git(tel, ['ls-files', '--', ...TRANSIENT]) ?? '').split('\n').filter(Boolean);
    add(tracked.length ? 'warning' : 'ok', `tracked transients: ${tracked.length}${tracked.length ? ` — ${tracked.join(', ')} (git -C .agents/telemetry rm --cached <path>)` : ''}`);
    const leaked = stagingLeaks(tel, git);
    if (leaked === null) add('warning', 'staging: undetermined (ls-files failed)');
    else add(leaked.length ? 'warning' : 'ok', `staging: ${leaked.length ? 'LEAKING' : 'ok'} (ls-files: ${leaked.length ? `would stage ${leaked.join(', ')}` : 'no untracked transient path'})`);
    const s = gitState(tel, git); add(s.unmerged.length || s.merging ? 'warning' : 'ok', `telemetry git: unmerged=${s.unmerged.length} merging=${s.merging} dirty=${s.dirty} unpushed=${s.unpushed ?? 'no upstream'}`);
  }
  const diag = existsSync(deliveryDir(repo)) ? readdirSync(deliveryDir(repo)).filter((f) => f.startsWith('diagnostics-')) : [];
  // A stop hook that failed captured nothing for that subagent; the count is said here because nothing else shows it.
  let stopFailed = 0; try { stopFailed = readDiagnostics(repo)['stop-hook-failed']; } catch { /* the line count below still prints */ }
  add('info', `diagnostics: ${diag.reduce((n, f) => n + readFileSync(join(deliveryDir(repo), f), 'utf8').split('\n').filter(Boolean).length, 0)} line(s)${stopFailed ? `, stop-hook-failed=${stopFailed} (the stop hook failed for ${stopFailed} subagent(s): their spend may be missing from the totals, not zero)` : ''}`);
  for (const r of runs.filter((r) => r.status === 'open')) {
    const rosterOk = validRoster(r.roster);
    add(rosterOk ? 'ok' : 'warning', `roster: ${r.run} ${rosterOk ? 'valid' : 'INVALID (refresh with plan roster)'}`);
  }
  if (existsSync(sessionsDir(repo))) {
    for (const f of readdirSync(sessionsDir(repo)).filter((n) => n.endsWith('.json')).sort()) {
      let sess = null; try { sess = JSON.parse(readFileSync(join(sessionsDir(repo), f), 'utf8')); } catch { /* surfaced generically below */ }
      if (!sess || typeof sess !== 'object') { add('warning', `session: ${f} malformed`); continue; }
      const owner = runs.find((r) => r.run === sess.plan);
      const status = !owner ? 'missing' : owner.status === 'closed' ? 'closed' : 'ok';
      // A binding to a closed plan is history (plans are meant to be closed), not something to fix.
      add(status === 'missing' ? 'warning' : 'ok', `session: ${sess.host}:${sess.session} -> ${sess.plan} ${status}`);
    }
  }
  return findings;
}

export function doctorReport(repo, rel, opts = {}) {
  const f = doctorFindings(repo, rel, opts);
  const lines = f.map((x) => x.line);
  for (const c of UNCONDITIONAL_CAVEATS) lines.push(`caveat: ${c}`);
  const ok = !f.some((x) => x.severity === 'warning');
  lines.push(`doctor: ${ok ? 'ok' : 'attention'}`);
  return { lines, ok };
}

export function main(argv = process.argv.slice(2), repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()) {
  const has = (f) => argv.includes(f); const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  // An explicit --repo wins over cwd and CLAUDE_PROJECT_DIR, and must name the root it means.
  const explicit = val('--repo'); const problem = explicit != null && explicitRepoProblem(explicit);
  if (problem) { process.stderr.write(`USAGE(${problem})\n`); return 2; }
  repo = resolveOwnerRepo(explicit ?? repo);
  const host = val('--host') ?? 'claude'; if (host !== 'claude') { process.stderr.write(`UNSUPPORTED-HOST(${host})\n`); return 2; }
  const rel = hookRel(repo);
  // Review fix (spec §6.5/D21): doctor always exits 0 — `ok` is informational only, printed as the
  // final `doctor: ok`/`doctor: attention` line (doctorReport), never mapped to a nonzero exit.
  if (has('--doctor')) { const d = doctorReport(repo, rel ?? posix(relative(repo, skillRootOf())), { env: process.env }); for (const l of d.lines) console.log(l); return 0; }
  const remove = has('--remove');
  if (!remove && rel == null) { process.stderr.write(`USAGE(no copy of the delivery-monitor hooks inside ${repo}; install the skill there first, then run its own install-hooks.mjs)\n`); return 2; }
  // Checked before the first write: a settings file that does not parse is never replaced, and nothing else is written either.
  const target = settingsFile(repo, has('--local')), unreadable = settingsProblem(target);
  if (unreadable) { process.stderr.write(`USAGE(${target} ${unreadable}; fix or delete the file, then run this again — nothing was written)\n`); return 2; }
  let tel = { status: 'kept' }; if (!remove && !has('--no-submodule')) tel = bootstrapTelemetry(repo);
  const file = installClaude(repo, rel, { local: has('--local'), remove }); const ig = installIgnoreBlocks(repo, { remove });
  console.log(`${remove ? 'REMOVED' : 'INSTALLED'} ${file}`); console.log(`ignore blocks: root=${ig.root} inner=${ig.inner}`); console.log(`telemetry: ${telemetryMode(repo)} (${tel.status}${tel.reason ? `: ${tel.reason}` : ''})`);
  return 0;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
