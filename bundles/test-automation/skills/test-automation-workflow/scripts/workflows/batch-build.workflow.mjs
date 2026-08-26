// Canonical batch workflow for the test-automation pipeline.
// Claude Code only — invoked by the orchestrator via
//   Workflow({ scriptPath: '<installed skill>/scripts/workflows/batch-build.workflow.mjs',
//              args: { slug, base, cases: [{id, title?}, …], clusters?, … } })
//
// ONE workflow, ONE report. TA v2 is a COMPILER from test cases to test code:
// input is ready-made cases (TMS snapshots or in-repo TC files) plus execution
// evidence when it exists; output is merged automated tests, the surface cache,
// and one report the lead acts on — land what is `delivered`, classify what is
// red, replan the rest. There is no intermediate spec artifact: the CASE (which
// TA never edits) and the CODE are the two sources of truth, joined by the
// coverage contract (a machine-findable comment block per case, checked
// mechanically by the gate and semantically by the reviewer).
//
//   triage       → one cheap dispatch reads the seeded execution-provider
//                  policy and routes every unit: manual-qa-verified |
//                  needs-execution | combined
//   for each unit, IN ORDER, on the batch trunk:
//     execute    → (needs-execution only) manual-qa's test-runner per case;
//                  FAIL files a defect and stops the case, BLOCKED stops it
//     build      → one engineer dispatch derives the spec from the case and
//                  implements it on a unit branch cut FROM the trunk
//     review     → static, engineer-typed with the reviewer contract loaded
//     fix        → rounds until APPROVED (see loopVerdict)
//     merge      → the unit branch into the trunk, then the tree RETURNS to it
//   gate         → the batch's specs together, N consecutive green + affected
//                  specs + the mechanical coverage check
//   report       → one writer, at close
//
// EXECUTION-PROVIDER POLICY (.agents/testing.md § Execution provider, seeded by
// scout): `manual-qa` when that factory co-installs, `self` otherwise. Under
// `self` every unit routes `combined` and the ritual "execute the full case
// before automating" is DEAD — the first green run of the automated test
// against the real system IS the case's first execution; a live browser is an
// investigation tool, not a stage. Under `manual-qa` the pipeline NEVER
// executes a case itself: evidence exists → build from it; evidence missing →
// dispatch their test-runner per case; test-runner unavailable → the case is
// honestly `needs-execution` and the report says to run the manual-qa suite.
//
// ONE TREE, ONE MASTER — the invariant everything else rests on. There is no
// concurrency here at all, and that is the design, not a limitation:
//
//   Always return the tree to a known state, and always branch from it.
//
// A single working tree has ONE state at a time, but concurrent slots need
// DIFFERENT states — one wants base, a reviewer wants the branch it is
// judging, an implementer wants its own. No rule can reconcile that; only
// ordering can. An earlier revision ran slots in parallel and paid for it in
// the field: eight `local changes would be overwritten by checkout` aborts,
// merge conflicts concentrated in shared page objects, 90 conflict hits and
// three git-surgery rescues in one session. Units merge as they finish, so
// integration is continuous and conflicts surface small, early, and while
// their author is still live.
//
// THROUGHPUT COMES FROM CLUSTERING, NOT CONCURRENCY. Units are the wall clock,
// so a cluster of 5 is one unit rather than five.
//
// WHY NO BOARD. Earlier revisions kept a `.agents/automation-board/` state
// machine — 15 statuses, legal transitions, a serialized clerk applying every
// flip. It existed to record PROGRESS, and progress only needs recording if
// something reads it mid-run. Nothing does: the runtime already persists every
// agent's full return to the run's `journal.jsonl` as it completes, and
// `resumeFromRunId` replays completed calls from cache. The board was a second,
// hand-maintained copy of that — and it drifted: 4 of 12 merged cases in one
// campaign ended mis-stated, one sitting at `analysis` despite a merge commit.
// What survives an interruption now: the journal (every return), git (branches,
// PRs, the surface cache), and the report once it lands. Recovery turns the
// first two into the third by hand — playbook § Interruption and resumption.
//
// OUTCOMES, NOT STATUSES. A case ends somewhere; it does not travel through a
// state machine. The vocabulary is closed: `delivered | defect-found | blocked
// | un-automatable | needs-execution | infra-stalled | not-started` — plus two
// bookkeeping values: the in-flight markers (`built`, `reviewed`) that never
// survive a completed run, and `merged-ungated` for the one state the closed
// set cannot say honestly (merged on the trunk, gate never produced a verdict —
// labelling those `blocked` once made a dead run's summary a false negative:
// "blocked: 14" while 13 of the 14 were already merged). `findings` —
// orthogonal — say what turned up on the way: a case can be `delivered` AND
// have filed two defects and raised a question.
//
// UNITS & CLUSTERS: work flows in units of 1..k cases. A cluster (args.clusters,
// declared by the plan per campaign-planning.md) is a pack of genuinely similar
// same-surface cases built by ONE engineer on ONE branch — a parameterized spec
// (one row per case) only where the cases are true variants of one flow, the
// engineer's judgment from the case files. Unlisted cases run as solo units.
// With builds sequenced, UNITS are the wall clock, so clustering is the main
// throughput lever a batch has.
//
// PROMPT DETERMINISM IS THE RESUME CONTRACT (field lesson, 2026-07-24 — it cost
// one campaign ~2x). `resumeFromRunId` caches every agent() call keyed on the
// EXACT (prompt, opts) pair, so any value interpolated into a prompt that
// depends on RUN TIMING rather than on the args breaks the cache on every
// resume and the agent re-runs live. An earlier revision handed out browser
// lanes from a counting semaphore (completion order): measured, 35 of 53
// analysed cases were re-run from scratch. Serialising removed that whole
// class: every unit branches from the TRUNK, whose name comes from args, so no
// prompt depends on who finished first. When editing: interpolate args and
// worker RESULTS, never anything derived from completion order.

export const meta = {
  name: 'ta-batch-build',
  description: 'One batch, one report: triage routes every unit per the seeded execution-provider policy (manual-qa-verified | needs-execution | combined), units run in order on the batch trunk — execute via manual-qa\'s test-runner where policy demands it, build from the case on a branch cut from the trunk, static review against the coverage contract, fix to APPROVED, merge back — then one hardening gate (N consecutive green, blast-radius regression, mechanical coverage check), returning per-case outcomes and findings for the lead to land, classify and replan from',
  whenToUse: 'Orchestrator (test-automation-lead) on Claude Code once a batch of cases has been planned and clustered — it runs the batch end to end; the lead (or a closer) lands it per seeded policy, classifies anything red, and replans the remainder',
  phases: [
    { title: 'Triage', detail: 'one read-only dispatch: reads .agents/testing.md § Execution provider and routes every unit (manual-qa-verified | needs-execution | combined)' },
    { title: 'Execution', detail: 'needs-execution units only: manual-qa\'s test-runner per case; FAIL files a defect, BLOCKED stops the case, no runner → honestly needs-execution' },
    { title: 'Build', detail: 'per unit: one engineer dispatch derives the spec from the case and implements green-once on a branch cut from the trunk, static review, fix rounds, merge back' },
    { title: 'Gate', detail: 'the batch specs together N consecutive green, plus the mechanical coverage check and one run of the specs the batch could have broken — its own agent, never the implementer' },
    { title: 'Report', detail: 'one writer: per-case outcomes + coverage + findings to disk' },
  ],
}

// ---- args ------------------------------------------------------------------
// Tolerate stringified args (observed 2026-07-20).
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.slug || !A.base || !Array.isArray(A.cases) || A.cases.length === 0 || A.cases.some((c) => !c?.id)) {
  throw new Error(
    'args required: { slug, base, cases: [{id, title?, path?}, …] (every case needs an id; path = repo-relative source file when the body already lives in this repo — no snapshot copy), clusters?: [[id,…],…], ' +
    'quotaResume?, root?, reportDir?, workItemRef?, baseUrl?, ' +
    'agentTypes?, workerModel?, workerEffort?, reviewerModel?, mergeModel?, reporterModel?, triageModel?, gateModel?, ' +
    'fixRounds?, gateN?, gateCmd?, integrationBranch?, skipGate?, reviewPanel?, breakerThreshold?, budgetReserve? }'
  )
}
{
  // Args removed by the redesigns. Silently ignoring one changes behaviour
  // without saying so — `skipIntegrate: true` used to stop before integrate+
  // gate and would now run a full gate; `analyzeOnly` used to run an analyst
  // front that no longer exists at all.
  const gone = ['analystConcurrency', 'skipIntegrate', 'integratorModel', 'integrateScriptPath',
    'tiering', 'analyzeOnly', 'preAnalyzed', 'extendImplementerModel', 'extendRateThreshold']
    .filter((k) => A[k] !== undefined)
  if (gone.length) {
    throw new Error(
      `removed arg(s): ${gone.join(', ')}. Units are strictly sequential, integration happens per unit, `
      + 'and the analyst slot is gone with the spec-artifact layer: triage routes every unit '
      + '(manual-qa-verified | needs-execution | combined) and the build dispatch derives the spec '
      + 'from the case directly. Use `skipGate` to stop after review; drop the rest.'
    )
  }
}
{
  // A duplicate id would build twice and collapse into one OUTCOME row; a
  // missing id would file snapshots and outcomes under 'undefined'.
  const dup = A.cases.map((c) => c.id).filter((id, i, arr) => arr.indexOf(id) !== i)
  if (dup.length) throw new Error(`duplicate case id(s) in args.cases: ${[...new Set(dup)].join(', ')}`)
}
const SLUG = A.slug
const BASE = A.base
const CASES = A.cases
const ROOT = A.root ? `${String(A.root).replace(/\/+$/, '')}/` : ''
// ALWAYS dispatch named agent types: the SubagentStart hook resolves role
// memory from the agent name; an anonymous workflow agent gets none.
// `runner` is manual-qa's agent — present only on co-installed rosters, and
// dispatched only when the seeded policy routes a unit `needs-execution`.
const TYPES = {
  implementer: 'test-automation-engineer',
  // Engineer-typed BY DESIGN: reviewer independence is a clean context plus the
  // reviewer contract (+ the code-review skill), not a different AGENT.md.
  reviewer: 'test-automation-engineer',
  runner: 'test-runner',
  gate: 'test-automation-engineer',
  reporter: 'test-automation-engineer',
  ...(A.agentTypes ?? {}),
}
// No model opt = the agent definition's frontmatter `model:` governs (agentType
// resolves from the same registry as the Agent tool: explicit opt > frontmatter
// > inherit). Implementer, reviewer and gate deliberately pass NO model so the
// installed AGENT.md stays the configuration surface; args override per run.
const WORKER = {
  ...(A.workerModel ? { model: A.workerModel } : {}),
  ...(A.workerEffort ? { effort: A.workerEffort } : {}),
}
// Reviewer: same rule — frontmatter governs unless an arg overrides. (An
// earlier hardcoded 'sonnet' floor here silently overrode a project's tuned
// frontmatter; the gate backstops review quality regardless.)
const REV = {
  ...(A.workerEffort ? { effort: A.workerEffort } : {}),
  ...((A.reviewerModel ?? A.workerModel) ? { model: A.reviewerModel ?? A.workerModel } : {}),
}
// Resume-after-ceiling: the halt is detected from a worker's NOTES, and that
// return replays verbatim from cache under resumeFromRunId — without this
// flag the cached ceiling note would re-halt the run at the same unit forever.
const QUOTA_RESUME = A.quotaResume === true
const BREAKER = A.breakerThreshold ?? 3
const PANEL = A.reviewPanel === true
const RESERVE = A.budgetReserve ?? 60_000
// RUNAWAY BACKSTOP, not the working control. The loop is meant to run until the
// reviewer approves; what ends it early is the reviewer saying the remaining
// blockers cannot be moved by another round (see loopVerdict). A low number
// here was itself the bug: at 2, a unit whose fixer merely FORGOT an item got
// shipped as `blocked` with the work nearly done, which is the one outcome
// nobody wants — neither finished nor honestly stuck. This number exists so a
// pathological review/fix pair cannot spend the budget, and nothing else.
const FIX_ROUNDS = A.fixRounds ?? 8
const GATE_N = A.gateN ?? 3
const GATE_CMD = A.gateCmd ?? null          // project's suite command; null → the gate agent resolves it from .agents/testing.md
// THE TRUNK — the "known state" the whole run returns to. Every unit branches
// from it and merges back into it, so it accumulates the batch's work in order
// and is the single thing the gate proves and the lead lands.
const TRUNK = A.integrationBranch ?? `tests/batch-${SLUG}`
const SKIP_GATE = A.skipGate === true
// The concrete base URL manual-qa's test-runner is pointed at. args override;
// otherwise triage resolves it from the seeded docs (.agents/testing.md § Base
// URL mapping → .agents/profile.md § Environment & access) and returns it.
let BASE_URL = A.baseUrl ? String(A.baseUrl).trim() : null
// Intake writes each case body here (fetch-once-to-disk); workers read the
// snapshot instead of re-fetching the TMS. EXCEPTION — a case whose body
// already lives IN THIS REPO (cases[].path: e.g. manual-qa-authored TC files,
// or bodies someone committed as md) is never copied: the source file IS the
// snapshot. One body, no duplicate; the version-of-record the copy existed
// for comes from git instead (both slots read identical bytes in the same
// tree, and a mid-batch edit shows as `git log` drift, not silent skew).
const CASE_PATH = new Map(CASES.map((c) => [c.id, typeof c.path === 'string' && c.path ? c.path : null]))
const SRC = (id) => {
  const p = CASE_PATH.get(id)
  return p ? `${ROOT}${p}` : `${ROOT}.agents/automation/${SLUG}/cases/${id}.md`
}
// reportDir: the campaign conductor gives every wave its own dir — waves share
// this SLUG for the snapshot dir, and without a distinct report location each
// wave's report.json would overwrite the previous one's.
const REPORT_DIR = `${ROOT}${A.reportDir ?? `.agents/automation/${SLUG}`}`

