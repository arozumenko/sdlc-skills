// STDLIB ONLY. PR-mode backfill (spec §6.7): `done` from merged GitHub PRs, no git history needed. Same F14 gates as the git path.
// Accepted PRs: (1) base == source_epoch.integration_ref, head associates to a task or mission item (mission = landing evidence);
// (2) base associates to a MISSION item and head to a TASK item whose parent is that mission (task PR into a mission branch).
// Starts are never inferred; PR creation is time_to_merge's clock (metrics.md), not first_commit.
import { execFileSync } from 'node:child_process';
import { makeObservation } from './events.mjs';
import { associate } from './associate.mjs';
import { cliError } from './paths.mjs';

const FIELDS = 'number,title,headRefName,baseRefName,createdAt,mergedAt,mergeCommit,url';
/** gh's --limit; a list this long may be truncated, so the CLI must not reconcile (retract) against it. */
export const PR_LIMIT = 1000;
const ghExec = (cmd, args, repo) => execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
/** Not filtered by --base: task PRs merge into mission branches, so base is judged per PR in acceptPr. `exec` is injectable for tests. */
export function readMergedPrs(repo, { exec = ghExec } = {}) {
  let out; try { out = exec('gh', ['pr', 'list', '--state', 'merged', '--limit', String(PR_LIMIT), '--json', FIELDS], repo); } catch (e) { throw cliError('USAGE', `gh pr list failed (${String(e.message).split('\n')[0]}); use --from-json <file> offline`); }
  let prs; try { prs = JSON.parse(out); } catch { throw cliError('USAGE', 'gh pr list did not return JSON'); }
  if (!Array.isArray(prs)) throw cliError('USAGE', 'PR list must be a JSON array');
  return prs;
}

/** `{item, landing}` | `{stacked: {head, base}}` | `{note}`. A PR whose head is a mission and whose base is ANOTHER mission's branch is a stacked
 * mission merge (resolved to a landing in derivePrObservations, which sees the whole PR set). */
export function acceptPr(run, p) {
  const integ = run.source_epoch?.integration_ref;
  const label = `PR #${p.number} (${p.headRefName} -> ${p.baseRefName})`;
  const h = associate(run, { head: p.headRefName, title: p.title });
  if (p.baseRefName === integ) return h.items.length === 1 ? { item: h.items[0], landing: h.items[0].level === 'mission', note: null } : { item: null, note: `${label}: ${h.note ?? 'no association'}; skipped` };
  const b = associate(run, { head: p.baseRefName, levels: ['mission'] });
  if (b.items.length !== 1) return { item: null, note: `${label}: base is neither ${integ} nor a plan mission branch; skipped` };
  const t = associate(run, { head: p.headRefName, title: p.title, levels: ['task'] });
  if (t.items.length === 1) return t.items[0].parent_item_id === b.items[0].item_id ? { item: t.items[0], landing: false, note: null } : { item: null, note: `${label}: task ${t.items[0].ref} is not a child of mission ${b.items[0].ref}; skipped` };
  const m = associate(run, { head: p.headRefName, title: p.title, levels: ['mission'] });
  if (m.items.length === 1 && m.items[0].item_id !== b.items[0].item_id) return { item: null, stacked: { head: m.items[0], base: b.items[0] }, note: null };
  return { item: null, note: `${label}: ${t.note ?? m.note ?? 'head does not associate to a task or another mission'}; skipped` };
}

