#!/usr/bin/env node
// workflow-return.mjs — persist a workflow subagent's structured result.
//
// WHY. A dispatched agent's structured return exists in exactly one place: the
// value it hands back. Its *payload* survives it — an analyst's AFS is on disk,
// an implementer's commits are in git — but the record of what it concluded
// dies with it. Field lesson, 2026-07-30: a foundation implementer built its
// branch, committed, then stalled. The branch was complete and the workflow
// knew nothing; a human had to notice and dispatch a rescue.
//
// This runs on SubagentStop and writes that result to disk, so a resumed run
// can read what already happened instead of redoing it.
//
// THREE THINGS IT WILL NOT DO, because a hook that misbehaves is worse than no
// hook at all:
//   1. It never writes to stdout. Hook stdout can be injected into the model's
//      context; a status line from a bookkeeping hook is pollution.
//   2. It never fails. Every error path exits 0. The worst outcome is that a
//      file is not written and the run behaves exactly as it does today.
//   3. It never touches a NON-workflow dispatch. A lead's own subagents are
//      none of its business — see isWorkflowTranscript.
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// Read the tail, not the file. A single agent transcript reached 1.3 MB on the
// run that motivated this; the result is always in the last few records.
const TAIL_BYTES = 512 * 1024;

/**
 * Workflow agents are filed under `subagents/workflows/wf_<id>/`; a directly
 * dispatched one sits in `subagents/` itself. That is the ONLY reliable
 * discriminator — both kinds carry the same `agentType`, so a hook matcher
 * cannot tell them apart (verified on a live run: one `test-automation-engineer`
 * in each place at the same time).
 *
 * Works from either transcript store — a repo-local `.claude/projects` and the
 * global `~/.claude/projects` share this suffix.
 */
export function isWorkflowTranscript(p) {
  return typeof p === 'string' && /[/\\]subagents[/\\]workflows[/\\]wf_[^/\\]+[/\\]/.test(p);
}

/** `…/workflows/wf_abc-123/agent-def456.jsonl` → { runId, agentId }. */
export function idsFromTranscript(p) {
  const runId = basename(dirname(p));
  const agentId = basename(p).replace(/^agent-/, '').replace(/\.jsonl$/, '');
  return { runId, agentId };
}

/** Read a bounded tail and return whole JSONL lines from it. */
function tailLines(path) {
  let fd;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    const lines = buf.toString('utf8').split('\n');
    // A non-zero offset almost certainly cut the first line mid-way.
    if (start > 0) lines.shift();
    return lines;
  } catch { return []; }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } } }
}

/**
 * The agent's structured result. A schema-constrained agent delivers it as a
 * `StructuredOutput` tool call, NOT as text — verified against real workflow
 * transcripts, and the reason `last_assistant_message` is not enough on its
 * own. Falls back to the final assistant text for unschema'd agents.
 */
export function extractResult(lines) {
  let structured = null;
  let text = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec?.type !== 'assistant') continue;
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use' && b.name === 'StructuredOutput' && b.input) structured = b.input;
      else if (b?.type === 'text' && b.text?.trim()) text = b.text;
    }
  }
  if (structured) return { result: structured, shape: 'structured' };
  if (text) return { result: { text: text.slice(0, 4000) }, shape: 'text' };
  return null;
}

