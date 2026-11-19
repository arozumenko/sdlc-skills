// STDLIB ONLY. Assemble (read once, hash what was read) + render (spec §6.11). Rounding lives here only.
//
// F18: `loadRun`/`listRuns` (plan.mjs) each call `readFileSync` themselves, and hashing the run file
// again afterwards would re-read bytes that may have changed underneath a last-writer-wins write
// between the two reads. So this module does NOT import loadRun/listRuns — `readAllRunFiles` below
// reads every `plans/*.json` file exactly once, as a Buffer, and both parses and hashes that same
// buffer. `plan.mjs`'s own `saveRun`/`loadRun` shape (plain `JSON.parse(readFileSync(...))`) is
// preserved exactly, so this is behaviourally identical to `loadRun`, just read once.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, resolveObservations } from './events.mjs';
import { git } from './git.mjs';
import { readCalibration, classOf } from './calibrate.mjs';
import { computeMetrics, estimateBands, planCost, plannerSizeBands, toHours, usableCost, validBounds } from './metrics.mjs';
import { cliError, decodeSegment, deliveryDir, nowIso, plansDir, profilePath, resolveOwnerRepo, sha256 } from './paths.mjs';
import { costView, taskCosts } from './task-costs.mjs';
import { buildTimelines, carriesCrossing, markCostGap, selectOccurrences } from './timeline.mjs';

export const SCHEMA = { report: 1, ledger: 2, adapters: { git: 1, hook: 1 } };
// F19: two more honesty labels the round-3 review asked for, alongside the eight from Global
// Constraint 12 — M1 has no mechanism for verifying a hook-reported producer's identity, and no
// history of *who* an item was ever associated with beyond its current state is retained.
export const UNCONDITIONAL_CAVEATS = [
  'acceptance: unauthenticated', 'writes: non-transactional', 'partial-update: possible', 'capture-loss: possible',
  'shared-files: last-writer-wins', 'sync: best-effort', 'concurrency: best-effort', 'hook-transcript-shapes: provisional until SPIKE-1',
  'producer-compatibility: unverified', 'association-history: not retained',
];
const DEPLOY_LABEL = 'merge to the integration branch, not a production deploy';
const TEMPLATE = resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'templates', 'profile.template.json');

export function loadProfile(repo) {
  const tpl = JSON.parse(readFileSync(TEMPLATE, 'utf8')); const p = profilePath(repo);
  if (!existsSync(p)) return { profile: tpl, sha256: null, source: 'template-default' };
  const buf = readFileSync(p);
  try { return { profile: { ...tpl, ...JSON.parse(buf.toString('utf8')) }, sha256: sha256(buf), source: 'file' }; } catch { return { profile: tpl, sha256: sha256(buf), source: 'template-default (profile.json malformed)' }; }
}

/** F18/F20: one buffer read per registered run file — used for both parsing and hashing, and for
 * detecting a malformed run file (invalid JSON, or valid JSON missing the shape this module needs)
 * without ever throwing. `id` is recovered from the filename even when the body fails to parse, so a
 * `--plan` request naming that exact (malformed) run can still be told apart from one naming an id
 * that was never registered at all (both map to NO-PLAN, but `readAllRunFiles` gives the caller the
 * information to count the former under `coverage.malformed_runs`). */
function readAllRunFiles(repo) {
  const dir = plansDir(repo);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const path = join(dir, f); const id = decodeSegment(f.replace(/\.json$/, ''));
    const buf = readFileSync(path);
    let rec = null, malformed = false;
    // Minor (e): a run file whose catalogue has a row with no item_id is unusable to every caller
    // that indexes items by item_id (known-set building, buildTimelines, evidence matching) — treat
    // it the same as any other malformed run file, not a run with a silently-incomplete catalogue.
    try { const parsed = JSON.parse(buf.toString('utf8')); if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items) && parsed.run && parsed.items.every((i) => i && typeof i === 'object' && i.item_id != null)) rec = parsed; else malformed = true; }
    catch { malformed = true; }
    return { id, path, buf, rec, malformed };
  });
}

const DIAG_KINDS = ['unbound-session', 'unknown-role', 'no-transcript', 'incomplete-transcript', 'invalid-roster', 'task-crossing', 'malformed'];
/** F19: hook capture-loss diagnostics — `.agents/telemetry/delivery/diagnostics-*.jsonl`, one JSON
 * object per line, `{at, kind, session, agent_id, detail}`. Never landed as a writer in this task; this
 * is a read-only, best-effort reader — a missing directory/file is zero counts, not an error, and any
 * line that isn't parseable JSON naming a known `kind` is folded into the `malformed` bucket rather
 * than thrown. */
function readDiagnostics(repo) {
  const dir = deliveryDir(repo);
  const counts = Object.fromEntries(DIAG_KINDS.map((k) => [k, 0]));
  if (!existsSync(dir)) return counts;
  for (const f of readdirSync(dir).filter((n) => /^diagnostics-.*\.jsonl$/.test(n)).sort()) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let rec; try { rec = JSON.parse(line); } catch { counts.malformed++; continue; }
      if (!rec || typeof rec !== 'object' || !DIAG_KINDS.includes(rec.kind)) { counts.malformed++; continue; }
      counts[rec.kind]++;
    }
  }
  return counts;
}

const inWin = (t, a, b) => t != null && t >= a && t < b;
/** F18: an item's timeline clocks (created_at/started_at/done_at) are folded values — the occurrence
 * that produced each one is discarded by `buildTimelines`. Recover it here by matching on the
 * (item_id, event, at[, basis]) that uniquely identifies the occurrence that set that clock (the same
 * predicates `timeline.mjs`'s `reduceTimelineSnapshot` used to set it in the first place), and lift its
 * first provenance record's `{path, line, observation_id}`. A derived clock (e.g. a parent's
 * `start_basis === 'derived-child'`, or a done rollup with no explicit landing occurrence) has no
 * single originating occurrence, so it resolves to `null` — that is itself the honest answer, not a bug. */
function evidenceFor(occ, itemId, event, at, basis = null) {
  if (at == null) return null;
  const match = occ.find((o) => o.item_id === itemId && o.event === event && o.at === at && (basis == null || o.basis === basis));
  const p = match?.provenance?.[0];
  return p ? { path: p.path ?? null, line: p.line ?? null, observation_id: p.observation_id ?? null } : null;
}

// F18 fix: for a task, `done_at` IS the occurrence's own `at` (reduceTimelineSnapshot sets
// `it.done_at = o.at` directly), so matching on `done_at` finds the right occurrence. For a
// non-task level with an explicit landing, `timeline.mjs` can bump `done_at` past the landing
// occurrence's own `at` (`it.done_at = [explicit?.at, lastTerminal, ...].sort().pop()` — a later
// child terminal wins) while `landing_at` stays pinned to the explicit occurrence's own `at`. So a
// landed parent must be matched on `landing_at`, not `done_at`, or the lookup silently misses a real
// landing occurrence whenever a child finished after it.
const doneEvidence = (occ, i) => (i.level === 'task' ? evidenceFor(occ, i.item_id, 'done', i.done_at) : (i.landing_at != null ? evidenceFor(occ, i.item_id, 'done', i.landing_at) : null));
const compact = (i, occ, bounds = null) => ({ first_completion: i.first_completion, current_scope: i.current_scope, item_id: i.item_id, parent_item_id: i.parent_item_id ?? null, children: i.children ?? [], ref: i.ref, level: i.level, class: i.class, state: i.state, created_at: i.created_at, started_at: i.started_at, start_basis: i.start_basis, first_commit_at: i.first_commit_at, done_at: i.done_at, done_basis: i.done_basis, landing_at: i.landing_at, cancelled_at: i.cancelled_at, dispatch_count: i.dispatch_count, rework_count: i.rework_count, agent_span_s: i.agent_span_s ?? null, review_wait_s: i.review_wait_s ?? null, blocked_s: i.blocked_s ?? null, flow_efficiency: i.flow_efficiency ?? null, blocked_since: i.blocked_since ?? null, defects: i.defects ?? [], reopened: i.reopened, estimate: i.estimate_original, estimate_status: i.estimates?.length ? (i.estimate_original ? 'accepted' : 'unaccepted') : 'none', flags: i.flags,
  cost_usd: i.cost_usd == null ? null : Number(i.cost_usd.toPrecision(6)), cost_source: i.cost_source ?? null, cost_gaps: [...i.cost_gaps], cost_band: bounds && usableCost(i) ? classOf(i.cost_usd, bounds) : null,
  // F18: evidence locators for the three clocks a compact row carries — never derived from anything
  // but the occurrence that produced the clock (see evidenceFor above).
  evidence: { created: evidenceFor(occ, i.item_id, 'created', i.created_at), started: i.start_basis === 'observed' ? evidenceFor(occ, i.item_id, 'dispatched', i.started_at, 'observed') : null, done: doneEvidence(occ, i) } });

/** An open plan whose every task (or, task-less, every mission) is done or cancelled — nobody closed it (a consumer project, 2026-10-08:
 * finished plans sat open and kept admitting hook dispatches). */
