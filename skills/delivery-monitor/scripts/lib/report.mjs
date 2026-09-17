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
const compact = (i, occ) => ({ first_completion: i.first_completion, current_scope: i.current_scope, item_id: i.item_id, parent_item_id: i.parent_item_id ?? null, children: i.children ?? [], ref: i.ref, level: i.level, class: i.class, state: i.state, created_at: i.created_at, started_at: i.started_at, start_basis: i.start_basis, first_commit_at: i.first_commit_at, done_at: i.done_at, done_basis: i.done_basis, landing_at: i.landing_at, cancelled_at: i.cancelled_at, dispatch_count: i.dispatch_count, rework_count: i.rework_count, agent_span_s: i.agent_span_s ?? null, review_wait_s: i.review_wait_s ?? null, reopened: i.reopened, estimate: i.estimate_original, estimate_status: i.estimates?.length ? (i.estimate_original ? 'accepted' : 'unaccepted') : 'none', flags: i.flags,
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
h2 .sub{font-weight:400;font-size:.85rem;margin-left:.5rem}
.stat-sub{color:var(--text-muted);font-weight:400}
.panel-sub{margin:.15rem 0 .75rem;color:var(--text-muted);font-size:.84rem}
.row{display:grid;grid-template-columns:minmax(130px,210px) minmax(140px,1fr) minmax(220px,300px);gap:.7rem;align-items:center;margin:.32rem 0}
.row .lbl{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .track{background:var(--gridline);border-radius:4px;height:15px}
.row .bar{background:var(--series-1);height:15px;border-radius:4px}
.row .num{font-size:.84rem;font-variant-numeric:tabular-nums}
.sub{color:var(--text-muted)}
.oc{font-size:.72rem;border:1px solid var(--gridline);border-radius:8px;padding:0 .4rem;margin-left:.35rem;color:var(--text-muted);display:inline-block}
.oc-done{color:var(--ok);border-color:var(--ok)}.oc-cancelled{color:var(--warn);border-color:var(--warn)}
svg.trend{width:100%;height:auto;display:block;margin:.3rem 0 .2rem}
.trend .grid{stroke:var(--gridline);stroke-width:1}
.trend .ref{stroke:var(--text-muted);stroke-width:1.5;stroke-dasharray:4 3}
.trend .roll{fill:none;stroke:var(--series-1);stroke-width:2;stroke-linejoin:round}
.trend .pt{fill:var(--series-1);stroke:var(--surface);stroke-width:2}
.trend .pt.rework{fill:var(--warn)}
.trend text{font:11px -apple-system,"Segoe UI",sans-serif;fill:var(--text-muted)}
.trend text.lbl{fill:var(--text-primary);font-weight:600}
.legend-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--series-1);vertical-align:middle;margin-right:.4rem}
.legend-dot.rework{background:var(--warn)}
.legend{display:flex;gap:1.2rem;flex-wrap:wrap;font-size:.82rem;color:var(--text-secondary)}
.legend-swatch{display:inline-block;width:18px;height:0;border-top:2px solid var(--series-1);vertical-align:middle;margin-right:.4rem}
.legend-swatch.scope{border-top:2px dashed var(--text-muted)}
@media(max-width:640px){.row{grid-template-columns:110px 1fr}.row .num{grid-column:1/-1}}
`;
const statCell = (label, value) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
const kpiCard = (title, cells, callout) => `<div class="kpi-card"><h3>${title}</h3><div class="kpi-grid">${cells.join('')}</div>${callout ? `<div class="kpi-callout">${callout}</div>` : ''}</div>`;

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
          const row = statRow(`${lv} ${name}${label}`, st, s); if (row) L.push(row);
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
    L.push('', '## Estimates', '', '| level | stratum | n | eligible | work_ratio median | MdMRE | PRED(25) | MAE | hit_rate | excluded |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [lv, es] of Object.entries(m.estimates)) for (const [st, x] of Object.entries(es.strata)) {
      const ex = excludedStr(x.excluded) || '—';
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
const fmtRangeH = (est) => (est ? `${fmtDur(est.low * 3600)}–${fmtDur(est.high * 3600)}` : '—');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtTs = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? escHtml(iso) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`; };
const elapsedS = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null);
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
// "12:52 → 12:53 UTC" when both clocks fall on the same UTC day, full stamps otherwise.
const fmtSpan = (a, b) => { if (!a || !b) return null; const da = new Date(a), db = new Date(b); if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null; return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10) ? `${da.getUTCDate()} ${MONTHS[da.getUTCMonth()]} ${hhmm(da)} → ${hhmm(db)} UTC` : `${fmtTs(a)} → ${fmtTs(b)}`; };
const pctOf = (ratio) => (ratio == null ? '—' : `${Math.round(ratio * 100)}%`);
const projectOf = (e) => { const f = e.sources?.events_files?.[0]?.path ?? e.sources?.plan_files?.[0]?.path ?? ''; const m = /([^/]+)\/\.agents\//.exec(f); return m ? m[1] : null; };
const needs = (n, floor) => `needs ≥${floor} <span class="stat-sub">(have ${n})</span>`;
const spreadLine = (s) => (s ? `median ${s.median == null ? `— (needs ≥5, have ${s.n})` : fmtDur(s.median)} · min ${fmtDur(s.min)} · max ${fmtDur(s.max)}${s.samples ? ` · samples ${s.samples.map(fmtDur).join(', ')}` : ''}` : 'not measured');
const verdictOf = (r) => {
  if (!r) return null;
  if (r.reason) return { text: { unaccepted: 'estimate not accepted', unestimated: 'no estimate', missing_actual: 'no actual yet', zero_midpoint: 'zero-width estimate', unit_mismatch: 'unit mismatch', excluded_item: 'excluded item', no_eligible_latest: 'no eligible latest estimate' }[r.reason] ?? r.reason, cls: '' };
  if (r.hit === true) return { text: 'within range', cls: 'oc-done' };
  if (r.hit === false) return { text: r.ratio != null && r.ratio < 1 ? 'below range' : 'above range', cls: 'oc-cancelled' };
  return null;
};
const bandText = (sv) => {
  if (!sv) return null;
  if (sv.band.vs_low_s < 0) return `${fmtDur(-sv.band.vs_low_s)} under the low bound`;
  if (sv.band.vs_high_s > 0) return `${fmtDur(sv.band.vs_high_s)} over the high bound`;
  return 'within the estimate';
};
const stateChip = (state) => `<span class="oc oc-${escHtml(state)}">${escHtml(state.replace('_', ' '))}</span>`;

// "Are we getting faster?" — one dot per merged task in completion order (y = observed cycle time),
// a rolling median through them and the overall median as a dashed reference. Inline SVG, no
// assets; native <title> tooltips. The y unit is picked from the largest value so the axis reads.
const unitFor = (maxS) => (maxS < 120 ? ['s', 1] : maxS < 7200 ? ['min', 60] : maxS < 172800 ? ['h', 3600] : ['d', 86400]);
const rollingMedian = (vals, w = 5) => vals.map((_, i) => { if (i + 1 < w) return null; const win = [...vals.slice(i + 1 - w, i + 1)].sort((a, b) => a - b); return win[Math.floor((w - 1) / 2)]; });
const trendSvg = (trend) => {
  const pts = trend?.series ?? []; if (pts.length < 2) return '';
  const W = 640, H = 170, L = 40, R = 84, T = 14, B = 24, pw = W - L - R, ph = H - T - B;
  const maxS = Math.max(...pts.map((p) => p.cycle_s)), [unit, div] = unitFor(maxS);
  const yMax = Math.max(maxS / div, 1e-9);
  const X = (i) => L + (pts.length === 1 ? pw / 2 : (i / (pts.length - 1)) * pw), Y = (v) => T + ph - (v / yMax) * ph;
  const sorted = [...pts.map((p) => p.cycle_s)].sort((a, b) => a - b); const overall = pts.length >= 5 ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
  const roll = rollingMedian(pts.map((p) => p.cycle_s));
  const rollPath = roll.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v / div).toFixed(1)}`)).filter(Boolean);
  const fmtV = (v) => `${Math.round((v / div) * 10) / 10} ${unit}`;
  const gridV = [0, yMax / 2, yMax];
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cycle time per merged task in completion order">
${gridV.map((v) => `<line class="grid" x1="${L}" x2="${L + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v * 10) / 10}</text>`).join('')}
<text x="${L - 6}" y="${T - 4}" text-anchor="end">${unit}</text>
${overall != null ? `<line class="ref" x1="${L}" x2="${L + pw}" y1="${Y(overall / div).toFixed(1)}" y2="${Y(overall / div).toFixed(1)}"/><text x="${L + pw + 6}" y="${(Y(overall / div) + 4).toFixed(1)}">median ${fmtV(overall)}</text>` : ''}
${rollPath.length >= 2 ? `<path class="roll" d="M${rollPath.join(' L')}"/><text class="lbl" x="${L + pw + 6}" y="${(Y(roll[roll.length - 1] / div) + (overall != null && Math.abs(Y(roll[roll.length - 1] / div) - Y(overall / div)) < 12 ? 16 : 4)).toFixed(1)}">rolling median</text>` : ''}
${pts.map((p, i) => `<circle class="pt${p.rework_count ? ' rework' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(p.cycle_s / div).toFixed(1)}" r="4.5"><title>${escHtml(p.ref)} · ${fmtV(p.cycle_s)}${p.rework_count ? ` · ${p.rework_count} fix round(s)` : ''} · merged ${escHtml(fmtTs(p.done_at))}</title></circle>`).join('')}
<text x="${L}" y="${H - 6}">first merged ${escHtml(fmtTs(pts[0].done_at))}</text><text x="${L + pw}" y="${H - 6}" text-anchor="end">last merged ${escHtml(fmtTs(pts[pts.length - 1].done_at))}</text>
</svg><div class="legend"><span><span class="legend-dot"></span>merged task (cycle time)</span><span><span class="legend-dot rework"></span>had a fix round</span><span><span class="legend-swatch"></span>rolling median (5 tasks)</span><span><span class="legend-swatch scope"></span>overall median</span></div>`;
};
const trendText = (t) => {
  if (!t) return null;
  if (t.ratio == null) return `needs ≥${t.floor} finished tasks <span class="stat-sub">(has ${t.n})</span>`;
  const pct = Math.round((t.ratio - 1) * 100);
  return `${pct > 0 ? '+' : ''}${pct}% <span class="stat-sub">${t.direction} — latest ${t.latest.n} vs earlier ${t.earlier.n}</span>`;
};

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
    const es = m.estimates.task?.strata?.all ?? null;
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
        statCell('Tasks done', `${doneTasks} / ${tasks.length - count(tasks, 'cancelled')}${count(tasks, 'cancelled') ? ` <span class="stat-sub">+${count(tasks, 'cancelled')} cancelled</span>` : ''}`),
        statCell('Missions done', `${count(missions, 'done')} / ${missions.length}`),
        statCell('In progress', `${count(tasks, 'in_progress')} <span class="stat-sub">tasks · ${m.wip.mission ?? count(missions, 'in_progress')} missions</span>`),
        statCell('Not started', `${count(tasks, 'planned')} <span class="stat-sub">tasks</span>`),
      ], `${doneTasks} task(s) and ${count(missions, 'done')} mission(s) completed${windowS != null ? ` in ${fmtDur(windowS)} of observed time` : ''}.${wholeWeeks >= e.policy.minWholeWeeks ? '' : ` Pace per week appears once the run spans ${e.policy.minWholeWeeks} whole ISO weeks (has ${wholeWeeks}).`}`),
      kpiCard('Cycle time <span class="stat-sub">dispatch → merge</span>', [
        statCell('Median', ct ? (ct.median == null ? needs(ct.n, 5) : fmtDur(ct.median)) : '— <span class="stat-sub">not measured</span>'),
        statCell('Range', ct ? `${fmtDur(ct.min)}–${fmtDur(ct.max)}` : '—'),
        statCell('Tasks measured', `${ct ? ct.n : 0} of ${doneTasks} done <span class="stat-sub">· ${count(tasks, 'in_progress')} still open</span>`),
        statCell('Trend <span class="stat-sub">latest half vs earlier</span>', trendText(m.flow.task?.trend) ?? '—'),
      ], `Cycle time runs from the first observed dispatch to the merge. Trend compares the median of the latest half of finished tasks with the earlier half — a changing mix of task sizes can move it, so read it with the class column below. Medians need ≥5 tasks per side.${!ct && excludedStr(m.flow.task?.excluded ?? {}) ? ` Not measured: ${esc(excludedStr(m.flow.task.excluded))}.` : ''}`),
      ...(wholeWeeks >= e.policy.minWholeWeeks ? [kpiCard('Pace <span class="stat-sub">per UTC ISO week</span>', [
        statCell('Velocity', velTxt),
        statCell('Tasks per week', weeksTxt('task')),
        statCell('Missions per week', weeksTxt('mission')),
        statCell('Whole weeks observed', `${wholeWeeks}`),
      ], 'Completions per Monday–Sunday week. Velocity is the median over whole weeks inside the observed window — a partial week is shown but never extrapolated.')] : []),
      kpiCard('Quality & review', [
        statCell('Fix rounds <span class="stat-sub">before merge</span>', doneTasks ? `${m.rework_proxy_items} of ${doneTasks} <span class="stat-sub">tasks (${Math.round((m.rework_proxy_items / doneTasks) * 100)}%)</span>` : '—'),
        statCell('Review turnaround <span class="stat-sub">agent done → merged</span>', rw ? (rw.median == null ? `${fmtDur(rw.min)}–${fmtDur(rw.max)} <span class="stat-sub">(n=${rw.n})</span>` : fmtDur(rw.median)) : '— <span class="stat-sub">no hook capture</span>'),
        statCell('Agent time <span class="stat-sub">per task</span>', ag ? (ag.median == null ? `${fmtDur(ag.min)}–${fmtDur(ag.max)} <span class="stat-sub">(n=${ag.n})</span>` : fmtDur(ag.median)) : '—'),
        statCell('Cancelled', `${count(tasks, 'cancelled')} <span class="stat-sub">of ${tasks.length} tasks</span>`),
      ], 'A fix round is a task sent back after review before it merged (a defect caught in implementation). Review turnaround is the time from the agent finishing to the merge — the human part of the cycle; agent time is the sum of its dispatch spans.'),
      kpiCard('Estimates <span class="stat-sub">vs accepted ranges</span>', es ? [
        statCell('Within range', es.hit_rate.rate == null ? '—' : `${es.hit_rate.hits} of ${es.hit_rate.ranged}`),
        statCell('Work vs estimate', es.work_ratio ? (es.work_ratio.median == null ? `${pctOf(es.work_ratio.min)}–${pctOf(es.work_ratio.max)} <span class="stat-sub">of estimated time (${es.work_ratio.n} tasks; median from 5)</span>` : `${pctOf(es.work_ratio.median)} <span class="stat-sub">of estimated time (median)</span>`) : '—'),
        statCell('Typical error <span class="stat-sub">MdMRE</span>', es.mdmre == null ? '—' : `${Math.round(es.mdmre * 100)}%`),
        statCell('Counted', `${es.eligible} of ${es.n}${excludedStr(es.excluded) ? ` <span class="stat-sub">· ${Object.entries(es.excluded).filter(([, v]) => v).map(([k, v]) => `${v} ${esc(k.replace(/_/g, ' '))}`).join(', ')}</span>` : ' <span class="stat-sub">estimates</span>'}`),
      ] : [statCell('Estimates', '— <span class="stat-sub">none registered</span>')],
      'Only accepted estimates count; "within range" means the actual fell inside [low, high]; "work vs estimate" divides the actual by the midpoint of the range. Typical error = median of |estimate − actual| ÷ actual (MdMRE); PRED(25) and MAE are in the export.'),
    ].join('');
    parts.push(`<section class="kpi-row">${cards}</section>`);
    const trendChart = trendSvg(m.flow.task?.trend);
    if (trendChart) parts.push(`<section class="panel"><h2>Are we getting faster?</h2><p class="panel-sub">Each dot is a merged task in completion order; height is its cycle time. The line is the rolling median of the last five tasks — sloping down means faster, up means slower; a dot far above it is the task to ask about. Hover a dot for the task.</p>${trendChart}</section>`);

    // Per mission — elapsed from first child dispatch to landing, against the mission's own range.
    const missionElapsed = missions.map((g) => elapsedS(g.started_at, g.landing_at ?? g.done_at));
    const maxMission = Math.max(1, ...missionElapsed.filter((c) => c != null));
    const missionRows = missions.map((g, idx) => {
      const cs = g.current_scope?.child_summary ?? { done: 0, cancelled: 0, open: 0, unknown: 0 };
      const inScope = cs.done + cs.open + cs.unknown;
      const el = missionElapsed[idx]; const sv = svRow.get(g.ref);
      const detail = [
        `${cs.done}/${inScope} tasks done${cs.open ? ` · ${cs.open} open` : ''}${cs.cancelled ? ` · ${cs.cancelled} cancelled` : ''}`,
        g.estimate ? `estimate ${fmtRangeH(g.estimate)}` : 'no estimate',
        sv ? `<span class="oc ${sv.band.vs_low_s < 0 || sv.band.vs_high_s > 0 ? 'oc-cancelled' : 'oc-done'}">${esc(bandText(sv))}</span>` : null,
        sv && (sv.scope.added || sv.scope.removed) ? `scope +${sv.scope.added}/−${sv.scope.removed}` : null,
        fmtSpan(g.started_at, g.landing_at ?? g.done_at),
      ].filter(Boolean).join(' · ');
      return `<div class="row"><div class="lbl" title="${esc(g.item_id)}">${esc(g.ref)}${stateChip(g.state)}</div><div class="track">${el != null ? `<div class="bar" style="width:${Math.max(1, (el / maxMission) * 100)}%"></div>` : ''}</div><div class="num">${el != null ? fmtDur(el) : '—'}<span class="sub"> · ${detail}</span></div></div>`;
    }).join('');
    const campaignLine = campaign ? `<p class="note">Campaign ${esc(campaign.ref)}: ${esc(campaign.state.replace('_', ' '))}${elapsedS(campaign.started_at, campaign.landing_at ?? campaign.done_at) != null ? `, ${fmtDur(elapsedS(campaign.started_at, campaign.landing_at ?? campaign.done_at))} from first dispatch to landing` : ''}${campaign.estimate ? ` · estimate ${fmtRangeH(campaign.estimate)}` : ''}${svRow.get(campaign.ref) ? ` · ${esc(bandText(svRow.get(campaign.ref)))}` : ''}.</p>` : '';
    parts.push(`<section class="panel"><h2>Per mission</h2><p class="panel-sub">Bar = elapsed from the first task dispatched to the mission landing; a mission's clock is derived from its tasks (it is never dispatched itself). Bars are scaled per panel.</p>${missionRows || '<p class="note">No missions in this plan.</p>'}${campaignLine}</section>`);

    // Per task — the tokenomics per-case idiom: label + state chip, bar = cycle time, number + muted detail.
    const cycles = tasks.map((t) => elapsedS(t.started_at, t.done_at));
    const maxCycle = Math.max(1, ...cycles.filter((c) => c != null));
    const taskRows = tasks.map((t, idx) => {
      const c = cycles[idx]; const r = estRow.get(t.item_id); const v = verdictOf(r);
      const detail = [
        t.class ? `class ${esc(t.class)}` : null,
        missionOf.has(t.item_id) ? `mission ${esc(missionOf.get(t.item_id))}` : null,
        t.estimate ? `estimate ${fmtRangeH(t.estimate)}` : (r?.reason ? null : (t.estimate_status === 'unaccepted' ? 'estimate not accepted' : 'no estimate')),
        v ? `<span class="oc ${v.cls}">${esc(v.text)}</span>` : null,
        t.rework_count ? `${t.rework_count} fix round${t.rework_count > 1 ? 's' : ''}` : null,
        t.review_wait_s != null ? `review ${fmtDur(t.review_wait_s)}` : null,
        t.start_basis && t.start_basis !== 'observed' ? `start ${esc(t.start_basis)}` : null,
        !t.started_at && t.state !== 'planned' ? 'no observed start' : null,
        fmtSpan(t.started_at, t.done_at),
      ].filter(Boolean).join(' · ');
      return `<div class="row"><div class="lbl" title="${esc(t.item_id)}">${esc(t.ref)}${stateChip(t.state)}</div><div class="track">${c != null ? `<div class="bar" style="width:${Math.max(1, (c / maxCycle) * 100)}%"></div>` : ''}</div><div class="num">${c != null ? fmtDur(c) : '—'}<span class="sub"> · ${detail}</span></div></div>`;
    }).join('');
    parts.push(`<section class="panel"><h2>Per task</h2><p class="panel-sub">Bar = cycle time from the first observed dispatch to the merge. Estimates are the accepted ranges from the plan; the verdict compares the actual with that range.</p>${taskRows || '<p class="note">No tasks in this plan.</p>'}</section>`);

    parts.push(`<section class="panel"><h2>Spread</h2><p>Task cycle time: ${spreadLine(ct)}<br>Task lead time (planned → merge): ${spreadLine(lt)}<br>Agent time: ${spreadLine(ag)}<br>Review turnaround: ${spreadLine(rw)}${m.mission_turnaround.pairs.length ? `<br>Mission turnaround: ${m.mission_turnaround.pairs.map((x) => `${esc(x.from)} → ${esc(x.to)} ${x.gap_s != null ? fmtDur(x.gap_s) : `overlap ${fmtDur(x.overlap_s)}`}`).join('; ')}` : ''}</p></section>`);

    const open = p.items.filter((i) => i.state === 'in_progress');
    if (open.length) parts.push(`<section class="panel"><h2>Open items</h2><p class="panel-sub">Age is measured to the report's cutoff (${fmtTs(e.window.effective_end)}).</p><table><tr><th>ref</th><th>level</th><th>state</th><th>started</th><th>open for</th></tr>${open.map((i) => `<tr><td>${esc(i.ref)}</td><td>${esc(i.level)}</td><td>${esc(i.state.replace('_', ' '))}${i.flags.length ? ` <span class="sub">(${esc(i.flags.join(', '))})</span>` : ''}</td><td>${i.started_at ? fmtTs(i.started_at) : '— <span class="sub">no observed start</span>'}</td><td>${i.first_completion && i.current_scope?.pending ? '— <span class="sub">pending-scope age unavailable in M1</span>' : (i.started_at ? fmtDur(elapsedS(i.started_at, e.window.effective_end)) : '—')}</td></tr>`).join('')}</table></section>`);

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
