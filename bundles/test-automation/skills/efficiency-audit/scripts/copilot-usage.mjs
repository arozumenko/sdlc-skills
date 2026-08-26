// copilot-usage.mjs — read GitHub Copilot sessions into the same unit/group
// shape `buildRollup` already consumes, so the rollup, the ledger and the
// markdown render work on Copilot without a second reporting path.
//
// COST, AND WHY THERE IS STILL NO PRICE TABLE HERE. This skill never prices
// tokens itself (see usage-rollup.mjs' header). It doesn't have to: **Copilot
// reports its own cost**, and that is strictly better than any table we could
// keep — it is the number the customer is billed on.
//
// GitHub moved Copilot from request-based to usage-based billing on 2026-06-01:
// cost is now model + tokens consumed, denominated in **AI credits**, and
// `1 AI credit = $0.01 USD`. Premium requests are the LEGACY unit and survive
// only on unexpired annual plans (the CLI's own `copilot help billing` says so:
// "Usage is measured in AI credits. If you're on the legacy billing platform,
// you may see premium requests instead").
//
// In the event stream that shows up as `session.shutdown.totalNanoAiu` — nano
// AI units, so `/1e9` gives credits and `× 0.01` gives dollars. Measured on real
// sessions: 19_862_850_000 → 19.863 credits → $0.1986. The field appears from
// the 2026-06-01 transition onward (57 of 84 sessions on this machine); older
// sessions carry only `totalPremiumRequests`, and there is no way to price them
// retroactively, so they report tokens with cost `n/a` rather than a guess.
//
// `ccusage copilot` remains an independent second opinion, but it needs the
// OpenTelemetry file export to have been enabled BEFORE the session ran
// (COPILOT_OTEL_ENABLED / COPILOT_OTEL_EXPORTER_TYPE=file /
// COPILOT_OTEL_FILE_EXPORTER_PATH) and is likewise not retroactive.
//
// WHAT COPILOT GIVES FOR FREE. On Claude, per-sub-agent cost has to be metered
// by staging transcripts and re-running ccusage per file. Copilot pre-aggregates
// it: `subagent.completed` carries agentName, model, totalTokens, totalToolCalls
// and durationMs. The expensive JOIN this skill exists to do is already done.
//
// THE ONE GAP, STATED PLAINLY. A sub-agent reports `totalTokens` only — no
// input/output/cache split. The split exists at SESSION level
// (`session.shutdown.modelMetrics`) and is exact there. So per-sub-agent rows
// carry `usage.input = totalTokens` with the other buckets at 0 and are flagged
// `tokensOnly: true`; session rows carry the true breakdown. Read a sub-agent's
// number as "total tokens", never as "input tokens".
import { existsSync, readFileSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Copilot pools EVERY project's sessions in one flat directory, so the cwd
// filter is the only thing standing between this and parsing the whole
// machine's history. Answering it needs the first record, not the file:
// `session.start` opens every stream observed.
const CWD_PROBE_BYTES = 64 * 1024;

/** The session's cwd from a bounded head read — never the whole file. */
export function firstCwdOfEvents(eventsPath) {
  let fd;
  try {
    fd = openSync(eventsPath, 'r');
    const buf = Buffer.alloc(CWD_PROBE_BYTES);
    const n = readSync(fd, buf, 0, CWD_PROBE_BYTES, 0);
    const lines = buf.subarray(0, n).toString('utf8').split('\n');
    if (n === CWD_PROBE_BYTES) lines.pop();     // truncated tail line, not data
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = safeParse(line);
      if (rec?.type === 'session.start') return rec.data?.context?.cwd ?? null;
    }
  } catch { /* unreadable → treat as unknown */ }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } } }
  return null;
}

/**
 * Is `sessionCwd` the project at `cwd`, or inside it? Separator- and
 * case-insensitive: Windows mixes `\` and `/` and is case-insensitive, so an
 * exact comparison silently matched nothing there.
 */
export function sameCwdOrUnder(sessionCwd, cwd) {
  if (!cwd) return true;
  if (!sessionCwd) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const a = norm(sessionCwd);
  const b = norm(cwd);
  return a === b || a.startsWith(`${b}/`);
}