const isFinished = (status, items) => {
  const tasks = items.filter((i) => i.level === 'task'), pool = tasks.length ? tasks : items.filter((i) => i.level === 'mission');
  return status === 'open' && pool.length > 0 && pool.every((i) => i.state === 'done' || i.state === 'cancelled');
};
// An open item: in progress, or still planned but blocked (blocked before its first dispatch — otherwise it would show nowhere).
const isOpen = (i) => i.state === 'in_progress' || (i.state === 'planned' && Boolean(i.blocked_since));
const closeHint = (run) => `every item is done or cancelled but the plan is still open — once it has landed, close it: delivery.mjs plan close ${run}`;
const TASK_COST_POLICY = 'lifetime cost of dispatches started before the effective end; may be revised';
// The two failures that leave the report on the hook's own task costs; any other error propagates.
const COST_FALLBACK = new Set(['ATTRIBUTION-UNAVAILABLE', 'PRICES-INVALID']);
/** `costs: false` (status) skips task costs: items keep the hook-time values and the envelope carries no cost basis. */
export function assemble(repo, { plans = null, since = null, until = null, cutoff = null, now = Date.now(), estimateBase = 'original', filters = {}, costs = true } = {}) {
  repo = resolveOwnerRepo(repo);
  // F20: an unrecognised --level is user input, not a crash — reject it before anything else runs.
  if (filters.level != null && !LEVELS.includes(filters.level)) throw cliError('USAGE', `unknown --level ${filters.level}; expected ${LEVELS.join('|')}`);

  // F18/F19/F20: read every registered run file exactly once. `known` (F19) is built from ALL of
  // them — not only the ones this call selects via `plans` — so an occurrence belonging to a
  // registered-but-not-selected run is never miscounted as `unregistered`. `malformedRuns` is
  // likewise a property of the whole plans/ directory, independent of selection.
  const allRunFiles = readAllRunFiles(repo);
  const malformedRuns = allRunFiles.filter((f) => f.malformed).length;
  const known = new Map(allRunFiles.filter((f) => f.rec).map((f) => [f.rec.run, new Set(f.rec.items.map((i) => i.item_id))]));

  const selected = plans
    ? plans.map((id) => { const f = allRunFiles.find((x) => x.id === id); if (!f || f.malformed || !f.rec) throw cliError('NO-PLAN', `no registered run ${id}`); return f; })
    : allRunFiles.filter((f) => !f.malformed && f.rec);
  if (!selected.length) throw cliError('NO-PLAN', 'no registered plan in this repo');
  const runs = selected.map((f) => f.rec);

  const iso = (v, name) => { if (v == null) return null; if (Number.isNaN(Date.parse(v))) throw cliError('USAGE', `invalid ${name} ${v}`); return new Date(v).toISOString(); };
  const cutoffIso = iso(cutoff, '--cutoff') ?? nowIso(now), untilIso = iso(until, '--until') ?? cutoffIso, end = untilIso < cutoffIso ? untilIso : cutoffIso;
  const sinceIso = iso(since, '--since') ?? iso(runs.map((r) => r.observation_start).filter(Boolean).sort()[0] ?? '1970-01-01T00:00:00Z', 'observation_start');
  if (sinceIso >= end) throw cliError('USAGE', `since ${sinceIso} must precede end ${end}`);

  const { profile, sha256: profileSha, source: profileSource } = loadProfile(repo);
  const res = resolveObservations(repo);
  const { occurrences, conflicts } = selectOccurrences(res.active, res.conflicts);

  const unregistered = occurrences.filter((o) => !known.has(o.plan) || (o.item_id != null && !known.get(o.plan).has(o.item_id))).length;
  if (!occurrences.some((o) => runs.some((r) => r.run === o.plan) && o.at < end)) throw cliError('NO-EVENTS', `no observations before ${end} for ${runs.map((r) => r.run).join(',')}`);

  // F19 (fixed): admitted-but-unattributed dispatches — a hook-captured `dispatched` with no
  // resolvable item_id (`meta.unattributed`). An unattributed dispatch has, by construction, no
  // item_id to belong to any one run's catalogue, so it can't be scoped via `known`/`item_id` the way
  // `unregistered` is — but it must still be scoped to the SELECTED runs (`o.plan` naming one of
  // `runs`) and to the window (`o.at < end`), exactly like every other count in this report. Counting
  // every dispatch in the whole ledger regardless of `--plan`/`--since`/`--cutoff` would make the
  // share answer a question nobody asked.
  const inScope = (o) => runs.some((r) => r.run === o.plan) && o.at < end;
  const dispatches = occurrences.filter((o) => o.event === 'dispatched' && inScope(o));
  const unattributedDispatches = dispatches.filter((o) => o.item_id === null && o.meta?.unattributed === true).length;
  const attributedDispatches = dispatches.length - unattributedDispatches;
  const unattributedShare = attributedDispatches + unattributedDispatches ? Math.round((unattributedDispatches / (attributedDispatches + unattributedDispatches)) * 10000) / 10000 : null;

  // Per-agent context profile from the hook's `dispatch_ended.meta.agent` (one entry per agent — an agent attributed to several
  // items carries the same stats on each): how many agents were resumed or compacted, and the share of their API turns that ran
  // above 500k context. This is what the one-task-per-subagent rule moves; the hook writes it on Claude Code only.
  const agentStats = new Map();
  for (const o of res.active) if (o.event === 'dispatch_ended' && inScope(o) && o.meta?.agent && o.agentId) agentStats.set(o.agentId, o.meta.agent);
  const st = [...agentStats.values()], turns = st.reduce((n, a) => n + (a.turns ?? 0), 0), heavy = st.reduce((n, a) => n + (a.turns_over_500k ?? 0), 0);
  const dispatchAgents = { agents: st.length, resumed: st.filter((a) => a.follow_ups > 0).length, compacted: st.filter((a) => a.compactions > 0).length, max_follow_ups: st.length ? Math.max(...st.map((a) => a.follow_ups ?? 0)) : null, turns, turns_over_500k: heavy, over_500k_share: turns ? Math.round((heavy / turns) * 10000) / 10000 : null };

  // Task cost (spec PR 3b, C1): one projection per report, over all runs (so a key shared across plans keeps its shares under
  // --plan), counting dispatches started before the effective end at their current lifetime cost. Only attribution being
  // unavailable or invalid prices fall back to the hook-time costs the timeline already carries.
  let tc = null, costFallback = null;
  if (costs) {
    try { tc = taskCosts(repo, { resolved: res, end }); }
    catch (e) { if (!COST_FALLBACK.has(e.code)) throw e; costFallback = { code: e.code, reason: e.reason ?? e.problem ?? e.message }; }
  }

  // Effort bands (C2) need C1 costs and valid bounds from the current calibration table; otherwise one reason says why not.
  let bounds = null, bandsOff = null, calPricesAsOf = null, calRead = false;
  if (!tc) bandsOff = costs ? 'fallback' : null;
  else {
    let cal = null;
    try { cal = readCalibration(repo); } catch (e) { if (e.code !== 'CALIBRATION-INVALID') throw e; bandsOff = 'unreadable'; }
    if (!bandsOff && !cal) bandsOff = 'no-calibration';
    else if (cal) { calRead = true; calPricesAsOf = cal.cal.prices_as_of ?? null; const b = cal.cal.class_bounds_usd; if (b == null) bandsOff = 'too-few-samples'; else if (!validBounds(b)) bandsOff = 'invalid-bounds'; else bounds = b; }
  }

  const cov = { deferred_events: 0, deferred_episodes: 0, invalid_chains: 0, parent_incomplete: 0, awaiting_landing: 0, stray_unblocked: 0, orphan_defect_fixes: 0, non_task_blocks: 0 }; let gaps = 0; const docs = [];
  for (const f of selected) {
    const r = f.rec;
    // A crossing marker is kept even on a dispatch with no item: it says which tasks miss part of their cost.
    const occ = occurrences.filter((o) => o.plan === r.run && (known.get(r.run).has(o.item_id) || carriesCrossing(o)));
    const { items, counts } = buildTimelines({ occurrences: occ, plan: r, end });
    // Dispatch cost recorded under an id this run no longer knows (a rename in any earlier version) belongs to some task this
    // replay cannot identify, so no task's cost total is trusted: cost accuracy is withheld for the run (same rule as calibrate).
    if (occurrences.some((o) => o.plan === r.run && o.at < end && o.event === 'dispatch_ended' && o.item_id != null && !known.get(r.run).has(o.item_id))) for (const it of items.values()) markCostGap(it, 'cost-under-unknown-id');
    // C1 replaces the hook's cost values on every item before metrics and rendering; durations, spans and counts stay as built.
    if (tc) {
      const cv = costView(tc, r, occurrences);
      for (const it of items.values()) { const c = cv.get(it.item_id); it.cost_usd = c.cost_usd; it.cost_source = c.cost_source; it.cost_gaps = c.cost_gaps; it.cost_incomplete = c.cost_gaps.length > 0; }
    }
    cov.deferred_events += counts.deferredEvents; cov.deferred_episodes += counts.deferredEpisodes; cov.invalid_chains += counts.invalidChains; cov.parent_incomplete += counts.parentIncomplete; cov.awaiting_landing += counts.awaitingLanding;
    cov.stray_unblocked += counts.strayUnblocked; cov.orphan_defect_fixes += counts.orphanDefectFixes; cov.non_task_blocks += counts.nonTaskBlocks;
    const g = [...items.values()].filter((i) => !i.created_at).length; gaps += g;
    const metrics = computeMetrics({ items, plan: r, since: sinceIso, end, profile, estimateBase, filters });

    // F15: cancelled_share is a single creation-cohort ratio matching `metrics.cohorts.created` —
    // same window, same --level/--class filtering computeMetrics itself applies to `cohorts.created`
    // — never the whole catalogue. Computed here (not in metrics.mjs) from the same timeline items,
    // using the identical filter predicate, so `denominator` is provably `cohorts.created`.
    let filteredAll = [...items.values()];
    if (filters.level) filteredAll = filteredAll.filter((i) => i.level === filters.level);
    if (filters.class) filteredAll = filteredAll.filter((i) => i.class === filters.class);
    const createdCohort = filteredAll.filter((i) => inWin(i.created_at, sinceIso, end));
    const cancelledInCohort = createdCohort.filter((i) => i.state === 'cancelled').length;
    metrics.quality = { cancelled_share: { numerator: cancelledInCohort, denominator: createdCohort.length, ratio: createdCohort.length ? Math.round((cancelledInCohort / createdCohort.length) * 10000) / 10000 : null } };

    if (costs) {
      metrics.estimate_bands = bounds ? estimateBands(metrics.estimate_rows, items, bounds) : null;
      metrics.planner_size_bands = bounds ? plannerSizeBands(items, { since: sinceIso, end, filters, bounds }) : null;
    }
    const cost = costs ? planCost(items, { since: sinceIso, end, filters }) : undefined;
    docs.push({ run: r.run, version: r.version, status: r.status, finished: isFinished(r.status, [...items.values()]), observations: occ.length, registration_gaps: g, ...(cost ? { cost } : {}), metrics, counts, items: [...items.values()].map((i) => compact(i, occ, bounds)) });
  }
  const pending = docs.flatMap((d) => d.items).filter((i) => i.first_completion && i.current_scope?.pending).length;
  const derived = docs.flatMap((d) => d.metrics.caveats.map((c) => `${d.run}: ${c}`));
  if (pending) derived.push(`${pending} parent(s): first delivery retained; current scope pending (see current_scope, WIP and status)`);
  if (res.counts.malformed) derived.push(`${res.counts.malformed} malformed ledger line(s) skipped — capture loss possible`);
  if (res.conflicts.length) derived.push(`${res.conflicts.length} ledger observation(s) in CONFLICT (same revision, different content) — excluded, no fallback`);
  if (conflicts.length) derived.push(`${conflicts.length} occurrence(s) quarantined (equal-rank disagreement or ledger conflict) — no lower-source fallback`);
  if (unregistered) derived.push(`${unregistered} observation(s) for unregistered items — excluded`);
  if (gaps) derived.push(`${gaps} registered item(s) without a created observation (registration-gaps)`);
  if (cov.parent_incomplete) derived.push(`${cov.parent_incomplete} explicit parent completion(s) with unfinished children (PARENT-INCOMPLETE)`);
  if (cov.awaiting_landing) derived.push(`${cov.awaiting_landing} mission(s) with all children terminal but no landing evidence`);
  if (malformedRuns) derived.push(`${malformedRuns} registered run file(s) malformed — skipped, never counted as unregistered`);
  if (cov.stray_unblocked) derived.push(`${cov.stray_unblocked} unblocked event(s) with no open block — ignored`);
  if (cov.non_task_blocks) derived.push(`${cov.non_task_blocks} block record(s) on non-task items — not in time_blocked`);
  if (cov.orphan_defect_fixes) derived.push(`${cov.orphan_defect_fixes} defect_fixed event(s) with no defect_found on the same item — ignored`);
  if (unattributedDispatches) derived.push(`${unattributedDispatches} admitted dispatch(es) unattributed (no item_id) — excluded from item timelines`);
  // Dollar estimates keep the prices of the calibration that filled them; task costs are at current prices. Said whenever both are
  // in use and differ, bands or not (the dollar detail still compares them).
  if (tc && calRead && calPricesAsOf !== (tc.prices_as_of ?? null)) derived.push(`prices: calibration priced as of ${calPricesAsOf ?? 'unknown'}, task costs at current prices as of ${tc.prices_as_of ?? 'unknown'}; estimates keep their recorded dollars`);
  if (costFallback) derived.push(`task cost: hook-time costs, not current prices (${costFallback.code}: ${costFallback.reason}); estimate bands suppressed`);
  const sha = git(repo, ['rev-parse', 'HEAD']);
  const envelope = {
    schema: SCHEMA, generated_at: nowIso(now), cutoff: cutoffIso, window: { since: sinceIso, until: untilIso, effective_end: end, requested: { since, until, cutoff } },
    git: { sha, is_working_tree: sha ? Boolean(git(repo, ['status', '--porcelain'])) : null }, plans: runs.map((r) => r.run),
    sources: { events_files: res.files, plans: selected.map((f) => ({ run: f.rec.run, path: f.path, file_sha256: sha256(f.buf), canonical_sha256: f.rec.canonical_sha256 ?? null })), profile: { path: profilePath(repo), sha256: profileSha, source: profileSource }, tokenomics: 'absent' },
    policy: { weeks: 'UTC ISO', percentile: 'nearest-rank', floors: { median: 5, p85: 7, p90: 10 }, zeroDurationSec: profile.zeroDurationSec, minWholeWeeks: profile.minWholeWeeks, estimate_base: estimateBase, history: 'corrected-effective-time', durations: 'seconds; hours rounded at render', filters,
      // Review fix (§6.10): named labels so a reader never mistakes a plan-tracked clock for a
      // true idea-to-done lead time, or a PR-open-to-merge clock for cycle time — time_to_merge
      // itself is not computed until M2 (PR-mode backfill), but the label travels with the policy
      // now so both metrics carry the same honest caveat wherever they're read.
      // The DORA block reuses task throughput and cycle time for deployment frequency and lead time for changes; a task lands
      // when it merges to the plan's integration branch, which is not a production deploy.
      labels: { lead_time: 'plan-tracked, not idea-to-done', time_to_merge: 'PR open to merge — not lead time, not cycle time', deployment_frequency: DEPLOY_LABEL, lead_time_for_changes: DEPLOY_LABEL } },
    coverage: { malformed_lines: res.counts.malformed, malformed: res.malformed, unknown_version: res.counts.unknownVersion, retries: res.counts.retries, superseded: res.counts.superseded, retracted: res.counts.retracted, ledger_conflicts: res.conflicts.length, occurrence_conflicts: conflicts.length, conflict_list: conflicts, unregistered, registration_gaps: gaps, malformed_runs: malformedRuns, diagnostics: readDiagnostics(repo), unattributed_dispatches: unattributedDispatches, unattributed_share: unattributedShare, dispatch_agents: dispatchAgents, ...cov },
    caveats: [...UNCONDITIONAL_CAVEATS, ...derived], baselines: profile.baselines ?? {},
  };
  if (costs) Object.assign(envelope, { cost_basis: tc ? 'c1' : 'hook', cost_fallback: costFallback, prices_as_of: tc?.prices_as_of ?? null, estimate_bands: { bounds_usd: bounds, suppressed: bandsOff, calibration_prices_as_of: calPricesAsOf } });
  if (costs) envelope.policy.task_cost = tc ? TASK_COST_POLICY : 'hook-time cost recorded at each dispatch end (fallback)';
  return { envelope, plans: docs };
}

