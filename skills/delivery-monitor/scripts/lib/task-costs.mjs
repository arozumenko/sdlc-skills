// STDLIB ONLY. What each task cost, from every dispatch attributed to it, each counted once at current prices. Calibration reads
// this with no end; `report` reads it bounded by its effective end (dispatches started before it, at their current lifetime cost).
//
// A dispatch is a `spend` key. Its owners are the tasks it belongs to, a recovered key's through PR 2's attribution, a hooked key's
// through its active allocations. Each owner gets an equal share of the key's `spend` cost. The completeness gaps that depend on
// cost (not ended, unpriced, first dispatch, crossing, unstable attribution, no cost) are recomputed from all of a task's keys.
import { attributeSpend, loadRunsChecked, rejectedQualifiers, runsInScope } from './attribution.mjs';
import { costOf, loadPricesChecked } from './cost.mjs';
import { readDispatches, reduce } from './dispatches.mjs';
import { resolveObservations } from './events.mjs';
import { cliError, isInputError } from './paths.mjs';
import { spendReport } from './spend.mjs';
import { carriesCrossing, costTimeline, markCostGap } from './timeline.mjs';

export const taskKey = (run, itemId) => `${run}\u0000${itemId}`;
const lower = (s) => String(s).toLowerCase();
const LEDGER_KEY = /^claude:[^:]+:[^:]+$/;
const OWNER_EVIDENCE = new Set(['text', 'text+branch', 'branch-resolves-text']);
// The gaps taskOutcome recomputes; the others in a timeline's `cost_gaps` (dispatch-not-ended, crossed, crossing-unreadable) are kept.
const REPLACED = new Set(['unpriced-model', 'first-dispatch-review-or-fix', 'no-cost-recorded']);
const UNSTARTED = new Set(['review', 'fix']);
// Same test as the timeline's: a hook end with no valid cost or split recorded.
const endHasNoCost = (ag) => !(ag && Number.isFinite(ag.cost_usd) && ag.cost_usd >= 0 && Number.isInteger(ag.split) && ag.split >= 1);

/** Per-model dollars of a usage object at current prices, scaled so they sum exactly to `usd` (empty when nothing is priced).
 * Each model is priced on a million times its tokens, so `costOf`'s micro-dollar rounding cannot erase a tiny share. */
const MEGA = (u) => Object.fromEntries(Object.entries(u ?? {}).map(([k, v]) => [k, typeof v === 'number' ? v * 1e6 : v]));
function vectorOf(usage, usd, prices) {
  const parts = Object.entries(usage ?? {}).map(([m, u]) => [m, costOf({ [m]: MEGA(u) }, prices).cost_usd]).filter(([, c]) => c > 0);
  const sum = parts.reduce((n, [, c]) => n + c, 0);
  return sum > 0 ? Object.fromEntries(parts.map(([m, c]) => [m, c * usd / sum])) : {};
}

/** `enriched` is for tests: a PR 2 enriched spend report to use instead of computing one. Throws PRICES-INVALID or ATTRIBUTION-UNAVAILABLE.
 * With `end` (the report's), a key counts only when its start is known and before `end`; any other key is left out before owners,
 * shares, marks and `noCost`. With no `end` (calibration) every key counts. */