// ---- units: clusters (plan-declared) + solos, in caller order --------------
const byId = new Map(CASES.map((c) => [c.id, c]))
const clustered = new Set()
const UNITS = []
for (const cl of (Array.isArray(A.clusters) ? A.clusters : [])) {
  const members = cl.filter((id) => byId.has(id) && !clustered.has(id)).map((id) => byId.get(id))
  if (members.length >= 2) { UNITS.push(members); members.forEach((m) => clustered.add(m.id)) }
}
for (const c of CASES) if (!clustered.has(c.id)) UNITS.push([c])
UNITS.sort((a, b) => CASES.findIndex((c) => c.id === a[0].id) - CASES.findIndex((c) => c.id === b[0].id))
const label = (unit) => unit.map((c) => c.id).join('+')

// Field lesson, 2026-07-30 (lazy-modal foundation): an implementer backgrounded
// the full suite, wrote "I'll wait for this full-suite run to complete", and
// ended its turn. Nothing woke it. Twelve minutes later the output file was
// still empty, the conductor still held a `pending` journal entry, no error was
// raised anywhere, and finishing a nearly-done branch took a human noticing and
// dispatching a rescue. There is no timer, and no operator watches an
// individual slot — an agent that idles is an agent that died quietly.
//
// This goes to EVERY worker, not just implementers: the gate is the most
// exposed slot of all, because running the suite N consecutive times is its
// whole contract.
//
// Measured 2026-08-10, controlled probe, two arms: a schema-bound workflow
// subagent that ends its turn while a job runs is forced to report in 28ms —
// the documented run_in_background "you will be re-invoked when it exits" path
// and the Monitor tool BOTH lose that race. There is no waking. In the same
// probe a BLOCKING foreground `sleep` worked perfectly (3 x 45s, no
// enforcement), which is why the rule below names sleep as the way to wait:
// waiting is legal, idling is fatal, and nothing previously said so.
//
// The other half is arithmetic. A foreground call is capped at 600s (default
// 120s if `timeout` is not passed), while N=3 over a real UI batch is 12-19
// minutes — so "let the call block" ALONE is unsatisfiable, and every gate that
// tried it was killed, auto-backgrounded, and then trapped. And you pay per
// TURN, not per minute: at 132k resident context a poll costs ~$0.048, so
// wave-01's 27 `kill -0` polls burned $1.29 (32% of that agent) and it still
// failed. One `sleep 300` costs the same as one 2-second check.
const FOREGROUND_RULE =
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
  'NEVER end a turn while a job is running — nothing will wake you (measured: you are forced to ' +
  'report 28ms later, before the job finishes, and neither run_in_background nor Monitor beats that), ' +
  'this workflow blocks on your return, and your silence is indistinguishable from thinking. ' +
  'NEVER poll at second-level intervals either — you pay a full context per turn, and a busy-wait ' +
  'exhausts your turn budget and gets you cut off mid-job (measured: 27 polls, $1.29, no verdict). ' +
  'If a job is too long even for sleep-polling, say so in findings[] and run the narrower selection you need.'

// A killed slot is retried with the SAME prompt and no memory of the attempt
// that died — the harness stall-retry and a resume-after-pause both work that
// way — so a retry inherits ONLY what is committed. Field case 2026-08-17,
// quota-throttled Bedrock: one build slot burned ELEVEN attempts, each
// re-implementing the same case from scratch, because nothing had ever landed
// on the case branch. The continue-vs-rebuild judgment is the worker's: a
// script cannot tell "half-finished and coherent" from "abandoned and wrong",
// and both look identical to `git rev-parse`.
const CHECKPOINT_RULE =
  'CHECKPOINT DISCIPLINE — this dispatch can be killed and re-dispatched without warning (a stalled ' +
  'model stream is indistinguishable from thinking), and the retry inherits ONLY what is committed. ' +
  'So: (1) BEFORE writing anything, check whether your feature branch already exists with commits ' +
  'from a killed attempt (`git log <trunk>..<branch>`, `git status`): coherent work in progress -> ' +
  'continue it and say in notes what you inherited; wrong or contradicting the case -> rebuild those ' +
  'parts and say so. Never silently restart on a branch that already has work, and never assume it ' +
  'is finished because it exists. (2) Commit as milestones land — first coherent skeleton, spec ' +
  'green once, each fix — by exact path on your branch; push after the first commit and then per ' +
  'milestone ONLY if this project pushes to a remote (`.agents/profile.md` § Automation PR policy / ' +
  '`git remote -v`) — on a local-only project the commits alone are the checkpoint, skip pushes, ' +
  'that is expected, not a failure. '

// FOREIGN TEXT GOES THROUGH HERE. Case titles come from the TMS, blocking items
// and notes are written by other agents, runner verdicts by manual-qa's agent —
// none of it is authored by this script, and all of it lands inside a prompt
// that IS instructions. Two failure modes, one guard: an unbounded blob crowds
// out the contract it was pasted into, and text carrying prompt structure (a
// heading, a fence, a role line) reads as structure rather than as the datum it
// is. So: clamp, defuse the markers, and keep it a quoted value.
const quote = (s, max = 400) => String(s ?? '')
  .replace(/```+/g, "'''")                 // cannot close a fence it sits inside
  .replace(/^\s{0,3}#{1,6}\s+/gm, '')      // cannot pose as a prompt heading
  .trim()
  .slice(0, max)

// Hook insurance: injection verified for named agentTypes but undocumented —
// every worker self-heals if it arrives cold.
const PREAMBLE =
  'You are dispatched from the batch workflow. If your role memory / project ' +
  'briefing / .agents/*.md digests are not already in your context, load them ' +
  'now (memory skill; read the files). Confirm your slot skill / contract is ' +
  'PRESENT before touching anything — confirming means CHECKING your context ' +
  '(your `skills:` frontmatter content is preloaded; you can see its headings), ' +
  'NEVER re-invoking the Skill tool for a skill you already carry: every ' +
  'invocation pastes the FULL skill text again (measured 2026-08-18: one ' +
  'dispatch re-loaded 10 preloaded skills — ~25k tokens of duplicate context). ' +
  'The Skill tool is for skills genuinely ABSENT from your context — your ' +
  'skills-on-demand, or a preload that visibly failed. ' +
  // The findings channel: a durable gotcha has somewhere to go that is read.
  'Anything worth telling someone that did NOT stop you — a product defect you ' +
  'filed, a place the case text disagrees with the live product, an open ' +
  'question, a gotcha another agent would want — goes in your result\'s ' +
  'findings[] with the right kind — the report is how the LEAD hears it. ' +
  // Two layers (instructions § Agent memory): role memory is LOCAL and
  // gitignored — the ignore IS the protection (ignored files survive
  // `stash -u`/`clean -fd`; the untracked-not-ignored era lost six entries
  // to one wholesale stash, 2026-08-03). The shared, committed layer is
  // .agents/knowledge/ — that is what travels between machines and roles.
  'Durable role knowledge — a live-product quirk, a framework gotcha, a ' +
  'workaround the next dispatch will need — goes in your role memory ' +
  '(memory skill; LOCAL and gitignored — never `git add` it), and when it is ' +
  'cross-role, verified and durable, promote it to .agents/knowledge/ — THAT ' +
  'layer ships. Before writing an APP fact anywhere, check the manual-qa KB ' +
  '(.agents/manual-qa/knowledge/, READ-ONLY): already there -> reference it, ' +
  'never copy (copies drift). You COMMIT WHAT YOU PRODUCE: code, the surface ' +
  'cache, and knowledge promotions alike, `git add` by exact path on the ' +
  'branch you are on. Committed knowledge survives tree cleaning and ' +
  'branch switches, gitignored memory survives sweeps — plain-untracked ' +
  'files are what sweeps delete. ' +
  // Context economy: the bill is resident-context × turns — every turn re-sends
  // your whole context, so turn count and payload size ARE the cost. Field
  // measurement: workers averaged ~30 turns at ~1 tool call per turn.
  'Context economy (hard rules): batch independent tool calls into ONE message ' +
  '(issue non-dependent reads/greps together, never one tool per turn); read a ' +
  'file once and work from what you read (ranged reads for big files; no ' +
  're-reads to double-check what is already in context); keep runner output ' +
  'lean (line/dot reporter, tail long failures — never dump a full HTML report ' +
  'or trace into the transcript); screenshots only when a step fails or visual ' +
  'judgment is the task — save to disk and cite the path instead of re-emitting ' +
  'pixels. Soft budget, a self-check not a cap: ~15 tool turns per case in ' +
  'your unit (batching makes turns dense — 15 batched turns carry what ~40 ' +
  'single-call turns did). A genuinely long case — 30 steps, a deep debug — ' +
  'may exceed it; what the check catches is CIRCLING: re-reading what is ' +
  'already in context, retrying the same probe, exploring without acting. At ' +
  'each ~15-turn mark ask: did the last stretch advance the case, or circle? ' +
  'Advance -> continue. Circle -> act on what you have and record the gap in ' +
  'findings/notes. ' +
  // Field incident 2026-08-03: one `git stash --include-untracked` before a
  // checkout swept 6 freshly written memory entries and 3 run receipts out of
  // the tree. They were recoverable, but every later agent ran without them.
  'NEVER CLEAN THE TREE WHOLESALE. `git stash --include-untracked`, ' +
  '`git clean -fd`, `git checkout -- .` and `git reset --hard` delete work you ' +
  'did not write: run receipts are untracked bookkeeping, and memory or ' +
  'surface-cache notes written since the last commit are just as exposed — all ' +
  'of it vanishes silently. Need a clean tree before a checkout? Stash BY PATH ' +
  '(`git stash push -- <your paths>`) or commit your own work first, and leave ' +
  'everything you did not create alone. ' +
  // Denials block an EFFECT, not the task. Same effect via another shape =
  // evasion; a different allowed route to the goal = adaptation — take it,
  // but on the record, so a human can veto a substitution that broke intent.
  'A PERMISSION DENIAL BLOCKS AN EFFECT, NOT THE TASK. Never re-achieve the ' +
  'SAME blocked effect through a different shape (a script instead of the ' +
  'denied command, an alternate binary, a broader allowed command) — that ' +
  'evades a pattern, not a policy. But a genuinely different allowed route to ' +
  'the task goal — one that does NOT produce the blocked effect — is ' +
  'legitimate: take it and record the substitution in findings/notes (what ' +
  'was denied, what you did instead). No such route -> the case goes blocked ' +
  'with the denial recorded, and you continue with what remains. ' +
  FOREGROUND_RULE

// ---- worker schemas --------------------------------------------------------
// findings[] rides every worker return: orthogonal to whether the work landed.
const FINDINGS = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false,
    required: ['kind', 'note'],
    properties: {
      kind: { type: 'string', enum: ['defect', 'clarification', 'question', 'note'] },
      note: { type: 'string' },
      ref: { type: ['string', 'null'] },   // tracker id for a filed defect
    },
  },
}
// The coverage contract's return shape (mirrors the comment block in the spec):
// full=true only when every step of every case in the unit is asserted. The
// exclusion vocabulary is CLOSED and each category requires a verifiable
// referent — free-text reasons are invalid grammar, blocking at review and
// gate (gate-case.mjs does the mechanical half of this check).
const EXCLUSION_CATEGORIES = ['covered-elsewhere', 'blocked-by-defect', 'un-automatable', 'by-seeded-policy']
const COVERAGE = {
  type: 'object', additionalProperties: false,
  required: ['full', 'excluded'],
  properties: {
    full: { type: 'boolean' },
    excluded: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['step', 'category', 'referent'],
        properties: {
          step: { type: 'string' },        // '<case-id>/<step number>'
          category: { type: 'string', enum: EXCLUSION_CATEGORIES },
          referent: { type: 'string' },    // the existing test / defect id / taxonomy category / policy line
          note: { type: 'string' },
        },
      },
    },
  },
}
// Fix and carve rounds: the build already exists; only built/blocked/escalate.
const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'status', 'branch', 'pr', 'reruns', 'coverage', 'notes', 'findings'],
  properties: {
    // Echo of the unit's case ids EXACTLY as dispatched — the parametric
    // attribution key: the telemetry capture reads it from this return's
    // receipt instead of regex-mining the prompt (field case 2026-08-18:
    // mining minted a phantom case from a run-report filename).
    unit_ids: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['built', 'blocked', 'needs-escalation'] },
    branch: { type: 'string' },
    pr: { type: ['integer', 'null'] },
    reruns: { type: 'integer' },
    // One short root-cause label per rerun. The R2 cap is per CAUSE, not total:
    // 4 reruns on 4 distinct causes is within contract, 3 on one cause is not.
    rerun_causes: { type: 'array', items: { type: 'string' } },
    // Tests that are RED BY DESIGN: the doctrine's answer to a ticketed product
    // defect is `expect.soft()` with a `// Known defect: <TICKET>` comment, which
    // fails loudly and stays failing until the product ships. Correct — and it
    // makes the batch gate unpassable, taking every healthy case down with it
    // (measured: one such case blocked four others). Declaring them lets the gate
    // run them without counting them, and lets a case be reported honestly as
    // `defect-found` on a ticket rather than `delivered`.
    expected_red: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['spec', 'ticket', 'why'],
        properties: {
          spec: { type: 'string' },
          test_id: { type: 'string' },
          ticket: { type: 'string' },
          why: { type: 'string' },
          // Which of the unit's cases the red test belongs to. Omitted/empty =
          // the whole unit. Without this, one ticketed defect in case A's spec
          // would demote every OTHER case on the branch to `defect-found` too.
          case_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    coverage: COVERAGE,
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
// The build slot (all three routes end here): same shape, plus the stops only
// an initial build can hit — `un-automatable` is a REQUEST (the intake
// screening's verdict is the budget; the lead confirms), `needs-execution`
// says the evidence this route was promised did not hold.
const BUILD_SCHEMA = {
  ...IMPL_SCHEMA,
  properties: {
    ...IMPL_SCHEMA.properties,
    status: { type: 'string', enum: ['built', 'blocked', 'un-automatable', 'needs-execution', 'needs-escalation'] },
  },
}
// Triage: one cheap read-only dispatch per batch that reads the seeded
// execution-provider policy and routes every unit.
const TRIAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['provider', 'base_url', 'sizing_present', 'units', 'notes'],
  properties: {
    // What .agents/testing.md § Execution provider actually says (missing file
    // or section -> 'self', the standalone default).
    provider: { type: 'string', enum: ['manual-qa', 'self'] },
    // The concrete live target for test-runner dispatches, resolved from the
    // seeded docs; null when unresolvable (needs-execution units then stop
    // honestly instead of running against a guessed URL).
    base_url: { type: ['string', 'null'] },
    units: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['ids', 'route'],
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          route: { type: 'string', enum: ['manual-qa-verified', 'needs-execution', 'combined'] },
          why: { type: 'string' },
          // manual-qa-verified only: the paths the build dispatch works from
          // (authored case files, the run report, the KB dir).
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    notes: { type: 'string' },
    // The intake sizing/screening pass is the LEAD's step, run before this
    // workflow — nothing here enforces it, so its absence must at least be
    // LOUD: triage attests whether the scope's verdicts file exists, and a
    // false lands a quality_flag in the report (effort fields will be missing
    // from the export, and the reviewer's exclusion-budget cross-check is
    // vacuous without it).
    sizing_present: { type: 'boolean' },
    // findings[] is in the PREAMBLE every dispatch gets — declarable here or
    // an obedient triage returns schema-invalid output (see the merge schema).
    findings: FINDINGS,
  },
}
// The defect-filing slot (needs-execution route, runner FAIL): file and walk
// away — the engineer neither fixes the product nor automates the failing case.
const DEFECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'filed', 'notes', 'findings'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },
    filed: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['case_id', 'ref'],
        properties: {
          case_id: { type: 'string' },
          ref: { type: ['string', 'null'] },   // tracker id; null = filing failed, say why in note
          note: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'verdict', 'coverage', 'findings', 'blocking', 'notes'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },   // echo — see IMPL_SCHEMA
    verdict: { type: 'string', enum: ['APPROVED', 'CHANGES_REQUESTED'] },
    // The coverage the reviewer VERIFIED against the code — not the
    // implementer's declaration echoed back.
    coverage: COVERAGE,
    blocking: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    // WHY a blocking item is still here, per item, on a re-review. This is the
    // loop's real control, and the distinction it encodes is the whole point:
    //
    //   unaddressed     — nobody acted on it. The fixer skipped it, half-did
    //                     it, or forgot it. That is NOT a reason to stop; it is
    //                     the reason to go round again. A loop that quits here
    //                     ships work everyone knew was unfinished.
    //   persists        — a real attempt was made against the right code and
    //                     the problem is still there. THAT is the "can't"
    //                     signal: another round by the same actor cannot help,
    //                     because the obstacle is not effort.
    //   external        — it cannot be resolved on this branch at all (a
    //                     missing framework primitive, a product defect, a
    //                     broken environment). Stop and escalate.
    //
    // Only the reviewer can tell these apart — it is the party that saw both
    // rounds and the diff between them. Comparing finding TEXT across rounds
    // measures phrasing, and counting findings measures neither.
    blocking_detail: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['item', 'status'],
        properties: {
          item: { type: 'string' },
          status: { type: 'string', enum: ['unaddressed', 'persists', 'external'] },
          // The unit case ids this blocker binds. When every surviving blocker
          // is scoped to a PROPER SUBSET of the unit, the loop can SPLIT the
          // unit — carve the stuck cases out and land the rest — instead of
          // blocking all of it. Omitted/empty = binds the whole unit.
          case_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    findings: FINDINGS,
  },
}

