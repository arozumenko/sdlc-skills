#!/usr/bin/env node
// Distill Claude Code session transcripts for the current project into a
// compact markdown digest for a scout-led retrospective. READ-ONLY: emits a
// digest to stdout (or --out file); never writes memory/docs/watermark.
import {
  readFileSync, readdirSync, existsSync, statSync, writeFileSync,
  openSync, readSync, closeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// LOCAL calendar day — same rule as efficiency-audit's usage-rollup, so the
// two skills bucket the same session onto the same day.
const localDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const FILE_CHURN_THRESHOLD = 4;          // edits to one path before it's a signal
const RETRY_WINDOW = 6;                   // look-ahead window (tool calls)
const MAX_CORRECTIONS_PER_SESSION = 12;
const MAX_QUOTE_LEN = 200;
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

// --- Correction detection ----------------------------------------------------
//
// The signal taxonomy calls corrections "the richest source of durable
// lessons". The detector therefore has to actually find them. The previous one
// was a single regex anchored to `^`, and on a measured 160-turn session it
// matched ONE turn — while the transcript visibly contained "why did you do X",
// "hm, why not fold it into hooks then?" and a dozen more. Anchoring to `^`
// assumes a correction leads the message; most don't. They arrive after a
// discourse marker, inside a longer message, or as the second sentence.
//
// So: unanchored, and RANKED rather than first-N-that-match — a loose matcher
// with a fixed budget must spend that budget on its strongest hits, not on
// whatever appeared first.
//
// These stay CANDIDATES. The skill's reader promotes a candidate to a finding;
// the parser's job is to not hide it. Precision is deliberately traded for
// recall inside a bounded, ranked, labelled list.

// Unicode-aware word boundaries. JS `\b` is ASCII-only, so a pattern written in
// any script other than Latin matches inside unrelated words — the lookarounds
// keep this correct for whatever alternatives a team adds below.
const B0 = '(?<![\\p{L}\\p{N}_])';
const B1 = '(?![\\p{L}\\p{N}_])';
const w = (...alts) => new RegExp(B0 + '(?:' + alts.join('|') + ')' + B1, 'iu');

// ENGLISH ONLY, AND THAT IS A REAL LIMIT — not a safe default. A detector that
// cannot read the language a session was held in does not report "I can't read
// this"; it reports NO CORRECTIONS, which is indistinguishable from a session
// that went perfectly. A team working in another language should extend the
// alternatives below (the boundaries above already handle non-Latin scripts)
// and update the coverage line in renderDigest, which exists so a reader knows
// whether a quiet list means quiet or blind.
//
// Tiers carry a weight, used for ranking when more candidates are found than
// the budget shows. `kind` is printed next to the quote so the reader can
// triage a list of twelve without re-reading twelve sessions.
const CORRECTION_TIERS = [
  { kind: 'reversal', weight: 4, re: w(
    'revert', 'undo', 'roll ?back', 'put it back', 'take (?:that|it) (?:out|back)',
  ) },
  { kind: 'prohibition', weight: 4, re: w(
    "don'?t", 'do not', 'never', 'stop', 'no need to', 'leave it alone',
  ) },
  { kind: 'wrong', weight: 3, re: w(
    'wrong', 'incorrect', 'nope', "that'?s not (?:what|it|right|true)",
    "not what i (?:asked|meant|wanted|said)", "i didn'?t ask",
    // A bare leading "no" — the single most common correction opener ("No, use
    // the other file"). Anchored so "there is no file" never matches.
    '^no(?=[,.!:;\\s]|$)',
  ) },
  { kind: 'missed', weight: 3, re: w(
    'you (?:missed|forgot|broke|removed|skipped)', 'still (?:wrong|broken|failing|not)',
  ) },
  { kind: 'redirect', weight: 2, re: w(
    'actually', 'wait', 'hold on', 'instead', 'rather than that',
  ) },
  { kind: 'challenge', weight: 1, re: w(
    'are you sure', 'you sure', "shouldn'?t (?:it|we|you)", "i don'?t (?:like|think)",
    'seems (?:wrong|off|excessive|like too much)', 'why did you', 'why not',
  ) },
];

// Text the user did not type: hook output, slash-command envelopes, system
// reminders, tool results. Matching a correction inside a system-reminder would
// attribute the harness's own words to the human.
//
// The compaction summary is the one that actually bites. It arrives as a `user`
// record, it is enormous, and it QUOTES the whole session back — including
// every correction in it. Scanning it finds matches that are real corrections
// from earlier turns, re-dated to the compaction boundary and credited twice.
// Any message opening with an XML-ish tag is the harness talking, not the
// human: <system-reminder>, <task-notification>, <command-name>,
// <local-command-caveat>, <user-prompt-submit-hook>. Enumerating them by name
// loses to the next one that gets added — matching the SHAPE does not.
const NOT_USER_SPEECH = /^\s*(?:<[a-z][a-z0-9-]*[\s>]|\[Request interrupted|This session is being continued from a previous conversation|Base directory for this skill:)/i;

// A correction is a REACTION — the human read what just happened and pushed
// back. Reactions are short. Everything long that reaches this function is
// something else wearing the same words: a pasted prompt, a skill-load block, a
// code block containing `// don't`, a fresh multi-paragraph brief that happens
// to say "never". Measured on this repo's own history, dropping the long ones
// removed every false positive in the top of the list and cost no real
// correction. It is a blunt rule and it is the right one: recall past this
// point buys noise, and a noisy list of twelve is read once and then ignored.
const MAX_CORRECTION_LEN = 500;

// Short pasted code still gets through the length rule, and a comment reading
// `// never duplicates` scores as a prohibition the user never uttered.
const LOOKS_LIKE_CODE = /^\s*(?:\/\/|\/\*|#!|<\?|(?:function|const|let|var|import|export|class|def|public|private)\s)/;

/**
 * Classify one user message. Returns the strongest tier it matches, scored, or
 * null. Score = tier weight + position bonus (a correction that LEADS is more
 * likely meant as one) + brevity bonus (a short turn straight after agent work
 * is a reaction; a long one is usually the next brief).
 */
export function classifyCorrection(text) {
  if (!text || NOT_USER_SPEECH.test(text)) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat || flat.length > MAX_CORRECTION_LEN || LOOKS_LIKE_CODE.test(flat)) return null;
  let best = null;
  for (const t of CORRECTION_TIERS) {
    const m = t.re.exec(flat);
    if (!m) continue;
    const lead = m.index <= 24 ? 1 : 0;
    const brief = flat.length <= 120 ? 1 : 0;
    const score = t.weight + lead + brief;
    if (!best || score > best.score) best = { kind: t.kind, score, at: m.index };
  }
  return best;
}
const FAILURE_RE =
  /\b(blocked|failed|failure|error|cannot|can't|unable|timed? ?out|not found|missing|limit|denied|refused|stalled|gave up)\b/i;
const FINGERPRINT_LEN = 2000;             // must exceed the dispatch preamble (~800 chars) to reach the varying part
const MAX_FAILURES = 12;
const MAX_REPEATS = 12;
const MAX_RESULT_LEN = 240;               // truncation for a sub-agent's returned result
const OUTLIER_FACTOR = 3;                 // turns >= N x the median for its agentType
const MAX_OUTCOMES = 25;                  // distinct returned outcomes shown per session
const MAX_OUTLIERS = 10;

function safeParse(line) { try { return JSON.parse(line); } catch { return null; } }

// Claude Code names a project dir by replacing every path separator and every
// character that is awkward in a filename with a dash. Measured against the 28
// project dirs on one real machine: this class resolves 28/28. The previous
// `[/.]` resolved 6/28 — it missed underscores (`Some_User`), spaces
// (`AI baseline`), and on Windows every path there is, since `C:\Users\x`
// contains neither a slash nor a dot to replace.
//
// A miss is not a failure, it is a COST: resolveProjectDir falls back to
// opening transcripts across every project dir looking for a matching `cwd`.
// That fallback is what made both skills feel slow.
const PATH_SEPARATORS = /[/\\:._ ]/g;

export function encodeProjectPath(cwd) {
  return cwd.replace(PATH_SEPARATORS, '-');
}

// Windows mixes separators and is case-insensitive, so the fallback's exact
// string compare fails there even when it is looking at the right directory.
function sameCwd(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const n = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32'
    ? n(a).toLowerCase() === n(b).toLowerCase()
    : n(a) === n(b);
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

// `cwd` is written on the first records of a transcript, so read a bounded
// prefix rather than the file. The fallback below opens one of these per
// project dir, and a session transcript runs to hundreds of megabytes —
// slurping and JSON-parsing all of it to learn one string near the top is how
// the scan came to dominate the run.
const CWD_PROBE_BYTES = 64 * 1024;

function firstCwdOf(jsonlPath) {
  let fd;
  try {
    fd = openSync(jsonlPath, 'r');
    const buf = Buffer.alloc(CWD_PROBE_BYTES);
    const n = readSync(fd, buf, 0, CWD_PROBE_BYTES, 0);
    const text = buf.subarray(0, n).toString('utf8');
    // Drop the last line: at a 64 KB cut it is almost certainly truncated, and
    // a partial line is a parse error, not data.
    const lines = text.split('\n');
    if (n === CWD_PROBE_BYTES) lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = safeParse(line);
      if (rec?.cwd) return rec.cwd;
    }
  } catch { /* ignore */ }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
  return null;
}

/**
 * Every place Claude Code may keep this project's transcripts, in priority
 * order, filtered to the ones that exist.
 *
 * The repo-local root is the one that keeps getting missed. A project can set
 * `CLAUDE_CONFIG_DIR` to its own `.claude/`, and then every transcript lives
 * inside the repo rather than under `$HOME` — a real setup, and the failure is
 * silent in the worst way: the parser reports "no transcripts for this project,
 * paste one instead" while the transcripts sit in the working directory it was
 * launched from. `copilotRoots()` in the efficiency-audit skill has searched a
 * repo-local root from the start; the Claude side simply never caught up.
 *
 * Returns ALL matching roots rather than the first, because the two can both be
 * populated — a project that switched to a local config dir partway keeps its
 * older sessions under $HOME.
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

/** First root that actually holds this project, or null. */
export function resolveProjectDirIn(cwd, roots) {
  for (const root of roots) {
    const dir = resolveProjectDir(cwd, root);
    if (dir) return dir;
  }
  return null;
}

export function resolveProjectDir(cwd, projectsRoot) {
  const direct = join(projectsRoot, encodeProjectPath(cwd));
  if (existsSync(direct)) return direct;
  if (!existsSync(projectsRoot)) return null;
  // Fallback: match by the `cwd` field inside each dir's transcripts.
  for (const name of readdirSync(projectsRoot)) {
    const dir = join(projectsRoot, name);
    let jsonls;
    try { jsonls = readdirSync(dir).filter(f => f.endsWith('.jsonl')); }
    catch { continue; }
    for (const f of jsonls) if (sameCwd(firstCwdOf(join(dir, f)), cwd)) return dir;
  }
  return null;
}

function userTextOf(rec) {
  const c = rec.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(b => b?.type === 'text').map(b => b.text).join(' ');
  return '';
}

export function detectRetries(toolCalls) {
  // Count repeat events: for each call, whether the same tool+target recurs
  // within the look-ahead window. counts[key] = number of repeats (0 = none).
  const counts = {};
  for (let i = 0; i < toolCalls.length; i++) {
    for (let j = i + 1; j < toolCalls.length && j <= i + RETRY_WINDOW; j++) {
      if (toolCalls[i].tool === toolCalls[j].tool &&
          toolCalls[i].target && toolCalls[i].target === toolCalls[j].target) {
        const key = `${toolCalls[i].tool} on ${toolCalls[i].target}`;
        counts[key] = (counts[key] || 0) + 1;
        break;
      }
    }
  }
  return Object.entries(counts).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]);
}

export function extractSignals(records) {
  const toolErrors = {};      // "Tool: error" -> count
  const toolCalls = [];       // {turn, tool, target}
  const fileChurn = {};       // path -> count
  const corrections = [];     // {turn, text, kind, score} — ranked+capped below
  const interrupts = [];      // turns where the human stopped the agent mid-flight
  const seenQuotes = new Set(); // replayed user messages must not count twice
  const idToName = {};        // tool_use_id -> tool name
  let userTurns = 0, assistantTurns = 0, sawAssistant = false, turn = 0;

  for (const rec of records) {
    if (rec.type === 'assistant') {
      assistantTurns++; turn++;
      sawAssistant = true;
      const blocks = Array.isArray(rec.message?.content) ? rec.message.content : [];
      for (const b of blocks) {
        if (b?.type !== 'tool_use') continue;
        if (b.id) idToName[b.id] = b.name;
        const target = b.input?.file_path || b.input?.path || b.input?.command || '';
        toolCalls.push({ turn, tool: b.name, target: String(target).slice(0, 80) });
        if (EDIT_TOOLS.includes(b.name) && b.input?.file_path) {
          fileChurn[b.input.file_path] = (fileChurn[b.input.file_path] || 0) + 1;
        }
      }
    } else if (rec.type === 'user') {
      userTurns++; turn++;
      const blocks = rec.message?.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b?.type === 'tool_result' && b.is_error) {
            const name = idToName[b.tool_use_id] || 'tool';
            toolErrors[`${name}: error`] = (toolErrors[`${name}: error`] || 0) + 1;
          }
        }
      }
      const text = userTextOf(rec);
      // An interrupt is the shortest correction there is: the human watched the
      // agent work and stopped it. It carries no words to quote, so it is
      // counted rather than listed — but a session with six of them spent real
      // money going the wrong way, and that never showed up here before.
      if (/^\s*\[Request interrupted by user/i.test(text || '')) interrupts.push(turn);
      else if (text && sawAssistant) {
        const hit = classifyCorrection(text);
        if (hit) {
          const quote = text.slice(0, MAX_QUOTE_LEN).replace(/\s+/g, ' ').trim();
          // Claude Code replays a user message onto the transcript more than
          // once (sidechain entries, post-compaction rehydration). Counting the
          // replays turns one correction into three and makes it look like the
          // user said it repeatedly — the exact signal the reader is told to
          // weigh most heavily.
          if (!seenQuotes.has(quote)) {
            seenQuotes.add(quote);
            corrections.push({ turn, kind: hit.kind, score: hit.score, text: quote });
          }
        }
      }
    }
  }
  const retries = detectRetries(toolCalls);
  const churn = Object.entries(fileChurn)
    .filter(([, n]) => n >= FILE_CHURN_THRESHOLD).sort((a, b) => b[1] - a[1]);
  // Rank before capping. First-N-that-match spends the whole budget on the
  // opening exchanges of a long session and drops the sharpest correction in it.
  const correctionsFound = corrections.length;
  corrections.sort((a, b) => b.score - a.score || a.turn - b.turn);
  return {
    userTurns, assistantTurns, toolErrors, retries, fileChurn: churn, interrupts,
    correctionsFound,
    corrections: corrections.slice(0, MAX_CORRECTIONS_PER_SESSION).sort((a, b) => a.turn - b.turn),
  };
}

