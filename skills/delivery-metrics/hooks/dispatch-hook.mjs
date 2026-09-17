#!/usr/bin/env node
// STDLIB ONLY. Claude SubagentStop → dispatched / dispatch_ended (+ rework_observed) observations (spec §6.6).
// Never prints to stdout, always exits 0. Admission: open run, session→run association, role in the run's roster snapshot.
import { realpathSync, appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryDir, nowIso, sessionPath, whoAmI, ownerRepo, resolveOwnerRepo } from '../scripts/lib/paths.mjs';
import { appendObservation, makeObservation } from '../scripts/lib/events.mjs';
import { listRuns, loadRun } from '../scripts/lib/plan.mjs';
import { git } from '../scripts/lib/git.mjs';
import { validRoster } from '../scripts/lib/roster.mjs';

export const SUPPORTED_SHAPES = ['claude-projects-subagents-v1'];
const STAGE = [[/\b(fix round|address review)\b/i, 'fix'], [/\b(mini-gate|hardening gate|gate)\b/i, 'gate'], [/\bmerge\b/i, 'merge'], [/\breview\w*/i, 'review'], [/\b(implement\w*|build)\b/i, 'build']];
export function classifyStage(text) { for (const [re, s] of STAGE) if (re.test(text ?? '')) return s; return 'other'; }

export function readStdinBounded(ms = 2000, max = 65536) {
  return new Promise((done) => {
    let buf = '', finished = false; const finish = () => { if (!finished) { finished = true; clearTimeout(timer); done(buf); } }; const timer = setTimeout(finish, ms);
    try { process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { buf += d; if (buf.length > max) { buf = buf.slice(0, max); finish(); return; } try { JSON.parse(buf); finish(); } catch { /* incomplete */ } }); process.stdin.on('end', finish); process.stdin.on('error', finish); } catch { finish(); }
  });
}

export { ownerRepo } from '../scripts/lib/paths.mjs';
export function sessionRun(repo, host, sessionId) { try { const s = JSON.parse(readFileSync(sessionPath(repo, host, sessionId), 'utf8')); const r = loadRun(repo, s.plan); return r && r.status === 'open' ? r : null; } catch { return null; } }
export const rosterOf = (run) => new Set(validRoster(run.roster) ? run.roster.agents : []);

export function findChildTranscript(payload) {
  const { session_id: sid, agent_id: aid } = payload; if (!sid || !aid) return null;
  const okName = (p) => [`${aid}.jsonl`, `agent-${aid}.jsonl`].includes(basename(p));
  const cands = [];
  if (payload.agent_transcript_path && okName(payload.agent_transcript_path) && payload.agent_transcript_path.split('/').includes(sid)) cands.push(payload.agent_transcript_path);
  if (payload.transcript_path) { const base = join(dirname(payload.transcript_path), sid, 'subagents'); cands.push(join(base, `${aid}.jsonl`), join(base, `agent-${aid}.jsonl`)); }
  for (const p of cands) if (existsSync(p)) return { path: p, metaPath: p.replace(/\.jsonl$/, '.meta.json'), shape: SUPPORTED_SHAPES[0] };
  return null;
}
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n') : '');

// F13: "at least one non-user record after a user record" is not completion evidence — a progress row
// (e.g. a mid-run tool_use with no text) or a truncated trailing write satisfies that test while proving
// nothing about whether the subagent actually finished. Completion evidence is narrower: an `assistant`
// record carrying a real text block or a `stop_reason`, or a record whose `type` is in a small allowlist
// of host-emitted terminal record kinds (`result`). Anything else — including a record that fails to
// parse at all (a torn trailing write) — contributes no evidence and is silently skipped.
const hasTextBlock = (content) => (typeof content === 'string' ? content.trim().length > 0
  : Array.isArray(content) ? content.some((c) => c && c.type === 'text' && typeof c.text === 'string' && c.text.trim().length > 0) : false);
const COMPLETION_TYPES = new Set(['result']);
function isCompletionEvidence(r) {
  if (r.type === 'assistant') return hasTextBlock(r.message?.content) || r.stop_reason != null || r.message?.stop_reason != null;
  return COMPLETION_TYPES.has(r.type);
}

/** `hasActivity` (F13, beyond the brief's documented `{firstTs, lastTs, firstUserText, records,
 * complete}` shape): true iff the transcript contains at least one non-user record after the first
 * user record, *regardless* of whether that record is completion evidence. This is what tells the
 * caller apart a transcript that is merely "the host's own dispatch payload, nothing else happened
 * yet" (no activity — the child transcript proves nothing, so `handleStop` emits nothing at all) from
 * one that shows real work in flight but no proof it finished (some activity — `dispatched` is
 * emitted, `dispatch_ended` withheld, diagnostic `incomplete-transcript`). */
