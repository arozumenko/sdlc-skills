// STDLIB ONLY. One ledger line per observation (spec §6.2): shared validator, append-only per-user files,
// read-time resolution (highest revision, retracted dropped, same-revision disagreement = CONFLICT, never a winner).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliError, deliveryDir, eventsPath, nowIso, sha256, whoAmI, withLock } from './paths.mjs';

export const SCHEMA_VERSION = 2;
export const EVENTS = ['created', 'estimated', 'dispatched', 'dispatch_ended', 'first_commit', 'review_requested', 'review_returned', 'review_approved',
  'review_history', 'done', 'cancelled', 'blocked', 'unblocked', 'reopened', 'scope_declared', 'gate_observed', 'outcome_observed', 'rework_observed'];
export const SOURCES = ['cli', 'automation-sync', 'hook', 'git'];
export const SOURCE_RANK = Object.fromEntries(SOURCES.map((s, i) => [s, i]));
export const BASES = ['observed', 'derived-child', 'scope-proxy', 'gate-proxy', 'receipt-proxy', 'plan-commit'];
export const LEVELS = ['campaign', 'mission', 'task', 'case'];
export const HOSTS = ['claude', 'copilot', 'copilot-vscode', 'cli', 'git'];
const TIERS = ['ROM', 'budgetary', 'calibrated', 'unknown'];

const enc = (s) => encodeURIComponent(String(s));
export const observationId = ({ source, sourceRecordId, itemId, event }) => `${enc(source)}:${enc(sourceRecordId)}:${enc(itemId ?? 'unattributed')}:${enc(event)}`;
const canonicalIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;
const anyIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

export function validateEstimate(e, at = 'estimate') {
  const errs = [];
  if (!e || typeof e !== 'object') return [`${at}: not an object`];
  if (!['h', 'active_min'].includes(e.unit)) errs.push(`${at}.unit must be h|active_min`);
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!num(e.low)) errs.push(`${at}.low must be a finite number ≥ 0`);
  if (!num(e.high)) errs.push(`${at}.high must be a finite number ≥ 0`);
  if (num(e.low) && num(e.high) && e.low > e.high) errs.push(`${at}.low must be ≤ high`);
  if (!TIERS.includes(e.tier)) errs.push(`${at}.tier must be ROM|budgetary|calibrated|unknown`);
  if (e.tier === 'calibrated') {
    const r = e.reference;
    if (!r || typeof r !== 'object' || !r.path || !/^[0-9a-f]{64}$/.test(r.sha256 ?? '') || !r.population) errs.push(`${at}.reference {path, sha256, population} required for tier calibrated`);
  }
  if (!e.proposed_by) errs.push(`${at}.proposed_by required`);
  if (!anyIso(e.proposed_at)) errs.push(`${at}.proposed_at must be ISO`);
  if (e.accepted_by != null && (typeof e.accepted_by !== 'string' || !e.accepted_by.trim())) errs.push(`${at}.accepted_by must be a name or null`);
  if (e.accepted_at != null && !anyIso(e.accepted_at)) errs.push(`${at}.accepted_at must be ISO or null`);
  if (e.probability != null && !(typeof e.probability === 'number' && e.probability > 0 && e.probability < 1)) errs.push(`${at}.probability must be 0<p<1`);
  return errs;
}

