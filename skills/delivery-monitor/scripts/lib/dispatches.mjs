// STDLIB ONLY. Append-only dispatch evidence, independent of plan attribution and observations.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cliError, deliveryDir, nowIso, profilePath, sha256, whoAmI, withLock } from './paths.mjs';

const VERSION = 'dispatch.v1';
const COUNTERS = ['input', 'output', 'cache_write', 'cache_write_1h', 'cache_read'];
const IDENTIFIER = /^(?:[A-Za-z]{1,10}[-_]?)?\d+(?:[.\-]\d+){0,3}[a-z]?$|^#\d{1,7}$/;
const lineHashes = new WeakMap();
const decoded = new WeakSet();
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const date = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const nullableDate = (v) => v === null || date(v);
const nullableString = (v) => v === null || typeof v === 'string';
const validRef = (v) => typeof v === 'string' && v.length >= 2 && v.length <= 24 && IDENTIFIER.test(v);
const validRefs = (v) => Array.isArray(v) && v.length <= 32 && v.every(validRef);
const validKey = (v) => typeof v === 'string' && /^claude:[^\s:/\\]+:[^\s:/\\]+$/.test(v);
const onlyKeys = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const zero = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
const copyUsage = (u) => Object.fromEntries(COUNTERS.map((k) => [k, u?.[k] ?? 0]));
const validUsage = (u, message = false) => onlyKeys(u, message ? ['model', ...COUNTERS] : COUNTERS) && COUNTERS.every((k) => integer(u[k]));
const validModelUsage = (u) => object(u) && Object.entries(u).every(([model, tokens]) => model.length > 0 && validUsage(tokens));
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const facts = (snapshot) => {
  const { capture, captured_at, writer, ...rest } = compact(snapshot);
  return JSON.stringify(canonical(rest));
};
export const snapshotDigest = (s) => sha256(facts(s));
function compact(s) {
  if (s.v === 'dispatch.v2' || s.gap || s.retracted) return { ...s, v: 'dispatch.v2' };
  const models = sortedUnique([...Object.values(s.messages).map(m => m.model), ...Object.keys(s.anon.usage)]);
  // A 48-bit digest (12 hex chars) deliberately accepts the small collision risk for message identities.
  return { ...s, v: 'dispatch.v2', models,
    messages: Object.fromEntries(Object.entries(s.messages).map(([id,m]) => [decoded.has(s) ? id : sha256(id).slice(0,12), [models.indexOf(m.model), ...COUNTERS.map(k => m[k])]])),
    anon: { records:s.anon.records, usage:Object.fromEntries(Object.entries(s.anon.usage).map(([m,u])=>[models.indexOf(m),COUNTERS.map(k=>u[k])])) } };
}
function expand(s) {
  if (s.v !== 'dispatch.v2' || s.gap || s.retracted) return s;
  const { models, ...rest } = s;
  const result = { ...rest, v:VERSION,
    messages:Object.fromEntries(Object.entries(s.messages).map(([id,a])=>[id,{model:models[a[0]],...Object.fromEntries(COUNTERS.map((k,i)=>[k,a[i+1]]))}])),
    anon:{records:s.anon.records,usage:Object.fromEntries(Object.entries(s.anon.usage).map(([i,a])=>[models[i],Object.fromEntries(COUNTERS.map((k,j)=>[k,a[j]]))]))} };
  decoded.add(result); return result;
}
const sortedUnique = (values) => [...new Set(values)].sort();
function capped(values) { const all = sortedUnique(values); return { values: all.slice(0, 32), truncated: all.length >= 32 }; }

/** Capture whole whitespace-delimited identifiers only. Reject embedded assignments, addresses and paths before stripping
 * surrounding prose punctuation: extracting a ref-shaped substring of one of those would defeat the capture policy. */
export function captureRefs(text) {
  const tokens = String(text ?? '').split(/\s+/).filter((token) => !/[=@/\\]/.test(token))
    .map((token) => token.replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}]+$/gu, '')).filter(validRef);
  const result = capped(tokens);
  return { refs: result.values, truncated: result.truncated };
}

