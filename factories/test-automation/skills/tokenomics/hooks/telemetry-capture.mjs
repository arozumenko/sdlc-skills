#!/usr/bin/env node
// telemetry-capture.mjs — durable per-session usage capture for team telemetry.
//
// WHY THIS EXISTS. The efficiency-audit skill answers "what did this cost" by
// reading live transcripts — but transcripts expire (~30 days) and live on each
// engineer's machine. This hook captures each session's grounded numbers AT THE
// MOMENT THEY EXIST into a git-committed ledger (.agents/telemetry/*.jsonl), so
// the team's usage survives transcript cleanup and accumulates through git.
//
// Invocation modes:
//   (stdin JSON)             Claude Code SessionEnd hook — captures the ending
//                            session, then runs a bounded sweep.
//   --sweep [--all]          Harvest every unharvested completed session for
//                            this repo (Claude + Copilot). Wired as Copilot's
//                            sessionStart hook; also fine manually / from CI.
//   --transcript <p> --session <id> [--cwd <repo>]
//                            Direct capture of one Claude transcript (tests,
//                            manual backfill).
//
// Parsing rules are lifted from the efficiency-audit skill's usage-rollup.mjs /
// copilot-usage.mjs (max-per-message-id token dedup, last-shutdown-wins model
// metrics, nanoAIU → USD) — trimmed to the single-session grain. Dollars on the
// Claude path come from ccusage metering at capture time (never a price table);
// on Copilot from the session's own billed `totalNanoAiu`. When neither is
// available the line carries tokens with costUsd null — never an estimate.
//
// STDLIB ONLY (+ the user's own ccusage shelled via npx, best-effort).
// A hook must never break the host session: main() catches everything and
// exits 0 with a one-line stderr note.
import {
  readFileSync, readdirSync, existsSync, statSync, appendFileSync, mkdirSync,
  openSync, readSync, closeSync, linkSync, copyFileSync, rmSync, mkdtempSync,
} from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, basename, dirname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { updateBatchCosts } from '../scripts/batch-cost.mjs';

const LEDGER_VERSION = 1;
const IDLE_GAP_MS = 30 * 60 * 1000;   // same active-time rule as efficiency-audit
const PROMPT_MAX_CHARS = 200;
const PROMPT_MAX_COUNT = 100;
const LIVE_GRACE_MS = 2 * 60 * 1000;  // a transcript touched this recently is likely still running
const RECAPTURE_MARGIN_MS = 5 * 60 * 1000; // source-file growth beyond the recorded end that means "the session continued"
export const USD_PER_CREDIT = 0.01;   // GitHub's published AI-credit conversion

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export function readRecords(jsonlPath) {
  const out = [];
  for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = safeParse(line);
    if (rec) out.push(rec);
  }
  return out;
}

// --- Config / ledger ---------------------------------------------------------
export function loadConfig(repo) {
  const defaults = {
    capturePrompts: false, priceAtCapture: true, maxSweep: 10,
    vscodeUserDataDirs: [], // extra VS Code user-data or workspaceStorage dirs (portable mode, --user-data-dir)
    otel: null,             // { enabled: true, endpoint: 'http://localhost:4318' } — see install-hooks --otel
  };
  const p = join(repo, '.agents', 'telemetry', 'config.json');
  if (!existsSync(p)) return defaults;
  const cfg = safeParse(readFileSync(p, 'utf8'));
  return cfg && typeof cfg === 'object' ? { ...defaults, ...cfg } : defaults;
}

/** Who is spending — git identity first (team-meaningful), OS user as fallback. */
export function whoAmI(repo) {
  const git = (key) => {
    try {
      return execFileSync('git', ['-C', repo, 'config', key], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null;
    } catch { return null; }
  };
  const email = git('user.email');
  const name = git('user.name') || userInfo().username;
  const slug = (email ? email.split('@')[0] : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return { name, email, slug };
}

/** Per-user ledger file — one appender per file means git merges never conflict. */
export function ledgerPath(repo, slug) {
  return join(repo, '.agents', 'telemetry', `usage-${slug}.jsonl`);
}

/** Every `${host}:${id}` → latest endedAt already in ANY user's ledger file. */
export function knownSessions(repo) {
  const dir = join(repo, '.agents', 'telemetry');
  const known = new Map();
  let files;
  try { files = readdirSync(dir).filter((f) => /^usage-.*\.jsonl$/.test(f) || f === 'usage.jsonl'); }
  catch { return known; }
  for (const f of files) {
    for (const rec of readRecords(join(dir, f))) {
      if (!rec?.host || !rec?.id) continue;
      const key = `${rec.host}:${rec.id}`;
      const end = rec.endedAt ? Date.parse(rec.endedAt) : 0;
      if (!known.has(key) || end > known.get(key)) known.set(key, end);
    }
  }
  return known;
}

export function appendLine(repo, slug, line) {
  const dir = join(repo, '.agents', 'telemetry');
  mkdirSync(dir, { recursive: true });
  appendFileSync(ledgerPath(repo, slug), `${JSON.stringify(line)}\n`);
}

// --- Claude transcript parsing (single-session grain) ------------------------
/**
 * Token totals the way ccusage counts them: group by message.id, MAX per id
 * (streaming rewrites the same id with a growing output count — a naive sum
 * measured ~46% off; rule pinned in efficiency-audit's tests).
 */
export function dedupUsage(records) {
  const byId = new Map();
  let anon = 0;
  for (const rec of records) {
    const u = rec.message?.usage;
    if (!u) continue;
    const id = rec.message?.id || `__anon_${anon++}`;
    const cur = {
      input: num(u.input_tokens), output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens),
      model: rec.message?.model || null,
    };
    const prev = byId.get(id);
    if (!prev) byId.set(id, cur);
    else {
      prev.input = Math.max(prev.input, cur.input);
      prev.output = Math.max(prev.output, cur.output);
      prev.cacheRead = Math.max(prev.cacheRead, cur.cacheRead);
      prev.cacheWrite = Math.max(prev.cacheWrite, cur.cacheWrite);
      if (!prev.model && cur.model) prev.model = cur.model;
    }
  }
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Set();
  for (const v of byId.values()) {
    tokens.input += v.input; tokens.output += v.output;
    tokens.cacheRead += v.cacheRead; tokens.cacheWrite += v.cacheWrite;
    if (v.model) models.add(v.model);
  }
  return { tokens, models };
}

/** Active minutes = gap-capped sum; wall = last − first. Same rule both hosts. */
function timeStats(stampsMs) {
  const s = [...stampsMs].sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < s.length; i++) {
    const dt = s[i] - s[i - 1];
    if (dt > 0 && dt <= IDLE_GAP_MS) active += dt;
  }
  return {
    startTs: s.length ? s[0] : null,
    endTs: s.length ? s[s.length - 1] : null,
    activeMin: Math.round(active / 60000),
    wallMin: s.length > 1 ? Math.round((s[s.length - 1] - s[0]) / 60000) : 0,
  };
}

