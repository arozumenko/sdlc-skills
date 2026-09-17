// STDLIB ONLY. Occurrence selection (spec D6, with ledger-conflict carry-over) and per-item timelines with rollups (spec §5, §6.9; M1 subset).
import { SOURCE_RANK, factKey } from './events.mjs';
import { estimateStatus, mergeCatalogue } from './plan.mjs';

const START_STAGES = new Set([undefined, null, 'build']);
const TERMINAL = new Set(['done', 'cancelled']);
const DEFERRED = new Set(['blocked', 'unblocked', 'review_requested', 'review_returned', 'review_approved', 'review_history', 'scope_declared', 'gate_observed', 'outcome_observed']);
const key = (o) => JSON.stringify([o.plan, o.item_id ?? '', o.transition_id, o.basis]);

/** F8: `ledgerConflicts` is `resolveObservations().conflicts[]` — one entry per still-disputed
 * observation_id, each carrying the *union* of its conflicting variants (one per disagreeing
 * record), not a single occurrence key. A downstream reader that only inspected the first variant
 * would quarantine one disputed occurrence and silently let a lower-ranked record win the other —
 * which one depended on file/arrival order. We flatten every variant's own
 * (plan, item_id, transition_id, basis) key here, at its own source rank, so every occurrence any
 * variant disputes is blocked, regardless of position within `variants[]` or entry order. */
export function selectOccurrences(observations, ledgerConflicts = []) {
  const groups = new Map();
  for (const o of observations) { if (o.status !== 'active') continue; const k = key(o); (groups.get(k) ?? groups.set(k, []).get(k)).push(o); }

  const conflictRank = new Map(); // occurrence key -> best (lowest) SOURCE_RANK among all variants disputing it
  const conflictIds = new Map(); // occurrence key -> [observation_id...] whose variants disputed it
  for (const c of ledgerConflicts) {
    for (const v of c.variants ?? []) {
      const k = key(v);
      const r = SOURCE_RANK[v.source] ?? 99;
      conflictRank.set(k, Math.min(conflictRank.get(k) ?? 99, r));
      const ids = conflictIds.get(k) ?? []; ids.push(c.observation_id); conflictIds.set(k, ids);
    }
  }

  const occurrences = [], conflicts = [];
  for (const [k, recs] of groups) {
    const best = Math.min(...recs.map((r) => SOURCE_RANK[r.source] ?? 99));
    const f = recs[0];
    if ((conflictRank.get(k) ?? 99) <= best) {
      conflicts.push({ item_id: f.item_id, transition_id: f.transition_id, basis: f.basis, reason: 'ledger-conflict', sources: [...new Set([...recs.map((r) => r.observation_id), ...(conflictIds.get(k) ?? [])])] });
      continue;
    }
    const top = recs.filter((r) => (SOURCE_RANK[r.source] ?? 99) === best);
    if (new Set(top.map(factKey)).size > 1) { conflicts.push({ item_id: f.item_id, transition_id: f.transition_id, basis: f.basis, reason: 'equal-rank-disagreement', sources: top.map((r) => r.observation_id) }); continue; }
    const w = top[0];
    occurrences.push({ item_id: w.item_id, ref: w.ref, level: w.level, plan: w.plan, event: w.event, at: w.at, basis: w.basis, transition_id: w.transition_id, source: w.source, estimate: w.estimate, meta: w.meta ?? {},
      provenance: recs.map((r) => ({ source: r.source, observation_id: r.observation_id, at: r.at, path: r._at?.path ?? null, line: r._at?.line ?? null })) });
  }
  // A disputed key with no surviving local record at all (every candidate for it was itself part of
  // the conflict) still surfaces as its own conflict, once per key regardless of how many variants
  // or ledger entries named it.
  const seenKeys = new Set(groups.keys());
  for (const c of ledgerConflicts) for (const v of c.variants ?? []) {
    const k = key(v);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    conflicts.push({ item_id: v.item_id, transition_id: v.transition_id, basis: v.basis, reason: 'ledger-conflict', sources: [c.observation_id] });
  }

  occurrences.sort((a, b) => a.at.localeCompare(b.at) || a.transition_id.localeCompare(b.transition_id));
  return { occurrences, conflicts, counts: { occurrences: occurrences.length, conflicts: conflicts.length } };
}

export const estimateOriginal = (es) => es.find((e) => e.status === 'accepted')?.estimate ?? null;
export function estimateLatest(es, before) {
  const orig = estimateOriginal(es); if (!orig) return null;
  const ok = es.filter((e) => e.status === 'accepted' && e.estimate.unit === orig.unit && (!before || e.at < before));
  return ok.length ? ok[ok.length - 1].estimate : null;
}