const h = (s) => (s == null ? '—' : `${toHours(s)}h`);
const pct = (r) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`);
// `fmt` renders one value: hours for durations, a percentage for a ratio (flow_efficiency).
const statRow = (name, stratum, s, fmt = h) => (s ? `| ${name} | ${stratum} | n=${s.n} | ${s.median == null ? '— (n<5)' : fmt(s.median)} | ${s.p85 == null ? '— (n<7)' : fmt(s.p85)} | ${s.p90 == null ? '— (n<10)' : fmt(s.p90)} | ${fmt(s.min)}–${fmt(s.max)}${s.samples ? ` (${s.samples.map(fmt).join(', ')})` : ''} |` : null);
const RATIO_METRICS = new Set(['flow_efficiency']);
const NO_DEFECTS = 'no defects recorded — change failure rate and time to restore need `event <ref> defect_found`';
/** The `## DORA` lines. Deployment frequency and lead time for changes point at figures computed elsewhere in the report
 * (never recomputed); change failure rate and time to restore come from `metrics.dora`, or one line when no defect exists. */
function doraLines(m, e) {
  const d = m.dora, label = e.policy.labels.deployment_frequency ?? DEPLOY_LABEL, L = [];
  const t = m.throughput.task, all = m.flow.task?.strata?.all;
  L.push(`- deployment frequency: task velocity ${t?.velocity ? `${t.velocity.median} per whole week (n=${t.velocity.whole_weeks} whole weeks)` : `— (${t ? t.weeks.filter((w) => w.whole).length : 0} whole weeks < ${e.policy.minWholeWeeks})`}; weekly throughput under Throughput (${label})`);
  const med = (s) => (s?.median != null ? h(s.median) : s ? '— (n<5)' : '— (not measured)');
  L.push(`- lead time for changes: task cycle_time median ${med(all?.cycle_time)}, commit_to_done median ${med(all?.commit_to_done)} (${e.policy.labels.lead_time_for_changes ?? DEPLOY_LABEL})`);
  if (!d.recorded) { L.push(`- ${NO_DEFECTS}`); return L; }
  const c = d.change_failure_rate;
  L.push(`- change_failure_rate: ${c.denominator ? `${c.numerator}/${c.denominator} (${pct(c.ratio)}) — ${Object.entries(c.by_severity).map(([k, v]) => `${k}=${v}`).join(' ')}` : '— (n=0 completed in window)'} (defects are found later, so recent tasks are undercounted)`);
  const r = d.time_to_restore, s = r.stats;
  L.push(`- time_to_restore (escaped defects found in the window, found → fixed): ${s ? `n=${s.n}, median ${s.median == null ? '— (n<5)' : h(s.median)}${s.p85 != null ? `, P85 ${h(s.p85)}` : ''}${s.p90 != null ? `, P90 ${h(s.p90)}` : ''}, min–max ${h(s.min)}–${h(s.max)}${s.samples ? ` (${s.samples.map(h).join(', ')})` : ''}` : '— (n=0 fixed)'}; open ${r.open}${r.open ? ` (oldest ${h(r.oldest_open_s)} at the window end)` : ''}`);
  const stages = Object.entries(d.defects_by_stage).filter(([, v]) => v.escaped || v.before_landing);
  if (stages.length) L.push('', '| found stage | escaped (after landing) | before landing |', '|---|---|---|', ...stages.map(([k, v]) => `| ${k} | ${v.escaped} | ${v.before_landing} |`), '');
  else L.push('- defects_by_stage: — (none found in the window)');
  if (d.untraced.n) L.push(`- untraced (recorded on a mission, campaign or case, not in change_failure_rate): ${d.untraced.n}`);
  if (d.excluded_defects) L.push(`- excluded: ${d.excluded_defects} defect(s) on tasks with a quarantined or proxy completion — escape not judged`);
  return L;
}
// Minor (b): the "how long has this open item been open, as of the window's effective end" figure
// was duplicated at each open-items call-site — one shared helper.
const ageH = (end, started) => (started ? `${toHours((Date.parse(end) - Date.parse(started)) / 1000)}h` : null);
// Shared by Markdown and HTML flow/estimates excluded-reason lines — one string-builder, four call
// sites (fix round 1, minor 3), so the two renderers can't drift on how a reason tally is spelled.
const excludedStr = (obj) => Object.entries(obj).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');

