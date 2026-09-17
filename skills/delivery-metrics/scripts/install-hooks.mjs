#!/usr/bin/env node
// STDLIB ONLY. Opt-in Claude SubagentStop capture + shared telemetry submodule (spec §6.1, §6.6, D15). Installing the skill never wires this.
import { realpathSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deliveryDir, sessionsDir, resolveOwnerRepo } from './lib/paths.mjs';
import { listRuns } from './lib/plan.mjs';
import { git as gitq, gitState } from './lib/git.mjs';
import { UNCONDITIONAL_CAVEATS } from './lib/report.mjs';

export const MARKER = '_delivery';
export const skillRootOf = (url = import.meta.url) => dirname(dirname(fileURLToPath(url)));
const posix = (p) => p.split('\\').join('/');
const readJson = (p, fb) => { if (!existsSync(p)) return fb; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const writeJson = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`); };

export function installClaude(repo, rel, { local = false, remove = false } = {}) {
  const file = join(repo, '.claude', local ? 'settings.local.json' : 'settings.json');
  const existed = existsSync(file);
  const settings = readJson(file, {}); settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const kept = (Array.isArray(settings.hooks.SubagentStop) ? settings.hooks.SubagentStop : []).filter((e) => !e || !e[MARKER]);
  if (!remove) kept.push({ matcher: '*', hooks: [{ type: 'command', command: `node "${posix(resolve(repo, rel, 'hooks/dispatch-hook.mjs'))}" --stop`, timeout: 30, async: true }], [MARKER]: true });
  if (kept.length) settings.hooks.SubagentStop = kept; else delete settings.hooks.SubagentStop;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  // --remove on a settings file that never existed, with nothing else left to write, must not
  // conjure an empty settings.json into existence.
  if (remove && !existed && !Object.keys(settings).length) return file;
  writeJson(file, settings); return file;
}

const BEGIN = '# >>> delivery-metrics (managed)', END = '# <<< delivery-metrics';
const ROOT_PATTERNS = ['.agents/telemetry/delivery/reports/', '.agents/telemetry/delivery/.lock/', '.agents/telemetry/delivery/.pending-*'];
const INNER_PATTERNS = ['/delivery/reports/', '/delivery/.lock/', '/delivery/.pending-*'];
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

const TELEMETRY_README = '# telemetry\n\nShared durable telemetry submodule (branch `telemetry`), one subfolder per factory or cross-factory concern: `automation/` (tokenomics), `delivery/` (delivery-metrics). Nobody hand-commits here; each capture moment commits and pushes best-effort.\n';
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
function checkIgnoreOne(cwd, probe) {
  try { execFileSync('git', ['check-ignore', '-q', '--no-index', '--', probe], { cwd, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }); return { hit: true }; }
  catch (e) {
    if (e.status === 1) return { hit: false };
    const reason = (e.stderr ? String(e.stderr) : String(e.message)).trim().split('\n')[0] || `exit ${e.status}`;
    return { hit: null, reason };
  }
}
function gitignoreLines(cwd) {
  const file = join(cwd, '.gitignore');
  if (!existsSync(file)) return null;
  try { return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()); } catch { return null; }
}
function checkPatterns(cwd, patterns, probeOf) {
  let fellBack = false, undetermined = null;
  const okCount = patterns.reduce((n, p) => {
    const r = checkIgnoreOne(cwd, probeOf(p));
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
// look right to the eye). GIT_INDEX_FILE points at a throwaway, never-created path so this reads a
// disposable index only — it never touches the telemetry repo's real index or working tree, and the
// throwaway file is removed in `finally` regardless of outcome.
function stagingLeaks(tel) {
  const idx = join(tmpdir(), `dm-doctor-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const out = execFileSync('git', ['add', '-A', '--dry-run'], { cwd: tel, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_INDEX_FILE: idx } });
    return out.split('\n').filter(Boolean).map((l) => l.replace(/^add '(.*)'$/, '$1')).filter((p) => /^delivery\/(reports\/|\.lock\/|\.pending-)/.test(p));
  } catch { return null; }
  finally { try { rmSync(idx, { force: true }); } catch { /* disposable */ } }
}

