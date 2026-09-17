// STDLIB ONLY. Registered work-item tree per run (spec §5, §6.3) and its delta → observations.
//
// supersedes (F10/F16): M1 permits only *identity* carry-overs when a new run supersedes a
// predecessor run — the same conceptual item keeps a stable, explicit `item_id` across the run
// boundary (its `ref` may be renamed freely; the id may not). `validateSupersedes` checks the
// declared predecessor run matches, every mapping key exists in the predecessor's saved catalogue,
// every mapping value exists in this plan, the map is injective, and — because injectivity alone
// does not rule out a merge/split disguised as a rename — that neither endpoint of a non-identity
// entry (`old !== new`) is *also* independently present as a distinct, different item: `old` must
// not still exist as itself in this plan, and `new` must not have already existed as itself in the
// predecessor. Anything else is rejected as unsupported "non-identity" continuity; the CLI (Task 5)
// turns that rejection into MIGRATION-REQUIRED. `validateSupersedes` only validates — it never
// mutates a plan or catalogue. The actual identity carry happens in `mergeCatalogue`'s optional
// `renameMap`, which rewrites the predecessor catalogue's `item_id`s before diffing so history
// (`version_added`) survives under the new id via the ordinary item_id-matching merge.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { makeObservation, validateEstimate } from './events.mjs';
import { decodeSegment, plansDir, runPath, sha256 } from './paths.mjs';

