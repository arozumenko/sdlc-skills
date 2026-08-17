#!/usr/bin/env node
// scope-hook.mjs — the Claude Code hook moments that make the work-scope
// contract self-enforcing (see scripts/work-scope.mjs for the record itself).
//
//   --announce       SessionStart (sync): print ONE context line carrying the
//                    session id + how to declare scope — the model cannot name
//                    its scope file without the id, and injection is the only
//                    reliable delivery. On resume/clear it prints the existing
//                    scope digest instead, so an in-flight batch survives
//                    context resets. Also sweeps stale marker files.
//   --mark-dispatch  PreToolUse, matcher "Agent|Workflow" (async): touch a
//                    marker meaning "this session dispatched work". Matcher
//                    covers BOTH dispatch styles — sequential Agent-tool calls
//                    AND a Workflow-tool run (whose inner agents never pass
//                    through the Agent tool).
//   --gate           Stop (sync): if work was dispatched but no scope exists,
//                    block the turn end ONCE with instructions. A one-time nag:
//                    marker files (.nagged-<sid>) and the payload's own
//                    stop_hook_active flag both prevent loops. Sessions that
//                    never dispatch are never bothered.
//
// THREE RULES, same as workflow-return.mjs: never write stdout except the
// documented output; never exit non-zero; never block the host on stdin (the
// runtime can leave hook stdin open — bounded read, field-verified).
//
// Copilot CLI has the same three moments (hooks-reference: `sessionStart`
// injects additionalContext, `subagentStart` fires per dispatch, `agentStop`
// blocks with the same decision/reason shape) — only the OUTPUT ENCODING
// differs: Copilot parses hook stdout as JSON, Claude's SessionStart injects
// raw text. `--json` selects the Copilot encoding; the decision logic is one
// code path. Payloads differ only in casing (sessionId vs session_id — both
// read). `open --session auto` remains the fallback for anything older.
// STDLIB ONLY.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKER_TTL_DAYS = 7;
/**
 * SUGGESTED intents, not a validated enum — `intent` stays an open string so a
 * project (or another bundle: manual-qa) can label work its own way. The
 * suggestion exists so sessions don't all collapse into "other", which tells
 * you nothing about where the money went. Only `automation` feeds the
 * cost-per-case figures; every other label simply reports its own spend.
 */
export const INTENTS = ['automation', 'manual-testing', 'investigation', 'framework', 'onboarding', 'docs', 'other'];

export function scopesDir(repo) { return join(repo, '.agents', 'telemetry', 'automation', 'scopes'); }
const safeSid = (id) => String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }

/** The installed skill's scripts/work-scope.mjs, repo-relative when inside. */
export function scopeScriptPath(repo, scriptUrl = import.meta.url) {
  const abs = join(dirname(dirname(fileURLToPath(scriptUrl))), 'scripts', 'work-scope.mjs');
  const rel = relative(repo, abs);
  return rel.startsWith('..') ? abs : rel.split('\\').join('/');
}

/** One context line. Scope exists → digest (resume/clear survival); none → the ask. */
export function announceLine(repo, sessionId, scriptUrl = import.meta.url) {
  const sid = safeSid(sessionId);
  if (!sid) return null;
  const scope = readJson(join(scopesDir(repo), `${sid}.json`));
  if (scope) {
    return `tokenomics scope [session ${sid}]: ${scope.intent}${scope.batch ? ` / batch ${scope.batch}` : ''} — ${scope.cases.length} case(s)`
      + `${scope.outcomes ? `, ${Object.keys(scope.outcomes).length} outcome(s)` : ''}${scope.closedAt ? ' (closed)' : ''}. Update via \`node ${scopeScriptPath(repo, scriptUrl)}\`.`;
  }
  return `tokenomics [session ${sid}]: declare what this session is for — `
    + `\`node ${scopeScriptPath(repo, scriptUrl)} open --session ${sid} --intent <intent> [--batch <slug> --cases <ID,ID,…>]\`. `
    + `Batch work: \`--intent automation\` WITH batch + cases (only this intent feeds cost-per-case). Anything else: pick the honest label — `
    + `${INTENTS.filter((i) => i !== 'automation').join(', ')} — or your own; no batch/cases needed. Then record results as they become true: `
    + `\`… outcome --session ${sid} <ID>=<outcome>\`.`;
}

export function markDispatch(repo, sessionId) {
  const sid = safeSid(sessionId);
  if (!sid) return null;
  const dir = scopesDir(repo);
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, `.pending-${sid}`);
  writeFileSync(marker, '');
  return marker;
}

/** The batch's receipt, wherever the pipeline put it (flat, or a campaign wave). */
export function receiptPathFor(repo, batch) {
  const root = join(repo, '.agents', 'automation');
  const direct = join(root, ...String(batch).split('/'), 'report.json');
  if (existsSync(direct)) return direct;
  let names;
  try { names = readdirSync(root); } catch { return null; }
  for (const n of names) {                                  // <campaign>/<wave>/report.json
    const nested = join(root, n, String(batch), 'report.json');
    if (existsSync(nested)) return nested;
  }
  return null;
}