const newItem = (i) => ({ item_id: i.item_id, ref: i.ref, level: i.level, parent_item_id: i.parent_item_id ?? null, class: i.class ?? null, role: i.role ?? null, story: i.story ?? null, sequence: i.sequence ?? null,
  version_added: i.version_added ?? 1, cancelled_in_plan: Boolean(i.cancelled), created_at: null, created_basis: null, created_sha: null, created_source: null, estimates: [], estimate_original: null, estimate_latest: null,
  scope_since: i.scope_since ?? null, membership_since: i.membership_since ?? null, first_completion: null, current_scope: null, started_at: null, start_basis: null, start_source: null, first_commit_at: null,
  first_commit_source: null, done_at: null, done_basis: null, done_sha: null, done_source: null, landing_at: null, cancelled_at: null, state: 'planned', dispatch_count: 0, proxy_dispatches: 0, rework_count: 0,
  deferred_events: 0, reopened: false, fix_spans: [], children: [], child_summary: { done: 0, cancelled: 0, open: 0, unknown: 0, cancelled_scope: 0 }, flags: [], seen: false });

function reduceTimelineSnapshot({ occurrences, plan, end }) {
  const endIso = new Date(end).toISOString();
  const items = new Map(plan.items.map((i) => [i.item_id, newItem(i)]));
  for (const i of items.values()) if (i.parent_item_id && items.has(i.parent_item_id)) items.get(i.parent_item_id).children.push(i.item_id);
  const counts = { unregistered: 0, deferredEvents: 0, deferredEpisodes: 0, invalidChains: 0, parentIncomplete: 0, awaitingLanding: 0, clockSkew: 0 };
  const explicitDone = new Map();
  for (const o of occurrences) {
    if (o.at >= endIso) continue;
    const it = items.get(o.item_id); if (!it) { counts.unregistered++; continue; }
    it.seen = true;
    const terminal = TERMINAL.has(it.state);
    switch (o.event) {
      case 'created': if (!it.created_at) { it.created_at = o.at; it.created_basis = o.basis; it.created_sha = o.meta.git_sha ?? null; it.created_source = o.source; } break;
      case 'estimated': it.estimates.push({ revision: o.meta.estimate_revision ?? it.estimates.length, at: o.at, estimate: o.estimate, status: o.meta.acceptance === 'stale-acceptance' ? 'unaccepted' : estimateStatus(o.estimate) }); break;
      case 'dispatched':
        it.dispatch_count++;
        // F12: only an occurrence with basis 'observed' can start the cycle — scope/gate/receipt
        // proxies (and any other non-observed basis) are activity evidence only; they are counted
        // separately in `proxy_dispatches` and must never upgrade to a measured start.
        if (o.basis !== 'observed') { it.proxy_dispatches++; }
        else if (START_STAGES.has(o.meta.stage) && !it.started_at && !terminal && it.level === 'task') { it.started_at = o.at; it.start_basis = 'observed'; it.start_source = o.source; }
        if (o.source === 'hook' && o.meta.stage === 'fix') it.fix_spans.push({ from: o.at, to: null, agent: o.agentId ?? null });
        if (it.state === 'planned') it.state = 'in_progress';
        break;
      case 'first_commit': if (!it.first_commit_at) { it.first_commit_at = o.at; it.first_commit_source = o.source; } if (it.state === 'planned') it.state = 'in_progress'; break;
      case 'done':
        // Review fix: a non-task `done` only counts as landing evidence when it is itself
        // basis === 'observed' — a scope/gate/receipt-proxy "done" is not a witnessed landing and
        // must not set landing_at or become the explicit completion the rollup below reads.
        if (it.level !== 'task') { if (o.basis === 'observed' && (!it.scope_since || o.at >= it.scope_since) && !explicitDone.has(it.item_id)) { explicitDone.set(it.item_id, o); it.landing_at = o.at; } break; }
        if (it.state === 'cancelled' && !it.reopened) { if (!it.flags.includes('invalid-chain')) { it.flags.push('invalid-chain'); counts.invalidChains++; } break; }
        // F12: `done_basis` reflects the occurrence's own basis (a proxy `done` stays a proxy) —
        // it is never hard-coded to 'observed', so downstream consumers can tell measured
        // completions from proxy evidence instead of every task done being promoted silently.
        if (!it.done_at) { it.done_at = o.at; it.done_basis = o.basis; it.done_sha = o.meta.git_sha ?? null; it.done_source = o.source; } it.state = 'done'; break;
      case 'cancelled':
        if (it.state === 'done' && !it.reopened) { if (!it.flags.includes('invalid-chain')) { it.flags.push('invalid-chain'); counts.invalidChains++; } break; }
        if (!it.cancelled_at) it.cancelled_at = o.at; if (it.state !== 'done') it.state = 'cancelled'; break;
      case 'reopened': if (!it.reopened) { it.reopened = true; it.flags.push('deferred-episode'); counts.deferredEpisodes++; } break;
      // Research-09: the hook (fix dispatch) and `backfill --git` ("address review N" commit) both
      // witness the same rework episode. A git rework whose commit falls inside a hook fix-dispatch
      // span (open or closed) for this item is that episode, not a second one — counted once.
      case 'rework_observed': if (!(o.source === 'git' && it.fix_spans.some((sp) => o.at >= sp.from && (sp.to == null || o.at <= sp.to)))) it.rework_count++; break;
      case 'dispatch_ended': { const sp = it.fix_spans.find((x) => x.to == null && (x.agent == null || x.agent === (o.agentId ?? null))); if (sp) sp.to = o.at; break; }
      default: if (DEFERRED.has(o.event)) { it.deferred_events++; counts.deferredEvents++; }
    }
  }
  for (const it of items.values()) { it.estimates.sort((a, b) => a.revision - b.revision); it.estimate_original = estimateOriginal(it.estimates); }
  for (const level of ['mission', 'campaign']) {
    for (const it of items.values()) {
      if (it.level !== level) continue;
      const all = it.children.map((id) => items.get(id));
      const kids = all.filter((k) => !k.cancelled_in_plan);
      // F11 (part 2): the descendant-start derivation reads from every child, including
      // scope-cancelled ones — a `cancelled_in_plan` child's own `started_at` (set while it was
      // still in scope) must still be able to establish the parent's earliest historical start.
      // Only the "all terminal"/child_summary accounting below is restricted to non-scope-cancelled
      // (`kids`) children.
      const starts = all.map((k) => k.started_at).filter(Boolean).sort();
      it.started_at = starts[0] ?? null; it.start_basis = starts.length ? 'derived-child' : null;
      const s = { done: 0, cancelled: 0, open: 0, unknown: 0, cancelled_scope: all.length - kids.length };
      // F10: a child quarantined as `invalid-chain` is excluded from measurement entirely — its
      // `state` still reflects whichever terminal it reached first, but that terminal is not
      // trustworthy evidence of delivery or cancellation. Count it as open so it can never, by
      // itself, complete or all-cancel its parent.
      for (const k of kids) {
        if (k.flags.includes('invalid-chain')) { s.open++; continue; }
        if (k.state === 'done') s.done++; else if (k.state === 'cancelled') s.cancelled++; else if (k.seen || k.children.some((c) => items.get(c).seen)) s.open++; else s.unknown++;
      }
      it.child_summary = s;
      const allTerminal = kids.length > 0 && s.open === 0 && s.unknown === 0;
      const lastTerminal = kids.map((k) => k.done_at ?? k.cancelled_at).filter(Boolean).sort().pop() ?? null;
      const explicit = explicitDone.get(it.item_id);
      // F11 (part 1) + minor: all-terminal scope with zero *delivered* children is cancelled —
      // landing evidence never turns wholly cancelled throughput. Likewise, a parent whose entire
      // child set is scope-cancelled (`kids.length === 0`) has nothing left it could ever deliver,
      // so an explicit landing over an empty required-scope closes it as cancelled rather than
      // stalling it as PARENT-INCOMPLETE forever. Both checks run before the explicit-landing/done
      // branch below, so an explicit mission/campaign `done` can no longer paper over a child set
      // with nothing delivered.
      if ((allTerminal && s.done === 0) || (kids.length === 0 && explicit)) { it.state = 'cancelled'; it.cancelled_at = lastTerminal ?? explicit?.at ?? null; }
      else if (allTerminal && (explicit || level === 'campaign')) { it.state = 'done'; it.done_at = [explicit?.at, lastTerminal, it.membership_since].filter(Boolean).sort().pop(); it.done_basis = explicit ? explicit.basis : 'derived-child'; it.done_sha = explicit?.meta?.git_sha ?? null; }
      else if (allTerminal) { it.flags.push('awaiting-landing'); it.state = 'in_progress'; counts.awaitingLanding++; }
      else if (explicit) { it.flags.push('PARENT-INCOMPLETE'); it.state = 'in_progress'; it.done_at = null; counts.parentIncomplete++; }
      // Review fix: `kids.some((k) => k.seen)` fired on a bare `created`-only occurrence (`seen` is
      // set the moment ANY occurrence lands, not just a non-planned one) and wrongly promoted a
      // register-only parent to `in_progress`. Promotion now requires real progress — an observed
      // descendant start, or a child that has itself moved past `planned` (in_progress/done/cancelled).
      else if (it.state === 'planned' && (starts.length > 0 || kids.some((k) => k.state !== 'planned'))) it.state = 'in_progress';
      if (s.cancelled > 0 && s.done > 0) it.flags.push('partial-cancelled');
      if (it.state !== 'planned') it.seen = true;
    }
  }
  for (const it of items.values()) { it.estimate_latest = estimateLatest(it.estimates, it.started_at); delete it.seen; }
  return { items, counts };
}

