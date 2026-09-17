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
    // Minor (e): a run file whose catalogue has a row with no item_id is unusable to every caller
    // that indexes items by item_id (known-set building, buildTimelines, evidence matching) — treat
    // it the same as any other malformed run file, not a run with a silently-incomplete catalogue.
    try { const parsed = JSON.parse(buf.toString('utf8')); if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items) && parsed.run && parsed.items.every((i) => i && typeof i === 'object' && i.item_id != null)) rec = parsed; else malformed = true; }
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

// F18 fix: for a task, `done_at` IS the occurrence's own `at` (reduceTimelineSnapshot sets
// `it.done_at = o.at` directly), so matching on `done_at` finds the right occurrence. For a
// non-task level with an explicit landing, `timeline.mjs` can bump `done_at` past the landing
// occurrence's own `at` (`it.done_at = [explicit?.at, lastTerminal, ...].sort().pop()` — a later
// child terminal wins) while `landing_at` stays pinned to the explicit occurrence's own `at`. So a
// landed parent must be matched on `landing_at`, not `done_at`, or the lookup silently misses a real
// landing occurrence whenever a child finished after it.
const doneEvidence = (occ, i) => (i.level === 'task' ? evidenceFor(occ, i.item_id, 'done', i.done_at) : (i.landing_at != null ? evidenceFor(occ, i.item_id, 'done', i.landing_at) : null));
const compact = (i, occ) => ({ first_completion: i.first_completion, current_scope: i.current_scope, item_id: i.item_id, ref: i.ref, level: i.level, class: i.class, state: i.state, created_at: i.created_at, started_at: i.started_at, start_basis: i.start_basis, first_commit_at: i.first_commit_at, done_at: i.done_at, done_basis: i.done_basis, landing_at: i.landing_at, cancelled_at: i.cancelled_at, dispatch_count: i.dispatch_count, rework_count: i.rework_count, reopened: i.reopened, estimate: i.estimate_original, flags: i.flags,
  // F18: evidence locators for the three clocks a compact row carries — never derived from anything
  // but the occurrence that produced the clock (see evidenceFor above).
  evidence: { created: evidenceFor(occ, i.item_id, 'created', i.created_at), started: i.start_basis === 'observed' ? evidenceFor(occ, i.item_id, 'dispatched', i.started_at, 'observed') : null, done: doneEvidence(occ, i) } });

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
    policy: { weeks: 'UTC ISO', percentile: 'nearest-rank', floors: { median: 5, p85: 7, p90: 10 }, zeroDurationSec: profile.zeroDurationSec, minWholeWeeks: profile.minWholeWeeks, estimate_base: estimateBase, history: 'corrected-effective-time', durations: 'seconds; hours rounded at render', filters,
      // Review fix (§6.10): named labels so a reader never mistakes a plan-tracked clock for a
      // true idea-to-done lead time, or a PR-open-to-merge clock for cycle time — time_to_merge
      // itself is not computed until M2 (PR-mode backfill), but the label travels with the policy
      // now so both metrics carry the same honest caveat wherever they're read.
      labels: { lead_time: 'plan-tracked, not idea-to-done', time_to_merge: 'PR open to merge — not lead time, not cycle time' } },
    coverage: { malformed_lines: res.counts.malformed, malformed: res.malformed, unknown_version: res.counts.unknownVersion, retries: res.counts.retries, superseded: res.counts.superseded, retracted: res.counts.retracted, ledger_conflicts: res.conflicts.length, occurrence_conflicts: conflicts.length, conflict_list: conflicts, unregistered, registration_gaps: gaps, malformed_runs: malformedRuns, diagnostics: readDiagnostics(repo), unattributed_dispatches: unattributedDispatches, unattributed_share: unattributedShare, ...cov },
    caveats: [...UNCONDITIONAL_CAVEATS, ...derived], baselines: profile.baselines ?? {},
  };
  return { envelope, plans: docs };
}