const STAGES = [[/\b(fix round|address review)\b/i, 'fix'], [/\b(mini-gate|hardening gate|gate)\b/i, 'gate'], [/\bmerge\b/i, 'merge'], [/\breview\w*/i, 'review'], [/\b(implement\w*|build)\b/i, 'build']];
function stageOf(text) {
  const hits = STAGES.map(([regex, stage]) => ({ index: regex.exec(text)?.index ?? Infinity, stage })).sort((a, b) => a.index - b.index);
  return hits[0].index === Infinity ? 'other' : hits[0].stage;
}
function policy(repo) { try { return repo ? JSON.parse(readFileSync(profilePath(repo), 'utf8')) ?? {} : {}; } catch { return {}; } }

/** Shared hook/backfill adapter. Transcripts supply identities and token counters; today's checkout supplies no evidence. */
export function snapshotFromTranscript(parsed, { session, agent_id, agent_type = null, description = '', capture = 'hook', repo, now = Date.now() } = {}) {
  const p = policy(repo), enabled = p.captureRefs !== false;
  const desc = enabled ? captureRefs(description) : { refs: [], truncated: false };
  const msg = enabled ? captureRefs(parsed.firstUserText) : { refs: [], truncated: false };
  let truncated = desc.truncated || msg.truncated;
  const followUps = enabled ? (parsed.followUps ?? []).map((f) => {
    const r = captureRefs(f.text); truncated ||= r.truncated;
    return { at: date(f.at) ? f.at : null, refs: r.refs };
  }) : [];
  const follow = capped(followUps.map((f) => JSON.stringify(canonical(f))));
  const descriptionStage = stageOf(description);
  const out = {
    v: VERSION, dispatch_key: `claude:${session}:${agent_id}`, session, agent_id, agent_type: nullableString(agent_type) ? agent_type : null,
    started_at: date(parsed.firstTs) ? parsed.firstTs : null, last_at: date(parsed.lastRecordAt ?? parsed.lastTs) ? (parsed.lastRecordAt ?? parsed.lastTs) : null,
    complete: parsed.complete === true, torn: parsed.torn === true, last_uuid: nullableString(parsed.last_uuid) ? parsed.last_uuid : null,
    stage: descriptionStage === 'other' ? stageOf(parsed.firstUserText || '') : descriptionStage, branch: p.captureBranch === false ? null : typeof parsed.branch === 'string' ? parsed.branch : null,
    refs: { desc: desc.refs, msg: msg.refs, truncated: truncated || follow.truncated }, follow_ups: follow.values.map((f) => JSON.parse(f)),
    messages: Object.fromEntries(Object.entries(parsed.messages ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, m]) => [id, { model: m.model, ...copyUsage(m) }])),
    anon: { records: parsed.anon?.records ?? 0, usage: Object.fromEntries(Object.entries(parsed.anon?.usage ?? {}).map(([m, u]) => [m, copyUsage(u)])) },
    records: parsed.records, capture, captured_at: nowIso(now), writer: { kind: capture === 'hook' ? 'hook' : 'cli', pid: process.pid },
    ...(p.capturePrompts === true ? { prompts: description } : {}),
  };
  check(out); return out;
}

