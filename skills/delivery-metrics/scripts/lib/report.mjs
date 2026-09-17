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
import { computeMetrics, toHours } from './metrics.mjs';
import { cliError, decodeSegment, deliveryDir, nowIso, plansDir, profilePath, resolveOwnerRepo, sha256 } from './paths.mjs';
import { buildTimelines, selectOccurrences } from './timeline.mjs';

export const SCHEMA = { report: 1, ledger: 2, adapters: { git: 1, hook: 1 } };
// F19: two more honesty labels the round-3 review asked for, alongside the eight from Global
// Constraint 12 — M1 has no mechanism for verifying a hook-reported producer's identity, and no
// history of *who* an item was ever associated with beyond its current state is retained.
export const UNCONDITIONAL_CAVEATS = [
  'acceptance: unauthenticated', 'writes: non-transactional', 'partial-update: possible', 'capture-loss: possible',
  'shared-files: last-writer-wins', 'sync: best-effort', 'concurrency: best-effort', 'hook-transcript-shapes: provisional until SPIKE-1',
  'producer-compatibility: unverified', 'association-history: not retained',
];
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
    try { const parsed = JSON.parse(buf.toString('utf8')); if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items) && parsed.run) rec = parsed; else malformed = true; }
    catch { malformed = true; }
    return { id, path, buf, rec, malformed };
  });
}

const DIAG_KINDS = ['unbound-session', 'unknown-role', 'no-transcript', 'incomplete-transcript', 'invalid-roster', 'malformed'];
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

const compact = (i, occ) => ({ first_completion: i.first_completion, current_scope: i.current_scope, item_id: i.item_id, ref: i.ref, level: i.level, class: i.class, state: i.state, created_at: i.created_at, started_at: i.started_at, start_basis: i.start_basis, first_commit_at: i.first_commit_at, done_at: i.done_at, done_basis: i.done_basis, landing_at: i.landing_at, cancelled_at: i.cancelled_at, dispatch_count: i.dispatch_count, rework_count: i.rework_count, reopened: i.reopened, estimate: i.estimate_original, flags: i.flags,
  // F18: evidence locators for the three clocks a compact row carries — never derived from anything
  // but the occurrence that produced the clock (see evidenceFor above).
  evidence: { created: evidenceFor(occ, i.item_id, 'created', i.created_at), started: i.start_basis === 'observed' ? evidenceFor(occ, i.item_id, 'dispatched', i.started_at, 'observed') : null, done: evidenceFor(occ, i.item_id, 'done', i.done_at) } });

