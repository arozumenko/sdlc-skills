// STDLIB ONLY. Per-task budget policy and ledger writes. taskCosts is the sole task-cost projection.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRunsChecked } from './attribution.mjs';
import { appendObservation, makeObservation, resolveObservations, validateEstimate } from './events.mjs';
import { loadPricesChecked } from './cost.mjs';
import { deliveryDir, nowIso, profilePath } from './paths.mjs';
import { taskCosts, taskKey } from './task-costs.mjs';
import { selectOccurrences } from './timeline.mjs';

export const BUDGET_EVENTS = ['budget_exceeded', 'budget_stopped'];
export const BUDGET_DEFAULTS = { budgetSoftMultiplier: 1, budgetHardMultiplier: 3 };
export function budgetProfile(repo) {
  let local = {};
  try { local = JSON.parse(readFileSync(profilePath(repo), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const p = { ...BUDGET_DEFAULTS, ...local };
  for (const k of Object.keys(BUDGET_DEFAULTS)) if (!Number.isFinite(p[k]) || p[k] <= 0) throw new Error(`invalid ${k}`);
  if (p.budgetHardMultiplier < p.budgetSoftMultiplier) throw new Error('budgetHardMultiplier must be >= budgetSoftMultiplier');
  return p;
}
export const canonicalBudgetItem = (run, id) => {
  const map = { ...(run.budget_item_map ?? {}), ...(run.supersedes?.item_map ?? {}) }, seen = new Set();
  while (Object.hasOwn(map, id) && map[id] !== id && !seen.has(id)) { seen.add(id); id = map[id]; }
  return id;
};
export function budgetedItem(item) {
  return item?.level === 'task' && !item.cancelled && item.estimate?.unit === 'usd' && validateEstimate(item.estimate).length === 0;
}
/** Fail closed on the check's evidence, fail open at the hook boundary. Unlike report readers, a hook must not silently
 * discard a broken line and then refuse work on an undercounted total. The evidence is the run files, the events ledger, the
 * profile and the price table. Calibration is not read: a task's budget is the USD range saved on its plan item at registration,
 * so a missing or damaged calibration file does not change the check. */
export function budgetInputs(repo) {
  const { runs } = loadRunsChecked(repo), resolved = resolveObservations(repo);
  if (resolved.counts.malformed || resolved.counts.unknownVersion || resolved.conflicts.length) throw new Error('events ledger is unreadable or conflicted');
  const profile = budgetProfile(repo), loaded = loadPricesChecked(repo);
  if (loaded.problem) throw new Error(loaded.problem);
  return { runs, resolved, profile, prices: loaded.prices };
}
/** What the budget feature is, printed wherever a budget line is: a guard that works when it can, not a spending limit. */
export const BUDGET_GUARD_NOTE = 'best effort, not a ceiling: it fails open when it cannot read its evidence; it counts subagent dispatches only, not the orchestrating session; subagents working on the same task at the same time do not see each other\'s live spend; a refused tool call is not verified to end all spending';
export const BUDGET_CHECK_WINDOW_DAYS = 7;
/** Whether the hook recently allowed work it could not evaluate. The hook writes one `budget-check-unavailable` diagnostic per
 * session and nothing when it works, so this reports the latest such line of the last 7 days (its time, reason and session)
 * and how many sessions wrote one. It cannot tell that the cause was repaired since: the state clears when 7 days pass
 * without a new line. Never throws; diagnostics that cannot be read give `unreadable`. */
export function budgetCheckState(repo, { now = Date.now() } = {}) {
  const state = { window_days: BUDGET_CHECK_WINDOW_DAYS, off: null }, from = now - BUDGET_CHECK_WINDOW_DAYS * 86_400_000;
  try {
    const dir = deliveryDir(repo); if (!existsSync(dir)) return state;
    let latest = null; const sessions = new Set();
    for (const f of readdirSync(dir).filter((n) => /^diagnostics-.*\.jsonl$/.test(n)).sort()) {
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line.includes('budget-check-unavailable')) continue;
        let d; try { d = JSON.parse(line); } catch { continue; }
        if (d?.kind !== 'budget-check-unavailable' || !(Date.parse(d.at) >= from)) continue;
        sessions.add(d.session ?? null);
        if (!latest || d.at > latest.at) latest = d;
      }
    }
    if (latest) state.off = { since: latest.at, reason: String(latest.detail ?? 'unknown').split('\n')[0].slice(0, 200), session: latest.session ?? null, sessions: sessions.size };
  } catch (e) { state.unreadable = String(e.code ?? e.message).split('\n')[0]; }
  return state;
}
/** The lock covers the first-writer test AND append. The original transition survives a rename; later writers never revise
 * cost_at_crossing. Retraction withdraws the observation for counts without causing automatic re-emission. */
export function recordBudget(repo, { run, item, cost, dispatchKey, source, session, agentId = null, profile, now = Date.now() }) {
  cost = Math.round(cost * 1e6) / 1e6; // taskCosts sums micro-dollar priced keys; remove floating-point accumulation noise.
  const high = item.estimate.high, soft = high * profile.budgetSoftMultiplier, cap = high * profile.budgetHardMultiplier;
  const over = threshold => cost - threshold > Number.EPSILON * Math.max(1, Math.abs(cost), Math.abs(threshold)) * 4;
  const wrote = [];
  for (const [event, threshold] of [['budget_exceeded', soft], ['budget_stopped', cap]]) {
    if (!over(threshold)) continue;
    const existing = (r) => r.plan === run.run && r.event === event && canonicalBudgetItem(run, r.item_id) === item.item_id;
    const rec = makeObservation({ host: 'claude', plan: run.run, item_id: item.item_id, ref: item.ref, level: 'task', event,
      source: 'hook', source_record_id: dispatchKey, session, agentId, at: nowIso(now), transition_id: `${item.item_id}/${event}/budget`,
      meta: { version: run.version, budget: { high, soft_multiplier: profile.budgetSoftMultiplier, hard_multiplier: profile.budgetHardMultiplier,
        cap_usd: cap, cost_at_crossing: cost, dispatch_key: dispatchKey, source } } }, { now });
    wrote.push(appendObservation(repo, rec, { now, firstFor: existing }));
  }
  return { wrote, stopped: over(cap), reason: `${item.ref}: task cost USD ${Number(cost.toFixed(6))} exceeds the budget guard threshold USD ${Number(cap.toFixed(6))}` };
}
const empty = () => ({ count: 0, usd: 0 });
const coverage = () => ({ budgeted: empty(), all: empty(), unbudgeted: empty(), codex: empty() });
const add = (bucket, usd) => { bucket.count++; bucket.usd += usd; };
/** Additive report/status data. Coverage is current lifetime spend, independent of report window and item filters.
 * A dispatch is budgeted only when every owner is an open-plan USD task on Claude. Codex always stays unbudgeted. */
export function budgetSummary(repo, { tc = null, runs = null, resolved = null } = {}) {
  runs ??= loadRunsChecked(repo).runs; resolved ??= resolveObservations(repo); tc ??= taskCosts(repo, { resolved });
  const open = runs.filter(r => r.status === 'open'), plans = Object.fromEntries(open.map(r => [r.run, { budget_exceeded: 0, budget_stopped: 0, coverage: coverage() }]));
  const known = new Set(open.flatMap(r => r.items.filter(budgetedItem).map(i => taskKey(r.run, i.item_id))));
  const { occurrences } = selectOccurrences(resolved.active, resolved.conflicts);
  for (const r of open) {
    const seen = new Set();
    for (const o of occurrences.filter(o => o.plan === r.run && BUDGET_EVENTS.includes(o.event))) {
      const id = canonicalBudgetItem(r, o.item_id), key = `${id}/${o.event}`;
      if (!r.items.some(i => i.item_id === id) || seen.has(key)) continue;
      seen.add(key); plans[r.run][o.event]++;
    }
  }
  const total = coverage();
  for (const k of tc.keys) {
    const codex = k.dispatch_key.startsWith('codex:'), budgeted = k.budget_eligible !== false && !codex && k.dispatch_key.startsWith('claude:') && k.owners.length > 0 && k.owners.every(o => known.has(o));
    const count = (c, usd) => { add(c.all, usd); add(c[budgeted ? 'budgeted' : 'unbudgeted'], usd); if (codex) add(c.codex, usd); };
    count(total, k.usd);
    // Per-plan totals include keys with a task owner there; ownerless work remains in the project total.
    for (const r of open) if (k.owners.some(o => o.startsWith(`${r.run}\u0000`)) || k.plans?.includes(r.run)) {
      const n = k.owners.filter(o => o.startsWith(`${r.run}\u0000`)).length;
      count(plans[r.run].coverage, k.usd * (k.owners.length ? n / k.owners.length : 1 / k.plans.length));
    }
  }
  for (const c of [total, ...Object.values(plans).map(p => p.coverage)]) for (const b of Object.values(c)) b.usd = Math.round(b.usd * 1e6) / 1e6;
  return { coverage: total, plans };
}
