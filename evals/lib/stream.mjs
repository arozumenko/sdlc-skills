// Parse a `claude -p --output-format stream-json --verbose` transcript into the
// per-trial metrics the eval report needs. Pure function over the JSONL text so
// it is unit-testable without spawning claude.

const TOKEN_KEYS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];

function zeroUsage() {
  return Object.fromEntries(TOKEN_KEYS.map((k) => [k, 0]));
}

function addUsage(acc, u) {
  if (!u) return acc;
  for (const k of TOKEN_KEYS) acc[k] += Number(u[k] || 0);
  return acc;
}

export function parseStream(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* partial line from a killed run */ }
  }

  const init = events.find((e) => e.type === "system" && e.subtype === "init") || null;
  const result = [...events].reverse().find((e) => e.type === "result") || null;

  const toolCalls = {};
  const seenMsg = new Set();
  const usageFromMessages = zeroUsage();
  const subUsage = zeroUsage();
  let firstTurnContext = null;
  let subFirstTurnContext = null;
  let assistantMessages = 0;
  let subMessages = 0;
  let finalText = "";

  for (const e of events) {
    if (e.type !== "assistant" || !e.message) continue;
    // stream-json emits one event per content block; the same message id repeats
    // with the same usage, so count usage once per message id.
    const id = e.message.id;
    const firstSight = id ? !seenMsg.has(id) : true;
    if (id) seenMsg.add(id);
    // Subagent messages carry the dispatching Agent tool_use id.
    const isSub = Boolean(e.parent_tool_use_id);
    if (firstSight) {
      assistantMessages++;
      addUsage(usageFromMessages, e.message.usage);
      const u = e.message.usage;
      const ctx = u ? Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0) : null;
      if (firstTurnContext === null && ctx !== null) firstTurnContext = ctx;
      if (isSub) {
        subMessages++;
        addUsage(subUsage, u);
        if (subFirstTurnContext === null && ctx !== null) subFirstTurnContext = ctx;
      }
    }
    for (const block of e.message.content || []) {
      if (block.type === "tool_use") toolCalls[block.name] = (toolCalls[block.name] || 0) + 1;
      if (block.type === "text" && block.text) finalText = block.text;
    }
  }

  // Streamed messages can contain provisional output counts (e.g. 4 tokens
  // for a completed 339-token answer). modelUsage covers every model in the
  // session; result.usage can be main-loop only and is not a safe substitute.
  const modelUsage = result?.modelUsage ?? null;
  const modelRows = modelUsage && typeof modelUsage === 'object' && !Array.isArray(modelUsage) ? Object.values(modelUsage) : [];
  const reportedKeys = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'];
  const completeModelUsage = modelRows.length > 0 && modelRows.every(u => u && reportedKeys.every(k => Number.isFinite(u[k]) && u[k] >= 0));
  const usage = completeModelUsage ? modelRows.reduce((acc, u) => addUsage(acc, {
    input_tokens: u.inputTokens, output_tokens: u.outputTokens,
    cache_read_input_tokens: u.cacheReadInputTokens, cache_creation_input_tokens: u.cacheCreationInputTokens,
  }), zeroUsage()) : usageFromMessages;
  return {
    sessionId: init?.session_id ?? result?.session_id ?? null,
    model: init?.model ?? null,
    initAgents: init?.agents ?? null,
    initSkills: init?.skills ?? null,
    initPlugins: init?.plugins ?? null,
    initMcpServers: init?.mcp_servers ?? null,
    isError: result ? Boolean(result.is_error) : true,
    stopReason: result?.subtype ?? "no_result",
    turns: result?.num_turns ?? assistantMessages,
    durationMs: result?.duration_ms ?? null,
    costUsd: result?.total_cost_usd ?? null,
    usage,
    usageSource: completeModelUsage ? 'model-usage' : 'messages',
    messageUsage: usageFromMessages,
    modelUsage,
    totalTokens: TOKEN_KEYS.reduce((s, k) => s + usage[k], 0),
    resultUsage: result?.usage ?? null,
    firstTurnContext,
    subagent: subMessages ? { messages: subMessages, usage: subUsage, totalTokens: TOKEN_KEYS.reduce((s, k) => s + subUsage[k], 0), firstTurnContext: subFirstTurnContext } : null,
    toolCalls,
    toolCallTotal: Object.values(toolCalls).reduce((a, b) => a + b, 0),
    finalText: result?.result ?? finalText,
  };
}
