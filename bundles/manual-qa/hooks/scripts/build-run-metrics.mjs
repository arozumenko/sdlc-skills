#!/usr/bin/env node
// Assembles the final benchmark metrics JSON from:
//   1. Pre-run and post-run ccusage snapshots (session-level token diff)
//   2. tc-trace JSONL (per-TC sub-agent breakdown)
//   3. Latest RUN-*.md report in reports/ (for run_id, suite, result data)
//
// Usage (called by benchmark-stop hook):
//   node build-run-metrics.mjs <pre-file> <first_dispatch_at> <tc-trace> <sid> <post-file> [session_started_at] [transcript_path]
//
// Writes: reports/metrics/RUN-YYYY-MM-DD-NNN.json
//         Appends ## Timing Breakdown / ## ccusage Session Delta sections to
//         the RUN-*.md report
//
// session.tokens_coverage in the output is one of:
//   "full_session"           — pre/post ccusage entries matched by session id
//                               (sid/period); token+cost delta is scoped to
//                               THIS run only.
//   "full_session_unscoped"  — pre/post ccusage data exists but no matching
//                               session id was found; delta is summed across
//                               every Claude Code session on the machine, and
//                               cost falls back to an assumed-model estimate.
//                               Don't trust this mode for precise comparisons
//                               if other sessions may have run concurrently.
//   "subagents_only"         — no ccusage pre/post data at all; only sub-agent
//                               (tc-trace) token counts are available.
//
// NOTE: kept in sync by hand with the sibling copies at elitea-testing/scripts/
// and qa-challenges/scripts/ — same logic; only PROJECT_DIR derivation differs
// below, since this copy is installed to .claude/hooks/manual-qa/ by the
// bundle installer instead of staying at <project>/scripts/. Full feature
// parity (turns/subagent_dispatches/orchestrator_cost_pct/tokens_by_model/
// cache_read_share_pct/scopedModelsUsed/models_used) ported into this bundle
// copy 2026-07-31 — previously a leaner, older subset lived here (no
// countTurns(), no per-model/per-agent breakdown) while
// knowledge/metrics-format.md already documented the fuller schema; this
// port closes that doc/code gap.

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

// Project root: the benchmark-stop hook always runs with CLAUDE_PROJECT_DIR
// set; fall back to cwd otherwise. Deliberately NOT derived from this
// script's own location — it's installed under .claude/hooks/manual-qa/,
// not <project>/scripts/.
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const [,, preFile, firstDispatchAt, tcTraceFile, sid, postFile, sessionStartedAt, transcriptPath] = process.argv;

// --- Read inputs ---

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function readJsonFromFd(path) {
  // path may be a /dev/fd/N process substitution on bash, or a real file path
  return readJsonSafe(path);
}

// Counts model exchanges ("turns", per the tokenomics-dataset glossary: one
// request<->response exchange) from the Claude Code transcript JSONL that
// the Stop hook payload points to via `transcript_path`. Nothing else in
// this pipeline counts turns today — every other session/ccusage source is
// silent on it. Missing/unreadable transcript -> null, never fatal (hooks
// must not block Claude).
function countTurns(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    let turns = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'assistant') turns++;
      } catch { /* skip malformed transcript lines */ }
    }
    return turns || null;
  } catch {
    return null;
  }
}

const preCcusage = readJsonSafe(preFile);
const postCcusage = readJsonFromFd(postFile);

// Parse tc-trace JSONL — split into TC runners and support agents (reporter, etc.)
const tcTraces = [];
const supportTraces = [];
if (existsSync(tcTraceFile)) {
  const lines = readFileSync(tcTraceFile, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.tc_id) tcTraces.push(entry);
      else supportTraces.push(entry);
    } catch { /* skip malformed lines */ }
  }
}