/** agentType/description sidecar, when the host wrote one. */
function sidecar(transcriptPath) {
  try {
    return JSON.parse(readFileSync(transcriptPath.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
  } catch { return {}; }
}

/** Accepts snake_case or camelCase — hosts differ, and the field may be absent. */
export function transcriptPathOf(payload) {
  return payload?.transcript_path ?? payload?.transcriptPath ?? null;
}

/** `agent-abc123` or `abc123` — the payload and the filename disagree on the prefix. */
function agentIdOf(payload) {
  const raw = payload?.agent_id ?? payload?.agentId ?? null;
  return typeof raw === 'string' && raw ? raw.replace(/^agent-/, '') : null;
}

/**
 * The subagent transcript this stop event is about.
 *
 * Field lesson, 2026-08-03 (two projects, three runs, ZERO receipts ever
 * written): SubagentStop's `transcript_path` names the PARENT session's
 * transcript, not the subagent's file, and no subagent-path field exists in
 * the payload — so the old direct check never matched anything real. What the
 * payload does carry is `agent_id`, and the subagent's file lives under the
 * parent's session directory:
 *   <parent minus .jsonl>/subagents/agent-<id>.jsonl                 (direct)
 *   <parent minus .jsonl>/subagents/workflows/wf_<run>/agent-<id>.jsonl (workflow)
 *
 * Returns the WORKFLOW transcript path, or null. A direct dispatch resolves to
 * null on purpose — the workflows/ path segment stays the only discriminator.
 * The direct-path fast case is kept for hosts that do hand us the agent file.
 */
export function resolveAgentTranscript(payload) {
  const tp = transcriptPathOf(payload);
  if (tp && isWorkflowTranscript(tp) && existsSync(tp)) return tp;

  const agentId = agentIdOf(payload);
  if (!tp || !agentId) return null;
  const sessionDir = tp.replace(/\.jsonl$/, '');
  const wfRoot = join(sessionDir, 'subagents', 'workflows');
  let runs;
  try { runs = readdirSync(wfRoot, { withFileTypes: true }); } catch { return null; }
  for (const e of runs) {
    if (!e.isDirectory() || !e.name.startsWith('wf_')) continue;
    const candidate = join(wfRoot, e.name, `agent-${agentId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function run(payload, { projectDir = process.cwd(), now = null } = {}) {
  const tp = resolveAgentTranscript(payload);
  if (!tp || !isWorkflowTranscript(tp) || !existsSync(tp)) return null;

  const found = extractResult(tailLines(tp));
  if (!found) return null;                    // nothing to record is not a failure

  const { runId, agentId } = idsFromTranscript(tp);
  const meta = sidecar(tp);
  // Returns are working state written MID-RUN — on the telemetry side when it
  // exists, so a branch switch (gate checkout) never stashes or loses them.
  // Plain-dir fallback keeps repos without the telemetry area working as before.
  const telRoot = join(projectDir, '.agents', 'telemetry');
  const dir = existsSync(telRoot)
    ? join(telRoot, 'automation', 'returns', runId)
    : join(projectDir, '.agents', 'automation', '_returns', runId);
  const file = join(dir, `${agentId}.json`);

  const body = {
    run_id: runId,
    agent_id: agentId,
    agent_type: meta.agentType ?? payload?.agent_type ?? payload?.agentType ?? null,
    description: meta.description ?? null,
    shape: found.shape,
    recorded_at: now,
    result: found.result,
  };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
    return file;
  } catch { return null; }
}

/**
 * Read the hook payload from stdin with a hard deadline. The runtime can
 * leave a hook's stdin OPEN after writing the payload (the same behaviour
 * that forced lib.sh's backgrounded-cat read) — a plain blocking read then
 * waits for an EOF that never comes until the hook timeout kills the
 * process, which is exactly how this hook produced zero receipts across
 * three field runs. The payload arrives immediately and is a single JSON
 * document, so: finish the moment the buffer parses, or at the deadline
 * with whatever arrived.
 */
export function readStdinBounded(ms = 2000) {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(buf); } };
    const timer = setTimeout(finish, ms);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => {
        buf += d;
        try { JSON.parse(buf); finish(); } catch { /* incomplete — keep reading */ }
      });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch { finish(); }
  });
}

async function main() {
  const raw = await readStdinBounded();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* not JSON */ }
  if (payload) {
    try {
      run(payload, {
        projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
        now: new Date().toISOString(),
      });
    } catch { /* never fail a dispatch */ }
  }
  process.exit(0);                            // always, whatever happened
}

// pathToFileURL, not a hand-built `file://` string: the literal template never
// matches on Windows (`file:///C:/…`) or on any path containing a space
// (`%20`-encoding), and this guard failing silently disables the whole hook.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
