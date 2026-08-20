#!/usr/bin/env node
// usage-rollup.mjs — token/cost/time efficiency rollup for AI coding-agent
// sessions, joined to the role/sub-agent/bundle that spent them.
//
// COST IS 100% ccusage. This script never prices tokens itself — no pricing
// table, no fallback math. `ccusage` (https://github.com/ccusage/ccusage) owns
// every dollar via `--mode auto|calculate|display` (LiteLLM pricing). What THIS
// script adds is the JOIN ccusage can't do on its own: it reads the local
// transcripts to discover which ROLE / SUB-AGENT / BUNDLE each unit belongs to.
//
// Per-sub-agent cost is METERED, not estimated (verified, ccusage v20.0.14):
//   - `ccusage claude session` keys a session by its transcript FILENAME and
//     only globs the top of each project dir — so sub-agents (which live in a
//     `<session>/subagents/` subfolder) are normally invisible to it.
//   - Stage a temp dir with the parent + every sub-agent transcript FLATTENED
//     into one project folder, point ccusage at it via CLAUDE_CONFIG_DIR, and
//     ccusage meters EACH FILE separately with real per-model pricing. The
//     per-file costs sum to the session's true total to the cent. That is the
//     primary path (source 'ccusage-metered') — see stageFlattened + meterFiles.
//   - Fallback only if metering is unavailable (no `ccusage claude`, staging
//     failed): the default `ccusage session` gives the parent-session total
//     (which already folds in sub-agents), and allocateCost splits it across
//     units by cost-weighted token share (source 'ccusage-allocated'). Still
//     100% ccusage dollars — only the split is derived, and it is labelled so.
//
// STDLIB ONLY (+ the user's own `ccusage` shelled via npx). See ../SKILL.md and
// ../references/methodology.md.
import {
  readFileSync, readdirSync, existsSync, statSync, writeFileSync,
  mkdtempSync, mkdirSync, linkSync, copyFileSync, rmSync,
  openSync, readSync, closeSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, basename, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderDeliveryMarkdown } from './run-reports.mjs';

// ccusage reads real files only (it does NOT follow symlinks). Hard-link each
// staged transcript — a real directory entry sharing the source inode, so no
// data is copied — and fall back to a full copy across filesystem boundaries
// (EXDEV) where hard links aren't allowed.
function linkOrCopy(src, dest) {
  try { linkSync(src, dest); } catch { copyFileSync(src, dest); }
}

// Recursively collect files under `dir` matching `test(fullPath)`. Used to find
// sub-agent transcripts at ANY depth: today Claude Code stores every descendant
// sub-agent flat under the top session's single `subagents/` folder (depth 1),
// but walking recursively future-proofs against nested `subagents/subagents/`.
function collectFilesRecursive(dir, test) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFilesRecursive(full, test));
    else if (test(full)) out.push(full);
  }
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// YYYY-MM-DD in LOCAL time. Day bucketing and the --since/--until window use
// the local calendar day, matching ccusage's own default --since/--until
// filtering — a UTC date here would disagree with ccusage near midnight.
const localDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- Project/session discovery (same encoding as session-retrospective's
// distill-sessions.mjs, so a project resolves identically for both skills).
// ccusage reads the same store: ~/.claude/projects and ~/.config/claude/projects,
// overridable via CLAUDE_CONFIG_DIR. -----------------------------------------
// Every path separator and filename-awkward character becomes a dash. Measured
// against 28 real project dirs this class resolves all 28; the earlier `[/.]`
// resolved 6 — it missed underscores and spaces, and on Windows it missed
// everything, since `C:\Users\x` holds neither a slash nor a dot. A miss falls
// through to opening transcripts across every project dir to read their `cwd`.
const PATH_SEPARATORS = /[/\\:._ ]/g;

export function encodeProjectPath(cwd) {
  return cwd.replace(PATH_SEPARATORS, '-');
}

// Windows mixes `\` and `/` and compares case-insensitively; an exact string
// compare there misses the directory it is standing in.
function sameCwd(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const n = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32'
    ? n(a).toLowerCase() === n(b).toLowerCase()
    : n(a) === n(b);
}

function safeParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

export function readRecords(jsonlPath) {
  const txt = readFileSync(jsonlPath, 'utf8');
  const out = [];
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const rec = safeParse(line);
    if (rec) out.push(rec);
  }
  return out;
}

// `cwd` sits on the first records, so probe a bounded prefix. The fallback in
// resolveProjectDir opens one transcript per project dir, and these files reach
// hundreds of megabytes — reading them whole to learn one string near the top
// is what made the scan the slowest part of a rollup.
const CWD_PROBE_BYTES = 64 * 1024;

function firstCwdOf(jsonlPath) {
  let fd;
  try {
    fd = openSync(jsonlPath, 'r');
    const buf = Buffer.alloc(CWD_PROBE_BYTES);
    const n = readSync(fd, buf, 0, CWD_PROBE_BYTES, 0);
    const lines = buf.subarray(0, n).toString('utf8').split('\n');
    if (n === CWD_PROBE_BYTES) lines.pop(); // truncated tail line, not data
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = safeParse(line);
      if (rec?.cwd) return rec.cwd;
    }
  } catch { /* ignore */ }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
  return null;
}

export function resolveProjectDir(cwd, projectsRoot) {
  const direct = join(projectsRoot, encodeProjectPath(cwd));
  if (existsSync(direct)) return direct;
  if (!existsSync(projectsRoot)) return null;
  for (const name of readdirSync(projectsRoot)) {
    const dir = join(projectsRoot, name);
    let jsonls;
    try { jsonls = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); }
    catch { continue; }
    for (const f of jsonls) if (sameCwd(firstCwdOf(join(dir, f)), cwd)) return dir;
  }
  return null;
}

// --- Token extraction (for SHARES/metrics only — never for dollars) ---------
export function emptyUsage() {
  // `cacheCreation` stays the flattened total every consumer already reads.
  // `cacheCreation1h` is the slice of it written at the 1-hour TTL, tracked
  // separately because the two are priced differently — see COST_RATIO.
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cacheCreation1h: 0, models: new Set() };
}

/**
 * Cache-write tokens, split by TTL. Anthropic prices a 5-minute cache write at
 * 1.25x base input and a 1-hour write at 2x — a 60% difference that the
 * flattened `cache_creation_input_tokens` field hides completely.
 *
 * This is not hypothetical on long sessions: sampling this machine's own
 * transcripts, essentially every cache write is `ephemeral_1h`. When a session
 * is uniformly one TTL the distinction cancels out of the split, but a session
 * that changes TTL partway (the documented behaviour when an account enters
 * usage overage) gets its cache-heavy units mis-weighted against its
 * output-heavy ones, in the direction of under-crediting the sub-agent that
 * paid to build the cache everyone else then read cheaply.
 */
export function splitCacheCreation(u) {
  const cc = u?.cache_creation;
  if (cc && typeof cc === 'object') {
    const h1 = num(cc.ephemeral_1h_input_tokens);
    const m5 = num(cc.ephemeral_5m_input_tokens);
    // Trust the itemized fields only when they account for the flat total;
    // otherwise the schema has moved and the flat number is the safer one.
    if (h1 + m5 > 0) return { total: h1 + m5, h1 };
  }
  return { total: num(u?.cache_creation_input_tokens), h1: 0 };
}

/**
 * Sum `message.usage` across a transcript's records the way ccusage does:
 * group by `message.id` and take the MAX `output_tokens` for each id. Claude
 * Code writes the same assistant message id on multiple streaming lines with a
 * GROWING output count while input/cache stay constant — so a naive
 * sum/first-occurrence over-or-under-counts output badly (measured ~46% low on
 * a real session). Max-per-id reproduces ccusage's token totals exactly, which
 * is what lets the derived per-unit SHARES be trustworthy. This rule is
 * empirical (ccusage v20.0.14) and may drift; the unit tests pin it.
 */
export function dedupUsage(records) {
  const byId = new Map(); // message.id -> {input,output,cacheRead,cacheCreation,model}
  let anonKey = 0;
  for (const rec of records) {
    const u = rec.message?.usage;
    if (!u) continue;
    const id = rec.message?.id || `__anon_${anonKey++}`; // no id -> never merge
    const prev = byId.get(id);
    const cc = splitCacheCreation(u);
    const cur = {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheCreation: cc.total,
      cacheCreation1h: cc.h1,
      model: rec.message?.model || null,
    };
    if (!prev) byId.set(id, cur);
    else {
      // same request: output grows across chunks, input/cache are fixed.
      prev.output = Math.max(prev.output, cur.output);
      prev.input = Math.max(prev.input, cur.input);
      prev.cacheRead = Math.max(prev.cacheRead, cur.cacheRead);
      prev.cacheCreation = Math.max(prev.cacheCreation, cur.cacheCreation);
      prev.cacheCreation1h = Math.max(prev.cacheCreation1h, cur.cacheCreation1h);
      if (!prev.model && cur.model) prev.model = cur.model;
    }
  }
  const usage = emptyUsage();
  for (const v of byId.values()) {
    usage.input += v.input;
    usage.output += v.output;
    usage.cacheRead += v.cacheRead;
    usage.cacheCreation += v.cacheCreation;
    usage.cacheCreation1h += v.cacheCreation1h;
    if (v.model) usage.models.add(v.model);
  }
  return usage;
}

