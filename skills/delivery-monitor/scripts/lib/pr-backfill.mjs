// STDLIB ONLY. PR-mode backfill (spec §6.7): `done` from merged GitHub PRs, no git history needed. Same F14 gates as the git path.
// Accepted PRs: (1) base == source_epoch.integration_ref, head associates to a task or mission item (mission = landing evidence);
// (2) base associates to a MISSION item and head to a TASK item whose parent is that mission (task PR into a mission branch).
// Starts are never inferred; PR creation is time_to_merge's clock (metrics.md), not first_commit.
import { execFileSync } from 'node:child_process';
import { makeObservation } from './events.mjs';
import { associate } from './associate.mjs';
import { cliError } from './paths.mjs';

const FIELDS = 'number,title,headRefName,baseRefName,createdAt,mergedAt,mergeCommit,url';
const ghExec = (cmd, args, repo) => execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
/** Not filtered by --base: task PRs merge into mission branches, so base is judged per PR in acceptPr. `exec` is injectable for tests. */
export function readMergedPrs(repo, { exec = ghExec } = {}) {
  let out; try { out = exec('gh', ['pr', 'list', '--state', 'merged', '--limit', '1000', '--json', FIELDS], repo); } catch (e) { throw cliError('USAGE', `gh pr list failed (${String(e.message).split('\n')[0]}); use --from-json <file> offline`); }
  let prs; try { prs = JSON.parse(out); } catch { throw cliError('USAGE', 'gh pr list did not return JSON'); }
  if (!Array.isArray(prs)) throw cliError('USAGE', 'PR list must be a JSON array');
  return prs;
}

export function acceptPr(run, p) {
  const integ = run.source_epoch?.integration_ref;
  const label = `PR #${p.number} (${p.headRefName} -> ${p.baseRefName})`;
  const h = associate(run, { head: p.headRefName, title: p.title });
  if (p.baseRefName === integ) return h.items.length === 1 ? { item: h.items[0], landing: h.items[0].level === 'mission', note: null } : { item: null, note: `${label}: ${h.note ?? 'no association'}; skipped` };
  const b = associate(run, { head: p.baseRefName, levels: ['mission'] });
  if (b.items.length !== 1) return { item: null, note: `${label}: base is neither ${integ} nor a plan mission branch; skipped` };
  const t = associate(run, { head: p.headRefName, title: p.title, levels: ['task'] });
  if (t.items.length !== 1) return { item: null, note: `${label}: ${t.note ?? 'head does not associate to a task'}; skipped` };
  if (t.items[0].parent_item_id !== b.items[0].item_id) return { item: null, note: `${label}: task ${t.items[0].ref} is not a child of mission ${b.items[0].ref}; skipped` };
  return { item: t.items[0], landing: false, note: null };
}

export function derivePrObservations({ run, prs, since = null, cutoff = null, now = Date.now() }) {
  const notes = [];
  const from = run.source_epoch?.from ? new Date(run.source_epoch.from).toISOString() : null, until = run.source_epoch?.until ? new Date(run.source_epoch.until).toISOString() : null;
  const cut = cutoff ? new Date(cutoff).toISOString() : null, sinceIso = since ? new Date(since).toISOString() : null;
  let skippedOutsideEpoch = 0;
  const inEpoch = (at) => { const ok = (!from || at >= from) && (!until || at < until) && (!cut || at < cut); if (!ok) skippedOutsideEpoch++; return ok; };
  const afterSince = (at) => !sinceIso || at >= sinceIso;
  const merged = prs.filter((p) => p && p.mergedAt && !Number.isNaN(Date.parse(p.mergedAt))).map((p) => ({ ...p, at: new Date(p.mergedAt).toISOString() })).sort((a, b) => a.at.localeCompare(b.at) || a.number - b.number);
  const records = [], done = new Set();
  for (const p of merged) {
    if (!inEpoch(p.at)) continue;
    const a = acceptPr(run, p);
    if (!a.item) { notes.push(a.note); continue; }
    if (done.has(a.item.item_id)) { notes.push(`later merge PR #${p.number} for ${a.item.ref} needs explicit reopen evidence (M2); skipped`); continue; }
    done.add(a.item.item_id);
    if (!afterSince(p.at)) { notes.push(`first completion PR #${p.number} for ${a.item.ref} is before --since ${sinceIso}; no done record emitted this run`); continue; }
    const sha = p.mergeCommit?.oid ?? null;
    records.push(makeObservation({ user: null, host: 'git', plan: run.run, item_id: a.item.item_id, ref: a.item.ref, level: a.item.level, event: 'done', at: p.at, transition_id: `${a.item.item_id}/done/episode-1`, source: 'git', source_record_id: `pr:${p.number}`, basis: 'observed', raw: p.title ?? null,
      meta: { pr: p.number, git_sha: sha, version: run.version, head_ref: p.headRefName, base_ref: p.baseRefName, landing: a.landing } }, { now }));
  }
  return { records, notes, skippedOutsideEpoch };
}