function sessionMeta(records, jsonlPath) {
  const id = basename(jsonlPath, '.jsonl');
  let branch = '?', firstTs = null, lastTs = null;
  const skills = new Set();
  for (const r of records) {
    if (r.gitBranch) branch = r.gitBranch;
    if (r.attributionSkill) skills.add(r.attributionSkill);
    if (r.attributionPlugin) skills.add(r.attributionPlugin);
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) { if (firstTs === null || t < firstTs) firstTs = t; if (lastTs === null || t > lastTs) lastTs = t; }
    }
  }
  const date = firstTs ? new Date(firstTs).toISOString().slice(0, 10) : '?';
  const durationMin = (firstTs && lastTs) ? Math.round((lastTs - firstTs) / 60000) : 0;
  return { id, branch, date, durationMin, skills: [...skills] };
}

export function parseSession(jsonlPath) {
  const records = readRecords(jsonlPath);
  return { ...sessionMeta(records, jsonlPath), ...extractSignals(records) };
}

// Sub-agent transcripts live at MORE than one depth. A plain `Agent` dispatch
// lands in `<session>/subagents/`; a Workflow-tool run nests its agents under
// `<session>/subagents/workflows/<runId>/`. Reading only the top level made the
// parser blind to workflow-driven work — measured on one campaign: 2 of 761
// sub-agents seen. Walk the whole tree.
function walkMetaFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMetaFiles(full));
    else if (e.name.endsWith('.meta.json')) out.push(full);
  }
  return out;
}