/**
 * Stop decision — TWO one-time nudges, both host- and mode-independent (they
 * only read files, so they hold for a Workflow run, a sequential dispatch loop,
 * Claude or Copilot):
 *
 *   1. work was dispatched and NO scope was declared      → declare it
 *   2. the batch has a receipt but the scope is still open → run `close`
 *      (records outcomes, renders the batch report, cross-checks the receipt)
 *
 * (2) exists because a lead reliably does the git half of closing and then
 * writes its own summary in chat — measured on a real batch: scope declared,
 * outcomes recorded, merged, cleaned up… and no report, because nothing asked.
 * Declaring got done precisely because (1) asked.
 *
 * Returns the hook-output object, or null for "say nothing, allow the stop".
 */
export function gateDecision(repo, payload, scriptUrl = import.meta.url) {
  const sid = safeSid(payload?.session_id ?? payload?.sessionId);
  if (!sid) return null;
  if (payload?.stop_hook_active) return null;              // we already blocked this chain
  const dir = scopesDir(repo);
  const scope = readJson(join(dir, `${sid}.json`));
  const askedOnce = (kind) => {
    const marker = join(dir, `.${kind}-${sid}`);
    if (existsSync(marker)) return true;
    try { writeFileSync(marker, ''); return false; } catch { return true; } // can't record → don't loop
  };

  if (!scope) {
    if (!existsSync(join(dir, `.pending-${sid}`))) return null;  // no work dispatched
    if (askedOnce('nagged')) return null;
    return {
      decision: 'block',
      reason: `This session dispatched work but declared no scope. Run \`node ${scopeScriptPath(repo, scriptUrl)} open --session ${sid} `
        + `--intent automation --batch <slug> --cases <ID,ID,…>\` for batch work — or, for anything else, the same command with the honest label and no batch/cases `
        + `(${INTENTS.filter((i) => i !== 'automation').join(' / ')}, or your own). Then finish your reply.`,
    };
  }

  if (scope.batch && !scope.closedAt && receiptPathFor(repo, scope.batch) && !askedOnce('unclosed')) {
    return {
      decision: 'block',
      reason: `Batch '${scope.batch}' has written its receipt but this session's scope is still open — the batch report does not exist yet. `
        + `Record any outcome you have not yet recorded (\`node ${scopeScriptPath(repo, scriptUrl)} outcome --session ${sid} <ID>=<outcome>\`), then run `
        + `\`node ${scopeScriptPath(repo, scriptUrl)} close --session ${sid}\` — it captures this session's spend, renders .agents/automation/${scope.batch}/batch-report.md + .html, `
        + `and cross-checks the receipt against the recorded gate verdicts (a DRIFT warning means report.json still needs its write-back). Then finish your reply.`,
    };
  }
  return null;
}

/** Markers from sessions that died before cleanup — swept on announce. */
export function sweepMarkers(repo, { ttlDays = MARKER_TTL_DAYS, now = Date.now() } = {}) {
  const dir = scopesDir(repo);
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!/^\.(pending|nagged|unclosed)-/.test(name)) continue;
    try {
      if (now - statSync(join(dir, name)).mtimeMs > ttlDays * 86_400_000) {
        rmSync(join(dir, name));
        removed++;
      }
    } catch { /* raced away — fine */ }
  }
  return removed;
}

/** Bounded stdin read — the runtime can leave hook stdin open (field-verified). */
export function readStdinBounded(ms = 2000) {
  return new Promise((resolveP) => {
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolveP(buf); } };
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

async function main(argv = process.argv.slice(2), env = process.env) {
  let payload = null;
  try { payload = JSON.parse(await readStdinBounded()); } catch { /* not JSON — every mode tolerates it */ }
  // Copilot delivers the workspace in the payload; Claude in the env.
  const repo = payload?.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const sid = payload?.session_id ?? payload?.sessionId ?? null;
  const asJson = argv.includes('--json'); // Copilot parses stdout as JSON; Claude injects raw text

  if (argv.includes('--announce')) {
    sweepMarkers(repo);
    const line = announceLine(repo, sid);
    if (line) process.stdout.write(asJson ? JSON.stringify({ additionalContext: line }) : `${line}\n`);
    return;
  }
  if (argv.includes('--mark-dispatch')) {
    markDispatch(repo, sid);
    return;
  }
  if (argv.includes('--gate')) {
    const out = gateDecision(repo, payload);
    if (out) process.stdout.write(JSON.stringify(out)); // decision/reason — same shape both hosts
    return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), () => process.exit(0)); // a telemetry hook never breaks the host
}