// ---- outcome recording (in memory; one writer at close) --------------------
// Every input case gets exactly one row. `outcome` is where it ended — there is
// no transition table, nothing to validate, and no second copy to drift from.
// The vocabulary is closed (see OUTCOMES, NOT STATUSES above): delivered |
// defect-found | blocked | un-automatable | needs-execution | infra-stalled |
// not-started, plus the in-flight markers (built, reviewed) and merged-ungated.
//
// Notes and finding notes are CLIPPED at the source: the report is a routing
// record, not an archive — agents sometimes return essays, and unbounded rows
// inflated one field batch's report-writer prompt to 74k chars, then rode into
// every downstream context that touched the report. The full text is not lost:
// each worker's complete return sits in its receipt under
// `.agents/telemetry/automation/returns/` (SubagentStop hook; legacy
// `_returns/`) and in the run journal.
const CLIP = 400
const clip = (s) => {
  const t = String(s ?? '')
  return t.length <= CLIP ? t : `${t.slice(0, CLIP)}… [clipped; full text in the unit's receipt under .agents/telemetry/automation/returns/ (legacy _returns/)]`
}
const OUTCOME = {}                          // id -> row
for (const c of CASES) OUTCOME[c.id] = { id: c.id, outcome: 'not-started', note: '', findings: [] }
const record = (id, patch) => {
  const p = { ...patch }
  if (typeof p.note === 'string') p.note = clip(p.note)
  OUTCOME[id] = { ...OUTCOME[id], ...p }
}
// A worker handles a whole UNIT, so its findings are recorded against every case
// in it — a finding about the shared flow really does apply to all of them.
// But a unit is dispatched ONCE, so the same finding arrives once and would be
// copied verbatim per member: a family of 2 turned 10 findings into 20 identical
// rows in the report a human reads. Attach one copy per case, and never the same
// (kind, note, ref) twice — a re-review after a fix round legitimately repeats
// what it already said, and the report should show it once.
const addFindings = (ids, list) => {
  for (const f of (Array.isArray(list) ? list : [])) {
    if (!f?.note) continue
    const entry = { kind: f.kind ?? 'note', note: clip(f.note), ...(f.ref ? { ref: f.ref } : {}) }
    const key = `${entry.kind}\u0000${entry.note}\u0000${entry.ref ?? ''}`
    for (const id of ids) {
      const seen = (OUTCOME[id]._findingKeys ??= new Set())
      if (seen.has(key)) continue
      seen.add(key)
      OUTCOME[id].findings.push(entry)
    }
  }
}
// Build-slot stops that are not 'built' map straight to a case outcome.
const IMPL_STOP = {
  blocked: 'blocked',
  'un-automatable': 'un-automatable',
  'needs-execution': 'needs-execution',
  'needs-escalation': 'blocked',
}

// ---- circuit breaker + account ceiling -------------------------------------
// The breaker exists for a DEAD ENVIRONMENT — causes where case N+1 fails
// exactly like case N, so stopping after three saves the rest of the batch. It
// must never fire on an ACCOUNT ceiling: three consecutive session-limit hits
// once tripped it inside a 109-case dispatch and cascaded ~100 healthy cases to
// not-started. A quota ceiling is a clock, not a batch defect.
let breakerCause = null
let breakerRun = 0
let breakerTripped = false
let quotaHalted = false
const QUOTA_RE = /(session limit|usage limit|rate.?limit|quota|resets? (at|in) )/i
function noteQuotaHalt(why) {
  if (quotaHalted) return
  quotaHalted = true
  log(`ACCOUNT CEILING reached — halting admission (not a batch failure): ${why}. ` +
      'Re-invoke with the same args plus resumeFromRunId AND quotaResume: true once the limit resets; completed units replay from cache, and quotaResume keeps the REPLAYED ceiling note from re-halting the run at the same unit.')
}
function breakerCount(cause, why = '') {
  if (QUOTA_RE.test(why)) { if (!QUOTA_RESUME) noteQuotaHalt(why.slice(0, 160)); return }
  if (cause === breakerCause) breakerRun++
  else { breakerCause = cause; breakerRun = 1 }
  if (!breakerTripped && breakerRun >= BREAKER) {
    breakerTripped = true
    log(`circuit breaker TRIPPED — ${breakerRun} consecutive '${cause}' stops; remaining units stay not-started` +
      (cause === 'agent-died'
        ? ' (agents dying without a return is ALSO what an account ceiling looks like from here — check the last transcript before treating this as a batch defect)'
        : ''))
  }
}

// ---- infra stalls ----------------------------------------------------------
// The harness kills a subagent whose model stream stops making progress and
// retries it a few times; when EVERY attempt stalls, agent() THROWS ("agent
// stalled on all N attempts") instead of returning null. Field case
// 2026-08-17, quota-throttled Bedrock: one build slot burned 11 attempts
// across two runs — every kill was dead air right after a completed
// tool_result, one attempt never received a single model token — and the
// uncaught throw took the whole run down, report and all. A stall says
// NOTHING about the case: the model stopped streaming, the case was never
// judged. So it gets its own outcome, `infra-stalled` — like `not-started` it
// re-enters the next batch untouched, but the fix is the ENVIRONMENT
// (provider quota, stream stability), and a retried unit may hold checkpoint
// commits on its branch worth continuing from (see CHECKPOINT_RULE).
const isStall = (e) => /stall/i.test(String(e?.message ?? e))
const stallNote = (where, e) =>
  `harness stall during ${where}: ${String(e?.message ?? e).slice(0, 140)} — the model stream stopped ` +
  '(quota-throttled providers do this), nothing was learned about the case; fix the environment before ' +
  're-entering, and check the unit branch for checkpoint commits first'

// ---- admission guards ------------------------------------------------------
// The reasons a unit is not even started (account ceiling, breaker, budget
// reserve) — shared by the execution and build slots.
function admitUnit(unit, where) {
  const ids = unit.map((c) => c.id)
  if (quotaHalted) {
    ids.forEach((id) => record(id, { note: `account ceiling — admission halted before ${where}` }))
    log(`${label(unit)} not started — account ceiling`)
    return false
  }
  if (breakerTripped) {
    ids.forEach((id) => record(id, { note: `circuit breaker: ${breakerRun} consecutive '${breakerCause}' stops` }))
    log(`${label(unit)} not started — circuit breaker (${breakerCause})`)
    return false
  }
  if (budget.total && budget.remaining() < RESERVE) {
    ids.forEach((id) => record(id, { note: 'token budget reserve reached' }))
    log(`${label(unit)} not started — budget reserve reached`)
    return false
  }
  return true
}

// ---- triage: the router ----------------------------------------------------
// One cheap read-only dispatch per batch. It reads the seeded policy and
// routes every unit; nothing else about the pipeline moves. Routes:
//   manual-qa-verified — the manual-qa team already executed every case in the
//     unit live with verdict PASS: build from their evidence, NO re-execution.
//   needs-execution    — provider is manual-qa and the evidence is missing or
//     not PASS: their test-runner executes each case before anything is built.
//   combined           — provider is self: one engineer dispatch derives the
//     spec from the case and builds; its first green run IS the execution.
const ROUTES = new Map()      // sorted unit ids -> route
const MQ_EVIDENCE = new Map() // sorted unit ids -> evidence paths (manual-qa-verified)
const routeKey = (ids) => [...ids].sort().join('+')
let DEFAULT_ROUTE = null      // provider-derived; null = triage died, nothing runs
let SIZING_PRESENT = null     // triage-attested; false lands a quality_flag
const routeOf = (unit) => ROUTES.get(routeKey(unit.map((c) => c.id))) ?? DEFAULT_ROUTE

async function runTriage() {
  const t = await agent(
    `${PREAMBLE}\n\nTriage slot — a READ-ONLY routing decision: no git, no browser, no writes of any kind. ` +
    'FIRST read the seeded policy: `.agents/testing.md` § Execution provider says WHO executes cases — ' +
    "'manual-qa' (that factory co-installs and owns live case execution) or 'self'. A missing file or " +
    "section means 'self' (the standalone default). Return the provider you read. Also resolve base_url — " +
    'the concrete live target for test-runner dispatches — from `.agents/testing.md` § Base URL mapping ' +
    '(the var it names, via `.agents/profile.md` § Environment & access or the env files it points at); ' +
    'return null if you cannot resolve a real URL — never guess one. ' +
    `Also check whether the intake sizing/screening pass ran for this scope: \`.agents/estimation/${SLUG}-verdicts.json\` (or a scored verdicts file naming this batch under \`.agents/estimation/\`) — return sizing_present accordingly; do not run the pass yourself.\n` +
    'Then route each unit below:\n' +
    "- provider 'self' -> route EVERY unit 'combined': one engineer dispatch derives the spec from the case and builds it; its first green run against the real system IS the case's first execution.\n" +
    "- provider 'manual-qa' -> route 'manual-qa-verified' ONLY when EVERY case in the unit has a manual-qa run record with verdict PASS — `reports/RUN-*.md` with the case id showing Pass in its Results table (metrics `reports/metrics/*.json` are OPTIONAL corroboration: the metrics add-on may not be installed) — AND its authored case file exists (commonly `tasks/<suite>/<ID>_*.md`) — list those paths in evidence[] (each case file + the run report; the `.agents/manual-qa/` KB dir once). Run age does not matter; a FAIL/flaky/blocked run never qualifies. Anything less — no run, no case file, a non-PASS verdict, your own doubt — routes 'needs-execution': the workflow dispatches manual-qa's test-runner per case before building. NEVER route a manual-qa project 'combined' — self-execution against the seeded policy is the one wrong answer here.\n" +
    `Units:\n${UNITS.map((unit) => `- ${unit.map((c) => `${c.id}${c.title ? ` (${quote(c.title, 80)})` : ''}`).join(' + ')} — snapshots: ${unit.map((c) => SRC(c.id)).join(' , ')}`).join('\n')}\n` +
    'Return ONE entry per unit with ids EXACTLY as listed — a unit shown as "A + B" is ONE entry with ids ["A","B"], never two entries. A split or partial unit cannot be matched back and falls to the provider default, wasting the evidence check you just did.',
    { label: 'triage', phase: 'Triage', agentType: TYPES.implementer, model: A.triageModel ?? 'haiku', effort: 'low', schema: TRIAGE_SCHEMA }
  )
  if (!t) return null
  SIZING_PRESENT = t.sizing_present === true
  if (!BASE_URL && t.base_url) BASE_URL = quote(t.base_url, 200)
  // Reassemble the return BY CASE COVERAGE, not by exact unit key. Field case
  // 2026-08-18: triage was shown the cluster "TC-001 + TC-002", chose
  // manual-qa-verified CORRECTLY — and returned it as two per-case rows; the
  // old exact-key guard silently dropped both. Per-case votes keep both
  // protections: an id naming no case does nothing (hallucination guard), and
  // a unit takes a route ONLY when EVERY member voted the SAME one — the mq
  // eligibility rule is per-case anyway. Partial or conflicting coverage stays
  // on the provider default, and both anomalies are logged, not silent.
  const unitOf = new Map()   // case id -> its unit's routeKey
  for (const unit of UNITS) { const k = routeKey(unit.map((c) => c.id)); for (const c of unit) unitOf.set(c.id, k) }
  const votes = new Map()    // unit key -> Map(case id -> route)
  const evid = new Map()     // unit key -> union of mq evidence paths
  let foreign = 0
  for (const r of t.units ?? []) {
    if (!Array.isArray(r.ids)) continue
    for (const id of r.ids) {
      const k = unitOf.get(id)
      if (!k) { foreign++; continue }
      if (!votes.has(k)) votes.set(k, new Map())
      votes.get(k).set(id, r.route)
      if (r.route === 'manual-qa-verified') evid.set(k, [...new Set([...(evid.get(k) ?? []), ...(r.evidence ?? [])])].slice(0, 12))
    }
  }
  const returnedKeys = new Set((t.units ?? []).filter((r) => Array.isArray(r.ids)).map((r) => routeKey(r.ids)))
  let reshaped = 0
  for (const unit of UNITS) {
    const ids = unit.map((c) => c.id)
    const k = routeKey(ids)
    const v = votes.get(k)
    if (!v || v.size !== ids.length) continue          // partial coverage -> provider default
    const routes = new Set(v.values())
    if (routes.size !== 1) continue                    // members disagree -> provider default
    const route = routes.values().next().value
    ROUTES.set(k, route)
    if (route === 'manual-qa-verified') MQ_EVIDENCE.set(k, evid.get(k) ?? [])
    if (ids.length > 1 && !returnedKeys.has(k)) reshaped++
  }
  if (foreign) log(`triage returned ${foreign} id(s) naming no case in this batch — ignored`)
  if (reshaped) log(`triage split ${reshaped} cluster(s) into per-case rows — reassembled by coverage (unanimous route required)`)
  const counts = {}
  for (const unit of UNITS) { const r = ROUTES.get(routeKey(unit.map((c) => c.id))) ?? (t.provider === 'manual-qa' ? 'needs-execution' : 'combined'); counts[r] = (counts[r] ?? 0) + 1 }
  log(`triage: provider=${t.provider}, base_url=${BASE_URL ?? 'unresolved'} — ${Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ')}`)
  return t
}