// LOCAL calendar day — same rule as usage-rollup's localDate. A UTC slice here
// made Copilot day buckets disagree with the Claude path near midnight, and
// --since/--until silently dropped sessions on the local/UTC boundary.
const localDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Where Copilot keeps its sessions. NOT always `~/.copilot`: `COPILOT_HOME`
 * relocates the whole config dir, and pointing it at a repo-local `./.copilot`
 * is a documented setup (it is how a project-local MCP config gets picked up).
 * A rollup that only ever looked in the home directory would silently report
 * "no sessions" for exactly the projects that configured themselves properly.
 *
 * Order: explicit env → repo-local → home. First one that exists wins; the
 * home path is returned as the last resort so callers get a stable value.
 */
export function copilotRoot(cwd = process.cwd(), env = process.env) {
  const candidates = [
    env.COPILOT_HOME && join(env.COPILOT_HOME, 'session-state'),
    join(cwd, '.copilot', 'session-state'),
    join(homedir(), '.copilot', 'session-state'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1];
}

/** Every root that exists — a project may have both local and home sessions. */
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

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export function readEvents(eventsPath) {
  const out = [];
  for (const line of readFileSync(eventsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = safeParse(line);
    if (rec && rec.type) out.push(rec);
  }
  return out;
}

export function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, models: new Set() };
}

/**
 * Session-level usage from `session.shutdown.modelMetrics`.
 *
 * A long session shuts down more than once (resume/compaction each emit one),
 * and each shutdown reports the totals SO FAR — not a delta. Summing them
 * double-counts, so the LAST shutdown wins per model.
 */
export function sessionUsage(events) {
  const usage = emptyUsage();
  let premiumRequests = 0, apiDurationMs = 0, nanoAiu = null;
  const byModel = new Map();

  for (const ev of events) {
    if (ev.type !== 'session.shutdown') continue;
    const d = ev.data ?? {};
    if (typeof d.totalPremiumRequests === 'number') premiumRequests = d.totalPremiumRequests;
    if (typeof d.totalApiDurationMs === 'number') apiDurationMs = d.totalApiDurationMs;
    // Present from the 2026-06-01 usage-based billing switch onward. Absent on
    // older sessions — null (unknown) must not collapse to 0 (free).
    if (typeof d.totalNanoAiu === 'number') nanoAiu = d.totalNanoAiu;
    for (const [model, m] of Object.entries(d.modelMetrics ?? {})) {
      byModel.set(model, m);           // last shutdown wins — cumulative, not delta
    }
  }
  for (const [model, m] of byModel) {
    const u = m.usage ?? {};
    usage.input += u.inputTokens ?? 0;
    usage.output += u.outputTokens ?? 0;
    usage.cacheRead += u.cacheReadTokens ?? 0;
    usage.cacheCreation += u.cacheWriteTokens ?? 0;
    usage.models.add(model);
  }
  return {
    usage, premiumRequests, apiDurationMs, nanoAiu,
    credits: nanoAiu === null ? null : nanoAiu / 1e9,
    usd: nanoAiu === null ? null : (nanoAiu / 1e9) * USD_PER_CREDIT,
    modelCount: byModel.size,
  };
}

/** GitHub's published conversion; the only constant this module needs. */
export const USD_PER_CREDIT = 0.01;