export function taskCosts(repo, { resolved = resolveObservations(repo), enriched = null, end = null } = {}) {
  const loaded = loadPricesChecked(repo);
  if (loaded.problem) { const e = cliError('PRICES-INVALID', `${loaded.problem}; dispatches priced while it was broken are recorded as unpriced and left out`); e.problem = loaded.problem; throw e; }
  const unavailable = (reason) => { const e = cliError('ATTRIBUTION-UNAVAILABLE', reason); e.reason = reason; return e; };
  // A failure to read what attribution needs (dispatch store, ledger, run files) is one reason; any other exception is a
  // programming error and propagates (INTERNAL).
  let doc, runs, stored;
  try { doc = enriched ?? attributeSpend(repo, spendReport(repo)); ({ runs } = loadRunsChecked(repo)); stored = reduce(readDispatches(repo)); }
  catch (e) { if (e.code === 'PRICES-INVALID' || !isInputError(e)) throw e; throw unavailable(String(e?.message ?? e).split('\n')[0]); }
  if (doc.attribution.unavailable) throw unavailable(doc.attribution.unavailable);
  const prices = loaded.prices, endT = end == null ? null : Date.parse(end);
  const spendKeys = new Set(doc.keys.map((k) => k.dispatch_key));
  const counted = endT == null ? doc.keys : doc.keys.filter((k) => k.started_at && Date.parse(k.started_at) < endT), admitted = new Set(counted.map((k) => k.dispatch_key));
  // Bounded: a hook end counts toward `noCost` when its key is admitted, or, for a key `spend` does not list (tombstoned), when
  // the end itself was observed before `end`.
  const endCounts = (o) => endT == null || (spendKeys.has(o.source_record_id) ? admitted.has(o.source_record_id) : Date.parse(o.at) < endT);
  const byRun = new Map(runs.map((r) => [r.run, { items: new Map(r.items.map((i) => [i.item_id, i])), renamed: r.supersedes?.item_map ?? {} }]));
  // The canonical task of an item id: renamed first, and only a task the run still knows can own.
  const canon = (plan, id) => {
    const r = byRun.get(plan), to = r && typeof id === 'string' && Object.hasOwn(r.renamed, id) ? r.renamed[id] : id, it = r?.items.get(to);
    return it?.level === 'task' ? { plan, item_id: to, ref: it.ref } : null;
  };
  const allocs = new Map(), noCost = new Map();
  for (const o of resolved.active) {
    if (o.event !== 'dispatch_ended' || !LEDGER_KEY.test(o.source_record_id)) continue;
    if (o.source === 'hook') allocs.set(o.source_record_id, [...(allocs.get(o.source_record_id) ?? []), o]);
    // The timeline's own `no-cost-recorded`, per task: which dispatches' hook ends recorded no valid cost.
    if (o.item_id != null && endHasNoCost(o.meta?.agent) && endCounts(o)) {
      const r = byRun.get(o.plan), tk = taskKey(o.plan, r && Object.hasOwn(r.renamed, o.item_id) ? r.renamed[o.item_id] : o.item_id);
      noCost.set(tk, new Set([...(noCost.get(tk) ?? []), o.source_record_id]));
    }
  }
  const rejected = rejectedQualifiers(runs);
  const tasks = new Map(), marks = new Map(), keys = [];
  const mark = (tk, gap) => { if (!marks.has(tk)) marks.set(tk, new Set()); marks.get(tk).add(gap); };
  let ownerless = 0;
  for (const k of counted) {
    const ledgerKey = k.class !== 'not-in-ledger', d = k.attribution, s = stored.get(k.dispatch_key), owners = new Map();
    if (ledgerKey) { for (const a of allocs.get(k.dispatch_key) ?? []) { const c = a.item_id != null && canon(a.plan, a.item_id); if (c) owners.set(taskKey(c.plan, c.item_id), c); } }
    else if (d.level === 'task' && OWNER_EVIDENCE.has(d.evidence)) { const c = canon(d.plan, d.item_id); if (c) owners.set(taskKey(c.plan, c.item_id), c); }
    // The side `spend` took its cost from: the store snapshot when it is at least the ledger total, else the highest-priced allocation.
    const sc = s ? costOf(s.usage, prices) : null;
    let usage = null;
    if (sc && sc.cost_usd >= k.usd) usage = s.usage;
    else usage = (allocs.get(k.dispatch_key) ?? []).map((a) => ({ id: a.observation_id, usage: a.meta?.agent?.usage })).filter((x) => x.usage && typeof x.usage === 'object')
      .map((x) => ({ ...x, total: costOf(x.usage, prices).cost_usd })).sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : 1))[0]?.usage ?? null;
    const vector = vectorOf(usage, k.usd, prices), n = owners.size;
    keys.push({ dispatch_key: k.dispatch_key, usd: k.usd, owners: [...owners.keys()], assigned: n ? k.usd : 0, vector });
    if (!n) { ownerless += k.usd; continue; }
    const info = { dispatch_key: k.dispatch_key, ledger: ledgerKey, unpriced: k.unpriced, started_at: k.started_at, stage: s?.stage ?? null };
    for (const [tk] of owners) {
      if (!tasks.has(tk)) tasks.set(tk, { cost_usd: 0, cost_by_model: {}, keys: [] });
      const t = tasks.get(tk);
      t.cost_usd += k.usd / n; t.keys.push(info);
      for (const [m, c] of Object.entries(vector)) t.cost_by_model[m] = (t.cost_by_model[m] ?? 0) + c / n;
    }
    const markOwners = (gap) => { for (const tk of owners.keys()) mark(tk, gap); };
    if (!ledgerKey) {
      if (s && s.complete === false) markOwners('dispatch-not-ended');
      if (d.flags?.includes('text-incomplete')) markOwners('text-incomplete');
    }
    if (!s || !k.started_at) continue;
    const scope = runsInScope(runs, k.started_at);
    if (!ledgerKey) {
      // The text could have named something else: a cancelled task or mission, or a campaign prefix that is not a qualifier.
      const cancelled = new Set(scope.flatMap((r) => r.items.filter((i) => i.cancelled && ['task', 'mission'].includes(i.level)).map((i) => lower(i.ref))));
      if ([...s.refs.desc, ...s.refs.msg].map(lower).some((t) => cancelled.has(t) || rejected.has(t))) markOwners('attribution-unstable');
    }
    // A follow-up that names a task other than the key's own owners: the agent was sent that work too. A token equal to an owner's
    // own ref is read as that owner, as the hook reads it: task refs repeat across runs, and reading `T1` as every other run's T1
    // would leave out most tasks whose follow-ups only repeat their own ref (measured on two real ledgers).
    const ownRefs = new Set([...owners.values()].map((c) => lower(c.ref)));
    for (const token of s.follow_ups.flatMap((f) => f.refs).map(lower)) {
      if (ownRefs.has(token)) continue;
      for (const r of scope) for (const i of r.items) {
        if (i.level !== 'task' || i.cancelled || lower(i.ref) !== token) continue;
        const dest = taskKey(r.run, i.item_id);
        if (owners.has(dest)) continue;
        markOwners('crossed-into-another-task'); mark(dest, 'crossed-into-another-task');
      }
    }
  }
  return { tasks, marks, noCost, keys, ownerless_usd: ownerless, end: end == null ? null : new Date(end).toISOString(), admitted: endT == null ? null : admitted, spend_keys: spendKeys, prices_as_of: loaded.asOf ?? null };
}

