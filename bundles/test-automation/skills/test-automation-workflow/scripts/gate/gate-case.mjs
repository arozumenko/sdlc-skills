// gate-case.mjs — the MECHANICAL half of the lead's hardening gate.
//
// The gate's independence is doctrine: no implementer self-report and no
// reviewer APPROVED substitutes for the lead running the spec N× green against
// a live env before merge. That is about JUDGMENT, not typing. This script does
// the typing — fetch, check the branch out, merge the base FIRST, run the spec
// N times, time each run — and returns a verdict for the lead to read and act
// on. It never merges a PR, never writes the board, never resolves a conflict,
// and never decides anything.
//
// Why it exists (cov60, 2026-07-24): the pipeline produced 36 implemented cases
// while the lead's hand-run gate drained 12 — 3h50m and 114 shell calls for 8
// merges. Implementation throughput ran ~3× gate throughput, so the gate, not
// analysis, was the campaign's binding constraint.
//
// Two field lessons are baked in:
//   * MERGE THE BASE FIRST. On a busy campaign the base branch moves under
//     every merge, so a gate run against a branch that lacks base proves
//     nothing about what will actually land — and several runs had to be
//     thrown away and redone for exactly this reason.
//   * IT RUNS IN THE PROJECT'S OWN CHECKOUT, on a branch. Earlier revisions
//     gated inside a scratch worktree, which meant re-solving the problem a
//     worktree creates: it carries only TRACKED files, so the suite arrived
//     without its env file and without installed dependencies, and a relative
//     env symlink (`automation/.env.test` → `../../.env.test`) resolved
//     nowhere — surfacing as a misleading auth error ("Invalid URL ''") rather
//     than a missing file. The real checkout has all of it already. Gating is
//     the finalisation step and runs when nothing else writes the tree, so a
//     branch is isolation enough. It leaves the tree DETACHED at the gated
//     commit (branch tip + base merged); check your branch out to continue.
//
// usage:
//   node gate-case.mjs --branch <ref> --base <ref> --spec <node-id> \
//     --cmd '<shell command with {spec}>' [--n 3] [--timeout <s>] \
//     [--remote <name>] [--repo .] [--json]
//
// The remote is ASKED FOR, not assumed: `git remote` answers it, `--remote`
// overrides, and a repo with none gates what is on disk and says so.
//
// exit codes: 0 = N consecutive green · 1 = red / conflict · 2 = usage
//
// Every verdict is ALSO appended to .agents/automation/<slug>/gate-runs.jsonl
// the moment it exists — script-authored, so the record of "the gate ran and
// went green" never depends on anyone remembering to write a report back.
// Measured cost of not having this: 38 of 69 delivered cases (55%) scored as
// unproven in a rollup because a recovered gate's verdict was never recorded.
import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRemote } from '../git-env.mjs';
// Tiny local argv helpers — this script is standalone (the board library they
// used to come from is gone with the board).
const argValue = (argv, name) => {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  // A following flag is never a value: `--branch --json` means --branch got none.
  return v !== undefined && !String(v).startsWith('--') ? v : undefined;
};
const hasFlag = (argv, name) => argv.includes(name);

// ---- pure helpers (unit-tested) --------------------------------------------

// The spec goes in via {spec}; a command without the placeholder gets it
// appended, so both styles work and neither silently drops the spec.
export function buildRunCommand(cmd, spec) {
  if (!cmd) throw new Error('--cmd is required');
  if (!spec) return cmd;
  // Function replacement: a spec containing `$&` / "$`" must land verbatim,
  // not trigger string-replacement pattern semantics.
  if (cmd.includes('{spec}')) return cmd.replaceAll('{spec}', () => spec);
  // Appended specs get quoted when they need it (parameterized node ids carry
  // spaces and brackets); a caller using {spec} owns its own quoting.
  const safe = /[^\w@%+=:,./\\-]/.test(spec) ? `"${spec.replaceAll('"', '\\"')}"` : spec;
  return `${cmd} ${safe}`;
}

// N CONSECUTIVE green is the contract — a red anywhere resets the streak, so
// there is no point continuing past the first failure.
export function summarize(runs, n) {
  let streak = 0;
  for (const r of runs) streak = r.ok ? streak + 1 : 0;
  const seconds = runs.map((r) => r.seconds);
  return {
    runs,
    consecutiveGreen: streak,
    required: n,
    verdict: streak >= n ? 'green' : 'red',
    seconds,
  };
}

// tests/batch-<slug> → <slug>; anything else is not a batch trunk.
export function batchSlugOfBranch(branch) {
  const m = /^tests\/batch-(.+)$/.exec(String(branch || ''));
  return m ? m[1] : null;
}

