import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStream } from "./stream.mjs";

const lines = [
  { type: "system", subtype: "init", session_id: "s1", model: "claude-sonnet-5", agents: ["qa-engineer"], skills: ["memory"], plugins: [], mcp_servers: [] },
  { type: "assistant", message: { id: "m1", usage: { input_tokens: 10, cache_creation_input_tokens: 40000, cache_read_input_tokens: 5000, output_tokens: 50 }, content: [{ type: "text", text: "looking" }] } },
  { type: "assistant", message: { id: "m1", usage: { input_tokens: 10, cache_creation_input_tokens: 40000, cache_read_input_tokens: 5000, output_tokens: 50 }, content: [{ type: "tool_use", name: "Bash", input: {} }] } },
  { type: "user", message: { content: [{ type: "tool_result" }] } },
  { type: "assistant", message: { id: "m2", usage: { input_tokens: 5, cache_read_input_tokens: 45000, output_tokens: 80 }, content: [{ type: "tool_use", name: "Read", input: {} }, { type: "tool_use", name: "Bash", input: {} }] } },
  { type: "assistant", message: { id: "m3", usage: { input_tokens: 2, cache_read_input_tokens: 46000, output_tokens: 20 }, content: [{ type: "text", text: "VERDICT: NOT DONE" }] } },
];

test("aggregates usage once per message id and counts tool calls", () => {
  const m = parseStream(lines.map((l) => JSON.stringify(l)).join("\n") + "\n{partial");
  assert.equal(m.sessionId, "s1");
  assert.equal(m.firstTurnContext, 45010);
  assert.deepEqual(m.toolCalls, { Bash: 2, Read: 1 });
  assert.equal(m.toolCallTotal, 3);
  assert.equal(m.usage.output_tokens, 150);
  assert.equal(m.usage.cache_read_input_tokens, 96000);
  assert.equal(m.turns, 3);
  assert.equal(m.finalText, "VERDICT: NOT DONE");
  assert.equal(m.isError, true, "no result event means the run did not finish cleanly");
});

test("takes status, turns and cost from the result event", () => {
  const withResult = [...lines, { type: "result", subtype: "success", is_error: false, num_turns: 4, duration_ms: 12000, total_cost_usd: 0.42, result: "done", usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } }];
  const m = parseStream(withResult.map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(m.isError, false);
  assert.equal(m.turns, 4);
  assert.equal(m.costUsd, 0.42);
  assert.equal(m.totalTokens, 96000 + 40000 + 17 + 150, "totals come from per-message usage");
  assert.deepEqual(m.resultUsage, { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 });
  assert.equal(m.finalText, "done");
});

test("separates subagent usage and its first-turn context", () => {
  const ev = [
    { type: "assistant", message: { id: "o1", usage: { input_tokens: 3, cache_read_input_tokens: 20000, output_tokens: 30 }, content: [{ type: "tool_use", name: "Agent", input: {} }] } },
    { type: "assistant", parent_tool_use_id: "t1", message: { id: "s1", usage: { input_tokens: 1, cache_creation_input_tokens: 60000, output_tokens: 10 }, content: [{ type: "tool_use", name: "Bash", input: {} }] } },
    { type: "assistant", parent_tool_use_id: "t1", message: { id: "s2", usage: { input_tokens: 1, cache_read_input_tokens: 60010, output_tokens: 15 }, content: [{ type: "text", text: "ok" }] } },
  ];
  const m = parseStream(ev.map((l) => JSON.stringify(l)).join("\n"));
  assert.equal(m.firstTurnContext, 20003);
  assert.equal(m.subagent.messages, 2);
  assert.equal(m.subagent.firstTurnContext, 60001);
  assert.equal(m.subagent.usage.output_tokens, 25);
});