// --- Pricing table ($/million tokens) — fallback only, used when we can't
// scope pricing to this session's own ccusage entry (see below).
//
// Keyed by PRICING FAMILY ('sonnet' | 'opus' | 'haiku'), not by exact model
// id. Real model ids (from ccusage / transcripts) are dated/versioned, e.g.
// 'claude-sonnet-4-5-20250929', and change on every model refresh — an
// exact-string key here would silently stop matching (that's exactly what
// happened before: the generic 'claude-sonnet-4-6' / 'claude-opus-4-8'
// labels this replaced never matched a real id either). Always look this
// table up via modelPricingFamily() below, never by raw model id. ---
const MODEL_PRICING = {
  sonnet: { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 },
  opus:   { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
  haiku:  { input: 0.80, output: 4.00, cache_write: 1.00, cache_read: 0.08 },
};

// Maps a real (dated/versioned) model id — or one of our own fallback
// literals below — to the pricing family it belongs to. Regex match, not
// exact-string: that's the whole point, it keeps matching as Anthropic
// ships new dated snapshots of the same family without a hand-edit here.
// Unrecognized/missing input defaults to 'sonnet' (this system's default
// main-agent tier) instead of throwing.
function modelPricingFamily(modelId) {
  if (/opus/i.test(modelId)) return 'opus';
  if (/haiku/i.test(modelId)) return 'haiku';
  return 'sonnet';
}

// Last-known-good literal model ids — used ONLY when ccusage gives us
// nothing at all to resolve a real id from (no scoped session match; see
// scopedModelsUsed below). These WILL go stale the next time Anthropic
// ships new default models — same as every other hand-maintained constant
// in this file (see header: kept in sync by hand across repos). Update by
// hand when that happens; nothing here is self-updating.
const FALLBACK_MAIN_AGENT_MODEL_ID = 'claude-sonnet-4-5-20250929';
const FALLBACK_SUPPORT_AGENT_MODEL_ID = 'claude-haiku-4-5-20251001';

function calcCost(pricing, inputTok, outputTok, cacheWriteTok, cacheReadTok) {
  return (
    inputTok      * pricing.input       +
    outputTok     * pricing.output      +
    cacheWriteTok * pricing.cache_write +
    cacheReadTok  * pricing.cache_read
  ) / 1_000_000;
}

// --- Session token & cost diff ---
//
// ccusage session --json returns { session: [{ agent, period, inputTokens,
//   outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens,
//   modelsUsed, modelBreakdowns: [{modelName, inputTokens, outputTokens,
//   cacheCreationTokens, cacheReadTokens, cost}], metadata }] }. `period` is
//   the Claude session UUID — the same id the hooks pass through as `sid`.
//
// Preferred path ("full_session"): find THIS session's own entry in the pre
// and post snapshots and diff just that one record. Accurate even if other
// Claude Code sessions run concurrently on the same machine, and it gives us
// the real model(s) used plus ccusage's own already-priced cost per model —
// no need to guess a single model for the whole run.
//
// Fallback path ("full_session_unscoped"): sid missing/unmatched (older
// ccusage without `period`, or the hook fired before ccusage indexed the
// session) — sum every session's totals like before and price with our own
// MODEL_PRICING table below, keyed off whatever `model` resolves to.

function sumCcusageField(obj, field) {
  if (!obj || typeof obj !== 'object') return 0;
  const entries = obj.session ?? obj.daily ?? [];
  if (!Array.isArray(entries)) return 0;
  return entries
    .filter(s => !s.agent || s.agent === 'claude')
    .reduce((acc, s) => acc + (typeof s[field] === 'number' ? s[field] : 0), 0);
}

function findSessionEntry(obj, sessionId) {
  if (!sessionId || !obj || typeof obj !== 'object') return null;
  const entries = obj.session ?? [];
  return Array.isArray(entries) ? (entries.find(s => s.period === sessionId) ?? null) : null;
}

function snapFromEntry(entry) {
  return {
    total_tokens:  entry.totalTokens ?? 0,
    input_tokens:  entry.inputTokens ?? 0,
    output_tokens: entry.outputTokens ?? 0,
    cache_create:  entry.cacheCreationTokens ?? 0,
    cache_read:    entry.cacheReadTokens ?? 0,
  };
}

// modelBreakdowns[] -> { modelName: {inputTokens, outputTokens, ..., cost} }
function breakdownsByModel(entry) {
  const out = {};
  for (const b of entry?.modelBreakdowns ?? []) {
    if (b?.modelName) out[b.modelName] = b;
  }
  return out;
}

function sumModelCost(byModelMap) {
  return Object.values(byModelMap).reduce((s, b) => s + (b.cost ?? 0), 0);
}

const session = {};
let tokensCoverage = 'subagents_only';
let ccusageBlock = null;
let costBlock = null;   // populated here for the scoped path; unscoped path fills it in later, once `model` is resolved
let scopedModel = null; // model(s) ccusage says actually ran this session, if we got a scoped match (joined string, back-compat)
let scopedModelsUsed = null; // same, as an actual array (tokenomics-dataset `models_used`)

const preHasData = Object.keys(preCcusage).length > 0 && (preCcusage.session ?? preCcusage.daily);
const postHasData = Object.keys(postCcusage).length > 0 && (postCcusage.session ?? postCcusage.daily);

if (preHasData && postHasData) {
  const preEntry = findSessionEntry(preCcusage, sid);
  const postEntry = findSessionEntry(postCcusage, sid);
  const scoped = Boolean(preEntry && postEntry);
  tokensCoverage = scoped ? 'full_session' : 'full_session_unscoped';

  const preSnap = scoped ? snapFromEntry(preEntry) : {
    total_tokens:  sumCcusageField(preCcusage, 'totalTokens'),
    input_tokens:  sumCcusageField(preCcusage, 'inputTokens'),
    output_tokens: sumCcusageField(preCcusage, 'outputTokens'),
    cache_create:  sumCcusageField(preCcusage, 'cacheCreationTokens'),
    cache_read:    sumCcusageField(preCcusage, 'cacheReadTokens'),
  };
  const postSnap = scoped ? snapFromEntry(postEntry) : {
    total_tokens:  sumCcusageField(postCcusage, 'totalTokens'),
    input_tokens:  sumCcusageField(postCcusage, 'inputTokens'),
    output_tokens: sumCcusageField(postCcusage, 'outputTokens'),
    cache_create:  sumCcusageField(postCcusage, 'cacheCreationTokens'),
    cache_read:    sumCcusageField(postCcusage, 'cacheReadTokens'),
  };
  const delta = {
    total_tokens:  Math.max(0, postSnap.total_tokens  - preSnap.total_tokens),
    input_tokens:  Math.max(0, postSnap.input_tokens  - preSnap.input_tokens),
    output_tokens: Math.max(0, postSnap.output_tokens - preSnap.output_tokens),
    cache_create:  Math.max(0, postSnap.cache_create  - preSnap.cache_create),
    cache_read:    Math.max(0, postSnap.cache_read    - preSnap.cache_read),
  };

  // Keep flat fields for backwards compat
  session.tokens_coverage = tokensCoverage;
  session.total_tokens = delta.total_tokens;
  session.input_tokens = delta.input_tokens;
  session.output_tokens = delta.output_tokens;
  session.cache_creation_input_tokens = delta.cache_create;
  session.cache_read_input_tokens = delta.cache_read;

  // Structured ccusage block with pre/post/delta
  ccusageBlock = { pre: preSnap, post: postSnap, delta };

  if (scoped) {
    // Real model(s) used, straight from ccusage — may be more than one if
    // the session mixed models (e.g. a Haiku sub-agent alongside Sonnet).
    if (postEntry.modelsUsed?.length) {
      scopedModel = postEntry.modelsUsed.join('+');
      scopedModelsUsed = postEntry.modelsUsed;
    }

    // Cost from ccusage's own already-priced per-model breakdown — correct
    // even for mixed-model sessions or offline cached pricing, so we don't
    // need our own MODEL_PRICING table on this path.
    const preByModel = breakdownsByModel(preEntry);
    const postByModel = breakdownsByModel(postEntry);
    const costPre = sumModelCost(preByModel);
    const costPost = sumModelCost(postByModel);
    costBlock = {
      cost_usd_pre:   Math.round(costPre * 100) / 100,
      cost_usd_post:  Math.round(costPost * 100) / 100,
      cost_usd_delta: Math.round(Math.max(0, costPost - costPre) * 100) / 100,
    };
  }
  // Unscoped-path cost is computed further down (see "Cost calculation"),
  // once `model` is fully resolved from the report / hardcoded default.
} else {
  session.tokens_coverage = tokensCoverage;
  session.total_tokens = null;
  session.input_tokens = null;
  session.output_tokens = null;
  session.cache_creation_input_tokens = null;
  session.cache_read_input_tokens = null;
}

const endMs = Date.now();
// Tracked window: first sub-agent dispatch → Stop hook
const firstDispatchMs = firstDispatchAt ? new Date(firstDispatchAt).getTime() : null;
session.duration_ms = firstDispatchMs ? endMs - firstDispatchMs : null;
// Full-session timing — available only when benchmark-session-start hook is wired
const sessionStartMs = sessionStartedAt ? new Date(sessionStartedAt).getTime() : null;
session.pre_flight_duration_ms = (sessionStartMs && firstDispatchMs)
  ? Math.max(0, firstDispatchMs - sessionStartMs)
  : null;
session.total_session_duration_ms = sessionStartMs ? endMs - sessionStartMs : null;
session.total_tool_uses = tcTraces.reduce((sum, t) => sum + (t.tool_uses ?? 0), 0) || null;
session.turns = countTurns(transcriptPath);

// Support-agent aggregates (reporter, etc.)
const supportTokens = supportTraces.reduce((s, t) => s + (t.total_tokens ?? 0), 0);
const supportToolUses = supportTraces.reduce((s, t) => s + (t.tool_uses ?? 0), 0);
const supportDurationMs = supportTraces.reduce((s, t) => s + (t.duration_ms ?? 0), 0);
session.support_agent_tokens = supportTokens || null;
session.support_agent_tool_uses = supportToolUses || null;
session.support_agent_duration_ms = supportDurationMs || null;

// Count of subagent/sub-task dispatches this session (tokenomics-dataset
// field: `subagent_dispatches`) — every Agent-tool call this session made,
// TC runners plus support agents (reporter, etc.) alike. Already implicit
// in the trace file; just never surfaced as its own field before.
session.subagent_dispatches = tcTraces.length + supportTraces.length;

// Orchestrator overhead = total minus TC runners minus support agents
const tcTokens = tcTraces.reduce((s, t) => s + (t.total_tokens ?? 0), 0);
session.orchestrator_tokens = session.total_tokens != null
  ? Math.max(0, session.total_tokens - tcTokens - supportTokens)
  : null;

// Token-based proxy for the tokenomics-dataset field `orchestrator_cost_pct`
// (share of cost on the main thread vs subagents). We don't have a true
// per-dispatch cost split, so this approximates via token share instead —
// close enough here since the orchestrator and TC-runner subagents run the
// same model (sonnet); documented as a proxy, not a real cost split.
session.orchestrator_cost_pct = (session.orchestrator_tokens != null && session.total_tokens)
  ? Math.round((session.orchestrator_tokens / session.total_tokens) * 1000) / 10
  : null;

const tcDurationMs = tcTraces.reduce((s, t) => s + (t.duration_ms ?? 0), 0);
session.tc_total_duration_ms = tcDurationMs || null;
session.orchestrator_duration_ms = session.duration_ms != null
  ? Math.max(0, session.duration_ms - tcDurationMs - supportDurationMs)
  : null;

// Effective tokens: direct (input+output) + cache writes + cache reads
session.total_effective_tokens = (session.total_tokens ?? 0)
  + (session.cache_creation_input_tokens ?? 0)
  + (session.cache_read_input_tokens ?? 0)
  + supportTokens
  || null;

// --- Per-agent token/tool/duration breakdown ---
//
// Every dispatch's REAL agent persona (tool_input.subagent_type, tagged by
// benchmark-tc-hook.mjs as `agent_type` — confirmed present on the
// PostToolUse payload, unlike a real model id) is now known directly, so we
// no longer have to lump every non-test-runner dispatch into one generic
// "support" bucket. Groups ALL dispatched agents (test-runner per TC,
// test-sizer, test-author, app-profiler, test-reporter, ...) by their real
// name.
//
// test-run-lead itself never appears as a dispatch here — it IS the main
// thread, never invoked via the Agent tool, so it has no trace line of its
// own. Its tokens (and, since 2026-07-22, its per-type split — see
// sumField()/haveTypeTotals below) are added back in as computed remainders:
// session total minus every known dispatch's share — an approximation, not a
// direct measurement. Its dispatch count / tool_uses stay null: there's
// nothing to sum those two from (test-run-lead has no trace line to begin
// with, unlike the token counts which come from the session-level ccusage
// snapshot instead).
function aggregateByAgentType(traces) {
  const byType = {};
  for (const t of traces) {
    // Back-compat: trace lines written before agent_type existed — fall
    // back to the same test-runner/support guess the rest of this file
    // already makes from tc_id presence.
    const type = t.agent_type ?? (t.tc_id ? 'test-runner' : 'support');
    if (!byType[type]) {
      byType[type] = {
        dispatches: 0, tokens: 0, input_tokens: 0, output_tokens: 0,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
        tool_uses: 0, duration_ms: 0,
      };
    }
    const b = byType[type];
    b.dispatches += 1;
    b.tokens += t.total_tokens ?? 0;
    b.input_tokens += t.input_tokens ?? 0;
    b.output_tokens += t.output_tokens ?? 0;
    b.cache_creation_input_tokens += t.cache_creation_input_tokens ?? 0;
    b.cache_read_input_tokens += t.cache_read_input_tokens ?? 0;
    b.tool_uses += t.tool_uses ?? 0;
    b.duration_ms += t.duration_ms ?? 0;
  }
  return byType;
}

const tokensByAgent = aggregateByAgentType([...tcTraces, ...supportTraces]);

// Sum one token-type field across every real dispatch bucket above — used
// below to give test-run-lead its own per-type split via the same
// total-minus-dispatches remainder logic already used for orchestrator_tokens
// itself, just applied per token type instead of to their sum.
function sumField(byAgent, field) {
  return Object.values(byAgent).reduce((s, b) => s + (b[field] ?? 0), 0);
}

if (session.orchestrator_tokens != null) {
  // Same coverage gate session.total_tokens/orchestrator_tokens already use
  // (session.input_tokens is null under `subagents_only` coverage, where
  // there's no session-level type split to subtract from at all).
  const haveTypeTotals = session.input_tokens != null;
  tokensByAgent['test-run-lead'] = {
    dispatches: null,
    tokens: session.orchestrator_tokens,
    // Per-type remainder (session total for this type minus every known
    // dispatch's share of it) — NOT a direct measurement, same caveat as
    // orchestrator_tokens above, but now broken out by type instead of left
    // null, so cache-heavy composition (usually the bulk of this number) is
    // visible rather than hidden behind one opaque total.
    input_tokens: haveTypeTotals ? Math.max(0, session.input_tokens - sumField(tokensByAgent, 'input_tokens')) : null,
    output_tokens: haveTypeTotals ? Math.max(0, session.output_tokens - sumField(tokensByAgent, 'output_tokens')) : null,
    cache_creation_input_tokens: haveTypeTotals ? Math.max(0, session.cache_creation_input_tokens - sumField(tokensByAgent, 'cache_creation_input_tokens')) : null,
    cache_read_input_tokens: haveTypeTotals ? Math.max(0, session.cache_read_input_tokens - sumField(tokensByAgent, 'cache_read_input_tokens')) : null,
    tool_uses: null,
    duration_ms: session.orchestrator_duration_ms ?? null,
  };
}
session.tokens_by_agent = Object.keys(tokensByAgent).length ? tokensByAgent : null;

// --- Per-model token breakdown (tokenomics-dataset `tokens_by_model` /
// `cache_read_share_pct`) ---
//
// This system's agents are not single-model: test-reporter runs on haiku,
// every other manual-qa agent (test-run-lead, test-runner, test-sizer,
// test-author, app-profiler) runs on sonnet — see each agent's AGENT.md
// frontmatter `model:` field. benchmark-tc-hook.mjs already tags every
// dispatch's trace line with role: 'test-runner' | 'support', and 'support'
// IS the haiku reporter, so we regroup the trace's own per-type token
// counts (already recorded per dispatch) by role into a per-model
// breakdown — no new instrumentation needed.
//
// The KEYS of that breakdown must be real model ids so they line up with
// `primary_model` / `models_used` downstream (build-tokenomics-report.mjs
// derives primary_model from this map's own keys — see its comment). We
// can't get a real id per dispatch: PostToolUse's Agent tool_response has
// no model/modelUsed field (confirmed against Claude Code's hook docs), so
// benchmark-tc-hook.mjs cannot be made to tag traces with one. Instead we
// take ccusage's own scoped modelsUsed[] for the WHOLE session
// (scopedModelsUsed, resolved above) and assign its haiku-looking entry to
// the support/reporter bucket and its other entry to the main
// orchestrator+runner bucket. Only fall back to a literal last-known-good id
// when ccusage gave us no scoped match at all (full_session_unscoped /
// subagents_only paths).
function resolveAgentModelIds(modelsUsed) {
  if (!modelsUsed?.length) {
    return { main: FALLBACK_MAIN_AGENT_MODEL_ID, support: FALLBACK_SUPPORT_AGENT_MODEL_ID };
  }
  const haikuId = modelsUsed.find(m => /haiku/i.test(m));
  // Single-model session (only test-runner dispatched, no reporter ran; or
  // ccusage only ever reports one entry): pick the first non-haiku id, or
  // just modelsUsed[0] if every entry happens to look like haiku.
  const mainId = modelsUsed.find(m => !/haiku/i.test(m)) ?? modelsUsed[0];
  return { main: mainId, support: haikuId ?? FALLBACK_SUPPORT_AGENT_MODEL_ID };
}

function sumTraceField(traces, field) {
  return traces.reduce((s, t) => s + (t[field] ?? 0), 0);
}

let tokensByModel = null;
if (session.total_tokens != null) {
  const { main: mainModelId, support: supportModelId } = resolveAgentModelIds(scopedModelsUsed);

  const supportByType = {
    input:        sumTraceField(supportTraces, 'input_tokens'),
    output:       sumTraceField(supportTraces, 'output_tokens'),
    cache_create: sumTraceField(supportTraces, 'cache_creation_input_tokens'),
    cache_read:   sumTraceField(supportTraces, 'cache_read_input_tokens'),
  };
  // Everything not attributed to the haiku reporter — orchestrator + TC-runner
  // subagents — is the main model.
  const mainByType = {
    input:        Math.max(0, (session.input_tokens ?? 0) - supportByType.input),
    output:       Math.max(0, (session.output_tokens ?? 0) - supportByType.output),
    cache_create: Math.max(0, (session.cache_creation_input_tokens ?? 0) - supportByType.cache_create),
    cache_read:   Math.max(0, (session.cache_read_input_tokens ?? 0) - supportByType.cache_read),
  };
  tokensByModel = { [mainModelId]: mainByType };
  if (supportTokens > 0) {
    if (supportModelId === mainModelId) {
      // Degenerate case: main and support resolved to the SAME id (e.g. a
      // modelsUsed[] where every entry looks like haiku). Merge into the
      // one bucket instead of letting one key silently clobber the other.
      tokensByModel[mainModelId] = {
        input:        tokensByModel[mainModelId].input        + supportByType.input,
        output:       tokensByModel[mainModelId].output       + supportByType.output,
        cache_create: tokensByModel[mainModelId].cache_create + supportByType.cache_create,
        cache_read:   tokensByModel[mainModelId].cache_read   + supportByType.cache_read,
      };
    } else {
      tokensByModel[supportModelId] = supportByType;
    }
  }
}
session.tokens_by_model = tokensByModel;

// Cache-read *cost* share (distinct from cache-read *token* share, which
// runs higher — see docs/metrics-framework.md's "cache efficiency"). Uses
// our own MODEL_PRICING table against the per-model breakdown above so
// numerator and denominator come from the same estimate — independent of
// whether the headline session.cost_usd came from ccusage's own scoped
// pricing or our fallback table.
let cacheReadSharePct = null;
if (tokensByModel) {
  let totalCostEst = 0;
  let cacheReadCostEst = 0;
  for (const [modelKey, t] of Object.entries(tokensByModel)) {
    const pricing = MODEL_PRICING[modelPricingFamily(modelKey)];
    totalCostEst += calcCost(pricing, t.input, t.output, t.cache_create, t.cache_read);
    cacheReadCostEst += (t.cache_read * pricing.cache_read) / 1_000_000;
  }
  cacheReadSharePct = totalCostEst > 0 ? Math.round((cacheReadCostEst / totalCostEst) * 1000) / 10 : null;
}
session.cache_read_share_pct = cacheReadSharePct;

// --- Locate latest RUN-*.md report to pull run_id and pass/fail data ---

function findLatestRunReport() {
  const reportsDir = join(PROJECT_DIR, 'reports');
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir)
    .filter(f => f.match(/^RUN-.*\.md$/))
    .sort()
    .reverse();
  return files.length ? join(reportsDir, files[0]) : null;
}

