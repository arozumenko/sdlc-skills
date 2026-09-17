#!/usr/bin/env node
// STDLIB ONLY. delivery-metrics CLI (spec §6.5). Thin dispatcher over scripts/lib/*.
import { realpathSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliError, deliveryDir, nowIso, profilePath, sessionPath, sessionsDir, sha256 } from './lib/paths.mjs';
import { EVENTS, appendObservation, makeObservation, resolveObservations } from './lib/events.mjs';
import { assignIds, canonicalHash, estimateStatus, extractPlanBlock, listRuns, loadRun, mergeCatalogue, planDelta, registrationObservations, runIdOf, saveRun, toCatalogue, validateIds, validatePlan, validateSupersedes } from './lib/plan.mjs';
import { importTasksMarkdown } from './lib/plan-markdown.mjs';
import { commitTime, firstCommitContaining, git, relPath } from './lib/git.mjs';
import { bestEffortSync } from './lib/sync.mjs';
import { makeRoster } from './lib/roster.mjs';

export const SKILL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_EVENTS = ['dispatched', 'done', 'cancelled', 'blocked', 'unblocked', 'reopened', 'review_requested', 'review_returned', 'review_approved', 'first_commit'];
const TERMINAL_HISTORY_EVENTS = ['done', 'cancelled', 'reopened'];
const out = (io, s) => io.stdout.write(`${s}\n`);
const isoOrThrow = (s, flag) => { if (Number.isNaN(Date.parse(s))) throw cliError('USAGE', `invalid ${flag} ${s}`); return new Date(s).toISOString(); };
/** A bare `--flag` with no argument (parseArgs sets it to boolean true) is user input, not a crash —
 * fail it as USAGE before it reaches path.resolve/Number/Date.parse, some of which throw plain
 * TypeErrors (not cliError) on a boolean and would otherwise fall through to INTERNAL/exit 1. */
const requireValue = (f, name) => { if (f[name] === true) throw cliError('USAGE', `--${name} requires a value`); return f[name]; };
/** plan register --from <file> must reject a directory (EISDIR would otherwise reach INTERNAL). */
const requireFile = (path) => { if (!existsSync(path)) throw cliError('USAGE', `no such file ${path}`); if (!statSync(path).isFile()) throw cliError('USAGE', `${path} is not a file`); };

export function parseArgs(argv) {
  const o = { cmd: argv[0] ?? null, sub: null, positional: [], flags: {} };
  const rest = argv.slice(1);
  if (rest[0] && !rest[0].startsWith('--') && ['plan', 'session', 'profile'].includes(o.cmd)) o.sub = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) { const v = rest[i + 1]; if (v === undefined || v.startsWith('--')) o.flags[a.slice(2)] = true; else { o.flags[a.slice(2)] = v; i++; } }
    else o.positional.push(a);
  }
  return o;
}

export function resolveRun(repo, flag) {
  if (flag) { const r = loadRun(repo, flag); if (!r) throw cliError('NO-PLAN', `no registered run ${flag}`); return r; }
  const open = listRuns(repo).filter((r) => r.status === 'open');
  if (!open.length) throw cliError('NO-PLAN', 'no open plan in this repo — run plan register');
  if (open.length > 1) throw cliError('AMBIGUOUS-PLAN', `pass --plan: ${open.map((r) => r.run).join(',')}`);
  return open[0];
}
export function resolveRef(run, ref, { allowCancelled = false } = {}) {
  const hit = run.items.filter((i) => i.ref === ref || i.item_id === ref);
  if (hit.length !== 1) throw cliError('USAGE', `unknown ref ${ref} in ${run.run}`);
  if (hit[0].cancelled && !allowCancelled) throw cliError('USAGE', `${ref} is cancelled in the current plan version; pass --allow-cancelled`);
  return hit[0];
}

/** history = the item's current occurrences sorted by at ([{event, at}]); returns null when ok, else the reason.
 * M1 rules only: done after cancelled (no later reopened) is invalid, cancelled after done (no later
 * reopened) is invalid, reopened is invalid unless the item is currently terminal. Re-submitting the
 * SAME event that already produced the current terminal state (a retry or a --revision correction) is
 * the same occurrence, not a transition, and is always valid — the fold below only ever reaches a
 * "done"/"cancelled" state via that same event, so `event === state` never trips the guards. */