// What work was this agent asked to do? The dispatch prompt is the first user
// message and exists for every sub-agent on every host — unlike `description`,
// which workflow-spawned agents' meta.json does not carry. Normalised so the
// same work fingerprints identically across dispatches.
export function promptFingerprintOf(records) {
  for (const r of records) {
    if (r.type !== 'user') continue;
    const text = userTextOf(r).replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, FINGERPRINT_LEN);
  }
  return '';
}

// What did it hand back? An agent can finish with zero tool errors and still
// return "blocked: element not found", so `ended` alone is a poor outcome
// signal. The return value is either the last StructuredOutput call's input
// (the schema-forced result) or, failing that, the last assistant text. Read
// generically — never interpret field names, which are caller-specific.
export function finalResultOf(records) {
  let structured = null, text = '';
  for (const r of records) {
    if (r.type !== 'assistant') continue;
    for (const b of (Array.isArray(r.message?.content) ? r.message.content : [])) {
      if (b?.type === 'tool_use' && b.name === 'StructuredOutput') structured = b.input ?? null;
      else if (b?.type === 'text' && b.text?.trim()) text = b.text;
    }
  }
  const raw = structured !== null ? JSON.stringify(structured) : text;
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_RESULT_LEN);
}

export function readSubagents(sessionDir) {
  const dir = join(sessionDir, 'subagents');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const metaPath of walkMetaFiles(dir)) {
    const meta = safeParse(readFileSync(metaPath, 'utf8')) || {};
    const jsonl = metaPath.replace(/\.meta\.json$/, '.jsonl');
    let turns = 0, errors = 0, ended = '?', fingerprint = '', result = '';
    if (existsSync(jsonl)) {
      const records = readRecords(jsonl);
      const sig = extractSignals(records);
      turns = sig.userTurns + sig.assistantTurns;
      errors = Object.values(sig.toolErrors).reduce((a, b) => a + b, 0);
      ended = errors > 0 ? 'with errors' : 'ok';
      fingerprint = promptFingerprintOf(records);
      result = finalResultOf(records);
    }
    out.push({
      agentType: meta.agentType || '?',
      description: meta.description || '',
      turns, errors, ended, fingerprint, result,
    });
  }
  return out;
}