// Case ids (Jira-style keys) mined from dispatch descriptions, branches,
// titles and prompts — ONLY the ids are stored, never the surrounding text, so
// this runs ungated. They make spend-per-case attribution precise: a workflow
// dispatch labelled "analyse TC-101+TC-102" names exactly what it worked on.
// `SCRUM-T101` (letter-prefixed numbers) is a real TMS shape — hence `[A-Z]?`.
// The stoplist drops the common tech tokens the loose pattern would otherwise
// swallow (ISO-8601, SHA-256, …); imperfect by design, ids are a hint not a claim.
const CASE_ID_RE = /\b[A-Z][A-Z0-9]{1,9}-[A-Z]?\d{1,6}\b/g;
const CASE_ID_STOP = new Set(['ISO', 'SHA', 'UTF', 'GPT', 'RFC', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'AES', 'MD', 'CVE', 'OAUTH', 'IPV', 'ERR']);
const CASE_ID_MAX = 50;
export function extractCaseIds(...texts) {
  const out = new Set();
  for (const t of texts) {
    if (typeof t !== 'string' || !t) continue;
    for (const m of t.match(CASE_ID_RE) ?? []) {
      if (CASE_ID_STOP.has(m.split('-')[0])) continue;
      out.add(m);
      if (out.size >= CASE_ID_MAX) return [...out].sort();
    }
  }
  return [...out].sort();
}

/** Raw user-authored text of a record, or null (injected wrappers excluded).
 * `sidechain: true` when reading a SUB-AGENT's own transcript — there every
 * record is marked isSidechain, including the dispatch prompt we need. */
function userText(rec, { sidechain = false } = {}) {
  if (rec.type !== 'user' || (rec.isSidechain && !sidechain)) return null;
  const c = rec.message?.content;
  let text = null;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    const t = c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ');
    if (t) text = t;
  }
  if (!text) return null;
  text = text.trim();
  if (!text || text.startsWith('<')) return null; // system-reminder / command wrappers
  return text;
}

/** A user prompt worth keeping, capped for the ledger. */
function promptText(rec) {
  const t = userText(rec);
  return t ? t.slice(0, PROMPT_MAX_CHARS) : null;
}

export function parseClaudeTranscript(records, { capturePrompts = false, sidechain = false } = {}) {
  let role = null;
  let branch = null;
  let firstText = null; // raw first user message — a workflow sub-agent's only naming surface
  let turns = 0, toolCalls = 0, toolErrors = 0;
  const skills = new Set();
  const dispatched = [];
  const prompts = [];
  const caseTexts = [];
  const stamps = [];
  const turnIds = new Set(); const toolIds = new Set(); const errIds = new Set();
  let anon = 0;
  for (const rec of records) {
    if (rec.type === 'agent-setting' && rec.agentSetting) role = rec.agentSetting;
    if (rec.gitBranch) branch = rec.gitBranch;
    // attributionSkill is deliberately NOT folded in: sub-agents inherit the
    // parent's active skill, so it reports loads that never happened (the same
    // conflation efficiency-audit's rollup had to split). `skills` = real
    // Skill-tool invocations only.
    // 8000 chars: a workflow dispatch opens with a ~3.5k-char boilerplate
    // preamble BEFORE the stage text the label needs (measured live at offset
    // 3564) — and firstText never reaches the ledger, only the derived label.
    if (!firstText) { const raw = userText(rec, { sidechain }); if (raw) firstText = raw.slice(0, 8000); }
    if (rec.timestamp) {
      const t = Date.parse(rec.timestamp);
      if (!Number.isNaN(t)) stamps.push(t);
    }
    if (rec.type === 'assistant') {
      const k = rec.message?.id || `__t${anon++}`;
      if (!turnIds.has(k)) { turns++; turnIds.add(k); }
    }
    {
      const p = promptText(rec);
      if (p) {
        caseTexts.push(p); // ids only are kept from this — see extractCaseIds
        if (capturePrompts && prompts.length < PROMPT_MAX_COUNT) prompts.push({ t: rec.timestamp || null, text: p });
      }
    }
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        if (b.id && toolIds.has(b.id)) continue;
        if (b.id) toolIds.add(b.id);
        toolCalls++;
        if (b.name === 'Skill' && b.input?.skill) skills.add(b.input.skill);
        if (b.name === 'Agent') {
          const description = String(b.input?.description || '').slice(0, 120);
          if (description) caseTexts.push(description); // ids only survive ungated
          dispatched.push({
            type: b.input?.subagent_type || 'unknown',
            ...(capturePrompts ? { description } : {}),
          });
        }
      } else if (b.type === 'tool_result' && b.is_error) {
        if (b.tool_use_id && errIds.has(b.tool_use_id)) continue;
        if (b.tool_use_id) errIds.add(b.tool_use_id);
        toolErrors++;
      }
    }
  }
  const { tokens, models } = dedupUsage(records);
  const caseIds = extractCaseIds(branch, ...caseTexts);
  return { role, branch, firstText, turns, toolCalls, toolErrors, skills, dispatched, prompts, caseIds, tokens, models, ...timeStats(stamps) };
}

