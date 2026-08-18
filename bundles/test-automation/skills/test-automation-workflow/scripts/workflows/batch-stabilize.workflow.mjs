// Batch-stabilize workflow — fix a RED hardening gate, at the batch level.
// Claude Code only — invoked by the lead AFTER classifying the red:
//   Workflow({ scriptPath: '<installed skill>/scripts/workflows/batch-stabilize.workflow.mjs',
//              args: { slug, base, branch, failures: [{spec, signature, case_ids?}], … } })
//
// WHEN TO USE IT. Only after the lead has classified a red as a TEST-CODE bug
// or a flake. Two moments produce one: a batch trunk that failed its hardening
// gate (nothing landed yet — fixing it unblocks the batch), or the campaign-end
// delivered-suite check going red after every wave has already landed. The
// second is fix-forward on a branch cut from base; the workflow does not care
// which, it fixes whatever `branch` carries the red. A product defect goes to the tracker and the test
// stays red (a red test exposing a real bug is correct). An architectural gap
// goes to § Framework architecture. This workflow assumes the classification is
// already made — it does not re-litigate it.
//
// WHY THE BATCH IS THE UNIT. The hardening gate runs the batch's specs TOGETHER
// precisely because that surfaces failures a per-case run never sees, so the
// failures it uniquely finds are batch-level BY CONSTRUCTION — shared fixture
// state, ordering, parallel interference. Fixing them one case at a time hands
// each fixer a single symptom of a cause that spans several. Measured, from one
// campaign's red cases:
//   * an unscoped global `console_errors` list leaked a step-1 404 into later,
//     unrelated assertions — nondeterministically;
//   * a fixture 500 that fired before the test body ran at all;
//   * a test-data cleanup race ("no such conversation", different id each run).
// Not one of those is a bug in "its" case. Three separate fix dispatches would
// have seen three symptoms and never assembled the picture.
//
// SHAPE. Diagnose across ALL failures first (one agent, whole picture), then fix
// by CAUSE (sequential — they write code in the one working tree), then re-gate.
// Bounded: ≤2 rounds, then stop and report. It never merges and never decides
// that a remaining red is acceptable.
//
// This is also the first `kind: fix` instance of the pipeline's shape: the
// investigation step differs (reproduce a failure rather than execute a case),
// build / review / gate are the same skeleton.

export const meta = {
  name: 'ta-batch-stabilize',
  description: 'Turn a red batch gate green: one diagnostician reads ALL failures together and groups them by root cause, fixes land sequentially per cause with a regression test each, then the batch re-gates — bounded to two rounds, then it stops and reports',
  whenToUse: 'Lead, after a red hardening gate has been classified as a test-code bug or flake (not a product defect, not an architectural gap) — batch-level failures need batch-level diagnosis',
  phases: [
    { title: 'Diagnose', detail: 'one agent over ALL failures at once: how many distinct causes, not how many failing specs' },
    { title: 'Fix', detail: 'one dispatch per CAUSE, sequential, each adding the regression test that would have caught it' },
    { title: 'Re-gate', detail: 'the batch specs together, N consecutive green' },
  ],
}

// ---- args ------------------------------------------------------------------
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.slug || !A.base || !A.branch || !Array.isArray(A.failures) || A.failures.length === 0
    || A.failures.some((f) => !f?.spec || !f?.signature)) {
  throw new Error(
    'args required: { slug, base, branch (whatever carries the red — a batch trunk ' +
    'that failed its gate, or a fix branch cut from base when the campaign-end ' +
    'delivered-suite check went red after everything had already landed), ' +
    'failures: [{spec, signature, case_ids?}, …] (from the gate\'s report — every entry needs spec AND signature), ' +
    'gateN?, gateCmd?, rounds?, agentTypes?, workerModel?, root? }'
  )
}
const SLUG = A.slug
const BASE = A.base
const BRANCH = A.branch
const FAILURES = A.failures
const GATE_N = A.gateN ?? 3
const GATE_CMD = A.gateCmd ?? null
const MAX_ROUNDS = A.rounds ?? 2
const TYPES = { fixer: 'test-automation-engineer', gate: 'test-automation-engineer', ...(A.agentTypes ?? {}) }
const WORKER = { ...(A.workerModel ? { model: A.workerModel } : {}) }