// ---- execution: manual-qa's test-runner, per case --------------------------
// Their contract, verbatim: one prompt line, and the result arrives as one
// trailing ```json block (result: PASS | FAIL | BLOCKED). No PREAMBLE and no
// schema — the runner is manual-qa's agent and keeps its own contract; this
// workflow parses the block instead of imposing a shape.
const parseRunnerReturn = (raw) => {
  if (raw && typeof raw === 'object') return raw.result ? raw : null
  const m = [...String(raw ?? '').matchAll(/```json\s*([\s\S]*?)```/g)].pop()
  if (!m) return null
  try { const j = JSON.parse(m[1]); return j?.result ? j : null } catch { return null }
}
const RUNNER_GONE_NOTE =
  "manual-qa's test-runner could not be dispatched on this host — the seeded policy says manual-qa " +
  'executes cases, so NOTHING was run (self-execution against the policy is never the fallback). ' +
  'Run the manual-qa suite over this case (their test-run-lead), then re-run the batch.'
let runnerGone = false   // a spawn refusal (unknown agent type) — later dispatches would refuse the same way

async function runExecution(unit) {
  const passed = []   // { id, evidence } — proceed to build with that evidence
  const failed = []   // { id, step, why, screenshot } — defect route
  for (const c of unit) {
    if (quotaHalted || breakerTripped) { record(c.id, { note: `${quotaHalted ? 'account ceiling' : 'circuit breaker'} — halted before execution` }); continue }
    if (runnerGone) { record(c.id, { outcome: 'needs-execution', note: RUNNER_GONE_NOTE }); continue }
    if (!BASE_URL) {
      record(c.id, { outcome: 'needs-execution', note: 'no base URL resolvable (args.baseUrl / .agents/testing.md § Base URL mapping) — the test-runner dispatch cannot be formed; run the manual-qa suite and re-run the batch' })
      continue
    }
    let raw = null
    try {
      raw = await agent(
        `Execute the test case at ${SRC(c.id)} against base_url=${BASE_URL}`,
        { label: `execute:${c.id}`, phase: 'Execution', agentType: TYPES.runner }
      )
    } catch (e) {
      if (isStall(e)) {
        record(c.id, { outcome: 'infra-stalled', note: stallNote('execution', e) })
        breakerCount('agent-died', String(e?.message ?? e))
        continue
      }
      // A throw at spawn is what an unknown agent type looks like (field case
      // 2026-08-17: a contradictory prompt got a dispatch refused before its
      // first turn) — every later runner dispatch would refuse identically.
      runnerGone = true
      record(c.id, { outcome: 'needs-execution', note: RUNNER_GONE_NOTE })
      continue
    }
    const v = parseRunnerReturn(raw)
    if (!v) {
      record(c.id, { outcome: 'needs-execution', note: raw == null ? `test-runner died without a return — ${RUNNER_GONE_NOTE}` : 'test-runner returned no parseable trailing json verdict — run the manual-qa suite for this case and re-enter' })
      continue
    }
    if (v.result === 'PASS') {
      passed.push({
        id: c.id,
        evidence: `${c.id}: PASS ${v.steps_completed ?? '?'}/${v.steps_total ?? '?'} steps` +
          `${v.screenshot ? `, screenshot ${quote(v.screenshot, 160)}` : ''}` +
          `${v.duration_seconds ? `, ${v.duration_seconds}s` : ''} (manual-qa test-runner, this batch)`,
      })
    } else if (v.result === 'FAIL') {
      failed.push({ id: c.id, step: v.failure_step ?? '?', why: quote(v.failure_reason ?? v.notes, 240), screenshot: v.screenshot ? quote(v.screenshot, 160) : null })
    } else if (v.result === 'BLOCKED') {
      record(c.id, { outcome: 'blocked', note: `manual-qa test-runner BLOCKED: ${quote(v.failure_reason ?? v.notes, 200) || 'no reason returned'} — clear the blocker and re-enter` })
    } else {
      // Anything outside the runner's PASS|FAIL|BLOCKED contract is an
      // unknown, not a blocker — don't fabricate a BLOCKED the runner never
      // returned; the case simply still needs a real execution.
      record(c.id, { outcome: 'needs-execution', note: `test-runner returned unrecognized verdict '${quote(String(v.result), 40)}' — run the manual-qa suite for this case and re-enter` })
    }
  }
  // Defect route: FAIL means the live product contradicts the case — the case
  // is NOT automated until the product is fixed. The engineer files per its
  // defect-filing discipline and walks away.
  if (failed.length) {
    const fids = failed.map((f) => f.id)
    let filed = null
    try {
      filed = await agent(
        `${PREAMBLE}\n\nDefect-filing slot — manual-qa's test-runner just executed ${fids.join(', ')} against the live product and FAILED:\n` +
        failed.map((f) => `- ${f.id}: step ${quote(String(f.step), 20)}: ${f.why}${f.screenshot ? ` (screenshot: ${f.screenshot})` : ''}`).join('\n') +
        '\nFile ONE defect per case per your defect-filing discipline (test-automation-implementation references/defect-filing.md — the pristine-repro gate applies before anything is filed). ' +
        'File and walk away: you do not fix the product, you do not automate the failing case, and you do not re-litigate the runner\'s verdict — a repro that does NOT reproduce goes in the filed[] note instead of a ticket. ' +
        `Return unit_ids EXACTLY as given here: [${fids.join(', ')}], and one filed[] entry per case with the tracker ref (null if filing failed — say why in its note).`,
        { label: `defects:${fids.join('+')}`, phase: 'Execution', agentType: TYPES.implementer, ...WORKER, schema: DEFECT_SCHEMA }
      )
    } catch (e) {
      log(`defect-filing dispatch ${isStall(e) ? 'infra-stalled' : 'threw'} — FAIL cases keep defect-found, defects must be filed by hand`)
    }
    if (filed) addFindings(fids, filed.findings)
    const refOf = new Map((filed?.filed ?? []).map((f) => [f.case_id, f]))
    for (const f of failed) {
      const r = refOf.get(f.id)
      record(f.id, {
        outcome: 'defect-found',
        note: `manual-qa test-runner FAILED at step ${f.step}: ${f.why} — ` +
          (r?.ref ? `defect ${r.ref} filed` : `defect NOT filed (${quote(r?.note, 120) || 'filing dispatch produced no ref'}) — file by hand from the runner's evidence`) +
          '; not automated until the product is fixed',
      })
      addFindings([f.id], [{ kind: 'defect', note: `test-runner FAIL at step ${f.step}: ${f.why}`, ref: r?.ref ?? null }])
    }
  }
  return passed
}

// ---- the build slot: one engineer dispatch, case -> code --------------------
// All three routes end here. The case is the source of truth (TA never edits
// it); the spec derives from it directly — there is no intermediate artifact.
// What differs per route is execution provenance: evidence (manual-qa-verified
// and post-execution units) versus the first green run itself (combined).
async function runBuild(members, evidence, route) {
  const ids = members.map((c) => c.id)
  if (!admitUnit(members, 'build')) return null

  const provenance = route === 'combined'
    ? 'EXECUTION DOCTRINE (provider self): there is no separate "execute the case first" ritual — the FIRST GREEN RUN of your test against the real system IS the case\'s first execution. A live browser (Playwright MCP / browser-verify) is an INVESTIGATION tool at your discretion: extract a locator, clarify a step, find out why the direct approach fails — targeted probes of minutes, never a full pre-automation walkthrough. If a green run is unreachable because the PRODUCT contradicts the case, that is a defect: file it per your defect-filing discipline (references/defect-filing.md), declare the red test in expected_red[], and say so in findings. '
    : `EXECUTION PROVENANCE: this unit was already executed live by manual-qa — do NOT re-execute a case end-to-end in a browser (a targeted probe for a locator or a wait is fine; a full walkthrough re-buys what the evidence already paid for). Evidence to build from: ${evidence.length ? evidence.join(' ; ') : '(none listed — treat as thin, probe live for what is missing)'} plus the .agents/manual-qa/ KB. Cite the manual-qa run as the unit's execution provenance in your PR/notes. ${route === 'manual-qa-verified' ? 'If the evidence does not hold for a case (no PASS verdict, case file missing, contradicts the snapshot), return status needs-execution and STOP — under the manual-qa provider you never execute the case yourself. ' : ''}`

  const b = await agent(
    `${PREAMBLE}\n\nBuild slot — turn ${members.map((c) => `${c.id}${c.title ? ` (${quote(c.title, 120)})` : ''}`).join(', ')} into automated tests in ONE dispatch, per your test-automation-implementation skill (preloaded; confirm per the preamble). ` +
    `THE CASE IS THE SOURCE OF TRUTH and you never edit it. Read each case in full first: ${ids.map((id) => SRC(id)).join(' , ')} (written at intake; ONLY if missing, fetch via the project's TMS adapter (.agents/test-automation.yaml) and note the gap). Derive what to automate straight from its steps and expected results — there is no intermediate spec artifact. ` +
    provenance +
    'LOCATOR LADDER (cheapest first): (1) the surface cache `.agents/automation/surface/<feature>.md` — verify handles as you use them; (2) manual-qa knowledge, READ-ONLY: `.agents/manual-qa/app_profile.md` § Reliable Selectors and § Fragile Areas — reference their facts, never copy them; (3) the case file itself; (4) targeted live probing. Everything a live probe teaches you goes BACK into the surface cache: create or update the feature\'s file and commit it on your branch with the code. ' +
    'Authored cases template `{{base_url}}`; your code resolves the project\'s base-URL config var per `.agents/testing.md` § Base URL mapping — never hardcode the URL. ' +
    `YOU OWN THE TREE and nothing else runs. Ensure the batch trunk first: \`git rev-parse --verify ${TRUNK}\` — check it out if it exists anywhere; if it exists NOWHERE, \`git checkout -B ${TRUNK} ${BASE}\` (never -B an existing trunk — that discards merged units), then \`git push -u origin ${TRUNK}\` ONLY if this project pushes to a remote (\`.agents/profile.md\` § Automation PR policy / \`git remote -v\`); on a local-only project skip pushes, that is expected, not a failure. THEN cut your feature branch FROM ${TRUNK} — it already carries every unit that finished before you, so page-object and fixture work accumulates and you are never rebasing onto a surprise. Stay on your own feature branch and stage ONLY your own paths (\`git add <paths>\`, never \`-A\`/\`.\`). ` +
    (members.length > 1
      ? `CLUSTER unit: ${members.length} similar cases on ONE branch. Write ONE parameterized spec (a data row per case, each row asserting its OWN expected values, its case id tagged on its row's test so it fails by itself) ONLY where the cases are true variants of one flow — never flatten distinct expected values into a shared assertion: that is how a case silently stops being tested. Cases that merely share a surface get SEPARATE specs; shared page objects and fixtures are of course reused. `
      : '') +
    'COVERAGE CONTRACT — every delivered spec carries the machine-findable comment block: `<case-id> coverage: steps <list>` plus, where steps are excluded, `<case-id> excluded: <step> (<category>: <referent> — <note>)`. The categories are CLOSED — covered-elsewhere (referent: the existing test that asserts it) | blocked-by-defect (filed defect id) | un-automatable (automation-scoping complexity-taxonomy category) | by-seeded-policy (the policy line in .agents/testing.md) — and every one REQUIRES its referent; free-text reasons ("flaky", "hard", "not needed") are invalid grammar and block at review and gate. Every case step traces to an assertion or an explicit exclusion; the case id appears in the test\'s identity (title/annotation/tag); the project\'s § Coverage idiom (.agents/testing.md) rides on top, the baseline block is always present regardless. You cannot MINT un-automatable beyond what the intake screening judged (the automation-scoping verdicts) — request it with status needs-escalation instead, naming the step and why. ' +
    'If any assertion is red for a PRODUCT reason with a ticket (the `expect.soft()` + `// Known defect: <TICKET>` case), that test is RED BY DESIGN and stays red until the product ships. Do NOT weaken it — declare it in expected_red[] with the spec path, the test id, the ticket, one line of why, and (in a multi-case unit) the case_ids the red test belongs to, so only THOSE cases are held on the ticket and not their healthy neighbours on the same branch. The gate then runs it without counting it against the batch, and the affected case is reported defect-found on that ticket instead of delivered. An undeclared red-by-design test makes the gate unpassable and blocks every healthy case beside it. ' +
    'Implement inside the existing framework, run green ONCE locally (determinism is the gate\'s job, not repeated local runs), retry budget ≤ 2 reruns on the SAME root cause — distinct causes each get their own budget — then land per `.agents/profile.md` § Automation PR policy: where the project uses PRs, open yours against ' + TRUNK + `, NOT against ${BASE} — case PRs land on the batch trunk, and one PR takes the trunk to ${BASE} after the gate; on a project with no PR mechanism leave your feature branch ready for the merge step. Leave the tree on your feature branch either way. ` +
    CHECKPOINT_RULE +
    'If you cannot proceed because of an ACCOUNT/USAGE LIMIT (not a problem with the app or the case), say exactly that in notes — it stops the batch cleanly instead of stopping healthy cases. ' +
    `Return unit_ids EXACTLY as given here: [${ids.join(', ')}] — it keys this dispatch's telemetry attribution; never add, drop, or reformat ids. ` +
    'Return status/branch/pr/reruns (plus rerun_causes: one short root-cause label per rerun — the cap is per cause, not total), expected_red[], and coverage: full=true only when every step of every case is asserted; otherwise full=false with one excluded[] entry per excluded step ({step: "<case-id>/<step>", category, referent, note}) mirroring the comment blocks in your specs.',
    { label: `build${route === 'combined' ? '' : ':mq'}:${label(members)}`, phase: 'Build', agentType: TYPES.implementer, ...WORKER, schema: BUILD_SCHEMA }
  )
  if (!b) {
    // A null return is an agent that DIED (skipped, interrupted, terminal API
    // error) — which is also exactly what an account ceiling looks like from
    // here. Its own breaker cause, so a trip names that ambiguity.
    breakerCount('agent-died', '')
    ids.forEach((id) => record(id, { outcome: 'not-started', note: 'build agent died without a return — a harness death, nothing was learned about the case (it re-enters the next batch untouched); if several died in a row, suspect the account ceiling before the environment' }))
    return null
  }
  addFindings(ids, b.findings)
  if (b.status !== 'built') {
    if (QUOTA_RE.test(b.notes ?? '')) {
      // A ceiling is a HARNESS stop, not a case verdict: those cases are
      // not-started — nothing was learned — per playbook § blocked vs not-started.
      if (!QUOTA_RESUME) noteQuotaHalt((b.notes ?? '').slice(0, 160))
      ids.forEach((id) => record(id, { outcome: 'not-started', note: 'account ceiling — nothing was learned about the case; it re-enters the next batch untouched' }))
      return null
    }
    breakerCount('blocked', b.notes ?? '')
    const oc = IMPL_STOP[b.status] ?? 'blocked'
    ids.forEach((id) => record(id, {
      outcome: oc,
      note: (b.notes || b.status) + (b.status === 'un-automatable'
        ? ' — an ESCALATION: the intake screening did not sanction this; the lead confirms against the automation-scoping verdicts before accepting'
        : b.status === 'needs-execution'
          ? ' — run the manual-qa suite over this case, then re-run the batch'
          : ''),
    }))
    log(`${label(members)} → ${oc}: ${clip(b.notes || b.status)}`)
    return null
  }
  // Any completed build proves the environment is alive, whatever it concluded.
  breakerCause = null; breakerRun = 0
  return b
}

