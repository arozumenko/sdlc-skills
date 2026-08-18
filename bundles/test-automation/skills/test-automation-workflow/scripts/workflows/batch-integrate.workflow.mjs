// Batch-integrate workflow for the test-automation batch pipeline.
// Claude Code only — invoked by the orchestrator AFTER the build loop, BEFORE
// the hardening gate:
//   Workflow({ scriptPath: '<installed skill>/scripts/workflows/batch-integrate.workflow.mjs',
//              args: { slug, base, cases: [{id, branch}, …] } })
//
// Why this exists (production retrospective, 2026-07-21): integration fallout —
// merges, conflicts, rebase cascades — handled conversationally cost the lead
// 63 git commands, 90 conflict hits, and 3 pure-git-surgery dispatches in one
// session. This workflow moves the whole integrate step into ONE isolated
// agent with bounded, mechanical-only conflict resolution; the lead receives
// {merged, parked, conflict_files} and runs the gate. The gate itself NEVER
// moves in here.
//
// Hard rules encoded:
//   - NEVER delete or rm files to make a merge pass (the destructive-recovery
//     class that lost AFS files in the wild). A merge that needs deletion is
//     parked, not forced.
//   - Mechanical-union resolution ONLY (both-added imports/exports, additive
//     page-object members, independent spec files). Anything semantic — same
//     method edited both sides, assertion differences, fixture signature
//     drift — aborts that case's merge and parks it.
//   - It touches git ONLY. It writes no state anywhere: the parked cases and
//     their conflict files ride the return, and the caller puts them in the
//     run's report. There is no board and no clerk.
//
// batch-build runs this same integrator contract INLINE (one agent) — a child
// workflow() call there would break when batch-build itself runs as a campaign
// child (nesting is one level only). This standalone workflow exists for the
// lead's ad-hoc integrate jobs; keep its prompt's hard rules aligned with
// batch-build's inline copy.

export const meta = {
  name: 'ta-batch-integrate',
  description: 'Integrate approved case branches into the batch integration branch in the project checkout — mechanical-only conflict resolution, semantic conflicts parked; the lead runs the hardening gate on the result',
  whenToUse: 'Orchestrator (test-automation-lead) on Claude Code, after the build loop reports gate_ready cases — replaces conversational merge/conflict handling; the hardening gate and PR merges stay with the lead',
  phases: [
    { title: 'Integrate', detail: 'sequential merges on the integration branch, bounded resolution' },
  ],
}

// ---- args ------------------------------------------------------------------
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.slug || !A.base || !Array.isArray(A.cases) || A.cases.length === 0 || A.cases.some((c) => !c.id || !c.branch)) {
  throw new Error(
    'args required: { slug, base (e.g. "origin/main" or the seeded automation base), ' +
    'cases: [{id, branch}, …] (caller order), integrationBranch?, root?, integratorModel?, integratorAgent? }'
  )
}
const SLUG = A.slug
const BASE = A.base
const CASES = A.cases
const IB = A.integrationBranch ?? `tests/batch-${SLUG}`
// No default literal: with no arg, the integrator's installed AGENT.md
// frontmatter `model:` governs (agentType resolves like the Agent tool).
const INTEGRATOR_MODEL = A.integratorModel ?? null
// The integrator does REAL work in the repository — it resolves merges in the
// project's own tree — so it must be one of the bundle's agents, not an
// anonymous dispatch. An `agent()` call without `agentType` arrives at the
// SubagentStart hook as `workflow-subagent`, resolves to no role, and gets NO
// role memory or project briefing: it would merge this project's code knowing
// nothing about its conventions. (Clerical dispatches can be anonymous without
// harm; anything touching the tree cannot.)
const INTEGRATOR_TYPE = A.integratorAgent ?? 'test-automation-engineer'