// Fallback run_id for sessions with no report to read one from (e.g. a
// sizing-only session — see the reportPath staleness guard above). Must not
// collide with a run_id already used today, or writeFileSync below would
// silently overwrite a real run's metrics.json. Same NNN-increment scheme
// test-run-lead itself uses for report filenames (RULES.md).
function nextSyntheticRunId() {
  const today = new Date().toISOString().slice(0, 10);
  const metricsDir = join(PROJECT_DIR, 'reports', 'metrics');
  const taken = existsSync(metricsDir)
    ? new Set(readdirSync(metricsDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)))
    : new Set();
  let n = 1;
  let candidate;
  do {
    candidate = `RUN-${today}-${String(n).padStart(3, '0')}`;
    n++;
  } while (taken.has(candidate));
  return candidate;
}

let reportPath = findLatestRunReport();

// Guard against misattributing this session's metrics to a STALE report left
// over from an earlier, unrelated session. Repro: a session that only sizes
// or authors cases (so a trace file exists — some Agent got dispatched) but
// never actually runs a suite never gets a fresh report from test-reporter;
// meanwhile an older RUN-*.md from a real previous run is still sitting in
// reports/. Without this check we'd silently overwrite that older run's own
// reports/metrics/<id>.json with this session's near-empty data (reusing its
// run_id), merge its TC results table into tcs[] as if they were ours, and
// append this session's timing/cost sections onto ITS markdown report.
// Only trust reportPath if it was actually written during THIS session —
// i.e. its mtime is at or after the session's own start.
const sessionCutoffAt = sessionStartedAt || firstDispatchAt;
if (reportPath && sessionCutoffAt) {
  const cutoffMs = new Date(sessionCutoffAt).getTime();
  const reportMtimeMs = statSync(reportPath).mtimeMs;
  if (!Number.isNaN(cutoffMs) && reportMtimeMs < cutoffMs) {
    reportPath = null; // stale — belongs to an earlier session, not this one
  }
}