const REVIEW_LENSES = [
  'correctness (every case step asserted AT its step with its OWN expected values — not only end-state; wrong-step and wrong-value assertions)',
  'honesty of coverage (the coverage block vs the code: silent gaps, invalid categories, unverifiable referents, exclusions beyond the intake verdict; masking — test.fail/skip/soft-pass, catch-and-ignore, weakened assertions)',
  'maintainability (locator ladder respected — surface cache, then manual-qa knowledge, then the case, then probing; page-object/fixture reuse; surface-cache write-back committed with the code)',
]

function reviewOnce(u, impl, fixNote, lens) {
  const ids = u.members.map((m) => m.id)
  return agent(
    `${PREAMBLE}\n\nReviewer slot — STATIC review of ${ids.join(', ')} per the test-automation-workflow skill's references/reviewer-contract.md. ` +
    'You are engineer-TYPED by design: independence here is a clean context plus that contract — load your code-review skill (on-demand) if it is not in your context. ' +
    'Do not execute the unit\'s specs (the hardening gate does); the ONE sanctioned run is touching a covered-elsewhere referent, below. ' +
    `Branch: ${impl.branch}. PR: ${impl.pr ?? 'n/a'}. ` +
    'Read the diff via `git diff <base>...<branch>` — do NOT check the branch out (the tree is shared and a build may follow yours). ' +
    `FIRST read each case snapshot (${ids.map((id) => SRC(id)).join(' , ')}; fetch via the TMS adapter only if missing), then WALK EVERY CASE STEP against the diff: each step ends in an assertion AT that step, or in an explicit exclusion line in the spec's coverage block. A silent gap — a step neither asserted nor excluded — is CHANGES_REQUESTED. ` +
    'COVERAGE GRAMMAR: `<case-id> coverage: steps <list>` / `<case-id> excluded: <step> (<category>: <referent> — <note>)`; categories are closed (covered-elsewhere | blocked-by-defect | un-automatable | by-seeded-policy) and each REQUIRES a verifiable referent — a free-text reason is invalid grammar and blocking. TOUCH every referent, never take it on faith: covered-elsewhere -> run the named test once and confirm it asserts what the exclusion claims (at that step, not merely the same screen); blocked-by-defect -> open the filed defect; un-automatable -> check the category exists in the automation-scoping complexity taxonomy; by-seeded-policy -> read the policy line in .agents/testing.md. ' +
    'CROSS-CHECK THE INTAKE VERDICT: exclusions must fit what the intake screening judged (the automation-scoping verdicts file for this scope, `.agents/estimation/<scope>-verdicts.json` where present) — an un-automatable the screening did not see is blocking; the engineer may REQUEST it (escalation to the lead), never mint it. ' +
    (ids.length > 1 ? 'Where several cases share one parameterized spec: per-ROW verification — every case id maps to a data-table row whose DISTINCT expected values are actually asserted; a shared flattened assertion is CHANGES_REQUESTED. ' : '') +
    'The masking hunt is yours: test.fail/skip/soft-pass patterns, catch-and-ignore, weakened assertions — a hidden red is blocking (the declared, ticketed expected_red pattern is the one sanctioned exception). ' +
    (lens ? `Your assigned review lens — judge ONLY through it: ${lens}. ` : 'Cover the step walk, the coverage grammar, and the masking hunt. ') +
    (fixNote
      ? `This is the re-review after a fix round. Prior blocking findings:\n${fixNote}\n` +
        'For EVERY item you still block on, put an entry in blocking_detail[] with the status that is TRUE OF THE DIFF, not of your patience:\n' +
        '  - `unaddressed` — you can see no serious attempt against it. Nothing in the diff touches the code it names, or the change is cosmetic/partial. Forgotten and half-done both count here.\n' +
        '  - `persists` — a genuine attempt was made against the right code and the problem is still present. Say in notes what was tried and why it did not work.\n' +
        '  - `external` — it cannot be resolved on this branch at all: a framework primitive is missing, it is a product defect, the environment is broken.\n' +
        'Scope every blocking_detail entry with case_ids[] — the ids from THIS unit the blocker actually binds. Omit case_ids only when it truly holds the whole unit (a shared fixture, the parameterized spec itself, a framework gap). Scoping is load-bearing: when every surviving blocker is confined to a subset of the cases, the workflow carves those cases out and lands the rest — an unscoped entry chains all the finished cases to the fate of one stuck one.\n' +
        'This decides whether the case gets another round. `unaddressed` sends it back — that is the point, and you must not use `persists` to end a loop you are tired of. Reserve `persists` for a real attempt that really failed; the difference is whether more effort could plausibly fix it. A NEW item you are raising for the first time is not in this list at all — new ground is progress and needs no status.\n'
      : '') +
    `Return unit_ids EXACTLY as given here: [${ids.join(', ')}] — it keys this dispatch's telemetry attribution. ` +
    'Return coverage as you VERIFIED it against the code (full + excluded as they actually stand — not the implementer\'s declaration echoed back). ' +
    'blocking[] is what must change before this can land; anything else worth saying goes in findings[].',
    { label: `review:${ids.join('+')}${lens ? `:${lens.split(' ')[0]}` : ''}`, phase: 'Build', agentType: TYPES.reviewer, ...REV, schema: REVIEW_SCHEMA }
  )
}

async function review(u, impl, fixNote) {
  if (!PANEL) return reviewOnce(u, impl, fixNote, null)
  const rs = (await parallel(REVIEW_LENSES.map((l) => () => reviewOnce(u, impl, fixNote, l)))).filter(Boolean)
  if (!rs.length) return null
  // blocking_detail unions across the panel. No voting: one lens reporting
  // `unaddressed` is enough to earn another round, because it is a claim about
  // the diff — either something was acted on or it wasn't — and a lens that
  // looked closer is not outvoted by two that didn't.
  return {
    verdict: rs.every((r) => r.verdict === 'APPROVED') ? 'APPROVED' : 'CHANGES_REQUESTED',
    blocking: rs.flatMap((r) => r.blocking ?? []),
    notes: rs.map((r) => r.notes).filter(Boolean).join(' | '),
    findings: rs.flatMap((r) => r.findings ?? []),
    blocking_detail: rs.flatMap((r) => r.blocking_detail ?? []),
    // The honesty-of-coverage lens owns the coverage judgment; fall back to the
    // first lens that returned one.
    coverage: (rs.find((r) => !(r.coverage?.full ?? true)) ?? rs.find((r) => r.coverage))?.coverage ?? null,
  }
}

/**
 * Should the loop go round again?
 *
 * Keep going while ANY blocking item is `unaddressed` — work nobody attempted
 * is not a reason to stop, it is the reason to continue. Stop only when every
 * remaining blocker is one the same actor cannot move: attempted and still
 * failing (`persists`), or not resolvable on this branch (`external`).
 *
 * A re-review that classifies nothing is treated as "keep going": the items are
 * new ground, and new ground is progress. The runaway backstop still binds.
 */
function loopVerdict(review) {
  const detail = review?.blocking_detail ?? []
  // Unclassified. Default to going again — the bias belongs on the side of
  // finishing the work — but say it was unclassified so the caller can stop if
  // it keeps happening. A reviewer that never classifies would otherwise burn
  // every round of the backstop and report nothing about why.
  if (!detail.length) return { go: true, why: null, unclassified: true }
  const unaddressed = detail.filter((d) => d.status === 'unaddressed')
  if (unaddressed.length) return { go: true, why: null, unaddressed: unaddressed.map((d) => d.item) }
  const external = detail.filter((d) => d.status === 'external').map((d) => d.item)
  const persists = detail.filter((d) => d.status === 'persists').map((d) => d.item)
  // Which cases the survivors bind. Meaningful only when EVERY survivor is
  // scoped — one unit-wide blocker (no case_ids) stalls the whole unit, and
  // the caller must not carve on a partial map.
  const scoped = detail.every((d) => Array.isArray(d.case_ids) && d.case_ids.length > 0)
  return {
    go: false,
    stuck: scoped ? [...new Set(detail.flatMap((d) => d.case_ids))] : null,
    why: external.length
      ? `not resolvable on this branch: ${external.join('; ').slice(0, 160)}`
      : `attempted and still failing: ${persists.join('; ').slice(0, 160)}`,
  }
}

// Tests the batch KNOWS are red: ticketed product defects the doctrine says to
// assert softly rather than hide. The gate runs them and reports them, but they
// do not count against its green requirement — otherwise one ticketed defect
// makes the batch unpassable forever.
const EXPECTED_RED = []
const merged = []            // [{ ids, branch, pr }] — units landed on the trunk
const parked = []            // [{ ids, branch, why }] — reviewed but not merged

