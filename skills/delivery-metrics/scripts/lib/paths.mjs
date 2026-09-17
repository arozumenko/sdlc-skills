// STDLIB ONLY. Paths, identity, errors and the advisory lock for the delivery ledger (spec §6.1, D3, D21).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';

// Memoized per process (keyed by the resolved candidate path) so repeated calls in the
// same run don't each spawn `git`. Non-git temp dirs pass through unchanged, and that
// result is memoized too — it's still just `resolve(repo)`, so it stays correct even if
// the directory later becomes a git repo within the same process.
const ownerCache = new Map();
export function resolveOwnerRepo(repo) {
  const candidate = resolve(repo);
  if (ownerCache.has(candidate)) return ownerCache.get(candidate);
  const g = (...args) => { try { return execFileSync('git', ['-C', candidate, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  const top = g('rev-parse', '--show-toplevel')?.trim();
  if (!top) { ownerCache.set(candidate, candidate); return candidate; }
  // Git lists the main checkout first, even with --separate-git-dir; never guess from path spelling.
  const listing = g('worktree', 'list', '--porcelain', '-z');
  const first = listing?.split('\0').find((v) => v.startsWith('worktree '))?.slice(9);
  if (!first || !isAbsolute(first)) throw cliError('USAGE', 'cannot resolve telemetry owner from git worktree list');
  const owner = resolve(first);
  ownerCache.set(candidate, owner);
  return owner;
}
export const ownerRepo = (payload = {}, env = {}) => resolveOwnerRepo(payload.cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());

export const deliveryDir = (repo) => join(resolveOwnerRepo(repo), '.agents', 'telemetry', 'delivery');
export const plansDir = (repo) => join(deliveryDir(repo), 'plans');
export const sessionsDir = (repo) => join(deliveryDir(repo), 'sessions');
export const profilePath = (repo) => join(deliveryDir(repo), 'profile.json');

/** Reversible; only `%`, `/` and `:` are encoded so ids stay readable in `ls`. */
export const encodeSegment = (s) => String(s).replace(/%/g, '%25').replace(/\//g, '%2F').replace(/:/g, '%3A');
export const decodeSegment = (s) => String(s).replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%25/g, '%');
export const runPath = (repo, runId) => join(plansDir(repo), `${encodeSegment(runId)}.json`);
export const eventsPath = (repo, slug) => join(deliveryDir(repo), `events-${slug}.jsonl`);
export const sessionPath = (repo, host, session) => join(sessionsDir(repo), `${encodeSegment(`${host}:${session}`)}.json`);

export const nowIso = (now = Date.now()) => new Date(now).toISOString();
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const EXIT = { USAGE: 2, 'SCHEMA-INVALID': 2, 'ID-CONFLICT': 2, 'INVALID-TRANSITION': 2, 'AMBIGUOUS-PLAN': 2, 'MIGRATION-REQUIRED': 2, 'LOCK-BUSY': 2, CONFLICT: 2, 'NO-PLAN': 3, 'NO-EVENTS': 3 };
export function cliError(code, detail) {
  const e = new Error(`${code}(${String(detail).replace(/\s*\n\s*/g, ' ')})`);
  e.code = code; e.exit = EXIT[code] ?? 1; return e;
}

/** Same identity rule as tokenomics: git user.name, else OS user, else email local-part; slugged. */
export function whoAmI(repo) {
  const git = (key) => { try { return execFileSync('git', ['-C', repo, 'config', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };
  const email = git('user.email');
  const name = git('user.name') || userInfo().username;
  const base = name || (email ? email.split('@')[0] : null);
  const slug = String(base ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return { name, email, slug };
}

/** Advisory mkdir lock, 60 s stale rule. Serialises only this skill's own writes; no cross-process promise (spec §6.1). */
export function withLock(repo, fn, { staleMs = 60000, now = Date.now() } = {}) {
  const dir = join(deliveryDir(repo), '.lock');
  mkdirSync(deliveryDir(repo), { recursive: true });
  try { mkdirSync(dir); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = 0; try { age = now - statSync(dir).mtimeMs; } catch { age = staleMs + 1; }
    if (age <= staleMs) throw cliError('LOCK-BUSY', `another delivery-metrics write holds ${dir} (advisory; stale after ${staleMs / 1000}s)`);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
  }
  try { return fn(); } finally { rmSync(dir, { recursive: true, force: true }); }
}
