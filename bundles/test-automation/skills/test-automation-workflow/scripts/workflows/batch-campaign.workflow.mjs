// Campaign conductor for the test-automation batch pipeline (Claude Code).
// Runs a multi-wave campaign per references/campaign-planning.md by invoking
// the shipped build workflow as a CHILD per wave (workflow() nesting) — that
// child integrates and gates internally and returns ONE report per wave.
//
// The orchestrator's context stays LEAN by design: the lead never reads case
// bodies (a dispatched PLANNER reads the intake snapshots and proposes the
// plan), never sees analysis payloads or diffs (children summarize), and
// receives only compact returns at three checkpoints:
//   1. Plan proposal   — early return; lead reviews the PLAN, not the cases.
//   2. Foundation      — conductor builds, reviews, AND mini-gates it
//                        (smoke × N green); early return for the lead to
//                        merge foundation to base and re-invoke.
//   3. Rolling waves   — each wave is ONE build child, which integrates and
//                        gates internally and returns ONE report. The conductor
//                        collects those reports and rolls on; it never gates,
//                        never merges PRs, never mirrors.
// A failed wave (child throws) is recorded whole and the campaign continues.
//
// No board: a wave's report IS its state (batch-build § WHY NO BOARD). Waves
// share one case-snapshot directory (.agents/automation/<batch>/cases/) and one
// campaign card; each wave integrates onto its own branch (tests/batch-<slug>).
//
// Invocations (lead):
//   propose:  { propose: { campaign, batch, base, cases: [{id,title?},…], waveSize?, policy? } }
//   run:      { plan, foundationMerged?, headsAnalyzed? }   // plan from the approved proposal

export const meta = {
  name: 'ta-batch-campaign',
  description: 'Campaign conductor: dispatched planner proposes the plan from intake snapshots (lead reviews the plan, never case bodies); then heads analysis → foundation (early-return for the lead mini-gate) → waves, each ONE build child that integrates and gates itself and returns one report',
  whenToUse: 'Orchestrator (test-automation-lead) on Claude Code for backlogs ≳ 2× wave size, after Intake per campaign-planning.md; single flat batches use batch-build directly',
  phases: [
    { title: 'Plan', detail: 'planner reads snapshots, proposes waves/clusters/foundation — early return for the operator checkpoint' },
    { title: 'Heads', detail: 'breadth-first heads analyzed (analyzeOnly child) to source the foundation inventory' },
    { title: 'Foundation', detail: 'page objects/fixtures + smoke spec, statically reviewed; lands the heads output — early return after the mini-gate for the lead to merge' },
    { title: 'Mini-gate', detail: 'smoke spec × N consecutive green plus the existing suite green once — proves the foundation before waves build on it' },
    { title: 'Waves', detail: 'one build child per wave — it integrates and gates internally and returns one report' },
  ],
}

// ---- args ------------------------------------------------------------------
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const plan = typeof A.plan === 'string' ? JSON.parse(A.plan) : A.plan
const WF_DIR = '.claude/skills/test-automation-workflow/scripts/workflows'
const BUILD = A.buildScriptPath ?? `${WF_DIR}/batch-build.workflow.mjs`
const ROOT = A.root
const SRC = (batch, id) => `${ROOT ? `${ROOT}/` : ''}.agents/automation/${batch}/cases/${id}.md`

// Foundation loop knobs. FIX_ROUNDS is a RUNAWAY BACKSTOP, not a quality
// budget: the loop is meant to run until the reviewer approves, and what ends
// it early is the reviewer reporting that the remaining blockers cannot be
// moved by another round (loopVerdict). GATE_N matches the batch gate's
// N-consecutive-green contract.
const FIX_ROUNDS = A.fixRounds ?? 8
const GATE_N = A.gateN ?? 3