async function buildUnit(u, impl) {
  // `impl` is the build slot's finished return — review, fix rounds, and the
  // merge step take it from here.
  let ids = u.members.map((m) => m.id)   // shrinks if the unit is split mid-loop
  const ul = ids.join('+')               // label keeps the original unit name

  const workspaceNote =
    'You work in the project\'s ONE working tree — its real checkout, with its installed dependencies and its env files. No worktree is created for you and you must not create one. NOTHING else runs while you do: units are strictly sequential, so the tree is yours alone for the whole dispatch. Two rules keep it usable for whoever comes next: stay on your own feature branch (never switch the tree to anything else), and stage ONLY your own paths (`git add <paths>`, never `-A`/`.`) so a stray artifact does not ride in on your commit. Leave the tree on your branch when you finish — the merge step takes it from there and returns it to the trunk. '

  addFindings(ids, impl.findings)
  // The R2 cap is per ROOT CAUSE, not total — 4 reruns on 4 distinct causes is
  // within contract. Capping on the total conflated the two (measured twice in
  // the field: healthy units blocked as "R2 cap exceeded (4 reruns)" and the
  // lead hand-editing report.json to undo it). Without rerun_causes the total
  // is all there is, so the old conservative check stands as the fallback.
  const causeCounts = (impl.rerun_causes ?? []).reduce((m, c) => { m[c] = (m[c] ?? 0) + 1; return m }, {})
  const worstCause = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0]
  if (worstCause ? worstCause[1] > 2 : impl.reruns > 2) {
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `R2 cap exceeded (${worstCause ? `${worstCause[1]} reruns on "${worstCause[0]}"` : `${impl.reruns} reruns, causes not reported`}) — classify architectural vs case-drift vs product-change` }))
    return null
  }
  // Red-by-design declarations arrive from the build AND from any fix round (a
  // fixer restoring a weakened assertion declares it here too — dropping those
  // made the gate unpassable for exactly the case the mechanism exists for).
  // Attribution is per entry: an entry naming case_ids holds only those cases;
  // one naming none holds the whole unit.
  const noteRed = (list) => {
    const reds = Array.isArray(list) ? list : []
    if (!reds.length) return
    for (const r of reds) EXPECTED_RED.push({ ...r, unit: ul })
    log(`${ul}: ${reds.length} test(s) red by design — ${reds.map((r) => r.ticket).join(', ')}`)
    for (const id of ids) {
      const mine = reds.filter((r) => !Array.isArray(r.case_ids) || r.case_ids.length === 0 || r.case_ids.includes(id))
      if (mine.length) OUTCOME[id]._expectedRed = [...(OUTCOME[id]._expectedRed ?? []), ...mine]
    }
  }
  noteRed(impl.expected_red)
  ids.forEach((id) => record(id, { outcome: 'built', branch: impl.branch, pr: impl.pr ?? undefined, coverage: impl.coverage }))

  let r = await review(u, impl, null)
  if (r) addFindings(ids, r.findings)

  // The loop runs until the reviewer APPROVES. It is not a budget for how much
  // quality a unit is allowed — it ends when going round again cannot help:
  //
  //   * any blocker still `unaddressed` → GO AGAIN. Something was skipped or
  //     half-done, and stopping there ships work everyone knew was unfinished.
  //     This is the case the old 2-round cap got wrong.
  //   * every blocker `persists` (real attempt, still failing) or `external`
  //     (not resolvable on this branch) → STOP. The obstacle is not effort, and
  //     the same actor repeating itself cannot move it. That is a real
  //     `blocked`, and it goes to the lead with the reason.
  //   * …UNLESS the survivors are all scoped to a PROPER SUBSET of the unit's
  //     cases → SPLIT instead of stop (once per unit). Units amortize dispatch
  //     cost, and the price was fate-coupling: one stuck case stranded four
  //     finished cases behind one policy-stuck one. Carving records the stuck
  //     cases blocked, QUARANTINES their code (declared skip, re-armed when
  //     the blocker clears; deletion only when the code itself is condemned,
  //     with a preservation sha), and sends the remainder
  //     back to review, and then to merge as usual.
  //   * FIX_ROUNDS → backstop only, for a review/fix pair that has gone
  //     pathological. Reaching it is a defect worth reporting, not a normal end.
  //   * budget floor → the run stops spending before it strands the batch.
  let round = 0
  let stopped = null
  let unclassified = 0
  let carve = null             // { stuck, why } — this round's dispatch is a carve, not a fix
  let carvedOnce = false       // one split per unit: whittling case-by-case is the loop going pathological
  while (r && r.verdict === 'CHANGES_REQUESTED' && (r.blocking ?? []).length) {
    carve = null
    if (round > 0) {
      const v = loopVerdict(r)
      if (!v.go) {
        const stuck = [...new Set(v.stuck ?? [])].filter((id) => ids.includes(id))
        if (!carvedOnce && stuck.length && stuck.length < ids.length) carve = { stuck, why: v.why }
        else { stopped = v.why; break }
      }
      unclassified = v.unclassified ? unclassified + 1 : 0
      if (unclassified >= 2) { stopped = 'reviewer left surviving blockers unclassified twice — cannot tell unaddressed from unfixable, so the loop cannot judge whether another round would help'; break }
    }
    if (round >= FIX_ROUNDS) { stopped = `fix-round backstop (${FIX_ROUNDS}) reached — review/fix pair is not converging`; break }
    if (budget.total && budget.remaining() < RESERVE) { stopped = 'budget floor reached mid-fix'; break }
    round++
    const prior = r.blocking.map((b) => quote(b)).join('\n- ')
    // Name what was skipped, explicitly. A fixer told only "here are the
    // blockers" reads the list as new work; told "you did not touch this one",
    // it has no room to skip it twice.
    const skipped = (r.blocking_detail ?? []).filter((d) => d.status === 'unaddressed').map((d) => quote(d.item))
    const fix = await agent(
      carve
        ? `${PREAMBLE}\n\nImplementer slot — SPLIT unit ${ids.join(', ')} on branch ${impl.branch} per your test-automation-implementation skill. ` +
          workspaceNote +
          `Review cannot pass ${carve.stuck.join(', ')} (${quote(carve.why, 200)}), and holding the whole unit hostage would strand the finished cases — so carve the stuck case(s) out of the unit's SCOPE while keeping every deliverable that is sound:\n` +
          `1. QUARANTINE by default — the code is usually fine and only the CASE is stuck. Mark ${carve.stuck.join(', ')}'s tests skipped per the project's convention (e.g. \`pytest.mark.skip(reason="blocked: <blocker> — carved from ${ul}")\`; parameterized/data-table specs: mark just their rows via \`pytest.param(..., marks=...)\`). The finished code ships INERT on the trunk and re-arms by deleting the marker once the blocker clears. Quarantine is DECLARED, never silent: the reason must quote the blocker, the runner must report the test as skipped — that declaration is what makes this the sanctioned exception to the masking hunt, because a quarantined case recorded blocked claims nothing.\n` +
          '2. REMOVE instead ONLY when the blocker says the code ITSELF is wrong (masking, unsound, unreviewable). First record the preservation point: commit and push, then `git rev-parse HEAD` — once this unit merges that commit is in the trunk\'s history forever, and re-entry RESTORES from it (`git checkout <sha> -- <paths>`), never rebuilds. Then remove their test functions/files plus any page-object member or fixture NOTHING remaining uses (git grep a shared symbol before deleting it).\n' +
          '3. Either way the RECORD survives: a quarantined case keeps its coverage block in the spec (its skip reason quoting the blocker); a removed one gets the blocker quoted in the removal commit message alongside the preservation sha — so re-entry knows exactly how to resume.\n' +
          "4. Do NOT touch the remaining cases' logic or assertions beyond steps 1–2. Re-run the remaining spec(s) once (collect-only where execution is environment-blocked), confirm quarantined tests report as SKIPPED not passed, commit by path, then push and update the PR body with what was carved and why — where the project uses a remote/PRs (§ Automation PR policy); locally the commit alone is enough.\n" +
          'Return status built; your notes MUST START with `quarantined:<paths>` or `preserved@<sha>` per mode, then name exactly what was marked or removed. Return coverage for the REMAINING cases as it stands. ' +
          `Return unit_ids EXACTLY as given here: [${ids.join(', ')}].`
        : `${PREAMBLE}\n\nImplementer slot — fix round ${round} for ${ids.join(', ')} on branch ${impl.branch} per your test-automation-implementation skill. ` +
          workspaceNote +
          'Load your receiving-code-review skill first if it is not in your context (it is on-demand, not preloaded) — it is the contract for this exact moment. ' +
          'Address EACH blocking finding (verify against the code first) and add the regression test that would have caught it, re-run the affected spec green once, commit — and update the PR where the project uses one (§ Automation PR policy):\n- ' +
          prior +
          (skipped.length
            ? `\n\nTHE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND — no attempt was visible in the diff:\n- ${skipped.join('\n- ')}\n`
              + 'Do them. If one genuinely cannot be done on this branch, say so in notes with the reason (missing primitive, case wrong, product defect) instead of leaving it silent — an unexplained gap reads as another skip and costs the unit another round.'
            : '') +
          '\nReturn coverage as it stands after your fixes (a fix that closes an exclusion updates the comment block AND the return). ' +
          `\nReturn unit_ids EXACTLY as given here: [${ids.join(', ')}].`,
      { label: carve ? `carve:${ul}` : `fix:${ul}:${round}`, phase: 'Build', agentType: TYPES.implementer, ...WORKER, schema: IMPL_SCHEMA }
    )
    if (fix) { addFindings(ids, fix.findings); noteRed(fix.expected_red) }
    if (!fix || fix.status !== 'built') { r = null; break }
    if (carve) {
      carvedOnce = true
      // fix.notes leads with the carve mode (`quarantined:<paths>` or
      // `preserved@<sha>` — the prompt demands it), and the why is bounded at
      // ~190 chars by loopVerdict, so the mode survives clip().
      carve.stuck.forEach((id) => record(id, { outcome: 'blocked', note: `carved out of ${ul}: ${carve.why} — ${fix.notes}` }))
      u.members = u.members.filter((m) => !carve.stuck.includes(m.id))
      ids = ids.filter((id) => !carve.stuck.includes(id))
      log(`${ul} split: ${carve.stuck.join(', ')} carved out — ${ids.join(', ')} go back to review`)
    }
    r = await review(u, impl, carve
      ? `${prior}\n\n(${carve.stuck.join(', ')} were CARVED OUT of the unit after the round above — their blockers are moot; review only the carve itself. Each carved case is either QUARANTINED — a declared skip marker whose reason quotes the blocker, the sanctioned exception to the masking hunt; verify the marker and its quoted reason are present in the diff (a static check — the gate’s run is what shows it skipped) — or REMOVED with a preservation sha recorded. Nothing the REMAINING cases use was removed or weakened.)`
      : prior)
    if (r) addFindings(ids, r.findings)
  }

  if (!r) { ids.forEach((id) => record(id, { outcome: 'blocked', note: `review/fix round ${round} failed` })); return null }
  if (r.verdict !== 'APPROVED') {
    const why = stopped ?? 'review CHANGES_REQUESTED'
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `${why} after ${round} fix round(s): ${(r.blocking ?? []).join('; ').slice(0, 200)}` }))
    return null
  }
  ids.forEach((id) => record(id, { outcome: 'reviewed', branch: impl.branch, pr: impl.pr ?? undefined, coverage: r.coverage ?? impl.coverage }))

  // ---- merge back, and RETURN THE TREE TO THE TRUNK ------------------------
  // No budget/quota guard here on purpose: the unit is BUILT and REVIEWED, and
  // abandoning it unmerged would strand finished work on a branch. Merging is
  // the cheapest agent in the run and the one that makes everything before it
  // count, so it runs even at the reserve.
  // The unit lands the moment it is approved, rather than waiting for one big
  // integration step at the end. Three things that buys: the trunk is a known
  // state for the next unit to branch from, conflicts surface small and while
  // the author of the change is still in flight, and an interrupted run leaves
  // the trunk carrying exactly the units that finished — which is what makes
  // recovery a `git log` rather than an archaeology exercise.
  const landed = await agent(
    `${PREAMBLE}\n\nMerge unit ${ids.join(', ')} into the batch trunk. You own the tree; nothing else runs.\n` +
    `1. \`git checkout ${TRUNK}\` and make sure it is current (\`git pull --ff-only\` if it tracks a remote).\n` +
    `2. \`git merge --no-ff ${impl.branch} -m "merge ${ids.join(', ')} into ${TRUNK}"\`.\n` +
    'On a conflict, classify EVERY conflicted file before touching anything. MECHANICAL (resolve by union/addition only): both sides added distinct imports/exports, distinct methods or locators on a page object or fixture, independent files or independent spec blocks — keep BOTH sides, stage, conclude the merge. SEMANTIC (never resolve): the same function/method/locator edited on both sides, assertion or expected-value differences, fixture signature drift, or anything you cannot resolve as a pure union — `git merge --abort`, ' +
    // The code may not land, but what we learned always does: a parked unit's
    // memory would otherwise sit stranded on an unmerged branch, and failure
    // units produce the best gotchas.
    `then LAND THE UNIT'S KNOWLEDGE ANYWAY: \`git checkout ${impl.branch} -- .agents/memory/\`, commit by path (\`docs(memory): ${ids.join(', ')} — learnings from a parked unit\`; skip the commit if nothing changed), push. THEN report merged=false with the conflict files and a one-line reason, and STOP.\n` +
    'HARD RULES: never delete, `rm`, or `checkout --ours/--theirs` a file away to make a merge pass; never edit test logic, assertions or expected values while resolving; never run the suite (the gate does that).\n' +
    `3. Push ONLY if this project pushes to a remote (\`.agents/profile.md\` § Automation PR policy / \`git remote -v\`): \`git push origin ${TRUNK}\` — where a remote exists the gate reads the trunk from it, so an unpushed merge is invisible; say so in notes if the push fails. On a local-only project skip this step — the gate reads the local branch instead.\n` +
    `4. LEAVE THE TREE ON ${TRUNK}. The next unit branches from it and assumes it is there.\n` +
    `Return unit_ids EXACTLY as given here: [${ids.join(', ')}]. ` +
    'Return whether the merge landed, the trunk head sha, and any conflict files.',
    {
      label: `merge:${ul}`, phase: 'Build', agentType: TYPES.implementer, ...WORKER,
      // Mechanical slot tiering: checkout/merge/push with a classify-or-abort
      // rule — the semantic backstop is the gate running the suite on the
      // trunk, so a cheap model here trades nothing for ~1/3 the price.
      model: A.mergeModel ?? A.workerModel ?? 'haiku',
      effort: A.workerEffort ?? 'low',
      schema: {
        type: 'object', additionalProperties: false,
        // findings[] is in the PREAMBLE every dispatch gets, so it has to be
        // declarable here — `additionalProperties: false` plus a preamble that
        // asks for a field the schema forbids means an obedient agent returns
        // schema-invalid output and its unit gets parked on a clean merge.
        required: ['unit_ids', 'merged', 'head_sha', 'conflict_files', 'notes'],
        properties: {
          unit_ids: { type: 'array', items: { type: 'string' } },   // echo — see IMPL_SCHEMA
          merged: { type: 'boolean' },
          head_sha: { type: 'string' },
          conflict_files: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
          findings: FINDINGS,
        },
      },
    }
  )
  if (!landed || landed.merged !== true) {
    const why = landed
      ? `${landed.notes || 'semantic conflict'}${landed.conflict_files?.length ? ` (${landed.conflict_files.slice(0, 4).join(', ')})` : ''}`
      : 'merge agent failed'
    parked.push({ ids, branch: impl.branch, why })
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `reviewed but NOT merged — ${why}; resolve on the case branch and re-enter` }))
    log(`${ul} reviewed but parked: ${why}`)
    return null
  }
  merged.push({ ids, branch: impl.branch, pr: impl.pr ?? null })
  addFindings(ids, landed.findings)
  log(`${ul} merged into ${TRUNK} (${String(landed.head_sha).slice(0, 8)})`)
  return impl.branch
}

// ---- runaway-cap accounting ------------------------------------------------
// The runtime caps a workflow at 1000 agents for its whole LIFETIME, and
// nothing degrades gracefully there — the 1001st agent() simply throws, in
// whatever phase happens to reach it, which on this pipeline means a batch that
// dies somewhere between review and gate with its work unreported. The worst
// case is knowable up front (it is a function of units, fix rounds and panel
// width), so say it before anything runs rather than discovering it at agent
// 1000. This is a WARNING, not a refusal: the worst case assumes every unit
// burns every fix round, which a healthy batch never does.
{
  // per unit: build + merge + defect-filer, plus fixes and reviews
  const perUnit = 3 + FIX_ROUNDS + (FIX_ROUNDS + 1) * (PANEL ? REVIEW_LENSES.length : 1)
  // + one test-runner per case (needs-execution worst case), + triage, gate, reporter
  const worst = UNITS.length * perUnit + CASES.length + 3
  if (worst > 900) {
    log(`HEADROOM: worst case ~${worst} agents for ${UNITS.length} unit(s) — the runtime's lifetime cap is 1000. `
      + 'A batch that actually burns its fix rounds would die mid-run. Split it into smaller batches (or lower '
      + `fixRounds${PANEL ? '/turn reviewPanel off' : ''}) before this becomes a rescue.`)
  }
}

