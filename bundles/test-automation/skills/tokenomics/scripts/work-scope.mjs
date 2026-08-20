#!/usr/bin/env node
// work-scope.mjs — a session's own declaration of WHAT it is working on,
// written at the moment the work begins, not reconstructed after the fact.
//
//   node work-scope.mjs open    --session <id> [--intent automation] [--batch <slug>]
//                               [--cases ID,ID,…] [--source tms|manual-qa|…] [--repo <root>]
//   node work-scope.mjs outcome --session <id> ID=outcome [ID=outcome …]
//   node work-scope.mjs close   --session <id>   # also renders the batch report
//   node work-scope.mjs status  --session <id>   #   (<batch dir>/batch-report.md)
//   node work-scope.mjs show    --session <id>   #   and prints any receipt drift
//   node work-scope.mjs list    [--open]
//
// `status` is the LIVE read: what this still-running session has spent and
// which dispatches have finished. Nothing is written — the ledger stays
// session-grain and lands at session end (`--fast` skips metering).
//
// One JSON file per session at .agents/telemetry/automation/scopes/<session>.json —
// committed like the ledger, so scope survives transcript expiry and travels
// with the repo. The capture hook joins it to the session's ledger line, which
// replaces regex-guessing for declared sessions and lets reports split
// automation spend from everything else.
//
// DELIBERATELY GENERIC — nothing here is automation-specific:
//   * `intent` is an open string ('automation', 'manual-testing', 'other', …),
//     so the manual-qa bundle can adopt the identical record.
//   * case ids are opaque ('ELITEA-2312', 'TC-101' — any shape).
//   * `outcomes` vocabulary is open ('automated'/'blocked' here,
//     'PASS'/'FAIL' for a manual run) — consumers filter by intent.
//
// The session id comes from the SessionStart announce hook (scope-hook.mjs
// prints it into context) or CLAUDE_SESSION_ID. A host where neither exists
// (Copilot) may pass --session auto: the file is created as pending-<stamp>
// and the capture sweep claims it for the real session by time window.
//
// STDLIB ONLY. Idempotent: re-open merges, outcomes overwrite per id.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCOPE_VERSION = 1;

export function scopesDir(repo) { return join(repo, '.agents', 'telemetry', 'automation', 'scopes'); }
export function scopePath(repo, session) { return join(scopesDir(repo), `${session}.json`); }

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

/** Filename-safe session id — it becomes a path fragment. */
export function safeSession(id) { return String(id || '').replace(/[^A-Za-z0-9._-]/g, ''); }

export function openScope(repo, { session, intent, batch, cases = [], source, now = new Date().toISOString() } = {}) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required — --session <id> (the SessionStart hook prints it), or --session auto on hosts without one');
  const path = scopePath(repo, sid);
  const prev = readJson(path) ?? {};
  const scope = {
    v: SCOPE_VERSION, session: sid,
    intent: intent ?? prev.intent ?? 'automation',
    ...((batch ?? prev.batch) ? { batch: batch ?? prev.batch } : {}),
    cases: [...new Set([...(prev.cases ?? []), ...cases.filter(Boolean)])].sort(),
    ...((source ?? prev.source) ? { source: source ?? prev.source } : {}),
    declaredAt: prev.declaredAt ?? now,
    updatedAt: now,
    ...(prev.outcomes ? { outcomes: prev.outcomes } : {}),
    ...(prev.closedAt ? { closedAt: prev.closedAt } : {}),
  };
  writeJson(path, scope);
  return scope;
}

/** outcomes: { id: 'automated' | 'blocked' | 'PASS' | … } — overwrite per id, latest wins. */
export function recordOutcomes(repo, { session, outcomes = {}, now = new Date().toISOString() } = {}) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required');
  const path = scopePath(repo, sid);
  // Self-healing: an outcome on an undeclared session still lands — a record
  // with a gap beats a lost record.
  const scope = readJson(path) ?? { v: SCOPE_VERSION, session: sid, intent: 'automation', cases: [], declaredAt: now };
  scope.outcomes = scope.outcomes ?? {};
  for (const [id, outcome] of Object.entries(outcomes)) {
    if (!id || !outcome) continue;
    scope.outcomes[id] = { outcome: String(outcome), at: now };
    if (!scope.cases.includes(id)) scope.cases.push(id);
  }
  scope.cases.sort();
  scope.updatedAt = now;
  writeJson(path, scope);
  return scope;
}