let runId = nextSyntheticRunId();
let suite = 'unknown-suite';   // overwritten below once a RUN-*.md report exists
let environment = 'unknown';   // overwritten below once a RUN-*.md report exists
let model = FALLBACK_MAIN_AGENT_MODEL_ID; // last-resort default; report/ccusage override below
const tcResults = {};

if (reportPath) {
  const md = readFileSync(reportPath, 'utf8');

  // Extract run_id from filename (strip .md extension)
  const m = reportPath.match(/([^/\\]+)\.md$/);
  if (m) runId = m[1];

  // Extract suite / environment from report header lines
  const suiteM = md.match(/suite[:\s]+([^\n]+)/i);
  if (suiteM) suite = suiteM[1].trim();
  const envM = md.match(/environment[:\s]+(https?:\/\/[^\s\n]+)/i);
  if (envM) environment = envM[1].trim();
  const modelM = md.match(/model[:\s]+([^\n]+)/i);
  if (modelM) model = modelM[1].trim();

  // Parse Results table for TC outcomes.
  // Handles both plain "PASS" and emoji-prefixed "✅ PASS" in any column after the TC id.
  // Report format: | TC-NNN | title | size | [emoji] PASS/FAIL | ...
  const rowRe = /\|\s*(TC-\d+)\s*\|[^|]*\|[^|]*\|[^|]*(PASS|FAIL|BLOCKED|SKIP)[^|]*\|/gi;
  let row;
  while ((row = rowRe.exec(md)) !== null) {
    tcResults[row[1]] = row[2].toUpperCase();
  }
}