/** Sub-agent units, one per `subagent.completed`. */
export function subagentUnits(events, sessionId) {
  const started = new Map();
  const out = [];
  // Copilot interleaves sub-agent events into the parent stream, tagged with
  // `agentId`. Counting turns per agentId is the only way to fill the turns
  // column — `subagent.completed` reports tool calls and duration but not turns.
  //
  // The join below keys on `agentId` and reads back by `data.toolCallId`, which
  // only works because Copilot uses the SAME id for both. MEASURED, not assumed
  // (2026-07-31, a real 4.7 MB CLI session with 17 sub-agents): every event
  // carrying `agentId` — subagent.started/completed, assistant.message,
  // tool.execution_start/complete — carries the tool-call id of the sub-agent it
  // belongs to, and `ev.agentId === ev.data.toolCallId` held 17 of 17. Across
  // that repo's 73 sessions, 51 of 54 sub-agents resolved turns; the 3 that did
  // not were genuinely empty dispatches (0 tool calls, 0 tokens), not join
  // misses. If a future stream breaks this, sub-agent turns/errors silently go
  // to zero — the assertion in the test file is what catches it.
  const turnsById = new Map();
  const errsById = new Map();
  for (const ev of events) {
    if (!ev.agentId) continue;
    if (ev.type === 'user.message' || ev.type === 'assistant.message') {
      turnsById.set(ev.agentId, (turnsById.get(ev.agentId) ?? 0) + 1);
    } else if (ev.type === 'tool.execution_complete' && ev.data?.success === false) {
      errsById.set(ev.agentId, (errsById.get(ev.agentId) ?? 0) + 1);
    }
  }
  for (const ev of events) {
    const d = ev.data ?? {};
    if (ev.type === 'subagent.started') {
      started.set(d.toolCallId, d.agentDescription ?? '');
    } else if (ev.type === 'subagent.completed') {
      const usage = emptyUsage();
      // See the header: only a total is available per sub-agent.
      usage.input = d.totalTokens ?? 0;
      if (d.model) usage.models.add(d.model);
      out.push({
        id: d.toolCallId, kind: 'subagent', parentId: sessionId, sessionId,
        role: d.agentName ?? 'unknown',
        description: started.get(d.toolCallId) ?? '',
        usage, tokensOnly: true,
        toolCalls: d.totalToolCalls ?? 0,
        durationMin: d.durationMs ? Math.round(d.durationMs / 60000) : 0,
        turns: turnsById.get(d.toolCallId) ?? 0,
        toolErrors: errsById.get(d.toolCallId) ?? 0,
        skills: [], dispatched: [],
      });
    }
  }
  return out;
}

/** cwd, branch, role, skills and the wall-clock window, from the stream's own events. */
function meta(events) {
  let cwd = null, gitBranch = '?', startTs = null, endTs = null, role = null;
  const skills = new Set();
  for (const ev of events) {
    if (ev.type === 'session.start') {
      cwd = ev.data?.context?.cwd ?? cwd;
      gitBranch = ev.data?.context?.branch ?? gitBranch;
    }
    // The parent session's `--agent` — emitted by CLI ≥1.0.63 (verified live);
    // older streams lack the event and the role stays null (ad-hoc/unknown).
    if (ev.type === 'subagent.selected') role = ev.data?.agentName ?? role;
    if (ev.type === 'skill.invoked' && ev.data?.name) skills.add(ev.data.name);
    const t = ev.timestamp ? Date.parse(ev.timestamp) : NaN;
    if (Number.isNaN(t)) continue;
    if (startTs === null || t < startTs) startTs = t;
    if (endTs === null || t > endTs) endTs = t;
  }
  return {
    cwd, gitBranch, startTs, endTs, role, skills,
    date: startTs ? localDate(startTs) : '?',
    durationMin: (startTs && endTs) ? Math.round((endTs - startTs) / 60000) : 0,
  };
}

/** Turn and tool-call counts for the PARENT, excluding sub-agent events. */
function parentCounts(events) {
  let turns = 0, toolCalls = 0, toolErrors = 0;
  const dispatched = [];
  for (const ev of events) {
    const d = ev.data ?? {};
    // A dispatch is the PARENT's act, but the event announcing it is tagged
    // with the CHILD's id — `subagent.started` always carries `agentId` (18 of
    // 18 across CLI 1.0.35 and 1.0.63). So it has to be read BEFORE the
    // sub-agent skip below; behind it the push was unreachable and every
    // session reported `subagentsDispatched: 0` while dispatching normally.
    if (ev.type === 'subagent.started' && d.agentName) dispatched.push(d.agentName);
    if (ev.agentId) continue;                       // sub-agent work, counted separately
    if (ev.type === 'user.message' || ev.type === 'assistant.message') turns++;
    if (ev.type === 'tool.execution_start') toolCalls++;
    if (ev.type === 'tool.execution_complete' && d.success === false) toolErrors++;
  }
  return { turns, toolCalls, toolErrors, dispatched };
}

/**
 * One group per Copilot session, in `buildRollup`'s shape:
 * `{sessionId, projectDir, date, units:[…]}` with the parent unit first.
 *
 * `cwd` filters to the project — Copilot pools every project's sessions in one
 * flat directory, unlike Claude's per-project folders.
 */