export function closeScope(repo, { session, now = new Date().toISOString() } = {}) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required');
  const path = scopePath(repo, sid);
  const scope = readJson(path);
  if (!scope) throw new Error(`no scope declared for session ${sid} — nothing to close`);
  scope.closedAt = now;
  scope.updatedAt = now;
  writeJson(path, scope);
  return scope;
}

export function listScopes(repo, { openOnly = false } = {}) {
  const dir = scopesDir(repo);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const s = readJson(join(dir, name));
    if (!s) continue;
    if (openOnly && s.closedAt) continue;
    out.push(s);
  }
  return out;
}

/**
 * LIVE read of a session that is still running — "what has this cost so far".
 *
 * The ledger is session-grain and written at SessionEnd (plus the start-time
 * sweep), and NO hook fires telemetry when a sub-agent finishes: a finished
 * dispatch is on disk in the transcript store, but nothing has appended a
 * ledger line yet. Appending one per dispatch would mean re-metering the whole
 * session on every stop and piling superseded rows into the ledger — so the
 * answer to "show me now" is to READ the live transcript instead of writing.
 * Nothing is appended here; the ledger still updates once, at session end.
 */
export async function sessionStatus(repo, session, { price = true } = {}) {
  const sid = safeSession(session);
  if (!sid) throw new Error('a session id is required');
  const cap = await import('../hooks/telemetry-capture.mjs');
  const cfg = cap.loadConfig(repo);
  for (const dir of cap.claudeProjectDirs(repo)) {
    const path = join(dir, `${sid}.jsonl`);
    if (!existsSync(path)) continue;
    const scope = readJson(scopePath(repo, sid));
    // Fast path: the SubagentStop hook already metered each finished dispatch
    // into the live log, so only the PARENT transcript needs pricing here —
    // one ccusage call instead of one per transcript.
    const log = cap.readDispatchLog(cap.dispatchLogPath(repo, sid));
    if (price && log.size) {
      const line = cap.captureClaudeSession(repo, path, sid, { config: cfg, user: 'live', price: false });
      if (!line) continue;
      let known = 0;
      for (const s of line.subagents) {
        const rec = s.id && log.get(s.id);
        if (rec && typeof rec.costUsd === 'number') { s.costUsd = rec.costUsd; known++; }
      }
      const parent = cap.meterSession([path]);
      if (parent.totalUsd != null) {
        const subs = line.subagents.reduce((n, s) => n + (typeof s.costUsd === 'number' ? s.costUsd : 0), 0);
        line.costUsd = Math.round((parent.totalUsd + subs) * 100) / 100;
      }
      return { line, scope, liveLog: { recorded: log.size, applied: known } };
    }
    const line = cap.captureClaudeSession(repo, path, sid, { config: cfg, user: 'live', price });
    if (line) return { line, scope };
  }
  return null;
}