export function parseTranscript(path) {
  const out = { firstTs: null, lastTs: null, firstUserText: '', records: 0, complete: false, hasActivity: false };
  let text; try { text = readFileSync(path, 'utf8'); } catch { return out; }
  const lines = text.split('\n');
  // F13 (review round): a torn/truncated FINAL line means the write is mid-flight, and the
  // transcript as a whole is not trustworthy yet — even when an earlier, well-formed record already
  // looks like completion evidence. Find the last *non-blank* line and check it parses on its own,
  // independent of the main pass below (which silently skips unparseable lines wherever they occur).
  let lastNonBlank = -1;
  for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim()) { lastNonBlank = i; break; } }
  let tornTail = false;
  if (lastNonBlank >= 0) { try { JSON.parse(lines[lastNonBlank]); } catch { tornTail = true; } }
  let sawUser = false, lastRecord = null, lastRecordTs = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; } // malformed/torn lines contribute no evidence to lastRecord
    out.records++;
    const t = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (!Number.isNaN(t)) { const iso = new Date(t).toISOString(); if (!out.firstTs || iso < out.firstTs) out.firstTs = iso; lastRecord = r; lastRecordTs = iso; }
    if (r.type === 'user') sawUser = true; else if (sawUser) out.hasActivity = true;
    if (!out.firstUserText && r.type === 'user') out.firstUserText = textOf(r.message?.content);
  }
  // Completion requires the LAST timestamped (well-formed) record — not merely some earlier non-user
  // record — to be real completion evidence, AND the file's actual last line must itself have parsed
  // (`!tornTail`); a progress row, or a torn trailing line after real evidence, leaves `complete`
  // false even though `hasActivity` is true.
  if (!tornTail && sawUser && lastRecord && lastRecord.type !== 'user' && isCompletionEvidence(lastRecord)) { out.complete = true; out.lastTs = lastRecordTs; }
  return out;
}
// Case-insensitive (review minor b): a lowercase `task-023` in a description/message must match
// `TASK-023` the same way the branch alias comparison already lowercases both sides.
const wordHit = (text, ref) => new RegExp(`(^|[^A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9-])`, 'i').test(text ?? '');
const matchLevel = (items, { description, firstUserText, branch }) => {
  const inDesc = items.filter((i) => wordHit(description, i.ref)); if (inDesc.length === 1) return { items: inDesc, how: 'description' }; if (inDesc.length > 1) return { items: [], how: 'ambiguous' };
  const inMsg = items.filter((i) => wordHit(firstUserText, i.ref)); if (inMsg.length === 1) return { items: inMsg, how: 'message' }; if (inMsg.length > 1) return { items: [], how: 'ambiguous' };
  if (branch) { const b = items.filter((i) => i.branch && i.branch.toLowerCase() === branch.toLowerCase()); if (b.length === 1) return { items: b, how: 'branch' }; }
  return { items: [], how: null };
};
// Controller ruling (review round): task-level items take precedence over mission-level items. Only
// when no task-level match is found (and the task-level result isn't itself ambiguous — that stays
// ambiguous rather than falling through to a mission-level guess) do we consider mission-level items.
export function resolveRefs(run, opts) {
  const candidates = run.items.filter((i) => i.level !== 'campaign' && !i.cancelled);
  const taskResult = matchLevel(candidates.filter((i) => i.level === 'task'), opts);
  if (taskResult.items.length || taskResult.how === 'ambiguous') return taskResult;
  return matchLevel(candidates.filter((i) => i.level === 'mission'), opts);
}
export function appendOrRevise(repo, rec, opts) { let r = rec; for (let k = 0; k < 10; k++) { const res = appendObservation(repo, r, opts); if (res.result !== 'ID-CONFLICT') return res; r = { ...r, revision: r.revision + 1 }; } return { result: 'ID-CONFLICT', observation_id: rec.observation_id, revision: rec.revision }; }
// F19: diagnostics lines are exactly {at, kind, session, agent_id, detail} with `kind` drawn from the
// fixed vocabulary the report reader (Task 8) recognises — unbound-session | unknown-role |
// no-transcript | incomplete-transcript | invalid-roster. Any other shape/kind folds into that
// reader's `malformed` bucket, so this writer never emits one.
function diagnose(repo, slug, kind, payload, detail, now) { try { mkdirSync(deliveryDir(repo), { recursive: true }); appendFileSync(join(deliveryDir(repo), `diagnostics-${slug}.jsonl`), `${JSON.stringify({ at: nowIso(now), kind, session: payload.session_id ?? null, agent_id: payload.agent_id ?? null, detail })}\n`); } catch { /* best effort */ } return kind; }
const capturePrompts = (repo) => { try { return Boolean(JSON.parse(readFileSync(join(deliveryDir(repo), 'profile.json'), 'utf8')).capturePrompts); } catch { return false; } };