export { validateEstimate };
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const FACTORIES = ['feature-development', 'test-automation', 'manual-qa'];
const MISSION_KINDS = ['group', 'milestone', 'wave', 'batch', 'run'];
const iso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function extractPlanBlock(text) {
  const m = /```json\s+delivery-plan\s*\n([\s\S]*?)\n```/.exec(text);
  try { const o = JSON.parse(m ? m[1] : text); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
export const runIdOf = (p) => `${p.campaign_id}/${p.run_id}`;

/** F20: never throw on malformed input — every array/object field is shape-checked before it is
 * iterated or indexed, and a bad shape is reported as an error rather than crashing the caller. */
export function validatePlan(p) {
  const errs = [];
  if (!isPlainObject(p)) return ['plan: not an object'];
  if (!ID_RE.test(p.campaign_id ?? '')) errs.push('campaign_id must match ^[a-z0-9][a-z0-9-]*$');
  if (!ID_RE.test(p.run_id ?? '')) errs.push('run_id must match ^[a-z0-9][a-z0-9-]*$');
  if (!Number.isInteger(p.version) || p.version < 1) errs.push('version must be a positive integer');
  if (!FACTORIES.includes(p.factory)) errs.push('factory must be feature-development|test-automation|manual-qa');
  if (!iso(p.observation_start)) errs.push('observation_start must be ISO');
  if (p.source_epoch != null && !isPlainObject(p.source_epoch)) errs.push('source_epoch must be an object');
  const ep = isPlainObject(p.source_epoch) ? p.source_epoch : {};
  if (!iso(ep.from)) errs.push('source_epoch.from must be ISO');
  if (ep.until != null && !iso(ep.until)) errs.push('source_epoch.until must be ISO or null');
  if (!ep.integration_ref) errs.push('source_epoch.integration_ref required');
  if (!MISSION_KINDS.includes(p.mission_kind)) errs.push('mission_kind must be group|milestone|wave|batch|run');
  if (p.campaign != null && !isPlainObject(p.campaign)) errs.push('campaign must be an object');
  const campaign = isPlainObject(p.campaign) ? p.campaign : null;
  if (!campaign?.ref) errs.push('campaign.ref required');
  if (campaign?.estimate) errs.push(...validateEstimate(campaign.estimate, 'campaign.estimate'));

  const refs = new Set(), seqs = new Set(), ids = new Set();
  const seeRef = (r, where) => { if (!r) errs.push(`${where}: ref required`); else if (refs.has(r)) errs.push(`${where}: duplicate ref ${r}`); else refs.add(r); };
  const seeId = (o, where) => { if (o.item_id != null) { if (ids.has(o.item_id)) errs.push(`${where}: duplicate item_id ${o.item_id}`); ids.add(o.item_id); } };
  if (campaign?.ref) { refs.add(campaign.ref); seeId(campaign, 'campaign'); }

  let missions = [];
  if (p.missions != null) { if (!Array.isArray(p.missions)) errs.push('missions must be an array'); else missions = p.missions; }
  for (const m of missions) {
    if (!isPlainObject(m)) { errs.push('mission: not an object'); continue; }
    seeRef(m.ref, 'mission'); seeId(m, `mission ${m.ref}`);
    if (!Number.isInteger(m.sequence) || m.sequence < 1) errs.push(`mission ${m.ref}: sequence must be a positive integer`);
    else if (seqs.has(m.sequence)) errs.push(`mission ${m.ref}: duplicate sequence ${m.sequence}`); else seqs.add(m.sequence);
    if (m.estimate) errs.push(...validateEstimate(m.estimate, `mission ${m.ref}.estimate`));
    let tasks = [];
    if (m.tasks != null) { if (!Array.isArray(m.tasks)) errs.push(`mission ${m.ref}: tasks must be an array`); else tasks = m.tasks; }
    for (const t of tasks) {
      if (!isPlainObject(t)) { errs.push(`mission ${m.ref}: task not an object`); continue; }
      seeRef(t.ref, `mission ${m.ref} task`); seeId(t, `task ${t.ref}`);
      if (t.story != null && !/^US-\d+$/.test(t.story)) errs.push(`task ${t.ref}: story must match US-<n>`);
      if (t.estimate) errs.push(...validateEstimate(t.estimate, `task ${t.ref}.estimate`));
    }
  }
  if (p.supersedes != null) {
    const sp = isPlainObject(p.supersedes) ? p.supersedes : {};
    if (!isPlainObject(p.supersedes)) errs.push('supersedes must be an object');
    if (!sp.run) errs.push('supersedes.run required');
    const im = isPlainObject(sp.item_map) ? sp.item_map : {};
    if (sp.item_map != null && !isPlainObject(sp.item_map)) errs.push('supersedes.item_map must be an object');
    const vals = Object.values(im);
    if (new Set(vals).size !== vals.length) errs.push('supersedes.item_map must be injective');
  }
  return errs;
}

export function assignIds(p) {
  const out = JSON.parse(JSON.stringify(p)); const run = runIdOf(out);
  out.campaign.item_id ??= `${run}/campaign`;
  for (const m of out.missions ?? []) { m.item_id ??= `${run}/mission-${slugify(m.ref)}`; for (const t of m.tasks ?? []) t.item_id ??= `${run}/task-${slugify(t.ref)}`; }
  return out;
}

export function validateIds(p) {
  const errs = [], seen = new Set(), ids = new Set(), run = runIdOf(p);
  const collect = (o) => { if (o?.item_id != null) ids.add(o.item_id); };
  collect(p.campaign);
  for (const m of p.missions ?? []) { collect(m); for (const t of m.tasks ?? []) collect(t); }
  const see = (o, where) => {
    if (!String(o.item_id).startsWith(`${run}/`)) errs.push(`${where}: item_id must start with ${run}/`);
    if (seen.has(o.item_id)) errs.push(`${where}: duplicate item_id ${o.item_id}`); seen.add(o.item_id);
    if (o.parent_item_id != null && !ids.has(o.parent_item_id)) errs.push(`${where}: parent_item_id ${o.parent_item_id} does not exist`);
  };
  see(p.campaign, 'campaign');
  for (const m of p.missions ?? []) { see(m, `mission ${m.ref}`); for (const t of m.tasks ?? []) see(t, `task ${t.ref}`); }
  return errs;
}

export function toCatalogue(p, { version }) {
  const rows = [];
  const row = (o, level, parent) => rows.push({ item_id: o.item_id, ref: o.ref, level, parent_item_id: parent, story: o.story ?? null, class: o.class ?? null, role: o.role ?? null,
    branch: o.branch ?? null, sequence: o.sequence ?? null, estimate: o.estimate ?? null, version_added: version, cancelled: false });
  row(p.campaign, 'campaign', null);
  for (const m of p.missions ?? []) { row(m, 'mission', p.campaign.item_id); for (const t of m.tasks ?? []) row(t, 'task', m.item_id); }
  return rows;
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
export const canonicalHash = (p) => sha256(JSON.stringify(sortKeys(p)));

export function saveRun(repo, rec) { mkdirSync(plansDir(repo), { recursive: true }); writeFileSync(runPath(repo, rec.run), `${JSON.stringify(rec, null, 2)}\n`); }
export function loadRun(repo, runId) { const p = runPath(repo, runId); if (!existsSync(p)) return null; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
export function listRuns(repo) {
  if (!existsSync(plansDir(repo))) return [];
  return readdirSync(plansDir(repo)).filter((f) => f.endsWith('.json')).sort().map((f) => loadRun(repo, decodeSegment(f.replace(/\.json$/, '')))).filter(Boolean);
}

/** F10/F16: `run` must equal the predecessor run id derived from `prevItems`' campaign row (there
 * is exactly one per saved catalogue). Pure — takes the predecessor's saved catalogue, never reads
 * or writes the ledger/disk itself. */
export function validateSupersedes(plan, prevItems) {
  const sp = plan?.supersedes;
  if (!sp) return [];
  const errs = [];
  const prevCampaign = (prevItems ?? []).find((i) => i.level === 'campaign');
  const prevRun = prevCampaign ? prevCampaign.item_id.replace(/\/campaign$/, '') : null;
  if (prevRun == null || sp.run !== prevRun) errs.push(`supersedes.run must equal predecessor run ${prevRun ?? '(unknown)'}`);

  const prevIds = new Set((prevItems ?? []).map((i) => i.item_id));
  const nextIds = new Set();
  if (plan.campaign?.item_id != null) nextIds.add(plan.campaign.item_id);
  for (const m of plan.missions ?? []) { if (m.item_id != null) nextIds.add(m.item_id); for (const t of m.tasks ?? []) if (t.item_id != null) nextIds.add(t.item_id); }

  const map = isPlainObject(sp.item_map) ? sp.item_map : {};
  const vals = Object.values(map);
  if (new Set(vals).size !== vals.length) errs.push('supersedes.item_map must be injective');

  for (const [oldId, newId] of Object.entries(map)) {
    if (!prevIds.has(oldId)) { errs.push(`supersedes.item_map: unknown predecessor item ${oldId}`); continue; }
    if (!nextIds.has(newId)) { errs.push(`supersedes.item_map: unknown item ${newId} in this plan`); continue; }
    if (oldId === newId) continue;
    if (nextIds.has(oldId)) errs.push(`supersedes.item_map: non-identity mapping ${oldId} -> ${newId}: ${oldId} is still present as a distinct item in this plan (M1 permits only identity renames)`);
    if (prevIds.has(newId)) errs.push(`supersedes.item_map: non-identity mapping ${oldId} -> ${newId}: ${newId} already existed as a distinct predecessor item (M1 permits only identity renames)`);
  }
  return errs;
}

/** `renameMap` (an already-validated identity mapping, `{oldItemId: newItemId}`) is applied to
 * `prev` before diffing so an item's history (`version_added`) survives under its new, run-scoped
 * id — the ordinary item_id-matching merge below then treats it as the same row (F16). */
export function mergeCatalogue(prev, next, { keepMissing = false, renameMap = null } = {}) {
  const renamedPrev = renameMap ? prev.map((i) => (Object.hasOwn(renameMap, i.item_id) ? { ...i, item_id: renameMap[i.item_id] } : i)) : prev;
  const nextBy = new Map(next.map((i) => [i.item_id, i]));
  const prevBy = new Map(renamedPrev.map((i) => [i.item_id, i]));
  const out = next.map((i) => ({ ...i, version_added: prevBy.get(i.item_id)?.version_added ?? i.version_added, cancelled: false }));
  for (const i of renamedPrev) if (!nextBy.has(i.item_id)) out.push({ ...i, cancelled: keepMissing ? Boolean(i.cancelled) : true });
  return out;
}

const rangeKey = (e) => JSON.stringify([e.unit, e.low, e.high, e.tier]);
const acceptedAt = (e) => (e.accepted_by && e.accepted_at ? e.accepted_at : null);
/** F7: a changed range needs a fresh acceptance pair ('changed' vs 'changed-stale-acceptance'), but
 * an *unchanged* range whose acceptance pair newly appears or is re-affirmed with a later timestamp
 * is also a real fact the ledger must register — the ordinary proposal → human-acceptance workflow.
 * That case returns 'accepted' rather than 'none'; 'none' is reserved for genuinely no change. */
export function estimateChange(prev, next) {
  if (!next) return 'none';
  if (!prev) return 'new';
  if (rangeKey(prev) === rangeKey(next)) {
    const prevAt = acceptedAt(prev), nextAt = acceptedAt(next);
    if (nextAt && (!prevAt || Date.parse(nextAt) > Date.parse(prevAt))) return 'accepted';
    return 'none';
  }
  const newer = next.accepted_by && next.accepted_at && (!prev.accepted_at || Date.parse(next.accepted_at) > Date.parse(prev.accepted_at));
  return newer ? 'changed' : 'changed-stale-acceptance';
}
export const estimateStatus = (e, { stale = false } = {}) => (!e ? 'none' : (!stale && e.accepted_by && e.accepted_at ? 'accepted' : 'unaccepted'));

export function planDelta(prev, next, { keepMissing = false } = {}) {
  const prevBy = new Map(prev.map((i) => [i.item_id, i])); const nextBy = new Map(next.map((i) => [i.item_id, i]));
  const created = [], estimated = [], cancelled = [], reopened = [];
  for (const i of next) {
    const old = prevBy.get(i.item_id);
    if (!old) { created.push(i); if (i.estimate) estimated.push({ item: i, stale: false }); continue; }
    if (old.cancelled) reopened.push(i);
    const ch = estimateChange(old.estimate, i.estimate);
    if (ch === 'new' || ch === 'changed' || ch === 'accepted') estimated.push({ item: i, stale: false });
    else if (ch === 'changed-stale-acceptance') estimated.push({ item: i, stale: true });
  }
  if (!keepMissing) for (const i of prev) if (!nextBy.has(i.item_id) && !i.cancelled) cancelled.push(i);
  return { created, estimated, cancelled, reopened };
}

/** Observations for one registration; identities depend only on token+item+event so retries SKIP.
 * `estimate_revision` is set by the CLI (Task 5) — from the count of existing `estimated`
 * observations for that item — on the catalogue item passed in via `delta`, before calling this
 * function; it is never computed here (F2: this module owns no revision-counting state). */
export function registrationObservations({ run, version, delta, token, at, createdAtOf = () => null, now = Date.now() }) {
  const common = { user: null, host: 'cli', plan: run.run, source: 'cli', source_record_id: token };
  const base = (i) => ({ ...common, item_id: i.item_id, ref: i.ref, level: i.level });
  const out = [];
  for (const i of delta.created) {
    const c = createdAtOf(i);
    out.push(makeObservation({ ...base(i), event: 'created', transition_id: `${i.item_id}/created/0`, at: c?.at ?? at, basis: c?.sha ? 'plan-commit' : 'observed', meta: { version, ...(c?.sha ? { git_sha: c.sha } : {}) } }, { now }));
  }
  for (const { item: i, stale } of delta.estimated) {
    const rev = i.estimate_revision ?? 0;
    out.push(makeObservation({ ...base(i), event: 'estimated', transition_id: `${i.item_id}/estimated/rev-${rev}`, at: i.estimate.accepted_at ?? i.estimate.proposed_at, estimate: i.estimate,
      meta: { version, estimate_revision: rev, acceptance: stale ? 'stale-acceptance' : estimateStatus(i.estimate) } }, { now }));
  }
  for (const i of delta.cancelled) out.push(makeObservation({ ...base(i), event: 'cancelled', transition_id: `${i.item_id}/cancelled/episode-1`, at, raw: 'removed-from-plan', meta: { version } }, { now }));
  for (const i of delta.reopened) out.push(makeObservation({ ...base(i), event: 'reopened', transition_id: `${i.item_id}/reopened/v${version}`, at, raw: 're-added-to-plan', meta: { version } }, { now }));
  return out;
}