const h = (s) => (s == null ? '—' : `${toHours(s)}h`);
const statRow = (name, stratum, s) => (s ? `| ${name} | ${stratum} | n=${s.n} | ${s.median == null ? '— (n<5)' : h(s.median)} | ${s.p85 == null ? '— (n<7)' : h(s.p85)} | ${s.p90 == null ? '— (n<10)' : h(s.p90)} | ${h(s.min)}–${h(s.max)}${s.samples ? ` (${s.samples.map(h).join(', ')})` : ''} |` : null);
const pct = (r) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`);
// Minor (b): the "how long has this open item been open, as of the window's effective end" figure
// was duplicated at each open-items call-site — one shared helper.
const ageH = (end, started) => (started ? `${toHours((Date.parse(end) - Date.parse(started)) / 1000)}h` : null);

// html-report brief: self-contained HTML renderer, house style ported from tokenomics'
// team-report.mjs (escHtml/PAGE_CSS/statCell/kpiCard) — no external assets, no <script>, every
// dynamic string escaped. Trimmed to the panels/chip/table chrome this report actually uses; the
// token-composition bar/legend/share-cell classes tokenomics ships are dropped (unused here).
export const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const PAGE_CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--gridline:#e1e0d9;--border:rgba(11,11,11,0.10);--warn:#c53030;--ok:#2f855a}
html[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--text-primary:#fff;--text-secondary:#c3c2b7;--text-muted:#898781;--gridline:#2c2c2a;--border:rgba(255,255,255,0.10);--warn:#e06c6c;--ok:#48a06f}
*{box-sizing:border-box}
body{font:14px/1.5 -apple-system,"Segoe UI",sans-serif;color:var(--text-primary);background:var(--page);max-width:1120px;margin:0 auto;padding:1.8rem 1.2rem 3rem}
h1{font-size:1.35rem;margin:0 0 .2rem}
.meta{color:var(--text-muted);font-size:.85rem;margin:0 0 1.1rem}
section{margin-top:1.1rem}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:.8rem}
.kpi-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;min-width:0}
.kpi-card h3{margin:0 0 .55rem;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:600}
.kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem .7rem}
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
`;
const statCell = (label, value) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
const kpiCard = (title, cells, callout) => `<div class="kpi-card"><h3>${title}</h3><div class="kpi-grid">${cells.join('')}</div>${callout ? `<div class="kpi-callout">${callout}</div>` : ''}</div>`;

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
        for (const [name, s] of Object.entries(mm)) {
          if (name === 'quality') continue;
          // Review fix (§6.10/policy.labels): every lead_time row carries its honesty label inline
          // in Markdown, matching `envelope.policy.labels.lead_time` in the JSON export.
          const label = name === 'lead_time' ? ` (${e.policy.labels.lead_time})` : '';
          const row = statRow(`${lv} ${name}${label}`, st, s); if (row) L.push(row);
        }
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
    for (const i of p.items.filter((i) => i.state === 'in_progress')) L.push(`| ${i.ref} | ${i.level} | ${i.state}${i.flags.length ? ` (${i.flags.join(', ')})` : ''} | ${i.started_at ?? '—'} | ${i.first_completion && i.current_scope?.pending ? '— (pending-scope age unavailable in M1)' : ageH(e.window.effective_end, i.started_at) ?? '— (no observed start)'} |`);
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