const money = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : 'unpriced');
export function renderStatus({ line, scope, liveLog }) {
  const tok = (t) => Object.values(t ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const subTok = line.subagents.reduce((n, s) => n + tok(s.tokens), 0);
  const out = [`work-scope: session ${line.id} — LIVE (nothing written; the ledger updates at session end)`];
  if (scope) {
    const oc = Object.entries(scope.outcomes ?? {}).map(([id, o]) => `${id}=${o?.outcome ?? o}`).join(', ');
    out.push(`  scope: ${scope.intent}${scope.batch ? ` / ${scope.batch}` : ''} — ${scope.cases.length} case(s)${oc ? `  ·  outcomes: ${oc}` : '  ·  no outcomes recorded yet'}`);
  } else {
    out.push('  scope: NOT DECLARED — run `work-scope.mjs open …` (this session\'s spend will land unattributed)');
  }
  out.push(`  so far: ${money(line.costUsd)}  ·  ${(tok(line.tokens) + subTok).toLocaleString()} tokens  ·  ${line.activeMin}m active  ·  ${line.turns} turns  ·  ${line.toolCalls} tool calls (${line.toolErrors} err)`);
  out.push(`  cases seen: ${line.cases.length ? line.cases.join(', ') : '—'}`);
  out.push(`  dispatches (${line.subagents.length}):`);
  for (const s of line.subagents) {
    out.push(`    ${String(s.role).padEnd(26)} ${money(s.costUsd).padStart(8)}  ${tok(s.tokens).toLocaleString().padStart(11)} tok  ${String(s.activeMin).padStart(3)}m  ${String(s.toolCalls).padStart(3)} tools  ${s.label.slice(0, 46)}`);
  }
  if (!line.subagents.length) out.push('    (none finished yet — a running dispatch has no transcript to read)');
  if (liveLog) out.push(`  (dispatch dollars read from the live log — ${liveLog.applied}/${liveLog.recorded} recorded by the SubagentStop hook; only the parent was metered here)`);
  return out.join('\n');
}

/**
 * Closing a batch scope also GENERATES the batch report — close is the batch's
 * human milestone and the last moment the lead can still fix the receipt, so
 * the session is captured, the cost recomputed and the report rendered here,
 * and any receipt-vs-records drift is printed while it is still actionable.
 * Best-effort by design: no receipt, no ledger, or a missing sibling script
 * must never fail the close itself.
 * Dynamic imports keep this module cycle-free (batch-cost imports listScopes).
 */
export async function generateBatchReports(repo, scope) {
  if (!scope?.batch) return [];
  try {
    // FIRST capture this session into the ledger. Close runs INSIDE the
    // still-running session, so without this its own spend is missing from
    // the report it is generating. The session's real end appends a
    // superseding line; readers dedupe latest-wins.
    if (scope.session) {
      try {
        const cap = await import('../hooks/telemetry-capture.mjs');
        cap.captureSessionNow(repo, scope.session);
      } catch { /* no transcript / metering unavailable — report what the ledger has */ }
    }
    const { updateBatchCosts, foldGateRuns } = await import('./batch-cost.mjs');
    const { renderBatchMarkdown, renderBatchHtml, renderBatchTokenomicsMarkdown, renderBatchTokenomicsHtml } = await import('./team-report.mjs');
    // The declared batch may be a top slug, a nested wave's full path, or just
    // the wave's own name — resolve all three.
    let costs = updateBatchCosts(repo, { batch: scope.batch });
    if (!costs.length) {
      const all = updateBatchCosts(repo, { write: false });
      const matches = all.filter((c) => c.batch === scope.batch || c.batch.endsWith(`/${scope.batch}`));
      costs = matches.flatMap((m) => updateBatchCosts(repo, { batch: m.batch }));
    }
    const out = [];
    for (const c of costs) {
      const dir = join(repo, '.agents', 'automation', ...c.batch.split('/'));
      // Gate verdicts written to the telemetry side mid-run move home now, so
      // the closed batch ships one committed gate-runs.jsonl.
      try { foldGateRuns(repo, c.batch, dir); } catch { /* record survives on the telemetry side */ }
      const path = join(dir, 'batch-report.md');
      writeFileSync(path, `${renderBatchMarkdown(c)}\n`);
      // The shareable page, same rhythm as manual-qa's HTML tokenomics report.
      writeFileSync(join(dir, 'batch-report.html'), `${renderBatchHtml(c)}\n`);
      // The OTHER unfolding of the same cost.json: token composition + cache
      // hit rate per role/stage/case — where the delivery report shows only
      // the honest real-work figure.
      writeFileSync(join(dir, 'batch-tokenomics.md'), `${renderBatchTokenomicsMarkdown(c)}\n`);
      writeFileSync(join(dir, 'batch-tokenomics.html'), `${renderBatchTokenomicsHtml(c)}\n`);
      // Hyperfactory dataset row — compliance as a side effect of closing:
      // every close appends/replaces this batch's row in the accumulating
      // export (identity from factory-profile.json; missing profile just
      // means null identity + a §7 checklist warning, never a failed close).
      try {
        const { appendRun, loadProfile } = await import('./build-tokenomics-export.mjs');
        const { profile } = loadProfile(repo);
        appendRun(repo, c, profile);
      } catch { /* export is best-effort; the close artifacts above are the deliverable */ }
      out.push({ path, cost: c });
    }
    return out;
  } catch { return []; }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const cmd = argv[0];
  const arg = (name) => {
    const i = argv.indexOf(name);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !String(v).startsWith('--') ? v : undefined;
  };
  const repo = arg('--repo') ?? env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let session = arg('--session') ?? env.CLAUDE_SESSION_ID ?? null;
  if (session === 'auto') session = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  try {
    if (cmd === 'open') {
      const scope = openScope(repo, {
        session,
        intent: arg('--intent'),
        batch: arg('--batch'),
        cases: (arg('--cases') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
        source: arg('--source'),
      });
      process.stderr.write(`work-scope: ${scope.session} — ${scope.intent}${scope.batch ? ` / ${scope.batch}` : ''}, ${scope.cases.length} case(s)\n`);
      return 0;
    }
    if (cmd === 'outcome') {
      const pairs = argv.slice(1).filter((a) => !a.startsWith('--') && a.includes('='));
      const outcomes = Object.fromEntries(pairs.map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), p.slice(i + 1)];
      }));
      if (!Object.keys(outcomes).length) { process.stderr.write('work-scope: outcome needs ID=outcome pairs\n'); return 1; }
      const scope = recordOutcomes(repo, { session, outcomes });
      process.stderr.write(`work-scope: ${scope.session} — ${Object.keys(scope.outcomes).length} outcome(s) recorded\n`);
      return 0;
    }
    if (cmd === 'close') {
      const scope = closeScope(repo, { session });
      process.stderr.write(`work-scope: ${safeSession(session)} closed\n`);
      // Close generates the batch report — see generateBatchReports.
      const reports = await generateBatchReports(repo, scope);
      // The receipt is written by an AGENT (the workflow's report writer, or
      // the lead on a sequential run) — so it can simply be absent: an
      // interrupted run, a dead writer, a loop that never reached its end.
      // Say so loudly instead of rendering nothing: without it there is no
      // delivery record for any audit to divide by.
      if (scope.batch && !reports.length) {
        process.stderr.write(
          `work-scope: ⚠ NO RECEIPT for batch '${scope.batch}' — .agents/automation/${scope.batch}/report.json is missing, so no batch report was written.\n`
          + '  The receipt is an agent write; an interrupted run leaves none. Rebuild it from what IS on disk — gate-runs.jsonl (script-authored verdicts),\n'
          + '  .agents/telemetry/automation/returns/ (per-dispatch returns; legacy _returns/), the run journal and git — see the orchestration playbook § Interruption and resumption,\n'
          + `  then re-run: work-scope.mjs close --session ${safeSession(session)} (the render is idempotent).\n`,
        );
      }
      for (const { path, cost } of reports) {
        process.stderr.write(`work-scope: batch report → ${path}\n`);
        const r = cost.records;
        if (r?.gateDrift) process.stderr.write(`work-scope: ⚠ GATE DRIFT on ${cost.batch} — receipt '${r.gateDrift.receipt ?? 'not-run'}' vs recorded '${r.gateDrift.recorded}': write the verdict back into report.json BEFORE walking away\n`);
        if (r?.outcomeDrift?.length) process.stderr.write(`work-scope: ⚠ OUTCOME DRIFT on ${cost.batch} (${r.outcomeDrift.map((d) => `${d.id}: receipt=${d.receipt ?? '—'} declared=${d.declared}`).join('; ')}) — reconcile report.json\n`);
      }
      return 0;
    }
    if (cmd === 'status') {
      const st = await sessionStatus(repo, session, { price: !argv.includes('--fast') });
      if (!st) { process.stderr.write(`work-scope: no live transcript found for session ${safeSession(session)} in ${repo}\n`); return 1; }
      process.stdout.write(`${renderStatus(st)}\n`);
      return 0;
    }
    if (cmd === 'show') {
      const s = session && readFileSync(scopePath(repo, safeSession(session)), 'utf8');
      process.stdout.write(s);
      return 0;
    }
    if (cmd === 'list') {
      for (const s of listScopes(repo, { openOnly: argv.includes('--open') })) {
        process.stdout.write(`${s.session}  ${s.intent}${s.batch ? `  ${s.batch}` : ''}  ${s.cases.length} case(s)${s.closedAt ? '  closed' : ''}\n`);
      }
      return 0;
    }
    process.stderr.write('usage: work-scope.mjs open|outcome|close|show|list … (see file header)\n');
    return 1;
  } catch (err) {
    process.stderr.write(`work-scope: ${err?.message ?? err}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (err) => {
    process.stderr.write(`work-scope: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