export function validateTransition(history, event) {
  let state = 'open';
  for (const h of history) { if (TERMINAL_HISTORY_EVENTS.includes(h.event) && h.event !== 'reopened') state = h.event; else if (h.event === 'reopened') state = 'open'; }
  if (event === 'done' && state === 'cancelled') return 'done after cancelled without reopened';
  if (event === 'cancelled' && state === 'done') return 'cancelled after done without reopened';
  if (event === 'reopened' && state === 'open') return 'reopened when the item is not terminal';
  return null;
}

/** Sorted {event, at} occurrences for the M1 state machine (done/cancelled/reopened only). */
function itemHistory(observations, item) {
  return observations.filter((o) => o.item_id === item.item_id && TERMINAL_HISTORY_EVENTS.includes(o.event)).sort((a, b) => a.at.localeCompare(b.at)).map((o) => ({ event: o.event, at: o.at }));
}
/** F10.3: the terminal state an item is currently in, from the same history validateTransition folds over. */
function terminalState(observations, item) {
  let state = 'open';
  for (const h of itemHistory(observations, item)) { if (h.event === 'done' || h.event === 'cancelled') state = h.event; else if (h.event === 'reopened') state = 'open'; }
  return state;
}

function emitRegistration(repo, io, { run, delta, token, at, createdAtOf, now, active, records = null }) {
  for (const i of [...delta.created, ...delta.estimated.map((e) => e.item)]) i.estimate_revision = active.filter((o) => o.plan === run.run && o.item_id === i.item_id && o.event === 'estimated').length;
  const recs = records ?? registrationObservations({ run, version: run.version, delta, token, at, createdAtOf, now });
  let conflicts = 0;
  for (const r of recs) { const res = appendObservation(repo, r, { now }); out(io, `${res.result} ${res.observation_id}`); if (res.result === 'ID-CONFLICT') conflicts++; }
  return conflicts;
}