export function collectCopilotGroups(cwd, { root, roots, excludeSession, tags = {} } = {}) {
  // A project can hold sessions in more than one root at once (a repo-local
  // .copilot from a COPILOT_HOME run, plus older ones under ~). Read them all;
  // an explicit `root` still pins a single one.
  const searchRoots = root ? [root] : (roots ?? copilotRoots(cwd));
  const groups = [];

  for (const { id, path } of searchRoots.flatMap((r) => sessionEntries(r))) {
    if (id === excludeSession) continue;

    // Filter by project BEFORE parsing. Copilot pools every project's sessions
    // in one directory, so parsing first meant reading the whole machine's
    // history (22 MB streams observed) to then discard most of it.
    if (cwd && !sameCwdOrUnder(firstCwdOfEvents(path), cwd)) continue;

    let events;
    try { events = readEvents(path); } catch { continue; }
    if (!events.length) continue;

    const m = meta(events);
    if (cwd && !sameCwdOrUnder(m.cwd, cwd)) continue;

    const { usage, premiumRequests, apiDurationMs, credits, usd } = sessionUsage(events);
    const counts = parentCounts(events);
    const subs = subagentUnits(events, id);

    // The session total already INCLUDES its sub-agents' tokens. Leaving both at
    // full value would double-count the session's spend, so the parent row is
    // reported net of what the sub-agents accounted for — the same convention
    // the Claude path reaches via per-file metering.
    const subTotal = subs.reduce((n, u) => n + u.usage.input, 0);
    const parentUsage = { ...usage, models: new Set(usage.models) };
    parentUsage.input = Math.max(0, parentUsage.input - subTotal);

    const parent = {
      id, kind: 'session', parentId: null, sessionId: id,
      role: tags[id] || m.role || null, // explicit tag wins; else subagent.selected (CLI ≥1.0.63)
      description: '(orchestrator/session)',
      usage: parentUsage,
      premiumRequests, apiDurationMs, credits, usd,
      gitBranch: m.gitBranch, date: m.date, durationMin: m.durationMin,
      startTs: m.startTs, endTs: m.endTs,
      turns: counts.turns, toolCalls: counts.toolCalls, toolErrors: counts.toolErrors,
      skills: [...m.skills], dispatched: counts.dispatched,
      projectDir: m.cwd,
    };
    for (const s of subs) {
      s.projectDir = m.cwd; s.gitBranch = m.gitBranch; s.date = m.date;
      s.startTs = m.startTs; s.endTs = m.endTs;
      if (tags[s.id]) s.role = tags[s.id];
    }
    groups.push({ sessionId: id, projectDir: m.cwd, date: m.date, units: [parent, ...subs] });
  }
  return groups.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** `{id, path}` per session dir under one root; missing root → nothing. */
function sessionEntries(root) {
  let names;
  try { names = readdirSync(root); } catch { return []; }
  return names
    .map((id) => ({ id, path: join(root, id, 'events.jsonl') }))
    .filter((e) => existsSync(e.path));
}

/**
 * Dollars per unit. The session's own `totalNanoAiu` is the authority — it is
 * what GitHub bills — and it is split across the session's units by token share
 * because Copilot reports cost per SESSION, not per sub-agent.
 *
 * `costBySession` (e.g. from `ccusage copilot`) overrides it when supplied, and
 * a session predating usage-based billing has neither: those units are flagged
 * `copilot-tokens-only` with cost null, never a confident 0.
 */
/**
 * A unit's share of the session's dollars, in tokens.
 *
 * ALL buckets, not input+output. A sub-agent reports one cache-INCLUSIVE
 * `totalTokens` (parked in `usage.input` — see the header), while a session row
 * carries a true split. Weighing by input+output therefore counted the
 * sub-agent's cache traffic and dropped the parent's, systematically
 * over-crediting sub-agents on exactly the cache-heavy orchestrator sessions
 * this pipeline produces. Summing every bucket puts both on the same footing.
 */
const splitWeight = (u) =>
  u.usage.input + u.usage.output + (u.usage.cacheRead ?? 0) + (u.usage.cacheCreation ?? 0);

export function priceGroups(groups, { costBySession = null } = {}) {
  for (const g of groups) {
    const parent = g.units.find((u) => u.kind === 'session');
    const external = costBySession?.get?.(g.sessionId);
    const known = external != null ? external : (parent?.usd ?? null);
    const source = external != null ? 'ccusage-copilot' : 'copilot-nano-aiu';
    const total = g.units.reduce((n, u) => n + splitWeight(u), 0) || 1;
    for (const u of g.units) {
      if (known == null) { u.cost = null; u.costSource = 'copilot-tokens-only'; continue; }
      u.cost = known * (splitWeight(u) / total);
      u.costSource = source;
    }
  }
  return groups;
}