export function assemble(repo, { plans = null, since = null, until = null, cutoff = null, now = Date.now(), estimateBase = 'original', filters = {} } = {}) {
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

  // F19: admitted-but-unattributed dispatches — a hook-captured `dispatched` with no resolvable
  // item_id (`meta.unattributed`). Counted globally (not per selected run): an unattributed dispatch
  // has, by construction, no item_id to belong to any one run's catalogue.
  const dispatches = occurrences.filter((o) => o.event === 'dispatched');
  const unattributedDispatches = dispatches.filter((o) => o.item_id === null && o.meta?.unattributed === true).length;
  const attributedDispatches = dispatches.length - unattributedDispatches;
  const unattributedShare = attributedDispatches + unattributedDispatches ? Math.round((unattributedDispatches / (attributedDispatches + unattributedDispatches)) * 10000) / 10000 : null;

  const cov = { deferred_events: 0, deferred_episodes: 0, invalid_chains: 0, parent_incomplete: 0, awaiting_landing: 0 }; let gaps = 0; const docs = [];
  for (const f of selected) {
    const r = f.rec;
    const occ = occurrences.filter((o) => o.plan === r.run && known.get(r.run).has(o.item_id));
    const { items, counts } = buildTimelines({ occurrences: occ, plan: r, end });
    cov.deferred_events += counts.deferredEvents; cov.deferred_episodes += counts.deferredEpisodes; cov.invalid_chains += counts.invalidChains; cov.parent_incomplete += counts.parentIncomplete; cov.awaiting_landing += counts.awaitingLanding;
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

    docs.push({ run: r.run, version: r.version, status: r.status, observations: occ.length, registration_gaps: g, metrics, counts, items: [...items.values()].map((i) => compact(i, occ)) });
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
  if (unattributedDispatches) derived.push(`${unattributedDispatches} admitted dispatch(es) unattributed (no item_id) — excluded from item timelines`);
  const sha = git(repo, ['rev-parse', 'HEAD']);
  const envelope = {
    schema: SCHEMA, generated_at: nowIso(now), cutoff: cutoffIso, window: { since: sinceIso, until: untilIso, effective_end: end, requested: { since, until, cutoff } },
    git: { sha, is_working_tree: sha ? Boolean(git(repo, ['status', '--porcelain'])) : null }, plans: runs.map((r) => r.run),
    sources: { events_files: res.files, plans: selected.map((f) => ({ run: f.rec.run, path: f.path, file_sha256: sha256(f.buf), canonical_sha256: f.rec.canonical_sha256 ?? null })), profile: { path: profilePath(repo), sha256: profileSha, source: profileSource }, tokenomics: 'absent' },
    policy: { weeks: 'UTC ISO', percentile: 'nearest-rank', floors: { median: 5, p85: 7, p90: 10 }, zeroDurationSec: profile.zeroDurationSec, minWholeWeeks: profile.minWholeWeeks, estimate_base: estimateBase, history: 'corrected-effective-time', durations: 'seconds; hours rounded at render', filters },
    coverage: { malformed_lines: res.counts.malformed, malformed: res.malformed, unknown_version: res.counts.unknownVersion, retries: res.counts.retries, superseded: res.counts.superseded, retracted: res.counts.retracted, ledger_conflicts: res.conflicts.length, occurrence_conflicts: conflicts.length, conflict_list: conflicts, unregistered, registration_gaps: gaps, malformed_runs: malformedRuns, diagnostics: readDiagnostics(repo), unattributed_dispatches: unattributedDispatches, unattributed_share: unattributedShare, ...cov },
    caveats: [...UNCONDITIONAL_CAVEATS, ...derived], baselines: profile.baselines ?? {},
  };
  return { envelope, plans: docs };
}

const h = (s) => (s == null ? '—' : `${toHours(s)}h`);
const statRow = (name, stratum, s) => (s ? `| ${name} | ${stratum} | n=${s.n} | ${s.median == null ? '— (n<5)' : h(s.median)} | ${s.p85 == null ? '— (n<7)' : h(s.p85)} | ${s.p90 == null ? '— (n<10)' : h(s.p90)} | ${h(s.min)}–${h(s.max)}${s.samples ? ` (${s.samples.map(h).join(', ')})` : ''} |` : null);
const pct = (r) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`);

export function renderMarkdown(doc) {
  const e = doc.envelope; const L = [];
  L.push('# Delivery report', '', `generated ${e.generated_at} · cutoff ${e.cutoff} · window [${e.window.since}, ${e.window.effective_end}) · sha ${e.git.sha ?? '—'}${e.git.is_working_tree ? ' (dirty)' : ''} · plans ${e.plans.join(', ')}${e.policy.filters?.level || e.policy.filters?.class ? ` · filters ${JSON.stringify(e.policy.filters)}` : ''}`, '');
  for (const p of doc.plans) {
    const m = p.metrics;
    L.push(`## Plan ${p.run} v${p.version} (${p.status}) — completed ${m.cohorts.completed}, created ${m.cohorts.created}, excluded items invalid-chain=${m.cohorts.excluded_items.invalid_chain} deferred-episode=${m.cohorts.excluded_items.deferred_episode}`, '');
    L.push('## Flow Time', '', '| metric | stratum | n | median | P85 | P90 | min–max |', '|---|---|---|---|---|---|---|');
    for (const [lv, f] of Object.entries(m.flow)) {
      // F17: every stratum metrics.mjs emitted (all + every class present, plus its own per-stratum
      // `quality`) is rendered — nothing is dropped by only reading a fixed set of class names.
      for (const [st, mm] of Object.entries(f.strata)) {
        for (const [name, s] of Object.entries(mm)) { if (name === 'quality') continue; const row = statRow(`${lv} ${name}`, st, s); if (row) L.push(row); }
        // F17: the stratum's own quality denominator sits immediately next to its speed rows, not
        // collapsed into one level-wide line — `strata.<class>.quality` is where metrics.mjs puts it.
        L.push(`| ${lv} quality | ${st} | quality: reviewed=${mm.quality.reviewed ?? 'unknown'} eligible=${mm.quality.eligible ?? 'unknown'} done=${mm.quality.done} | | | | |`);
      }
      if (!Object.keys(f.strata).length) L.push(`| ${lv} cycle_time | all | — (not measured) | | | | |`);
      const ex = Object.entries(f.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' '); if (ex) L.push(`| ${lv} excluded | | ${ex} | | | | |`);
    }
    L.push('', '## Throughput', '');
    for (const [lv, t] of Object.entries(m.throughput)) {
      L.push(`- ${lv} per UTC ISO week: ${t.weeks.map((w) => `${w.key}=${w.count}${!w.covered ? '†' : (!w.whole ? '*' : '')}`).join(' ')} (*partial, †before declared coverage)`);
      L.push(`- ${lv} velocity (median items per whole covered week): ${t.velocity ? `${t.velocity.median} (n=${t.velocity.whole_weeks} whole weeks)` : `— (${t.caveat.replace(/^velocity\([a-z]+\): /, '').replace(' — null', '')})`}`);
      L.push(`- ${lv} wip at end: ${m.wip[lv]}`);
    }
    if (m.mission_turnaround.pairs.length) L.push(`- mission_turnaround: ${m.mission_turnaround.pairs.map((x) => `${x.from}→${x.to} ${x.gap_s != null ? h(x.gap_s) : `overlap ${h(x.overlap_s)}`}`).join('; ')}`);
    L.push('', '## Quality', '');
    // F15: one figure, scoped to the creation cohort in [since, end) and to the same --level/--class
    // filters as the rest of the report — never the whole catalogue.
    const cs = m.quality.cancelled_share;
    L.push(`- cancelled_share: ${cs.denominator ? `${cs.numerator}/${cs.denominator} (${pct(cs.ratio)})` : '— (n=0 created in window)'}`);
    for (const lv of Object.keys(m.flow)) { const rows = p.items.filter((i) => i.level === lv); L.push(`- ${lv}: rework_proxy_items ${lv === 'task' ? m.rework_proxy_items : '—'}, deferred-episodes ${rows.filter((i) => i.reopened).length}, review rounds unknown (M2)`); }
    L.push('', '## Estimates', '', '| level | stratum | n | eligible | work_ratio median | MdMRE | PRED(25) | MAE | hit_rate | excluded |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [lv, es] of Object.entries(m.estimates)) for (const [st, x] of Object.entries(es.strata)) {
      const ex = Object.entries(x.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') || '—';
      L.push(`| ${lv} | ${st} | ${x.n} | ${x.eligible} | ${x.work_ratio ? (x.work_ratio.median ?? `— (n<5; ${x.work_ratio.samples.map((v) => Math.round(v * 100) / 100).join(', ')})`) : '—'} | ${x.mdmre ?? '—'} | ${x.pred25 ?? '—'} | ${x.mae_s == null ? '—' : h(x.mae_s)} | ${x.hit_rate.rate == null ? '—' : `${x.hit_rate.hits}/${x.hit_rate.ranged}`} | ${ex} |`);
    }
    if (m.estimate_rows.length) { L.push('', '| ref | level | class | tier | base | range (h) | actual | basis | ratio | hit | reason |', '|---|---|---|---|---|---|---|---|---|---|---|'); for (const r of m.estimate_rows) L.push(`| ${r.ref} | ${r.level} | ${r.class ?? '—'} | ${r.tier ?? '—'} | ${r.base} | ${r.estimate ? `[${r.estimate.low}, ${r.estimate.high}]` : '—'} | ${h(r.actual_s)} | ${r.actual_basis ?? '—'} | ${r.ratio ?? '—'} | ${r.hit == null ? '—' : r.hit ? 'yes' : 'no'} | ${r.reason ?? '—'} |`); }
    for (const sv of m.schedule_variance) L.push(`- schedule_variance ${sv.level} ${sv.ref}: actual ${h(sv.actual_s)} vs [${sv.estimate.low}, ${sv.estimate.high}] → [${toHours(sv.band.vs_high_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_high_s)}h, ${toHours(sv.band.vs_low_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_low_s)}h]; scope added ${sv.scope.added}, removed ${sv.scope.removed}`);
    L.push('', '## Coverage & caveats', '');
    // F17: coverage.sources (already present) plus coverage.done_basis — both read straight off
    // metrics.mjs's per-level coverage object, nothing invented here.
    for (const [lv, c] of Object.entries(m.coverage)) L.push(`- ${lv}: done ${c.done}, observed dispatch ${c.with_dispatched}, first commit ${c.with_first_commit}, created ${c.with_created}; start observed=${c.start_source.observed} derived-child=${c.start_source['derived-child']} none=${c.start_source.none}; done_basis observed=${c.done_basis.observed} derived-child=${c.done_basis['derived-child']} proxy=${c.done_basis.proxy}; sources ${JSON.stringify(c.sources)}`);
    L.push(`- registration_gaps=${p.registration_gaps}`);
    L.push('', '## Open items', '', '| ref | level | state | started | age |', '|---|---|---|---|---|');
    for (const i of p.items.filter((i) => i.state === 'in_progress')) L.push(`| ${i.ref} | ${i.level} | ${i.state}${i.flags.length ? ` (${i.flags.join(', ')})` : ''} | ${i.started_at ?? '—'} | ${i.first_completion && i.current_scope?.pending ? '— (pending-scope age unavailable in M1)' : i.started_at ? `${toHours((Date.parse(e.window.effective_end) - Date.parse(i.started_at)) / 1000)}h` : '— (no observed start)'} |`);
    L.push('');
  }
  L.push('### Envelope', '', `- ledger: unregistered=${e.coverage.unregistered} malformed-lines=${e.coverage.malformed_lines} ledger_conflicts=${e.coverage.ledger_conflicts} occurrence_conflicts=${e.coverage.occurrence_conflicts} retries=${e.coverage.retries} retracted=${e.coverage.retracted} deferred_events=${e.coverage.deferred_events} invalid_chains=${e.coverage.invalid_chains}`);
  for (const c of e.coverage.conflict_list) L.push(`  - conflict ${c.item_id ?? '—'} ${c.transition_id} (${c.reason}): ${c.sources.join(', ')}`);
  for (const mm of e.coverage.malformed) L.push(`  - malformed ${mm.path}:${mm.line} ${mm.reason}`);
  // F19: hook diagnostics (capture-loss visibility) and admitted-but-unattributed dispatches; F20:
  // registered run files that failed to parse.
  L.push(`- plans: malformed_runs=${e.coverage.malformed_runs}`);
  L.push(`- capture: unattributed_dispatches=${e.coverage.unattributed_dispatches} unattributed_share=${e.coverage.unattributed_share == null ? '—' : pct(e.coverage.unattributed_share)}`);
  L.push(`- diagnostics: ${DIAG_KINDS.map((k) => `${k}=${e.coverage.diagnostics[k]}`).join(' ')}`);
  L.push(`- baselines: ${Object.entries(e.baselines).map(([k, v]) => `${k}=${v ?? 'no baseline'}`).join(', ')}`);
  for (const c of e.caveats) L.push(`- caveat: ${c}`);
  L.push(`- policy: weeks ${e.policy.weeks}, percentiles ${e.policy.percentile} (floors median≥5 P85≥7 P90≥10), estimate base ${e.policy.estimate_base}, ${e.policy.durations}, tokenomics ${e.sources.tokenomics}, sources hashed as read`);
  return `${L.join('\n')}\n`;
}