export function handleStop(payload, { repo, now = Date.now() } = {}) {
  repo = resolveOwnerRepo(repo);
  const none = { wrote: [], diagnostic: null };
  if (!payload?.session_id || !payload?.agent_id) return none;
  if (!listRuns(repo).some((r) => r.status === 'open')) return none;
  const { slug } = whoAmI(repo);
  const run = sessionRun(repo, 'claude', payload.session_id);
  if (!run) return { wrote: [], diagnostic: diagnose(repo, slug, 'unbound-session', payload, 'run: delivery.mjs session set --host claude --session <id> --plan <run>', now) };
  const child = findChildTranscript(payload);
  let meta = {}; if (child) { try { meta = JSON.parse(readFileSync(child.metaPath, 'utf8')); } catch { meta = {}; } }
  if (!validRoster(run.roster)) return { wrote: [], diagnostic: diagnose(repo, slug, 'invalid-roster', payload, 'refresh plan roster with this installed skill', now) };
  const role = meta.agentType || payload.agent_type || null;
  let diagnostic = null;
  if (role && !rosterOf(run).has(role)) return none;
  if (!role) diagnostic = diagnose(repo, slug, 'unknown-role', payload, 'agentType missing — admitted, role test relaxed', now);
  if (!child) return { wrote: [], diagnostic: diagnose(repo, slug, 'no-transcript', payload, 'child transcript not found in a supported shape', now) };
  const tr = parseTranscript(child.path);
  if (!tr.firstTs) return { wrote: [], diagnostic: diagnose(repo, slug, 'no-transcript', payload, 'child transcript has no timestamps', now) };
  // F13: a user-only transcript (no activity at all beyond the host's own dispatch payload) is not
  // evidence a subagent ever started — emit nothing, just the diagnostic. A transcript with real
  // activity but no completion evidence still emits `dispatched` (start observed), withholding
  // `dispatch_ended`, per the brief's original rule.
  if (!tr.complete && !tr.hasActivity) return { wrote: [], diagnostic: diagnose(repo, slug, 'incomplete-transcript', payload, 'transcript has only the dispatch payload — no activity observed', now) };
  if (!tr.complete) diagnostic = diagnose(repo, slug, 'incomplete-transcript', payload, 'no completion evidence — dispatched recorded, dispatch_ended withheld', now);
  const description = meta.description ?? '';
  const stage = classifyStage(description) !== 'other' ? classifyStage(description) : classifyStage(tr.firstUserText);
  const branch = payload.cwd ? git(payload.cwd, ['branch', '--show-current']) : null;
  const { items } = resolveRefs(run, { description, firstUserText: tr.firstUserText, branch });
  const common = { user: null, host: 'claude', plan: run.run, source: 'hook', source_record_id: `claude:${payload.session_id}:${payload.agent_id}`, session: payload.session_id, agentId: payload.agent_id, role };
  const wrote = [];
  for (const it of (items.length ? items : [null])) {
    const label = it ? (capturePrompts(repo) ? description.slice(0, 120) : `${it.ref} ${stage}`) : stage;
    const base = it ? { item_id: it.item_id, ref: it.ref, level: it.level, meta: { stage, version: run.version } } : { item_id: null, ref: null, level: null, meta: { stage, version: run.version, unattributed: true } };
    const key = it ? it.item_id : 'unattributed';
    const mk = (event, at, extra = {}) => makeObservation({ ...common, ...base, label, event, at, transition_id: `${key}/${event}/${payload.agent_id}`, meta: { ...base.meta, ...extra } }, { now });
    wrote.push(appendOrRevise(repo, mk('dispatched', tr.firstTs), { slug, now }));
    if (tr.complete) wrote.push(appendOrRevise(repo, mk('dispatch_ended', tr.lastTs), { slug, now }));
    if (it && stage === 'fix') wrote.push(appendOrRevise(repo, mk('rework_observed', tr.firstTs, { round: null }), { slug, now }));
  }
  return { wrote, diagnostic };
}

async function main() {
  try {
    const raw = await readStdinBounded(); let payload = null; try { payload = JSON.parse(raw); } catch { return; }
    if (!process.argv.includes('--stop')) return;
    const repo = ownerRepo(payload, process.env); handleStop(payload, { repo });
    if (process.env.DELIVERY_NO_SYNC !== '1') { try { const { bestEffortSync } = await import('../scripts/lib/sync.mjs'); bestEffortSync(repo, { env: process.env }); } catch { /* best effort */ } }
  } catch { /* hooks never fail the host */ }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(() => process.exit(0), () => process.exit(0));