// ---- the unit loop: strictly one at a time ---------------------------------
// ONE tree, ONE master. A plain `for … await` and nothing else: no lanes, no
// chains, no locks. Every hazard those existed to manage came from two slots
// wanting the tree in different states at once, and ordering is the only thing
// that actually reconciles that (see ONE TREE, ONE MASTER above).
//
// Do NOT reach for parallel()/pipeline() here. It looks like free throughput
// and it is not: it puts two `git checkout` in one tree, which is precisely
// what produced the eight checkout aborts and the conflict pile-up we measured.
// Throughput comes from CLUSTERING — fewer, larger units — not from overlap.
phase('Triage')
// A dead triage stops the batch HONESTLY: without it the provider policy was
// never read, and there is no safe default — 'combined' could self-execute
// against a manual-qa policy, 'needs-execution' could stall a self project on
// an agent that does not exist. One cheap dispatch is not worth guessing over.
let TRI = null
try { TRI = await runTriage() } catch (e) {
  log(`triage threw (${String(e?.message ?? e).slice(0, 120)}) — no routes exist`)
}
if (TRI) DEFAULT_ROUTE = TRI.provider === 'manual-qa' ? 'needs-execution' : 'combined'
else {
  for (const c of CASES) record(c.id, { note: 'triage died — the execution-provider policy was never read and no unit was routed; every case stays not-started, re-run the batch' })
  log('triage produced no routes — every case stays not-started')
}

for (const unit of (DEFAULT_ROUTE ? UNITS : [])) {
  const route = routeOf(unit)
  // ---- execution first, where policy demands it ----------------------------
  let members = unit
  let evidence = null
  if (route === 'needs-execution') {
    phase('Execution')
    if (!admitUnit(unit, 'execution')) continue
    let passed = []
    try {
      passed = await runExecution(unit)
    } catch (e) {
      // runExecution guards each dispatch; a throw here is unexpected — cost
      // the unit, never the run.
      const stalled = isStall(e)
      unit.forEach((c) => record(c.id, stalled
        ? { outcome: 'infra-stalled', note: stallNote('execution', e) }
        : { outcome: 'needs-execution', note: `execution dispatch threw: ${String(e?.message ?? e).slice(0, 160)}` }))
      breakerCount('agent-died', String(e?.message ?? e))
      log(`${label(unit)} ${stalled ? 'infra-stalled' : 'threw'} during execution — continuing with the next unit`)
      continue
    }
    if (!passed.length) { log(`${label(unit)}: no case passed execution — nothing to build`); continue }
    members = unit.filter((c) => passed.some((p) => p.id === c.id))
    evidence = passed.map((p) => p.evidence)
  } else if (route === 'manual-qa-verified') {
    evidence = MQ_EVIDENCE.get(routeKey(unit.map((c) => c.id))) ?? []
  }

  // ---- build → review → fix → merge ----------------------------------------
  // A thrown build costs its own unit and nothing else — the trunk is where it
  // was, so the next unit starts from a known state. agent() returns null on
  // most deaths, but stall-retry exhaustion THROWS (measured 2026-08-17) —
  // uncaught, one stalled build slot killed a whole batch with its report
  // unwritten. A stall is an environment fact, so it feeds the same breaker
  // as agent-died: three in a row stop admitting units.
  try {
    phase('Build')
    const impl = await runBuild(members, evidence, route)
    if (!impl) continue
    await buildUnit({ members }, impl)
  } catch (e) {
    // Only overwrite IN-FLIGHT rows. A carve inside buildUnit records terminal
    // outcomes for the carved members ('blocked: carved out of …') — a later
    // throw in the same unit must not silently rewrite them.
    const INFLIGHT = new Set(['not-started', 'built', 'reviewed'])
    const ids = members.map((m) => m.id).filter((id) => INFLIGHT.has(OUTCOME[id]?.outcome))
    if (isStall(e)) {
      // A stall mid-build is an environment fact — and the branch may hold
      // checkpoint commits (CHECKPOINT_RULE), so the note points the re-entry
      // at them instead of at a blocker.
      ids.forEach((id) => record(id, { outcome: 'infra-stalled', note: stallNote('build', e) }))
      breakerCount('agent-died', String(e?.message ?? e))
      log(`${ids.join('+')} infra-stalled mid-build — the trunk is where it was; continuing with the next unit`)
    } else {
      ids.forEach((id) => record(id, { outcome: 'blocked', note: `build failed: ${String(e?.message ?? e).slice(0, 160)}` }))
      log(`${ids.join('+')} build threw — continuing with the next unit`)
    }
  }
}

// ---- integration already happened -------------------------------------------
// There is no integrate PHASE. Each unit merged into the trunk the moment its
// review approved (see buildUnit), so by the time we get here the trunk already
// carries everything that passed and the tree is sitting on it. `merged` is the
// record of what landed; `parked` is what reviewed but could not be merged.
// batch-integrate.workflow.mjs survives as a REPAIR tool — for re-merging a
// parked unit by hand, or integrating a batch that was built without this
// workflow — not as a stage of the normal run.

// ---- Phase: the hardening gate ---------------------------------------------
// Its own agent — never the implementer, never the reviewer. It runs the
// batch's specs TOGETHER, N consecutive green: stronger than a per-case gate
// because it surfaces the parallel-interaction flakes a per-case run never
// sees. The script also does the MECHANICAL half of the coverage contract
// (a coverage line per case id, exclusion grammar parses, categories valid).
// It does NOT merge, does NOT classify a red, does NOT fix. A red goes to
// the report; the lead classifies (product defect / flake / architectural) and
// may dispatch the stabilize workflow for the batch.
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'verdict', 'coverage_checked', 'runs', 'green_specs', 'failures', 'notes'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },   // echo of the batch's merged ids — see IMPL_SCHEMA

    // `incomplete` is NOT `not-run`. Measured 2026-08-09: three gates were cut
    // off with runs already banked and pytest still executing, reported
    // `not-run` because it was the only honest option in the enum, and their
    // merged units were labelled merged-ungated — so a lead-run green later had
    // nothing to attach to. Separating them lets the report say "resume here"
    // instead of "nothing is known".
    verdict: { type: 'string', enum: ['green', 'red', 'not-run', 'incomplete'] },
    // The mechanical coverage check (gate-case --cases) is opt-in at the
    // script level, so the gate must ATTEST it ran — a green returned with
    // coverage_checked=false is demoted to 'incomplete' below: the coverage
    // contract was never checked, so the green is not a verdict.
    coverage_checked: { type: 'boolean' },
    runs: { type: 'integer' },
    seconds: { type: 'array', items: { type: 'number' } },
    green_specs: { type: 'array', items: { type: 'string' } },
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
    findings: FINDINGS,   // PREAMBLE asks for it — see the merge schema's note
  },
}
let gate = null
const gateBranch = TRUNK
if (!SKIP_GATE && merged.length) {
  phase('Gate')
  // A thrown gate (stall-retry exhaustion) proves nothing either way — gate
  // stays null, merged units become merged-ungated below exactly as if the
  // gate had been dropped, and the report still lands.
  try {
  gate = await agent(
    `${PREAMBLE}\n\nHardening gate for batch ${SLUG}. You did not write this code and you do not fix it — you PROVE it, and you report exactly what you saw.\n` +
    `Branch: ${gateBranch} (the batch trunk — every approved unit is already merged into it). Base: ${BASE}.\n` +
    `Run the batch's new/changed specs TOGETHER, ${GATE_N} CONSECUTIVE deterministic green runs, each a clean process against the live env. ` +
    'Use `scripts/gate/gate-case.mjs` for the mechanics (it merges the base FIRST — a run against a branch that lacks base proves nothing about what will land — refuses a tree whose dirt could contaminate the proof, carries other leftovers on record, and returns timings), ' +
    (GATE_CMD ? `with --cmd '${GATE_CMD}'. ` : 'resolving the suite command from .agents/testing.md § run commands. ') +
    `On your FIRST call also pass \`--cases ${merged.flatMap((r) => r.ids).join(',')}\` — the script then runs the MECHANICAL COVERAGE CHECK before the suite: a coverage line per case id in the batch's changed files, exclusion grammar parses, categories valid. A \`coverage-invalid\` verdict is a RED for the batch — report each problem verbatim as a failures[] entry (spec = the file, signature = the problem) and stop; do not burn ${GATE_N} runs proving code whose coverage contract is broken. Set coverage_checked=true ONLY if that mechanical check actually ran under this gate (on a resume, a recorded \`coverage: ok\` for this branch in gate-runs.jsonl counts); a green returned without it is demoted — the coverage contract was never checked. ` +
    'A red anywhere ENDS the attempt — N CONSECUTIVE is the contract, not best-of-N. ' +
    // HOW to run it, because the arithmetic is unforgiving and every gate that
    // improvised got it wrong. `--n 3` does all three runs in ONE process: on a
    // real UI batch that is 12-19 minutes against a 600s call ceiling, so the
    // call is killed, auto-backgrounded, and the agent is stranded. The two
    // gates that passed cleanly both ran ONE run per call. Measured 2026-08-09.
    `HOW TO RUN IT — this is where gates fail, so follow it exactly. FIRST time one run: \`--n 1\`, in the foreground, with timeout: 600000. ` +
    `Then, if that single run took under ~8 minutes, simply repeat it — \`--n 1\` once per run, ${GATE_N} separate foreground calls, each with timeout: 600000 — and count the consecutive greens yourself. ` +
    `Do NOT pass \`--n ${GATE_N}\`: it runs all ${GATE_N} inside one process, which on a real batch exceeds the 600s ceiling a foreground call has, and the call is killed mid-run. ` +
    'If ONE run does not fit under ~8 minutes (a large batch), launch that run detached with `--json` redirected to a file, then wait with blocking foreground polls — `sleep 300; <check the file>`, each with timeout: 600000 — and repeat per run. ' +
    'Either way you never end a turn while a run is in flight and you never poll at second-level intervals: both are how gates get cut off before they finish (see the long-jobs rule above). ' +
    // TWO PROOFS, TWO COUNTS. The batch's own specs are unproven, so they need
    // repetition — that is what catches a flake. Everything else was already
    // proven, so ONE run is enough to reveal a regression, and repeating it
    // would be paying N× for a question already answered. Scope the second run
    // by BLAST RADIUS rather than running the whole suite: a full suite is
    // hours, and the specs that can plausibly break are the ones that share the
    // code this batch touched.
    `THEN, ONCE (not ${GATE_N}×), run the specs this batch could have BROKEN. Scope by what CHANGED, not what was touched. Read the non-spec diff (\`git diff ${BASE}...${gateBranch}\` — page objects, fixtures, helpers, config) HUNK BY HUNK: a hunk that only ADDS something new (a method, a locator, a constant nothing existing calls) has NO blast radius — new code cannot break a spec that never calls it; a hunk that MODIFIES or deletes something that existed names an impacted symbol (the hunk header shows the enclosing function), and the impacted specs are the ones that REACH that symbol — search by symbol name, one hop through shared helpers — NEVER every spec importing the file (import-level selection has over-run 5-10x live and stalled the gate). Import shuffles and formatting churn are no-ops. Run the impacted set once, selected by node-id/spec, never by directory. All hunks additive: there is no blast radius and this run is unnecessary — say so in notes. A modified symbol in a base class or fixture that everything reaches makes the big set REAL — report its size and estimated runtime in notes and let the lead decide run-vs-sample rather than silently burning the hour. A red here is a REGRESSION and belongs in failures[] like any other, flagged in notes as pre-existing-code rather than new-code. ` +
    'Report both scopes in notes: how many specs the N× run covered, and how many the regression run covered. ' +
    `When you are done, LEAVE THE TREE ON ${gateBranch} — \`git checkout ${gateBranch}\` after the script's detached run — because the next step assumes it is there. ` +
    'On red: read the runner\'s STRUCTURED report (JSON/HTML) for per-spec verdicts rather than log-diving, and return one failures[] entry per failing spec with its failure signature and, where the spec names them, the case ids it covers. ' +
    'One distinction you MUST make, because only you see the runner output: a spec that FAILED (an assertion, a timeout, an error inside the test) versus a spec that never ran (module not found, worker crash, 0ms duration, collection error). The second is an infrastructure fact — a file missing from the merge, a dependency not installed — and reporting it as a red case sends the lead hunting a bug that does not exist. Put such failures in `failures` with the signature verbatim AND say in notes that the spec did not execute. ' +
    // The enum distinction only pays off if the gate knows which one it is.
    `IF YOU ARE CUT OFF before the ${GATE_N} runs finish — you are told to report while a run is still going — use verdict 'incomplete', NOT 'not-run'. They mean different things: 'not-run' is "nothing was attempted", 'incomplete' is "I was mid-flight". With 'incomplete' set runs to the number that ALREADY went green, list those in green_specs, and use notes to say exactly where to resume: the branch, the run set, and what remains. A resumable gate is worth far more to the lead than a blank one, and it is the difference between re-running one run and re-running all ${GATE_N}. ` +
    (EXPECTED_RED.length
      ? `RED BY DESIGN — do not count these against the green requirement:\n${EXPECTED_RED.map((r) => `  - ${quote(r.spec, 200)}${r.test_id ? ` :: ${quote(r.test_id, 120)}` : ''} — ticket ${quote(r.ticket, 60)} (${quote(r.why, 200)})`).join('\n')}\nRun them like everything else and report exactly what they did, but the N-consecutive-green contract covers only the OTHER specs. These carry a ticketed product defect the implementer asserted softly rather than hid — a permanently failing test is the correct signal, and counting it would make this batch unpassable while blocking every healthy case in it. If one of them comes back GREEN, say so loudly in notes: the product shipped a fix and the ticket can close. `
      : '') +
    'Do NOT merge anything. Do NOT classify the failure (product defect vs flake vs architectural — that is the lead\'s call). Do NOT fix. ' +
    FOREGROUND_RULE +
    `Return unit_ids EXACTLY as this batch's merged ids: [${merged.flatMap((r) => r.ids).join(', ')}]. ` +
    'Return verdict=green only if you observed ' + GATE_N + ' consecutive green runs.',
    // gateModel: the script does the mechanics (run, time, record), so the
    // wrapping agent's job is loop + count + report honestly — tier-able like
    // merge-back/reporter. Measured ~$10-12/gate on the session model. Default
    // stays inherit: blast-radius scoping still reads a diff with judgment.
    { label: `gate:${SLUG}`, phase: 'Gate', agentType: TYPES.gate, ...WORKER, ...(A.gateModel ? { model: A.gateModel } : {}), schema: GATE_SCHEMA }
  )
  } catch (e) {
    log(`gate ${isStall(e) ? 'infra-stalled' : 'threw'} (${String(e?.message ?? e).slice(0, 120)}) — merged units stay merged-ungated; re-run the gate on ${gateBranch}`)
  }
  if (gate) addFindings(merged.flatMap((r) => r.ids), gate.findings ?? [])
  // A green whose mechanical coverage check never ran is not a verdict: the
  // suite may be green while the coverage contract is silently broken. Demote
  // to 'incomplete' — merged units stay merged-ungated, and the note says
  // exactly how to finish the proof.
  if (gate?.verdict === 'green' && gate.coverage_checked !== true) {
    log('gate says green but coverage_checked=false — the mechanical coverage check (--cases) never ran; demoting to incomplete, merged units stay merged-ungated')
    gate = { ...gate, verdict: 'incomplete', notes: `${gate.notes ?? ''} [green demoted: the --cases coverage check never ran — re-run the gate with --cases]`.trim() }
  }
}
// The gate proves the TRUNK, so it speaks for exactly the units on it.
const integratedIds = new Set(merged.flatMap((r) => r.ids))
if (gate?.verdict === 'green') {
  // A green gate proves the specs it COUNTED. A case carrying a red-by-design
  // test was deliberately excluded from that count, so the gate says nothing
  // about it — reporting it `delivered` would claim proof the run never had.
  // Its red is pre-declared on a ticket, it merged with the batch, and it
  // re-enters when the product ships — that is `defect-found`, same as a
  // runner-FAIL: blocked on a ticketed product defect, not on this batch.
  let okCount = 0
  for (const id of integratedIds) {
    const red = OUTCOME[id]._expectedRed
    if (red?.length) {
      record(id, { outcome: 'defect-found', note: `red by design pending ${red.map((r) => r.ticket).join(', ')} — the gate ran it but could not count it; merged with the batch, re-enter once the product ships` })
      continue
    }
    record(id, { outcome: 'delivered', gate: { runs: gate.runs, seconds: gate.seconds ?? [] } })
    okCount++
  }
  log(`gate GREEN ${gate.runs}/${GATE_N} — ${okCount} case(s) delivered` + (EXPECTED_RED.length ? `, ${integratedIds.size - okCount} held on ticketed defects` : ''))
} else if (merged.length && (SKIP_GATE || !gate || gate.verdict === 'not-run' || gate.verdict === 'incomplete')) {
  // No verdict is NOT a red. An interrupted, dropped, or arg-skipped gate
  // proves nothing either way, and labelling its units `blocked` is how a dead
  // run's own summary becomes a false negative — measured live: a session
  // killed mid-gate reported "blocked: 14" while 13 of those 14 units were
  // already built, reviewed and MERGED on the trunk.
  //
  // `incomplete` says MORE than that: the gate was mid-flight with runs
  // already banked. Same non-terminal outcome, but the note carries where to
  // resume, so the lead re-runs the remainder instead of starting over — and
  // so a lead-run green has something to correct rather than a blank.
  const cut = gate?.verdict === 'incomplete'
  const banked = cut && gate.runs ? ` — ${gate.runs}/${GATE_N} run(s) already green before it was cut off` : ''
  for (const id of integratedIds) {
    record(id, {
      outcome: 'merged-ungated',
      note: SKIP_GATE
        ? `gate skipped by arg (skipGate) — merged on the trunk but unproven; run the gate on ${gateBranch} before landing`
        : cut
          ? `gate CUT OFF mid-run${banked}; merged on the trunk but unproven — resume the gate on ${gateBranch}, then WRITE THE VERDICT BACK into this report`
          : 'gate never produced a verdict (interrupted or dropped) — merged on the trunk but unproven; re-run the gate',
    })
  }
  log(`gate ${SKIP_GATE ? 'skipped' : cut ? `incomplete${banked}` : 'not-run'} — ${integratedIds.size} merged unit(s) UNPROVEN, not blocked; run the gate on ${gateBranch}`)
} else if (gate) {
  const failedIds = new Set((gate.failures ?? []).flatMap((f) => f.case_ids ?? []))
  for (const id of integratedIds) {
    const why = failedIds.has(id)
      ? `gate red: ${(gate.failures.find((f) => (f.case_ids ?? []).includes(id))?.signature ?? '').slice(0, 200)}`
      : 'gate red for the batch — this spec did not itself fail; the batch is not proven until the red is resolved'
    record(id, { outcome: 'blocked', note: why })
  }
  log('gate red — classify (product defect / flake / architectural), then consider batch-stabilize')
}