// ccusage's own per-session model detection (if we got a scoped match above)
// wins over the report's `model:` line (usually absent) and the hardcoded
// default — it reflects what actually ran, including mixed-model sessions.
if (scopedModel) model = scopedModel;

// tokenomics-dataset `models_used` — prefer ccusage's own scoped detection
// (real, authoritative); fall back to what we inferred from the trace's
// role split (see tokens_by_model above), then to the single resolved
// `model` string as a last resort.
session.models_used = scopedModelsUsed
  ?? (tokensByModel ? Object.keys(tokensByModel) : (model ? [model] : null));

// --- Build per-TC array ---

// Merge trace data with results from report
const allTcIds = [...new Set([
  ...tcTraces.map(t => t.tc_id),
  ...Object.keys(tcResults),
])].sort();

const tcs = allTcIds.map(tcId => {
  const trace = tcTraces.findLast(t => t.tc_id === tcId) ?? {};
  return {
    tc_id: tcId,
    result: tcResults[tcId] ?? null,
    duration_ms: trace.duration_ms ?? null,
    tokens: trace.total_tokens ?? null,
    input_tokens: trace.input_tokens ?? null,
    output_tokens: trace.output_tokens ?? null,
    tool_uses: trace.tool_uses ?? null,
  };
});

// --- Summary ---