/** Membership is effective-time data; first registration describes historical v1 scope.
 * Later versions apply at their explicit at, including keep-missing behavior. */
function catalogueAt(plan, at) {
  const versions = [...(plan.versions ?? [])].sort((a, b) => a.version - b.version);
  if (!versions.length) return plan.items;
  let rows = [], scopeSince = new Map(), membershipSince = new Map();
  const descendants = (items, parent) => {
    const ids = new Set([parent]);
    for (let pass = 0; pass < items.length; pass++) for (const i of items) if (!i.cancelled && ids.has(i.parent_item_id)) ids.add(i.item_id);
    ids.delete(parent); return ids;
  };
  for (let n = 0; n < versions.length; n++) {
    const v = versions[n]; if (n > 0 && new Date(v.at).toISOString() > at) break;
    const next = mergeCatalogue(rows, v.items, { keepMissing: Boolean(v.keep_missing) });
    if (n > 0) for (const parent of next.filter((i) => i.level !== 'task')) {
      const before = descendants(rows, parent.item_id), after = descendants(next, parent.item_id);
      if ([...after].some((id) => !before.has(id)) || [...before].some((id) => !after.has(id))) membershipSince.set(parent.item_id, new Date(v.at).toISOString());
      if ([...after].some((id) => !before.has(id))) scopeSince.set(parent.item_id, new Date(v.at).toISOString());
    }
    rows = next;
  }
  return rows.map((i) => ({ ...i, scope_since: scopeSince.get(i.item_id) ?? null, membership_since: membershipSince.get(i.item_id) ?? null }));
}

