// STDLIB ONLY. Derive observations from a pinned integration head (spec §6.7, local-branch mode). PR mode is M2.
import { makeObservation } from './events.mjs';
import { firstCommitContaining, git, isAncestor } from './git.mjs';
import { cliError } from './paths.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function gitLog(repo, args) {
  const out = git(repo, ['log', '--format=%H%x1f%P%x1f%cI%x1f%s', ...args]);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, parents, at, subject] = l.split('\x1f');
    return { sha, parents: parents ? parents.split(' ') : [], at: new Date(at).toISOString(), subject };
  });
}

export function matchMergeSubject(subject, run) {
  const m = /^merge\s+(\S+)/i.exec(subject);
  if (!m) return null;
  const branch = m[1].toLowerCase();
  const byAlias = run.items.find((i) => i.branch && i.branch.toLowerCase() === branch);
  if (byAlias) return byAlias;
  const t = /^task\/task-(\d+)$/.exec(branch);
  return t ? run.items.find((i) => i.ref === `TASK-${t[1]}`) ?? null : null;
}

/**
 * Local-branch backfill (spec §6.7). Two independent gates, deliberately never conflated (obligation
 * F14):
 *   - epoch/cutoff (`source_epoch.from`/`until`, `cutoff`) decide which commits are ELIGIBLE
 *     candidates at all — including, for `done`, which merge is the earliest qualifying one
 *     (episode-1) for a given item. This is computed once, in chronological order, over every
 *     in-epoch qualifying merge, and is never touched by `--since`. A commit that falls outside the
 *     epoch simply never becomes a candidate, so a later in-epoch commit is free to take its place
 *     (e.g. become `first_commit`/episode-1 `done`) — that promotion is legitimate epoch behaviour.
 *   - `--since` is applied only afterwards, to decide whether an already-determined eligible fact is
 *     EMITTED into `records` this run. It never changes which occurrence is "first": an item's
 *     episode-1 merge that predates `--since` still consumes the first-completion slot (so a later
 *     merge for the same item is still just a "later merge ... needs explicit reopen evidence" note,
 *     never promoted to episode-1) — it is simply not written out on this backfill pass.
 */
export function deriveGitObservations({ repo, run, head, since = null, cutoff = null, now = Date.now() }) {
  const ref = run.source_epoch?.integration_ref;
  const notes = [];
  // F14: an integration ref that cannot be resolved at all is a hard error — never "accepted
  // unverified". There is no head_unverified escape hatch.
  const tip = git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]) ?? git(repo, ['rev-parse', '--verify', `refs/heads/${ref}^{commit}`]);
  if (!tip) throw cliError('USAGE', `integration ref ${ref} not found`);
  if (tip !== head && isAncestor(repo, head, tip) !== true) throw cliError('USAGE', `head ${head} is not on integration ref ${ref}`);

  const from = run.source_epoch?.from ? new Date(run.source_epoch.from).toISOString() : null;
  const until = run.source_epoch?.until ? new Date(run.source_epoch.until).toISOString() : null;
  const cut = cutoff ? new Date(cutoff).toISOString() : null;
  const sinceIso = since ? new Date(since).toISOString() : null;

  let skippedOutsideEpoch = 0;
  // Eligibility gate: epoch/cutoff only. `--since` never appears here (F14).
  const inEpoch = (at) => { const ok = (!from || at >= from) && (!until || at < until) && (!cut || at < cut); if (!ok) skippedOutsideEpoch++; return ok; };
  // Emission gate: applied only after eligibility/ordering is settled. No promotion happens here.
  const afterSince = (at) => !sinceIso || at >= sinceIso;

  const meta = (sha, extra = {}) => ({ git_sha: sha, version: run.version, head, ...extra });
  const obs = (item, event, at, sha, transition, extra = {}) => makeObservation({ user: null, host: 'git', plan: run.run, item_id: item.item_id, ref: item.ref, level: item.level, event, at, transition_id: transition, source: 'git', source_record_id: sha, basis: extra.basis ?? 'observed', raw: extra.raw ?? null, meta: meta(sha, extra.meta ?? {}) }, { now });

  const items = run.items.filter((i) => i.level === 'task' && !i.cancelled);
  // Review fix: `matchMergeSubject` searches ALL of `run.items` (branch aliases can live on any
  // level/state), so a merge whose branch happens to match a cancelled task's (or a non-task's)
  // `branch` must still be rejected here — the same eligibility filter as `items` above, applied as
  // a Set of eligible item ids rather than re-filtering per merge.
  const eligibleIds = new Set(items.map((i) => i.item_id));
  const records = [];

  if (run.source?.rel) {
    for (const it of items) {
      const c = firstCommitContaining(repo, head, run.source.rel, it.ref);
      if (c && inEpoch(c.at) && afterSince(c.at)) records.push(obs(it, 'created', c.at, c.sha, `${it.item_id}/created/0`, { basis: 'plan-commit' }));
    }
  } else notes.push('run has no source path — created not derived');

  const nonMerge = gitLog(repo, ['--no-merges', '--reverse', head]);
  for (const it of items) {
    // Eligibility (epoch-filtered) candidates in chronological order; `mine[0]` is the canonical
    // first_commit for this item regardless of `--since` (F14's promotion rule applies the same way
    // here as for `done`: since gates emission of the already-determined first, it never lets a
    // later same-ref commit take its place).
    const mine = nonMerge.filter((c) => new RegExp(`^${esc(it.ref)}:`).test(c.subject) && inEpoch(c.at));
    if (mine.length && afterSince(mine[0].at)) records.push(obs(it, 'first_commit', mine[0].at, mine[0].sha, `${it.item_id}/first_commit/0`, { raw: mine[0].subject }));
    for (const c of mine) {
      if (!afterSince(c.at)) continue;
      const m = new RegExp(`^${esc(it.ref)}: address review(?: (\\d+))?\\b`).exec(c.subject);
      if (m) records.push(obs(it, 'rework_observed', c.at, c.sha, `${it.item_id}/rework_observed/${m[1] ?? `x${c.sha.slice(0, 7)}`}`, { raw: c.subject, meta: { round: m[1] ? Number(m[1]) : null } }));
    }
  }

  const done = new Set();
  for (const c of gitLog(repo, ['--first-parent', '--merges', '--reverse', head])) {
    const it = matchMergeSubject(c.subject, run);
    if (!it || !eligibleIds.has(it.item_id) || c.parents.length < 2) continue;
    // F14: eligibility (episode-1 selection) uses the epoch/cutoff gate only — `--since` is applied
    // below, after the done set has already decided who is episode-1.
    if (!inEpoch(c.at)) continue;
    const evidence = (git(repo, ['log', '--no-merges', '--format=%s', c.parents[1], `^${c.parents[0]}`]) ?? '').split('\n').some((s) => s.startsWith(`${it.ref}:`));
    if (!evidence) { notes.push(`merge ${c.sha.slice(0, 7)} for ${it.ref} lacks second-parent evidence; skipped`); continue; }
    if (done.has(it.item_id)) { notes.push(`later merge ${c.sha.slice(0, 7)} for ${it.ref} needs explicit reopen evidence (M2); skipped`); continue; }
    done.add(it.item_id);
    if (afterSince(c.at)) records.push(obs(it, 'done', c.at, c.sha, `${it.item_id}/done/episode-1`, { raw: c.subject }));
    else notes.push(`first completion ${c.sha.slice(0, 7)} for ${it.ref} is before --since ${sinceIso}; no done record emitted this run`);
  }

  records.sort((a, b) => a.at.localeCompare(b.at));
  return { records, notes, skippedOutsideEpoch, head };
}