export function validateRecord(r) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['record: not an object'];
  if (r.v !== SCHEMA_VERSION) errs.push(`v must be ${SCHEMA_VERSION}`);
  if (!canonicalIso(r.at)) errs.push('at must be canonical UTC ms ISO');
  if (!canonicalIso(r.recorded_at)) errs.push('recorded_at must be canonical UTC ms ISO');
  if (!EVENTS.includes(r.event)) errs.push(`event ${r.event} unknown`);
  if (!SOURCES.includes(r.source)) errs.push(`source ${r.source} unknown`);
  if (!HOSTS.includes(r.host)) errs.push(`host ${r.host} unknown`);
  if (!r.plan || typeof r.plan !== 'string') errs.push('plan required');
  const unattributed = r.meta?.unattributed === true && ['dispatched', 'dispatch_ended'].includes(r.event);
  if (r.item_id == null || r.ref == null || r.level == null) { if (!unattributed || r.item_id != null || r.ref != null || r.level != null) errs.push('item_id/ref/level required (null only together for unattributed dispatch)'); }
  else if (!LEVELS.includes(r.level)) errs.push(`level ${r.level} unknown`);
  if (!r.transition_id || typeof r.transition_id !== 'string') errs.push('transition_id required');
  if (!r.source_record_id || typeof r.source_record_id !== 'string') errs.push('source_record_id required');
  if (!Number.isInteger(r.revision) || r.revision < 0) errs.push('revision must be an integer ≥ 0');
  if (!['active', 'retracted'].includes(r.status)) errs.push('status must be active|retracted');
  if (!BASES.includes(r.basis)) errs.push(`basis ${r.basis} unknown`);
  if (r.source && r.source_record_id && r.event && r.observation_id !== observationId({ source: r.source, sourceRecordId: r.source_record_id, itemId: r.item_id, event: r.event })) errs.push('observation_id does not match its tuple');
  if (r.estimate != null) errs.push(...validateEstimate(r.estimate));
  if (r.meta != null && typeof r.meta !== 'object') errs.push('meta must be an object');
  return errs;
}

