// STDLIB ONLY. Best-effort telemetry sync (spec §6.1): never stages an unmerged tree, never resolves conflicts, retries once.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { gitState } from './git.mjs';
import { resolveOwnerRepo } from './paths.mjs';

export function bestEffortSync(repo, { env = process.env } = {}) {
  if (env.DELIVERY_NO_SYNC === '1') return { synced: false, reason: 'DELIVERY_NO_SYNC' };
  repo = resolveOwnerRepo(repo);
  const tel = join(repo, '.agents', 'telemetry');
  if (!existsSync(join(tel, '.git'))) return { synced: false, reason: 'plain-dir' };
  const g = (...a) => execFileSync('git', ['-C', tel, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  const state = gitState(tel);
  if (state.unmerged.length || state.merging) return { synced: false, reason: `unresolved merge in ${tel} — fix manually (delivery.mjs doctor)` };
  try {
    g('add', '-A');
    if (g('status', '--porcelain')) g('commit', '-q', '-m', `delivery-monitor: ${new Date().toISOString()}`);
    if (!g('remote')) return { synced: true, reason: 'no remote (local telemetry branch only)' };
    try { g('push', '-q'); return { synced: true }; } catch { /* rejected — integrate once */ }
    // Issue 4: fetch and merge fail for different reasons (network/remote down vs a real content
    // conflict) and must be reported distinctly — a fetch failure is not a merge conflict.
    try { g('fetch', '-q'); } catch { return { synced: false, reason: 'push rejected; fetch failed — retried next invocation' }; }
    try { g('merge', '--no-edit', '@{u}'); }
    catch {
      const conflict = gitState(tel).unmerged.length > 0;
      try { g('merge', '--abort'); } catch { /* nothing to abort */ }
      return { synced: false, reason: conflict ? 'push rejected; merge conflict — manual repair needed (delivery.mjs doctor)' : 'push rejected; merge failed — manual repair needed (delivery.mjs doctor)' };
    }
    try { g('push', '-q'); return { synced: true, reason: 'merged remote changes then pushed' }; }
    catch { return { synced: false, reason: 'push failed — retried next invocation' }; }
  } catch (e) { return { synced: false, reason: String(e.message).split('\n')[0] }; }
}