function cmdPlanRegister(repo, f, io, now) {
  const file = requireValue(f, 'from') ? resolve(repo, f.from) : null, token = f.id;
  if (!file || !token) throw cliError('USAGE', 'plan register needs --from <file> --id <token>');
  requireFile(file);
  const text = readFileSync(file, 'utf8');
  let obj = extractPlanBlock(text);
  if (!obj) {
    if (!f.campaign || !f.run || !f['observation-start']) throw cliError('USAGE', 'markdown import needs --campaign --run --observation-start');
    const { plan: imported, warnings } = importTasksMarkdown(text, { campaign_id: f.campaign, run_id: f.run, version: Number(f.version ?? 1), observation_start: isoOrThrow(f['observation-start'], '--observation-start'), integration_ref: f['integration-ref'] ?? 'main' });
    for (const w of warnings) io.stderr.write(`WARN ${w}\n`);
    obj = imported;
    if (!f.yes) { out(io, '```json delivery-plan'); out(io, JSON.stringify(obj, null, 2)); out(io, '```'); out(io, `DRY-RUN ${runIdOf(obj)} v${obj.version} — re-run with --yes to register`); return 0; }
  }
  let errs = validatePlan(obj); if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  const full = assignIds(obj); errs = validateIds(full); if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  const runId = runIdOf(full), digest = sha256(`${token}\n${canonicalHash(full)}`);
  const prev = loadRun(repo, runId);
  const { active } = resolveObservations(repo);
  const next = toCatalogue(full, { version: full.version });

  // 1. Identical retry → re-emit the saved observations verbatim (they SKIP against the ledger).
  // F9: this must SKIP even after the run has moved on to a later version, since events.mjs's
  // semantic identity deliberately excludes meta.version — replaying the byte-identical saved
  // records is unaffected by any intervening re-cut.
  const req = prev?.requests?.[token];
  if (req && req.digest === digest) {
    const ver = prev.versions.find((v) => v.version === req.version);
    const before = prev.versions.filter((v) => v.version < req.version).sort((a, b) => b.version - a.version)[0];
    const delta = planDelta(before?.items ?? [], ver.items, { keepMissing: req.keep_missing });
    const conflicts = emitRegistration(repo, io, { run: prev, delta, token, at: req.at, createdAtOf: (i) => req.created[i.item_id] ?? null, now, active, records: req.observations });
    out(io, `PLAN ${runId} v${req.version} (retry) items=${prev.items.length}`);
    if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} registration observation(s) conflict`);
    return 0;
  }
  if (req) throw cliError('ID-CONFLICT', `registration token ${token} reused with different input`);

  // 2. New request.
  if (prev && full.version <= prev.version) throw cliError('USAGE', `version must exceed ${prev.version} for ${runId}`);
  if (prev && full.version > 1 && !f.at) throw cliError('USAGE', 're-cut requires --at <effective iso>');
  // R2/F16: supersedes is a within-run re-cut mapping — supersedes.run must equal this run's own id
  // (the predecessor version of the SAME run). validateSupersedes checks the predecessor match, that
  // every mapping key/value exists, injectivity, and that non-identity entries are genuine 1:1
  // renames (not a merge/split in disguise). Any violation is user input that cannot be registered
  // as declared → MIGRATION-REQUIRED, never silently ignored.
  if (full.supersedes) {
    const supErrs = validateSupersedes(full, prev?.items ?? []);
    if (supErrs.length) throw cliError('MIGRATION-REQUIRED', supErrs[0]);
  }
  const renameMap = full.supersedes
    ? Object.fromEntries(Object.entries(full.supersedes.item_map ?? {}).filter(([oldId, newId]) => oldId !== newId))
    : null;

  const at = f.at ? isoOrThrow(requireValue(f, 'at'), '--at') : nowIso(now);
  const sourceHead = git(repo, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const rel = relPath(repo, file); const tracked = git(repo, ['ls-files', '--error-unmatch', rel]) != null;
  const created = {};
  const createdAtOf = (i) => {
    if (f['created-at']) return (created[i.item_id] = { at: isoOrThrow(f['created-at'], '--created-at') });
    if (!tracked || !sourceHead) return null;
    const c = firstCommitContaining(repo, sourceHead, rel, i.ref); if (c) created[i.item_id] = c; return c;
  };
  const keepMissing = Boolean(f['keep-missing']);
  const rawDelta = planDelta(prev?.items ?? [], next, { keepMissing });
  // F10.3: removing delivered scope never cancels its history — an item already `done` when it drops
  // out of the catalogue is counted as scope_removed_delivered, not emitted as a `cancelled` fact.
  const scopeRemovedDelivered = rawDelta.cancelled.filter((i) => terminalState(active, i) === 'done');
  const delta = { ...rawDelta, cancelled: rawDelta.cancelled.filter((i) => terminalState(active, i) !== 'done') };

  if (f['dry-run']) { out(io, `DRY-RUN ${runId} v${full.version} created=${delta.created.length} estimated=${delta.estimated.length} cancelled=${delta.cancelled.length} scope_removed_delivered=${scopeRemovedDelivered.length}`); return 0; }
  const factories = f.factories ? String(f.factories).split(',') : [full.factory];
  if (!factories.includes(full.factory)) throw cliError('USAGE', 'participating factories must include plan factory');
  const roster = makeRoster(repo, factories, f.roster ? String(f.roster).split(',') : null);
  // F10.3 (continuation): mergeCatalogue (plan.mjs, unmodified) has no notion of ledger state, so it
  // marks every item missing from `next` as `cancelled: true`. Patch the delivered-removed subset
  // back to `cancelled: false, removed_delivered: true` here — that keeps resolveRef accepting them
  // (it only refuses `cancelled` items) and, on the *next* re-cut, keeps planDelta's own
  // `if (old.cancelled) reopened.push(i)` check from firing when the item is re-added (old.cancelled
  // is false), so a re-add never mints a spurious `reopened` for an item whose true state is `done`.
  // An item present in `next` again gets a fresh row straight from `next` with no `removed_delivered`
  // field, so the flag is naturally cleared once the item is back in scope.
  const mergedItems = mergeCatalogue(prev?.items ?? [], next, { keepMissing, renameMap });
  const removedDeliveredIds = new Set(scopeRemovedDelivered.map((i) => i.item_id));
  for (const i of mergedItems) if (removedDeliveredIds.has(i.item_id)) { i.cancelled = false; i.removed_delivered = true; }
  const rec = {
    run: runId, campaign_id: full.campaign_id, run_id: full.run_id, version: full.version, factory: full.factory, status: 'open',
    registered_at: prev?.registered_at ?? nowIso(now), updated_at: nowIso(now), observation_start: full.observation_start, source_epoch: full.source_epoch, mission_kind: full.mission_kind,
    source: { path: file, rel, sha256: sha256(text), head: sourceHead }, canonical_sha256: canonicalHash(full), roster,
    import: full.import ?? null, supersedes: full.supersedes ?? null, items: mergedItems,
    versions: [...(prev?.versions ?? []), { version: full.version, at, keep_missing: keepMissing, canonical_sha256: canonicalHash(full), items: next }],
    requests: { ...(prev?.requests ?? {}) },
  };
  mkdirSync(deliveryDir(repo), { recursive: true });
  for (const i of delta.created) created[i.item_id] = createdAtOf(i) ?? { at: nowIso(now) };
  for (const i of [...delta.created, ...delta.estimated.map((e) => e.item)]) i.estimate_revision = active.filter((o) => o.plan === runId && o.item_id === i.item_id && o.event === 'estimated').length;
  const observations = registrationObservations({ run: rec, version: full.version, delta, token, at, createdAtOf: (i) => created[i.item_id], now });
  rec.requests[token] = { digest, version: full.version, at, source_head: sourceHead, keep_missing: keepMissing, created, observations };
  saveRun(repo, rec);
  const conflicts = emitRegistration(repo, io, { run: rec, delta, token, at, createdAtOf: (i) => created[i.item_id], now, active, records: observations });
  const st = next.map((i) => estimateStatus(i.estimate));
  out(io, `PLAN ${runId} v${full.version} items=${next.length} created=${delta.created.length} estimated=${delta.estimated.length} stale-acceptance=${delta.estimated.filter((e) => e.stale).length} cancelled=${delta.cancelled.length} reopened=${delta.reopened.length} accepted=${st.filter((s) => s === 'accepted').length} unaccepted=${st.filter((s) => s === 'unaccepted').length} unestimated=${st.filter((s) => s === 'none').length} scope_removed_delivered=${scopeRemovedDelivered.length}`);
  if (conflicts) throw cliError('ID-CONFLICT', `${conflicts} registration observation(s) conflict with existing records`);
  return 0;
}

function buildEvent(repo, run, item, ev, f, token, now) {
  if (!CLI_EVENTS.includes(ev) || !EVENTS.includes(ev)) throw cliError('USAGE', `unknown event ${ev}; expected one of ${CLI_EVENTS.join('|')}`);
  const revision = f.revision != null ? Number(requireValue(f, 'revision')) : 0;
  if (!Number.isInteger(revision) || revision < 0) throw cliError('USAGE', 'invalid --revision');
  let at = f.at ? isoOrThrow(requireValue(f, 'at'), '--at') : null; const meta = { version: run.version };
  if (f.sha) {
    const c = commitTime(repo, f.sha); if (!c) throw cliError('USAGE', `cannot resolve commit ${f.sha}`);
    if (at && at !== c.at) { if (revision < 1) throw cliError('USAGE', `at and sha disagree (${at} vs ${c.at}); pass --revision <n> to correct`); meta.clock = 'corrected'; } else at = c.at;
    meta.git_sha = c.sha;
  }
  if (!at) at = nowIso(now);
  if (f.note) meta.note = String(f.note);
  const transition = f.transition ?? (['done', 'cancelled', 'reopened'].includes(ev) ? `${item.item_id}/${ev}/episode-1` : `${item.item_id}/${ev}/${token}`);
  return makeObservation({ user: null, host: 'cli', plan: run.run, item_id: item.item_id, ref: item.ref, level: item.level, event: ev, transition_id: transition, source: 'cli',
    source_record_id: token, at, revision, status: f.status ?? 'active', raw: f.raw ?? null, meta }, { now });
}

function cmdEvent(repo, p, io, now) {
  const run = resolveRun(repo, p.flags.plan);
  const { active } = resolveObservations(repo);
  // F10.1: a batch must validate each row against history including rows appended earlier in the
  // SAME batch, not just the pre-batch ledger snapshot. Accumulate per-item history as rows succeed.
  const historyByItem = new Map();
  const historyFor = (item) => { if (!historyByItem.has(item.item_id)) historyByItem.set(item.item_id, itemHistory(active, item)); return historyByItem.get(item.item_id); };
  const one = (ref, ev, f, token) => {
    const item = resolveRef(run, ref, { allowCancelled: Boolean(f['allow-cancelled']) });
    const rec = buildEvent(repo, run, item, ev, f, token, now);
    // F10.2: corrections (--revision >= 1) still run validateTransition — a correction that merely
    // re-affirms the same event is "the same occurrence" and passes; a correction that would smuggle
    // in a genuinely different transition is still rejected.
    if (rec.status === 'active') { const why = validateTransition(historyFor(item), ev); if (why) throw cliError('INVALID-TRANSITION', `${ref}: ${why}`); }
    const res = appendObservation(repo, rec, { now });
    // Minor (a): re-sort after every push so a batch's rows fold in timeline order even when the
    // input file lists them out of chronological order (historyFor returns the live array reference,
    // so sorting in place keeps every later lookup for this item consistent).
    if (res.result === 'EVENT' && TERMINAL_HISTORY_EVENTS.includes(ev)) { const h = historyFor(item); h.push({ event: ev, at: rec.at }); h.sort((a, b) => a.at.localeCompare(b.at)); }
    out(io, `${res.result} ${res.observation_id} ${rec.at}`);
    return res;
  };
  if (p.flags.from) {
    const from = requireValue(p.flags, 'from') ? resolve(repo, p.flags.from) : null;
    requireFile(from);
    let appended = 0, skipped = 0, conflicts = 0, invalid = 0, n = 0;
    for (const line of readFileSync(from, 'utf8').split('\n')) {
      n++; if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { invalid++; io.stderr.write(`WARN line ${n}: invalid json\n`); continue; }
      // Issue 1: a line that parses cleanly but isn't a plain object (null, an array, a bare string
      // or number) would otherwise reach `j.ref` as undefined and fail deep inside — reject it here,
      // counted the same as invalid JSON.
      if (j === null || typeof j !== 'object' || Array.isArray(j)) { invalid++; io.stderr.write(`WARN line ${n}: not an object\n`); continue; }
      try { const res = one(j.ref, j.event, { at: j.at, sha: j.sha, transition: j.transition, raw: j.raw, revision: j.revision, status: j.status, note: j.note }, j.id); if (res.result === 'EVENT') appended++; else if (res.result === 'SKIP') skipped++; else conflicts++; }
      // Issue 2: only a genuine cliError (code + a mapped exit) is "this row is invalid input" — a
      // real system error (e.g. a thrown fs Error with a string .code like EACCES/ENOSPC) must not be
      // swallowed as an invalid line; it propagates out to main()'s INTERNAL/exit-1 catch-all, exactly
      // like main's own predicate (`e.code && e.exit`).
      catch (e) { if (!(e.code && e.exit)) throw e; invalid++; io.stderr.write(`WARN line ${n}: ${e.message}\n`); }
    }
    out(io, `EVENTS appended=${appended} skipped=${skipped} conflicts=${conflicts} invalid=${invalid}`);
    if (conflicts || invalid) throw cliError(conflicts ? 'ID-CONFLICT' : 'USAGE', `${conflicts} conflicting, ${invalid} invalid line(s)`);
    return 0;
  }
  const [ref, ev] = p.positional;
  if (!ref || !ev || !p.flags.id) throw cliError('USAGE', 'event <ref> <event> --id <token> [--plan <run>]');
  const res = one(ref, ev, p.flags, p.flags.id);
  if (res.result === 'ID-CONFLICT') throw cliError('ID-CONFLICT', `${res.observation_id} rev ${res.revision} exists with different content; use --revision ${res.revision + 1}`);
  return 0;
}

function cmdPlan(repo, p, io, now) {
  const f = p.flags;
  if (p.sub === 'register') return cmdPlanRegister(repo, f, io, now);
  if (p.sub === 'list') { for (const r of listRuns(repo)) out(io, `PLAN ${r.run} v${r.version} status=${r.status} items=${r.items.length}`); return 0; }
  const run = resolveRun(repo, f.plan);
  if (p.sub === 'show') { out(io, JSON.stringify(run, null, 2)); return 0; }
  if (p.sub === 'close') { run.status = 'closed'; run.updated_at = nowIso(now); saveRun(repo, run); out(io, `PLAN ${run.run} status=closed`); return 0; }
  if (p.sub === 'roster') {
    if (!f.agents) throw cliError('USAGE', 'plan roster --plan <run> --agents a,b');
    // R1: the run record stores only `roster` (the makeRoster snapshot) — there is no separate
    // roster_agents field. Refresh using the run's saved participating factories and assert --agents
    // equals the installed union; last-writer-wins.
    run.roster = makeRoster(repo, run.roster?.factories ?? [run.factory], String(f.agents).split(',').map((s) => s.trim()).filter(Boolean));
    run.updated_at = nowIso(now); saveRun(repo, run); out(io, `PLAN ${run.run} roster=${run.roster.agents.join(',')}`); return 0;
  }
  throw cliError('USAGE', `plan ${p.sub ?? ''}: expected register|list|show|close|roster`);
}
function cmdSession(repo, p, io, now) {
  const f = p.flags;
  if (p.sub !== 'set' || !f.host || !f.session || !f.plan) throw cliError('USAGE', 'session set --host <h> --session <s> --plan <run>');
  resolveRun(repo, f.plan); mkdirSync(sessionsDir(repo), { recursive: true });
  writeFileSync(sessionPath(repo, f.host, f.session), `${JSON.stringify({ host: f.host, session: f.session, plan: f.plan, at: nowIso(now) })}\n`);
  out(io, `SESSION ${f.host}:${f.session} -> ${f.plan}`); return 0;
}

/** F20: real type/range validation, not just key-name membership — a below-floor profile value
 * (e.g. minWholeWeeks < 3) would silently defeat D11's velocity floor if only key names were checked. */
function validateProfile(obj, tpl) {
  const errs = [];
  for (const k of Object.keys(obj)) {
    if (!(k in tpl)) { errs.push(`profile.${k} is not a known key`); continue; }
    const v = obj[k];
    if (k === 'capturePrompts') { if (typeof v !== 'boolean') errs.push('profile.capturePrompts must be boolean'); }
    else if (k === 'zeroDurationSec') { if (!Number.isInteger(v) || v < 0) errs.push('profile.zeroDurationSec must be an integer >= 0'); }
    else if (k === 'minWholeWeeks') { if (!Number.isInteger(v) || v < 3) errs.push('profile.minWholeWeeks must be an integer >= 3'); }
    else if (k === 'tokenomics') { if (typeof v !== 'string' || !v) errs.push('profile.tokenomics must be a non-empty string'); }
    else if (k === 'baselines') {
      if (v == null || typeof v !== 'object' || Array.isArray(v)) errs.push('profile.baselines must be an object');
      else for (const [bk, bv] of Object.entries(v)) {
        if (!(bk in tpl.baselines)) errs.push(`profile.baselines.${bk} is not a known key`);
        else if (bv !== null && typeof bv !== 'number') errs.push(`profile.baselines.${bk} must be number or null`);
      }
    }
  }
  return errs;
}
function cmdProfile(repo, p, io) {
  if (p.sub !== 'set' || !p.flags.from) throw cliError('USAGE', 'profile set --from <file>');
  const tpl = JSON.parse(readFileSync(resolve(SKILL_ROOT, 'templates', 'profile.template.json'), 'utf8'));
  const from = resolve(repo, p.flags.from);
  let obj; try { obj = JSON.parse(readFileSync(from, 'utf8')); } catch { throw cliError('USAGE', `${from}: invalid json or no such file`); }
  const errs = validateProfile(obj, tpl); if (errs.length) throw cliError('SCHEMA-INVALID', errs[0]);
  // Issue 3: a shallow {...tpl, ...obj} replaces the whole `baselines` object wholesale, dropping
  // every template baseline the caller didn't mention — merge that one nested object one level deep.
  const merged = { ...tpl, ...obj, baselines: { ...tpl.baselines, ...(obj.baselines ?? {}) } };
  mkdirSync(deliveryDir(repo), { recursive: true }); writeFileSync(profilePath(repo), `${JSON.stringify(merged, null, 2)}\n`);
  out(io, 'PROFILE written (last-writer-wins)'); return 0;
}

export const COMMANDS = { plan: cmdPlan, session: cmdSession, event: cmdEvent, profile: cmdProfile };
const MUTATING = new Set(['plan', 'session', 'event', 'profile', 'backfill']);

export async function main(argv = process.argv.slice(2), { repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), now = Date.now(), stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const io = { stdout, stderr }; const p = parseArgs(argv); const fn = COMMANDS[p.cmd];
  if (!fn) { stderr.write(`USAGE(unknown command ${p.cmd ?? ''}; expected ${Object.keys(COMMANDS).join('|')})\n`); return 2; }
  let code = 1;
  try { code = await fn(repo, p, io, now); }
  catch (e) { if (e.code && e.exit) { stderr.write(`${e.message}\n`); code = e.exit; } else { stderr.write(`INTERNAL(${String(e.message).replace(/\n/g, ' ')})\n`); code = 1; } }
  finally { if (MUTATING.has(p.cmd) && !p.flags['dry-run'] && p.sub !== 'list' && p.sub !== 'show') { const s = bestEffortSync(repo, { env }); if (!s.synced && !['DELIVERY_NO_SYNC', 'plain-dir'].includes(s.reason)) stderr.write(`WARN sync: ${s.reason}\n`); } }
  return code;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c));
