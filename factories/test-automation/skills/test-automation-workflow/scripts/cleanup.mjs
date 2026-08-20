// cleanup.mjs — close-out cleanup: delivered branches, and any worktree left
// behind by hand-run work or an older revision of this pipeline.
//
// usage:
//   node cleanup.mjs --merged a,b|@file [--report <path> | --branches x,y|@file]
//                    [--also b1,b2] [--apply] [--remote-delete] [--remote <name>] [--repo dir]
//
// DRY-RUN BY DEFAULT: prints the plan (DELETE/KEEP with reasons); --apply runs it.
//
// THIS SCRIPT DECIDES NOTHING. It is the second half of a pair — the AGENT
// decides, this refuses. That split is deliberate and it is where the safety
// lives:
//
//   THE AGENT knows things a script cannot: which system holds "did it merge"
//             (GitHub / GitLab / Bitbucket / Azure DevOps / Gitea, recorded in
//             `.agents/workflow.md` § Host), which CLI answers it, what this
//             project's branches are called, and which of them belong to the
//             batch being closed. It reads the seed, asks the right system, and
//             hands the answer in via `--merged` and `--branches`/`--report`.
//   THIS SCRIPT enforces the one invariant that must not depend on anybody's
//             judgement being right: NOTHING IS DELETED WITHOUT A MERGED CLAIM
//             NAMING IT. Plus dry-run by default, never the checked-out branch,
//             and worktrees only for branches already authorised.
//
// Why the invariant is worth a script at all, when the agent is the one that
// knows: a squash merge defeats git's own ancestry check, so `git branch -d`
// cannot tell "merged" from "abandoned" — the deletion is unrecoverable and
// there is no second chance to notice. A board once had 4 of 12 merged cases
// mis-stated. An agent that has reasoned its way to a wrong list should still
// be unable to destroy anything with it.
//
// `--merged` is therefore REQUIRED and has no fallback probe. A script that
// guesses the host is a script deciding, and the guess is silent when wrong.
//
// RESIDUAL RISK, by NAME not by commit: a branch re-created under a name that
// merged in an EARLIER campaign is deletable even though its current tip never
// merged. (An ancestry check cannot close this — squash merges defeat it by
// design, which is why -D is used here at all.) Avoid re-using merged branch
// names for new work; clean promptly after merging.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveRemote } from './git-env.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function localBranches(root) {
  const out = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  return new Set(out ? out.split('\n') : []);
}
function remoteBranches(root, remote) {
  if (!remote) return new Set();
  const out = git(root, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}/`]);
  return new Set(out ? out.split('\n').map((b) => b.replace(new RegExp(`^${remote}/`), '')) : []);
}
function worktrees(root) {
  const out = git(root, ['worktree', 'list', '--porcelain']);
  const list = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === '' && cur.path) { list.push(cur); cur = {}; }
  }
  if (cur.path) list.push(cur);
  return list; // first entry is the main worktree
}

/** `a,b,c` or `@file` (one per line, `#` comments ok) → array. */
export function parseList(value, readFile = readFileSync) {
  if (!value) return null;
  const text = value.startsWith('@') ? readFile(value.slice(1), 'utf8') : value;
  const names = text.split(/[\n,]/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  return names;                          // [] is meaningful: "asked, none merged"
}

/**
 * Decide what may go. A branch is deletable only when the supplied merged set
 * names it — the candidate list contributes NAMES TO CONSIDER and nothing else.
 * It can be stale; the merged answer is what authorises.
 */
export function planCleanup(root, { candidates = [], integrationBranch = null, also = [], merged = [] } = {}) {
  const mergedSet = merged instanceof Set ? merged : new Set(merged);
  const existing = localBranches(root);
  const current = git(root, ['branch', '--show-current']);
  const deletable = [];
  const kept = [];

  const consider = (branch, why, bucket) => {
    if (!branch || !existing.has(branch)) return;             // already gone
    if (branch === current) { kept.push({ branch, why: 'checked out here — switch away first' }); return; }
    if (!mergedSet.has(branch)) { kept.push({ branch, why: why ?? 'no merged change request names it' }); return; }
    bucket.push({ branch });
  };

  const seen = new Set();
  for (const c of candidates) {
    const branch = typeof c === 'string' ? c : c?.branch;
    if (!branch || seen.has(branch)) continue;
    seen.add(branch);
    const riders = typeof c === 'object' && c?.ids?.length ? ` (cases ${c.ids.join(', ')})` : '';
    consider(branch, `no merged change request names it${riders}`, deletable);
  }

  // The integration branch and campaign wave branches: deletable once their
  // content is on base, which the merged set answers the same way.
  const integration = [];
  for (const b of [integrationBranch, ...also].filter(Boolean)) {
    if (seen.has(b)) continue;
    seen.add(b);
    consider(b, 'integration branch not merged yet', integration);
  }

  const deletableSet = new Set([...deletable, ...integration].map((d) => d.branch));
  const [, ...linked] = worktrees(root);        // drop the main worktree
  // This pipeline creates no worktrees. Any that exist came from hand-run work
  // or an older revision — and the periodic sweep skips them forever because
  // they hold unpushed commits, so this is the only thing that clears them.
  const removableWts = linked.filter((w) => w.branch && deletableSet.has(w.branch));

  return { deletable, integration, worktrees: removableWts, kept };
}

export function applyCleanup(root, plan, { remoteDelete = false, remote = null } = {}) {
  const done = { worktrees: [], branches: [], remote: [], failed: [] };
  for (const w of plan.worktrees) {
    try { git(root, ['worktree', 'remove', '--force', w.path]); done.worktrees.push(w.path); }
    catch (e) { done.failed.push(`worktree ${w.path}: ${String(e.message).split('\n')[0]}`); }
  }
  const remotes = remoteDelete ? remoteBranches(root, remote) : new Set();
  for (const { branch } of [...plan.deletable, ...plan.integration]) {
    try {
      // -D, not -d: a squash merge defeats the ancestry check. The merged claim
      // is the authorisation, and planCleanup already required one.
      git(root, ['branch', '-D', branch]);
      done.branches.push(branch);
      if (remoteDelete && remote && remotes.has(branch)) {
        try { git(root, ['push', remote, '--delete', branch]); done.remote.push(branch); }
        catch (e) { done.failed.push(`${remote}/${branch}: ${String(e.message).split('\n')[0]}`); }
      }
    } catch (e) { done.failed.push(`branch ${branch}: ${String(e.message).split('\n')[0]}`); }
  }
  return done;
}

// A following flag is never a value: `--report --apply` means --report got none.
function arg(argv, name) {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v !== undefined && !String(v).startsWith('--') ? v : undefined;
}

function usage() {
  console.error('usage: cleanup.mjs --merged a,b|@file [--report <path/report.json> | --branches x,y|@file]');
  console.error('                   [--also b1,b2] [--apply] [--remote-delete] [--remote <name>] [--repo dir]');
  console.error('');
  console.error('  --merged   REQUIRED. Branches whose change request merged — the delete');
  console.error('             authorisation, and the one thing this script will not guess.');
  console.error('             Read `.agents/workflow.md` § Host, ask that system (gh / glab /');
  console.error('             az repos / the API), and pass the answer. An empty value is a');
  console.error('             valid answer ("nothing merged") and authorises nothing.');
  console.error('  --branches Branch names to consider. Omit when using --report.');
  console.error('  --report   Take candidate branch names from a run report instead.');
  console.error('  --remote   Remote for --remote-delete. Default: discovered from `git remote`.');
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { usage(); }
  const mergedArg = arg(argv, '--merged');
  const reportPath = arg(argv, '--report');
  const branchesArg = arg(argv, '--branches');
  // Absent --merged is "you did not answer"; an empty one is "nothing merged".
  // Only the first is a usage error — the second is a legitimate, safe answer.
  if (mergedArg === undefined || (!reportPath && !branchesArg)) usage();

  const root = arg(argv, '--repo') ?? process.cwd();
  const also = parseList(arg(argv, '--also')) ?? [];
  const merged = parseList(mergedArg) ?? [];

  let candidates = [];
  let integrationBranch = null;
  if (reportPath) {
    if (!existsSync(reportPath)) { console.error(`report not found: ${reportPath}`); process.exit(2); }
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const byBranch = new Map();
    for (const c of (report.cases ?? [])) {
      if (!c.branch) continue;
      if (!byBranch.has(c.branch)) byBranch.set(c.branch, { branch: c.branch, ids: [] });
      byBranch.get(c.branch).ids.push(c.id);
    }
    candidates = [...byBranch.values()];
    integrationBranch = report.integration_branch ?? null;
  }
  if (branchesArg) candidates = [...candidates, ...(parseList(branchesArg) ?? [])];

  const remote = resolveRemote(root, arg(argv, '--remote'));
  const plan = planCleanup(root, { candidates, integrationBranch, also, merged });

  for (const d of plan.deletable) console.log(`DELETE branch ${d.branch}  (named by --merged)`);
  for (const i of plan.integration) console.log(`DELETE integration ${i.branch}  (named by --merged)`);
  for (const w of plan.worktrees) console.log(`REMOVE worktree ${w.path}  (on ${w.branch})`);
  for (const k of plan.kept) console.log(`KEEP   ${k.branch}  — ${k.why}`);
  if (!plan.deletable.length && !plan.integration.length && !plan.worktrees.length) console.log('nothing to clean');

  if (!argv.includes('--apply')) {
    console.log('\n(dry-run — re-run with --apply to execute'
      + (argv.includes('--remote-delete') ? '' : `; add --remote-delete to also delete ${remote ?? 'remote'} refs`) + ')');
    return;
  }
  const done = applyCleanup(root, plan, { remoteDelete: argv.includes('--remote-delete'), remote });
  console.log(`removed ${done.worktrees.length} worktree(s), deleted ${done.branches.length} branch(es)`
    + (done.remote.length ? `, ${done.remote.length} ${remote} ref(s)` : ''));
  if (done.failed.length) { done.failed.forEach((f) => console.error(`FAILED: ${f}`)); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