export function renderStatus(doc) {
  const e = doc.envelope; const L = [];
  for (const p of doc.plans) {
    L.push(`STATUS ${p.run} v${p.version} (${p.status}) at ${e.window.effective_end}`);
    for (const lv of ['campaign', 'mission', 'task', 'case']) { const rows = p.items.filter((i) => i.level === lv); if (!rows.length) continue; const n = (s) => rows.filter((i) => i.state === s).length; L.push(`  ${lv}: done=${n('done')} in_progress=${n('in_progress')} planned=${n('planned')} cancelled=${n('cancelled')}`); }
    for (const i of p.items.filter((i) => i.first_completion && i.current_scope?.pending)) L.push(`  pending scope ${i.ref}: first_done=${i.first_completion.done_at}; current_done=unknown; pending-scope age unavailable (M1)`);
    for (const i of p.items.filter((i) => i.state === 'in_progress' && i.level !== 'campaign' && !i.first_completion)) L.push(`  open ${i.ref} (${i.level}${i.flags.length ? `, ${i.flags.join(', ')}` : ''}) started=${i.started_at ?? '—'} age=${i.started_at ? `${toHours((Date.parse(e.window.effective_end) - Date.parse(i.started_at)) / 1000)}h` : '—'}`);
    if (p.registration_gaps) L.push(`  registration_gaps=${p.registration_gaps} (items without a created observation)`);
    const fill = p.items.filter((i) => i.state === 'done' && i.level === 'task' && (!i.created_at || !i.first_commit_at)).length; if (fill) L.push(`  backfill --git could fill created/first_commit for ${fill} done task(s)`);
  }
  L.push(`  ledger: occurrence_conflicts=${e.coverage.occurrence_conflicts} ledger_conflicts=${e.coverage.ledger_conflicts} unregistered=${e.coverage.unregistered} malformed=${e.coverage.malformed_lines} malformed_runs=${e.coverage.malformed_runs}`);
  for (const c of UNCONDITIONAL_CAVEATS) L.push(`  caveat: ${c}`);
  return `${L.join('\n')}\n`;
}