/** `{path, id, role}` per sub-agent transcript — keyed off the .meta.json sidecar. */
export function findSubagents(projectDir, sessionId) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.meta.json') && full.includes(`${sep}subagents${sep}`)) {
        const id = e.name.replace(/\.meta\.json$/, '');
        const jsonl = join(dir, `${id}.jsonl`);
        if (!existsSync(jsonl)) continue;
        const meta = safeParse(readFileSync(full, 'utf8')) || {};
        out.push({ path: jsonl, id, role: meta.agentType || 'unknown', description: meta.description || '' });
      }
    }
  };
  walk(join(projectDir, sessionId));
  return out;
}

// --- ccusage metering at capture time (Claude dollars, best-effort) ----------
function linkOrCopy(src, dest) {
  try { linkSync(src, dest); } catch { copyFileSync(src, dest); }
}

/**
 * Meter a session's files with ccusage by staging them in a throwaway
 * CLAUDE_CONFIG_DIR — the same trick efficiency-audit uses. ccusage keys its
 * rows by the staged FOLDER name (verified: files sharing a folder fold into
 * one row; separate folders stay separate rows), so each file gets its own
 * `f<i>` folder and the rows come back as PER-FILE dollars — which is what
 * per-dispatch case attribution needs. Returns `{ totalUsd, perFileUsd }`
 * (aligned with `files`); totalUsd null = "unpriced", never $0.
 */