// html-report brief §renderHtml(doc) contract: reproduces every figure/row renderMarkdown prints —
// same helpers (h/pct/ageH/toHours), same rounding — never a second source of truth for a number.
const flowRowsHtml = (m, e) => {
  const L = [];
  for (const [lv, f] of Object.entries(m.flow)) {
    for (const [st, mm] of Object.entries(f.strata)) {
      for (const [name, s] of Object.entries(mm)) {
        if (name === 'quality' || !s) continue;
        const label = name === 'lead_time' ? ` (${e.policy.labels.lead_time})` : '';
        L.push(`<tr><td>${escHtml(`${lv} ${name}${label}`)}</td><td>${escHtml(st)}</td><td>n=${s.n}</td><td>${s.median == null ? '— (n<5)' : h(s.median)}</td><td>${s.p85 == null ? '— (n<7)' : h(s.p85)}</td><td>${s.p90 == null ? '— (n<10)' : h(s.p90)}</td><td>${h(s.min)}–${h(s.max)}${s.samples ? ` (${s.samples.map(h).join(', ')})` : ''}</td></tr>`);
      }
      L.push(`<tr><td>${escHtml(`${lv} quality`)}</td><td>${escHtml(st)}</td><td colspan="5">quality: reviewed=${mm.quality.reviewed ?? 'unknown'} eligible=${mm.quality.eligible ?? 'unknown'} done=${mm.quality.done}</td></tr>`);
    }
    if (!Object.keys(f.strata).length) L.push(`<tr><td>${escHtml(`${lv} cycle_time`)}</td><td>all</td><td colspan="5">— (not measured)</td></tr>`);
    const ex = Object.entries(f.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
    if (ex) L.push(`<tr><td>${escHtml(`${lv} excluded`)}</td><td></td><td colspan="5">${escHtml(ex)}</td></tr>`);
  }
  return L.join('');
};
const throughputRowsHtml = (m) => {
  const L = [];
  for (const [lv, t] of Object.entries(m.throughput)) for (const w of t.weeks) {
    const mark = !w.covered ? '†' : (!w.whole ? '*' : '');
    L.push(`<tr><td>${escHtml(lv)}</td><td>${escHtml(w.key)}</td><td>${w.count}</td><td>${mark}</td></tr>`);
  }
  return L.join('');
};
const throughputLinesHtml = (m, e) => {
  const L = [];
  for (const [lv, t] of Object.entries(m.throughput)) {
    L.push(`<li>${escHtml(lv)} velocity (median items per whole covered week): ${t.velocity ? `${t.velocity.median} (n=${t.velocity.whole_weeks} whole weeks)` : `— (${t.weeks.filter((w) => w.whole).length} whole weeks < ${e.policy.minWholeWeeks})`}</li>`);
    L.push(`<li>${escHtml(lv)} wip at end: ${m.wip[lv]}</li>`);
  }
  if (m.mission_turnaround.pairs.length) L.push(`<li>mission_turnaround: ${escHtml(m.mission_turnaround.pairs.map((x) => `${x.from}→${x.to} ${x.gap_s != null ? h(x.gap_s) : `overlap ${h(x.overlap_s)}`}`).join('; '))}</li>`);
  return `<ul>${L.join('')}</ul>`;
};
const qualityLinesHtml = (m, p) => {
  const L = []; const cs = m.quality.cancelled_share;
  L.push(`<li>cancelled_share: ${cs.denominator ? `${cs.numerator}/${cs.denominator} (${pct(cs.ratio)})` : '— (n=0 created in window)'}</li>`);
  for (const lv of Object.keys(m.flow)) { const rows = p.items.filter((i) => i.level === lv); L.push(`<li>${escHtml(lv)}: rework_proxy_items ${lv === 'task' ? m.rework_proxy_items : '—'}, deferred-episodes ${rows.filter((i) => i.reopened).length}, review rounds unknown (M2)</li>`); }
  return `<ul>${L.join('')}</ul>`;
};
const estimatesStrataRowsHtml = (m) => {
  const L = [];
  for (const [lv, es] of Object.entries(m.estimates)) for (const [st, x] of Object.entries(es.strata)) {
    const ex = Object.entries(x.excluded).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') || '—';
    const wr = x.work_ratio ? (x.work_ratio.median ?? `— (n<5; ${x.work_ratio.samples.map((v) => Math.round(v * 100) / 100).join(', ')})`) : '—';
    L.push(`<tr><td>${escHtml(lv)}</td><td>${escHtml(st)}</td><td>${x.n}</td><td>${x.eligible}</td><td>${escHtml(String(wr))}</td><td>${x.mdmre ?? '—'}</td><td>${x.pred25 ?? '—'}</td><td>${x.mae_s == null ? '—' : h(x.mae_s)}</td><td>${x.hit_rate.rate == null ? '—' : `${x.hit_rate.hits}/${x.hit_rate.ranged}`}</td><td>${escHtml(ex)}</td></tr>`);
  }
  return L.join('');
};
const estimateRowsHtml = (m) => m.estimate_rows.map((r) => `<tr><td>${escHtml(r.ref)}</td><td>${escHtml(r.level)}</td><td>${escHtml(r.class ?? '—')}</td><td>${escHtml(r.tier ?? '—')}</td><td>${escHtml(r.base)}</td><td>${r.estimate ? `[${r.estimate.low}, ${r.estimate.high}]` : '—'}</td><td>${h(r.actual_s)}</td><td>${escHtml(r.actual_basis ?? '—')}</td><td>${r.ratio ?? '—'}</td><td>${r.hit == null ? '—' : r.hit ? 'yes' : 'no'}</td><td>${escHtml(r.reason ?? '—')}</td></tr>`).join('');
const scheduleVarianceHtml = (m) => m.schedule_variance.map((sv) => `<li>schedule_variance ${escHtml(sv.level)} ${escHtml(sv.ref)}: actual ${h(sv.actual_s)} vs [${sv.estimate.low}, ${sv.estimate.high}] → [${toHours(sv.band.vs_high_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_high_s)}h, ${toHours(sv.band.vs_low_s) >= 0 ? '+' : ''}${toHours(sv.band.vs_low_s)}h]; scope added ${sv.scope.added}, removed ${sv.scope.removed}</li>`).join('');
const coverageLinesHtml = (m, p) => {
  const L = [];
  for (const [lv, c] of Object.entries(m.coverage)) L.push(`<li>${escHtml(lv)}: done ${c.done}, observed dispatch ${c.with_dispatched}, first commit ${c.with_first_commit}, created ${c.with_created}; start observed=${c.start_source.observed} derived-child=${c.start_source['derived-child']} none=${c.start_source.none}; done_basis observed=${c.done_basis.observed} derived-child=${c.done_basis['derived-child']} proxy=${c.done_basis.proxy}; sources ${escHtml(JSON.stringify(c.sources))}</li>`);
  L.push(`<li>registration_gaps=${p.registration_gaps}</li>`);
  return `<ul>${L.join('')}</ul>`;
};
const openItemsRowsHtml = (p, e) => p.items.filter((i) => i.state === 'in_progress').map((i) => `<tr><td>${escHtml(i.ref)}</td><td>${escHtml(i.level)}</td><td>${escHtml(i.state)}${i.flags.length ? ` (${escHtml(i.flags.join(', '))})` : ''}</td><td>${escHtml(i.started_at ?? '—')}</td><td>${i.first_completion && i.current_scope?.pending ? '— (pending-scope age unavailable in M1)' : ageH(e.window.effective_end, i.started_at) ?? '— (no observed start)'}</td></tr>`).join('');
const envelopeHtml = (e) => {
  const conflictLis = e.coverage.conflict_list.map((c) => `<li>conflict ${escHtml(c.item_id ?? '—')} ${escHtml(c.transition_id)} (${escHtml(c.reason)}): ${escHtml(c.sources.join(', '))}</li>`).join('');
  const malformedLis = e.coverage.malformed.map((mm) => `<li>malformed ${escHtml(mm.path)}:${mm.line} ${escHtml(mm.reason)}</li>`).join('');
  const sub = conflictLis || malformedLis ? `<ul>${conflictLis}${malformedLis}</ul>` : '';
  return `<section class="panel"><h2>Envelope</h2><ul>` +
    `<li>ledger: unregistered=${e.coverage.unregistered} malformed-lines=${e.coverage.malformed_lines} ledger_conflicts=${e.coverage.ledger_conflicts} occurrence_conflicts=${e.coverage.occurrence_conflicts} retries=${e.coverage.retries} retracted=${e.coverage.retracted} deferred_events=${e.coverage.deferred_events} invalid_chains=${e.coverage.invalid_chains}${sub}</li>` +
    `<li>plans: malformed_runs=${e.coverage.malformed_runs}</li>` +
    `<li>capture: unattributed_dispatches=${e.coverage.unattributed_dispatches} unattributed_share=${e.coverage.unattributed_share == null ? '—' : pct(e.coverage.unattributed_share)}</li>` +
    `<li>diagnostics: ${escHtml(DIAG_KINDS.map((k) => `${k}=${e.coverage.diagnostics[k]}`).join(' '))}</li>` +
    `<li>baselines: ${escHtml(Object.entries(e.baselines).map(([k, v]) => `${k}=${v ?? 'no baseline'}`).join(', '))}</li>` +
    `<li>policy: weeks ${escHtml(e.policy.weeks)}, percentiles ${escHtml(e.policy.percentile)} (floors median≥5 P85≥7 P90≥10), estimate base ${escHtml(e.policy.estimate_base)}, ${escHtml(e.policy.durations)}, tokenomics ${escHtml(e.sources.tokenomics)}, sources hashed as read</li>` +
    `</ul></section>`;
};
const caveatsHtml = (e) => `<section class="callout-warn"><strong>Caveats</strong><ul>${e.caveats.map((c) => `<li>${escHtml(c)}</li>`).join('')}</ul></section>`;

export function renderHtml(doc) {
  const e = doc.envelope; const esc = escHtml;
  const metaFilters = e.policy.filters?.level || e.policy.filters?.class ? ` · filters ${esc(JSON.stringify(e.policy.filters))}` : '';
  const parts = [
    `<!doctype html><meta charset="utf-8"><title>Delivery report — ${esc(e.plans.join(', '))}</title><style>${PAGE_CSS}</style>`,
    '<h1>Delivery report</h1>',
    `<p class="meta">generated ${esc(e.generated_at)} · cutoff ${esc(e.cutoff)} · window [${esc(e.window.since)}, ${esc(e.window.effective_end)}) · sha ${esc(e.git.sha ?? '—')}${e.git.is_working_tree ? ' (dirty)' : ''} · plans ${esc(e.plans.join(', '))}${metaFilters}</p>`,
  ];
  for (const p of doc.plans) {
    const m = p.metrics;
    // KPI row (contract §2a): Progress / Task cycle time / Throughput / Estimates.
    const progressCells = LEVELS.filter((lv) => p.items.some((i) => i.level === lv)).map((lv) => {
      const rows = p.items.filter((i) => i.level === lv); const n = (st) => rows.filter((i) => i.state === st).length;
      return statCell(esc(lv), `done=${n('done')} in_progress=${n('in_progress')} planned=${n('planned')} cancelled=${n('cancelled')}`);
    });
    const ct = m.flow.task?.strata?.all?.cycle_time;
    const ctExcluded = Object.entries(m.flow.task?.excluded ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ');
    const cycleCells = ct
      ? [statCell('n', ct.n), statCell('median', ct.median == null ? '— (n<5)' : h(ct.median)), statCell('P85', ct.p85 == null ? '— (n<7)' : h(ct.p85)), statCell('min–max', `${h(ct.min)}–${h(ct.max)}`)]
      : [statCell('cycle_time', '— (not measured)')];
    const throughputCells = Object.entries(m.throughput).map(([lv, t]) => {
      const last = t.weeks[t.weeks.length - 1];
      const mark = last ? (!last.covered ? '†' : (!last.whole ? '*' : '')) : '';
      const lastTxt = last ? `${esc(last.key)}=${last.count}${mark}` : '—';
      const velTxt = t.velocity ? `${t.velocity.median} (n=${t.velocity.whole_weeks})` : `— (${t.weeks.filter((w) => w.whole).length} whole weeks < ${e.policy.minWholeWeeks})`;
      return statCell(esc(lv), `${lastTxt} · velocity ${velTxt} · wip ${m.wip[lv]}`);
    });
    const es = m.estimates.task?.strata?.all;
    const estimatesCells = es
      ? [statCell('hit_rate', es.hit_rate.rate == null ? '—' : `${es.hit_rate.hits}/${es.hit_rate.ranged}`), statCell('MdMRE', es.mdmre ?? '—'), statCell('PRED(25)', es.pred25 ?? '—'), statCell('MAE', es.mae_s == null ? '—' : h(es.mae_s)), statCell('n / eligible', `${es.n} / ${es.eligible}`)]
      : [statCell('estimates', '—')];
    const estimatesExcluded = es ? Object.entries(es.excluded).filter(([, v]) => v).map(([k, v]) => `<span class="chip">${esc(k)}=${v}</span>`).join('') : '';

    parts.push('<section class="plan">');
    parts.push(`<h2>Plan ${esc(p.run)} v${p.version} (${esc(p.status)})</h2>`);
    parts.push(`<section class="kpi-row">${kpiCard('Progress', progressCells)}${kpiCard('Task cycle time', cycleCells, !ct && ctExcluded ? esc(ctExcluded) : null)}${kpiCard('Throughput', throughputCells)}${kpiCard('Estimates', estimatesCells, estimatesExcluded || null)}</section>`);
    parts.push(`<section class="panel"><h2>Flow time</h2><table><tr><th>metric</th><th>stratum</th><th>n</th><th>median</th><th>P85</th><th>P90</th><th>min–max</th></tr>${flowRowsHtml(m, e)}</table></section>`);
    parts.push(`<section class="panel"><h2>Throughput</h2><table><tr><th>level</th><th>week</th><th>count</th><th>mark</th></tr>${throughputRowsHtml(m)}</table><p class="note">*partial, †before declared coverage</p>${throughputLinesHtml(m, e)}</section>`);
    parts.push(`<section class="panel"><h2>Quality</h2>${qualityLinesHtml(m, p)}</section>`);
    let estimatesPanel = `<section class="panel"><h2>Estimates</h2><table><tr><th>level</th><th>stratum</th><th>n</th><th>eligible</th><th>work_ratio median</th><th>MdMRE</th><th>PRED(25)</th><th>MAE</th><th>hit_rate</th><th>excluded</th></tr>${estimatesStrataRowsHtml(m)}</table>`;
    if (m.estimate_rows.length) estimatesPanel += `<table><tr><th>ref</th><th>level</th><th>class</th><th>tier</th><th>base</th><th>range (h)</th><th>actual</th><th>basis</th><th>ratio</th><th>hit</th><th>reason</th></tr>${estimateRowsHtml(m)}</table>`;
    if (m.schedule_variance.length) estimatesPanel += `<ul>${scheduleVarianceHtml(m)}</ul>`;
    parts.push(`${estimatesPanel}</section>`);
    parts.push(`<section class="panel"><h2>Coverage</h2>${coverageLinesHtml(m, p)}</section>`);
    parts.push(`<section class="panel"><h2>Open items</h2><table><tr><th>ref</th><th>level</th><th>state</th><th>started</th><th>age</th></tr>${openItemsRowsHtml(p, e)}</table></section>`);
    parts.push('</section>');
  }
  parts.push(envelopeHtml(e));
  parts.push(caveatsHtml(e));
  return parts.join('\n');
}

export function renderStatus(doc) {
  const e = doc.envelope; const L = [];
  for (const p of doc.plans) {
    L.push(`STATUS ${p.run} v${p.version} (${p.status}) at ${e.window.effective_end}`);
    for (const lv of ['campaign', 'mission', 'task', 'case']) { const rows = p.items.filter((i) => i.level === lv); if (!rows.length) continue; const n = (s) => rows.filter((i) => i.state === s).length; L.push(`  ${lv}: done=${n('done')} in_progress=${n('in_progress')} planned=${n('planned')} cancelled=${n('cancelled')}`); }
    for (const i of p.items.filter((i) => i.first_completion && i.current_scope?.pending)) L.push(`  pending scope ${i.ref}: first_done=${i.first_completion.done_at}; current_done=unknown; pending-scope age unavailable (M1)`);
    for (const i of p.items.filter((i) => i.state === 'in_progress' && i.level !== 'campaign' && !i.first_completion)) L.push(`  open ${i.ref} (${i.level}${i.flags.length ? `, ${i.flags.join(', ')}` : ''}) started=${i.started_at ?? '—'} age=${ageH(e.window.effective_end, i.started_at) ?? '—'}`);
    if (p.registration_gaps) L.push(`  registration_gaps=${p.registration_gaps} (items without a created observation)`);
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
