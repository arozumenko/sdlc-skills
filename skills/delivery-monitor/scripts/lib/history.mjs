// STDLIB ONLY. Evidence log of session-binding and run-file writes (PR 2b). One line per write in
// history-<slug>.jsonl: the value on disk just before and the value written. Evidence, not truth: no lock,
// no ordering promise, and a history failure never changes what the caller's state write did.
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeSegment, deliveryDir, nowIso, plansDir, sessionPath, sessionsDir, whoAmI } from './paths.mjs';

export const historyPath = (repo, slug) => join(deliveryDir(repo), `history-${slug}.jsonl`);
export const sessionSummary = (o) => ({ plan: o.plan ?? null, at: o.at ?? null, ...(o.bound_by !== undefined ? { bound_by: o.bound_by } : {}) });
export const runSummary = (o) => ({ status: o.status ?? null, version: o.version ?? null, registered_at: o.registered_at ?? null, updated_at: o.updated_at ?? null, ...(o.backfill?.at !== undefined ? { backfill_at: o.backfill.at } : {}) });

/** The file as a plain JSON object, or { state: 'missing' | 'unreadable' }. Never throws. */
function readObject(path) {
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { state: e.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
  return value && typeof value === 'object' && !Array.isArray(value) ? { state: 'present', value } : { state: 'unreadable' };
}
export function readPrev(path, summarize) {
  try { const r = readObject(path); return r.state === 'present' ? { state: 'present', value: summarize(r.value) } : r; }
  catch { return { state: 'unreadable' }; }
}

export function appendHistory(path, record) {
  mkdirSync(join(path, '..'), { recursive: true });
  // Same rule as the dispatch store: keep a torn final line as its own line.
  let separator = '';
  try {
    const fd = openSync(path, 'r');
    try { const size = fstatSync(fd).size; if (size) { const byte = Buffer.alloc(1); readSync(fd, byte, 0, 1, size - 1); if (byte[0] !== 10) separator = '\n'; } }
    finally { closeSync(fd); }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  appendFileSync(path, `${separator}${JSON.stringify(record)}\n`);
}

/** Called after a successful state write. Any failure here goes to onHistoryError and nowhere else. */
export function logWrite(repo, { by, now, slug, onHistoryError }, kind, key, prev, next) {
  try { appendHistory(historyPath(repo, slug ?? whoAmI(repo).slug), { v: 'history.v1', kind, key, by, recorded_at: nowIso(now), prev, next }); }
  catch (e) { onHistoryError?.(String(e?.message ?? e).split('\n')[0]); }
}

export function writeBinding(repo, host, session, plan, now, { by, bound_by, slug, onHistoryError } = {}) {
  const path = sessionPath(repo, host, session), prev = by ? readPrev(path, sessionSummary) : null;
  const file = { host, session, plan, at: nowIso(now), ...(bound_by ? { bound_by } : {}) };
  mkdirSync(sessionsDir(repo), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file)}\n`);
  if (by) logWrite(repo, { by, now, slug, onHistoryError }, 'session', `${host}:${session}`, prev, sessionSummary(file));
}

/** `history snapshot`: one `by: snapshot` record (no prev) per readable session and run file, as they are now. */
export function snapshot(repo, { dryRun = false, now = Date.now(), slug, emit = () => {} } = {}) {
  const count = { sessions: 0, runs: 0, skipped: 0 };
  slug ??= whoAmI(repo).slug;
  for (const [kind, dir, summarize, tally] of [['session', sessionsDir(repo), sessionSummary, 'sessions'], ['run', plansDir(repo), runSummary, 'runs']]) {
    let names = []; try { names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; /* missing dir: zero */ }
    for (const name of names) {
      const key = decodeSegment(name.slice(0, -5)), r = readObject(join(dir, name));
      if (r.state !== 'present') { count.skipped++; emit(`SKIP ${kind} ${key} unreadable`); continue; }
      if (!dryRun) appendHistory(historyPath(repo, slug), { v: 'history.v1', kind, key, by: 'snapshot', recorded_at: nowIso(now), next: summarize(r.value) });
      count[tally]++; emit(`${dryRun ? 'WOULD-' : ''}SNAPSHOT ${kind} ${key}`);
    }
  }
  return count;
}