const median = (nums) => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// One line per sub-agent is unreadable past a few dozen (761 in one campaign),
// so report shape instead: per-type counts, the reruns, the outliers, and the
// DISTINCT returned outcomes. Repetition collapses on its own — a rare outcome
// stands out because it is rare.
// A long dispatch prompt usually opens with harness boilerplate, so excerpt
// from further in; a short one is quoted from the start.
function promptExcerpt(prompt) {
  const from = prompt.length > 600 ? 400 : 0;
  return (from ? '…' : '') + prompt.slice(from, from + 110).trim();
}

// Returned results carry per-case values (ids, branches, PR numbers), so raw
// text barely dedupes — 594 distinct out of 761 on one campaign. Blanking
// digit runs collapses the per-case noise and leaves the SHAPE of the outcome,
// which is what a reader is scanning for.
function normalizeOutcome(s) {
  return s.replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function summarizeSubagents(subagents) {
  const byType = {};
  for (const a of subagents) {
    const b = byType[a.agentType] ??= { count: 0, errors: 0, turns: [] };
    b.count++; if (a.errors > 0) b.errors++; b.turns.push(a.turns);
  }
  const types = Object.entries(byType)
    .map(([type, b]) => ({
      type, count: b.count, withErrors: b.errors,
      medianTurns: median(b.turns), maxTurns: Math.max(...b.turns, 0),
    }))
    .sort((a, b) => b.count - a.count);

  // Rework: the same agent type dispatched more than once on the same work.
  // This is the agent-side equivalent of a user saying "no, redo that" — the
  // human-text correction signal is always empty in an unattended run.
  // Same agent type, byte-identical dispatch prompt, more than once. Reported
  // as the neutral FACT it is — not as "rework", which would be a judgement the
  // parser cannot make: a clerk invoked 24x with one prompt is routine, an
  // analyst invoked twice on one case is waste, and nothing in the transcript
  // distinguishes them. The reader decides; this just surfaces the candidates.
  // (An earlier version stripped each type's longest common prompt prefix to
  // guess "the work". It is fragile by construction — one differently-shaped
  // dispatch of that type collapses the prefix to zero and every fingerprint
  // becomes boilerplate. Exact match has no such failure mode.)
  const byWork = {};
  for (const a of subagents) {
    if (!a.fingerprint) continue;
    (byWork[`${a.agentType}\u0000${a.fingerprint}`] ??= []).push(a);
  }
  const repeats = Object.entries(byWork)
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const [agentType, prompt] = key.split('\u0000');
      return { agentType, count: list.length, excerpt: promptExcerpt(prompt) };
    })
    .sort((a, b) => b.count - a.count);

  const medByType = Object.fromEntries(types.map((t) => [t.type, t.medianTurns]));
  const outliers = subagents
    .filter((a) => medByType[a.agentType] > 0 && a.turns >= OUTLIER_FACTOR * medByType[a.agentType])
    .sort((a, b) => b.turns - a.turns)
    .slice(0, MAX_OUTLIERS);

  const outcomeCounts = {};
  for (const a of subagents) {
    if (!a.result) continue;
    const shape = normalizeOutcome(a.result);
    outcomeCounts[shape] = (outcomeCounts[shape] || 0) + 1;
  }
  const outcomes = Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1]);
  const failures = outcomes.filter(([text]) => FAILURE_RE.test(text));

  return { total: subagents.length, types, repeats, outliers, outcomes, failures };
}