/**
 * Parse one transcript: deduped usage + role/branch/date/turns, plus activity
 * metrics — tool calls (total + errored), skills loaded (names), and sub-agents
 * this unit dispatched (names). All read straight from the records.
 *
 * `seen` = { msg: Set, tool: Set } is an OPTIONAL global dedup context shared
 * across every unit in a run. Claude Code forks/resumes a session by REPLAYING
 * the prior session's records (verified: two sessions sharing 94 message-ids),
 * so without dedup a fork's tokens/turns/tool-calls get double-counted (ccusage
 * already dedups cost by message-id, which is why a fork meters to ~$0 — this
 * makes the transcript metrics match). A message-id / tool-use-id already seen
 * in an EARLIER unit is a replay and skipped; ids new to this unit are counted
 * and then merged into `seen`. Passing no `seen` = within-file dedup only (the
 * original behaviour), used by the unit tests and the no-ccusage path.
 */
export function parseUnit(records, seen = { msg: new Set(), tool: new Set() }) {
  let agentSetting = null;
  let gitBranch = '?';
  let turns = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  const skills = new Set();            // REAL `Skill` tool calls — behaviour
  const skillsAttributed = new Set();  // inherited host attribution — context, not behaviour
  const dispatched = [];
  const stamps = [];
  const usageRecs = [];         // usage-bearing records new to this unit (fed to dedupUsage)
  const usageMsgIds = new Set(); // msgIds of those records, merged into `seen` after the loop
  const localTool = new Set();  // tool-use ids counted this unit
  const localErr = new Set();   // tool-result error ids counted this unit
  const turnMsgs = new Set();   // msgIds already counted as a turn this unit
  let anon = 0;
  for (const rec of records) {
    if (rec.type === 'agent-setting' && rec.agentSetting) agentSetting = rec.agentSetting;
    if (rec.gitBranch) gitBranch = rec.gitBranch;
    // ATTRIBUTION IS NOT INVOCATION. `attributionSkill` is stamped on records
    // by the host and sub-agents INHERIT the parent's active skill, so folding
    // it into `skills` reports loads that never happened: one campaign showed
    // 4,313 inherited `sync-base-branches` attributions and ZERO real calls,
    // which read as 94 sub-agents each re-running a 3-repo sync. Kept, because
    // it answers "under which skill did this run", but never as a Skill call.
    if (rec.attributionSkill) skillsAttributed.add(rec.attributionSkill);
    if (rec.timestamp) {
      const t = Date.parse(rec.timestamp);
      if (!Number.isNaN(t)) stamps.push(t);
    }
    const msgId = rec.message?.id || null;
    const replayMsg = !!(msgId && seen.msg.has(msgId)); // seen in an earlier unit
    if (rec.type === 'assistant' && !replayMsg) {
      const tk = msgId || `__t${anon++}`;
      if (!turnMsgs.has(tk)) { turns += 1; turnMsgs.add(tk); }
    }
    if (rec.message?.usage && !replayMsg) {
      usageRecs.push(rec);
      if (msgId) usageMsgIds.add(msgId);
    }
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        const tid = b.id || null;
        if (tid && (seen.tool.has(tid) || localTool.has(tid))) continue; // replay or within-unit dup
        if (tid) localTool.add(tid);
        toolCalls += 1;
        if (b.name === 'Skill' && b.input?.skill) skills.add(b.input.skill);
        if (b.name === 'Agent') dispatched.push({ type: b.input?.subagent_type || 'unknown', description: b.input?.description || '' });
      } else if (b.type === 'tool_result' && b.is_error) {
        const rid = b.tool_use_id || null;
        // Mirror the tool_use dedup: an error for a replayed call is skipped,
        // and duplicate error blocks for the same tool_use_id count ONCE — so
        // toolSuccess (calls − errors) can't go negative on retried results.
        if (rid && (seen.tool.has(rid) || localErr.has(rid))) continue;
        if (rid) localErr.add(rid);
        toolErrors += 1;
      }
    }
  }
  // Merge this unit's real ids into the global seen context (after the loop, so
  // within-unit references above compared only against earlier units).
  for (const k of usageMsgIds) seen.msg.add(k);
  for (const k of turnMsgs) if (!k.startsWith('__t')) seen.msg.add(k);
  for (const t of localTool) seen.tool.add(t);
  // Token totals via the shared (and unit-tested) max-per-message-id rule.
  const usage = dedupUsage(usageRecs);
  // Active minutes = sum of gaps between consecutive records, EXCLUDING idle gaps
  // over IDLE_GAP_MIN. A plain last−first span would count a session resumed
  // across days (hour/day gaps between records) as if it worked the whole time;
  // capping the gap keeps genuine work (incl. long tool calls) but drops the
  // idle stretches. startTs/endTs stay the raw first/last for wall-clock spans.
  stamps.sort((a, b) => a - b);
  const firstTs = stamps.length ? stamps[0] : null;
  const lastTs = stamps.length ? stamps[stamps.length - 1] : null;
  const IDLE_GAP_MS = 30 * 60 * 1000;
  let activeMs = 0;
  for (let i = 1; i < stamps.length; i++) {
    const dt = stamps[i] - stamps[i - 1];
    if (dt > 0 && dt <= IDLE_GAP_MS) activeMs += dt;
  }
  const durationMin = Math.round(activeMs / 60000);
  const date = firstTs != null ? localDate(firstTs) : '?';
  return { usage, agentSetting, gitBranch, date, durationMin, turns, toolCalls, toolErrors, skills, skillsAttributed, dispatched, startTs: firstTs, endTs: lastTs };
}

export function mergeUsage(list) {
  const out = emptyUsage();
  for (const u of list) {
    if (!u) continue;
    out.input += num(u.input);
    out.output += num(u.output);
    out.cacheRead += num(u.cacheRead);
    out.cacheCreation += num(u.cacheCreation);
    out.cacheCreation1h += num(u.cacheCreation1h);
    for (const m of u.models || []) out.models.add(m);
  }
  return out;
}

/** cache_read / (input + cache_read + cache_creation) — the biggest cost lever. */
export function cacheHitRate(usage) {
  const denom = num(usage.input) + num(usage.cacheRead) + num(usage.cacheCreation);
  return denom > 0 ? num(usage.cacheRead) / denom : 0;
}

/** output / (output + total_input) — bloated reports/turns surface here. */
export function outputShare(usage) {
  const totalIn = num(usage.input) + num(usage.cacheRead) + num(usage.cacheCreation);
  const denom = num(usage.output) + totalIn;
  return denom > 0 ? num(usage.output) / denom : 0;
}

// Anthropic per-token price RATIOS, identical across Opus/Sonnet/Haiku even
// though absolute prices differ ~15× (verified: opus 15/75/18.75/1.5,
// sonnet 3/15/3.75/0.3, haiku 1/5/1.25/0.1 → all reduce to 1 : 5 : 1.25 : 0.1).
// This is a stable RATIO, not a price table: it never goes stale and is only
// used to PROPORTION a ccusage-metered dollar, never to compute one.
// `cacheCreation` is the 5-minute write (1.25x); `cacheCreation1h` is the
// 1-hour one (2x). Both ratios hold across Opus/Sonnet/Haiku the same way the
// others do, and they are applied to the 1h SLICE of cache_creation, never to
// the whole — see splitCacheCreation.
export const COST_RATIO = { input: 1, output: 5, cacheCreation: 1.25, cacheCreation1h: 2, cacheRead: 0.1 };

/**
 * Weight used to split one session's real ccusage cost across its parent +
 * sub-agents. Modes:
 *   'cost'   (default) — output×5 + input×1 + cache-write×1.25 + cache-read×0.1.
 *              Tracks true dollar share; exact for a single-model session.
 *   'output' — output tokens only. Simplest, zero price assumptions, but
 *              ignores input/cache so a cache-heavy unit is under-weighted.
 *   'total'  — all tokens equal. Over-weights cheap cache reads.
 * Whichever is chosen, the per-unit dollars still SUM to the ccusage session
 * total — only the split proportions change.
 */
export function costWeight(usage, mode = 'cost') {
  if (mode === 'total') {
    return num(usage.input) + num(usage.output) + num(usage.cacheRead) + num(usage.cacheCreation);
  }
  if (mode === 'output') return num(usage.output);
  const h1 = Math.min(num(usage.cacheCreation1h), num(usage.cacheCreation));
  const m5 = num(usage.cacheCreation) - h1;
  return num(usage.output) * COST_RATIO.output +
    num(usage.input) * COST_RATIO.input +
    m5 * COST_RATIO.cacheCreation +
    h1 * COST_RATIO.cacheCreation1h +
    num(usage.cacheRead) * COST_RATIO.cacheRead;
}