/** One validator for read and write admission. Invalid historical lines are counted and omitted, never priced. */
function problem(r) {
  if (object(r) && r.v === 'dispatch.v2' && !r.gap && !r.retracted) {
    if (!Array.isArray(r.models) || !r.models.every(m=>typeof m==='string' && m.length) || new Set(r.models).size!==r.models.length) return 'invalid models';
    const index = n => integer(n) && n < r.models.length;
    if (!object(r.messages) || !Object.entries(r.messages).every(([id,a])=>/^[a-f0-9]{12}$/.test(id) && Array.isArray(a) && a.length===6 && index(a[0]) && a.slice(1).every(integer))) return 'invalid compact messages';
    if (!onlyKeys(r.anon,['records','usage']) || !object(r.anon.usage) || !Object.entries(r.anon.usage).every(([i,a])=>String(Number(i))===i && index(Number(i)) && Array.isArray(a) && a.length===5 && a.every(integer))) return 'invalid compact anonymous usage';
    return problem(expand(r));
  }
  if (!object(r) || ![VERSION,'dispatch.v2'].includes(r.v) || !validKey(r.dispatch_key)) return 'invalid dispatch version or key';
  if (r.retracted === true) return onlyKeys(r, ['v', 'dispatch_key', 'retracted', 'reason', 'at']) && typeof r.reason === 'string' && r.reason.trim() && date(r.at) ? null : 'invalid dispatch tombstone';
  if (r.gap === true) return onlyKeys(r, ['v', 'dispatch_key', 'gap', 'at']) && date(r.at) ? null : 'invalid dispatch gap';
  if (!onlyKeys(r, ['v', 'dispatch_key', 'session', 'agent_id', 'agent_type', 'started_at', 'last_at', 'complete', 'torn', 'last_uuid', 'stage', 'branch', 'refs', 'follow_ups', 'messages', 'anon', 'records', 'capture', 'captured_at', 'writer', 'prompts'])) return 'undeclared dispatch field';
  if (typeof r.session !== 'string' || typeof r.agent_id !== 'string' || r.dispatch_key !== `claude:${r.session}:${r.agent_id}`) return 'dispatch key must match string session and agent_id';
  if (![r.agent_type, r.branch, r.stage, r.last_uuid].every(nullableString)) return 'invalid dispatch evidence scalar';
  if (!nullableDate(r.started_at) || !nullableDate(r.last_at) || !date(r.captured_at)) return 'invalid dispatch timestamp';
  if (!integer(r.records) || typeof r.complete !== 'boolean' || typeof r.torn !== 'boolean') return 'invalid dispatch completion evidence';
  if (!['hook', 'transcript-backfill'].includes(r.capture) || !onlyKeys(r.writer, ['kind', 'pid']) || !['hook', 'cli'].includes(r.writer.kind) || !integer(r.writer.pid)) return 'invalid dispatch writer';
  if (!onlyKeys(r.refs, ['desc', 'msg', 'truncated']) || !validRefs(r.refs.desc) || !validRefs(r.refs.msg) || typeof r.refs.truncated !== 'boolean') return 'invalid dispatch refs';
  if (!Array.isArray(r.follow_ups) || r.follow_ups.length > 32 || !r.follow_ups.every((f) => onlyKeys(f, ['at', 'refs']) && nullableDate(f.at) && validRefs(f.refs))) return 'invalid dispatch follow-ups';
  if (!object(r.messages) || !Object.entries(r.messages).every(([id, m]) => id.length > 0 && object(m) && typeof m.model === 'string' && m.model.length > 0 && validUsage(m, true))) return 'invalid dispatch message usage';
  if (!onlyKeys(r.anon, ['records', 'usage']) || !integer(r.anon.records) || !validModelUsage(r.anon.usage)) return 'invalid dispatch anonymous usage';
  if ('prompts' in r && typeof r.prompts !== 'string') return 'invalid dispatch prompts';
  return null;
}
function check(r) { const p = problem(r); if (p) throw cliError('SCHEMA-INVALID', p); }

/** File hashes cover the actual bytes, including malformed lines. Canonical content hashes exclude capture provenance for both deduplication and evidence ties. */
export function readDispatches(repo) {
  const result = { snapshots: [], tombstones: new Set(), gaps: new Set(), gapTimes: new Map(), files: [], malformed: 0 };
  const dir = deliveryDir(repo); if (!existsSync(dir)) return result;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const name of readdirSync(dir).filter((f) => /^dispatches-.*\.jsonl$/.test(f)).sort()) {
    const path = join(dir, name), fd = openSync(path, 'r'), digest = createHash('sha256');
    let pending = Buffer.alloc(0), bytesTotal = 0;
    const admit = (bytes) => {
      if (!bytes.length) return;
      let line, r;
      try { line = decoder.decode(bytes); if (!line.trim()) return; r = JSON.parse(line); } catch { result.malformed++; return; }
      if (problem(r)) { result.malformed++; return; }
      if (r.retracted === true) result.tombstones.add(r.dispatch_key);
      else if (r.gap === true) {
        result.gaps.add(r.dispatch_key);
        const prior = result.gapTimes.get(r.dispatch_key);
        if (!prior || Date.parse(r.at) > Date.parse(prior)) result.gapTimes.set(r.dispatch_key, r.at);
      } else { const expanded = expand(compact(r)); lineHashes.set(expanded, snapshotDigest(r)); result.snapshots.push(expanded); }
    };
    try {
      const chunk = Buffer.alloc(64 * 1024);
      let n;
      while ((n = readSync(fd, chunk, 0, chunk.length, null))) {
        const part = chunk.subarray(0,n); digest.update(part); bytesTotal += n;
        const buf = pending.length ? Buffer.concat([pending,part]) : part;
        let start=0, end;
        while ((end=buf.indexOf(10,start))!==-1) { admit(buf.subarray(start,end)); start=end+1; }
        pending=Buffer.from(buf.subarray(start));
      }
      admit(pending);
    } finally { closeSync(fd); }
    result.files.push({path,sha256:digest.digest('hex'),bytes:bytesTotal});
  }
  return result;
}