export function readWatermark(path) {
  if (!existsSync(path)) return { analyzed: [] };
  const d = safeParse(readFileSync(path, 'utf8'));
  return d && Array.isArray(d.analyzed) ? d : { analyzed: [] };
}

export function renderDigest(sessions) {
  const out = ['# Session retrospective digest', '',
    `Generated: ${new Date().toISOString()}`,
    `Sessions analyzed: ${sessions.length}`,
    // Say what the detector can read. Without this line a team working in
    // another language gets an empty corrections list and no way to tell
    // "nothing happened" from "nobody here writes in a language this parses".
    'Correction detection covers English only; a session held in another language',
    'will show few or no candidate corrections regardless of how many there were.',
    'Interrupts and the tool/retry/churn signals are language-neutral.',
    ''];
  for (const s of sessions) {
    out.push(`## Session ${s.id} — ${s.date}  (branch: ${s.branch}, ${s.userTurns} user / ${s.assistantTurns} assistant turns, ~${s.durationMin} min)`);
    if (s.skills.length) out.push(`Skills/plugins seen: ${s.skills.join(', ')}`);
    out.push('');
    if (s.subagents?.length) {
      const sum = summarizeSubagents(s.subagents);
      out.push(`### Sub-agents (${sum.total})`);
      for (const t of sum.types) {
        out.push(`- ${t.type} — ${t.count} dispatch(es), ${t.withErrors} with errors, median ${t.medianTurns} turns (max ${t.maxTurns})`);
      }
      out.push('');
      // Rework — the unattended equivalent of a user correction.
      if (sum.repeats.length) {
        out.push(`#### Repeated identical dispatches (${sum.repeats.length}) — same agent type, same prompt, more than once`);
        for (const r of sum.repeats.slice(0, MAX_REPEATS)) out.push(`- ${r.count}x ${r.agentType} — "${r.excerpt}"`);
        if (sum.repeats.length > MAX_REPEATS) out.push(`- …and ${sum.repeats.length - MAX_REPEATS} more`);
        out.push('');
      }
      if (sum.outliers.length) {
        out.push(`#### Turn outliers (>=${OUTLIER_FACTOR}x the median for their type)`);
        for (const a of sum.outliers) out.push(`- ${a.agentType} — ${a.turns} turns, ${a.errors} errors — "${promptExcerpt(a.fingerprint)}"`);
        out.push('');
      }
      // Returned outcomes carry the CONTENT the other signals miss: an agent
      // can end clean and still hand back "blocked: X". Deduped, so a rare
      // outcome stands out precisely because it is rare.
      if (sum.failures.length) {
        out.push(`#### Failure-shaped returns (${sum.failures.length} distinct)`);
        for (const [text, n] of sum.failures.slice(0, MAX_FAILURES)) out.push(`- ${n}x ${text}`);
        if (sum.failures.length > MAX_FAILURES) out.push(`- …and ${sum.failures.length - MAX_FAILURES} more`);
        out.push('');
      }
      if (sum.outcomes.length) {
        out.push(`#### Returned outcomes (${sum.outcomes.length} distinct shapes)`);
        for (const [text, n] of sum.outcomes.slice(0, MAX_OUTCOMES)) out.push(`- ${n}x ${text}`);
        if (sum.outcomes.length > MAX_OUTCOMES) out.push(`- …and ${sum.outcomes.length - MAX_OUTCOMES} more distinct shape(s)`);
        out.push('');
      }
    }
    out.push('### Signals');
    const te = Object.entries(s.toolErrors).sort((a, b) => b[1] - a[1]);
    for (const [k, n] of te) out.push(`- Tool errors: ${k} ×${n}`);
    for (const [k, n] of s.retries) out.push(`- Retry/loop: ${k} ×${n}`);
    for (const [p, n] of s.fileChurn) out.push(`- File churn: ${p} edited ×${n}`);
    if (s.interrupts?.length) {
      out.push(`- Interrupts: human stopped the agent ×${s.interrupts.length} (turns ${s.interrupts.slice(0, 8).join(', ')}${s.interrupts.length > 8 ? ', …' : ''})`);
    }
    if (s.corrections.length) {
      const shown = s.corrections.length;
      const found = s.correctionsFound ?? shown;
      out.push(`- Candidate corrections${found > shown ? ` (${shown} strongest of ${found})` : ''}:`);
      for (const c of s.corrections) out.push(`  - [${c.kind}] "${c.text}" (turn ${c.turn})`);
    }
    if (!te.length && !s.retries.length && !s.fileChurn.length && !s.corrections.length &&
        !s.interrupts?.length) {
      out.push('- (no notable signals)');
    }
    out.push('');
  }
  return out.join('\n');
}

