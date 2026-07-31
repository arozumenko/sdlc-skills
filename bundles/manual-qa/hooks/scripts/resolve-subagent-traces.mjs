#!/usr/bin/env node
// Backfills/rebuilds the tc-trace JSONL from the MAIN session transcript's
// own <task-notification> messages, instead of trusting
// benchmark-tc-hook.mjs's real-time PostToolUse capture.
//
// WHY THIS EXISTS (found 2026-07-30, qa-project debug session, round 3):
// benchmark-tc-hook.mjs's `tr.status !== 'completed'` gate assumes
// PostToolUse fires once, synchronously, at the Agent tool's real
// completion, with tool_response.totalTokens/totalDurationMs/usage already
// populated. Confirmed via a real side-by-side: elitea-testing's own last
// verified-working run (RUN-2026-07-22-005, session e02462b1) shows the
// Agent tool's tool_use -> tool_result pair taking ~2 real minutes with the
// dispatched agent's actual final text in tool_result — genuinely
// synchronous. qa-project's real runs today show the SAME tool_use ->
// tool_result pair resolving in ~30-50ms with an "Async agent launched
// successfully" stub — genuinely asynchronous. Diffed benchmark-tc-hook.mjs
// byte-for-byte between the two projects: identical. So this isn't a
// porting gap between the two projects — it's a Claude Code runtime/version
// behavior change since 07-22 that would break elitea-testing's own
// pipeline identically if re-run today.
//
// Under this async model, the REAL per-dispatch usage numbers are instead
// delivered later to the ORCHESTRATOR's own (main-thread) transcript as an
// injected `user`-role turn shaped like:
//
//   <task-notification>
//   <task-id>...</task-id>
//   <tool-use-id>toolu_...</tool-use-id>
//   <output-file>...</output-file>
//   <status>completed</status>
//   <summary>Agent "..." finished</summary>
//   <result>...agent's final text, including its tc_id JSON blob...</result>
//   <usage><subagent_tokens>77543</subagent_tokens><tool_uses>12</tool_uses><duration_ms>140414</duration_ms></usage>
//   </task-notification>
//
// Confirmed by direct comparison against reports/RUN-2026-07-30-018.md's own
// "Performance Metrics" table (which test-reporter tabulates straight from
// test-run-lead's own per-TC result records, NOT from this hook pipeline —
// see build-run-metrics.mjs's header notes): every <subagent_tokens>/
// <tool_uses> pair for this run's 4 real TC dispatches matched that table
// EXACTLY (77543/12, 112338/23, 80476/11, 110618/22). This is Claude Code's
// own authoritative usage figure for that dispatch — not a reconstruction —
// so trust it directly rather than summing usage across the sub-agent's own
// inner transcript turns (tried first; overcounts by ~20-30x, almost
// certainly because each inner turn's own cache_read_input_tokens reflects
// that whole sub-conversation's cumulative cache growth, not a
// once-only-billed amount — summing turns double/triple/N-counts it).
//
// Usage: node resolve-subagent-traces.mjs <main-transcript-path> <trace-file>
// Behavior: if the main transcript has at least one <task-notification> with
// a parseable <usage> block, REWRITES <trace-file> with one JSON line per
// dispatch, in the exact schema benchmark-tc-hook.mjs already produces (so
// build-run-metrics.mjs needs no changes at all). If nothing is found (older
// Claude Code without this notification format, or a genuinely synchronous
// dispatch that never needed one), leaves <trace-file> untouched — whatever
// benchmark-tc-hook.mjs already captured (possibly real data, on a
// synchronous dispatch) stays as the only source. Never fatal: any error
// here just leaves the existing trace file alone.
//
// Known gap: <usage> only carries a single combined `subagent_tokens`
// figure, tool_uses, and duration_ms — no input/output/cache-type split (the
// notification format doesn't expose one). tokens_by_model's per-type
// breakdown in build-run-metrics.mjs will treat these dispatches as having
// 0 input/output/cache tokens of their own even though tokens is populated;
// total_tokens (used everywhere else — tcs[], tokens_by_agent, per-TC
// tables) is unaffected and fully accurate.

import { readFileSync, writeFileSync, existsSync } from 'fs';

const [, , transcriptPath, traceFile] = process.argv;

function fail(msg) {
  console.error(`[resolve-subagent-traces] ${msg} — leaving trace file untouched`);
  process.exit(0);
}

if (!transcriptPath || !traceFile) fail('missing <main-transcript-path> or <trace-file> arg');
if (!existsSync(transcriptPath)) fail(`transcript not found: ${transcriptPath}`);

let lines;
try {
  lines = readFileSync(transcriptPath, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
} catch (e) {
  fail(`could not read/parse transcript: ${e.message}`);
}

// tool_use_id -> real dispatched agent persona, straight from the Agent
// tool call's own input (same field benchmark-tc-hook.mjs already trusts
// for this, on the synchronous path).
const dispatchAgentType = new Map();
for (const entry of lines) {
  const content = entry.message?.content;
  if (!Array.isArray(content)) continue;
  for (const c of content) {
    if (c?.type === 'tool_use' && c.name === 'Agent') {
      dispatchAgentType.set(c.id, c.input?.subagent_type ?? null);
    }
  }
}

const NOTIFICATION_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const TOOL_USE_ID_RE = /<tool-use-id>(.*?)<\/tool-use-id>/;
const TC_ID_RE = /"tc_id"\s*:\s*"(TC-\d+)"/;
const USAGE_RE = /<usage><subagent_tokens>(\d+)<\/subagent_tokens><tool_uses>(\d+)<\/tool_uses><duration_ms>(\d+)<\/duration_ms><\/usage>/;

// Dedupe by tool-use-id, keeping the LAST notification seen for it (the doc
// itself warns "the same task-id may notify more than once" — e.g. a
// resumed/re-prompted agent) so a dispatch's stats aren't double-counted in
// tokensByAgent's aggregation downstream.
const byToolUseId = new Map(); // preserves insertion order for first-seen ids

for (const entry of lines) {
  const content = entry.message?.content;
  const texts = [];
  if (typeof content === 'string') texts.push(content);
  else if (Array.isArray(content)) {
    for (const c of content) if (c?.type === 'text' && typeof c.text === 'string') texts.push(c.text);
  }
  for (const text of texts) {
    let m;
    NOTIFICATION_RE.lastIndex = 0;
    while ((m = NOTIFICATION_RE.exec(text)) !== null) {
      const block = m[1];
      const toolUseIdM = block.match(TOOL_USE_ID_RE);
      const usageM = block.match(USAGE_RE);
      if (!toolUseIdM || !usageM) continue; // no usage block yet (e.g. a non-`completed` notification) — skip
      const toolUseId = toolUseIdM[1];
      const tcIdM = block.match(TC_ID_RE);
      byToolUseId.set(toolUseId, {
        tc_id: tcIdM ? tcIdM[1] : null,
        agent_type: dispatchAgentType.get(toolUseId) ?? null,
        role: tcIdM ? 'test-runner' : 'support',
        total_tokens: parseInt(usageM[1], 10),
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        tool_uses: parseInt(usageM[2], 10),
        duration_ms: parseInt(usageM[3], 10),
      });
    }
  }
}

if (!byToolUseId.size) fail('no <task-notification> blocks with a parseable <usage> found in transcript');

const entries = [...byToolUseId.values()];
writeFileSync(traceFile, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
console.log(`[resolve-subagent-traces] wrote ${entries.length} entries from ${transcriptPath} to ${traceFile}`);
