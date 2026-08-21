#!/usr/bin/env node
// PostToolUse hook helper — parses an Agent call result and appends one
// JSON line to the tc-trace JSONL.
//
// PostToolUse payload structure (Claude Code):
//   tool_input.subagent_type       — real dispatched agent persona (e.g.
//                                    "test-runner", "test-sizer", "test-
//                                    reporter") — confirmed present on the
//                                    same payload, straight from the Agent
//                                    tool call itself. Far more reliable
//                                    than guessing from output text.
//   tool_response.content[]       — agent text output (look for type='text')
//   tool_response.totalTokens     — total tokens for this agent call
//   tool_response.totalDurationMs — wall-clock duration in ms
//   tool_response.totalToolUseCount
//   tool_response.usage           — { input_tokens, output_tokens, cache_* }
//
// Usage: node scripts/benchmark-tc-hook.mjs <trace-file>
//        stdin: PostToolUse JSON payload

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const traceFile = process.argv[2];
if (!traceFile) process.exit(0);

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString());

    if (payload.tool_name !== 'Agent') return process.exit(0);

    const tr = payload.tool_response;
    if (!tr || tr.status !== 'completed') return process.exit(0);

    // Extract agent text output from content array
    const text = (tr.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const tcMatch = text.match(/"tc_id"\s*:\s*"(TC-\d+)"/);
    const usage = tr.usage ?? {};

    // Real dispatched agent persona, straight from the tool call's own input
    // — no more guessing from output text. Falls back to the old tc_id-
    // presence heuristic only if tool_input/subagent_type is ever missing
    // (shouldn't happen on a supported Claude Code version; never fatal).
    const agentType = payload.tool_input?.subagent_type ?? (tcMatch ? 'test-runner' : 'support');

    mkdirSync(dirname(traceFile), { recursive: true });
    appendFileSync(traceFile, JSON.stringify({
      tc_id:        tcMatch ? tcMatch[1] : null,
      agent_type:   agentType,
      role:         tcMatch ? 'test-runner' : 'support', // kept for back-compat; agent_type is now authoritative
      total_tokens: tr.totalTokens         ?? null,
      input_tokens: usage.input_tokens     ?? null,
      output_tokens: usage.output_tokens   ?? null,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens:     usage.cache_read_input_tokens     ?? null,
      tool_uses:    tr.totalToolUseCount   ?? null,
      duration_ms:  tr.totalDurationMs     ?? null,
    }) + '\n');
  } catch { /* never fail the hook */ }
  process.exit(0);
});