// ---- Phase 1: one integrator, in the project's own checkout ----------------
// No worktree anywhere in this pipeline: isolation is branches, safety is
// order. Integration runs after the build loop, so nothing else writes the tree
// — the integrator checks out the integration branch, merges the case branches
// into it, and leaves the tree there. (It never runs the suite, so it would not
// even benefit from a separate tree: it has no env or dependencies to provision.)
phase('Integrate')
const INTEGRATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['integration_branch', 'head_sha', 'merged', 'parked', 'notes'],
  properties: {
    integration_branch: { type: 'string' },
    head_sha: { type: 'string' },
    merged: { type: 'array', items: { type: 'string' } },
    parked: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'conflict_files', 'reason'],
        properties: {
          id: { type: 'string' },
          conflict_files: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

// Stall-retry exhaustion THROWS out of agent() instead of returning null
// (measured 2026-08-17, quota-throttled Bedrock) — catch it so the failure is
// the designed one below, with the stall named as an ENVIRONMENT fact.
let result = null
try {
result = await agent(
  'You are the batch integrator, working in the project\'s OWN checkout — no worktree is created for you and you must not create one. Nothing else writes this tree while you run (integration follows the build loop), so the branch you check out IS your isolation. Leave the tree on the integration branch when you finish. ' +
  `Build the integration branch for batch ${SLUG}:\n` +
  `1. git fetch origin --quiet, then check the batch trunk out: \`git checkout ${IB}\` (it was created and pushed by the first build of this batch). Only if it genuinely does not exist anywhere: \`git checkout -B ${IB} ${BASE} && git push -u origin ${IB}\`. Do NOT use -B on an existing trunk — that would discard the case work already merged into it.\n` +
  `2. SWEEP THE LEFTOVER AFS FIRST. Analysts write their AFS to disk and never commit (they run in parallel with a build that owns this tree). Each implementer commits its own unit's AFS, so what remains uncommitted belongs to cases that never reached a build — blocked, already-covered, out-of-scope. Stage every remaining file under the project's test-specs/ convention BY PATH (\`git status --porcelain\` to find them; never \`git add -A\`) and commit them here with message \"docs(afs): analysis not carried by a build\". Two reasons this is not optional: that analysis is otherwise lost, and the hardening gate REFUSES to run on a dirty tree — leftovers would fail the gate for a reason that has nothing to do with the tests.\n` +
  `3. Merge each case branch IN THIS ORDER with git merge --no-ff <branch> -m "merge <ID> into ${IB}":\n` +
  CASES.map((c) => `   - ${c.id}: ${c.branch}`).join('\n') + '\n' +
  'On a merge conflict, classify EVERY conflicted file before touching anything:\n' +
  '- MECHANICAL (you may resolve, by union/addition only): both sides added distinct imports/exports; both sides added distinct methods/locators to a page object or fixture; both sides added independent files or independent spec blocks. Resolve by keeping BOTH sides, stage, and conclude the merge.\n' +
  '- SEMANTIC (never resolve): the same function/method/locator edited on both sides, assertion or expected-value differences, fixture/signature drift, or any conflict you cannot resolve as a pure union. Run git merge --abort, record the case as parked with the conflict files and a one-line reason, and CONTINUE with the next case branch.\n' +
  'HARD RULES: never delete, rm, or checkout --ours/--theirs away a file to make a merge pass; never edit test logic, assertions, or expected values during resolution; never write state anywhere — your return IS the record; never run the test suite (a separate gate agent does that). ' +
  // The gate checks out `origin/<branch>` (gate-case.mjs), so the branch has to
  // BE on origin. Pushing it is the integrator's job because the integrator is
  // what creates it — leaving it local made the gate push it itself, which is a
  // write its own contract ("you PROVE it") does not sanction, and it only
  // worked because that agent reasoned it out. An unpushed branch would
  // otherwise fail the gate for an infrastructure reason and read as a red case.
  `4. Push the merges: git push origin ${IB}. The gate checks out origin/${IB}, so anything unpushed is invisible to it. If the push fails (no remote, no permission), say so in notes — the gate cannot run without it.\n` +
  'Finish with git rev-parse HEAD. Return the integration branch, head sha, merged case ids (order preserved), parked cases, and one-line notes.',
  { label: `integrate:${SLUG}`, phase: 'Integrate', agentType: INTEGRATOR_TYPE, ...(INTEGRATOR_MODEL ? { model: INTEGRATOR_MODEL } : {}), schema: INTEGRATE_SCHEMA }
)
} catch (e) {
  log(`integrator ${/stall/i.test(String(e?.message ?? e)) ? 'infra-stalled (environment — fix the provider before retrying)' : 'threw'}: ${String(e?.message ?? e).slice(0, 120)}`)
}
if (!result) throw new Error('integrator agent failed — nothing merged; re-run or integrate conversationally')
log(`integrated ${result.merged.length}/${CASES.length} — parked: ${result.parked.map((p) => p.id).join(', ') || 'none'}`)

return {
  slug: SLUG,
  integration_branch: result.integration_branch,
  head_sha: result.head_sha,
  merged: result.merged,
  parked: result.parked.map((p) => ({ id: p.id, why: `${p.reason} (${p.conflict_files.slice(0, 4).join(', ')})` })),
  notes: result.notes,
  next: `Gate ${result.integration_branch} (N consecutive green). Parked cases resolve their conflicts on their own case branches, then re-enter integration.`,
}
