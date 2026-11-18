// STDLIB ONLY. Recover dispatch evidence from local Claude transcripts; never derives ledger observations.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseTranscript } from '../../hooks/dispatch-hook.mjs';
import { cliError, resolveOwnerRepo } from './paths.mjs';
import { dispatchIndex, ingestDispatch, readDispatches, snapshotFromTranscript } from './dispatches.mjs';

const idLike = (value) => typeof value === 'string' && value.length > 0 && !/[\s:/\\]/.test(value);
const entries = (path) => { try { return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; } };
const keyOf = (session, agent) => `claude:${session}:${agent}`;
const readMeta = (path) => { try { const meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, '.meta.json'), 'utf8')); return meta && typeof meta === 'object' ? meta : {}; } catch { return {}; } };
function readRecords(path) {
  const text = readFileSync(path, 'utf8'), rows = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { const row = JSON.parse(line); if (row && typeof row === 'object' && !Array.isArray(row)) rows.push(row); } catch { /* a torn row does not erase readable evidence */ } }
  return rows;
}
function projectRoot(repo, env) {
  const owner = resolveOwnerRepo(repo);
  const config = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude');
  return { owner, root: join(config, 'projects', owner.replace(/[^a-zA-Z0-9]/g, '-')) };
}

/** Enumerate children independently of whether their parent dispatch tool returned. Parents only enrich evidence and coverage. */
function inventory(repo, env, since = null) {
  const { owner, root } = projectRoot(repo, env), children = [], parents = [], results = new Map();
  let unidentified = 0, unreadable = 0, interrupted = 0, oldest = null;
  const rememberDate = (date) => { if (date && (!oldest || date < oldest)) oldest = date; };
  for (const session of entries(root).filter((e) => e.isDirectory())) {
    for (const file of entries(join(root, session.name, 'subagents')).filter((e) => e.name.endsWith('.jsonl'))) {
      const path = join(root, session.name, 'subagents', file.name);
      const agent = file.name.replace(/\.jsonl$/, '').replace(/^agent-/, '');
      const child = { path, session: session.name, agent, key: null, parsed: null, meta: readMeta(path), eligible: false };
      children.push(child);
      if (!idLike(session.name) || !idLike(agent)) { unidentified++; continue; }
      child.key = keyOf(session.name, agent);
      try {
        // Read admission distinguishes missing/unreadable files from an empty but readable transcript.
        const stats = statSync(path); child.rows = readRecords(path);
        child.parsed = parseTranscript(path); rememberDate(child.parsed.firstTs);
        // mtime is only a pre-filter; transcript record time makes the final eligibility decision.
        child.eligible = (since === null || stats.mtimeMs >= since) && (since === null || (child.parsed.lastRecordAt && Date.parse(child.parsed.lastRecordAt) >= since));
      } catch { unreadable++; child.unreadable = true; }
    }
  }
  for (const file of entries(root).filter((e) => e.name.endsWith('.jsonl') && e.isFile())) {
    const session = file.name.slice(0, -6); if (!idLike(session)) continue;
    let rows; try { rows = readRecords(join(root, file.name)); } catch { continue; }
    parents.push(file.name);
    const tools = new Map(), completed = new Set();
    for (const row of rows) {
      const parsedDate = row.timestamp && Date.parse(row.timestamp); if (Number.isFinite(parsedDate)) rememberDate(new Date(parsedDate).toISOString());
      const blocks = Array.isArray(row.message?.content) ? row.message.content : [];
      for (const block of blocks) {
        if (block?.type === 'tool_use' && ['Agent', 'Task'].includes(block.name) && typeof block.id === 'string') tools.set(block.id, block.input ?? {});
        if (block?.type !== 'tool_result') continue;
        if (typeof block.tool_use_id === 'string') completed.add(block.tool_use_id);
        let embedded = null;
        if (typeof block.content === 'string') { try { embedded = JSON.parse(block.content); } catch { /* natural language is not identity evidence */ } }
        const agent = row.toolUseResult?.agentId ?? block.toolUseResult?.agentId ?? block.agentId ?? embedded?.agentId;
        if (idLike(agent)) results.set(keyOf(session, agent), { session, agent, tool: block.tool_use_id, input: null });
      }
      // Some host records carry a structured tool result outside the content array.
      if (!blocks.some((b) => b?.type === 'tool_result') && idLike(row.toolUseResult?.agentId)) {
        const agent = row.toolUseResult.agentId, tool = row.tool_use_id ?? row.toolUseResult.tool_use_id;
        if (typeof tool === 'string') completed.add(tool);
        results.set(keyOf(session, agent), { session, agent, tool, input: null });
      }
    }
    for (const [id] of tools) if (!completed.has(id)) interrupted++;
    for (const result of results.values()) if (result.session === session) result.input = tools.get(result.tool) ?? {};
  }
  // `agent-x.jsonl` is the host's prefixed filename for x, but may also be the bare filename of agent-x.
  // Correlated structured identity disambiguates that overlap; without it the identity is unknown.
  for (const child of children) {
    if (!child.key) continue;
    const stem = basename(child.path, '.jsonl'), candidates = [...new Set([stem, stem.replace(/^agent-/, '')])].filter(idLike);
    // Evidence order: the child's own metadata, then the child's own records, then the parent's result. The child's
    // evidence is fixed at capture time; a parent result that arrives later must never move a child to another key.
    const explicit = child.meta.agentId ?? child.meta.agent_id;
    const recordIds = [...new Set((child.rows ?? []).map((r) => r.agentId ?? r.agent_id).filter(idLike))];
    const corroborated = candidates.filter((id) => recordIds.includes(id));
    const matches = candidates.filter((agent) => results.has(keyOf(child.session, agent)));
    if (idLike(explicit) && candidates.includes(explicit)) child.agent = explicit;
    else if (corroborated.length === 1) child.agent = corroborated[0];
    else if (corroborated.length === 0 && recordIds.length === 0 && matches.length === 1) child.agent = matches[0];
    else { child.key = null; unidentified++; continue; }
    child.key = keyOf(child.session, child.agent);
  }
  // Two files resolving to one dispatch key cannot both be that dispatch: neither is guessed, both are unidentified.
  const claims = new Map();
  for (const child of children) if (child.key) claims.set(child.key, (claims.get(child.key) ?? 0) + 1);
  for (const child of children) if (child.key && claims.get(child.key) > 1) { child.key = null; unidentified++; }
  const identities = new Set(children.map((c) => c.key).filter(Boolean));
  const noChild = [...results.keys()].filter((key) => !identities.has(key)).length;
  for (const key of results.keys()) identities.add(key);
  return { owner, children, parents, results, unidentified, unreadable, interrupted, oldest, identities, noChild };
}
function dateBound(since) { if (since == null) return null; const parsed = Date.parse(since); if (!Number.isFinite(parsed)) throw cliError('USAGE', '--since must be an ISO date'); return parsed; }