export function buildTimelines({ occurrences, plan, end }) {
  const endIso = new Date(end).toISOString();
  const ordered = [...occurrences].sort((a, b) => a.at.localeCompare(b.at) || a.transition_id.localeCompare(b.transition_id));
  const boundaries = [...new Set([...ordered.map((o) => o.at), ...(plan.versions ?? []).slice(1).map((v) => new Date(v.at).toISOString())])].filter((t) => t < endIso).sort();
  const first = new Map();
  // Pure replay of readable evidence, not an additional ledger or transaction.
  for (const at of boundaries) {
    const cut = new Date(Date.parse(at) + 1).toISOString();
    const snap = reduceTimelineSnapshot({ occurrences: ordered.filter((o) => o.at <= at), plan: { ...plan, items: catalogueAt(plan, at) }, end: cut });
    for (const it of snap.items.values()) if (it.state === 'done' && !first.has(it.item_id)) {
      first.set(it.item_id, { started_at: it.started_at, start_basis: it.start_basis, start_source: it.start_source, done_at: it.done_at, done_basis: it.done_basis, done_sha: it.done_sha, done_source: it.done_source, landing_at: it.landing_at, children: [...it.children] });
    }
  }
  const endpoint = new Date(Date.parse(endIso) - 1).toISOString();
  const result = reduceTimelineSnapshot({ occurrences: ordered, plan: { ...plan, items: catalogueAt(plan, endpoint) }, end: endIso });
  for (const it of result.items.values()) {
    it.current_scope = { state: it.state, started_at: it.started_at, done_at: it.done_at, landing_at: it.landing_at, child_summary: { ...it.child_summary }, pending: it.level !== 'task' && it.state !== 'done' && it.state !== 'cancelled' };
    it.first_completion = first.get(it.item_id) ?? null;
    if (it.first_completion) {
      // Compatibility clocks ALWAYS describe first delivery; state/children describe the endpoint.
      const { children, ...clocks } = it.first_completion; Object.assign(it, clocks);
      if (it.level !== 'task' && it.current_scope.pending) it.flags.push('scope-pending-after-first-completion');
    }
    it.estimate_latest = estimateLatest(it.estimates, it.started_at);
  }
  return result;
}