// --- ccusage — the single source of dollar truth ----------------------------
/**
 * Shell out once for `ccusage session --json` and index by `.period` (session
 * id). Returns null on any failure (ccusage absent, offline w/o cached rates,
 * bad args) — callers then report cost as unavailable, never estimate. `mode`
 * maps to ccusage --mode; `agent` filters to one host (e.g. 'claude'); the
 * live v20 shape is `{ session:[{period,totalCost,agent,outputTokens,...}] }`
 * (which differs from the docs' `{data,costUSD}` shape — we parse the real one
 * and tolerate both).
 */
export function runCcusage({ bin = 'npx', offline = true, mode, agent, configDir, since, until } = {}) {
  const base = bin === 'npx' ? ['--yes', 'ccusage@latest'] : [];
  const args = [...base, 'session', '--json'];
  if (offline) args.push('--offline');
  if (mode) args.push('--mode', mode);
  if (since) args.push('--since', String(since).replace(/-/g, ''));
  if (until) args.push('--until', String(until).replace(/-/g, ''));
  const env = { ...process.env };
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  try {
    const out = execFileSync(bin, args, {
      env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 128 * 1024 * 1024,
    });
    return indexCcusage(JSON.parse(out), agent);
  } catch {
    return null;
  }
}

/** Index a parsed ccusage session dump by session id, optionally host-filtered. */
export function indexCcusage(parsed, agent) {
  const list = parsed?.session || parsed?.sessions || parsed?.data || [];
  const map = new Map();
  for (const s of list) {
    const id = s.period || s.session || s.sessionId;
    if (!id) continue;
    if (agent && s.agent && s.agent !== agent) continue;
    map.set(id, {
      costUsd: typeof s.totalCost === 'number' ? s.totalCost
        : (typeof s.costUSD === 'number' ? s.costUSD : null),
      agent: s.agent ?? null,
      models: s.modelsUsed || s.models || [],
      lastActivity: s.metadata?.lastActivity || s.lastActivity || null,
    });
  }
  return map;
}

// --- Per-file metering (the primary, exact path) ----------------------------
/**
 * Stage a throwaway CLAUDE_CONFIG_DIR whose `projects/<name>/` holds EVERY
 * transcript — each top-level session AND each sub-agent from its
 * `subagents/` subfolder — FLATTENED into one folder as hard links. `ccusage
 * claude session` keys by filename and only globs the top of a project dir, so
 * flattening is what makes it meter each sub-agent as its own session. Hard
 * links (not copies) keep it cheap — and ccusage does NOT follow symlinks, so
 * a real directory entry is required. Returns { stageRoot, cleanup, staged }
 * where `staged` is the count of linked files. Sub-agent ids (agent-<hex>) and
 * session UUIDs are globally unique, so one flat folder never collides.
 */