// Field lesson, 2026-07-30 — and this workflow is where it happened. The
// foundation implementer backgrounded the full suite, wrote "I'll wait for this
// full-suite run to complete", and ended its turn. Nothing woke it: twelve
// minutes later the output file was empty, this conductor still held a
// `pending` entry, nothing had errored, and a human had to notice and dispatch
// a rescue to finish a branch that was nearly done. Every long-running slot
// here gets the rule — the mini-gate most of all, since running the suite N
// consecutive times is its entire contract.
// FOREIGN TEXT GOES THROUGH HERE — reviewer blocking items are written by
// another agent and land inside a prompt that IS instructions. Clamp them so
// one verbose review cannot crowd out the contract, and defuse the markers that
// would let a finding read as prompt structure. (Same helper as batch-build's;
// the sandbox has no imports, so the copies must agree.)
const quote = (s, max = 400) => String(s ?? '')
  .replace(/```+/g, "'''")
  .replace(/^\s{0,3}#{1,6}\s+/gm, '')
  .trim()
  .slice(0, max)

// Kept in step with batch-build.workflow.mjs's FOREGROUND_RULE — same measured
// facts (28ms enforcement on a turn end; blocking sleep works; 600s call cap).
const FOREGROUND_RULE =
  'LONG JOBS — test suites especially. A foreground call is killed at its `timeout` ' +
  '(default 120s, MAXIMUM 600000ms), so ALWAYS pass timeout: 600000 on a suite run, ' +
  'and let the call block when the job fits inside it. ' +
  'When the job does NOT fit in one call: launch it detached, writing its output to a file, ' +
  'then WAIT with blocking foreground polls — `sleep 300; <check the output file>`, each with ' +
  'timeout: 600000 — until it is done. Sleeping in the foreground is legal and cheap: it is ONE turn ' +
  'however long you sleep. ' +
  'NEVER end a turn while a job is running — nothing will wake you (measured: you are forced to ' +
  'report 28ms later, before the job finishes, and neither run_in_background nor Monitor beats that), ' +
  'this workflow blocks on your return, and your silence is indistinguishable from thinking. ' +
  'NEVER poll at second-level intervals either — you pay a full context per turn, and a busy-wait ' +
  'exhausts your turn budget and gets you cut off mid-job. ' +
  'If a job is too long even for sleep-polling, say so and run the narrower selection you actually need. '

/**
 * Should the fix loop go round again? Duplicated from batch-build.workflow.mjs
 * on purpose — workflow scripts run in a sandbox with no module access, so a
 * shared import is not available. The two copies must agree; both are pinned by
 * their own tests.
 *
 * Keep going while ANY blocking item is `unaddressed` — work nobody attempted
 * is not a reason to stop, it is the reason to continue. Stop only when every
 * remaining blocker is one the same actor cannot move: attempted and still
 * failing (`persists`), or not resolvable on this branch (`external`).
 */
function loopVerdict(review) {
  const detail = review?.blocking_detail ?? []
  // Unclassified: go again (the bias belongs on finishing the work) but flag it,
  // so a reviewer that never classifies cannot silently burn the whole backstop.
  if (!detail.length) return { go: true, why: null, unclassified: true }
  const unaddressed = detail.filter((d) => d.status === 'unaddressed')
  if (unaddressed.length) return { go: true, why: null, unaddressed: unaddressed.map((d) => d.item) }
  const external = detail.filter((d) => d.status === 'external').map((d) => d.item)
  const persists = detail.filter((d) => d.status === 'persists').map((d) => d.item)
  // `stuck` powers batch-build's unit SPLIT. The foundation is one indivisible
  // unit, so this caller ignores it — but the contract copies must be identical.
  const scoped = detail.every((d) => Array.isArray(d.case_ids) && d.case_ids.length > 0)
  return {
    go: false,
    stuck: scoped ? [...new Set(detail.flatMap((d) => d.case_ids))] : null,
    why: external.length
      ? `not resolvable on this branch: ${external.join('; ').slice(0, 160)}`
      : `attempted and still failing: ${persists.join('; ').slice(0, 160)}`,
  }
}

// ---- Phase 0: Plan proposal (dispatched planner — the lead never reads cases)
phase('Plan')
if (!plan) {
  const P = A.propose
  if (!P || !P.campaign || !P.batch || !P.base || !Array.isArray(P.cases) || P.cases.length === 0) {
    throw new Error('args required: either { plan } or { propose: { campaign, batch, base, cases: [{id, title?}, …], waveSize?, policy? } }')
  }
  const PLAN_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['campaign', 'batch', 'base', 'heads', 'foundation', 'waves', 'policy', 'rationale'],
    properties: {
      campaign: { type: 'string' },
      batch: { type: 'string' },
      base: { type: 'string' },
      heads: { type: 'array', items: { type: 'string' } },
      // `evidence` is required alongside `surfaces`: the planner must state
      // what it actually LISTED, not what it assumed. Field lesson — one
      // planner returned foundation:null for four surfaces holding zero page
      // objects and zero test dirs, caught only because the lead ran `ls`
      // before approving. An unevidenced null sends every implementer in the
      // wave off to build the same missing foundation independently.
      foundation: {
        type: ['object', 'null'], additionalProperties: false,
        required: ['surfaces', 'evidence'],
        properties: {
          surfaces: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
          branch: { type: 'string' },
        },
      },
      // Declared goal + the command that measures it, so every wave gate can
      // re-measure instead of the campaign running blind to its own target.
      goal: {
        type: ['object', 'null'], additionalProperties: false,
        required: ['metric', 'command', 'baseline'],
        properties: {
          metric: { type: 'string' },
          command: { type: 'string' },
          baseline: { type: 'string' },
        },
      },
      waves: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['slug', 'caseIds'],
          properties: {
            slug: { type: 'string' },
            caseIds: { type: 'array', items: { type: 'string' } },
            clusters: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
      policy: { type: 'object' },
      extendCandidates: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
    },
  }
  const proposed = await agent(
    'You are the campaign PLANNER (campaign-planning.md — read it via the test-automation-workflow skill references). ' +
    `Campaign "${P.campaign}", batch "${P.batch}", base "${P.base}", wave size ~${P.waveSize ?? 5}. ` +
    `Read EVERY case snapshot from disk (do not fetch any TMS): ${P.cases.map((c) => SRC(P.batch, c.id)).join(' , ')}. ` +
    'Then propose the plan:\n' +
    '- Group cases by surface (page/component family) and flow similarity.\n' +
    '- clusters: packs of ≤5 same-surface FLOW-VARIANT cases suited to one analyst session + one parameterized family spec. Conservative — when in doubt, solo.\n' +
    '- heads: one representative case per surface, breadth-first (they are analyzed first and feed the foundation inventory).\n' +
    '- foundation: surfaces needing shared grounding (page objects/fixtures) before waves — null when the surfaces are already foundation-rich in the repo. ' +
    'CHECK, DO NOT ASSUME: actually list the page-object directory and the test directories for every surface you touch, and put what you saw in `evidence` (a claim of "foundation-rich" without a directory listing is a guess, and the lead will reject the plan). ' +
    'Then read the other campaign cards (.agents/automation/campaigns/*.md) and do NOT claim a foundation surface another live campaign already claims — two campaigns building the same surface is two incompatible foundations racing to merge; say so in the rationale and leave those surfaces to the campaign that owns them.\n' +
    '- goal: if the campaign has a numeric target, give the metric, the exact command that measures it, and the current baseline — it gets re-measured at every wave gate. null when there is no numeric goal.\n' +
    '- extendCandidates: case ids whose snapshot suggests existing MERGED coverage likely makes them extend-existing/already-covered — your independent pre-mark for the extend cross-check (empty array when none; do not tell the analysts).\n' +
    '- waves: ordered subsets of ~waveSize cases (heads in wave 1); every case id appears in exactly one wave.\n' +
    `- policy: carry over ${JSON.stringify(P.policy ?? {})} plus any per-stage model suggestions.\n` +
    'Return rationale as ONE compact paragraph the operator will read — the operator sees your plan, never the case bodies, so the rationale must carry the why.',
    { label: `planner:${P.campaign}`, phase: 'Plan', agentType: 'test-automation-lead', model: 'sonnet', schema: PLAN_SCHEMA }
  )
  if (!proposed) throw new Error('planner agent failed — re-invoke or plan conversationally')
  return {
    stage: 'plan-proposal',
    plan: proposed,
    next: 'Lead: show the operator the plan (one AskUserQuestion — waves/clusters/foundation + rationale), adjust if asked, then re-invoke this workflow with { plan: <approved plan> }.',
  }
}

// ---- validated plan present ------------------------------------------------
if (!plan.campaign || !plan.batch || !plan.base || !Array.isArray(plan.waves) || plan.waves.length === 0) {
  throw new Error('plan malformed: { campaign, batch, base, heads?, foundation|null, waves: [{slug, caseIds, clusters?}, …], policy? } required')
}
const POLICY = plan.policy ?? {}
const F = plan.foundation ?? null
const policyArgs = ['workerModel', 'workerEffort', 'reviewerModel', 'extendImplementerModel', 'agentTypes', 'reviewPanel', 'breakerThreshold', 'budgetReserve', 'fixRounds', 'gateN', 'gateCmd', 'extendRateThreshold']
  .reduce((o, k) => (POLICY[k] != null ? { ...o, [k]: POLICY[k] } : o), {})
const common = { ...(ROOT ? { root: ROOT } : {}) }

// ---- Phase 1+2: Heads analysis → Foundation (skip when no foundation) ------
let headsAnalyzed = Array.isArray(A.headsAnalyzed) ? A.headsAnalyzed : []
if (F && A.foundationMerged !== true) {
  phase('Heads')
  if (!headsAnalyzed.length && Array.isArray(plan.heads) && plan.heads.length) {
    const headsRun = await workflow({ scriptPath: BUILD }, {
      slug: plan.batch,
      base: plan.base,                          // batch-build requires it even for analyzeOnly
      cases: plan.heads.map((id) => ({ id })),
      analyzeOnly: true,
      // Own report location: waves share the batch slug (and its snapshot
      // dir) — without this the heads report and every wave's report would
      // overwrite one another at .agents/automation/<batch>/report.json.
      reportDir: `.agents/automation/${plan.batch}/heads`,
      ...policyArgs,
      ...common,
    })
    headsAnalyzed = headsRun?.analyzed ?? []
    log(`heads analyzed: ${headsAnalyzed.map((h) => h.id).join(', ') || 'none'}`)
  }

  phase('Foundation')
  const inventory = [...new Set(headsAnalyzed.map((h) => h.afs_path).filter(Boolean))]
  const FOUNDATION_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['status', 'branch', 'pr', 'smoke_spec', 'notes'],
    properties: {
      status: { type: 'string', enum: ['ready-for-mini-gate', 'blocked'] },
      branch: { type: 'string' },
      pr: { type: ['integer', 'null'] },
      smoke_spec: { type: 'string' },
      notes: { type: 'string' },
    },
  }
  // Mirrors the build workflow's reviewer contract, including the per-item
  // classification that drives the fix loop — see loopVerdict below.
  const REVIEW_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['verdict', 'findings', 'blocking', 'notes'],
    properties: {
      verdict: { type: 'string', enum: ['APPROVED', 'CHANGES_REQUESTED'] },
      blocking: { type: 'array', items: { type: 'string' } },
      findings: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
      blocking_detail: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['item', 'status'],
          properties: {
            item: { type: 'string' },
            status: { type: 'string', enum: ['unaddressed', 'persists', 'external'] },
            // Accepted for contract parity with batch-build (the reviewer
            // contract says to scope blockers); the foundation is one
            // indivisible unit, so nothing here consumes it.
            case_ids: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }
  const GATE_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['verdict', 'runs', 'failures', 'notes'],
    properties: {
      verdict: { type: 'string', enum: ['green', 'red', 'not-run'] },
      runs: { type: 'integer' },
      seconds: { type: 'array', items: { type: 'number' } },
      // Same failure shape as the batch gate and batch-stabilize, so a red
      // mini-gate's failures can feed batch-stabilize without translation.
      failures: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['spec', 'signature'],
          properties: {
            spec: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
      notes: { type: 'string' },
    },
  }
  const fBranch = F.branch ?? `tests/foundation-${plan.campaign}`
  const built = await agent(
    'You are the implementer building the FOUNDATION pass for a campaign (campaign-planning.md § The stages). ' +
    'You are the ONLY writer in the project\'s one working tree for this stage — nothing else builds while you run. Work on your own branch, stage only your own paths (`git add <paths>`, never `-A`), and leave the tree on that branch. ' +
    // A resumed or retried run arrives at a branch that may already carry most
    // of the work. Deciding what to do with it is JUDGEMENT — read the diff,
    // is it coherent? — so it belongs to you, not to a scripted git check.
    // Field lesson, 2026-07-30: when the first foundation attempt died
    // mid-verification, the rescue implementer read the uncommitted diff,
    // called it "a genuine, coherent in-progress fix", finished it, and was
    // right. Restarting from scratch would have thrown away a built branch.
    `FIRST, look before you build: if ${fBranch} already exists, check it out and read what is on it — \`git log ${plan.base}..${fBranch}\` and \`git status\`. Judge it: coherent work in progress → CONTINUE it (finish, commit, and say in notes what you inherited and what you added); incoherent or contradicting the AFS inventory below → say so in notes and rebuild the parts that are wrong. Do NOT silently start over on a branch that already has work, and do NOT assume it is complete because it exists. If it does not exist, create it from ${plan.base}. ` +
    `Build the shared grounding for surfaces [${(F.surfaces ?? []).join(', ')}]: page objects / fixtures / data helpers whose scope is EXACTLY the union of handles demanded by these AFS files (nothing speculative): ${inventory.join(' , ') || '(no head AFS — derive from existing test-specs/ for the named surfaces)'}. ` +
    'THE HEADS PASS LEFT ITS OUTPUT UNCOMMITTED IN THIS TREE — by design, and YOU are the designated lander: stage the heads AFS files, the `_surface.md` digests, and any `.agents/memory/` entries the heads analysts wrote — BY EXACT PATH, never `-A` — and commit them on your foundation branch alongside your own work. They are campaign deliverables AND gate hygiene: left untracked they make the mini-gate and every wave gate refuse a dirty tree. Never stash or clean them. ' +
    // The full suite belongs to the mini-gate, not here. Field lesson,
    // 2026-07-30: this slot was told to run it, backgrounded it, and died —
    // AFTER its real work was built and committed. Every valuable thing it
    // produced was already on the branch; the step that killed it was one it
    // should never have owned. The case implementer states the rule the
    // foundation was breaking: "green ONCE locally — determinism is the gate's
    // job, not repeated local runs."
    'Also write ONE smoke spec exercising the new page objects end-to-end (tag it as the surface\'s standing smoke — it stays). Run the smoke green ONCE locally, commit, open the PR — do NOT run the whole suite, the mini-gate does that and it is not your job. ' +
    FOREGROUND_RULE +
    'No TMS/reporter/analytics wiring (scaffold-minimal rule). Return status ready-for-mini-gate with branch, pr, smoke_spec path — or blocked with notes.',
    { label: `foundation:${plan.campaign}`, phase: 'Foundation', agentType: 'test-automation-engineer', ...(POLICY.workerModel ? { model: POLICY.workerModel } : {}), schema: FOUNDATION_SCHEMA }
  )
  if (!built || built.status !== 'ready-for-mini-gate') {
    return { stage: 'foundation', status: 'blocked', detail: built?.notes ?? 'foundation implementer failed', heads_analyzed: headsAnalyzed, next: 'Unblock the foundation (or set plan.foundation=null) and re-invoke with { plan, headsAnalyzed }.' }
  }
  const reviewFoundation = (fixNote) => agent(
    `STATIC review of the foundation branch ${built.branch} (PR ${built.pr ?? 'n/a'}) per references/reviewer-contract.md — page objects/fixtures + one smoke spec, no case coverage to triangulate: judge structure, naming vs .agents/testing.md conventions, no defect masking in the smoke, scaffold-minimal (no unsolicited integrations). Read the diff via git diff ${plan.base}...${built.branch}; do NOT execute anything. ` +
    'blocking[] is what must change before this can land; anything else worth saying goes in findings[]. ' +
    (fixNote
      ? `\n\nThis is the re-review after a fix round. Prior blocking findings:\n${fixNote}\n` +
        'For EVERY item you still block on, put an entry in blocking_detail[] with the status that is TRUE OF THE DIFF:\n' +
        '  - `unaddressed` — no serious attempt against it is visible; nothing in the diff touches the code it names, or the change is cosmetic. Forgotten and half-done both count here.\n' +
        '  - `persists` — a genuine attempt was made against the right code and the problem remains. Say in notes what was tried.\n' +
        '  - `external` — not resolvable on this branch at all (a missing framework primitive, a product defect, a broken environment).\n' +
        '`unaddressed` sends it back for another round, which is correct — do not use `persists` to end a loop you are tired of. A NEW item you are raising for the first time needs no status.\n'
      : ''),
    { label: `review:foundation${fixNote ? ':re' : ''}`, phase: 'Foundation', agentType: 'qa-engineer', ...(POLICY.reviewerModel ? { model: POLICY.reviewerModel } : {}), schema: REVIEW_SCHEMA }
  )

  // Same contract as the build loop: keep going while anything is merely
  // UNADDRESSED; stop when what is left cannot be moved by another round. The
  // foundation earns this more than a case does — every wave is built on top of
  // it, so shipping it half-reviewed propagates into every case that follows.
  let rev = await reviewFoundation(null)
  let round = 0
  let stopped = null
  let unclassified = 0
  while (rev && rev.verdict === 'CHANGES_REQUESTED' && (rev.blocking ?? []).length) {
    if (round > 0) {
      const v = loopVerdict(rev)
      if (!v.go) { stopped = v.why; break }
      unclassified = v.unclassified ? unclassified + 1 : 0
      if (unclassified >= 2) { stopped = 'reviewer left surviving blockers unclassified twice — cannot tell unaddressed from unfixable'; break }
    }
    if (round >= FIX_ROUNDS) { stopped = `fix-round backstop (${FIX_ROUNDS}) reached — review/fix pair is not converging`; break }
    round++
    const prior = rev.blocking.map((b) => quote(b)).join('\n- ')
    const skipped = (rev.blocking_detail ?? []).filter((d) => d.status === 'unaddressed').map((d) => quote(d.item))
    const fixed = await agent(
      `Implementer slot — fix round ${round} on the foundation branch ${built.branch} per your test-automation-implementation skill. ` +
      'You are the ONLY writer in the project\'s one working tree for this stage. Address EACH blocking finding (verify against the code first), keep the smoke spec green ONCE, commit, update the PR — do NOT run the whole suite, that is the mini-gate\'s job. ' +
      FOREGROUND_RULE + '\n- ' +
      prior +
      (skipped.length
        ? `\n\nTHE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND — no attempt was visible in the diff:\n- ${skipped.join('\n- ')}\n`
          + 'Do them. If one genuinely cannot be done on this branch, say so in notes with the reason instead of leaving it silent.'
        : ''),
      { label: `fix:foundation:${round}`, phase: 'Foundation', agentType: 'test-automation-engineer', ...(POLICY.workerModel ? { model: POLICY.workerModel } : {}), schema: FOUNDATION_SCHEMA }
    )
    if (!fixed || fixed.status !== 'ready-for-mini-gate') { stopped = `fix round ${round} failed: ${fixed?.notes ?? 'implementer failed'}`; rev = null; break }
    rev = await reviewFoundation(prior)
  }

  if (!rev || rev.verdict !== 'APPROVED') {
    return {
      stage: 'foundation',
      status: 'blocked',
      branch: built.branch,
      pr: built.pr,
      smoke_spec: built.smoke_spec,
      fix_rounds: round,
      review: rev ?? { verdict: 'CHANGES_REQUESTED', blocking: ['reviewer failed'], findings: [], notes: '' },
      detail: stopped ?? 'review CHANGES_REQUESTED',
      heads_analyzed: headsAnalyzed,
      next: `The fix loop stopped because ${stopped ?? 'the reviewer still blocks'} — these are not things another round can move. Resolve them yourself (or set plan.foundation=null to skip the stage), then re-invoke with { plan, headsAnalyzed }.`,
    }
  }

  // ---- Mini-gate: the foundation must PROVE itself before any wave builds on it
  // Everything downstream inherits this branch, so an unproven foundation turns
  // one flaky helper into a red in every wave — and the wave gate would blame
  // the case. Same contract as the batch gate: N CONSECUTIVE green, the gate
  // proves and never fixes, and it is a separate agent from the one that built.
  phase('Mini-gate')
  const gate = await agent(
    `Mini-gate for the campaign foundation. You did not write this code and you do not fix it — you PROVE it, and you report exactly what you saw.\n` +
    `Branch: ${built.branch}. Base: ${plan.base}. Smoke spec: ${built.smoke_spec}.\n` +
    `Run the smoke spec ${GATE_N} CONSECUTIVE deterministic green times, each a clean process against the live env, and run the existing suite green once alongside it — the foundation must not have broken what already passed. ` +
    'Use `scripts/gate/gate-case.mjs` for the mechanics (it merges the base FIRST, refuses a dirty tree, and returns timings). ' +
    'A red anywhere ENDS the attempt — N CONSECUTIVE is the contract, not best-of-N. ' +
    'Distinguish a spec that FAILED from one that never ran (module not found, worker crash, 0ms duration): the second is an infrastructure fact, and reporting it as a red sends the lead hunting a bug that does not exist. Say which in notes. ' +
    'Do NOT merge. Do NOT fix. Do NOT classify the failure — that is the lead\'s call. ' +
    FOREGROUND_RULE +
    `Return verdict=green only if you observed ${GATE_N} consecutive green runs.`,
    { label: 'mini-gate:foundation', phase: 'Mini-gate', agentType: 'test-automation-engineer', ...(POLICY.workerModel ? { model: POLICY.workerModel } : {}), schema: GATE_SCHEMA }
  )
  log(`foundation mini-gate: ${gate?.verdict ?? 'not-run'} after ${round} fix round(s)`)

  return {
    stage: 'foundation',
    status: gate?.verdict === 'green' ? 'ready-to-merge' : 'gate-red',
    branch: built.branch,
    pr: built.pr,
    smoke_spec: built.smoke_spec,
    fix_rounds: round,
    review: rev,
    gate: gate ?? { verdict: 'not-run', runs: 0, failures: [], notes: 'gate agent failed' },
    heads_analyzed: headsAnalyzed,
    next: gate?.verdict === 'green'
      ? `Foundation reviewed APPROVED and gated ${GATE_N}x green. Merge ${built.branch} to ${plan.base} per .agents/profile.md § Automation PR policy, then re-invoke this workflow with { plan, foundationMerged: true, headsAnalyzed: <the heads_analyzed array from this return> }.`
      : `Foundation passed review but the mini-gate did NOT go green — classify the failure (flake / test-code bug / product defect / infrastructure) before anything builds on this branch, since every wave inherits it. Fix on ${built.branch}, then re-invoke with { plan, headsAnalyzed }.`,
  }
}
log(F ? 'foundation merged — running waves' : 'no foundation stage — running waves')