export function makeObservation(f, { now = Date.now() } = {}) {
  const rec = {
    v: SCHEMA_VERSION, at: anyIso(f.at) ? new Date(f.at).toISOString() : f.at, recorded_at: nowIso(now), user: f.user ?? null, host: f.host, plan: f.plan,
    item_id: f.item_id ?? null, ref: f.ref ?? null, level: f.level ?? null, event: f.event, transition_id: f.transition_id, source: f.source,
    source_record_id: f.source_record_id == null ? f.source_record_id : String(f.source_record_id),
    observation_id: observationId({ source: f.source, sourceRecordId: f.source_record_id, itemId: f.item_id, event: f.event }),
    revision: f.revision ?? 0, status: f.status ?? 'active', basis: f.basis ?? 'observed', session: f.session ?? null, agentId: f.agentId ?? null,
    role: f.role ?? null, label: f.label ?? null, raw: f.raw ?? null, ...(f.estimate ? { estimate: f.estimate } : {}), meta: f.meta ?? {},
  };
  const errs = validateRecord(rec);
  if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  return rec;
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
// Facts a replay actually consumes to decide semantic identity. `meta.version` is a capture/plan-cut
// label, not a fact: a plan re-cut (or a CLI retry against the re-cut plan) must regenerate the same
// identity for an otherwise-unchanged historical observation (obligation F9), so it is deliberately
// excluded here. `meta.acceptance` IS a fact replay consumes (accepted vs stale-acceptance must never
// coalesce at the same rank), so it is included (obligation F9).
const facts = (r) => ({ stage: r.meta?.stage ?? null, round: r.meta?.round ?? null, result: r.meta?.result ?? null, git_sha: r.meta?.git_sha ?? null, pr: r.meta?.pr ?? null, estimate: r.estimate ?? null, raw: r.raw ?? null, acceptance: r.meta?.acceptance ?? null });
export const factKey = (r) => JSON.stringify(sortKeys({ plan: r.plan, item_id: r.item_id, ref: r.ref, level: r.level, event: r.event, transition_id: r.transition_id, basis: r.basis, at: r.at, facts: facts(r) }));
export const semanticKey = (r) => JSON.stringify(sortKeys({ observation_id: r.observation_id, revision: r.revision, status: r.status, fact: JSON.parse(factKey(r)) }));

const decoder = new TextDecoder('utf-8', { fatal: true });
export function readRaw(repo) {
  const dir = deliveryDir(repo);
  const counts = { files: 0, parsed: 0, malformed: 0, unknownVersion: 0 };
  const lines = [], files = [], malformed = [];
  if (!existsSync(dir)) return { lines, files, counts, malformed };
  for (const f of readdirSync(dir).filter((n) => /^events-.*\.jsonl$/.test(n)).sort()) {
    counts.files++;
    const path = join(dir, f);
    const buf = readFileSync(path);
    files.push({ path, sha256: sha256(buf), bytes: buf.length });
    let start = 0, lineNo = 0;
    while (start < buf.length) {
      let end = buf.indexOf(0x0a, start); if (end === -1) end = buf.length;
      const slice = buf.subarray(start, end); start = end + 1; lineNo++;
      if (!slice.length || !slice.toString('latin1').trim()) continue;
      let text; try { text = decoder.decode(slice); } catch { counts.malformed++; malformed.push({ path, line: lineNo, reason: 'invalid utf-8' }); continue; }
      let rec; try { rec = JSON.parse(text); } catch { counts.malformed++; malformed.push({ path, line: lineNo, reason: 'invalid json' }); continue; }
      if (!rec || typeof rec !== 'object' || rec.v !== SCHEMA_VERSION) { counts.unknownVersion++; continue; }
      const errs = validateRecord(rec);
      if (errs.length) { counts.malformed++; malformed.push({ path, line: lineNo, reason: errs[0] }); continue; }
      counts.parsed++;
      lines.push({ rec, path, line: lineNo });
    }
  }
  return { lines, files, counts, malformed };
}

export function resolveObservations(repo) {
  const raw = readRaw(repo);
  const byId = new Map();
  let retries = 0;
  for (const { rec, path, line } of raw.lines) {
    const revs = byId.get(rec.observation_id) ?? new Map(); byId.set(rec.observation_id, revs);
    const key = semanticKey(rec);
    const cur = revs.get(rec.revision);
    if (!cur) revs.set(rec.revision, { variants: new Map([[key, rec]]), paths: [`${path}:${line}`], first: { path, line } });
    else { if (cur.variants.has(key)) retries++; else cur.variants.set(key, rec); cur.paths.push(`${path}:${line}`); }
  }
  const active = [], conflicts = [];
  let superseded = 0, retracted = 0;
  for (const [id, revs] of byId) {
    const top = Math.max(...revs.keys());
    superseded += revs.size - 1;
    const entry = revs.get(top);
    const variants = [...entry.variants.values()];
    if (variants.length > 1) {
      // F8: report the union of every conflicting variant's occurrence key (item_id, transition_id,
      // basis, source), not just the first one read — a downstream consumer (the timeline) must be
      // able to quarantine fallback for each occurrence this observation_id disagrees about,
      // regardless of file/arrival order.
      conflicts.push({
        observation_id: id,
        revision: top,
        plan: variants[0].plan,
        variants: variants.map((v) => ({ item_id: v.item_id, transition_id: v.transition_id, basis: v.basis, source: v.source })),
        paths: entry.paths,
      });
      continue;
    }
    const sample = variants[0];
    if (sample.status === 'retracted') { retracted++; continue; }
    Object.defineProperty(sample, '_at', { value: entry.first, enumerable: false });
    active.push(sample);
  }
  active.sort((a, b) => a.at.localeCompare(b.at) || a.observation_id.localeCompare(b.observation_id));
  return { active, conflicts, files: raw.files, malformed: raw.malformed, counts: { ...raw.counts, retries, superseded, retracted, conflicts: conflicts.length } };
}

export function appendObservation(repo, rec, { slug, now = Date.now() } = {}) {
  const line = { ...rec, user: rec.user ?? slug ?? whoAmI(repo).slug, recorded_at: nowIso(now) };
  const errs = validateRecord(line);
  if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  return withLock(repo, () => {
    const key = semanticKey(line);
    for (const { rec: r } of readRaw(repo).lines) {
      if (r.observation_id !== line.observation_id || r.revision !== line.revision) continue;
      return { result: semanticKey(r) === key ? 'SKIP' : 'ID-CONFLICT', observation_id: line.observation_id, revision: line.revision, path: null };
    }
    mkdirSync(deliveryDir(repo), { recursive: true });
    const path = eventsPath(repo, line.user);
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    return { result: 'EVENT', observation_id: line.observation_id, revision: line.revision, path };
  }, { now });
}