export function doctorReport(repo, rel) {
  repo = resolveOwnerRepo(repo);
  const lines = []; let ok = true;
  const settings = readJson(join(repo, '.claude', 'settings.json'), {}), local = readJson(join(repo, '.claude', 'settings.local.json'), {});
  const wired = [...(settings.hooks?.SubagentStop ?? []), ...(local.hooks?.SubagentStop ?? [])].some((e) => e && e[MARKER]);
  lines.push(`hook: ${wired ? 'wired' : 'not wired'} (Claude SubagentStop, marker ${MARKER})`); if (!wired) ok = false;
  const runs = listRuns(repo); lines.push(`plans: ${runs.filter((r) => r.status === 'open').length} open, ${runs.length} total`);
  lines.push(`sessions bound: ${existsSync(sessionsDir(repo)) ? readdirSync(sessionsDir(repo)).length : 0}`);
  const rootRes = checkPatterns(repo, ROOT_PATTERNS, (p) => p.replace(/\*$/, 'x').replace(/\/$/, '/x'));
  lines.push(renderIgnoreLine('root', rootRes)); if (rootRes.undetermined || rootRes.okCount !== rootRes.total) ok = false;
  const tel = join(repo, '.agents', 'telemetry'); const mode = telemetryMode(repo); lines.push(`telemetry: ${mode}${mode === 'plain-dir' ? ' (records ride the main tree until install-hooks.mjs bootstraps the shared submodule)' : ''}`);
  // F6/restore(): a bootstrap that found a same-named file already checked out on the telemetry
  // branch leaves that interim file stranded in the sibling stash dir instead of silently dropping
  // it — surfaced here (regardless of submodule/plain-dir mode) rather than only promised in a code
  // comment.
  const stash = `${tel}.pre-submodule`;
  if (existsSync(stash)) {
    const stranded = readdirSync(stash);
    lines.push(`stranded interim files: ${stranded.length} in .agents/telemetry.pre-submodule (${stranded.join(', ')}) — move the files back by hand, then rm -r .agents/telemetry.pre-submodule`);
    ok = false;
  }
  if (mode === 'submodule') {
    const innerRes = checkPatterns(tel, INNER_PATTERNS, (p) => p.replace(/^\//, '').replace(/\*$/, 'x').replace(/\/$/, '/x'));
    lines.push(renderIgnoreLine('inner', innerRes)); if (innerRes.undetermined || innerRes.okCount !== innerRes.total) ok = false;
    const tracked = (gitq(tel, ['ls-files', 'delivery/reports', 'delivery/.lock']) ?? '').split('\n').filter(Boolean); lines.push(`tracked transients: ${tracked.length}${tracked.length ? ` — ${tracked.join(', ')} (git -C .agents/telemetry rm --cached <path>)` : ''}`); if (tracked.length) ok = false;
    const leaked = stagingLeaks(tel);
    if (leaked === null) lines.push('staging: undetermined (disposable-index git add -A failed)');
    else { lines.push(`staging: ${leaked.length ? 'LEAKING' : 'ok'} (disposable-index git add -A${leaked.length ? ` would stage: ${leaked.join(', ')}` : ' stages no transient path'})`); if (leaked.length) ok = false; }
    const s = gitState(tel); lines.push(`telemetry git: unmerged=${s.unmerged.length} merging=${s.merging} dirty=${s.dirty} unpushed=${s.unpushed ?? 'no upstream'}`); if (s.unmerged.length || s.merging) ok = false;
  }
  const diag = existsSync(deliveryDir(repo)) ? readdirSync(deliveryDir(repo)).filter((f) => f.startsWith('diagnostics-')) : [];
  lines.push(`diagnostics: ${diag.reduce((n, f) => n + readFileSync(join(deliveryDir(repo), f), 'utf8').split('\n').filter(Boolean).length, 0)} line(s)`);
  for (const c of UNCONDITIONAL_CAVEATS) lines.push(`caveat: ${c}`);
  return { lines, ok };
}

export function main(argv = process.argv.slice(2), repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()) {
  repo = resolveOwnerRepo(repo);
  const has = (f) => argv.includes(f); const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const host = val('--host') ?? 'claude'; if (host !== 'claude') { process.stderr.write(`UNSUPPORTED-HOST(${host})\n`); return 2; }
  const rel = posix(relative(repo, skillRootOf()));
  if (has('--doctor')) { const d = doctorReport(repo, rel); for (const l of d.lines) console.log(l); return d.ok ? 0 : 1; }
  const remove = has('--remove');
  let tel = { status: 'kept' }; if (!remove && !has('--no-submodule')) tel = bootstrapTelemetry(repo);
  const file = installClaude(repo, rel, { local: has('--local'), remove }); const ig = installIgnoreBlocks(repo, { remove });
  console.log(`${remove ? 'REMOVED' : 'INSTALLED'} ${file}`); console.log(`ignore blocks: root=${ig.root} inner=${ig.inner}`); console.log(`telemetry: ${telemetryMode(repo)} (${tel.status}${tel.reason ? `: ${tel.reason}` : ''})`);
  return 0;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