// ---- Phase 3: Waves (one build child per wave — it integrates and gates) ---
phase('Waves')
const waves = []
// LANDING GRANULARITY decides whether waves may run back to back. Under
// `per-batch` a gated wave must reach base BEFORE the next one cuts its trunk,
// otherwise the promise ("the next cuts from an updated base") is false — and
// landing is the lead's, so the conductor has to hand control back. Under
// `campaign-end` nothing lands until the finish, so waves roll on.
// `A.landedWaves` carries the slugs already landed across re-invocations.
const LANDING = (plan.policy ?? {}).landing ?? 'per-batch'
const landedWaves = Array.isArray(A.landedWaves) ? A.landedWaves : []
const pending = plan.waves.filter((w) => !landedWaves.includes(w?.slug))

for (const w of pending) {
  if (!w?.slug || !Array.isArray(w.caseIds) || w.caseIds.length === 0) {
    waves.push({ wave: w?.slug ?? '?', status: 'skipped', detail: 'malformed wave entry' })
    continue
  }
  try {
    // The build child integrates and gates internally, so a wave is ONE call
    // and ONE report — there is no in-between state for the conductor to hold.
    const report = await workflow({ scriptPath: BUILD }, {
      slug: plan.batch,
      base: plan.base,
      cases: w.caseIds.map((id) => ({ id })),
      integrationBranch: `tests/batch-${w.slug}`,
      // Per-wave report dir: the snapshot dir is shared via the batch slug by
      // design, but each wave must keep its own report.json — the conductor's
      // return points the lead at every wave's report_path.
      reportDir: `.agents/automation/${plan.batch}/${w.slug}`,
      ...(w.clusters?.length ? { clusters: w.clusters } : {}),
      ...(headsAnalyzed.length ? { preAnalyzed: headsAnalyzed.filter((h) => w.caseIds.includes(h.id)) } : {}),
      ...policyArgs,
      ...common,
    })
    // Extend cross-check: planner pre-marks vs analyst conclusions, both
    // independent — divergence either way is a signal, not a verdict.
    const cand = (plan.extendCandidates ?? []).filter((id) => w.caseIds.includes(id))
    const ext = report?.extend_cases ?? []
    waves.push({
      wave: w.slug,
      status: report?.gate?.verdict === 'green' ? 'gated-green'
        : report?.totals?.automated ? 'partial'
        // An interrupted gate is not a red and its merges are not nothing:
        // merged-ungated units mean the trunk is loaded but unproven.
        : report?.totals?.['merged-ungated'] ? 'ungated'
        : 'nothing-landed',
      integration_branch: report?.integration_branch ?? null,
      gate: report?.gate ?? null,
      totals: report?.totals ?? {},
      report_path: report?.report_path ?? null,
      report_written: report?.report_written ?? false,
      quality_flags: report?.quality_flags ?? [],
      extend_divergence: {
        analyst_only: ext.filter((id) => !cand.includes(id)),
        planner_only: cand.filter((id) => !ext.includes(id)),
      },
    })
    log(`wave ${w.slug}: ${JSON.stringify(report?.totals ?? {})} — gate ${report?.gate?.verdict ?? 'not-run'}`)
  } catch (e) {
    waves.push({ wave: w.slug, status: 'failed', detail: String(e?.message ?? e) })
    log(`wave ${w.slug} FAILED (${String(e?.message ?? e).slice(0, 120)}) — campaign continues with the next wave`)
  }

  // PER-BATCH LANDING: the next wave cuts its trunk from base, so base must
  // already carry this one — and landing is the LEAD's (seeded merge policy,
  // possibly a human approval). So hand control back rather than promising an
  // updated base we have not got. Under `campaign-end` nothing lands until the
  // finish, so waves roll straight on.
  const remaining = pending.filter((x) => x.slug !== w.slug && !waves.some((r) => r.wave === x.slug))
  if (LANDING === 'per-batch' && remaining.length) {
    log(`wave ${w.slug} done — returning so it can land before ${remaining[0].slug} cuts its trunk`)
    return {
      campaign: plan.campaign,
      stage: 'wave-landed',
      waves,
      landed_waves: landedWaves,
      remaining_waves: remaining.map((x) => x.slug),
      next: (() => {
        const thisWave = waves[waves.length - 1]
        if (thisWave?.status === 'gated-green') {
          return `Land wave '${w.slug}' now, per .agents/profile.md § Automation PR policy — one PR from its trunk to ${plan.base}, then mirror. `
            + `Under auto-merge a dispatched closer can do it and return the EVIDENCE (merge sha + the read-back), never just a claim. `
            + `THEN re-invoke this workflow with { plan, foundationMerged: true, headsAnalyzed, landedWaves: ${JSON.stringify([...landedWaves, w.slug])} } to continue with '${remaining[0].slug}', which will cut its trunk from the updated ${plan.base}. `
            + `(Seed \`landing: "campaign-end"\` instead if you would rather run every wave and land them together.)`
        }
        if (thisWave?.status === 'failed') {
          return `Wave '${w.slug}' FAILED (${quote(thisWave.detail ?? '', 120)}) — there is NOTHING to land. Diagnose it (its report/journal), then re-invoke with { plan, foundationMerged: true, headsAnalyzed, landedWaves: ${JSON.stringify(landedWaves)} } to retry the wave (resume replays completed units from cache), or drop it from plan.waves to move on.`
        }
        if (thisWave?.status === 'ungated') {
          return `Wave '${w.slug}' merged units but its gate NEVER RAN (interrupted or dropped) — they are merged-ungated: unproven, NOT blocked, and there is nothing to classify yet. Re-run the wave gate on ${thisWave?.integration_branch ?? 'its trunk'} first (resuming the build with resumeFromRunId replays merges from cache)${thisWave?.report_written ? '' : '; its report.json was never written — derive state from .agents/automation/_returns/ and git (playbook § Interruption)'}. Land only on green, then re-invoke with { plan, foundationMerged: true, headsAnalyzed, landedWaves: ${JSON.stringify(landedWaves)} } to continue.`
        }
        return `Wave '${w.slug}' ended '${thisWave?.status}' — do NOT land it yet: classify its report first (flake/test-code red → batch-stabilize on its trunk; product defect → tracker). Land only when its trunk is worth landing, then re-invoke with { plan, foundationMerged: true, headsAnalyzed, landedWaves: ${JSON.stringify([...landedWaves, w.slug])} }; to skip it instead, re-invoke without adding it to landedWaves.`
      })(),
    }
  }
}

