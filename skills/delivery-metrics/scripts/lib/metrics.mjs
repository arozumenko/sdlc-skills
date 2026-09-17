// STDLIB ONLY. Metrics (spec §6.10) over timeline items. Seconds everywhere; rendering rounds. Every figure carries n; caveats from numbers.
export const secondsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;
export const toHours = (s) => (s == null ? null : Math.round((s / 3600) * 100) / 100);
export const nearestRank = (sorted, q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
export function stats(values) {
  const s = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b); const n = s.length;
  if (!n) return null;
  const out = { n, min: s[0], max: s[n - 1], median: n >= 5 ? nearestRank(s, 0.5) : null, p85: n >= 7 ? nearestRank(s, 0.85) : null, p90: n >= 10 ? nearestRank(s, 0.9) : null };
  // Minor fix: omit the `samples` key entirely for n >= 5 rather than setting it to undefined —
  // an explicit `undefined` value is still an own enumerable key and can trip a strict deepEqual
  // against a literal that has no such key at all.
  if (n < 5) out.samples = s;
  return out;
}
export function weekStartUtc(iso) { const d = new Date(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))); }
export function isoWeekUtc(iso) {
  const d = new Date(iso); const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3));
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4)); const week = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function weekKeys(since, end, coverageStart = since) {
  const s = Date.parse(since), e = Date.parse(end), c = Date.parse(coverageStart); const out = [];
  for (let w = weekStartUtc(since); w.getTime() < e; w = new Date(w.getTime() + 7 * 86400000)) {
    const next = w.getTime() + 7 * 86400000; const covered = w.getTime() >= c && next <= e;
    out.push({ key: isoWeekUtc(w.toISOString()), start: w.toISOString(), end: new Date(next).toISOString(), covered, whole: covered && w.getTime() >= s });
  }
  return out;
}

const LEVELS = ['campaign', 'mission', 'task', 'case'];
const inWin = (t, a, b) => t != null && t >= a && t < b;
const EXCL = ['excluded_item', 'unestimated', 'unaccepted', 'no_eligible_latest', 'unit_mismatch', 'missing_actual', 'late_accepted', 'zero_midpoint', 'zero_actual', 'point', 'clock_skew'];
const emptyEst = () => ({ n: 0, eligible: 0, work_ratio: null, mdmre: null, pred25: null, mae_s: null, hit_rate: { hits: 0, ranged: 0, rate: null }, excluded: Object.fromEntries(EXCL.map((k) => [k, 0])), _ratios: [], _mres: [], _aes: [] });
const finishEst = (e) => { e.work_ratio = stats(e._ratios); if (e._mres.length) { const s = [...e._mres].sort((a, b) => a - b); e.mdmre = Math.round(nearestRank(s, 0.5) * 10000) / 10000; e.pred25 = Math.round((e._mres.filter((m) => m <= 0.25).length / e._mres.length) * 10000) / 10000; } if (e._aes.length) e.mae_s = Math.round((e._aes.reduce((a, b) => a + b, 0) / e._aes.length) * 1000) / 1000; if (e.hit_rate.ranged) e.hit_rate.rate = Math.round((e.hit_rate.hits / e.hit_rate.ranged) * 10000) / 10000; delete e._ratios; delete e._mres; delete e._aes; return e; };

// F10: an item flagged invalid-chain is quarantined evidence — never trustworthy, in any metric.
const invalidChain = (i) => i.flags.includes('invalid-chain');
// A deferred-episode item's durations/estimate accuracy are still excluded (the episode replay
// makes its own clocks unreliable), but per the brief it still counts once in throughput by its
// first completion — so this predicate is deliberately NOT part of the throughput exclusion below.
const deferredEpisode = (i) => i.flags.includes('deferred-episode');
// F12: `done_basis` other than 'observed' (task) or 'derived-child' (parent rollup) is a proxy
// completion (scope-proxy/gate-proxy/receipt-proxy/plan-commit) — activity evidence only, never a
// witnessed landing. Such an item must not feed measured durations, throughput, or estimate
// accuracy; it is counted separately as a proxy completion.
const reliableDoneBasis = (i) => i.done_basis === 'observed' || i.done_basis === 'derived-child';
const proxyCompletion = (i) => i.done_at != null && !reliableDoneBasis(i);
// Excluded from every duration/estimate metric (flow strata, lead/cycle/commit/parent_elapsed, estimate accuracy).
const excludedItem = (i) => invalidChain(i) || deferredEpisode(i) || proxyCompletion(i);
// Excluded from throughput: invalid-chain (quarantined) and proxy completions (not a witnessed landing).
// deferred-episode items are NOT excluded here — they still count once in throughput by first completion.
const throughputExcluded = (i) => invalidChain(i) || proxyCompletion(i);
const qualityFor = (arr) => ({ reviewed: null, eligible: null, done: arr.length, unknown: arr.length });

