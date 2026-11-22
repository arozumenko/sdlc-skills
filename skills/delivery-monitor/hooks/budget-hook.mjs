#!/usr/bin/env node
// Synchronous Claude PreToolUse: pre-dispatch and subagent tool calls. No decision on any unavailable input.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The hook is wired with matcher `*`: it starts for every tool call of every session. Only an Agent/Task dispatch and a
// subagent's own calls can concern a budget, so the engine (the dispatch hook and scripts/lib) is loaded after that is known.
// Run as the hook, the entry reads the payload first and loads the engine only for such a call. Imported as a module, the
// engine is loaded at once, so `handleBudget` is ready and synchronous for its caller.
let bindByBranch, diagnose, findChildTranscript, resolveRefs, sessionRun, rosterOf, budgetedItem, budgetInputs, canonicalBudgetItem, recordBudget,
  deliveryDir, ownerRepo, sha256, whoAmI, nowIso, taskCosts, taskKey, liveTaskCost, priorTaskCost, incrementalUsage;
async function loadEngine() {
  ({ bindByBranch, diagnose, findChildTranscript, resolveRefs, sessionRun, rosterOf } = await import('./dispatch-hook.mjs'));
  ({ budgetedItem, budgetInputs, canonicalBudgetItem, recordBudget } = await import('../scripts/lib/budget.mjs'));
  ({ deliveryDir, ownerRepo, sha256, whoAmI, nowIso } = await import('../scripts/lib/paths.mjs'));
  ({ taskCosts, taskKey, liveTaskCost, priorTaskCost } = await import('../scripts/lib/task-costs.mjs'));
  ({ incrementalUsage } = await import('../scripts/lib/transcript-usage.mjs'));
}
/** The fast guard, from the payload alone: an Agent/Task dispatch or a subagent's call, on Claude, with a session. */
const concernsBudget = (payload) => Boolean((payload?.agent_id || ['Agent', 'Task'].includes(payload?.tool_name)) && (!payload.host || payload.host === 'claude') && payload.session_id);

const decision = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
export function handleBudget(payload, { repo, now = Date.now() } = {}) {
  // This guard precedes owner resolution, filesystem reads and user lookup.
  if (!concernsBudget(payload)) return {};
  let slug;
  try {
    repo ??= ownerRepo(payload, process.env); slug = whoAmI(repo).slug;
    const inputs = budgetInputs(repo), { runs, profile, prices } = inputs;
    if (!runs.some(r => r.status === 'open')) return {};
    const run = sessionRun(repo, 'claude', payload.session_id) ?? bindByBranch(repo, payload, now, slug);
    if (!run) return {};
    let item, dispatchKey, cost, state = null, cache = null;
    if (payload.agent_id) {
      dispatchKey = `claude:${payload.session_id}:${payload.agent_id}`;
      cache = join(deliveryDir(repo), `.pending-budget-${sha256(dispatchKey)}.json`);
      try { state = JSON.parse(readFileSync(cache, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const child = findChildTranscript(payload);
      if (!child) throw new Error('child transcript unavailable');
      if (!state) {
        const meta = JSON.parse(readFileSync(child.metaPath, 'utf8'));
        if (typeof meta.toolUseId !== 'string' || !meta.toolUseId) throw new Error('dispatch metadata toolUseId unavailable');
        const role = meta.agentType ?? payload.agent_type;
        if (role && !rosterOf(run).has(role)) return {};
        const live = incrementalUsage(child.path);
        const match = resolveRefs(run, { description: meta.description ?? '', firstUserText: live.cursor.firstUserText, role });
        item = match.items.length === 1 && match.how !== 'role' ? match.items[0] : null;
        if (!budgetedItem(item)) return {};
        state = { v: 1, dispatchKey, toolUseId: meta.toolUseId, run: run.run, item_id: item.item_id, computed_at: nowIso(now),
          prior: priorTaskCost(taskCosts(repo, { resolved: inputs.resolved }), run, item, dispatchKey), cursor: live.cursor, stopped: false };
        cost = liveTaskCost(state.prior, live.usage, prices);
      } else {
        if (state.v !== 1 || state.dispatchKey !== dispatchKey || state.run !== run.run) throw new Error('invalid budget cache');
        item = run.items.find(i => i.item_id === canonicalBudgetItem(run, state.item_id));
        if (!budgetedItem(item)) return {};
        const live = incrementalUsage(child.path, state.cursor); state.cursor = live.cursor;
        cost = liveTaskCost(state.prior, live.usage, prices);
      }
    } else {
      const input = payload.tool_input ?? {}, role = input.subagent_type;
      if (role && !rosterOf(run).has(role)) return {};
      const match = resolveRefs(run, { description: input.description ?? '', firstUserText: input.prompt ?? '', role });
      item = match.items.length === 1 && match.how !== 'role' ? match.items[0] : null;
      if (!budgetedItem(item)) return {};
      dispatchKey = `claude:${payload.session_id}:${payload.tool_use_id ?? 'pre-dispatch'}`;
      cost = taskCosts(repo, { resolved: inputs.resolved }).tasks.get(taskKey(run.run, item.item_id))?.cost_usd ?? 0;
    }
    if (!Number.isFinite(cost) || cost < 0) throw new Error('invalid task cost');
    const result = recordBudget(repo, { run, item, cost, dispatchKey, source: state ? 'in-run' : 'pre-dispatch', profile, session: payload.session_id, agentId: payload.agent_id, now });
    if (state) {
      state.stopped ||= result.stopped; state.reason ??= result.stopped ? result.reason : null;
      writeFileSync(cache, JSON.stringify(state));
    }
    if (result.stopped || state?.stopped) return decision(state?.reason ?? result.reason);
    if (state && ['Agent', 'Task'].includes(payload.tool_name)) return handleBudget({ ...payload, agent_id: null, agent_type: null }, { repo, now });
    return {};
  } catch (e) {
    try { repo ??= ownerRepo(payload, process.env); slug ??= whoAmI(repo).slug; diagnose(repo, slug, 'budget-check-unavailable', payload, String(e.message), now); } catch { /* diagnostics are best effort */ }
    return {};
  }
}
/** The dispatch hook's `readStdinBounded`, repeated here: importing it would load the engine before the guard. */
function readStdinBounded(ms = 2000, max = 65536) {
  return new Promise((done) => {
    let buf = '', finished = false; const finish = () => { if (!finished) { finished = true; clearTimeout(timer); done(buf); } }; const timer = setTimeout(finish, ms);
    try { process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { buf += d; if (buf.length > max) { buf = buf.slice(0, max); finish(); return; } try { JSON.parse(buf); finish(); } catch { /* incomplete */ } }); process.stdin.on('end', finish); process.stdin.on('error', finish); } catch { finish(); }
  });
}
async function main() {
  try {
    const payload = JSON.parse(await readStdinBounded());
    if (!concernsBudget(payload)) return;
    await loadEngine();
    const result = handleBudget(payload); if (result.hookSpecificOutput) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch { /* malformed payload or an engine that cannot load: no decision */ }
}
const isEntry = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main().then(() => process.exit(0), () => process.exit(0));
else await loadEngine();