const passed = tcs.filter(t => t.result === 'PASS').length;
const failed = tcs.filter(t => t.result === 'FAIL').length;
const blocked = tcs.filter(t => t.result === 'BLOCKED').length;
const total = tcs.length;
const tokenTcs = tcs.filter(t => t.tokens != null);
const durationTcs = tcs.filter(t => t.duration_ms != null);
const toolTcs = tcs.filter(t => t.tool_uses != null);

const summary = {
  total,
  passed,
  failed,
  blocked,
  pass_rate: total ? Math.round((passed / total) * 1000) / 10 : null,
  avg_tokens_per_tc: tokenTcs.length
    ? Math.round(tokenTcs.reduce((s, t) => s + t.tokens, 0) / tokenTcs.length)
    : null,
  avg_tool_uses_per_tc: toolTcs.length
    ? Math.round((toolTcs.reduce((s, t) => s + t.tool_uses, 0) / toolTcs.length) * 10) / 10
    : null,
  avg_duration_per_tc_s: durationTcs.length
    ? Math.round(durationTcs.reduce((s, t) => s + t.duration_ms, 0) / durationTcs.length / 1000)
    : null,
};

// --- Cost calculation ---
// Scoped path already computed costBlock above (from ccusage's own priced
// per-model breakdown). Only the unscoped fallback needs our own pricing
// table here, applied to the summed cross-session delta and keyed off
// whatever `model` resolved to (report line, or the hardcoded default).