// A campaign with a declared numeric goal re-measures it at EVERY wave gate —
// not at campaign end. Field lesson: a 13-hour campaign with an explicit ≥60%
// coverage target merged 12 cases without re-measuring coverage once, so every
// prioritisation call after hour one was made blind to its own target.
const GOAL = plan.goal ?? null

// LANDING GRANULARITY is a project policy, not a pipeline decision — seeded in
// `.agents/profile.md § Automation PR policy`. `per-batch` (the default) lands
// each gated wave to base before the next one starts, so value arrives early,
// base drift stays small, and a red wave blocks only itself. `campaign-end`
// accumulates gated waves on one branch and lands them together — right when
// base is a protected release line and PR ceremony is expensive, at the cost of
// nothing shipping until the end.
return {
  campaign: plan.campaign,
  stage: 'waves',
  waves,
  goal: GOAL,
  landing: LANDING,
  landed_waves: landedWaves,
  next: `Lead: each wave already gated itself and its trunk is ready to land. Land per .agents/profile.md § Automation PR policy — landing granularity is '${LANDING}'${LANDING === 'per-batch' ? ' (land each gated wave before the next starts, so the next cuts its trunk from an updated base)' : ' (accumulate the gated wave branches and land them together at campaign end)'}. Under auto-merge this can be a dispatched closer rather than your own turns: it merges, reads back the merge, mirrors the TMS, transitions the tracker, and returns the EVIDENCE (merge shas + the read-back diff), never just a claim. Then mirror per plan.policy.mirror ('${POLICY.mirror ?? 'campaign-end'}'). A wave that is not 'gated-green': classify its blocked cases from its report (product defect → tracker; flake/test-code → batch-stabilize on that wave's branch; architectural → § Framework architecture) — EXCEPT a wave 'ungated' (gate never ran): its merged-ungated units are unproven, not blocked — re-run its gate before classifying anything, and if report_written is false the report.json on disk is missing: derive its state from .agents/automation/_returns/ and git (playbook § Interruption), never from this summary alone. Investigate quality_flags and extend_divergence (blind-audit sampled extends) before trusting a wave's coverage. ` +
    (GOAL
      ? `AFTER each wave's merges land, RE-MEASURE THE GOAL — run \`${GOAL.command}\` and log the number on the campaign card under § Goal (metric: ${GOAL.metric}; baseline: ${GOAL.baseline}). A wave gate that passes without a fresh number leaves the campaign blind from there on. `
      : '') +
    // Per-wave gates prove each wave's specs together, but cross-wave
    // interaction is unprovable until every wave exists. This is a CHECK, not a
    // gate: the waves have already landed, so a red here is fix-forward.
    'THEN, once every wave has landed: run the CAMPAIGN\'S DELIVERED SUITE once — every spec this campaign added or changed, together, from the wave reports. Per-wave gates cannot see cross-wave interaction, so this is the only place it surfaces. It is a CHECK and not a gate (the work is already on base), so a red goes to batch-stabilize as fix-forward, on a branch cut from base. ' +
    'cleanup.mjs --merged <branches that merged> --report <wave report> at campaign end.',
}