/** A run's occurrences as calibration reads them. A task renamed by supersedes.item_map keeps the cost recorded under its old id:
 * only work evidence moves with a rename (the re-cut's own `created`/`cancelled` for the old id describe the catalogue change
 * itself, and carried over they would cancel the renamed task); a `reopened` moves as well and counts as a return; the ids in a
 * crossing marker move the same way. `orphanCost`: dispatch cost left under an id the run neither knows nor maps (an older rename
 * the run file no longer carries), so no task total of the run is trusted. A crossing marker is kept even on a dispatch with no
 * item: it says which tasks miss part of their cost. */
const MOVES = new Set(['dispatched', 'dispatch_ended', 'rework_observed', 'review_returned', 'reopened']);
export function mappedOccurrences(run, occurrences) {
  const known = new Set(run.items.map((i) => i.item_id)), renamed = run.supersedes?.item_map ?? {};
  const moved = (id) => (typeof id === 'string' && Object.hasOwn(renamed, id) ? renamed[id] : id);
  const mine = occurrences.filter((o) => o.plan === run.run).map((o) => {
    const r = o.item_id != null && renamed[o.item_id] && MOVES.has(o.event) ? { ...o, item_id: renamed[o.item_id] } : o;
    return carriesCrossing(r) && Array.isArray(r.meta.agent.crossed) ? { ...r, meta: { ...r.meta, agent: { ...r.meta.agent, crossed: r.meta.agent.crossed.map(moved) } } } : r;
  });
  const orphanCost = mine.some((o) => o.event === 'dispatch_ended' && o.item_id != null && !known.has(o.item_id));
  return { occ: mine.filter((o) => known.has(o.item_id) || carriesCrossing(o)), orphanCost };
}