function append(repo, record) {
  mkdirSync(deliveryDir(repo), { recursive: true });
  const path = join(deliveryDir(repo), `dispatches-${whoAmI(repo).slug}.jsonl`);
  // Preserve a prior torn final line as its own malformed line instead of joining the next valid snapshot onto it.
  let separator = '';
  if (existsSync(path)) {
    const fd = openSync(path,'r');
    try { const size=fstatSync(fd).size; if(size) { const byte=Buffer.alloc(1); readSync(fd,byte,0,1,size-1); if(byte[0]!==10) separator='\n'; } }
    finally { closeSync(fd); }
  }
  appendFileSync(path, `${separator}${JSON.stringify(record)}\n`);
}

export function ingestDispatch(repo, snapshot, { index = null, dryRun = false } = {}) {
  check(snapshot);
  if (snapshot.retracted || snapshot.gap) throw cliError('SCHEMA-INVALID', 'ingestDispatch requires a snapshot');
  const digest = index ? snapshotDigest(snapshot) : null;
  if (index?.tombstones.has(snapshot.dispatch_key)) return { result:'tombstoned' };
  const known = index?.keys.get(snapshot.dispatch_key);
  if (known?.has(digest)) return { result:'unchanged' };
  const write = () => { if (!dryRun) append(repo, compact(snapshot)); };
  if (dryRun) write(); else withLock(repo, write);
  if (index) { if (!known) index.keys.set(snapshot.dispatch_key,new Set()); index.keys.get(snapshot.dispatch_key).add(digest); }
  return {result:'ingested'};
}
export function dispatchIndex(store) {
  const keys=new Map();
  for(const s of store.snapshots) {
    // A repeat after the latest gap is needed to close renewed coverage.
    if (store.gapTimes.has(s.dispatch_key) && Date.parse(s.captured_at) <= Date.parse(store.gapTimes.get(s.dispatch_key))) continue;
    if(!keys.has(s.dispatch_key)) keys.set(s.dispatch_key,new Set());
    keys.get(s.dispatch_key).add(snapshotDigest(s));
  }
  return {keys,tombstones:store.tombstones};
}

export function tombstone(repo, key, reason, { now = Date.now() } = {}) {
  const record = { v: 'dispatch.v2', dispatch_key: key, retracted: true, reason, at: nowIso(now) }; check(record);
  return withLock(repo, () => { if (readDispatches(repo).tombstones.has(key)) return { result: 'unchanged' }; append(repo, record); return { result: 'tombstoned' }; });
}
export function gap(repo, key, { now = Date.now() } = {}) {
  const record = { v: 'dispatch.v2', dispatch_key: key, gap: true, at: nowIso(now) }; check(record);
  return withLock(repo, () => { append(repo, record); return { result: 'ingested' }; });
}

function add(acc, model, usage) {
  if (!Object.hasOwn(acc, model)) Object.defineProperty(acc, model, { value: zero(), enumerable: true, configurable: true, writable: true });
  const total = acc[model];
  for (const k of COUNTERS) total[k] += usage[k] ?? 0;
}
function max(a, b) { return Object.fromEntries(COUNTERS.map((k) => [k, Math.max(a?.[k] ?? 0, b?.[k] ?? 0)])); }
const hash = (s) => lineHashes.get(s) ?? snapshotDigest(s);
const ranked = (a, b) => b.records - a.records || (hash(a) < hash(b) ? -1 : hash(a) > hash(b) ? 1 : 0);