// html-report brief: self-contained HTML renderer, house style ported from tokenomics'
// team-report.mjs (escHtml/PAGE_CSS/statCell/kpiCard) — no external assets, no <script>, every
// dynamic string escaped. Trimmed to the panels/chip/table chrome this report actually uses; the
// token-composition bar/legend/share-cell classes tokenomics ships are dropped (unused here).
export const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const PAGE_CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--gridline:#e1e0d9;--border:rgba(11,11,11,0.10);--series-1:#2a78d6;--warn:#c53030;--ok:#2f855a}
html[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--text-primary:#fff;--text-secondary:#c3c2b7;--text-muted:#898781;--gridline:#2c2c2a;--border:rgba(255,255,255,0.10);--series-1:#3987e5;--warn:#e06c6c;--ok:#48a06f}
*{box-sizing:border-box}
body{font:14px/1.5 -apple-system,"Segoe UI",sans-serif;color:var(--text-primary);background:var(--page);max-width:1360px;margin:0 auto;padding:1.8rem 1.2rem 3rem}
h1{font-size:1.35rem;margin:0 0 .2rem}
.meta{color:var(--text-muted);font-size:.85rem;margin:0 0 1.1rem}
section{margin-top:1.1rem}
.kpi-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.9rem}
@media(max-width:880px){.kpi-row{grid-template-columns:1fr}}
.kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem 1.15rem 0.9rem;min-width:0;display:flex;flex-direction:column}
.kpi-card .kpi-callout{margin-top:auto}
.kpi-card h3{margin:0 0 .55rem;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem .9rem;margin-top:.7rem;padding-top:.6rem;border-top:1px solid var(--gridline)}
.hero{display:flex;flex-direction:column;min-width:0}
.hero-value{font-size:1.9rem;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.hero-value .stat-sub{font-size:1rem;font-weight:400}
.hero-label{font-size:.8rem;color:var(--text-secondary);margin-top:.15rem}
.stat{display:flex;flex-direction:column;min-width:0}
.stat-label{font-size:.74rem;color:var(--text-secondary)}
.stat-value{font-size:1.02rem;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.3;overflow-wrap:anywhere}
.kpi-callout{margin-top:.65rem;padding:.45rem .6rem;background:var(--page);border:1px solid var(--gridline);border-radius:7px;font-size:.81rem;color:var(--text-secondary)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;overflow-x:auto;min-width:0}
.panel h2{margin:0;font-size:1rem}
.callout-warn{margin-top:.8rem;color:var(--warn);border:1px solid var(--warn);border-radius:7px;padding:.5rem .7rem;font-size:.86rem;background:var(--surface)}
.note{color:var(--text-muted);font-size:.84rem}
table{border-collapse:collapse;width:100%;font-size:.87rem;margin:.4rem 0}
th{text-align:left;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--gridline);padding:.3rem .5rem;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
td{border-bottom:1px solid var(--gridline);padding:.3rem .5rem;font-variant-numeric:tabular-nums}
.chip{font-size:.8rem;border:1px solid var(--gridline);border-radius:8px;padding:.1rem .5rem;margin-right:.4rem;color:var(--text-secondary);display:inline-block}
ul{margin:.3rem 0;padding-left:1.3rem}
li{margin:.15rem 0}
h2 .sub{font-weight:400;font-size:.85rem;margin-left:.5rem}
.stat-sub{color:var(--text-muted);font-weight:400}
.panel-sub{margin:.15rem 0 .75rem;color:var(--text-muted);font-size:.84rem}
.sub{color:var(--text-muted)}
.oc{font-size:.72rem;border:1px solid var(--gridline);border-radius:8px;padding:0 .4rem;margin-left:.35rem;color:var(--text-muted);display:inline-block}
.oc-done{color:var(--ok);border-color:var(--ok)}.oc-cancelled{color:var(--warn);border-color:var(--warn)}
.items{font-size:.87rem;min-width:990px}
.mrow{display:grid;grid-template-columns:minmax(140px,1.1fr) 96px minmax(170px,1.5fr) minmax(110px,.9fr) minmax(160px,1.4fr) 90px 64px 64px minmax(170px,1.2fr);gap:.6rem;align-items:center;padding:.3rem .5rem;border-bottom:1px solid var(--gridline)}
.mrow .c{min-width:0;overflow-wrap:anywhere}
.mrow .c.num,.mrow .c.span,.cell-bar .num{white-space:nowrap}
.mrow .oc{white-space:normal;line-height:1.35}
.mrow.head .c{color:var(--text-muted);font-weight:600;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;line-height:1.2}
.mrow.mission{background:var(--page);font-weight:600;border-top:2px solid var(--gridline)}
.mrow.mission .c.ref,.mrow.task .c.ref{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.84rem}
.mrow.task .c.ref{padding-left:1.4rem}
.mrow .c.span{color:var(--text-secondary);font-size:.82rem}
details.mission>summary{list-style:none;cursor:pointer}
details.mission>summary::-webkit-details-marker{display:none}
details.mission>summary .c.ref::before{content:'▸';display:inline-block;width:1em;color:var(--text-muted);transition:transform .15s}
details.mission[open]>summary .c.ref::before{transform:rotate(90deg)}
.cell-bar{display:flex;align-items:center;gap:.5rem;min-width:160px}
.cell-bar .track{flex:1;background:var(--gridline);border-radius:4px;height:11px}
.cell-bar .bar{background:var(--series-1);height:11px;border-radius:4px}
.cell-bar .num{font-variant-numeric:tabular-nums;font-size:.84rem;white-space:nowrap}
.oc-below{color:var(--text-secondary)}
`;
const statCell = (label, value) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
const kpiCard = (title, cells, callout, hero = null) => `<div class="kpi-card"><h3>${title}</h3>${hero ? `<div class="hero"><span class="hero-value">${hero.value}</span><span class="hero-label">${hero.label}</span></div>` : ''}<div class="kpi-grid">${cells.join('')}</div>${callout ? `<div class="kpi-callout">${callout}</div>` : ''}</div>`;

const estimateStratumRow = (lv, st, x) => `| ${lv} | ${st} | ${x.n} | ${x.eligible} | ${x.work_ratio ? (x.work_ratio.median ?? `— (n<5; ${x.work_ratio.samples.map((v) => Math.round(v * 100) / 100).join(', ')})`) : '—'} | ${x.mdmre ?? '—'} | ${x.pred25 ?? '—'} | ${x.mae_s == null ? '—' : st.startsWith('usd:') ? `$${Math.round(x.mae_s * 100) / 100}` : h(x.mae_s)} | ${x.hit_rate.rate == null ? '—' : `${x.hit_rate.hits}/${x.hit_rate.ranged}`} | ${excludedStr(x.excluded) || '—'} |`;
const usd = (x) => (x == null ? '—' : `$${Math.round(x * 100) / 100}`);
/** What the report's task costs are, in one line. An archived report from before task costs has no basis. */
const costBasis = (e) => (e.cost_basis === 'c1' ? `current prices as of ${e.prices_as_of ?? 'unknown'}; ${e.policy.task_cost}`
  : e.cost_basis === 'hook' ? `hook-time costs recorded at each dispatch end, not current prices (fallback ${e.cost_fallback?.code}: ${e.cost_fallback?.reason})` : '— (archived report without task costs)');
const boundsText = (b) => `E1 ≤ $${b[0]}, E2 ≤ $${b[1]}, E3 ≤ $${b[2]}, E4 above`;
/** A band table (rows × actual band): only the rows and columns that have counts. */
const bandTable = (matrix, corner) => {
  const rows = Object.keys(matrix), cols = [...new Set(rows.flatMap((r) => Object.keys(matrix[r])))].sort();
  return [`| ${corner} | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r} | ${cols.map((c) => matrix[r][c] ?? '—').join(' | ')} |`)];
};
const withBand = (v, band) => (v == null ? '—' : `$${Number(v.toPrecision(6))}${band ? ` ${band}` : ''}`);
/** The `## Cost` section of one plan: basis, plan cost line, estimate bands, planner size × band, dollar detail, per-task costs. */
function costLines(p, e) {
  const m = p.metrics, L = ['## Cost', '', `- basis: ${costBasis(e)}`];
  if (p.cost) L.push(`- plan cost: done in window ${usd(p.cost.done_in_window_usd)} (${p.cost.done_in_window_n} tasks), done without a usable cost ${p.cost.done_without_cost}, all tasks ${usd(p.cost.all_tasks_usd)}`);
  const eb = e.estimate_bands, b = m.estimate_bands;
  if (b) {
    L.push(`- estimate bands: same ${b.same} · one off ${b.one_off} · two or more off ${b.two_or_more_off} — within one band ${b.within_one} of ${b.n} (${boundsText(eb.bounds_usd)})`);
    if (b.n) L.push('', ...bandTable(b.matrix, 'estimated \\ actual'), '');
  } else if (eb?.suppressed) L.push(`- estimate bands: — (suppressed: ${eb.suppressed})`);
  const ps = m.planner_size_bands;
  if (ps) L.push(...(ps.matrix ? [`- planner size × actual band (n=${ps.n}, no verdict):`, '', ...bandTable(ps.matrix, 'planner size \\ actual'), ''] : [`- planner size × actual band: — (${ps.n} tasks, shown from ${ps.min_n})`]));
  // Dollar detail: the dollar strata and rows the Estimates table no longer carries.
  const strata = Object.entries(m.estimates).flatMap(([lv, es]) => Object.entries(es.strata).filter(([st]) => st.startsWith('usd:')).map(([st, x]) => estimateStratumRow(lv, st, x)));
  const rows = m.estimate_rows.filter(isUsdRow);
  if (strata.length || rows.length) {
    L.push('- dollar detail (ratio = actual ÷ estimate midpoint; within dollar range = actual inside the estimate\'s dollar range):', '', '| level | stratum | n | eligible | cost ratio median | MdMRE | PRED(25) | MAE | within dollar range | excluded |', '|---|---|---|---|---|---|---|---|---|---|', ...strata);
    if (rows.length) L.push('', '| ref | level | class | tier | base | range ($) | estimate | actual | ratio | within dollar range | reason |', '|---|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.ref} | ${r.level} | ${r.class ?? '—'} | ${r.tier ?? '—'} | ${r.base} | ${r.estimate ? `[$${r.estimate.low}, $${r.estimate.high}]` : '—'} | ${withBand(r.estimate_rep_usd, r.estimated_band)} | ${r.actual_usd != null ? `${withBand(r.actual_usd, r.actual_band)}${r.reason === 'missing_actual' ? ' (incomplete)' : ''}` : '—'} | ${r.ratio ?? '—'} | ${r.hit == null ? '—' : r.hit ? 'yes' : 'no'} | ${r.reason ?? '—'} |`));
  }
  const tasks = p.items.filter((i) => i.level === 'task').sort((a, z) => a.ref.localeCompare(z.ref, 'en', { numeric: true }));
  if (tasks.length) L.push('', '| ref | state | cost | band | source | gaps |', '|---|---|---|---|---|---|', ...tasks.map((i) => `| ${i.ref} | ${i.state} | ${i.cost_usd == null ? '—' : `$${i.cost_usd}`} | ${i.cost_band ?? '—'} | ${i.cost_source ?? '—'} | ${i.cost_gaps?.length ? i.cost_gaps.join(', ') : '—'} |`));
  return [...L, ''];
}
// A dollar estimate row: `usdAccuracy` gives every one an `actual_usd` key (null when there is no actual); hour rows have none.
const isUsdRow = (r) => 'actual_usd' in r;

export function renderMarkdown(doc) {
  const e = doc.envelope; const L = [];
  L.push('# Delivery monitor', '', `generated ${e.generated_at} · cutoff ${e.cutoff} · window [${e.window.since}, ${e.window.effective_end}) · sha ${e.git.sha ?? '—'}${e.git.is_working_tree ? ' (dirty)' : ''} · plans ${e.plans.join(', ')}${e.policy.filters?.level || e.policy.filters?.class ? ` · filters ${JSON.stringify(e.policy.filters)}` : ''}`, '');
  for (const p of doc.plans) {
    const m = p.metrics;
    L.push(`## Plan ${p.run} v${p.version} (${p.status}) — completed ${m.cohorts.completed}, created ${m.cohorts.created}, excluded items invalid-chain=${m.cohorts.excluded_items.invalid_chain} deferred-episode=${m.cohorts.excluded_items.deferred_episode}`, '');
    L.push('## Flow Time', '', '| metric | stratum | n | median | P85 | P90 | min–max |', '|---|---|---|---|---|---|---|');
    for (const [lv, f] of Object.entries(m.flow)) {
      // F17: every stratum metrics.mjs emitted (all + every class present, plus its own per-stratum
      // `quality`) is rendered — nothing is dropped by only reading a fixed set of class names.
      for (const [st, mm] of Object.entries(f.strata)) {
        for (const [name, s] of Object.entries(mm)) {
          if (name === 'quality') continue;
          // Review fix (§6.10/policy.labels): every lead_time row carries its honesty label inline
          // in Markdown, matching `envelope.policy.labels.lead_time` in the JSON export.
          const label = name === 'lead_time' ? ` (${e.policy.labels.lead_time})` : '';
          const row = statRow(`${lv} ${name}${label}`, st, s, RATIO_METRICS.has(name) ? pct : h); if (row) L.push(row);
        }
        // F17: the stratum's own quality denominator sits immediately next to its speed rows, not
        // collapsed into one level-wide line — `strata.<class>.quality` is where metrics.mjs puts it.
        L.push(`| ${lv} quality | ${st} | quality: reviewed=${mm.quality.reviewed ?? 'unknown'} eligible=${mm.quality.eligible ?? 'unknown'} done=${mm.quality.done} | | | | |`);
      }
      if (!Object.keys(f.strata).length) L.push(`| ${lv} cycle_time | all | — (not measured) | | | | |`);
      const ex = excludedStr(f.excluded); if (ex) L.push(`| ${lv} excluded | | ${ex} | | | | |`);
    }
    if (m.flow.task?.trend) { const t = m.flow.task.trend; L.push(`| task trend (latest half ÷ earlier half, observed cycle_time) | all | n=${t.n} | ${t.ratio == null ? `— (n<${t.floor})` : `${t.ratio} (${t.direction})`} | earlier ${t.earlier?.median == null ? '—' : h(t.earlier.median)} | latest ${t.latest?.median == null ? '—' : h(t.latest.median)} | |`); }
    L.push('', '## Throughput', '');
    for (const [lv, t] of Object.entries(m.throughput)) {
      L.push(`- ${lv} per UTC ISO week: ${t.weeks.map((w) => `${w.key}=${w.count}${!w.covered ? '†' : (!w.whole ? '*' : '')}`).join(' ')} (*partial, †before declared coverage)`);
      // Minor (c): built straight from data (t.velocity/t.weeks + the envelope's own
      // policy.minWholeWeeks) rather than string-replacing metrics.mjs's `t.caveat` message — the
      // rendered text no longer depends on that message's exact wording staying stable.
      L.push(`- ${lv} velocity (median items per whole covered week): ${t.velocity ? `${t.velocity.median} (n=${t.velocity.whole_weeks} whole weeks)` : `— (${t.weeks.filter((w) => w.whole).length} whole weeks < ${e.policy.minWholeWeeks})`}`);
      L.push(`- ${lv} wip at end: ${m.wip[lv]}`);
    }
    if (m.mission_turnaround.pairs.length) L.push(`- mission_turnaround: ${m.mission_turnaround.pairs.map((x) => `${x.from}→${x.to} ${x.gap_s != null ? h(x.gap_s) : `overlap ${h(x.overlap_s)}`}`).join('; ')}`);
    L.push('', '## Quality', '');
    // F15: one figure, scoped to the creation cohort in [since, end) and to the same --level/--class
    // filters as the rest of the report — never the whole catalogue.
    const cs = m.quality.cancelled_share;
    L.push(`- cancelled_share: ${cs.denominator ? `${cs.numerator}/${cs.denominator} (${pct(cs.ratio)})` : '— (n=0 created in window)'}`);
    for (const lv of Object.keys(m.flow)) { const rows = p.items.filter((i) => i.level === lv); L.push(`- ${lv}: rework_proxy_items ${lv === 'task' ? m.rework_proxy_items : '—'}, deferred-episodes ${rows.filter((i) => i.reopened).length}, review rounds unknown (M2)`); }
    // An archive written before the DORA block existed has no `metrics.dora`; it re-renders without the section.
    if (m.dora) L.push('', '## DORA', '', ...doraLines(m, e));
    L.push('', '## Estimates', '', '| level | stratum | n | eligible | work_ratio median | MdMRE | PRED(25) | MAE | hit_rate | excluded |', '|---|---|---|---|---|---|---|---|---|---|');
    // Dollar strata and rows are cost output: they render under `## Cost` (dollar detail), so this table is hours only.
    for (const [lv, es] of Object.entries(m.estimates)) for (const [st, x] of Object.entries(es.strata)) if (!st.startsWith('usd:')) L.push(estimateStratumRow(lv, st, x));
    const hourRows = m.estimate_rows.filter((r) => !isUsdRow(r));
    if (hourRows.length) { L.push('', '| ref | level | class | tier | base | range (h or $) | actual | basis | ratio | hit | reason |', '|---|---|---|---|---|---|---|---|---|---|---|'); for (const r of hourRows) L.push(`| ${r.ref} | ${r.level} | ${r.class ?? '—'} | ${r.tier ?? '—'} | ${r.base} | ${r.estimate ? (r.estimate.unit === 'usd' ? `[$${r.estimate.low}, $${r.estimate.high}]` : `[${r.estimate.low}, ${r.estimate.high}]`) : '—'} | ${r.actual_usd != null ? `$${r.actual_usd}${r.reason === 'missing_actual' ? ' (incomplete)' : ''}` : r.estimate?.unit === 'usd' ? '—' : h(r.actual_s)} | ${r.actual_basis ?? '—'} | ${r.ratio ?? '—'} | ${r.hit == null ? '—' : r.hit ? 'yes' : 'no'} | ${r.reason ?? '—'} |`); }
    for (const sv of m.schedule_variance) L.push(`- schedule_variance ${sv.level} ${sv.ref}: actual ${h(sv.actual_s)} vs [${sv.estimate.low}, ${sv.estimate.high}] → [${toHours(sv.band.vs_high_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_high_s)}h, ${toHours(sv.band.vs_low_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_low_s)}h]; scope added ${sv.scope.added}, removed ${sv.scope.removed}`);
    L.push('', ...costLines(p, e));
    L.push('## Coverage & caveats', '');
    // F17: coverage.sources (already present) plus coverage.done_basis — both read straight off
    // metrics.mjs's per-level coverage object, nothing invented here.
    for (const [lv, c] of Object.entries(m.coverage)) L.push(`- ${lv}: done ${c.done}, observed dispatch ${c.with_dispatched}, first commit ${c.with_first_commit}, created ${c.with_created}; start observed=${c.start_source.observed} derived-child=${c.start_source['derived-child']} none=${c.start_source.none}; done_basis observed=${c.done_basis.observed} derived-child=${c.done_basis['derived-child']} proxy=${c.done_basis.proxy}; sources ${JSON.stringify(c.sources)}`);
    // Block records are optional: say how many done tasks carry one, and never let a missing record read as zero blocked time.
    const ct = m.coverage.task; if (ct && ct.with_blocked != null) L.push(ct.with_blocked ? `- task: blocked records on ${ct.with_blocked} of ${ct.done} done task(s)${ct.blocked_no_start ? `; ${ct.blocked_no_start} without an observed start — time_blocked not measured` : ''}` : '- task: no blocked records — time_blocked not measured (not zero)');
    L.push(`- registration_gaps=${p.registration_gaps}`);
    if (p.finished) L.push(`- ${closeHint(p.run)}`);
    L.push('', '## Open items', '', '| ref | level | state | started | age |', '|---|---|---|---|---|');
    for (const i of p.items.filter(isOpen)) L.push(`| ${i.ref} | ${i.level} | ${i.state}${i.blocked_since ? ` (blocked since ${i.blocked_since})` : ''}${i.flags.length ? ` (${i.flags.join(', ')})` : ''} | ${i.started_at ?? '—'} | ${i.first_completion && i.current_scope?.pending ? '— (pending-scope age unavailable in M1)' : ageH(e.window.effective_end, i.started_at) ?? '— (no observed start)'} |`);
    L.push('');
  }
  L.push('### Envelope', '', `- ledger: unregistered=${e.coverage.unregistered} malformed-lines=${e.coverage.malformed_lines} ledger_conflicts=${e.coverage.ledger_conflicts} occurrence_conflicts=${e.coverage.occurrence_conflicts} retries=${e.coverage.retries} retracted=${e.coverage.retracted} deferred_events=${e.coverage.deferred_events} invalid_chains=${e.coverage.invalid_chains}`);
  for (const c of e.coverage.conflict_list) L.push(`  - conflict ${c.item_id ?? '—'} ${c.transition_id} (${c.reason}): ${c.sources.join(', ')}`);
  for (const mm of e.coverage.malformed) L.push(`  - malformed ${mm.path}:${mm.line} ${mm.reason}`);
  // F19: hook diagnostics (capture-loss visibility) and admitted-but-unattributed dispatches; F20:
  // registered run files that failed to parse.
  L.push(`- plans: malformed_runs=${e.coverage.malformed_runs}`);
  L.push(`- capture: unattributed_dispatches=${e.coverage.unattributed_dispatches} unattributed_share=${e.coverage.unattributed_share == null ? '—' : pct(e.coverage.unattributed_share)}`);
  const da = e.coverage.dispatch_agents;
  L.push(`- agents: n=${da.agents} resumed=${da.resumed} compacted=${da.compacted} max_follow_ups=${da.max_follow_ups ?? '—'} turns=${da.turns} over_500k=${pct(da.over_500k_share)}`);
  L.push(`- diagnostics: ${DIAG_KINDS.map((k) => `${k}=${e.coverage.diagnostics[k]}`).join(' ')}`);
  L.push(`- baselines: ${Object.entries(e.baselines).map(([k, v]) => `${k}=${v ?? 'no baseline'}`).join(', ')}`);
  for (const c of e.caveats) L.push(`- caveat: ${c}`);
  L.push(`- policy: weeks ${e.policy.weeks}, percentiles ${e.policy.percentile} (floors median≥5 P85≥7 P90≥10), estimate base ${e.policy.estimate_base}, ${e.policy.durations}, tokenomics ${e.sources.tokenomics}, sources hashed as read`);
  return `${L.join('\n')}\n`;
}

// The HTML page is the human view: KPI cards, burn-up, per-item rows. The assessor figures (strata,
// coverage, envelope, caveats) are the Markdown/JSON export's job and are not repeated here.
// Human-readable helpers for the page (the assessor tables below keep `h`/toHours for parity with
// Markdown). Durations pick their own unit by magnitude; a null is always '—', never a guess.
const fmtDur = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const a = Math.abs(sec), sign = sec < 0 ? '−' : '';
  if (a < 60) return `${sign}${Math.round(a)} s`;
  if (a < 3600) return `${sign}${Math.round((a / 60) * 10) / 10} min`;
  if (a < 86400) return `${sign}${Math.round((a / 3600) * 10) / 10} h`;
  return `${sign}${Math.round((a / 86400) * 10) / 10} d`;
};
// Unit-aware: an hours range renders as durations, a calibrated `usd` range as dollars.
const fmtRangeH = (est) => (!est ? '—' : est.unit === 'usd' ? `$${est.low}–$${est.high}` : `${fmtDur(est.low * 3600)}–${fmtDur(est.high * 3600)}`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtTs = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? escHtml(iso) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`; };
const elapsedS = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null);
const fmtShort = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? escHtml(iso) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
// "12:52 → 12:53 UTC" when both clocks fall on the same UTC day, full stamps otherwise.
const fmtSpan = (a, b) => { if (!a || !b) return null; const da = new Date(a), db = new Date(b); if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null; return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10) ? `${da.getUTCDate()} ${MONTHS[da.getUTCMonth()]} ${hhmm(da)} → ${hhmm(db)}` : `${fmtShort(a)} → ${fmtShort(b)}`; };
const pctOf = (ratio) => (ratio == null ? '—' : `${Math.round(ratio * 100)}%`);
const projectOf = (e) => { const f = e.sources?.events_files?.[0]?.path ?? e.sources?.plan_files?.[0]?.path ?? ''; const m = /([^/]+)\/\.agents\//.exec(f); return m ? m[1] : null; };
const needs = (n, floor) => `needs ≥${floor} <span class="stat-sub">(have ${n})</span>`;
const spreadPct = (s) => `median ${s.median == null ? `— (needs ≥5, have ${s.n})` : pctOf(s.median)} · min ${pctOf(s.min)} · max ${pctOf(s.max)}${s.samples ? ` · samples ${s.samples.map(pctOf).join(', ')}` : ''}`;
const spreadLine = (s) => (s ? `median ${s.median == null ? `— (needs ≥5, have ${s.n})` : fmtDur(s.median)} · min ${fmtDur(s.min)} · max ${fmtDur(s.max)}${s.samples ? ` · samples ${s.samples.map(fmtDur).join(', ')}` : ''}` : 'not measured');
const verdictOf = (r) => {
  if (!r) return null;
  if (r.reason) return { text: { unaccepted: 'estimate not accepted', unestimated: 'no estimate', missing_actual: 'no usable actual', zero_midpoint: 'zero-width estimate', unit_mismatch: 'unit mismatch', excluded_item: 'excluded item', no_eligible_latest: 'no eligible latest estimate' }[r.reason] ?? r.reason, cls: '' };
  if (r.hit === true) return { text: 'within range', cls: 'oc-done' };
  if (r.hit === false) return r.ratio != null && r.ratio < 1 ? { text: 'below range', cls: 'oc-below' } : { text: 'above range', cls: 'oc-cancelled' };
  return null;
};
const bandText = (sv) => {
  if (!sv) return null;
  if (sv.band.vs_low_s < 0) return `${fmtDur(-sv.band.vs_low_s)} under the low bound`;
  if (sv.band.vs_high_s > 0) return `${fmtDur(sv.band.vs_high_s)} over the high bound`;
  return 'within the estimate';
};
const stateChip = (state) => `<span class="oc oc-${escHtml(state)}">${escHtml(state.replace('_', ' '))}</span>`;

const trendText = (t) => {
  if (!t) return null;
  if (t.ratio == null) return `needs ≥${t.floor} finished tasks <span class="stat-sub">(has ${t.n})</span>`;
  const pct = Math.round((t.ratio - 1) * 100);
  return `${pct > 0 ? '+' : ''}${pct}% <span class="stat-sub">${t.direction} — latest ${t.latest.n} vs earlier ${t.earlier.n}</span>`;
};

/** The DORA panel: the same figures as the Markdown `## DORA` block, in the page's units. */
function doraPanel(m, e) {
  const d = m.dora, label = escHtml(e.policy.labels.deployment_frequency ?? DEPLOY_LABEL), t = m.throughput.task, all = m.flow.task?.strata?.all;
  const cells = [
    statCell('Deployment frequency <span class="stat-sub">task velocity</span>', t?.velocity ? `${t.velocity.median} <span class="stat-sub">per week</span>` : `— <span class="stat-sub">needs ${e.policy.minWholeWeeks} whole weeks</span>`),
    // Cycle time when dispatch starts were observed, else the commit → done fallback clock (the same rule as the flow table).
    (() => { const s = all?.cycle_time ?? all?.commit_to_done ?? null, what = all?.cycle_time ? 'median task cycle time' : 'median commit → done';
      return statCell(`Lead time for changes <span class="stat-sub">${what}</span>`, s ? (s.median == null ? `— <span class="stat-sub">needs ≥5 (has ${s.n})</span>` : fmtDur(s.median)) : '—'); })(),
  ];
  let body;
  if (!d.recorded) body = '<p class="note">No defects recorded — change failure rate and time to restore need <code>event &lt;ref&gt; defect_found</code>.</p>';
  else {
    const c = d.change_failure_rate, r = d.time_to_restore;
    cells.push(statCell('Change failure rate', c.denominator ? `${c.numerator} of ${c.denominator} <span class="stat-sub">tasks landed in the window (${pctOf(c.ratio)})</span>` : '— <span class="stat-sub">no task landed in the window</span>'));
    cells.push(statCell('Time to restore <span class="stat-sub">found → fixed</span>', `${r.stats ? (r.stats.median == null ? `${fmtDur(r.stats.min)}–${fmtDur(r.stats.max)} <span class="stat-sub">(n=${r.stats.n})</span>` : fmtDur(r.stats.median)) : '—'}${r.open ? ` <span class="stat-sub">· ${r.open} open, oldest ${fmtDur(r.oldest_open_s)}</span>` : ''}`));
    const stages = Object.entries(d.defects_by_stage).filter(([, v]) => v.escaped || v.before_landing);
    body = `${stages.length ? `<table><tr><th>found at</th><th>escaped (after landing)</th><th>before landing</th></tr>${stages.map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${v.escaped}</td><td>${v.before_landing}</td></tr>`).join('')}</table>` : '<p class="note">No defect found in the window.</p>'}${d.untraced.n ? `<p class="note">${d.untraced.n} defect(s) recorded on a mission, campaign or case, not traced to a task — not in the change failure rate.</p>` : ''}${d.excluded_defects ? `<p class="note">${d.excluded_defects} defect(s) on tasks with a quarantined or proxy completion — escape not judged.</p>` : ''}`;
  }
  return `<section class="panel"><h2>DORA</h2><p class="panel-sub">A task "deploys" when it merges (${label}). Change failure rate = landed tasks with a defect found after they landed; defects are found later, so recent tasks are undercounted.</p><div class="kpi-grid">${cells.join('')}</div>${body}</section>`;
}

/** The Cost panel: per-plan cost line, estimated × actual band table and planner size × band table. Nothing for an archived
 * report from before task costs. */
function costPanel(p, e) {
  if (!e.cost_basis) return '';
  const esc = escHtml, m = p.metrics, c = p.cost, b = m.estimate_bands, ps = m.planner_size_bands;
  const table = (matrix, corner) => {
    const rows = Object.keys(matrix), cols = [...new Set(rows.flatMap((r) => Object.keys(matrix[r])))].sort();
    return `<table><tr><th>${corner}</th>${cols.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>${rows.map((r) => `<tr><td>${esc(r)}</td>${cols.map((x) => `<td>${matrix[r][x] ?? '—'}</td>`).join('')}</tr>`).join('')}</table>`;
  };
  const basis = e.cost_basis === 'c1' ? `At current prices (as of ${esc(e.prices_as_of ?? 'unknown')}): the lifetime cost of dispatches started before the report's end, so a past report can be revised.`
    : `Hook-time costs: current-price task costs were unavailable (${esc(e.cost_fallback?.code)}).`;
  const line = c ? `<p>Tasks done in the window: ${usd(c.done_in_window_usd)} <span class="sub">(${c.done_in_window_n} with a usable cost${c.done_without_cost ? `; ${c.done_without_cost} without` : ''})</span> · all tasks: ${usd(c.all_tasks_usd)}</p>` : '';
  const bands = b ? (b.n ? `<p>Estimated band (rows) against actual band (columns): ${b.same} same, ${b.one_off} one off, ${b.two_or_more_off} two or more off.</p>${table(b.matrix, 'estimated')}` : '')
    : `<p class="note">Effort bands not shown: ${esc(e.estimate_bands?.suppressed ?? 'unavailable')}.</p>`;
  const sizes = ps ? (ps.matrix ? `<p>Planner size (rows) against actual band (columns), ${ps.n} tasks:</p>${table(ps.matrix, 'size')}` : `<p class="note">Planner size against actual band appears from ${ps.min_n} sized tasks with a usable cost (has ${ps.n}).</p>`) : '';
  return `<section class="panel"><h2>Cost</h2><p class="panel-sub">${basis}${e.estimate_bands?.bounds_usd ? ` Bands: ${esc(boundsText(e.estimate_bands.bounds_usd))}.` : ''}</p>${line}${bands}${sizes}</section>`;
}

export function renderHtml(doc) {
  const e = doc.envelope; const esc = escHtml;
  const metaFilters = e.policy.filters?.level || e.policy.filters?.class ? ` · filters ${esc(JSON.stringify(e.policy.filters))}` : '';
  const parts = [
    `<!doctype html><meta charset="utf-8"><title>Delivery monitor — ${esc(e.plans.join(', '))}</title><style>${PAGE_CSS}</style>`,
    '<h1>Delivery monitor</h1>',
    `<p class="meta">Delivery view${projectOf(e) ? ` · project ${esc(projectOf(e))}` : ''} · generated ${fmtTs(e.generated_at)} · observed ${fmtTs(e.window.since)} → ${fmtTs(e.window.effective_end)} · ${e.plans.length} campaign run(s) · git ${esc((e.git.sha ?? '—').slice(0, 10))}${e.git.is_working_tree ? ' (uncommitted changes)' : ''}${metaFilters}</p>`,
  ];
  for (const p of doc.plans) {
    const m = p.metrics;
    const byLevel = (lv) => p.items.filter((i) => i.level === lv);
    const count = (rows, st) => rows.filter((i) => i.state === st).length;
    const tasks = byLevel('task').sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
    const missions = byLevel('mission').sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
    const campaign = byLevel('campaign')[0] ?? null;
    const estRow = new Map(m.estimate_rows.map((r) => [r.item_id, r]));
    const svRow = new Map(m.schedule_variance.map((r) => [r.ref, r]));
    const missionOf = new Map(); for (const t of tasks) if (t.parent_item_id) { const g = missions.find((x) => x.item_id === t.parent_item_id); if (g) missionOf.set(t.item_id, g.ref); }
    const ct = m.flow.task?.strata?.all?.cycle_time ?? null, lt = m.flow.task?.strata?.all?.lead_time ?? null;
    const rw = m.flow.task?.strata?.all?.review_wait ?? null, ag = m.flow.task?.strata?.all?.agent_span ?? null;
    const tb = m.flow.task?.strata?.all?.time_blocked ?? null, fe = m.flow.task?.strata?.all?.flow_efficiency ?? null;
    const es = m.estimates.task?.strata?.all ?? null, esUsd = m.estimates.task?.strata?.['usd:all'] ?? null;
    const doneTasks = count(tasks, 'done');
    const weeksTxt = (lv) => { const t = m.throughput[lv]; if (!t?.weeks.length) return '—'; return t.weeks.map((w) => `${esc(w.key)}: ${w.count}${w.whole ? '' : ' <span class="stat-sub">(partial)</span>'}`).join(' · '); };
    const vel = m.throughput.task; const wholeWeeks = vel ? vel.weeks.filter((w) => w.whole).length : 0;
    const velTxt = vel?.velocity ? `${vel.velocity.median} <span class="stat-sub">tasks / week, median of ${vel.velocity.whole_weeks} whole weeks</span>` : `— <span class="stat-sub">needs ${e.policy.minWholeWeeks} whole weeks, have ${wholeWeeks}</span>`;
    const windowS = elapsedS(e.window.since, e.window.effective_end);
    const statusWord = { open: 'in progress', closed: 'closed' }[p.status] ?? p.status;

    parts.push('<section class="plan">');
    parts.push(`<h2>${esc(campaign?.ref ?? p.run)} <span class="sub">campaign ${esc(p.run)} · plan v${p.version} · ${esc(statusWord)}</span></h2>`);
    parts.push(`<p class="panel-sub">${tasks.length} task(s) in ${missions.length} mission(s)${campaign ? `; campaign ${esc(campaign.state.replace('_', ' '))}` : ''}. A run is one execution of the campaign; the plan version counts re-cuts of its scope; "${esc(statusWord)}" is the run's own status (\`plan close\` ends it).</p>`);

    const cards = [
      kpiCard('Progress <span class="stat-sub">since plan start</span>', [
        statCell('Missions done', `${count(missions, 'done')} / ${missions.length}`),
        statCell('In progress', `${count(tasks, 'in_progress')} <span class="stat-sub">tasks · ${m.wip.mission ?? count(missions, 'in_progress')} missions</span>`),
        statCell('Not started', `${count(tasks, 'planned')} <span class="stat-sub">tasks</span>${count(tasks, 'cancelled') ? ` <span class="stat-sub">· ${count(tasks, 'cancelled')} cancelled</span>` : ''}`),
      ], `${windowS != null ? `Completed in ${fmtDur(windowS)} of observed time.` : ''}${wholeWeeks >= e.policy.minWholeWeeks ? '' : ` Weekly pace appears after ${e.policy.minWholeWeeks} whole weeks (has ${wholeWeeks}).`}`.trim() || null,
      { value: `${doneTasks} <span class="stat-sub">/ ${tasks.length - count(tasks, 'cancelled')}</span>`, label: 'tasks done' }),
      kpiCard('Cycle time <span class="stat-sub">first dispatch → merge</span>', [
        statCell('Range', ct ? `${fmtDur(ct.min)}–${fmtDur(ct.max)}` : '—'),
        statCell('Measured', `${ct ? ct.n : 0} of ${doneTasks} <span class="stat-sub">done · ${count(tasks, 'in_progress')} open</span>`),
        statCell('Trend <span class="stat-sub">latest ½ vs earlier ½</span>', trendText(m.flow.task?.trend) ?? '—'),
      ], `Trend compares medians of the latest and earlier halves of finished tasks (≥5 each); a changing mix of task sizes can move it.${!ct && excludedStr(m.flow.task?.excluded ?? {}) ? ` Not measured: ${esc(excludedStr(m.flow.task.excluded))}.` : ''}`,
      { value: ct ? (ct.median == null ? `— <span class="stat-sub">median needs ≥5 (has ${ct.n})</span>` : fmtDur(ct.median)) : '— <span class="stat-sub">not measured</span>', label: 'median cycle time per task' }),
      ...(wholeWeeks >= e.policy.minWholeWeeks ? [kpiCard('Pace <span class="stat-sub">per UTC ISO week</span>', [
        statCell('Tasks per week', weeksTxt('task')),
        statCell('Missions per week', weeksTxt('mission')),
        statCell('Whole weeks observed', `${wholeWeeks}`),
      ], 'Velocity is the median over whole Monday–Sunday weeks inside the observed window; a partial week is shown but never extrapolated.',
      { value: velTxt, label: 'velocity' })] : []),
      kpiCard('Quality & review', [
        statCell('Review turnaround <span class="stat-sub">agent done → merged</span>', rw ? (rw.median == null ? `${fmtDur(rw.min)}–${fmtDur(rw.max)} <span class="stat-sub">(n=${rw.n})</span>` : fmtDur(rw.median)) : '— <span class="stat-sub">no hook capture</span>'),
        statCell('Agent time <span class="stat-sub">median per task</span>', ag ? (ag.median == null ? `${fmtDur(ag.min)}–${fmtDur(ag.max)} <span class="stat-sub">(n=${ag.n})</span>` : fmtDur(ag.median)) : '—'),
        statCell('Cancelled', `${count(tasks, 'cancelled')} <span class="stat-sub">of ${tasks.length} tasks</span>`),
      ], 'A fix round is a task sent back after review before it merged; review turnaround is the human part of the cycle, agent time the sum of dispatch spans.',
      { value: doneTasks ? `${m.rework_proxy_items} <span class="stat-sub">of ${doneTasks} · ${Math.round((m.rework_proxy_items / doneTasks) * 100)}%</span>` : '—', label: 'tasks needed a fix round before merge' }),
      kpiCard('Estimates <span class="stat-sub">vs accepted ranges</span>', es ? [
        statCell('Work vs estimate', es.work_ratio ? (es.work_ratio.median == null ? `${pctOf(es.work_ratio.min)}–${pctOf(es.work_ratio.max)} <span class="stat-sub">of estimate (${es.work_ratio.n}; median from 5)</span>` : `${pctOf(es.work_ratio.median)} <span class="stat-sub">of estimate (median)</span>`) : '—'),
        statCell('Typical error <span class="stat-sub">MdMRE</span>', es.mdmre == null ? '—' : `${Math.round(es.mdmre * 100)}%`),
        statCell('Counted', `${es.eligible} of ${es.n}${excludedStr(es.excluded) ? ` <span class="stat-sub">· ${Object.entries(es.excluded).filter(([, v]) => v).map(([k, v]) => `${v} ${esc(k.replace(/_/g, ' '))}`).join(', ')}</span>` : ' <span class="stat-sub">estimates</span>'}`),
      ] : [statCell('Estimates', '— <span class="stat-sub">none registered</span>')],
      'Only accepted estimates count. "Work vs estimate" = actual ÷ midpoint of the range; typical error = median |estimate − actual| ÷ actual (MdMRE).',
      es ? { value: es.hit_rate.rate == null ? '—' : `${es.hit_rate.hits} <span class="stat-sub">of ${es.hit_rate.ranged}</span>`, label: 'tasks finished within their estimated range' } : null),
      // Dollar estimates are judged on each task's cost, separately from hours: as effort bands when the report can band them,
      // with the dollar figures as detail.
      ...(esUsd ? [(() => {
        const b = m.estimate_bands, within = `${esUsd.hit_rate.hits} <span class="stat-sub">of ${esUsd.hit_rate.ranged}</span>`;
        const dollars = [
          statCell('Cost vs estimate', esUsd.work_ratio ? (esUsd.work_ratio.median == null ? `${pctOf(esUsd.work_ratio.min)}–${pctOf(esUsd.work_ratio.max)} <span class="stat-sub">of estimate (${esUsd.work_ratio.n}; median from 5)</span>` : `${pctOf(esUsd.work_ratio.median)} <span class="stat-sub">of estimate (median)</span>`) : '—'),
          statCell('Typical error <span class="stat-sub">MdMRE</span>', esUsd.mdmre == null ? '—' : `${Math.round(esUsd.mdmre * 100)}%`),
          statCell('Counted', `${esUsd.eligible} of ${esUsd.n}`),
        ];
        const cells = b ? [statCell('Same band', String(b.same)), statCell('One band off', String(b.one_off)), statCell('Two or more off', String(b.two_or_more_off)), statCell('Within dollar range', esUsd.hit_rate.rate == null ? '—' : within), ...dollars] : dollars;
        const off = e.estimate_bands?.suppressed ? ` Bands not shown: ${esc(e.estimate_bands.suppressed)}.` : '';
        const actual = e.cost_basis === 'c1' ? "the task's cost: every dispatch attributed to it, counted once, at current prices, from dispatches started before the report's end"
          : e.cost_basis === 'hook' ? "the task's hook-time cost (current-price task costs were unavailable)" : "the task's recorded cost";
        const help = `Bands E1–E4 are the calibration table's cost quartiles. An estimate's band is its calibrated p50 (another range's midpoint, or a point's value); the actual is ${actual}. Within dollar range = the actual falls inside the estimate's dollars.${off}`;
        return kpiCard('Cost estimates <span class="stat-sub">vs task cost</span>', cells, help,
          b ? { value: `${b.within_one} <span class="stat-sub">of ${b.n}</span>`, label: 'estimates within one effort band' } : { value: esUsd.hit_rate.rate == null ? '—' : within, label: 'tasks finished within their dollar range' });
      })()] : []),
    ].join('');
    parts.push(`<section class="kpi-row">${cards}</section>`);


    // Missions and tasks — one grouped table: a mission header row, then its tasks as aligned columns.
    // Verdicts are chips in their own column so exceptions are found without reading the row.
    const cycles = tasks.map((t) => elapsedS(t.started_at, t.done_at));
    const maxCycle = Math.max(1, ...cycles.filter((c) => c != null));
    const cycleOf = new Map(tasks.map((t, i) => [t.item_id, cycles[i]]));
    const verdictChip = (v) => (v ? `<span class="oc ${v.cls}">${esc(v.text)}</span>` : '');
    const bar = (sec, max) => (sec == null ? '<span class="sub">—</span>' : `<div class="cell-bar"><div class="track"><div class="bar" style="width:${Math.max(1, (sec / max) * 100)}%"></div></div><span class="num">${fmtDur(sec)}</span></div>`);
    const cell = (cls, inner) => `<div class="c ${cls}">${inner}</div>`;
    // A task's cost and its actual effort band; an incomplete cost is marked, never banded.
    const costCell = (t) => (t.cost_usd == null ? '<span class="sub">—</span>' : `${usd(t.cost_usd)}${t.cost_band ? ` <span class="oc band">${esc(t.cost_band)}</span>` : ''}${t.cost_gaps?.length ? ` <span class="sub" title="${esc(t.cost_gaps.join(', '))}">(incomplete)</span>` : ''}`);
    const taskRow = (t) => {
      const c = cycleOf.get(t.item_id); const r = estRow.get(t.item_id); const v = verdictOf(r) ?? (t.estimate ? null : (t.estimate_status === 'unaccepted' ? { text: 'not accepted', cls: '' } : (t.state === 'done' ? { text: 'no estimate', cls: '' } : null)));
      const start = t.started_at ? '' : (t.state === 'planned' || t.state === 'cancelled' ? '' : ' <span class="sub">(no observed start)</span>');
      return `<div class="mrow task">${cell('ref', `<span title="${esc(t.item_id)}">${esc(t.ref)}</span>${t.class ? ` <span class="chip">${esc(t.class)}</span>` : ''}`)}${cell('', stateChip(t.state))}${cell('', `${bar(c, maxCycle)}${start}`)}${cell('', t.estimate ? fmtRangeH(t.estimate) : '<span class="sub">—</span>')}${cell('', verdictChip(v))}${cell('num', costCell(t))}${cell('num', '')}${cell('num', t.rework_count ? String(t.rework_count) : '<span class="sub">—</span>')}${cell('span', fmtSpan(t.started_at, t.done_at) ?? (t.started_at ? `${fmtShort(t.started_at)} → <span class="sub">open</span>` : '<span class="sub">—</span>'))}</div>`;
    };
    const missionElapsed = missions.map((g) => elapsedS(g.started_at, g.landing_at ?? g.done_at));
    const maxMission = Math.max(1, ...missionElapsed.filter((c) => c != null));
    // Accordion per mission (native <details>, no script — same pattern as screen-specs' build-story):
    // on a plan with more than COLLAPSE_ABOVE tasks, finished missions start collapsed and open ones
    // expanded; smaller plans start fully expanded. The header keeps every mission figure visible.
    const COLLAPSE_ABOVE = 12;
    const missionBlock = (g, idx) => {
      const cs = g.current_scope?.child_summary ?? { done: 0, cancelled: 0, open: 0, unknown: 0 };
      const inScope = cs.done + cs.open + cs.unknown; const el = missionElapsed[idx]; const sv = svRow.get(g.ref);
      const v = sv ? { text: bandText(sv), cls: sv.band.vs_low_s < 0 ? '' : sv.band.vs_high_s > 0 ? 'oc-cancelled' : 'oc-done' } : null;
      const kids = tasks.filter((t) => t.parent_item_id === g.item_id);
      const expanded = tasks.length <= COLLAPSE_ABOVE || g.state !== 'done';
      const header = `<div class="mrow mission">${cell('ref', `<span title="${esc(g.item_id)}">${esc(g.ref)}</span>`)}${cell('', stateChip(g.state))}${cell('', bar(el, maxMission))}${cell('', g.estimate ? fmtRangeH(g.estimate) : '<span class="sub">—</span>')}${cell('', `${verdictChip(v)}${sv && (sv.scope.added || sv.scope.removed) ? ` <span class="chip">scope +${sv.scope.added}/−${sv.scope.removed}</span>` : ''}`)}${cell('num', '')}${cell('num', `${cs.done}/${inScope}${cs.cancelled ? `<br><span class="sub">+${cs.cancelled} canc.</span>` : ''}`)}${cell('num', (() => { const n = kids.reduce((a, t) => a + (t.rework_count || 0), 0); return n ? String(n) : '<span class="sub">—</span>'; })())}${cell('span', fmtSpan(g.started_at, g.landing_at ?? g.done_at) ?? (g.started_at ? `${fmtShort(g.started_at)} → <span class="sub">open</span>` : '<span class="sub">—</span>'))}</div>`;
      return `<details class="mission"${expanded ? ' open' : ''}><summary>${header}</summary>${kids.map(taskRow).join('') || '<div class="mrow task"><div class="c ref sub">no tasks</div></div>'}</details>`;
    };
    const orphanTasks = tasks.filter((t) => !t.parent_item_id || !missions.some((g) => g.item_id === t.parent_item_id));
    const tableBody = missions.map(missionBlock).join('') + (orphanTasks.length ? `<details class="mission" open><summary><div class="mrow mission">${cell('ref', 'no mission')}${cell('', '')}${cell('', '')}${cell('', '')}${cell('', '')}${cell('num', '')}${cell('num', `${orphanTasks.filter((t) => t.state === 'done').length}/${orphanTasks.filter((t) => t.state !== 'cancelled').length}`)}${cell('num', '')}${cell('span', '')}</div></summary>${orphanTasks.map(taskRow).join('')}</details>` : '');
    const campaignLine = campaign ? `<p class="note">Campaign ${esc(campaign.ref)}: ${esc(campaign.state.replace('_', ' '))}${elapsedS(campaign.started_at, campaign.landing_at ?? campaign.done_at) != null ? `, ${fmtDur(elapsedS(campaign.started_at, campaign.landing_at ?? campaign.done_at))} from first dispatch to landing` : ''}${campaign.estimate ? ` · estimate ${fmtRangeH(campaign.estimate)}` : ''}${svRow.get(campaign.ref) ? ` · ${esc(bandText(svRow.get(campaign.ref)))}` : ''}.</p>` : '';
    parts.push(`<section class="panel"><h2>Missions and tasks</h2><p class="panel-sub">A mission row, then its tasks (click a mission to fold it). Time = cycle time for a task (first dispatch → merge) and elapsed for a mission (first task dispatched → landed); bars are scaled within their kind. The verdict compares the actual with the accepted estimate range; cost is the task's cost with its effort band; "fixes" counts the times a task was sent back before it merged.</p>
<div class="items"><div class="mrow head"><div class="c">item</div><div class="c">status</div><div class="c">time</div><div class="c">estimate</div><div class="c">verdict</div><div class="c">cost</div><div class="c">done</div><div class="c">fixes</div><div class="c">started → finished (UTC)</div></div>${tableBody || '<p class="note">No items in this plan.</p>'}</div>${campaignLine}</section>`);
    parts.push(costPanel(p, e));
    parts.push(`<section class="panel"><h2>Spread</h2><p>Task cycle time: ${spreadLine(ct)}<br>Task lead time (planned → merge): ${spreadLine(lt)}<br>Agent time: ${spreadLine(ag)}<br>Review turnaround: ${spreadLine(rw)}${tb ? `<br>Time blocked: ${spreadLine(tb)}` : ''}${fe ? `<br>Flow efficiency <span class="sub">(agent time ÷ cycle time, a lower bound)</span>: ${spreadPct(fe)}` : ''}${m.mission_turnaround.pairs.length ? `<br>Mission turnaround: ${m.mission_turnaround.pairs.map((x) => `${esc(x.from)} → ${esc(x.to)} ${x.gap_s != null ? fmtDur(x.gap_s) : `overlap ${fmtDur(x.overlap_s)}`}`).join('; ')}` : ''}</p></section>`);

    if (m.dora) parts.push(doraPanel(m, e));

    const open = p.items.filter(isOpen);
    if (open.length) parts.push(`<section class="panel"><h2>Open items</h2><p class="panel-sub">Age is measured to the report's cutoff (${fmtTs(e.window.effective_end)}).</p><table><tr><th>ref</th><th>level</th><th>state</th><th>started</th><th>open for</th></tr>${open.map((i) => `<tr><td>${esc(i.ref)}</td><td>${esc(i.level)}</td><td>${esc(i.state.replace('_', ' '))}${i.blocked_since ? ` <span class="sub">(blocked since ${fmtTs(i.blocked_since)})</span>` : ''}${i.flags.length ? ` <span class="sub">(${esc(i.flags.join(', '))})</span>` : ''}</td><td>${i.started_at ? fmtTs(i.started_at) : '— <span class="sub">no observed start</span>'}</td><td>${i.first_completion && i.current_scope?.pending ? '— <span class="sub">pending-scope age unavailable in M1</span>' : (i.started_at ? fmtDur(elapsedS(i.started_at, e.window.effective_end)) : '—')}</td></tr>`).join('')}</table></section>`);

    parts.push('</section>');
  }
  // One honest footer instead of the assessor blocks: what the numbers are and where the detail lives.
  parts.push(`<p class="note">Figures come from observed events only (plan registration, dispatch hooks, merges, git history); nothing is estimated or inferred. Percentile floors, per-stratum statistics, capture coverage and the standing caveats are in the Markdown/JSON export (<code>report</code>, <code>report --json</code>).</p>`);
  return parts.join('\n');
}

export function renderStatus(doc) {
  const e = doc.envelope; const L = [];
  for (const p of doc.plans) {
    L.push(`STATUS ${p.run} v${p.version} (${p.status}) at ${e.window.effective_end}`);
    for (const lv of ['campaign', 'mission', 'task', 'case']) { const rows = p.items.filter((i) => i.level === lv); if (!rows.length) continue; const n = (s) => rows.filter((i) => i.state === s).length; L.push(`  ${lv}: done=${n('done')} in_progress=${n('in_progress')} planned=${n('planned')} cancelled=${n('cancelled')}`); }
    for (const i of p.items.filter((i) => i.first_completion && i.current_scope?.pending)) L.push(`  pending scope ${i.ref}: first_done=${i.first_completion.done_at}; current_done=unknown; pending-scope age unavailable (M1)`);
    for (const i of p.items.filter((i) => isOpen(i) && i.level !== 'campaign' && !i.first_completion)) L.push(`  open ${i.ref} (${i.level}${i.flags.length ? `, ${i.flags.join(', ')}` : ''}) started=${i.started_at ?? '—'} age=${ageH(e.window.effective_end, i.started_at) ?? '—'}${i.blocked_since ? ` blocked_since=${i.blocked_since}` : ''}`);
    if (p.registration_gaps) L.push(`  registration_gaps=${p.registration_gaps} (items without a created observation)`);
    if (p.finished) L.push(`  ${closeHint(p.run)}`);
    const fill = p.items.filter((i) => i.state === 'done' && i.level === 'task' && (!i.created_at || !i.first_commit_at)).length; if (fill) L.push(`  backfill --git could fill created/first_commit for ${fill} done task(s)`);
  }
  L.push(`  ledger: occurrence_conflicts=${e.coverage.occurrence_conflicts} ledger_conflicts=${e.coverage.ledger_conflicts} unregistered=${e.coverage.unregistered} malformed=${e.coverage.malformed_lines} malformed_runs=${e.coverage.malformed_runs}`);
  // Minor (f): `e.caveats` is `[...UNCONDITIONAL_CAVEATS, ...derived]` (assemble) — printing the
  // whole array, in that order, surfaces the derived count-bearing caveats (malformed lines,
  // conflicts, unattributed dispatches, …) after the unconditional ones, instead of silently
  // dropping them from `status` the way printing only the constant did.
  for (const c of e.caveats) L.push(`  caveat: ${c}`);
  return `${L.join('\n')}\n`;
}