/** The dispatch (`spend` key) a hooked start or end belongs to, from its observation id; null for any other occurrence. */
const dispatchKeyOf = (o) => {
  if (o.source !== 'hook' || (o.event !== 'dispatched' && o.event !== 'dispatch_ended')) return null;
  const p = o.provenance?.find((x) => x.source === 'hook'), key = p ? decodeURIComponent(String(p.observation_id).split(':')[1] ?? '') : null;
  return key && LEDGER_KEY.test(key) ? key : null;
};
/** The report's cost view of one run: item id → {cost_usd, cost_source, cost_gaps}. Its ledger evidence is the run's occurrences
 * mapped as calibration maps them, restricted to admitted dispatches (`tc.admitted`; a dispatch `spend` does not list, such as a
 * start with no end, by its first start, else by the occurrence's own time), and replayed with no end: an admitted dispatch's end
 * or crossing marker recorded after the report's end still counts, as its lifetime cost does. Durations never come from here. */
export function costView(tc, run, occurrences) {
  let occ = occurrences;
  if (tc.admitted) {
    const endT = Date.parse(tc.end), starts = new Map();
    for (const o of occ) { const k = o.event === 'dispatched' && dispatchKeyOf(o); if (k) starts.set(k, Math.min(starts.get(k) ?? Infinity, Date.parse(o.at))); }
    occ = occ.filter((o) => { const k = dispatchKeyOf(o); return !k || tc.admitted.has(k) || (!tc.spend_keys.has(k) && (starts.get(k) ?? Date.parse(o.at)) < endT); });
  }
  const mapped = mappedOccurrences(run, occ), out = new Map();
  for (const it of costTimeline({ occurrences: mapped.occ, plan: run }).values()) {
    if (mapped.orphanCost) markCostGap(it, 'cost-under-unknown-id');
    const c = taskOutcome(tc, run.run, it);
    out.set(it.item_id, { cost_usd: c.cost_usd, cost_source: c.source, cost_gaps: [...c.gaps].sort() });
  }
  return out;
}

/** One timeline item's cost and why it may not be trusted. */
export function taskOutcome(tc, run, item) {
  const tk = taskKey(run, item.item_id), t = tc.tasks.get(tk), own = t?.keys ?? [], hookNoCost = tc.noCost.get(tk) ?? new Set();
  const gaps = new Set([...item.cost_gaps.filter((g) => !REPLACED.has(g)), ...(tc.marks.get(tk) ?? [])]);
  // A hook end with no recorded cost stays a gap unless its dispatch is an owning key that `spend` priced.
  for (const key of hookNoCost) { const k = own.find((x) => x.dispatch_key === key); if (!k || k.unpriced) gaps.add('no-cost-recorded'); }
  for (const k of own) if (k.unpriced && !hookNoCost.has(k.dispatch_key)) gaps.add('unpriced-model');
  if (!t) gaps.add('no-cost-recorded'); else if (!(t.cost_usd > 0)) gaps.add('zero-cost');
  // The earliest dispatch over both kinds; the ledger's wins a tie.
  let first = item.hook_spans.reduce((a, sp) => (a == null || Date.parse(sp.from) < Date.parse(a.from) ? sp : a), null);
  for (const k of own) if (!k.ledger && k.started_at && (first == null || Date.parse(k.started_at) < Date.parse(first.from))) first = { from: k.started_at, stage: k.stage };
  if (first && UNSTARTED.has(first.stage)) gaps.add('first-dispatch-review-or-fix');
  const kinds = new Set(own.map((k) => (k.ledger ? 'ledger' : 'recovered')));
  const models = Object.entries(t?.cost_by_model ?? {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { cost_usd: t?.cost_usd ?? null, model: models[0]?.[0] ?? null, source: kinds.size > 1 ? 'both' : [...kinds][0] ?? null, gaps };
}