export function computeMetrics({ items, plan, since, end, profile = {}, estimateBase = 'original', filters = {} }) {
  const zero = profile.zeroDurationSec ?? 60, minWeeks = profile.minWholeWeeks ?? 3;
  const sinceIso = new Date(since).toISOString(), endIso = new Date(end).toISOString();
  const covStart = plan.observation_start ? new Date(plan.observation_start).toISOString() : sinceIso;
  let all = [...items.values()];
  if (filters.level) all = all.filter((i) => i.level === filters.level);
  if (filters.class) all = all.filter((i) => i.class === filters.class);
  const completed = all.filter((i) => inWin(i.done_at, sinceIso, endIso));
  const caveats = [];
  const data = { window: { since: sinceIso, end: endIso, coverage_start: covStart }, cohorts: { completed: completed.length, created: all.filter((i) => inWin(i.created_at, sinceIso, endIso)).length,
    // Important fix: scoped to the windowed done cohort (`completed`), matching `completed`/`created`
    // above — a count here can never exceed `cohorts.completed` or cite an item whose done_at falls
    // outside [since,end). The window-independent inventory lives separately under `inventory.excluded_items` below.
    excluded_items: { invalid_chain: completed.filter(invalidChain).length, deferred_episode: completed.filter(deferredEpisode).length, proxy_completions: completed.filter(proxyCompletion).length } },
    inventory: { excluded_items: { invalid_chain: all.filter(invalidChain).length, deferred_episode: all.filter(deferredEpisode).length, proxy_completions: all.filter(proxyCompletion).length } },
    flow: {}, throughput: {}, wip: {}, mission_turnaround: { pairs: [], stats: null }, estimates: {}, estimate_rows: [], schedule_variance: [], coverage: {}, rework_proxy_items: completed.filter((i) => i.rework_count > 0).length, caveats };
  const weeks = weekKeys(sinceIso, endIso, covStart);
  for (const level of LEVELS) {
    const lvAll = all.filter((i) => i.level === level); if (!lvAll.length) continue;
    const done = completed.filter((i) => i.level === level);
    const measurable = done.filter((i) => !excludedItem(i));
    // F10: throughput/velocity read a separate cohort — excludes invalid-chain and proxy completions,
    // but (unlike `measurable`) keeps deferred-episode items so they still count once by first completion.
    const throughputDone = done.filter((i) => !throughputExcluded(i));
    const ex = { clock_skew_cycle: 0, clock_skew_commit: 0, clock_skew_lead: 0, retrospective_plan_proxy: 0, missing_start: 0 };
    // F17: every class present in the done cohort gets a stratum (so quality denominators are never
    // silently dropped for a class whose items were all excluded from durations), plus 'all'.
    const classKeys = new Set(['all', ...done.map((i) => i.class).filter(Boolean)]);
    const strata = {}; for (const cls of classKeys) strata[cls] = { cycle_time: [], commit_to_done: [], lead_time: [], parent_elapsed: [] };
    const bucket = (cls) => strata[cls];
    const actualOf = new Map();
    for (const i of measurable) {
      const targets = [bucket('all'), ...(i.class ? [bucket(i.class)] : [])];
      if (i.started_at) {
        const s = secondsBetween(i.started_at, i.done_at);
        if (s < 0) { ex.clock_skew_cycle++; actualOf.set(i.item_id, { skew: true }); }
        else if (i.start_basis === 'observed') { targets.forEach((t) => t.cycle_time.push(s)); actualOf.set(i.item_id, { s, basis: 'observed' }); }
        else { targets.forEach((t) => t.parent_elapsed.push(s)); actualOf.set(i.item_id, { s, basis: 'derived-child' }); }
      } else if (i.first_commit_at) { const s = secondsBetween(i.first_commit_at, i.done_at); if (s < 0) ex.clock_skew_commit++; else targets.forEach((t) => t.commit_to_done.push(s)); }
      else ex.missing_start++;
      if (i.created_at) {
        const s = secondsBetween(i.created_at, i.done_at);
        if (s < 0) ex.clock_skew_lead++;
        else if (i.created_basis === 'plan-commit' && i.created_sha && i.created_sha === i.done_sha && s <= zero) ex.retrospective_plan_proxy++;
        else targets.forEach((t) => t.lead_time.push(s));
      }
    }
    // Minor fix: quality lives in exactly one place — per-stratum (`strata.<class>.quality`,
    // including 'all') — no level-level duplicate.
    data.flow[level] = { strata: Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, { ...Object.fromEntries(Object.entries(v).map(([m, arr]) => [m, stats(arr)])), quality: qualityFor(k === 'all' ? done : done.filter((i) => i.class === k)) }])),
      excluded: ex };
    const counts = weeks.map((w) => ({ key: w.key, count: throughputDone.filter((i) => i.done_at >= w.start && i.done_at < w.end).length, whole: w.whole, covered: w.covered }));
    const whole = counts.filter((w) => w.whole).map((w) => w.count); let velocity = null, caveat = null;
    if (whole.length >= minWeeks) velocity = { median: nearestRank([...whole].sort((a, b) => a - b), 0.5), mean: Math.round((whole.reduce((a, b) => a + b, 0) / whole.length) * 100) / 100, whole_weeks: whole.length };
    else { caveat = `velocity(${level}): ${whole.length} whole weeks < ${minWeeks} — null`; caveats.push(caveat); }
    data.throughput[level] = { weeks: counts, velocity, caveat };
    data.wip[level] = lvAll.filter((i) => i.state === 'in_progress' && !i.cancelled_in_plan).length;
    const est = {}; const eb = (k) => (est[k] ??= emptyEst());
    for (const i of done) {
      const keys = ['all', ...(i.class ? [i.class] : [])];
      const chosen = estimateBase === 'latest' ? i.estimate_latest : i.estimate_original;
      const tier = chosen?.tier ?? i.estimates[0]?.estimate?.tier ?? null;
      if (tier) keys.push(`tier:${tier}`);
      // F17: joint class|tier stratum in addition to 'all' and the per-class/'tier:' marginals.
      if (i.class && tier) keys.push(`${i.class}|${tier}`);
      const bs = keys.map(eb);
      if (i.estimates.length) bs.forEach((b) => b.n++);
      let reason = null; const a = actualOf.get(i.item_id);
      const mid = chosen ? (chosen.low + chosen.high) / 2 : null;
      if (excludedItem(i)) reason = 'excluded_item';
      else if (!i.estimates.length) reason = 'unestimated';
      else if (!i.estimate_original) reason = 'unaccepted';
      else if (!chosen) reason = 'no_eligible_latest';
      else if (chosen.unit !== 'h') reason = 'unit_mismatch';
      else if (a?.skew) reason = 'clock_skew';
      else if (!a) reason = 'missing_actual';
      // Minor fix: compare epoch numbers via Date.parse, not `new Date(...).toISOString()` against
      // the raw `started_at` string. toISOString() always normalizes to millisecond precision
      // ('...000Z'), which sorts lexically BEFORE a same-instant string with no milliseconds
      // ('...Z') — the old string comparison silently missed the accepted_at === started_at case.
      else if (chosen.accepted_at != null && Date.parse(chosen.accepted_at) >= Date.parse(i.started_at)) reason = 'late_accepted';
      // Minor fix: zero_midpoint is now a full mutually-exclusive reason (brief order: …,
      // late_accepted, zero_midpoint, zero_actual, …) — not eligible, no MAE/ratio/MRE contribution,
      // same early-return shape as every other reason above it.
      else if (mid === 0) reason = 'zero_midpoint';
      if (reason) { bs.forEach((b) => b.excluded[reason]++); if (reason !== 'unestimated') data.estimate_rows.push({ item_id: i.item_id, ref: i.ref, level, class: i.class, tier, base: estimateBase, estimate: chosen ? { unit: chosen.unit, low: chosen.low, high: chosen.high } : null, actual_s: a?.s ?? null, actual_basis: a?.basis ?? null, ratio: null, hit: null, reason }); continue; }
      const actualH = a.s / 3600, ae = Math.abs(a.s - mid * 3600);
      const ratio = Math.round((actualH / mid) * 10000) / 10000; let hit = null;
      bs.forEach((b) => { b.eligible++; b._aes.push(ae); b._ratios.push(actualH / mid); });
      if (a.s === 0) bs.forEach((b) => b.excluded.zero_actual++); else bs.forEach((b) => b._mres.push(Math.abs(actualH - mid) / actualH));
      if (chosen.low === chosen.high) bs.forEach((b) => b.excluded.point++); else { hit = actualH >= chosen.low && actualH <= chosen.high; bs.forEach((b) => { b.hit_rate.ranged++; if (hit) b.hit_rate.hits++; }); }
      data.estimate_rows.push({ item_id: i.item_id, ref: i.ref, level, class: i.class, tier, base: estimateBase, estimate: { unit: chosen.unit, low: chosen.low, high: chosen.high }, actual_s: a.s, actual_basis: a.basis, ratio, hit, reason: null });
      if (level !== 'task') data.schedule_variance.push({ item_id: i.item_id, ref: i.ref, level, estimate: { low: chosen.low, high: chosen.high }, actual_s: a.s, band: { vs_high_s: a.s - chosen.high * 3600, vs_low_s: a.s - chosen.low * 3600 },
        scope: { added: i.children.map((c) => items.get(c)).filter((c) => c && c.version_added > 1).length, removed: i.children.map((c) => items.get(c)).filter((c) => c && c.cancelled_in_plan).length } });
    }
    data.estimates[level] = { strata: Object.fromEntries(Object.entries(est).map(([k, v]) => [k, finishEst(v)])) };
    // F17: source shares are read from the Item's *_source fields (who/what recorded the fact —
    // cli/hook/git/webhook/…), NOT the *_basis fields (observed/derived-child/plan-commit/… — how
    // trustworthy the fact is). Both are useful but answer different questions; coverage.sources answers "where did this evidence come from".
    const src = (field) => done.reduce((m, i) => { const s = i[field]; if (s) m[s] = (m[s] ?? 0) + 1; return m; }, {});
    data.coverage[level] = { done: done.length, with_dispatched: done.filter((i) => i.start_basis === 'observed').length, with_first_commit: done.filter((i) => i.first_commit_at).length, with_created: done.filter((i) => i.created_at).length,
      start_source: { observed: done.filter((i) => i.start_basis === 'observed').length, 'derived-child': done.filter((i) => i.start_basis === 'derived-child').length, none: done.filter((i) => !i.started_at).length },
      // Minor fix: done_basis split so coverage.done reconciles with throughput — observed +
      // 'derived-child' + proxy always sums to coverage.done, and observed + 'derived-child' is
      // exactly the population throughputDone/measurable draw from (proxy is what F12 excludes).
      done_basis: { observed: done.filter((i) => i.done_basis === 'observed').length, 'derived-child': done.filter((i) => i.done_basis === 'derived-child').length, proxy: done.filter(proxyCompletion).length },
      sources: { created: src('created_source'), dispatched: src('start_source'), first_commit: src('first_commit_source'), done: src('done_source') } };
    if (done.length && level === 'task' && data.coverage[level].with_dispatched === 0) caveats.push(`${level}: no observed dispatch start — cycle_time absent, commit_to_done shown instead`);
  }
  const missions = all.filter((i) => i.level === 'mission' && i.sequence != null).sort((a, b) => a.sequence - b.sequence); const gaps = [];
  for (let k = 1; k < missions.length; k++) {
    const a = missions[k - 1], b = missions[k]; if (!b.started_at) continue;
    if (a.done_at && a.done_at <= b.started_at) { const g = secondsBetween(a.done_at, b.started_at); gaps.push(g); data.mission_turnaround.pairs.push({ from: a.ref, to: b.ref, gap_s: g, overlap_s: null }); }
    else data.mission_turnaround.pairs.push({ from: a.ref, to: b.ref, gap_s: null, overlap_s: a.done_at ? secondsBetween(b.started_at, a.done_at) : null });
  }
  data.mission_turnaround.stats = stats(gaps);
  return data;
}