// The flags this script actually has. An unknown one is an ERROR, not a
// shrug: this reader is watermark-based, so a plausible-but-absent flag like
// `--since 2026-07-31` was silently swallowed and the run quietly analysed
// every session on disk instead of the window asked for — a wrong answer that
// looks exactly like a right one. (Measured 2026-07-31 on a real invocation.)
const KNOWN_FLAGS = new Set([
  'host', 'project-dir', 'all', 'exclude-session', 'watermark', 'out', 'help',
]);

export function parseArgs(argv, known = KNOWN_FLAGS) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (!known.has(key)) {
      const err = new Error(
        `unknown flag --${key}\n`
        + `Known flags: ${[...known].map((k) => `--${k}`).join(', ')}\n`
        + 'This reader selects sessions by WATERMARK, not by date: it digests what is new '
        + 'since the last run. Use --all to ignore the watermark, or --watermark <path> to point at another one.');
      err.code = 'UNKNOWN_FLAG';
      throw err;
    }
    const next = argv[i + 1];
    a[key] = (next && !next.startsWith('--')) ? argv[++i] : true;
  }
  return a;
}

export const HELP = `distill-sessions.mjs — bounded markdown digest of this project's agent sessions

usage: node distill-sessions.mjs [options]

  --host claude|copilot     Which transcripts to read. Default: claude when this
                            project has any, else copilot. The analysis is the
                            same either way — only the on-disk format differs.
                              claude  → ~/.claude/projects/<encoded-cwd>/*.jsonl
                              copilot → ~/.copilot/session-state/*/events.jsonl
  --project-dir <dir>       Transcript dir to read (claude only). Default: from cwd.
  --all                     Ignore the watermark; analyze every session on disk.
  --exclude-session <id>    Skip one session id — use it for the session you are
                            running in, so the retrospective doesn't analyze itself.
  --watermark <path>        Watermark file. Default .agents/memory/scout/.last-retrospective
  --out <path>              Write the digest to a file instead of stdout.
  --help, -h                Print this help.

exit codes: 0 = digest written · 1 = bad --project-dir · 3 = no transcripts found
`;