if (!costBlock && ccusageBlock) {
  const pricing = MODEL_PRICING[modelPricingFamily(model)];
  const { pre, post, delta } = ccusageBlock;
  const costPre  = calcCost(pricing, pre.input_tokens,  pre.output_tokens,  pre.cache_create,  pre.cache_read);
  const costPost = calcCost(pricing, post.input_tokens, post.output_tokens, post.cache_create, post.cache_read);
  const costDelta = calcCost(pricing, delta.input_tokens, delta.output_tokens, delta.cache_create, delta.cache_read);
  costBlock = {
    cost_usd_pre:   Math.round(costPre   * 100) / 100,
    cost_usd_post:  Math.round(costPost  * 100) / 100,
    cost_usd_delta: Math.round(costDelta * 100) / 100,
  };
}

if (costBlock) {
  session.cost_usd = costBlock.cost_usd_delta;
  session.ccusage = { ...ccusageBlock, ...costBlock };
} else {
  session.cost_usd = null;
}

// --- Write output ---

const metricsDir = join(PROJECT_DIR, 'reports', 'metrics');
mkdirSync(metricsDir, { recursive: true });

const outPath = join(metricsDir, `${runId}.json`);
const output = {
  run_id: runId,
  agent_system: 'manual-qa/v1',
  model,
  suite,
  environment,
  date: new Date().toISOString(),
  session,
  tcs,
  summary,
};

writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(`[build-run-metrics] wrote ${outPath}`);

// Durable, append-only ledger of every completed run (including the
// unknown-suite/orphaned-session synthetic path above — unfiltered, on
// purpose: any filtering logic here would itself be one more thing that can
// go stale). A per-run RUN-<id>.json can still be lost to a filesystem
// mistake or a future bug; this file never gets rewritten, only appended to.
const ledgerPath = join(metricsDir, 'all-runs.jsonl');
appendFileSync(ledgerPath, JSON.stringify(output) + '\n');
console.log(`[build-run-metrics] appended to ${ledgerPath}`);

// --- Append timing + ccusage sections to markdown report ---

function fmtMs(ms) {
  if (ms == null) return 'n/a';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

if (reportPath) {
  const na = ' *(hook not wired)*';
  const timingSection = `
## Timing Breakdown

| Phase | Duration |
|-------|----------|
| Pre-flight (setup before first dispatch) | ${fmtMs(session.pre_flight_duration_ms)}${session.pre_flight_duration_ms == null ? na : ''} |
| TC execution (sum of runners) | ${fmtMs(session.tc_total_duration_ms)} |
| Orchestrator (between dispatches) | ${fmtMs(session.orchestrator_duration_ms)} |
| Reporter | ${fmtMs(session.support_agent_duration_ms)} |
| Tracked total (first dispatch → end) | ${fmtMs(session.duration_ms)} |
| **Full session total** | **${fmtMs(session.total_session_duration_ms)}**${session.total_session_duration_ms == null ? na : ''} |
`;
  appendFileSync(reportPath, timingSection, 'utf8');
  console.log(`[build-run-metrics] appended timing section to ${reportPath}`);
}

if (reportPath && ccusageBlock && costBlock) {
  const { pre, post, delta } = ccusageBlock;
  const fmt = n => n.toLocaleString('en-US');
  const fmtCost = n => `$${n.toFixed(2)}`;
  const scopeNote = session.tokens_coverage === 'full_session_unscoped'
    ? ' *(⚠️ unscoped — may include other concurrent Claude Code sessions on this machine)*'
    : '';

  const section = `
## ccusage Session Delta${scopeNote}

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| Total tokens | ${fmt(pre.total_tokens)} | ${fmt(post.total_tokens)} | **+${fmt(delta.total_tokens)}** |
| Cache Read | ${fmt(pre.cache_read)} | ${fmt(post.cache_read)} | +${fmt(delta.cache_read)} |
| Cache Create | ${fmt(pre.cache_create)} | ${fmt(post.cache_create)} | +${fmt(delta.cache_create)} |
| Output tokens | ${fmt(pre.output_tokens)} | ${fmt(post.output_tokens)} | +${fmt(delta.output_tokens)} |
| **Cost** | ${fmtCost(costBlock.cost_usd_pre)} | ${fmtCost(costBlock.cost_usd_post)} | **+${fmtCost(costBlock.cost_usd_delta)}** |
`;
  appendFileSync(reportPath, section, 'utf8');
  console.log(`[build-run-metrics] appended ccusage section to ${reportPath}`);
}