/** The same snapshot adapter and append admission used by SubagentStop. A dry run computes outcomes without writes. */
export function backfillTranscripts(repo, { since = null, dryRun = false, env = process.env, now = Date.now(), stderr = process.stderr } = {}) {
  const inv = inventory(repo, env, dateBound(since));
  const counts = { children: inv.children.length, ingested: 0, unchanged: 0, tombstoned: 0, unidentified: inv.unidentified, unreadable: inv.unreadable, failed: 0, parents: inv.parents.length, interrupted: inv.interrupted, 'no-child': inv.noChild };
  const prior = readDispatches(inv.owner);
  const index = dispatchIndex(prior);
  for (const child of inv.children) {
    if (!child.key || !child.parsed || !child.eligible) continue;
    try {
    const input = inv.results.get(child.key)?.input ?? {};
    const description = [...new Set([child.meta.description, input.description].filter((text) => typeof text === 'string' && text.length))].join('\n');
    const snapshot = snapshotFromTranscript(child.parsed, { session: child.session, agent_id: child.agent, agent_type: child.meta.agentType || input.subagent_type || null, description, capture: 'transcript-backfill', repo: inv.owner, now });
    const outcome = ingestDispatch(inv.owner, snapshot, {index, dryRun}).result;
    counts[outcome]++;
    } catch(e) { counts.failed++; stderr.write(`BACKFILL failed ${child.path}: ${e.message}\n`); }
  }
  return counts;
}

/** Count only. An absent child or an unmatched gap never licenses helper classification. */
export function coverage(repo, { env = process.env } = {}) {
  const inv = inventory(repo, env), stored = readDispatches(inv.owner), keys = new Set(stored.snapshots.map((s) => s.dispatch_key));
  const inStore = [...inv.identities].filter((key) => keys.has(key)).length;
  const latest = new Map();
  for(const s of stored.snapshots) latest.set(s.dispatch_key,Math.max(latest.get(s.dispatch_key) ?? -Infinity,Date.parse(s.captured_at)));
  const resolved = [...stored.gaps].filter(key=>(latest.get(key) ?? -Infinity)>Date.parse(stored.gapTimes.get(key))).length;
  return { identities: inv.identities.size, in_store: inStore, missing_from_store: inv.identities.size - inStore, gaps_resolved: resolved, gaps_unresolved: stored.gaps.size - resolved, interrupted: inv.interrupted, unreadable_children: inv.unreadable, oldest_transcript_date: inv.oldest };
}