async function main() {
  const argv = process.argv.slice(2);
  // Without this, --help fell through to a full distillation over every
  // transcript on disk — an expensive way to ask a question.
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  let args;
  try { args = parseArgs(argv); }
  catch (e) {
    if (e.code !== 'UNKNOWN_FLAG') throw e;
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  const cwd = process.cwd();
  const roots = claudeProjectRoots(cwd);
  const projectDir = args['project-dir'] || resolveProjectDirIn(cwd, roots);

  // GitHub Copilot keeps its transcripts elsewhere and in its own event format.
  // The ANALYSIS is host-independent, so only the reading is: copilot-events.mjs
  // transcodes a session into the same records this file already understands.
  // Auto-detected when Claude has nothing for this project; --host forces either.
  const host = args.host || (projectDir ? 'claude' : 'copilot');
  if (host === 'copilot') {
    const sessions = await distillCopilot(cwd, args);
    if (sessions === null) {
      process.stderr.write(
        'No transcripts found for this project — neither Claude Code ' +
        `(${roots.join(', ') || 'no Claude projects dir found'}) nor GitHub Copilot (~/.copilot/session-state).\n` +
        'Fallback: paste a session transcript or summary and scout will analyze it directly.\n');
      process.exit(3);
    }
    return emit(renderDigest(sessions), sessions.length, args);
  }

  if (!projectDir) {
    process.stderr.write(
      'No Claude Code transcripts found for this project.\n' +
      'Pass --host copilot to read GitHub Copilot sessions instead.\n' +
      'Fallback: paste a session transcript or summary and scout will analyze it directly.\n');
    process.exit(3);
  }
  if (!existsSync(projectDir)) {
    process.stderr.write(`project-dir not found: ${projectDir}\n`);
    process.exit(1);
  }
  const wmPath = args.watermark || join('.agents', 'memory', 'scout', '.last-retrospective');
  const analyzed = args.all ? new Set() : new Set(readWatermark(wmPath).analyzed);
  const exclude = args['exclude-session'];
  const jsonls = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
    .map(f => join(projectDir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  const sessions = [];
  for (const jp of jsonls) {
    const id = basename(jp, '.jsonl');
    if (analyzed.has(id) || id === exclude) continue;
    const s = parseSession(jp);
    s.subagents = readSubagents(join(projectDir, id));
    sessions.push(s);
  }
  emit(renderDigest(sessions), sessions.length, args);
}

function emit(digest, count, args) {
  if (args.out) {
    writeFileSync(args.out, digest);
    process.stderr.write(`Digest written to ${args.out} (${count} sessions)\n`);
  } else {
    process.stdout.write(digest + '\n');
  }
}

/**
 * The Copilot path. Same watermark, same digest, same analysis — the only
 * difference is that a session is one `events.jsonl` holding parent AND
 * sub-agent work in one stream, so sub-agents are split out of it by `agentId`
 * rather than read from separate files.
 *
 * Returns null when Copilot has nothing for this project (so the caller can
 * report both hosts as empty rather than claiming Copilot specifically failed).
 */
async function distillCopilot(cwd, args) {
  const C = await import('./copilot-events.mjs');
  const found = C.sessionsForCwd(cwd);
  if (!found.length) return null;

  const wmPath = args.watermark || join('.agents', 'memory', 'scout', '.last-retrospective');
  const analyzed = args.all ? new Set() : new Set(readWatermark(wmPath).analyzed);
  const exclude = args['exclude-session'];

  const sessions = [];
  for (const s of found) {
    if (analyzed.has(s.id) || s.id === exclude) continue;
    const events = C.readEvents(s.path);
    const records = C.toClaudeRecords(events);
    const meta = copilotMeta(s.id, records);
    const subagents = C.readSubagents(events, extractSignals);
    for (const a of subagents) {
      a.fingerprint = promptFingerprintOf(a.records);
      a.result = finalResultOf(a.records);
      delete a.records;                    // analysed; holding them wastes memory
    }
    sessions.push({ ...meta, ...extractSignals(records), subagents });
  }
  return sessions;
}

/** sessionMeta's fields, derived from transcoded records (which carry both). */
function copilotMeta(id, records) {
  let branch = '?', firstTs = null, lastTs = null;
  for (const r of records) {
    if (r.gitBranch) branch = r.gitBranch;
    if (!r.timestamp) continue;
    const t = Date.parse(r.timestamp);
    if (Number.isNaN(t)) continue;
    if (firstTs === null || t < firstTs) firstTs = t;
    if (lastTs === null || t > lastTs) lastTs = t;
  }
  return {
    id, branch,
    // LOCAL calendar day, matching the Claude path — a UTC slice put sessions
    // near midnight on the wrong day and outside --since/--until windows.
    date: firstTs ? localDate(firstTs) : '?',
    durationMin: (firstTs && lastTs) ? Math.round((lastTs - firstTs) / 60000) : 0,
    skills: [],                            // Copilot does not attribute skills per record
  };
}

// pathToFileURL, not a hand-built `file://` template — the literal comparison
// never matches on Windows or on paths containing spaces, making the CLI a
// silent no-op there.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