export function derivePrObservations({ run, prs, since = null, cutoff = null, now = Date.now() }) {
  const notes = [];
  const from = run.source_epoch?.from ? new Date(run.source_epoch.from).toISOString() : null, until = run.source_epoch?.until ? new Date(run.source_epoch.until).toISOString() : null;
  const cut = cutoff ? new Date(cutoff).toISOString() : null, sinceIso = since ? new Date(since).toISOString() : null;
  const ok = (at) => (!from || at >= from) && (!until || at < until) && (!cut || at < cut);
  const afterSince = (at) => !sinceIso || at >= sinceIso;
  const merged = prs.filter((p) => p && p.mergedAt && !Number.isNaN(Date.parse(p.mergedAt))).map((p) => ({ ...p, at: new Date(p.mergedAt).toISOString() })).sort((a, b) => a.at.localeCompare(b.at) || a.number - b.number);
  let skippedOutsideEpoch = 0;
  const eligible = merged.filter((p) => { if (ok(p.at)) return true; skippedOutsideEpoch++; return false; });
  const cls = eligible.map((p) => ({ p, a: acceptPr(run, p) }));
  const mk = (p, item, at, sha, extra) => makeObservation({ user: null, host: 'git', plan: run.run, item_id: item.item_id, ref: item.ref, level: item.level, event: 'done', at, transition_id: `${item.item_id}/done/episode-1`, source: 'git', source_record_id: `pr:${p.number}`, basis: 'observed', raw: p.title ?? null,
    meta: { pr: p.number, git_sha: sha, version: run.version, head_ref: p.headRefName, base_ref: p.baseRefName, ...extra } }, { now });

  // Stacked missions: PRs that carry a mission's branch onward, keyed by that (head) mission. Main-bound ones have no `stacked`.
  const onward = new Map();
  for (const c of cls) { const head = c.a.stacked ? c.a.stacked.head : c.a.item?.level === 'mission' && c.p.baseRefName === run.source_epoch?.integration_ref ? c.a.item : null; if (head) onward.set(head.item_id, [...(onward.get(head.item_id) ?? []), c]); }
  // Lands at the first onward PR merged AFTER this one (a PR merged into a branch that had already moved on never rode along), followed
  // transitively to a PR into integration_ref. Landing time = max along the chain. `seen` is a cycle guard.
  const landing = (c, seen = new Set()) => {
    const { p, a } = c, B = a.stacked.base, label = `PR #${p.number} (${a.stacked.head.ref} -> ${B.ref})`;
    if (seen.has(p.number)) return { note: `${label}: stacked-mission cycle; no landing` };
    seen.add(p.number);
    const all = onward.get(B.item_id) ?? [], q = all.find((x) => x.p.at > p.at && x.p.number !== p.number);
    if (!q) return { note: all.some((x) => x.p.number !== p.number) ? `${label}: merged after ${B.ref} had already moved on (PR #${all.find((x) => x.p.number !== p.number).p.number}); did not land via that chain` : `${label}: base mission ${B.ref} has no merged PR onward; chain never reaches ${run.source_epoch?.integration_ref}` };
    if (!q.a.stacked) return { at: q.p.at > p.at ? q.p.at : p.at, pr: q.p };
    const r = landing(q, seen); return r.note ? { note: `${label}: ${r.note.replace(/^PR #\d+ \([^)]*\): /, '')}` } : { at: r.at > p.at ? r.at : p.at, pr: r.pr };
  };

  const cand = [];
  for (const c of cls) {
    if (c.a.stacked) {
      const r = landing(c); if (r.note) { notes.push(r.note); continue; }
      if (!ok(r.at)) { skippedOutsideEpoch++; continue; }
      cand.push({ p: c.p, item: c.a.stacked.head, at: r.at, sha: r.pr.mergeCommit?.oid ?? null, extra: { stacked_into: c.a.stacked.base.ref, landing_pr: r.pr.number, landing: true } });
    } else if (c.a.item) cand.push({ p: c.p, item: c.a.item, at: c.p.at, sha: c.p.mergeCommit?.oid ?? null, extra: { landing: c.a.landing } });
    else notes.push(c.a.note);
  }
  cand.sort((x, y) => x.at.localeCompare(y.at) || x.p.number - y.p.number);
  const records = [], done = new Set();
  for (const x of cand) {
    if (done.has(x.item.item_id)) { notes.push(`later merge PR #${x.p.number} for ${x.item.ref} needs explicit reopen evidence (M2); skipped`); continue; }
    done.add(x.item.item_id);
    if (!afterSince(x.at)) { notes.push(`first completion PR #${x.p.number} for ${x.item.ref} is before --since ${sinceIso}; no done record emitted this run`); continue; }
    records.push(mk(x.p, x.item, x.at, x.sha, x.extra));
  }
  return { records, notes, skippedOutsideEpoch };
}