// FOREIGN TEXT GOES THROUGH HERE — failure signatures come from a test runner,
// cause titles and evidence from the diagnostician. None of it is authored by
// this script, and all of it lands inside a prompt that IS instructions: clamp
// it so one enormous stack trace cannot crowd out the contract, and defuse the
// markers that would let it read as prompt structure. (Same helper as
// batch-build's; the sandbox has no imports, so the two copies must agree.)
const quote = (s, max = 400) => String(s ?? '')
  .replace(/```+/g, "'''")
  .replace(/^\s{0,3}#{1,6}\s+/gm, '')
  .trim()
  .slice(0, max)

const PREAMBLE =
  'You are dispatched from the batch-stabilize workflow. If your role memory / ' +
  'project briefing / .agents/*.md digests are not already in your context, load ' +
  'them now (memory skill; read the files). Confirm your slot contract is ' +
  'PRESENT before touching anything — by CHECKING your context (preloaded ' +
  'skills are already there); re-invoking the Skill tool for a skill you ' +
  'already carry pastes a duplicate copy. ' +
  'Anything worth telling someone that did not stop you goes in findings[] — do ' +
  'not write it to memory yourself; the report is what gets read. ' +
  // Same measured facts as batch-build's FOREGROUND_RULE: a turn ended mid-job
  // is forced to report 28ms later (no wake, by any pattern), a foreground call
  // is capped at 600s, and a blocking sleep is the legal — and cheap — way to
  // wait. The re-gate slot is the exposed one here: running the suite N
  // consecutive times is the longest job in this workflow.
  'LONG JOBS — test suites especially. A foreground call is killed at its `timeout` ' +
  '(default 120s, MAXIMUM 600000ms), so ALWAYS pass timeout: 600000 on a suite run, ' +
  'and let the call block when the job fits inside it. ' +
  'When the job does NOT fit in one call: launch it detached, writing its output to a file, ' +
  'then WAIT with blocking foreground polls — ONE `sleep <n>; <tail the output file>` per call, each with ' +
  'timeout: 600000 — until it is done. Sleeping in the foreground is legal and cheap: it is ONE turn ' +
  'however long you sleep. Make the FIRST poll short (~60-120s) — a run that dies in its first minute ' +
  'must not cost a five-minute blind sleep — then settle at ~`sleep 300`. NEVER chain sleeps inside one ' +
  'call (`sleep 120; tail; sleep 240; tail`): the chain outlives the call cap and is killed at its own ' +
  'timeout, taking the tail you already read with it — one sleep, one look, return, repeat. ' +
  'NEVER end a turn while a job is running — nothing will wake you (measured: forced to report 28ms ' +
  'later, and neither run_in_background nor Monitor beats that) and this workflow blocks on your return. ' +
  'NEVER poll at second-level intervals — you pay a full context per turn and a busy-wait gets you cut off.'

const FINDINGS = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false,
    required: ['kind', 'note'],
    properties: {
      kind: { type: 'string', enum: ['defect', 'clarification', 'question', 'note'] },
      note: { type: 'string' },
      ref: { type: ['string', 'null'] },
    },
  },
}

// ---- Phase 1: diagnose ACROSS the failures ---------------------------------
// The whole value of this workflow is here. A per-case fixer sees one symptom;
// this agent sees every failure at once and answers the question that actually
// matters: how many distinct CAUSES are there?
phase('Diagnose')
const DIAGNOSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['causes', 'notes', 'findings'],
  properties: {
    causes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'kind', 'specs', 'evidence', 'fix'],
        properties: {
          title: { type: 'string' },
          // Named so the fix is scoped correctly: shared state and ordering are
          // fixed once for the batch; a genuinely per-spec bug is fixed in place.
          kind: { type: 'string', enum: ['shared-state', 'ordering', 'fixture', 'timing', 'test-data', 'per-spec', 'unknown'] },
          specs: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    unexplained: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
// Stall-retry exhaustion THROWS out of agent() ("agent stalled on all N
// attempts") instead of returning null — measured 2026-08-17, quota-throttled
// Bedrock. guarded() turns the throw into the null every call site here
// already handles, and the log names the stall so the lead blames the
// ENVIRONMENT (provider quota, stream stability), not the batch.
const isStall = (e) => /stall/i.test(String(e?.message ?? e))
const guarded = async (what, fn) => {
  try { return await fn() } catch (e) {
    log(`${what} ${isStall(e) ? 'infra-stalled (environment — fix the provider before retrying)' : 'threw'}: ${String(e?.message ?? e).slice(0, 120)}`)
    return null
  }
}

const diag = await guarded('diagnostician', () => agent(
  `${PREAMBLE}\n\nDiagnostician — batch ${SLUG} on branch ${BRANCH} (base ${BASE}) failed its hardening gate. ` +
  'The lead has already classified this as a TEST-CODE bug or a flake, so do not re-argue that; find the CAUSES.\n\n' +
  'Failures, all of them:\n' +
  FAILURES.map((f, i) => `${i + 1}. ${quote(f.spec, 200)}\n   ${quote(f.signature, 300)}${f.case_ids?.length ? `\n   cases: ${f.case_ids.join(', ')}` : ''}`).join('\n') + '\n\n' +
  'Read them TOGETHER before reading any code — the question is how many distinct causes there are, not how many specs failed. ' +
  'These failures come from running the batch\'s specs in ONE process, so the causes that hide here are the ones a single-spec run cannot produce: ' +
  'state shared between specs (module-level collections, singletons, caches that are never reset), ordering dependencies, fixture setup that fails or leaks, ' +
  'timing assumptions that hold alone and break under load, and test data that races between specs. ' +
  'A cause may cover several specs; several causes may hit one spec. ' +
  'Then read the code to confirm each hypothesis — cite the file and the mechanism in `evidence`, never a guess. ' +
  'For each cause give the concrete `fix` at the RIGHT level: shared state and ordering get fixed once in the shared object; only a genuinely isolated bug is fixed inside a spec. ' +
  'Reproduce where you can, but do not attempt any fix — you are diagnosing. ' +
  'Any failure you cannot explain goes in `unexplained` — say so rather than inventing a cause; an unexplained failure is a real answer and the lead needs it.',
  { label: `diagnose:${SLUG}`, phase: 'Diagnose', agentType: TYPES.fixer, ...WORKER, schema: DIAGNOSIS_SCHEMA }
))
if (!diag || !diag.causes?.length) {
  return {
    batch: SLUG, branch: BRANCH, status: 'diagnosis-failed',
    unexplained: FAILURES.map((f) => f.spec),
    next: 'No cause identified. Re-run with a narrower failure list, or investigate by hand — do not merge a red batch.',
  }
}
log(`${FAILURES.length} failure(s) → ${diag.causes.length} cause(s)${diag.unexplained?.length ? `, ${diag.unexplained.length} unexplained` : ''}`)

// ---- Phase 2+3: fix by cause, re-gate, bounded -----------------------------
const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'summary', 'findings'],
  properties: {
    status: { type: 'string', enum: ['fixed', 'blocked'] },
    summary: { type: 'string' },
    regression_test: { type: ['string', 'null'] },
    findings: FINDINGS,
  },
}
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'runs', 'failures', 'notes'],
  properties: {
    verdict: { type: 'string', enum: ['green', 'red', 'not-run'] },
    runs: { type: 'integer' },
    seconds: { type: 'array', items: { type: 'number' } },
    failures: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['spec', 'signature'],
        properties: {
          spec: { type: 'string' },
          signature: { type: 'string' },
          case_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const findings = [...(diag.findings ?? [])]
const rounds = []
let causes = diag.causes
let gate = null
// Accumulated across every diagnosis round — the first round's list alone
// would drop whatever a re-diagnosis could not explain either.
const unexplained = new Set(diag.unexplained ?? [])

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase('Fix')
  const applied = []
  // Sequential: every fixer writes code in the one working tree, and two of
  // them at once corrupt it whatever files each believes it owns.
  for (const cause of causes) {
    const fix = await guarded(`fixer round ${round}`, () => agent(
      `${PREAMBLE}\n\nFixer — batch ${SLUG}, branch ${BRANCH}, round ${round}. Fix ONE diagnosed cause; do not range beyond it.\n\n` +
      `CAUSE (${cause.kind}): ${quote(cause.title, 200)}\n` +
      `Specs it explains: ${(cause.specs ?? []).map((s) => quote(s, 200)).join(', ')}\n` +
      `Evidence: ${quote(cause.evidence, 1200)}\n` +
      `Prescribed fix: ${quote(cause.fix, 1200)}\n\n` +
      'You work in the project\'s ONE working tree, on branch ' + BRANCH + '. No worktree is created for you and you must not create one. ' +
      'You are the only writer right now — stay on this branch and stage ONLY your own paths (`git add <paths>`, never `-A`/`.`). ' +
      'Fix it at the level the diagnosis names: a shared-state, ordering, fixture or timing cause is fixed ONCE in the shared object — copying the same patch into each spec leaves the cause in place and hides it better. ' +
      '**Add the regression test that would have caught this**, and name it in regression_test. ' +
      'Do NOT weaken or delete an assertion, do NOT add a sleep, do NOT mark anything skipped/xfail to get past it — that is defect masking, and the point of this run is the opposite. ' +
      'If the real fix turns out to be a product change or an architectural one, stop and return blocked with what you found; do not force it.',
      { label: `fix:${cause.kind}:${round}`, phase: 'Fix', agentType: TYPES.fixer, ...WORKER, schema: FIX_SCHEMA }
    ))
    findings.push(...(fix?.findings ?? []))
    applied.push({ cause: cause.title, kind: cause.kind, status: fix?.status ?? 'blocked', summary: fix?.summary ?? 'fixer agent failed', regression_test: fix?.regression_test ?? null })
  }

  phase('Re-gate')
  gate = await guarded(`re-gate round ${round}`, () => agent(
    `${PREAMBLE}\n\nHardening gate — batch ${SLUG}, branch ${BRANCH}, after stabilization round ${round}. ` +
    'You did not write these fixes and you do not judge them — you re-run the batch and report exactly what you see.\n' +
    `Run the batch's specs TOGETHER, ${GATE_N} CONSECUTIVE deterministic green runs, each a clean process against the live env. ` +
    'Use `scripts/gate/gate-case.mjs` for the mechanics (it merges the base FIRST, refuses a dirty tree, and returns timings), ' +
    (GATE_CMD ? `with --cmd '${GATE_CMD}'. ` : 'resolving the suite command from .agents/testing.md § run commands. ') +
    'A red anywhere ENDS the attempt — N CONSECUTIVE is the contract, not best-of-N. ' +
    'On red, read the runner\'s STRUCTURED report for per-spec verdicts and return one failures[] entry per failing spec with its signature. ' +
    'Do NOT merge. Do NOT fix. Do NOT classify.',
    { label: `re-gate:${SLUG}:${round}`, phase: 'Re-gate', agentType: TYPES.gate, ...WORKER, schema: GATE_SCHEMA }
  ))
  rounds.push({ round, causes: applied, gate: { verdict: gate?.verdict ?? 'not-run', runs: gate?.runs ?? 0, failures: gate?.failures ?? [] } })
  log(`round ${round}: ${applied.length} cause(s) fixed → gate ${gate?.verdict ?? 'not-run'}`)

  if (gate?.verdict === 'green') break
  if (round === MAX_ROUNDS) break
  // A dead re-gate agent means the batch's state is UNKNOWN, not red —
  // re-diagnosing on an empty failure list would send a diagnostician after
  // failures nobody observed.
  if (!gate) { log('re-gate agent died — stopping; the batch state is unknown, re-gate by hand'); break }

  // Re-diagnose what is still red: the remaining failures may have a different
  // cause than the ones just fixed, and assuming otherwise is how a fix loop
  // spins on the wrong hypothesis.
  phase('Diagnose')
  const again = await guarded(`re-diagnose round ${round + 1}`, () => agent(
    `${PREAMBLE}\n\nDiagnostician — batch ${SLUG} on ${BRANCH} is still red after round ${round}.\n\n` +
    'Fixes applied so far:\n' + rounds.flatMap((r) => r.causes.map((c) => `- [${c.status}] ${quote(c.cause, 200)}: ${quote(c.summary, 400)}`)).join('\n') + '\n\n' +
    'Still failing:\n' + (gate?.failures ?? []).map((f, i) => `${i + 1}. ${quote(f.spec, 200)}\n   ${quote(f.signature, 300)}`).join('\n') + '\n\n' +
    'Read these together as before. A failure that survived a fix is EVIDENCE: either that fix was wrong, or this failure always had a different cause. Say which, and do not simply restate the previous diagnosis. ' +
    'Anything you still cannot explain goes in `unexplained`.',
    { label: `diagnose:${SLUG}:${round + 1}`, phase: 'Diagnose', agentType: TYPES.fixer, ...WORKER, schema: DIAGNOSIS_SCHEMA }
  ))
  findings.push(...(again?.findings ?? []))
  for (const u of (again?.unexplained ?? [])) unexplained.add(u)
  if (!again?.causes?.length) { log('no new cause identified — stopping'); break }
  causes = again.causes
}

const green = gate?.verdict === 'green'
return {
  batch: SLUG,
  branch: BRANCH,
  status: green ? 'green' : 'still-red',
  rounds,
  gate: gate ? { verdict: gate.verdict, runs: gate.runs, seconds: gate.seconds ?? [], failures: gate.failures ?? [] } : null,
  unexplained: [...unexplained],
  findings,
  next: green
    ? `Gate green after ${rounds.length} round(s). Merge per .agents/profile.md § Automation PR policy, then mirror.`
    : `Still red after ${rounds.length} round(s) — the bound is deliberate: a third automated attempt on a hypothesis that has failed twice is how a loop burns a budget. Take it by hand: re-classify (is it really test-code? a product defect? architectural?), and see the remaining failures and the unexplained list above. Do NOT merge this branch.`,
}