/** Union stable identities and maximize anonymous counters. No later partial capture can erase earlier spend or evidence. */
export function reduce(input) {
  const admitted = Array.isArray(input) ? input.filter((s) => !problem(s)).map(expand) : null;
  let snapshots = admitted ? admitted.filter((s) => !s.retracted && !s.gap) : input.snapshots;
  if (admitted && input.some(s=>s.v==='dispatch.v2')) snapshots = snapshots.map(s=>expand(compact(s)));
  const tombstones = new Set(admitted ? admitted.filter((s) => s.retracted).map((s) => s.dispatch_key) : input.tombstones);
  const groups = new Map();
  for (const s of snapshots) {
    if (tombstones.has(s.dispatch_key)) continue;
    if (!lineHashes.has(s)) lineHashes.set(s, snapshotDigest(s));
    if (!groups.has(s.dispatch_key)) groups.set(s.dispatch_key, []);
    groups.get(s.dispatch_key).push(s);
  }
  const out = new Map();
  for (const key of [...groups.keys()].sort()) {
    const all = groups.get(key).sort(ranked), best = all[0];
    const evidence_conflicts = [], scalars = {};
    for (const field of ['agent_type', 'branch', 'stage']) {
      scalars[field] = all.find((s) => s[field] != null)?.[field] ?? null;
      if (new Set(all.map((s) => s[field]).filter((v) => v != null)).size > 1) evidence_conflicts.push(field);
    }
    const ids = sortedUnique(all.flatMap((s) => Object.keys(s.messages))), messages = {}, exact_usage = {}, anonUsage = {};
    let model_conflict = false;
    for (const id of ids) {
      const variants = all.filter((s) => Object.hasOwn(s.messages, id)).map((s) => s.messages[id]);
      if (new Set(variants.map((m) => m.model)).size > 1) model_conflict = true;
      const u = variants.reduce((acc, m) => max(acc, m), zero());
      Object.defineProperty(messages, id, { value: { model: variants[0].model, ...u }, enumerable: true, configurable: true, writable: true });
      add(exact_usage, variants[0].model, u);
    }
    for (const model of sortedUnique(all.flatMap((s) => Object.keys(s.anon.usage)))) {
      Object.defineProperty(anonUsage, model, { value: all.reduce((acc, s) => max(acc, s.anon.usage[model]), zero()), enumerable: true, configurable: true, writable: true });
    }
    const anon = { records: Math.max(...all.map((s) => s.anon.records)), usage: anonUsage };
    const usage = {};
    for (const model of sortedUnique([...Object.keys(exact_usage), ...Object.keys(anonUsage)])) { add(usage, model, exact_usage[model] ?? zero()); add(usage, model, anonUsage[model] ?? zero()); }
    const desc = capped(all.flatMap((s) => s.refs.desc)), msg = capped(all.flatMap((s) => s.refs.msg));
    const follow = capped(all.flatMap((s) => s.follow_ups.map((f) => JSON.stringify(canonical({ at: f.at, refs: sortedUnique(f.refs) })))));
    const identity_uncertain = anon.records > 0 || Object.values(anonUsage).some((u) => COUNTERS.some((k) => u[k] > 0));
    const evidence_conflict = evidence_conflicts.length > 0;
    const timestamps = (field) => all.map((s) => s[field]).filter((v) => v !== null).sort((a, b) => Date.parse(a) - Date.parse(b) || a.localeCompare(b));
    const starts = timestamps('started_at'), ends = timestamps('last_at');
    out.set(key, {
      dispatch_key: key, session: best.session, agent_id: best.agent_id, ...scalars,
      started_at: starts[0] ?? null, last_at: ends.at(-1) ?? null, records: best.records,
      complete: all.every((s) => s.complete && !s.torn && s.last_uuid === best.last_uuid && s.records === best.records),
      torn: all.some((s) => s.torn), last_uuid: best.last_uuid,
      refs: { desc: desc.values, msg: msg.values, truncated: all.some((s) => s.refs.truncated) || desc.truncated || msg.truncated || follow.truncated },
      follow_ups: follow.values.map((f) => JSON.parse(f)), messages, exact_usage, anon, usage,
      identity_uncertain, model_conflict, evidence_conflict, evidence_conflicts,
      flags: [identity_uncertain && 'identity-uncertain', model_conflict && 'model-conflict', evidence_conflict && 'evidence-conflict'].filter(Boolean).sort(),
    });
  }
  return out;
}