/**
 * Append the verdict record. Never fatal — a gate that ran green must not
 * turn red over bookkeeping. `--batch` overrides the slug when the gated
 * branch is not a batch trunk (a per-case branch, a stabilize round);
 * otherwise unassignable verdicts land under `_gates` rather than vanishing.
 */
export function appendGateRecord(repo, result, { batch = null, now = new Date().toISOString() } = {}) {
  try {
    const slug = batch ?? batchSlugOfBranch(result.branch) ?? '_gates';
    // Write-side goes to the telemetry area when it exists: a record appended
    // into the batch dir between run 1 and run 2 is a COMMITTED-file
    // modification once the batch has closed, and `git checkout` then refuses
    // the very branch switch the gate needs. Telemetry rides its own branch
    // (or is gitignored in the plain-dir phase), so writes there never touch
    // the main tree. Close folds these lines back into the batch dir.
    // Check the submodule ROOT (that's what install creates); write into this
    // bundle's automation/ subfolder — mkdir below creates it on first use.
    const telRoot = join(repo, '.agents', 'telemetry');
    const file = existsSync(telRoot)
      ? join(telRoot, 'automation', 'gate-runs', `${slug}.jsonl`)
      : join(repo, '.agents', 'automation', slug, 'gate-runs.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({
      at: now, branch: result.branch, base: result.base,
      ...(result.baseRef ? { baseRef: result.baseRef } : {}),
      ...(result.spec ? { spec: result.spec } : {}),
      n: result.n, verdict: result.verdict,
      consecutiveGreen: result.consecutiveGreen ?? 0,
      seconds: result.seconds ?? [],
      ...(result.conflictFiles?.length ? { conflictFiles: result.conflictFiles } : {}),
      // Unrelated dirt the gate proceeded over — the verdict stays honest
      // about the environment without having been hostage to it.
      ...(result.carriedDirt?.length ? { carriedDirt: result.carriedDirt } : {}),
      ...(result.carriedDirtMore ? { carriedDirtMore: result.carriedDirtMore } : {}),
    })}\n`);
    return file;
  } catch { return null; }
}

// The exact --note text the lead pastes into the PR / run report, so the
// record carries evidence (timings) rather than an unfalsifiable "gate passed".
export function gateNote(summary, extra = '') {
  const times = summary.seconds.map((s) => `${s.toFixed(2)}s`).join('/');
  const head = summary.verdict === 'green'
    ? `Lead gate ${summary.consecutiveGreen}/${summary.required} green (${times})`
    : `Lead gate NOT ${summary.required}/${summary.required} green: ${summary.runs.filter((r) => !r.ok).length} of ${summary.runs.length} run(s) failed (${times})`;
  return extra ? `${head}; ${extra}` : head;
}

// ---- git / exec (side-effecting) -------------------------------------------

const git = (repo, args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The exact paths git refuses to overwrite, parsed from a failed checkout/
// merge ("Your local changes to the following files would be overwritten…" /
// "…untracked working tree files would be overwritten…"). git indents each
// victim with a tab; the list ends at the first unindented line.
export function overwriteVictims(err) {
  const msg = `${err?.message ?? ''}\n${err?.stderr ?? ''}`;
  const m = msg.match(/would be overwritten by (?:checkout|merge):\n((?:[ \t]+[^\n]+\n?)+)/);
  return m ? m[1].split('\n').map((s) => s.trim()).filter((s) => s && !/^Please\b|^Aborting/.test(s)) : [];
}

function conflictFiles(repo) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repo, encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

function runOnce(cmd, repo, timeoutMs = 0) {
  const started = process.hrtime.bigint();
  let ok = true; let exitCode = 0; let timedOut = false;
  try {
    execSync(cmd, {
      cwd: repo, stdio: ['ignore', 'inherit', 'inherit'],
      // A wedged env otherwise hangs the gate forever — the exact live-env
      // failure mode this gate exists to surface.
      ...(timeoutMs > 0 ? { timeout: timeoutMs, killSignal: 'SIGKILL' } : {}),
    });
  } catch (e) {
    ok = false; exitCode = typeof e.status === 'number' ? e.status : 1;
    timedOut = e.code === 'ETIMEDOUT';
  }
  return { ok, exitCode, timedOut, seconds: Number(process.hrtime.bigint() - started) / 1e9 };
}

function fail(result, json) {
  print(result, json);
  process.exit(1);
}

function print(result, json) {
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`verdict: ${result.verdict}`);
  if (result.notes) console.log(`notes:   ${result.notes}`);
  if (result.conflictFiles?.length) console.log(`conflicts:\n  ${result.conflictFiles.join('\n  ')}`);
  for (const [i, r] of (result.runs ?? []).entries()) {
    console.log(`  run ${i + 1}: ${r.ok ? 'GREEN' : `RED (${r.timedOut ? 'timed out' : `exit ${r.exitCode}`})`} ${r.seconds.toFixed(2)}s`);
  }
  if (result.note) console.log(`\n--note ${JSON.stringify(result.note)}`);
}

function main() {
  const argv = process.argv.slice(2);
  const branch = argValue(argv, '--branch');
  const base = argValue(argv, '--base');
  const cmd = argValue(argv, '--cmd');
  const spec = argValue(argv, '--spec') ?? '';
  const n = Number(argValue(argv, '--n') ?? 3);
  const timeoutS = Number(argValue(argv, '--timeout') ?? 0);
  const repo = resolve(argValue(argv, '--repo') ?? process.cwd());
  // ASKED, not assumed. `origin` was hardcoded here, so a fork checkout
  // (`upstream`) or any renamed remote failed fetch and then reported the
  // branch as unreachable — an infrastructure fact surfacing as a red gate.
  const remote = resolveRemote(repo, argValue(argv, '--remote'));
  const json = hasFlag(argv, '--json');
  if (!branch || !base || !cmd || !Number.isFinite(n) || n < 1 || !Number.isFinite(timeoutS) || timeoutS < 0) {
    console.error('usage: gate-case.mjs --branch <ref> --base <ref> --cmd \'<cmd with {spec}>\' [--spec <node-id>]');
    console.error('       [--n 3] [--timeout <seconds per run — a hung run is killed and counts red>]');
    console.error('       [--remote <name>] [--repo .] [--json]   (remote: discovered from `git remote` by default)');
    console.error('       [--batch <slug>]  (verdict-record slug when the branch is not tests/batch-<slug>)');
    process.exit(2);
  }
  const result = { branch, base, spec, n, verdict: 'error', notes: '' };

  // Gate in the real tree — but judge its dirt precisely, not blanketly
  // (see the dirt-policy block below): refuse only what would poison the
  // proof or collide with the branch switch; carry the rest, on the record.
  try {
    // Not fatal: a repo with no remote, or an unreachable one, is still gateable
    // against what is on disk. Letting fetch throw here killed the whole setup
    // block — including the local-branch fallback below — so a perfectly good
    // local branch reported "git setup failed" instead of running.
    if (remote) { try { git(repo, ['fetch', remote, '--quiet']); } catch { result.fetched = false; } }
    else result.fetched = false;                     // no remote at all — local-only repo
    // Dirt policy — precise, not blanket (reworked 2026-08-17 after a field
    // case where a foreign bundle's debug log and installer-touched configs
    // blocked gates that had nothing to do with them). Dirt endangers a gate
    // in exactly two ways, and each gets its own precise treatment:
    //   1. PROOF CONTAMINATION — a dirty path among the files this gate is
    //      ABOUT (the base...branch diff): the spec run would prove the dirt,
    //      not the branch. Always refuse, naming the paths.
    //   2. GIT MECHANICS — checkout/merge refuse when a dirty path collides
    //      with the switch. git itself is the precise judge there: we attempt
    //      the operation and surface ITS victim list (catch blocks below)
    //      instead of pre-refusing on everything.
    // Everything else — logs, configs, other bundles' state, docs — is
    // somebody else's business: the gate proceeds and books it in the verdict
    // record as carriedDirt, honest about the environment without being
    // hostage to it.
    // RAW output, not the trimming git() helper: porcelain's XY column starts
    // with a SPACE for worktree-modified files, and a global trim eats it on
    // the first line — slice(3) then mangles the path (caught by test).
    const dirtyPaths = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: repo, encoding: 'utf8' })
      .split('\n').filter((s) => s.trim())
      .map((l) => l.slice(3).replace(/^"|"$/g, ''));
    if (dirtyPaths.length) {
      const refOf = (name) => {
        for (const r of [remote ? `${remote}/${name}` : null, name]) {
          if (!r) continue;
          try { git(repo, ['rev-parse', '--verify', r]); return r; } catch { /* next */ }
        }
        return null;
      };
      let proofSet = [];
      const bRef = refOf(branch); const baRef = refOf(base);
      if (bRef && baRef) {
        try { proofSet = git(repo, ['diff', '--name-only', `${baRef}...${bRef}`]).split('\n').filter(Boolean); } catch { /* no diff → no contamination check */ }
      }
      const contaminated = dirtyPaths.filter((p) => proofSet.includes(p));
      if (contaminated.length) {
        result.notes = `dirty paths overlap the very files this gate proves (${contaminated.join(', ')}) — the run would prove the dirt, not the branch. Commit them or stash BY PATH (git stash push -- <paths>); NEVER stash or clean the whole tree (untracked receipts/AFS/memory vanish silently).`;
        return fail(result, json);
      }
      result.carriedDirt = dirtyPaths.slice(0, 20);
      if (dirtyPaths.length > 20) result.carriedDirtMore = dirtyPaths.length - 20;
    }
    // origin/<branch> is the intended target: it is what will actually be
    // reviewed and merged, and a local-only branch may hold commits nobody else
    // can see. But refusing outright turned an unpushed branch into a RED gate —
    // an infrastructure fact reported as a test failure, which is the worst kind
    // of wrong answer. Fall back to the local branch and SAY SO in the note, so
    // the verdict stays honest about what it actually proved.
    try {
      if (!remote) throw new Error('no remote');
      git(repo, ['checkout', '--detach', `${remote}/${branch}`]);
      result.remote = remote;
    } catch {
      git(repo, ['rev-parse', '--verify', `refs/heads/${branch}`]);   // throws → caught below
      git(repo, ['checkout', '--detach', branch]);
      result.localOnly = true;
    }
  } catch (e) {
    // git names the exact colliding paths when local changes block a checkout —
    // surface THAT (precise, actionable) instead of a generic setup failure.
    const victims = overwriteVictims(e);
    result.notes = victims.length
      ? `checkout blocked by local changes to: ${victims.join(', ')} — commit them or stash BY PATH (git stash push -- <paths>); NEVER stash or clean the whole tree (untracked receipts/AFS/memory vanish silently).`
      : `git setup failed: ${String(e.message).split('\n')[0]}` +
        ` (branch '${branch}' is on neither origin nor local — the integrator should have pushed it)`;
    return fail(result, json);
  }

  // Base FIRST — gate what will actually land, not what the branch was cut from.
  try {
    // Same reason as the branch: fall back to the local base ref when origin has
    // none, so a remote-less repo still gates against what will land.
    let baseRef = remote ? `${remote}/${base}` : base;
    try { git(repo, ['rev-parse', '--verify', baseRef]); }
    catch { baseRef = base; }
    git(repo, ['-c', 'user.email=gate@local', '-c', 'user.name=gate', 'merge', baseRef, '--no-edit']);
    result.baseMerged = true;
    result.baseRef = baseRef;      // report what was ACTUALLY merged, not what was asked for
  } catch (e) {
    // Collect the unmerged paths BEFORE aborting — the abort erases them.
    const files = conflictFiles(repo);
    // Abort the half-merge (best effort) so the tree stays usable — leaving
    // MERGE_HEAD behind makes the NEXT gate run refuse with a misleading
    // "working tree is dirty" that only `git merge --abort` by hand would fix.
    try { git(repo, ['merge', '--abort']); } catch { /* no merge in progress */ }
    // Local changes blocking the merge are NOT a branch conflict — report
    // git's own victim list instead of mislabeling it one.
    const victims = overwriteVictims(e);
    if (victims.length) {
      result.notes = `merging ${base} blocked by local changes to: ${victims.join(', ')} — commit them or stash BY PATH (git stash push -- <paths>); NEVER stash or clean the whole tree.`;
      return fail(result, json);
    }
    result.verdict = 'conflict';
    result.conflictFiles = files;
    result.notes =
      'branch conflicts with the current base — NOT gated (the half-merge was aborted; the tree is clean, detached at the branch tip). ' +
      'Resolve on the case branch (mechanical unions only; ' +
      'a semantic collision goes back to the implementer as a fix-only dispatch), then re-run the gate.';
    appendGateRecord(repo, result, { batch: argValue(argv, '--batch') ?? null });
    return fail(result, json);
  }


  const runCmd = buildRunCommand(cmd, spec);
  result.command = runCmd;
  const runs = [];
  for (let i = 0; i < n; i++) {
    const r = runOnce(runCmd, repo, timeoutS * 1000);
    runs.push(r);
    if (!r.ok) break; // N CONSECUTIVE — a red ends the attempt
  }
  Object.assign(result, summarize(runs, n));
  // A local-only gate proved the branch as it exists HERE, which is not
  // necessarily what a reviewer will see — say it in the note rather than
  // letting a green read as unconditional.
  const context = [
    result.baseMerged ? `merged ${result.baseRef} before gating` : '',
    result.localOnly ? `gated LOCAL branch '${branch}' — not on ${remote ?? 'any remote'}, so this proves your checkout, not what is pushed` : '',
  ].filter(Boolean).join('; ');
  result.note = gateNote(result, context);
  // The verdict record lands BEFORE anything reads or acts on it — the whole
  // point is that a crash after this line can no longer lose the verdict.
  appendGateRecord(repo, result, { batch: argValue(argv, '--batch') ?? null });
  print(result, json);
  process.exit(result.verdict === 'green' ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