export function stageFlattened(projectDirs, { excludeSession } = {}) {
  const stageRoot = mkdtempSync(join(tmpdir(), 'effaudit-'));
  const projectsDir = join(stageRoot, 'projects');
  let staged = 0;
  for (const projectDir of projectDirs) {
    const dest = join(projectsDir, basename(projectDir));
    mkdirSync(dest, { recursive: true });
    let jsonls;
    try { jsonls = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')); }
    catch { continue; }
    for (const f of jsonls) {
      const id = basename(f, '.jsonl');
      if (id === excludeSession) continue;
      try { linkOrCopy(join(projectDir, f), join(dest, f)); staged++; } catch { /* skip */ }
      // Sub-agent transcripts at any depth — keyed off the `.meta.json` sidecar,
      // NOT "any .jsonl". This excludes non-transcript artifacts like the
      // Workflow tool's `journal.jsonl` (which would otherwise collide on
      // basename when flattened and add a bogus row). agent-<hex> ids are
      // globally unique, so flattening multiple depths never collides.
      for (const metaPath of collectFilesRecursive(join(projectDir, id),
        (p) => p.endsWith('.meta.json') && p.includes(`${sep}subagents${sep}`))) {
        const saId = basename(metaPath).replace(/\.meta\.json$/, '');
        const saJsonl = join(dirname(metaPath), `${saId}.jsonl`);
        if (existsSync(saJsonl)) { try { linkOrCopy(saJsonl, join(dest, `${saId}.jsonl`)); staged++; } catch { /* skip */ } }
      }
    }
  }
  return { stageRoot, staged, cleanup: () => { try { rmSync(stageRoot, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

/**
 * Meter each staged file with `ccusage claude session --json` and return a Map
 * keyed by filename stem (session UUID or agent-<hex>) → costUsd. This is the
 * Claude-only reader, so it never mixes in Codex/Gemini sessions. Returns null
 * on any failure so the caller can fall back to allocation.
 */
export function meterFiles(stageRoot, { bin = 'npx', offline = true, mode } = {}) {
  const base = bin === 'npx' ? ['--yes', 'ccusage@latest'] : [];
  const args = [...base, 'claude', 'session', '--json'];
  if (offline) args.push('--offline');
  if (mode) args.push('--mode', mode);
  try {
    const out = execFileSync(bin, args, {
      env: { ...process.env, CLAUDE_CONFIG_DIR: stageRoot },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 128 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    const list = parsed?.session || parsed?.sessions || parsed?.data || [];
    const costs = new Map();
    const unpriced = new Set();
    for (const s of list) {
      const id = s.sessionId || s.period || s.session; // claude-session shape keys by filename stem
      if (id && typeof s.totalCost === 'number') costs.set(id, s.totalCost);
      // A model with real tokens but $0 cost is UNPRICED — its rate is missing
      // from the (offline/cached) LiteLLM DB, so cost is silently undercounted.
      for (const mb of s.modelBreakdowns || []) {
        const tok = num(mb.inputTokens) + num(mb.outputTokens) + num(mb.cacheCreationTokens) + num(mb.cacheReadTokens);
        if (tok > 0 && num(mb.cost) === 0 && mb.modelName && mb.modelName !== '<synthetic>') unpriced.add(mb.modelName);
      }
    }
    return costs.size ? { costs, unpriced: [...unpriced] } : null;
  } catch {
    return null;
  }
}

// Cheap ordering read — first timestamp (epoch ms or null) + record count,
// without retaining the parsed records. The count is the fork tiebreak: on an
// equal first timestamp the ORIGINAL (fewer records) must sort before the fork
// (which replays the original plus its own new records).
function orderKeyOf(path) {
  let startTs = null;
  let records = 0;
  try {
    const txt = readFileSync(path, 'utf8');
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      records += 1;
      if (startTs === null && line.indexOf('"timestamp"') !== -1) {
        const rec = safeParse(line);
        if (rec?.timestamp) { const t = Date.parse(rec.timestamp); if (!Number.isNaN(t)) startTs = t; }
      }
    }
  } catch { /* ignore */ }
  return { startTs, records };
}

// --- Unit collection ---------------------------------------------------------
// One "session group" per top-level transcript: the parent (orchestrator) unit
// plus one unit per sub-agent. ccusage gives the group's real dollar; we split
// it across these units by costWeight.
//
// Two dedup safeguards for forked/resumed sessions (which replay earlier
// records): (1) units are parsed EARLIEST-FIRST through one shared `seen`
// context, so a replayed message/tool-call is counted only under the earliest
// unit — matching how ccusage dedups cost; (2) a sub-agent file that exists
// under more than one parent dir (a fork inherits its parent's `subagents/`)
// is emitted as a SINGLE unit, not once per parent.
export function collectSessionGroups(projectDirs, { excludeSession, tags = {} } = {}) {
  // 1. Enumerate every candidate unit (top-level session + each sub-agent).
  const cands = [];
  for (const projectDir of projectDirs) {
    let jsonls;
    try { jsonls = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')); }
    catch { continue; }
    for (const f of jsonls) {
      const id = basename(f, '.jsonl');
      if (id === excludeSession) continue;
      cands.push({ id, kind: 'session', parentId: null, path: join(projectDir, f), projectDir, sessionId: id });
      for (const metaPath of collectFilesRecursive(join(projectDir, id),
        (p) => p.endsWith('.meta.json') && p.includes(`${sep}subagents${sep}`))) {
        const saId = basename(metaPath).replace(/\.meta\.json$/, '');
        const saJsonl = join(dirname(metaPath), `${saId}.jsonl`);
        if (!existsSync(saJsonl)) continue;
        let meta;
        try { meta = safeParse(readFileSync(metaPath, 'utf8')) || {}; }
        catch { continue; } // sidecar vanished mid-run (cleanup race) — skip the entry
        cands.push({ id: saId, kind: 'subagent', parentId: id, path: saJsonl, projectDir, sessionId: id, agentType: meta.agentType || 'unknown', description: meta.description || '' });
      }
    }
  }

  // 2. Order earliest-first so the shared `seen` assigns replayed content to the
  //    original unit, not the fork. Ties on first timestamp break to fewer
  //    records first (the original — a fork replays it plus new records), then
  //    filename, so ownership is deterministic regardless of readdir order.
  //    3. Skip duplicate unit ids (shared sub-agent).
  for (const c of cands) Object.assign(c, orderKeyOf(c.path));
  cands.sort((a, b) => ((a.startTs ?? Infinity) - (b.startTs ?? Infinity))
    || (a.records - b.records)
    || basename(a.path).localeCompare(basename(b.path)));
  const seen = { msg: new Set(), tool: new Set() };
  const emittedId = new Set();
  const units = [];
  for (const c of cands) {
    if (emittedId.has(c.id)) continue;
    let records;
    try { records = readRecords(c.path); }
    catch (err) { // e.g. a >512MB transcript exceeding max string length — skip, don't crash the run
      process.stderr.write(`Warning: skipping unreadable transcript ${c.path}: ${err?.message || err}\n`);
      continue;
    }
    emittedId.add(c.id);
    const p = parseUnit(records, seen);
    const role = tags[c.id] || (c.kind === 'session' ? p.agentSetting : c.agentType) || null;
    units.push({
      id: c.id, kind: c.kind, parentId: c.parentId, role, usage: p.usage,
      gitBranch: p.gitBranch, date: p.date, durationMin: p.durationMin, turns: p.turns,
      description: c.kind === 'session' ? '(orchestrator/session)' : c.description, projectDir: c.projectDir,
      toolCalls: p.toolCalls, toolErrors: p.toolErrors, skills: p.skills, skillsAttributed: p.skillsAttributed, dispatched: p.dispatched,
      startTs: p.startTs, endTs: p.endTs, sessionId: c.sessionId,
    });
  }

  // 4. Assemble one group per top-level session (parent + its sub-agent units).
  const bySession = new Map();
  for (const u of units) {
    if (!bySession.has(u.sessionId)) bySession.set(u.sessionId, { sessionId: u.sessionId, projectDir: u.projectDir, date: '?', units: [] });
    bySession.get(u.sessionId).units.push(u);
  }
  const groups = [];
  for (const g of bySession.values()) {
    const parent = g.units.find((u) => u.kind === 'session');
    g.date = (parent && parent.date !== '?' ? parent.date : null) || g.units.map((u) => u.date).find((d) => d && d !== '?') || '?';
    for (const u of g.units) if (!u.date || u.date === '?') u.date = g.date;
    groups.push(g);
  }
  return groups;
}

/**
 * Give every unit in a group a dollar figure. Preference order, most honest
 * first:
 *   1. METERED — per-file costs from meterFiles, used directly wherever they
 *      exist. Source 'ccusage-metered'. Exact.
 *   2. ALLOCATED — when NOTHING in the group metered, split the parent-session
 *      total by cost-weighted token share. Source 'ccusage-allocated'.
 *   3. UNAVAILABLE — else null (nothing to derive a figure from).
 * A single-unit group with a session total takes it directly ('ccusage').
 *
 * Metering is per unit, NOT all-or-nothing. It used to require a metered row
 * for EVERY unit (`units.every(...)`) and otherwise dropped the whole group to
 * allocation — but the allocation base is ccusage's top-level session row,
 * which covers the PARENT transcript only, never its sub-agents. So a single
 * unmetered unit collapsed the entire group onto the parent's dollars.
 *
 * Observed: one 762-unit session metered at $1,488.63 reported as $51.43, a
 * 29x undercount, because a handful of sub-agents produced no usage records at
 * all (dispatches that died mid-run — 33 of 446 in one workflow alone). The
 * failure mode ran backwards: the more a campaign crashed, the cheaper it
 * looked. A unit with no usage records had nothing billed, so it is $0 — not a
 * reason to discard everything that DID meter.
 */
// `meteredSource` names who produced the per-unit dollars, because provenance
// is half the value of a cost audit. Claude's path meters with ccusage; the
// Copilot path uses Copilot's own billed figure, and mislabelling that as
// ccusage would send a later reader to the wrong tool to verify it.
export function allocateCost(group, { meteredMap, sessionMap, weight = 'cost', meteredSource = 'ccusage-metered' } = {}) {
  const units = group.units;
  const metered = (u) => (meteredMap ? meteredMap.get(u.id) : undefined);

  // 1. Metered per file — the primary path, applied unit by unit.
  if (meteredMap && units.some((u) => typeof metered(u) === 'number')) {
    return units.map((u) => {
      const exact = metered(u);
      if (typeof exact === 'number') return { ...u, costUsd: exact, costSource: meteredSource };
      // No metered row. If the unit logged no billable usage either, that is a
      // real $0 (a dispatch that died before producing anything), not a gap.
      if (costWeight(u.usage, weight) === 0) return { ...u, costUsd: 0, costSource: meteredSource };
      // Usage but no price: don't invent one from a parent-only total — that is
      // exactly the undercount above. Report it missing and let the
      // reconciliation surface it.
      return { ...u, costUsd: null, costSource: 'unavailable' };
    });
  }

  // 2/3. Nothing metered at all — fall back to the parent-session total.
  const rec = sessionMap?.get(group.sessionId);
  const total = rec && typeof rec.costUsd === 'number' ? rec.costUsd : null;
  if (total == null) return units.map((u) => ({ ...u, costUsd: null, costSource: 'unavailable' }));
  if (units.length === 1) return [{ ...units[0], costUsd: total, costSource: 'ccusage' }];
  const weights = units.map((u) => costWeight(u.usage, weight));
  const sum = weights.reduce((a, b) => a + b, 0);
  return units.map((u, i) => ({
    ...u,
    costUsd: sum > 0 ? total * (weights[i] / sum) : total / units.length,
    costSource: 'ccusage-allocated',
  }));
}

/** Restrict groups to a [since, until] date window (inclusive, YYYY-MM-DD). */
export function filterGroupsByDateRange(groups, since, until) {
  if (!since && !until) return { kept: groups, droppedUnknownDate: 0 };
  let droppedUnknownDate = 0;
  const kept = groups.filter((g) => {
    if (g.date === '?') { droppedUnknownDate++; return false; }
    if (since && g.date < since) return false;
    if (until && g.date > until) return false;
    return true;
  });
  return { kept, droppedUnknownDate };
}

// --- Aggregation -------------------------------------------------------------
function newBucket() {
  return {
    usage: emptyUsage(), costUsd: 0, hasCost: false, costSource: new Set(),
    durationMin: 0, turns: 0, count: 0,
    toolCalls: 0, toolErrors: 0, skills: new Set(), skillsAttributed: new Set(), dispatched: 0,
    minStart: null, maxEnd: null,
  };
}
function addToBucket(b, unit) {
  b.usage = mergeUsage([b.usage, unit.usage]);
  if (typeof unit.costUsd === 'number') { b.costUsd += unit.costUsd; b.hasCost = true; }
  b.costSource.add(unit.costSource);
  b.durationMin += unit.durationMin;
  b.turns += unit.turns;
  b.count += 1;
  b.toolCalls += unit.toolCalls || 0;
  b.toolErrors += unit.toolErrors || 0;
  for (const s of unit.skills || []) b.skills.add(s);
  for (const s of unit.skillsAttributed || []) b.skillsAttributed.add(s);
  b.dispatched += (unit.dispatched ? unit.dispatched.length : 0);
  if (typeof unit.startTs === 'number' && (b.minStart === null || unit.startTs < b.minStart)) b.minStart = unit.startTs;
  if (typeof unit.endTs === 'number' && (b.maxEnd === null || unit.endTs > b.maxEnd)) b.maxEnd = unit.endTs;
}
// durationMin = sum of each unit's own active minutes ("agent-minutes", overcounts
// because sub-agents run in parallel). wallClockMin = elapsed span from the
// earliest unit start to the latest end — the real "how long did it take".
const wallClockMin = (b) => (b.minStart !== null && b.maxEnd !== null ? Math.round((b.maxEnd - b.minStart) / 60000) : 0);

export function buildRollup(groups, { meteredMap, sessionMap, weight = 'cost', unpricedModels = [], meteredSource } = {}) {
  const byRole = new Map();
  const byDay = new Map();
  const byProject = new Map();
  const bySkill = new Map(); // skill name -> { units, turns } that loaded it
  const ledger = [];
  const unattributed = newBucket();
  const totals = newBucket();

  for (const group of groups) {
    const priced = allocateCost(group, { meteredMap, sessionMap, weight, ...(meteredSource ? { meteredSource } : {}) });
    for (const unit of priced) {
      // Ledger entry must be JSON-safe: Sets serialize to {}, so expose model(s)
      // and skill(s) as arrays. Cost is already model-correct (metered per file
      // by ccusage); this surfaces model/skill/tool/dispatch detail per unit.
      ledger.push({
        ...unit,
        models: [...(unit.usage.models || [])],
        skills: [...(unit.skills || [])],
        skillsAttributed: [...(unit.skillsAttributed || [])],
        startedAt: typeof unit.startTs === 'number' ? new Date(unit.startTs).toISOString() : null,
        endedAt: typeof unit.endTs === 'number' ? new Date(unit.endTs).toISOString() : null,
        usage: { ...unit.usage, models: [...(unit.usage.models || [])] },
      });
      addToBucket(totals, unit);

      if (unit.role) {
        if (!byRole.has(unit.role)) byRole.set(unit.role, newBucket());
        addToBucket(byRole.get(unit.role), unit);
      } else {
        addToBucket(unattributed, unit);
      }

      for (const s of unit.skills || []) {
        if (!bySkill.has(s)) bySkill.set(s, { units: 0, turns: 0 });
        const sk = bySkill.get(s); sk.units += 1; sk.turns += unit.turns || 0;
      }

      // A unit whose group has no resolvable date still lands in an explicit
      // 'unknown' bucket — dropping it would make byDaySum come up short and
      // false-alarm the reconciliation check.
      const day = unit.date && unit.date !== '?' ? unit.date : group.date;
      const dayKey = day && day !== '?' ? day : 'unknown';
      if (!byDay.has(dayKey)) byDay.set(dayKey, newBucket());
      addToBucket(byDay.get(dayKey), unit);
      if (!byProject.has(unit.projectDir)) byProject.set(unit.projectDir, newBucket());
      addToBucket(byProject.get(unit.projectDir), unit);
    }
  }

  const metricsOf = (b) => ({
    toolCalls: b.toolCalls,
    toolErrors: b.toolErrors,
    toolSuccess: b.toolCalls - b.toolErrors,
    skills: [...b.skills],
    skillsAttributed: [...b.skillsAttributed],
    subagentsDispatched: b.dispatched,
  });

  const ser = (map) => Object.fromEntries(
    [...map.entries()].map(([k, b]) => [k, {
      costUsd: b.hasCost ? b.costUsd : null,
      costSource: [...b.costSource],
      models: [...b.usage.models],
      agentMinutes: b.durationMin,
      wallClockMin: wallClockMin(b),
      turns: b.turns,
      count: b.count,
      tokens: { input: b.usage.input, output: b.usage.output, cacheRead: b.usage.cacheRead, cacheCreation: b.usage.cacheCreation, cacheCreation1h: b.usage.cacheCreation1h },
      cacheHitRate: cacheHitRate(b.usage),
      outputShare: outputShare(b.usage),
      ...metricsOf(b),
    }]),
  );

  const serTotals = (b) => ({
    costUsd: b.hasCost ? b.costUsd : null,
    costSource: [...b.costSource],
    models: [...b.usage.models],
    agentMinutes: b.durationMin, wallClockMin: wallClockMin(b), turns: b.turns, count: b.count,
    tokens: { input: b.usage.input, output: b.usage.output, cacheRead: b.usage.cacheRead, cacheCreation: b.usage.cacheCreation, cacheCreation1h: b.usage.cacheCreation1h },
    cacheHitRate: cacheHitRate(b.usage), outputShare: outputShare(b.usage),
    ...metricsOf(b),
  });

  // 'unavailable' units are genuinely unpriceable sessions (ccusage has no cost
  // for them) — they don't make an otherwise-metered run "mixed". Only a true
  // metered+allocated blend is 'mixed'. The metered label follows the
  // configured meteredSource (the Copilot path prices units as
  // 'copilot-nano-aiu'; matching only the ccusage label reported every fully
  // priced Copilot rollup as method: unavailable).
  const hasMetered = totals.costSource.has(meteredSource ?? 'ccusage-metered');
  const hasAllocated = totals.costSource.has('ccusage-allocated') || totals.costSource.has('ccusage');
  const costMethod = hasMetered && hasAllocated ? 'mixed'
    : hasMetered ? 'metered'
      : hasAllocated ? 'allocated' : 'unavailable';

  // Reconciliation — a self-check that the grand total ties out.
  // INTERNAL: every breakdown (per-unit ledger, by-role, by-day, by-project)
  // must sum to the same grand total — catches any aggregation bug.
  // ccusage FIDELITY: the total must equal the sum of ccusage's own PER-FILE
  // metered numbers, and every metered file must map to exactly one ledger unit
  // (no dropped or double-counted file). This is the right ccusage anchor — the
  // per-file `ccusage claude session` output the skill is built on. We do NOT
  // compare to ccusage's `session` AGGREGATE: it groups by top-level session-id
  // and folds sub-agents differently (e.g. workflow sub-agents land under their
  // own ids), so its total legitimately differs from the per-file grain.
  const grand = totals.hasCost ? totals.costUsd : 0;
  const sumBuckets = (m) => [...m.values()].reduce((a, b) => a + (b.hasCost ? b.costUsd : 0), 0);
  const ledgerSum = ledger.reduce((a, u) => a + (typeof u.costUsd === 'number' ? u.costUsd : 0), 0);
  const byRoleSum = sumBuckets(byRole) + (unattributed.hasCost ? unattributed.costUsd : 0);
  const byDaySum = sumBuckets(byDay);
  const byProjectSum = sumBuckets(byProject);
  const eps = Math.max(0.01, Math.abs(grand) * 1e-6);
  const reconciliation = {
    total: totals.hasCost ? totals.costUsd : null,
    ledgerSum, byRoleSum, byDaySum, byProjectSum,
    internalOk: [ledgerSum, byRoleSum, byDaySum, byProjectSum].every((v) => Math.abs(v - grand) <= eps),
  };
  if (meteredMap) {
    const ledgerIds = new Set(ledger.map((u) => u.id));
    let meteredSum = 0; let orphanFiles = 0;
    for (const [id, cost] of meteredMap) {
      if (typeof cost === 'number') meteredSum += cost;
      if (!ledgerIds.has(id)) orphanFiles += 1; // metered by ccusage but not in the ledger
    }
    reconciliation.ccusageMeteredSum = meteredSum;
    reconciliation.ccusageFiles = meteredMap.size;
    reconciliation.orphanFiles = orphanFiles;
    reconciliation.externalOk = Math.abs(meteredSum - grand) <= Math.max(0.02, Math.abs(grand) * 0.005) && orphanFiles === 0;
  }

  return {
    ccusageAvailable: meteredMap != null || sessionMap != null,
    costMethod, // 'metered' (exact per file) | 'allocated' (split) | 'mixed' | 'unavailable'
    unpricedModels, // models with tokens but $0 (missing from the pricing DB) — cost undercounted
    reconciliation,
    byRole: ser(byRole),
    byDay: ser(byDay),
    byProject: ser(byProject),
    bySkill: Object.fromEntries([...bySkill.entries()].sort((a, z) => z[1].units - a[1].units)),
    unattributed: serTotals(unattributed),
    ledger,
    totals: serTotals(totals),
  };
}

// --- Rendering ---------------------------------------------------------------
const fmtUsd = (n) => (typeof n === 'number' ? `$${n.toFixed(2)}` : 'n/a');
const fmtPct = (n) => `${(n * 100).toFixed(0)}%`;

// `pricer` names who produced the dollars. Default: ccusage (the Claude path).
// The Copilot path passes its own, because a report that says "ccusage" about a
// number ccusage never saw sends the reader to the wrong tool to check it.
export function renderMarkdown(rollup, { resolved, label, weight, pricer = 'ccusage', delivery } = {}) {
  const out = [`# Efficiency audit${label ? ` — ${label}` : ''}`, '', `Generated: ${new Date().toISOString()}`, ''];
  if (!rollup.ccusageAvailable) {
    out.push('> ⚠️ ccusage returned no data (not installed, offline without cached pricing, or nothing in range). Dollar columns are blank; token/role structure is still shown from transcripts.', '');
  }
  if (rollup.unpricedModels && rollup.unpricedModels.length) {
    out.push(`> ⚠️ **Cost is UNDERCOUNTED.** These models have usage but no price in the current pricing DB — their tokens counted as $0: **${rollup.unpricedModels.join(', ')}**. Re-run with \`--online\` to fetch current LiteLLM pricing.`, '');
  }
  // The note names the ACTUAL pricer — saying "ccusage" about Copilot's billed
  // nano-AIU figure sent readers to the wrong tool to verify it (seen live).
  const methodNote = {
    metered: pricer === 'ccusage'
      ? 'per-file metered by ccusage (exact — each sub-agent priced individually)'
      : `priced from ${pricer}'s own billed figure, split across units by token share`,
    allocated: `allocated: each session's real ${pricer} $ split across sub-agents by ${weight || 'cost'}-weighted tokens`,
    mixed: 'mixed — some sessions metered per file, some allocated (see per-row source)',
    unavailable: `no ${pricer} cost available`,
  }[rollup.costMethod] || '';

  const t = rollup.totals;
  const errRate = t.toolCalls ? t.toolErrors / t.toolCalls : 0;
  const nSessions = (rollup.ledger || []).filter((u) => u.kind === 'session').length;
  const nSub = (rollup.ledger || []).filter((u) => u.kind === 'subagent').length;
  out.push('## Totals', '');
  out.push(`- Units: ${t.count} (${nSessions} sessions + ${nSub} sub-agents)  ·  Agent-tool dispatches: ${t.subagentsDispatched}`);
  out.push(`- Cost (${pricer}): ${fmtUsd(t.costUsd)}  ·  method: ${rollup.costMethod}`);
  out.push(`- Tokens: in ${t.tokens.input}, out ${t.tokens.output}, cache-read ${t.tokens.cacheRead}, cache-write ${t.tokens.cacheCreation}`);
  out.push(`- Cache-hit rate: ${fmtPct(t.cacheHitRate)}  ·  Output-token share: ${fmtPct(t.outputShare)}`);
  out.push(`- Tool calls: ${t.toolCalls}  (${t.toolSuccess} ok / ${t.toolErrors} err, ${fmtPct(1 - errRate)} success)`);
  // Two lines, never one: the first is behaviour you can act on, the second is
  // only which skill the host had active. Merged, the inherited names swamp the
  // real ones and read as waste that never happened.
  out.push(`- Skills invoked (real \`Skill\` calls): ${t.skills.length}${t.skills.length ? ` — ${t.skills.join(', ')}` : ''}`);
  if (t.skillsAttributed?.length) {
    out.push(`- Skills attributed (host context, INHERITED by sub-agents — not invocations): ${t.skillsAttributed.length} — ${t.skillsAttributed.join(', ')}`);
  }
  out.push(`- Time: ${t.agentMinutes} agent-min (sum of unit spans; sub-agents run in parallel)  ·  ${t.wallClockMin} min wall-clock span`);
  if (resolved && !delivery) out.push(`- Cost per resolved unit (${resolved} given): ${fmtUsd((t.costUsd || 0) / resolved)}`);
  out.push('');
  // Measured delivery replaces the single hand-fed ratio with its own section:
  // two denominators, the outcome breakdown behind them, and what the join
  // could not tie to these batches.
  if (delivery) out.push(renderDeliveryMarkdown(delivery));

  const shortModels = (ms) => (ms || []).map((m) => m.replace(/^claude-/, '')).join(', ') || '—';
  out.push(`## By role  *(${methodNote})*`, '',
    '| role | cost | units | turns | agent-min | tools (err) | dispatched | models | cache-hit |', '|---|---|---|---|---|---|---|---|---|');
  for (const [role, b] of Object.entries(rollup.byRole).sort((a, z) => (z[1].costUsd || 0) - (a[1].costUsd || 0))) {
    out.push(`| ${role} | ${fmtUsd(b.costUsd)} | ${b.count} | ${b.turns} | ${b.agentMinutes} | ${b.toolCalls} (${b.toolErrors}) | ${b.subagentsDispatched} | ${shortModels(b.models)} | ${fmtPct(b.cacheHitRate)} |`);
  }
  out.push('');

  if (rollup.unattributed.count) {
    out.push(`_Unattributed: ${rollup.unattributed.count} unit(s) with no role marker (ad-hoc interactive use), cost ${fmtUsd(rollup.unattributed.costUsd)}._`, '');
  }

  const skillRows = Object.entries(rollup.bySkill || {});
  if (skillRows.length) {
    out.push('## Skills invoked', '',
      '_Real `Skill` tool calls only. Host attribution inherited by sub-agents is NOT counted here — it inflated this table by three orders of magnitude when the two were merged._', '',
      '| skill | units | turns |', '|---|---|---|');
    for (const [name, s] of skillRows) out.push(`| ${name} | ${s.units} | ${s.turns} |`);
    out.push('');
  }

  out.push('## By day', '', '| day | cost | units |', '|---|---|---|');
  for (const [day, b] of Object.entries(rollup.byDay).sort(([a], [z]) => a.localeCompare(z))) {
    out.push(`| ${day} | ${fmtUsd(b.costUsd)} | ${b.count} |`);
  }
  out.push('');

  const r = rollup.reconciliation;
  if (r && r.total != null) {
    const eps = Math.max(0.01, Math.abs(r.total) * 1e-6);
    const ck = (v) => (Math.abs(v - r.total) <= eps ? '✓' : '✗');
    out.push('## Reconciliation', '');
    out.push(`- Grand total: **${fmtUsd(r.total)}**`);
    out.push(`- Σ per-unit ledger ${fmtUsd(r.ledgerSum)} ${ck(r.ledgerSum)} · Σ by-role ${fmtUsd(r.byRoleSum)} ${ck(r.byRoleSum)} · Σ by-day ${fmtUsd(r.byDaySum)} ${ck(r.byDaySum)} · Σ by-project ${fmtUsd(r.byProjectSum)} ${ck(r.byProjectSum)}`);
    if (typeof r.ccusageMeteredSum === 'number') {
      out.push(`- Σ ccusage per-file metering ${fmtUsd(r.ccusageMeteredSum)} ${ck(r.ccusageMeteredSum)} across ${r.ccusageFiles} files${r.orphanFiles ? ` · ⚠️ ${r.orphanFiles} metered file(s) not in the ledger` : ' · 0 unaccounted'}`);
    }
    out.push(`- ${r.internalOk && r.externalOk !== false ? '✅ reconciled — every breakdown ties to the total, and the total accounts for 100% of ccusage\'s per-file metering' : '⚠️ **RECONCILIATION FAILED** — investigate before trusting the numbers'}`);
    out.push('');
  }
  return out.join('\n');
}

export function renderDiff(current, prior) {
  const cur = current.totals || current.rollup?.totals;
  const pri = prior.totals || prior.rollup?.totals;
  const curResolved = current.resolved;
  const priResolved = prior.resolved;
  const out = ['## Before / after', ''];
  const dCost = (cur.costUsd || 0) - (pri.costUsd || 0);
  const pct = pri.costUsd ? (dCost / pri.costUsd) * 100 : null;
  out.push(`- Cost: ${fmtUsd(pri.costUsd)} → ${fmtUsd(cur.costUsd)} (Δ ${dCost >= 0 ? '+' : ''}${fmtUsd(dCost)}${pct !== null ? `, ${pct.toFixed(0)}%` : ''})`);
  const dHit = (cur.cacheHitRate || 0) - (pri.cacheHitRate || 0);
  out.push(`- Cache-hit rate: ${fmtPct(pri.cacheHitRate || 0)} → ${fmtPct(cur.cacheHitRate || 0)} (Δ ${dHit >= 0 ? '+' : ''}${(dHit * 100).toFixed(0)}pp)`);
  if (typeof priResolved === 'number' && typeof curResolved === 'number' && priResolved && curResolved) {
    const before = (pri.costUsd || 0) / priResolved;
    const after = (cur.costUsd || 0) / curResolved;
    out.push(`- $/resolved unit: ${fmtUsd(before)} → ${fmtUsd(after)} (Δ ${fmtUsd(after - before)})`);
  } else {
    out.push('- $/resolved unit: pass --resolved on both the snapshot run and this run to compare');
  }
  return out.join('\n');
}

// --- CLI ---------------------------------------------------------------------
export const HELP = `usage: usage-rollup.mjs [flags]

  --host claude|copilot     Which agent CLI's local logs to read (default claude).
                            copilot: session-state JSONL under ~/.copilot, priced
                            in nano-AIU credits from Copilot's own billed figure.
                            The ccusage flags (--weight/--mode/--no-meter/
                            --no-ccusage/--online/--offline/--agent/--ccusage-bin)
                            do not apply there and are reported as ignored
  --project-dir <dir>       Transcript dir to audit (repeatable; default: resolve from cwd)
  --all-projects            Audit every project under the Claude projects root
  --since <YYYY-MM-DD>      Start of date window (inclusive, local calendar day)
  --until <YYYY-MM-DD>      End of date window (inclusive, local calendar day)
  --resolved <N>            Divide total cost by N for a $/resolved-unit figure
  --resolved-from [path]    Take the count from the pipeline's own run reports
                            instead (a report.json, a batch dir, or the
                            automation root; default .agents/automation).
                            Reports cost per spec DELIVERED and per case
                            EXAMINED, plus how much of the spend it could tie
                            to these batches by branch. Overrides --resolved.
  --weight <mode>           Fallback-allocation weight: cost|output|total (default cost)
  --tag <sessionId=role>    Manually label a role-less session (repeatable)
  --exclude-session <id>    Skip one session id (e.g. the session running the audit)
  --mode <mode>             ccusage cost mode: auto|calculate|display
  --agent <host>            ccusage host filter for the fallback source (default claude)
  --ccusage-bin <bin>       ccusage binary (default: npx -> ccusage@latest)
  --bundle <label>          Label to show in the report title
  --json                    Emit the full structured rollup as JSON instead of markdown
  --out <path>              Write the markdown rollup to a file
  --snapshot <path>         Also write a JSON snapshot for later diffing
  --diff <snapshot.json>    Print a before/after diff vs a prior snapshot
  --online                  Force live LiteLLM pricing from the start (network)
  --offline                 Force cached pricing (no network, no auto-refresh)
  --no-meter                Skip per-file metering (session-total + allocation only)
  --no-ccusage              Skip ccusage entirely (no dollars)
  --help, -h                Show this help
`;

const VALUE_FLAGS = new Set([
  'project-dir', 'tag', 'since', 'until', 'resolved', 'resolved-from', 'weight', 'exclude-session',
  'mode', 'agent', 'ccusage-bin', 'bundle', 'out', 'snapshot', 'diff', 'host',
]);
const BOOL_FLAGS = new Set(['all-projects', 'json', 'online', 'offline', 'no-meter', 'no-ccusage', 'help']);
// `--resolved-from` works with or without a path, so it is in both sets: bare,
// it defaults to .agents/automation; with a value, that value wins.
const OPTIONAL_VALUE_FLAGS = new Set(['resolved-from']);

/** Returns the options bag, `{ help: true }`, or `{ error: <message> }`. */
export function parseArgs(argv) {
  const a = { projectDir: [], tag: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (!arg.startsWith('--')) return { error: `unexpected argument ${arg}, see --help` };
    const key = arg.slice(2);
    if (BOOL_FLAGS.has(key)) { a[key] = true; continue; }
    if (!VALUE_FLAGS.has(key)) return { error: `unknown flag --${key}, see --help` };
    const next = argv[i + 1];
    if ((next === undefined || next.startsWith('--')) && OPTIONAL_VALUE_FLAGS.has(key)) { a[key] = true; continue; }
    if (next === undefined || next.startsWith('--')) return { error: `flag --${key} requires a value, see --help` };
    const val = argv[++i];
    if (key === 'project-dir') a.projectDir.push(val);
    else if (key === 'tag') a.tag.push(val);
    else a[key] = val;
  }
  return a;
}

// The transcript store root: $CLAUDE_CONFIG_DIR/projects when set, else the
// first of ~/.claude/projects, ~/.config/claude/projects that exists — the
// same lookup ccusage uses.
/**
 * Every place Claude Code may keep this project's transcripts, in priority
 * order, filtered to the ones that exist.
 *
 * The repo-local root is the one that keeps getting missed. A project can point
 * `CLAUDE_CONFIG_DIR` at its own `.claude/`, and then every transcript lives
 * inside the repo rather than under `$HOME`. Searching only the global roots
 * reports "no transcripts for this project" while they sit in the working
 * directory the command was run from — and that answer is indistinguishable
 * from a project that genuinely has none. `copilotRoots()` has searched a
 * repo-local root from the start; the Claude side never caught up.
 *
 * Returns ALL matching roots, not the first: a project that moved to a local
 * config dir partway keeps its earlier sessions under $HOME, and an audit that
 * silently covered half the history would be worse than one that found nothing.
 */
export function claudeProjectRoots(cwd = process.cwd(), env = process.env) {
  const seen = new Set();
  const out = [];
  for (const p of [
    env.CLAUDE_CONFIG_DIR && join(env.CLAUDE_CONFIG_DIR, 'projects'),
    join(cwd, '.claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
  ]) {
    if (p && !seen.has(p) && existsSync(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { process.stderr.write(`${args.error}\n`); process.exit(2); }
  if (args.help) { process.stdout.write(HELP); return; }
  const cwd = process.cwd();
  const roots = claudeProjectRoots(cwd);
  // Staging/metering still needs ONE root to hand ccusage; the first is the
  // most specific (an explicit CLAUDE_CONFIG_DIR, else the repo-local one).
  const projectsRoot = roots[0] ?? join(homedir(), '.claude', 'projects');

  // GitHub Copilot keeps its own accounting: `session.shutdown.modelMetrics`
  // carries the exact per-model token breakdown and `subagent.completed` carries
  // per-sub-agent totals — the JOIN this script does for Claude is already done
  // there, and ccusage is not needed for tokens. See copilot-usage.mjs.
  if (args.host === 'copilot') return runCopilot(cwd, args);

  let projectDirs = args.projectDir;
  if (!projectDirs.length) {
    if (args['all-projects']) {
      // Across every root — a machine with both a repo-local and a global store
      // has real projects in each.
      projectDirs = roots.flatMap((root) => readdirSync(root)
        .map((n) => join(root, n))
        .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } }));
    } else {
      // ALL matching roots, per claudeProjectRoots' own contract — a project
      // that moved stores mid-history has transcripts in more than one, and
      // metering only the first silently under-reports total spend.
      const resolved = roots.map((r) => resolveProjectDir(cwd, r)).filter(Boolean);
      if (!resolved.length) {
        process.stderr.write(
          'No Claude Code transcripts found for this project.\n'
          + `Looked in: ${roots.join(', ') || '(no Claude projects directory exists)'}\n`
          + 'efficiency-audit reads local agent-CLI transcripts; run it from the project root, or pass --project-dir.\n');
        process.exit(3);
      }
      projectDirs = resolved;
    }
  }

  const tags = {};
  for (const t of args.tag) {
    const idx = t.indexOf('=');
    if (idx > 0) tags[t.slice(0, idx)] = t.slice(idx + 1);
  }

  let groups = collectSessionGroups(projectDirs, { excludeSession: args['exclude-session'], tags });
  if (args.since || args.until) {
    const { kept, droppedUnknownDate } = filterGroupsByDateRange(groups, args.since, args.until);
    groups = kept;
    if (droppedUnknownDate) process.stderr.write(`Note: dropped ${droppedUnknownDate} session(s) with no resolvable date from the window.\n`);
  }

  const weight = ['output', 'total', 'cost'].includes(args.weight) ? args.weight : 'cost';
  const bin = args['ccusage-bin'] || 'npx';

  // Primary: meter each session AND sub-agent per file (exact). Stage a temp dir
  // of flattened hard links, run `ccusage claude session` over it, tear down.
  // Pricing: default is offline (cached DB, fast, no network). But the cached DB
  // can lag new models (e.g. claude-sonnet-5 priced $0 → ~9× undercount), so when
  // an offline run reports UNPRICED models we auto-refresh online — unless the
  // user forced --offline. --online forces online from the start.
  let meteredMap = null;
  let unpricedModels = [];
  let staging = null;
  const wantOnline = !!args.online;
  const forceOffline = !!args.offline;
  if (!args['no-ccusage'] && !args['no-meter']) {
    staging = stageFlattened(projectDirs, { excludeSession: args['exclude-session'] });
    let res = meterFiles(staging.stageRoot, { bin, offline: !wantOnline, mode: args.mode });
    if (res && res.unpriced.length && !wantOnline && !forceOffline) {
      process.stderr.write(`Note: offline pricing missing ${res.unpriced.join(', ')} — refreshing online…\n`);
      const online = meterFiles(staging.stageRoot, { bin, offline: false, mode: args.mode });
      if (online && online.unpriced.length < res.unpriced.length) res = online;
    }
    meteredMap = res ? res.costs : null;
    unpricedModels = res ? res.unpriced : [];
    if (!meteredMap) process.stderr.write('Note: per-file metering unavailable (needs `ccusage claude`); falling back to session-total + allocation.\n');
  }
  // Fallback source: parent-session totals (already fold in sub-agents), used
  // only for groups the metered map didn't cover — when metering covered every
  // unit there's nothing to fall back to, so skip the extra ccusage run.
  const meteredCoversAll = meteredMap != null
    && groups.every((g) => g.units.every((u) => typeof meteredMap.get(u.id) === 'number'));
  const sessionMap = (args['no-ccusage'] || meteredCoversAll) ? null : runCcusage({
    bin, offline: forceOffline || (!wantOnline && !unpricedModels.length), mode: args.mode,
    agent: args.agent || 'claude', since: args.since, until: args.until,
  });
  if (staging) staging.cleanup();

  const rollup = buildRollup(groups, { meteredMap, sessionMap, weight, unpricedModels });
  const delivery = await loadDelivery(args, rollup);
  // A measured count beats a remembered one. `--resolved N` stays supported for
  // work the pipeline never reported on, but when both are given the reports
  // win and the disagreement is printed — a mismatch is itself a finding, and
  // silently preferring either one hides it.
  let resolved = args.resolved ? Number(args.resolved) : undefined;
  if (delivery) {
    if (resolved != null && resolved !== delivery.delivered) {
      process.stderr.write(`--resolved ${resolved} disagrees with the run reports (${delivery.delivered} automated); using the reports\n`);
    }
    resolved = delivery.delivered;
  }

  if (args.diff) {
    const prior = JSON.parse(readFileSync(args.diff, 'utf8'));
    process.stdout.write(renderDiff({ ...rollup, resolved }, prior.rollup ? { ...prior.rollup, resolved: prior.resolved } : prior) + '\n');
    return;
  }
  const snapshot = () => JSON.stringify({
    generatedAt: new Date().toISOString(), resolved, weight, rollup,
    ...(delivery ? { delivery } : {}),
  }, null, 2);
  if (args.json) {
    process.stdout.write(snapshot() + '\n');
  } else {
    const md = renderMarkdown(rollup, { resolved, label: args.bundle, weight, delivery });
    if (args.out) writeFileSync(args.out, md);
    else process.stdout.write(md + '\n');
  }
  if (args.snapshot) {
    writeFileSync(args.snapshot, snapshot());
    process.stderr.write(`Snapshot written to ${args.snapshot}\n`);
  }
}

/**
 * Resolve `--resolved-from` into the delivery block the report renders. Returns
 * undefined when the flag is absent; exits non-zero when it was given and found
 * nothing, because a caller that asked for measured counts must not silently
 * fall back to a hand-typed one.
 */
async function loadDelivery(args, rollup) {
  const from = args['resolved-from'];
  if (!from) return undefined;
  const R = await import('./run-reports.mjs');
  // Bare `--resolved-from` means "wherever this project keeps them".
  const target = from === true ? join('.agents', 'automation') : String(from);
  const paths = R.findReports(target);
  if (!paths.length) {
    process.stderr.write(`--resolved-from: no report.json found under ${target}\n`);
    process.exit(3);
  }
  const delivery = R.readRunReports(paths);
  const coverage = R.branchCoverage(rollup.ledger || [], delivery.branches);
  const summary = R.summarizeDelivery(delivery, rollup.totals?.costUsd, {
    rollupDays: Object.keys(rollup.byDay || {}),
    coverage,
  });
  return { ...delivery, coverage, ...summary };
}

/**
 * The Copilot path: no ccusage, no staging, no metering round-trip — Copilot
 * already reports exact per-model tokens per session and per-sub-agent totals.
 *
 * Dollars are DELIBERATELY absent unless `ccusage copilot` has data, which
 * needs the OpenTelemetry file export enabled before the session ran and is not
 * retroactive. This script never invents a rate (see its header), so the
 * Copilot report leads with tokens and Copilot's own billing unit — premium
 * requests — and says so rather than printing a confident $0.00.
 */
async function runCopilot(cwd, args) {
  const C = await import('./copilot-usage.mjs');
  const roots = C.copilotRoots(cwd);
  if (!roots.length) {
    process.stderr.write(
      'No GitHub Copilot sessions found.\n' +
      'Looked for <cwd>/.copilot/session-state, $COPILOT_HOME/session-state and ~/.copilot/session-state.\n');
    process.exit(3);
  }
  const tags = {};
  for (const t of args.tag) {
    const idx = t.indexOf('=');
    if (idx > 0) tags[t.slice(0, idx)] = t.slice(idx + 1);
  }
  let groups = C.collectCopilotGroups(cwd, { roots, excludeSession: args['exclude-session'], tags });
  if (args.since || args.until) {
    const { kept } = filterGroupsByDateRange(groups, args.since, args.until);
    groups = kept;
  }
  if (!groups.length) {
    process.stderr.write(`No Copilot sessions for this project in ${roots.join(', ')}\n`);
    process.exit(3);
  }
  C.priceGroups(groups);
  // Feed Copilot's own per-unit dollars in as the metered map, labelled with
  // their real provenance — `ccusage-metered` would send a later reader to the
  // wrong tool to verify a number ccusage never produced.
  const meteredMap = new Map();
  for (const g of groups) for (const u of g.units) if (typeof u.cost === 'number') meteredMap.set(u.id, u.cost);

  const rollup = buildRollup(groups, {
    meteredMap: meteredMap.size ? meteredMap : null,
    sessionMap: new Map(), weight: 'total', meteredSource: 'copilot-nano-aiu',
  });
  const parents = groups.map((g) => g.units.find((u) => u.kind === 'session')).filter(Boolean);
  const credits = parents.reduce((n, u) => n + (u.credits ?? 0), 0);
  const usd = parents.reduce((n, u) => n + (u.usd ?? 0), 0);
  const priced = parents.filter((u) => u.usd != null).length;
  const premium = parents.reduce((n, u) => n + (u.premiumRequests ?? 0), 0);

  // The delivery join is host-neutral by construction: it reads the pipeline's
  // report.json, which the lead writes the same way on every host (on a runner
  // with no workflow the lead writes it by hand at close — see the playbook's
  // "Without a workflow, git carries it"). Skipping it here would have made
  // --resolved-from silently do nothing on Copilot, which is worse than not
  // supporting it: the operator gets a report with no per-case figures and no
  // reason given.
  const delivery = await loadDelivery(args, rollup);
  const resolved = delivery ? delivery.delivered : (args.resolved ? Number(args.resolved) : undefined);

  // Flags that mean something only on the ccusage-priced Claude path. Silence
  // was the wrong answer: `--weight output` on a Copilot run looked accepted
  // and changed nothing about a split that is Copilot's own billed figure.
  const inapplicable = ['weight', 'mode', 'no-meter', 'no-ccusage', 'online', 'offline', 'ccusage-bin', 'agent']
    .filter((f) => args[f] !== undefined && args[f] !== false);
  if (inapplicable.length) {
    process.stderr.write(
      `Ignored on --host copilot: ${inapplicable.map((f) => `--${f}`).join(', ')}. `
      + 'Copilot reports its own billed credits per session; there is no ccusage metering or allocation weight to tune.\n');
  }

  const snapshot = () => JSON.stringify({
    generatedAt: new Date().toISOString(), host: 'copilot', roots,
    aiCredits: credits, usd, usdPerCredit: C.USD_PER_CREDIT,
    sessionsPriced: priced, sessionsTotal: parents.length,
    legacyPremiumRequests: premium, resolved, rollup,
    ...(delivery ? { delivery } : {}),
  }, null, 2);

  if (args.diff) {
    const prior = JSON.parse(readFileSync(args.diff, 'utf8'));
    process.stdout.write(renderDiff({ ...rollup, resolved },
      prior.rollup ? { ...prior.rollup, resolved: prior.resolved } : prior) + '\n');
    return;
  }
  if (args.json) {
    process.stdout.write(snapshot() + '\n');
    if (args.snapshot) { writeFileSync(args.snapshot, snapshot()); process.stderr.write(`Snapshot written to ${args.snapshot}\n`); }
    return;
  }
  const unpriced = parents.length - priced;
  const md = renderMarkdown(rollup, { label: args.bundle, weight: 'total', pricer: 'GitHub Copilot', resolved, delivery }) +
    `\n\n## GitHub Copilot notes\n\n` +
    `- Roots read: ${roots.map((r) => `\`${r}\``).join(', ')}\n` +
    `- **AI credits: ${credits.toFixed(3)} ≈ $${usd.toFixed(2)}** ` +
    `(1 credit = $${C.USD_PER_CREDIT}). Reported by Copilot itself as ` +
    `\`session.shutdown.totalNanoAiu\` — this is the billed figure, not an estimate of ours.\n` +
    (unpriced
      ? `- ${unpriced} of ${parents.length} session(s) predate usage-based billing (2026-06-01) and carry no credit figure; ` +
        `their tokens are counted, their cost is \`n/a\`. Retroactive pricing is not possible — ` +
        (premium ? `they were billed as ${premium} legacy premium request(s).\n` : `they were billed as legacy premium requests.\n`)
      : '') +
    `- Per-session credits are split across the session's units by token share: Copilot reports cost per SESSION, ` +
    `not per sub-agent, so a sub-agent's dollar figure is derived while the session's is exact.\n` +
    `- Sub-agent rows carry a **token total only** (no input/output/cache split per sub-agent); ` +
    `the split on session rows is exact. Session rows are net of their sub-agents so the two do not double-count.\n` +
    `- \`ccusage copilot\` is an independent second opinion, but needs the OpenTelemetry file export enabled ` +
    `BEFORE a session runs (\`COPILOT_OTEL_ENABLED=true\`, \`COPILOT_OTEL_EXPORTER_TYPE=file\`, ` +
    `\`COPILOT_OTEL_FILE_EXPORTER_PATH=…\`) and is likewise not retroactive.\n`;
  if (args.out) writeFileSync(args.out, md);
  else process.stdout.write(md + '\n');
  if (args.snapshot) {
    writeFileSync(args.snapshot, snapshot());
    process.stderr.write(`Snapshot written to ${args.snapshot}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