export function meterSession(files, { env = process.env } = {}) {
  const unpriced = { totalUsd: null, perFileUsd: files.map(() => null) };
  if (env.TOKENOMICS_NO_CCUSAGE === '1') return unpriced;
  let stage;
  try {
    stage = mkdtempSync(join(tmpdir(), 'tokenomics-'));
    for (const [i, f] of files.entries()) {
      const proj = join(stage, 'projects', `f${i}`);
      mkdirSync(proj, { recursive: true });
      linkOrCopy(f, join(proj, basename(f)));
    }
    const out = execFileSync('npx', ['--yes', 'ccusage@latest', 'claude', 'session', '--json', '--offline'], {
      env: { ...env, CLAUDE_CONFIG_DIR: stage },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 45000, maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = safeParse(out);
    const list = parsed?.session || parsed?.sessions || parsed?.data || [];
    const perFileUsd = files.map(() => null);
    let total = 0, priced = 0;
    for (const s of list) {
      if (typeof s.totalCost !== 'number') continue;
      total += s.totalCost; priced++;
      const m = /^f(\d+)$/.exec(String(s.period || s.session || s.sessionId || ''));
      if (m) { const i = Number(m[1]); if (i < perFileUsd.length) perFileUsd[i] = s.totalCost; }
    }
    return priced ? { totalUsd: total, perFileUsd } : unpriced;
  } catch {
    return unpriced;
  } finally {
    if (stage) try { rmSync(stage, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// --- dispatch labels (what a sub-agent was FOR) ------------------------------
// The label is the attribution key: the batch-cost join matches the receipt's
// own case ids against it, so it must carry whatever identifies the dispatch.
// Task-tool dispatches have a real `description`. Workflow-tool sub-agents get
// no description (meta carries only agentType) and their first user message
// opens with a shared boilerplate preamble — so slice from the first stage
// marker instead, which is where the ids live ("analyst:", "Implementer slot —
// fix round 2 for TC-101…", "Hardening gate for batch …").
const STAGE_MARKER = /\b(triage|analyst|implement\w*|combined|review\w*|fix round|carve|merge|hardening gate|mini-gate|gate for batch|report writer|write the report|diagnostician|stabiliz\w+)\b/i;
export function deriveLabel(description, firstText) {
  const d = String(description || '').trim();
  if (d) return d.slice(0, 160);
  const t = String(firstText || '');
  const m = STAGE_MARKER.exec(t);
  if (m) return t.slice(m.index, m.index + 160).replace(/\s+/g, ' ').trim();
  return t.slice(0, 160).replace(/\s+/g, ' ').trim();
}

/** One ledger line for a Claude session (parent transcript + sub-agents). */
export function captureClaudeSession(repo, transcriptPath, sessionId, { config, user, price = true } = {}) {
  const cfg = config ?? loadConfig(repo);
  const records = readRecords(transcriptPath);
  const p = parseClaudeTranscript(records, { capturePrompts: cfg.capturePrompts });
  const subMeta = findSubagents(dirname(transcriptPath), sessionId);
  // Parse each sub-agent keeping its meta alongside, THEN filter — so the
  // transcript paths handed to the meter stay index-aligned with the records
  // that receive the per-file dollars back.
  const pairs = subMeta
    .map((meta) => {
      try {
        const sp = parseClaudeTranscript(readRecords(meta.path), { sidechain: true });
        // The label is the attribution key downstream (batch-cost matches
        // receipt case ids against it). Task dispatches carry a description;
        // Workflow sub-agents don't, so derive from their first user message.
        return { meta, sub: { ...sp, role: meta.role, label: deriveLabel(meta.description, sp.firstText) } };
      } catch { return null; }
    })
    .filter(Boolean);
  const subs = pairs.map((x) => x.sub);
  if (!p.turns && !p.tokens.output && !subs.length) return null; // empty shell — not worth a line
  const models = new Set(p.models);
  for (const s of subs) for (const m of s.models) models.add(m);
  let costUsd = null;
  if (price && cfg.priceAtCapture) {
    const metered = meterSession([transcriptPath, ...pairs.map((x) => x.meta.path)]);
    costUsd = metered.totalUsd;
    // perFileUsd[0] is the parent; [1..] align with `pairs` in order.
    subs.forEach((s, i) => { s.costUsd = metered.perFileUsd[i + 1] ?? null; });
  }
  // Case ids from every naming surface: branch, prompts/dispatch labels, the
  // sub-agents' .meta.json dispatch descriptions, and the sub-agents' own text.
  const cases = extractCaseIds(
    ...p.caseIds, ...subMeta.map((s) => s.description),
    ...subs.flatMap((s) => s.caseIds ?? []),
  );
  return {
    v: LEDGER_VERSION, host: 'claude', id: sessionId,
    user: user ?? whoAmI(repo).slug,
    capturedAt: new Date().toISOString(),
    repo: basename(repo), branch: p.branch, role: p.role,
    models: [...models].sort(),
    startedAt: p.startTs ? new Date(p.startTs).toISOString() : null,
    endedAt: p.endTs ? new Date(p.endTs).toISOString() : null,
    wallMin: p.wallMin, activeMin: p.activeMin + subs.reduce((n, s) => n + s.activeMin, 0),
    turns: p.turns, toolCalls: p.toolCalls, toolErrors: p.toolErrors,
    tokens: p.tokens, // parent only — sub-agent tokens live in subagents[]
    costUsd, costSource: costUsd != null ? 'ccusage-metered' : 'none',
    cases,
    // One record PER DISPATCH (n:1), not a role roll-up: the label + per-file
    // costUsd are what lets batch-cost attribute work to individual cases.
    // Aggregating consumers (team-report byRole) sum records the same either way.
    subagents: subs.map((s) => ({
      role: s.role, label: s.label, n: 1,
      tokens: s.tokens, activeMin: s.activeMin,
      toolCalls: s.toolCalls, toolErrors: s.toolErrors,
      ...(s.costUsd != null ? { costUsd: s.costUsd } : {}),
    })),
    skills: [...p.skills].sort(), dispatches: p.dispatched.length,
    ...(cfg.capturePrompts ? { prompts: p.prompts, dispatched: p.dispatched } : {}),
  };
}

// --- Claude sweep (missed sessions — hard kills, other machines' pulls) ------
const PATH_SEPARATORS = /[/\\:._ ]/g;
export function encodeProjectPath(cwd) { return cwd.replace(PATH_SEPARATORS, '-'); }

export function claudeProjectDirs(repo, env = process.env) {
  if (env.TOKENOMICS_CLAUDE_ROOT) return [env.TOKENOMICS_CLAUDE_ROOT];
  const roots = [env.CLAUDE_CONFIG_DIR, join(homedir(), '.claude'), join(homedir(), '.config', 'claude')].filter(Boolean);
  const out = [];
  for (const r of roots) {
    const dir = join(r, 'projects', encodeProjectPath(repo));
    if (existsSync(dir)) out.push(dir);
  }
  return out;
}

// --- Copilot session parsing --------------------------------------------------
export function copilotRoots(repo, env = process.env) {
  if (env.TOKENOMICS_COPILOT_ROOT) {
    return existsSync(env.TOKENOMICS_COPILOT_ROOT) ? [env.TOKENOMICS_COPILOT_ROOT] : [];
  }
  const seen = new Set(); const out = [];
  for (const p of [
    env.COPILOT_HOME && join(env.COPILOT_HOME, 'session-state'),
    join(repo, '.copilot', 'session-state'),
    join(homedir(), '.copilot', 'session-state'),
  ]) {
    if (p && !seen.has(p) && existsSync(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

const CWD_PROBE_BYTES = 64 * 1024;
export function firstCwdOfEvents(eventsPath) {
  let fd;
  try {
    fd = openSync(eventsPath, 'r');
    const buf = Buffer.alloc(CWD_PROBE_BYTES);
    const n = readSync(fd, buf, 0, CWD_PROBE_BYTES, 0);
    const lines = buf.subarray(0, n).toString('utf8').split('\n');
    if (n === CWD_PROBE_BYTES) lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = safeParse(line);
      if (rec?.type === 'session.start') return rec.data?.context?.cwd ?? null;
    }
  } catch { /* unreadable → unknown */ }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
  return null;
}

export function sameCwdOrUnder(sessionCwd, cwd) {
  if (!cwd) return true;
  if (!sessionCwd) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const a = norm(sessionCwd); const b = norm(cwd);
  return a === b || a.startsWith(`${b}/`);
}

/**
 * One ledger line for a completed Copilot session. Returns null while the
 * session has no `session.shutdown` yet (still running — a later sweep gets it).
 * Cost is Copilot's own billed `totalNanoAiu` (credits × $0.01); sessions
 * predating usage-based billing carry tokens with costUsd null.
 */
export function captureCopilotSession(repo, eventsPath, sessionId, { config, user } = {}) {
  const cfg = config ?? loadConfig(repo);
  const events = readRecords(eventsPath).filter((r) => r.type);
  let shutdown = false;
  let branch = null; let nanoAiu = null; let role = null;
  const skills = new Set();
  const byModel = new Map(); const stamps = [];
  let turns = 0, toolCalls = 0, toolErrors = 0;
  const dispatched = []; const prompts = []; const caseTexts = [];
  const subStarted = new Map(); const subDesc = new Map(); const subs = [];
  for (const ev of events) {
    const d = ev.data ?? {};
    if (ev.timestamp) {
      const t = Date.parse(ev.timestamp);
      if (!Number.isNaN(t)) stamps.push(t);
    }
    if (ev.type === 'session.start') branch = d.context?.branch ?? branch;
    // The parent session's `--agent` — present on CLI ≥1.0.63 (verified live);
    // older streams lack the event and the line stays role:null.
    if (ev.type === 'subagent.selected') role = d.agentName ?? role;
    if (ev.type === 'skill.invoked' && d.name) skills.add(d.name);
    if (ev.type === 'session.shutdown') {
      shutdown = true;
      if (typeof d.totalNanoAiu === 'number') nanoAiu = d.totalNanoAiu;
      for (const [m, mm] of Object.entries(d.modelMetrics ?? {})) byModel.set(m, mm); // last shutdown wins
    }
    if (ev.type === 'subagent.started') {
      dispatched.push(d.agentName ?? 'unknown');
      subStarted.set(d.toolCallId, d.agentName ?? 'unknown');
      if (typeof d.agentDescription === 'string') {
        caseTexts.push(d.agentDescription.slice(0, 400));
        subDesc.set(d.toolCallId, d.agentDescription);
      }
    }
    if (ev.type === 'subagent.completed') {
      subs.push({
        role: d.agentName ?? subStarted.get(d.toolCallId) ?? 'unknown',
        label: deriveLabel(subDesc.get(d.toolCallId), ''),
        n: 1,
        // Copilot reports ONE cache-inclusive total per sub-agent — parked in
        // `input`, same convention as efficiency-audit. Read it as total tokens.
        // No per-dispatch dollars exist on Copilot (billing is one nano-AIU
        // figure at shutdown) — costUsd stays absent, and batch-cost reports
        // per-case tokens/time here, dollars only at batch level.
        tokens: { input: num(d.totalTokens), output: 0, cacheRead: 0, cacheWrite: 0 },
        activeMin: d.durationMs ? Math.round(d.durationMs / 60000) : 0,
        toolCalls: num(d.totalToolCalls), toolErrors: 0,
      });
    }
    if (!ev.agentId) { // parent-only counters; sub-agent work is summarized above
      if (ev.type === 'user.message' || ev.type === 'assistant.message') turns++;
      if (ev.type === 'tool.execution_start') toolCalls++;
      if (ev.type === 'tool.execution_complete' && d.success === false) toolErrors++;
      if (ev.type === 'user.message') {
        const text = typeof d.text === 'string' ? d.text : (typeof d.content === 'string' ? d.content : null);
        if (text && text.trim() && !text.trim().startsWith('<')) {
          caseTexts.push(text.slice(0, 1000)); // ids only survive ungated
          if (cfg.capturePrompts && prompts.length < PROMPT_MAX_COUNT) {
            prompts.push({ t: ev.timestamp || null, text: text.trim().slice(0, PROMPT_MAX_CHARS) });
          }
        }
      }
    }
  }
  if (!shutdown) return null;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Set();
  for (const [m, mm] of byModel) {
    const u = mm.usage ?? {};
    tokens.input += num(u.inputTokens); tokens.output += num(u.outputTokens);
    tokens.cacheRead += num(u.cacheReadTokens); tokens.cacheWrite += num(u.cacheWriteTokens);
    models.add(m);
  }
  // The session totals INCLUDE sub-agents — net the parent so line totals add
  // up as parent + Σ subagents, same convention as the Claude path.
  const subTotal = subs.reduce((n, s) => n + s.tokens.input, 0);
  tokens.input = Math.max(0, tokens.input - subTotal);
  const t = timeStats(stamps);
  const usd = nanoAiu === null ? null : (nanoAiu / 1e9) * USD_PER_CREDIT;
  return {
    v: LEDGER_VERSION, host: 'copilot', id: sessionId,
    user: user ?? whoAmI(repo).slug,
    capturedAt: new Date().toISOString(),
    repo: basename(repo), branch, role,
    models: [...models].sort(),
    startedAt: t.startTs ? new Date(t.startTs).toISOString() : null,
    endedAt: t.endTs ? new Date(t.endTs).toISOString() : null,
    wallMin: t.wallMin, activeMin: t.activeMin,
    turns, toolCalls, toolErrors,
    tokens,
    costUsd: usd, costSource: usd != null ? 'copilot-nano-aiu' : 'none',
    cases: extractCaseIds(branch, ...caseTexts),
    subagents: subs, // per-dispatch (n:1) with label — same shape as the Claude path
    skills: [...skills].sort(), dispatches: dispatched.length,
    ...(cfg.capturePrompts ? { prompts } : {}),
  };
}

// --- VS Code Copilot sidebar (chatSessions op-log) ---------------------------
// The sidebar's sessions live in VS Code's own storage:
//   <userData>/User/workspaceStorage/<hash>/chatSessions/<id>.jsonl
// Files are an OP-LOG, not a document: `{v}` snapshot lines, `{k:"requests",v}`
// full-array rewrites, and `{k:"requests,<idx>,<field>",v}` path updates that
// REWRITE a field as the request streams (observed: copilotCredits written 25×
// for one request). Correct totals need last-write-wins replay per request —
// summing raw matches overcounts streaming rewrites ~3× (measured).

/** Every workspaceStorage root that exists — search, never assume one path. */
export function vscodeStorageRoots(repo, env = process.env, config = {}) {
  if (env.TOKENOMICS_VSCODE_ROOT) {
    return existsSync(env.TOKENOMICS_VSCODE_ROOT) ? [env.TOKENOMICS_VSCODE_ROOT] : [];
  }
  const home = homedir();
  const bases = [];
  if (process.platform === 'darwin') bases.push(join(home, 'Library', 'Application Support'));
  if (env.APPDATA) bases.push(env.APPDATA);              // Windows
  bases.push(join(home, '.config'));                     // Linux
  const out = new Set();
  for (const base of bases) {
    for (const product of ['Code', 'Code - Insiders', 'VSCodium']) {
      const d = join(base, product, 'User', 'workspaceStorage');
      if (existsSync(d)) out.add(d);
    }
  }
  const server = join(home, '.vscode-server', 'data', 'User', 'workspaceStorage'); // WSL / remote
  if (existsSync(server)) out.add(server);
  for (const extra of config.vscodeUserDataDirs ?? []) {
    const cands = basename(extra) === 'workspaceStorage'
      ? [extra]
      : [join(extra, 'User', 'workspaceStorage'), join(extra, 'workspaceStorage')];
    for (const d of cands) if (existsSync(d)) { out.add(d); break; }
  }
  return [...out];
}

function fileUriToPath(uri) {
  if (typeof uri !== 'string' || !uri) return null;
  if (!uri.startsWith('file://')) return uri;
  let p = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  if (/^\/[A-Za-z]:[/\\]/.test(p)) p = p.slice(1); // windows /C:/... -> C:/...
  return p;
}

/** The folder a workspaceStorage hash belongs to — ONLY via its workspace.json. */
export function workspaceFolderOf(hashDir) {
  try {
    const wj = safeParse(readFileSync(join(hashDir, 'workspace.json'), 'utf8'));
    return fileUriToPath(wj?.folder ?? wj?.workspace ?? null);
  } catch { return null; }
}

const VSCODE_REQ_FIELDS = ['promptTokens', 'completionTokens', 'copilotCredits', 'modelId', 'elapsedMs', 'timestamp'];

/**
 * Replay a chatSessions op-log into final per-request records. A custom agent
 * session names its agent via modeInfo.modeInstructions.uri — the basename of
 * `.github/agents/<role>.agent.md` (verified live) — builtin modes carry none.
 */
export function parseVsCodeChatSession(text, { capturePrompts = false } = {}) {
  const state = []; // the requests array, replayed — ops splice/set into it
  let title = null; // customTitle op — VS Code's own session name
  const toRec = (q) => {
    if (!q || typeof q !== 'object' || !q.requestId) return null;
    const rec = { requestId: q.requestId };
    for (const f of VSCODE_REQ_FIELDS) if (q[f] !== undefined) rec[f] = q[f];
    const mi = q.modeInfo;
    if (mi && mi.isBuiltin === false) {
      const uri = mi.modeInstructions?.uri?.external ?? mi.modeInstructions?.uri?.path ?? '';
      const base = String(uri).split('/').pop() ?? '';
      const role = base.replace(/\.(agent|chatmode|prompt)\.md$/, '').replace(/\.md$/, '');
      if (role) rec.role = role;
    }
    if (q.result?.errorDetails) rec.errored = true;
    const m = q.message;
    const t = typeof m === 'string' ? m : (typeof m?.text === 'string' ? m.text : null);
    if (t && t.trim()) {
      rec.messageText = t.trim().slice(0, 1000); // ids mined ungated; text stored only under capturePrompts
      if (capturePrompts) rec.prompt = t.trim().slice(0, PROMPT_MAX_CHARS);
    }
    return rec;
  };
  const replaceAll = (arr) => { state.length = 0; for (const q of arr) { const rec = toRec(q); if (rec) state.push(rec); } };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const r = safeParse(line);
    if (!r || typeof r !== 'object') continue;
    // Live format (measured): k is an ARRAY of path segments; a string k is
    // tolerated for older/other writers. kind 2 + i = insert at index.
    const key = Array.isArray(r.k) ? r.k : (typeof r.k === 'string' ? r.k.split(',') : null);
    if (key === null) { // snapshot line
      if (r.v && typeof r.v === 'object') {
        if (typeof r.v.customTitle === 'string') title = r.v.customTitle;
        if (Array.isArray(r.v.requests)) replaceAll(r.v.requests);
      }
      continue;
    }
    if (key.length === 1 && key[0] === 'customTitle' && typeof r.v === 'string') { title = r.v; continue; }
    if (key.length === 1 && key[0] === 'requests' && Array.isArray(r.v)) {
      const recs = r.v.map(toRec).filter(Boolean);
      if (r.kind === 2 || typeof r.i === 'number') state.splice(typeof r.i === 'number' ? r.i : state.length, 0, ...recs);
      else replaceAll(r.v);
      continue;
    }
    if (key.length === 3 && key[0] === 'requests' && VSCODE_REQ_FIELDS.includes(String(key[2]))) {
      const idx = Number(key[1]);
      if (Number.isInteger(idx) && idx >= 0) {
        state[idx] = state[idx] ?? {};
        state[idx][String(key[2])] = r.v;
      }
    }
  }
  // Pre-oplog format: the whole session as one JSON document.
  if (!state.length) {
    const whole = safeParse(text);
    if (whole && Array.isArray(whole.requests)) replaceAll(whole.requests);
  }
  // A re-sent array op can duplicate a request at a new index — merge by
  // requestId, later occurrence wins, so nothing is ever counted twice.
  const byReqId = new Map();
  for (const r of state) {
    if (!r.requestId) continue;
    byReqId.set(r.requestId, { ...byReqId.get(r.requestId), ...r });
  }
  const reqs = [...byReqId.values()];
  if (!reqs.length) return null;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Set(); const stamps = []; const prompts = [];
  let credits = 0; let creditSeen = false; let role = null; let activeMs = 0; let errs = 0;
  for (const r of reqs) {
    tokens.input += num(r.promptTokens);
    tokens.output += num(r.completionTokens);
    if (typeof r.copilotCredits === 'number') { credits += r.copilotCredits; creditSeen = true; }
    if (r.modelId) models.add(String(r.modelId).replace(/^copilot\//, ''));
    if (!role && r.role) role = r.role;
    activeMs += num(r.elapsedMs);
    if (typeof r.timestamp === 'number') {
      stamps.push(r.timestamp);
      if (num(r.elapsedMs)) stamps.push(r.timestamp + num(r.elapsedMs));
    }
    if (r.errored) errs++;
    if (r.prompt && prompts.length < PROMPT_MAX_COUNT) prompts.push({ t: typeof r.timestamp === 'number' ? new Date(r.timestamp).toISOString() : null, text: r.prompt });
  }
  return {
    requests: reqs.length, tokens, credits: creditSeen ? credits : null, role, models, prompts,
    title: title ? title.slice(0, 80) : null,
    cases: extractCaseIds(title, ...reqs.map((r) => r.messageText)),
    activeMin: Math.round(activeMs / 60000),
    startTs: stamps.length ? Math.min(...stamps) : null,
    endTs: stamps.length ? Math.max(...stamps) : null,
    toolErrors: errs,
  };
}

/**
 * One ledger line for a sidebar chat session. `copilotCredits` is the billed
 * figure (extension ≥0.57.0); older files carry tokens only — costUsd null,
 * never an estimate. NOTE the caveat from the field: locally recorded prompt
 * tokens can undercount server-side hidden context; credits are the anchor.
 */
export function captureVsCodeSession(repo, filePath, sessionId, { config, user } = {}) {
  const cfg = config ?? loadConfig(repo);
  const p = parseVsCodeChatSession(readFileSync(filePath, 'utf8'), { capturePrompts: cfg.capturePrompts });
  if (!p) return null;
  const usd = p.credits === null ? null : p.credits * USD_PER_CREDIT;
  return {
    v: LEDGER_VERSION, host: 'copilot-vscode', id: sessionId,
    user: user ?? whoAmI(repo).slug,
    capturedAt: new Date().toISOString(),
    repo: basename(repo), branch: null, role: p.role,
    models: [...p.models].sort(),
    startedAt: p.startTs ? new Date(p.startTs).toISOString() : null,
    endedAt: p.endTs ? new Date(p.endTs).toISOString() : null,
    wallMin: p.startTs && p.endTs ? Math.round((p.endTs - p.startTs) / 60000) : 0,
    activeMin: p.activeMin,
    turns: p.requests, toolCalls: 0, toolErrors: p.toolErrors,
    tokens: p.tokens,
    costUsd: usd, costSource: usd != null ? 'copilot-credits' : 'none',
    title: p.title, cases: p.cases,
    subagents: [],
    skills: [], dispatches: 0,
    ...(cfg.capturePrompts ? { prompts: p.prompts } : {}),
  };
}

// --- OTel sink bootstrap (fire-and-forget) -----------------------------------
/**
 * When the team opted into OTel with a LOCALHOST endpoint, make sure something
 * is listening: blindly spawn the bundled stdlib sink, detached — it exits
 * instantly (code 0) if the port is already taken, so no probe is needed and
 * the hook stays synchronous. A remote collector is never ours to run.
 */
export function ensureSink(otel, env = process.env) {
  try {
    const url = new URL(otel?.endpoint || 'http://localhost:4318');
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) return false;
    const sink = join(dirname(fileURLToPath(import.meta.url)), 'otel-sink.mjs');
    const child = spawn(process.execPath, [sink, '--port', url.port || '4318'], {
      detached: true, stdio: 'ignore', env: { ...env },
    });
    child.unref();
    return true;
  } catch { return false; }
}

// --- Sweep -------------------------------------------------------------------
/**
 * Harvest completed-but-uncaptured sessions for this repo, both hosts.
 * Bounded to `max` new captures per invocation unless `all` (a first run after
 * install can face a month of history; a hook must stay quick). Skips
 * transcripts modified in the last 2 minutes — likely still running.
 *
 * A session already in the ledger is NOT frozen at its first snapshot: when
 * its source file has grown past the recorded end (+margin) — a resumed /
 * continued session that spent more after capture — it is re-parsed, and a
 * superseding line is appended if the new `endedAt` actually advanced (the
 * same guard the direct-capture path uses, so a stale re-parse never appends
 * a duplicate). The report side keeps the latest line per `host:id`
 * (team-report `dedupLines`), so totals follow the session's real life.
 */
export function sweep(repo, { config, user, all = false, env = process.env, now = Date.now() } = {}) {
  const cfg = config ?? loadConfig(repo);
  const me = user ?? whoAmI(repo).slug;
  const known = knownSessions(repo);
  const max = all ? Infinity : cfg.maxSweep;
  let captured = 0, skipped = 0;
  const budgetLeft = () => captured < max;

  // Append only when the parsed line's end actually advanced past what the
  // ledger already has — a grown-but-stale re-parse (mtime bumped, no new
  // spend) must not write a duplicate row.
  const appendIfNewer = (key, line, mtime) => {
    const knownEnd = known.get(key);
    const thisEnd = line.endedAt ? Date.parse(line.endedAt) : 0;
    known.set(key, Math.max(mtime, thisEnd));
    if (knownEnd !== undefined && thisEnd <= knownEnd) return false;
    appendLine(repo, me, line);
    captured++;
    return true;
  };

  // Claude: this repo's project dir(s) — top-level *.jsonl are the sessions.
  for (const projDir of claudeProjectDirs(repo, env)) {
    let files;
    try { files = readdirSync(projDir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files.sort()) {
      const id = basename(f, '.jsonl');
      const full = join(projDir, f);
      let mtime;
      try { mtime = statSync(full).mtimeMs; } catch { continue; }
      if (now - mtime < LIVE_GRACE_MS) continue; // likely live
      const knownEnd = known.get(`claude:${id}`);
      if (knownEnd !== undefined && mtime <= knownEnd + RECAPTURE_MARGIN_MS) continue; // captured, no growth since
      if (!budgetLeft()) { skipped++; continue; }
      try {
        const line = captureClaudeSession(repo, full, id, { config: cfg, user: me });
        if (line) appendIfNewer(`claude:${id}`, line, mtime);
      } catch { /* one bad transcript never stops the sweep */ }
    }
  }

  // Copilot: pooled store, cwd-filtered by a bounded head probe before parsing.
  // No live-grace here — captureCopilotSession returns null until the stream
  // carries a session.shutdown, and a resumed session writes a NEW shutdown
  // (last one wins), which is exactly what the growth re-capture picks up.
  for (const root of copilotRoots(repo, env)) {
    let ids;
    try { ids = readdirSync(root); } catch { continue; }
    for (const id of ids.sort()) {
      const eventsPath = join(root, id, 'events.jsonl');
      if (!existsSync(eventsPath)) continue;
      let mtime;
      try { mtime = statSync(eventsPath).mtimeMs; } catch { continue; }
      const knownEnd = known.get(`copilot:${id}`);
      if (knownEnd !== undefined && mtime <= knownEnd + RECAPTURE_MARGIN_MS) continue; // captured, no growth since
      if (!sameCwdOrUnder(firstCwdOfEvents(eventsPath), repo)) continue;
      if (!budgetLeft()) { skipped++; continue; }
      try {
        const line = captureCopilotSession(repo, eventsPath, id, { config: cfg, user: me });
        if (line) appendIfNewer(`copilot:${id}`, line, mtime);
      } catch { /* ditto */ }
    }
  }

  // VS Code sidebar: chatSessions op-logs, matched to this repo through each
  // hash's workspace.json (both directions — the workspace may be the repo, a
  // subfolder, or a parent monorepo folder). These files have no completion
  // marker, so a session captured mid-life is simply RE-captured once the file
  // grows (mtime newer than the recorded end) — same growth rule as above.
  for (const root of vscodeStorageRoots(repo, env, cfg)) {
    let hashes;
    try { hashes = readdirSync(root); } catch { continue; }
    for (const hash of hashes.sort()) {
      const hashDir = join(root, hash);
      const folder = workspaceFolderOf(hashDir);
      if (!folder || !(sameCwdOrUnder(folder, repo) || sameCwdOrUnder(repo, folder))) continue;
      const dir = join(hashDir, 'chatSessions');
      let files;
      try { files = readdirSync(dir).filter((f) => /\.jsonl?$/.test(f)); } catch { continue; }
      for (const f of files.sort()) {
        const id = f.replace(/\.jsonl?$/, '');
        const key = `copilot-vscode:${id}`;
        const full = join(dir, f);
        let mtime;
        try { mtime = statSync(full).mtimeMs; } catch { continue; }
        if (now - mtime < LIVE_GRACE_MS) continue; // likely mid-chat
        const knownEnd = known.get(key);
        if (knownEnd !== undefined && mtime <= knownEnd + RECAPTURE_MARGIN_MS) continue; // no growth
        if (!budgetLeft()) { skipped++; continue; }
        try {
          const line = captureVsCodeSession(repo, full, id, { config: cfg, user: me });
          if (line) { appendLine(repo, me, line); known.set(key, mtime); captured++; }
        } catch { /* one bad file never stops the sweep */ }
      }
    }
  }
  return { captured, skipped };
}

// --- CLI / hook entry ---------------------------------------------------------
function readStdinJson() {
  try {
    if (process.stdin.isTTY) return null;
    const txt = readFileSync(0, 'utf8');
    return txt.trim() ? safeParse(txt) : null;
  } catch { return null; }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const repo = arg('--cwd') || env.CLAUDE_PROJECT_DIR || process.cwd();
  const cfg = loadConfig(repo);
  const me = whoAmI(repo).slug;
  let captured = 0;

  // OTel opted in with a localhost endpoint → make sure the sink is up.
  if (cfg.otel?.enabled && env.TOKENOMICS_NO_SINK !== '1') ensureSink(cfg.otel, env);

  // After any append, refresh the per-batch cost.json files: a pure recompute
  // joining the ledger to the pipeline's receipts (batch-cost.mjs). Never
  // fatal — cost.json is a derivation and can always be rebuilt on demand.
  const refreshBatchCosts = () => {
    if (env.TOKENOMICS_NO_BATCH_COST === '1') return;
    try {
      const n = updateBatchCosts(repo).length;
      if (n) process.stderr.write(`tokenomics: refreshed cost.json for ${n} batch(es)\n`);
    } catch { /* receipts absent or malformed — nothing to refresh */ }
  };

  if (argv.includes('--sweep')) {
    const r = sweep(repo, { config: cfg, user: me, all: argv.includes('--all'), env });
    process.stderr.write(`tokenomics: swept ${r.captured} session(s)${r.skipped ? `, ${r.skipped} deferred (bounded — rerun or use --all)` : ''}\n`);
    if (r.captured) refreshBatchCosts();
    return 0;
  }

  // Direct capture: explicit flags (tests/manual) or Claude SessionEnd stdin.
  let transcript = arg('--transcript');
  let sessionId = arg('--session');
  if (!transcript) {
    const hook = readStdinJson();
    if (hook?.transcript_path) {
      transcript = hook.transcript_path;
      sessionId = hook.session_id || basename(hook.transcript_path, '.jsonl');
    }
  }
  if (transcript && existsSync(transcript)) {
    const id = sessionId || basename(transcript, '.jsonl');
    const known = knownSessions(repo);
    const line = captureClaudeSession(repo, transcript, id, { config: cfg, user: me });
    if (line) {
      const prevEnd = known.get(`claude:${id}`);
      const thisEnd = line.endedAt ? Date.parse(line.endedAt) : 0;
      if (prevEnd === undefined || thisEnd > prevEnd) { appendLine(repo, me, line); captured++; }
    }
  }
  // Every capture moment is also a harvest moment (Copilot sessions, hard-killed
  // Claude ones) — bounded, so the hook stays quick.
  const r = sweep(repo, { config: cfg, user: me, env });
  process.stderr.write(`tokenomics: captured ${captured + r.captured} session(s) → .agents/telemetry/usage-${me}.jsonl\n`);
  if (captured + r.captured) refreshBatchCosts();
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let code = 0;
  try { code = main(); }
  catch (err) { process.stderr.write(`tokenomics: capture failed (session unaffected): ${err?.message || err}\n`); }
  process.exit(code); // never non-zero — a telemetry hook must not break the host session
}