// ---- the report — ONE writer, at close --------------------------------------
phase('Report')
// `_findingKeys` is dedup bookkeeping, not part of the report contract.
const rows = CASES.map((c) => { const { _findingKeys, _expectedRed, ...row } = OUTCOME[c.id]; return row })
const totals = rows.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc }, {})
const qualityFlags = []
// The sizing pass is the lead's intake step — nothing here runs it, so its
// absence is at least LOUD: no verdicts file means no un-automatable
// screening, no exclusion budget for the reviewer, and no effort fields in
// the tokenomics export (§7 will flag effort_days missing).
if (SIZING_PRESENT === false) {
  qualityFlags.push(`intake sizing/screening pass not run — no .agents/estimation/${SLUG}-verdicts.json: un-automatable screening and the reviewer's exclusion budget were unavailable, and effort fields will be missing from the tokenomics export. Run the pass (automation-scoping § verdict pass) before the next batch.`)
}
const stalledCount = rows.filter((r) => r.outcome === 'infra-stalled').length
if (stalledCount) {
  qualityFlags.push(`${stalledCount} case(s) infra-stalled — the harness killed their slot mid-flight (the model stream stopped; on a quota-limited provider check tokens/min throttling before blaming the batch); they re-enter the next batch untouched — check their unit branches for checkpoint commits first`)
}
const needsExecCount = rows.filter((r) => r.outcome === 'needs-execution').length
if (needsExecCount) {
  qualityFlags.push(`${needsExecCount} case(s) needs-execution — the seeded policy says manual-qa executes cases and no PASS evidence exists for these; run the manual-qa suite over them (their test-run-lead), then re-run the batch. Self-execution is never the fallback.`)
}
const report = {
  batch: SLUG,
  base: BASE,
  // Tracker/TMS reference of the work-item this batch serves (issue, story,
  // suite link) — flows into the tokenomics dataset export's work_item_ref.
  // Optional: absent, the export uses a telemetry-cohort ref (T-<slug>).
  ...(A.workItemRef ? { work_item_ref: String(A.workItemRef) } : {}),
  ...(TRI ? { execution_provider: TRI.provider } : {}),
  integration_branch: merged.length ? gateBranch : null,
  gate: gate ? { verdict: gate.verdict, runs: gate.runs, seconds: gate.seconds ?? [], failures: (gate.failures ?? []).map((f) => ({ ...f, ...(typeof f?.signature === 'string' ? { signature: clip(f.signature) } : {}) })) } : null,
  cases: rows,
  totals,
  quality_flags: qualityFlags,
  quota_halted: quotaHalted,
  expected_red: EXPECTED_RED,
  // Units that passed review but could NOT be merged into the trunk. They are
  // `blocked` in cases[] too; naming them here keeps the merge failure visible
  // as its own class rather than buried among product-defect blocks.
  parked: parked.map((p) => ({ ids: p.ids, branch: p.branch, why: clip(p.why) })),
}

// The only disk write in the whole run. Everything else that must survive an
// interruption is already persisted by the runtime (journal.jsonl) or by git.
const WRITE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['written'], properties: { written: { type: 'boolean' }, detail: { type: 'string' } },
}
let wrote = null
try {
wrote = await agent(
  'You are the report writer — the single disk write of this run.\n' +
  `Create the directory ${REPORT_DIR} if needed, then Write TWO files:\n` +
  `1. ${REPORT_DIR}/report.json — EXACTLY this JSON, byte for byte, no edits, no commentary:\n` +
  // Five-backtick fence: notes and findings are agent-authored free text and
  // frequently contain ``` themselves, which would end a three-backtick fence.
  '`````json\n' + JSON.stringify(report, null, 2) + '\n`````\n' +
  `2. ${REPORT_DIR}/report.md — a readable rendering of the same data for a human: a totals line, then a table of case id / outcome / note, then coverage per delivered case (full, or the excluded steps with categories and referents), then any findings grouped by kind, then the gate verdict with its timings.\n` +
  'Change NOTHING about the data — you are rendering it, not judging it. ' +
  `If the project commits automation artifacts, commit both — then RETURN THE TREE TO ${gateBranch} before you finish (\`git checkout ${gateBranch}\`), because the next thing to run assumes it is there. Otherwise leave them on disk, touch no branch, and say so.`,
  // Named, not anonymous: it writes into the repository and may commit, so it
  // needs the project's conventions from its role briefing. An `agent()` without
  // `agentType` reaches SubagentStart as `workflow-subagent` and resolves to no
  // role at all — measured on one campaign, 1004 of 2123 units arrived that way.
  // Pure rendering (byte-exact JSON copy + a markdown table): the cheapest
  // capable tier. Override via reporterModel if a project's renderer needs more.
  { label: `report:${SLUG}`, phase: 'Report', agentType: TYPES.reporter, model: A.reporterModel ?? 'haiku', effort: 'low', schema: WRITE_SCHEMA }
)
} catch (e) {
  // Even a dead report writer must not kill the run at the finish line: this
  // return carries the full report object, so the lead writes report.json
  // from it by hand — report_written: false says exactly that.
  log(`report writer threw (${String(e?.message ?? e).slice(0, 120)}) — report_written: false; write ${REPORT_DIR}/report.json from this return by hand`)
}

return {
  ...report,
  report_written: wrote?.written === true,
  report_path: `${REPORT_DIR}/report.json`,
  next: quotaHalted
    ? 'ACCOUNT CEILING — nothing to repair. Re-invoke with the SAME args plus resumeFromRunId AND quotaResume: true once the limit resets; completed units replay from cache (quotaResume keeps the replayed ceiling note from re-halting the run).'
    : gate?.verdict === 'green'
      // ONE PR takes the whole trunk to base — the units already merged into it,
      // so what was gated and what lands are the same object.
      ? `Gate green on ${gateBranch}. LAND IT: one PR from ${gateBranch} to ${BASE} per .agents/profile.md § Automation PR policy (auto-merge / human-approved / manual decides who presses it), then mirror to the TMS (update_execution with the gate outcome — automation executions ONLY, manual-qa's live runs are their own record — plus each case's status/coverage note: full | partial with the excluded steps and reasons, and the PR link) and run the close sweep. Replan anything not 'delivered'. Where the tokenomics scope contract is active (a session-start line named your session id): record outcomes as they land (work-scope.mjs outcome <ID>=delivered …), then work-scope.mjs close — it renders ${REPORT_DIR}/batch-report.md+.html and flags receipt DRIFT — and publish per .agents/profile.md § Reporting policy (dispatch the cheap publisher; no policy → the files ARE the report, flag the gap).`
      : merged.length && (!gate || gate.verdict === 'not-run' || gate.verdict === 'incomplete')
        // THE RECEIPT IS THE DELIVERABLE. Measured across two audits: leads
        // recover a failed gate flawlessly and then never correct report.json,
        // so 38 of 69 genuinely-green specs (55%) scored as unproven or absent
        // in the next rollup. Playbook prose did not fix it — this text is what
        // the lead actually reads at the moment it happens, so the obligation
        // lives here, next to the instruction that creates it.
        ? `${gate?.verdict === 'incomplete' ? `GATE CUT OFF MID-RUN (${gate.runs ?? 0}/${GATE_N} banked)` : 'GATE NEVER RAN'} — ${gateBranch} holds ${merged.length} merged unit(s) that are UNPROVEN, not blocked (outcome merged-ungated). Re-run the gate first (re-invoke with resumeFromRunId — completed units replay from cache — or dispatch the gate alone on ${gateBranch}) and classify nothing until a verdict exists. An interrupted run's own totals are a claim, not evidence: verify against .agents/telemetry/automation/returns/ (legacy _returns/) and git (playbook § Interruption). THEN, THE MOMENT YOU HAVE A VERDICT, WRITE IT BACK INTO ${REPORT_DIR}/report.json — gate.verdict, gate.runs, gate.seconds, and each case's real outcome ('delivered' on green; 'defect-found' for a ticketed red-by-design). This file is the receipt every audit, every --resolved-from and the next batch's plan divide by: a gate you re-ran green but never wrote back scores as ZERO delivered, and the specs read as unproven forever. The scope contract, where active, backs this up: work-scope.mjs outcome + close after the write-back — the close render cross-checks report.json against the recorded gate verdict and prints DRIFT if the write-back was missed.`
        : `${stalledCount ? `${stalledCount} case(s) infra-stalled — an ENVIRONMENT failure (the model stream stalled), not a case failure: fix the provider first, check their unit branches for checkpoint commits, then re-enter them. ` : ''}${needsExecCount ? `${needsExecCount} case(s) needs-execution — run the manual-qa suite over them, then re-run the batch. ` : ''}Classify each blocked case (product defect → tracker; flake/test-code bug → batch-stabilize on ${gateBranch}; architectural → § Framework architecture), then replan the remainder. ${gateBranch} is NOT landed — nothing reaches ${BASE} until it is green. Record classifications as they land (work-scope.mjs outcome <ID>=blocked, where the scope contract is active) — the ledger stays honest even if this session dies before a close.`,
}
