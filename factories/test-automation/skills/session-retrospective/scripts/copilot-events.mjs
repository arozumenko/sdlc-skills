// copilot-events.mjs — read GitHub Copilot sessions as if they were Claude Code
// transcripts, so the whole distiller (extractSignals / promptFingerprintOf /
// finalResultOf / renderDigest) works on them unchanged.
//
// WHY A TRANSCODER AND NOT A SECOND PARSER. The analysis is host-independent —
// "which tool errored", "what did this agent return", "was the same dispatch
// repeated" are questions about work, not about a file format. Only the file
// format differs, so only the file format is adapted here. A forked analyser
// would drift from the Claude one on every future fix.
//
// WHERE THE DATA IS. Copilot writes one event stream per session at
// `~/.copilot/session-state/<session-id>/events.jsonl` (84 sessions / 22 MB on
// the machine this was built against). It is NOT the SQLite `session-store.db`
// next to it: that holds only flat `user_message`/`assistant_response` text and
// its tool-call table (`forge_trajectory_events`) was empty in every session
// examined. The event stream is the real transcript.
//
// WHAT IT CARRIES (measured, Copilot CLI 1.0.63 / event schema version 1):
//   session.start           → cwd, git branch, repository, copilotVersion
//   user.message            → the operator's text
//   assistant.message       → text + toolRequests[] + outputTokens
//   tool.execution_start    → toolCallId, toolName, arguments
//   tool.execution_complete → success, result, model
//   subagent.started        → agentName, agentDescription, toolCallId
//   subagent.completed      → agentName, model, totalTokens, totalToolCalls, durationMs
//   session.shutdown        → per-model token breakdown (see the efficiency-audit skill)
//
// Copilot nests sub-agent work in the SAME stream (no per-agent files, unlike
// Claude's `<session>/subagents/*.jsonl`), keyed by `agentId` — so splitting the
// stream by agentId reproduces Claude's parent + sub-agent layout.
//
// One value to expect and NOT to prettify: `agentName: "task"`. Copilot writes
// it for a dispatch that named no custom agent — the analogue of Claude's
// anonymous `workflow-subagent`. Measured 4 of 12 in one session. It is the
// data, so it is reported as-is: renaming it would hide that those dispatches
// got no role definition and therefore no role memory.
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Copilot's session dir is NOT always `~/.copilot`. `COPILOT_HOME` relocates the
 * whole config directory, and pointing it at a repo-local `./.copilot` is a
 * documented setup (it is how a project-local MCP config is picked up). Reading
 * only the home path would report "no sessions" for exactly the projects that
 * configured themselves properly — so every existing root is searched.
 */
export function copilotRoots(cwd = process.cwd(), env = process.env) {
  const seen = new Set();
  const out = [];
  for (const p of [
    env.COPILOT_HOME && join(env.COPILOT_HOME, 'session-state'),
    join(cwd, '.copilot', 'session-state'),
    join(homedir(), '.copilot', 'session-state'),
  ]) {
    if (p && !seen.has(p) && existsSync(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

export const COPILOT_ROOT = join(homedir(), '.copilot', 'session-state');

/** Copilot tool name → the Claude name the analysis already knows. */
const TOOL_ALIAS = {
  bash: 'Bash',
  view: 'Read',
  create: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
  read_agent: 'Read',
};

/**
 * The argument that names what a call acted ON. Claude's analysis reads
 * `input.file_path` first, so edit-type tools must expose the path under that
 * key or file-churn counting silently reports nothing.
 */
function normalizeArgs(toolName, args) {
  const a = (args && typeof args === 'object') ? args : {};
  const out = { ...a };
  if (a.path && !out.file_path) out.file_path = a.path;
  if (toolName === 'task') {
    // A Copilot `task` call IS a sub-agent dispatch; Claude's Task carries the
    // dispatch prompt in `prompt` and the role in `subagent_type`.
    if (a.name && !out.subagent_type) out.subagent_type = a.name;
  }
  return out;
}

export function safeParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

export function readEvents(eventsPath) {
  const out = [];
  for (const line of readFileSync(eventsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = safeParse(line);
    if (rec && rec.type) out.push(rec);
  }
  return out;
}

/**
 * Copilot events → Claude-shaped records.
 *
 * Two Copilot events make one Claude exchange: `assistant.message` carries the
 * tool REQUESTS, and `tool.execution_complete` carries each result. Claude puts
 * the request in an assistant record and the result in the NEXT user record, so
 * a completion is emitted as its own `user` record with a `tool_result` block —
 * which is exactly what `extractSignals` counts errors from.
 *
 * `is_error` comes from `success === false`. Copilot has no `is_error` field;
 * treating a missing `success` as an error would invent failures, so only an
 * explicit `false` counts.
 */
export function toClaudeRecords(events) {
  const out = [];
  let cwd = null, gitBranch = null;
  // Every record carries branch + timestamp because `sessionMeta` derives the
  // session's date, duration and branch from those fields — omit them and every
  // Copilot session renders as "? / 0 min".
  const stamp = (ev) => ({ cwd, ...(gitBranch ? { gitBranch } : {}), ...(ev.timestamp ? { timestamp: ev.timestamp } : {}) });
  for (const ev of events) {
    const d = ev.data ?? {};
    switch (ev.type) {
      case 'session.start':
        cwd = d.context?.cwd ?? null;
        gitBranch = d.context?.branch ?? null;
        break;
      case 'user.message': {
        // `content` is what the operator typed; `transformedContent` is the
        // same text after skill/context injection. The raw text is the signal —
        // the injected version fingerprints every dispatch as unique.
        const text = typeof d.content === 'string' ? d.content : '';
        if (text) out.push({ type: 'user', ...stamp(ev), message: { content: text } });
        break;
      }
      case 'assistant.message': {
        const blocks = [];
        if (typeof d.content === 'string' && d.content.trim()) {
          blocks.push({ type: 'text', text: d.content });
        }
        for (const req of (Array.isArray(d.toolRequests) ? d.toolRequests : [])) {
          const name = req.name ?? '';
          blocks.push({
            type: 'tool_use',
            id: req.toolCallId,
            name: TOOL_ALIAS[name] ?? name,
            input: normalizeArgs(name, req.arguments),
          });
        }
        if (blocks.length) out.push({ type: 'assistant', ...stamp(ev), message: { content: blocks } });
        break;
      }
      case 'tool.execution_complete': {
        const content = typeof d.result?.content === 'string'
          ? d.result.content
          : JSON.stringify(d.result ?? '');
        out.push({
          type: 'user',
          ...stamp(ev),
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: d.toolCallId,
              is_error: d.success === false,
              content,
            }],
          },
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Sub-agents in the EXACT shape `summarizeSubagents` consumes —
 * `{agentType, description, turns, errors, ended, fingerprint, result}` — plus
 * the metering fields Copilot hands over for free (`model`, `totalTokens`,
 * `toolCalls`, `durationMs`), which Claude makes you derive from ccusage.
 *
 * Pass a `signals` function (distill-sessions' `extractSignals` and friends) so
 * this module stays free of a circular import: the transcoder knows the format,
 * the distiller knows the analysis, and neither imports the other.
 */
export function readSubagents(events, signals = null) {
  const started = new Map();   // toolCallId -> {agentName, description}
  const byAgent = new Map();   // agentId -> events[]
  const prompts = dispatchPrompts(events);
  const out = [];

  for (const ev of events) {
    if (ev.agentId) {
      if (!byAgent.has(ev.agentId)) byAgent.set(ev.agentId, []);
      byAgent.get(ev.agentId).push(ev);
    }
  }
  for (const ev of events) {
    const d = ev.data ?? {};
    if (ev.type === 'subagent.started') {
      started.set(d.toolCallId, { name: d.agentName, description: d.agentDescription ?? '' });
    } else if (ev.type === 'subagent.completed') {
      const meta = started.get(d.toolCallId) ?? {};
      const records = toClaudeRecords(byAgent.get(d.toolCallId) ?? []);
      // A Copilot sub-agent's own stream has no `user.message` — the dispatch
      // prompt lives in the PARENT's `task` call. Without seeding it here,
      // promptFingerprintOf returns '' for every sub-agent and the
      // repeated-identical-dispatch check silently finds nothing.
      const prompt = prompts.get(d.toolCallId);
      if (prompt) records.unshift({ type: 'user', message: { content: prompt } });
      const s = signals ? signals(records) : null;
      const errors = s ? Object.values(s.toolErrors).reduce((a, b) => a + b, 0) : 0;
      out.push({
        agentType: d.agentName ?? meta.name ?? '?',
        description: meta.description ?? '',
        turns: s ? s.userTurns + s.assistantTurns : 0,
        errors,
        ended: s ? (errors > 0 ? 'with errors' : 'ok') : '?',
        fingerprint: '',              // filled by the caller (needs the distiller)
        result: '',                   // idem
        // Copilot-only metering — no ccusage round-trip needed.
        model: d.model ?? null,
        totalTokens: d.totalTokens ?? null,
        toolCalls: d.totalToolCalls ?? null,
        durationMs: d.durationMs ?? null,
        records,
      });
    }
  }
  return out;
}

/** toolCallId → the prompt the parent dispatched with, from its `task` call. */
function dispatchPrompts(events) {
  const map = new Map();
  for (const ev of events) {
    if (ev.type !== 'assistant.message') continue;
    for (const req of (Array.isArray(ev.data?.toolRequests) ? ev.data.toolRequests : [])) {
      const p = req?.arguments?.prompt;
      if (req?.toolCallId && typeof p === 'string' && p.trim()) map.set(req.toolCallId, p);
    }
  }
  return map;
}

/**
 * Sessions whose `session.start` cwd is at or under `cwd`, oldest first.
 * Searches every root that exists (§ copilotRoots) unless one is pinned — a
 * project can hold repo-local sessions AND older ones under the home dir.
 */
export function sessionsForCwd(cwd, root = null) {
  const roots = root ? [root] : copilotRoots(cwd);
  const hits = [];
  for (const r of roots) {
    let names;
    try { names = readdirSync(r); } catch { continue; }
    for (const name of names) {
      const events = join(r, name, 'events.jsonl');
      if (!existsSync(events)) continue;
      const sessionCwd = firstCwd(events);
      if (!sessionCwd) continue;
      if (sessionCwd === cwd || sessionCwd.startsWith(cwd + '/')) {
        hits.push({ id: name, path: events, mtime: statSync(events).mtimeMs, cwd: sessionCwd });
      }
    }
  }
  return hits.sort((a, b) => a.mtime - b.mtime);
}

/**
 * The cwd without parsing the whole file. `session.start` is the first line in
 * every stream observed, so a bounded head read answers it — the alternative is
 * parsing 22 MB to filter by project.
 *
 * A genuinely bounded READ, not a slice of a full one: `readFileSync().slice()`
 * still pulls the entire 22 MB into memory before discarding all but the head,
 * which is the cost this function exists to avoid, paid once per session on the
 * machine.
 */
function firstCwd(eventsPath, maxBytes = 65536) {
  let fd;
  try {
    fd = openSync(eventsPath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    const lines = buf.subarray(0, n).toString('utf8').split('\n');
    if (n === maxBytes) lines.pop();          // truncated tail line, not data
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = safeParse(line);
      if (rec?.type === 'session.start') return rec.data?.context?.cwd ?? null;
    }
  } catch { /* unreadable → treat as unknown */ }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } } }
  return null;
}
