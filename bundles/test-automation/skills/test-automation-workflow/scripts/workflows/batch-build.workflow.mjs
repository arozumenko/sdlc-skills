// Canonical batch workflow for the test-automation pipeline.
// Claude Code only — invoked by the orchestrator via
//   Workflow({ scriptPath: '<installed skill>/scripts/workflows/batch-build.workflow.mjs',
//              args: { slug, base, cases: [{id, title?}, …], clusters?, … } })
//
// ONE workflow, ONE report. It runs the whole batch — analyse, implement,
// review, merge, gate — and returns a single status the lead acts on:
// land what is `automated`, classify what is `blocked`, replan the rest.
//
//   for each unit, IN ORDER, on the batch trunk:
//     analyse   → live exploration; commits its AFS + digest to the trunk
//     implement → on a unit branch cut FROM the trunk
//     review    → static, reads the diff of that branch
//     fix       → rounds until APPROVED (see loopVerdict)
//     merge     → the unit branch into the trunk, then the tree RETURNS to it
//   gate        → the batch's specs together, N consecutive green + affected specs
//   report      → one writer, at close
//
// ONE TREE, ONE MASTER — the invariant everything else rests on. There is no
// concurrency here at all, and that is the design, not a limitation:
//
//   Always return the tree to a known state, and always branch from it.
//
// A single working tree has ONE state at a time, but concurrent slots need
// DIFFERENT states — an analyst wants base, a reviewer wants the branch it is
// judging, an implementer wants its own. No rule can reconcile that; only
// ordering can. An earlier revision ran analysts in parallel with builds and
// paid for it in the field: eight `local changes would be overwritten by
// checkout` aborts (the analyst's `_surface.md` against a build's branch
// switch), merge conflicts concentrated in shared page objects, 90 conflict
// hits and three git-surgery rescues in one session.
//
// Serialising buys back everything those hazards cost us in rules. Analysts may
// now run git, commit, and push like anyone else, because nothing else is in
// the tree while they do. Deleted with the concurrency: browser lanes, the
// per-unit AFS handoff, the integrator's orphan sweep, and the separate
// integrate phase — units merge as they finish, so integration is continuous
// and conflicts surface small, early, and while their author is still live.
//
// THROUGHPUT COMES FROM CLUSTERING, NOT CONCURRENCY. Units are the wall clock,
// so a cluster of 5 is one unit rather than five — a 4x reduction against the 2x
// that analyst concurrency bought, and without any of the hazards.
//
// WHY NO BOARD. Earlier revisions kept a `.agents/automation-board/` state
// machine — 15 statuses, legal transitions, a serialized clerk applying every
// flip. It existed to record PROGRESS, and progress only needs recording if
// something reads it mid-run. Nothing does: the runtime already persists every
// agent's full return to the run's `journal.jsonl` as it completes, and
// `resumeFromRunId` replays completed calls from cache. The board was a second,
// hand-maintained copy of that — and it drifted: 4 of 12 merged cases in one
// campaign ended mis-stated, one sitting at `analysis` despite a merge commit,
// which would have bought a full re-analysis of shipped work. What survives an
// interruption now: the journal (every return), git (AFS on base, branches,
// PRs), and the report once it lands. Recovery turns the first two into the
// third by hand — playbook § Interruption and resumption.
//
// OUTCOMES, NOT STATUSES. A case ends somewhere; it does not travel through a
// state machine. `outcome` says where it ended; `findings` — orthogonal — say
// what turned up on the way. A case can be `automated` AND have filed two
// defects and raised a question: the work completed, and there is still
// something to tell. The old vocabulary forced that into the exception status
// `defect-found`, which read as "this case failed".
//
// UNITS & CLUSTERS: work flows in units of 1..k cases. A cluster (args.clusters,
// declared by the plan per campaign-planning.md) is a pack of genuinely similar
// same-surface cases analysed by ONE analyst in ONE live session — every case
// still executed individually (per-case evidence mandatory) — and implemented
// as ONE branch (family AFS → parameterized spec, one row per case). Unlisted
// cases run as solo units. With builds sequenced, UNITS are the wall clock, so
// clustering is the main throughput lever a batch has.
//
// PROMPT DETERMINISM IS THE RESUME CONTRACT (field lesson, 2026-07-24 — it cost
// one campaign ~2x). `resumeFromRunId` caches every agent() call keyed on the
// EXACT (prompt, opts) pair, so any value interpolated into a prompt that
// depends on RUN TIMING rather than on the args breaks the cache on every
// resume and the agent re-runs live. An earlier revision handed out browser
// lanes from a counting semaphore (completion order): measured, 20 of 28
// analysed cases were dispatched under >=2 distinct lane numbers and 35 of 53
// were re-analysed from scratch. Serialising removed that whole class: every
// unit branches from the TRUNK, whose name comes from args, so no prompt
// depends on who finished first. When editing: interpolate args and worker
// RESULTS, never anything derived from completion order.

export const meta = {
  name: 'ta-batch-build',
  description: 'One batch, one report: units run in order on the batch trunk — analyse (commits its AFS) → implement on a branch cut from the trunk → static review → fix to APPROVED → merge back, tree returns to the trunk — then one hardening gate (N consecutive green plus the specs the batch could have broken), returning per-case outcomes and findings for the lead to land, classify and replan from',
  whenToUse: 'Orchestrator (test-automation-lead) on Claude Code once a batch of cases has been planned and clustered — it runs the batch end to end; the lead (or a closer) lands it per seeded policy, classifies anything red, and replans the remainder',
  phases: [
    { title: 'Analysis', detail: 'per unit, live exploration on the trunk; commits its AFS + surface digest' },
    { title: 'Build', detail: 'per unit: implement green-once on a branch cut from the trunk, static review, fix rounds, merge back' },
    { title: 'Gate', detail: 'the batch specs together N consecutive green, plus one run of the specs the batch could have broken — its own agent, never the implementer' },
    { title: 'Report', detail: 'one writer: per-case outcomes + findings to disk' },
  ],
}

// ---- args ------------------------------------------------------------------
// Tolerate stringified args (observed 2026-07-20).
const A = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!A.slug || !A.base || !Array.isArray(A.cases) || A.cases.length === 0 || A.cases.some((c) => !c?.id)) {
  throw new Error(
    'args required: { slug, base, cases: [{id, title?, path?}, …] (every case needs an id; path = repo-relative source file when the body already lives in this repo — no snapshot copy), clusters?: [[id,…],…], ' +
    'analyzeOnly?, preAnalyzed?: [{id, afs_path, surface_key}], quotaResume?, root?, reportDir?, workItemRef?, ' +
    'agentTypes?, workerModel?, workerEffort?, reviewerModel?, mergeModel?, reporterModel?, triageModel?, gateModel?, ' +
    'extendImplementerModel?, fixRounds?, gateN?, gateCmd?, integrationBranch?, skipGate?, ' +
    "tiering?: 'auto'|'off', reviewPanel?, breakerThreshold?, extendRateThreshold?, budgetReserve? }"
  )
}
{
  // Args removed by the serialisation redesign. Silently ignoring one changes
  // behaviour without saying so — `skipIntegrate: true` used to stop before
  // integrate+gate and would now run a full gate.
  const gone = ['analystConcurrency', 'skipIntegrate', 'integratorModel', 'integrateScriptPath']
    .filter((k) => A[k] !== undefined)
  if (gone.length) {
    throw new Error(
      `removed arg(s): ${gone.join(', ')}. Units are strictly sequential now, integration happens per unit, `
      + 'and the integrator is not a separate slot. Use `skipGate` to stop after review; drop the rest.'
    )
  }
}
{
  // A duplicate id would build twice and collapse into one OUTCOME row; a
  // missing id would file snapshots and outcomes under 'undefined'.
  const dup = A.cases.map((c) => c.id).filter((id, i, arr) => arr.indexOf(id) !== i)
  if (dup.length) throw new Error(`duplicate case id(s) in args.cases: ${[...new Set(dup)].join(', ')}`)
}
// analyzeOnly: stop after the analyst front (campaign heads pass — the
// conductor analyzes breadth-first heads to source the foundation inventory).
// preAnalyzed: cases already analyzed in an earlier analyzeOnly run — their
// units skip the analyst dispatch and go straight to build.
const ANALYZE_ONLY = A.analyzeOnly === true
const PRE = new Map((Array.isArray(A.preAnalyzed) ? A.preAnalyzed : []).map((p) => [p.id, p]))
const SLUG = A.slug
const BASE = A.base
const CASES = A.cases
const ROOT = A.root ? `${String(A.root).replace(/\/+$/, '')}/` : ''
// ALWAYS dispatch named agent types: the SubagentStart hook resolves role
// memory from the agent name; an anonymous workflow agent gets none.
const TYPES = {
  analyst: 'qa-engineer',
  implementer: 'test-automation-engineer',
  reviewer: 'qa-engineer',
  gate: 'test-automation-engineer',
  // Every dispatch that touches the repository is named. Anonymous ones resolve
  // to no role and therefore get no role memory or project briefing.
  reporter: 'test-automation-engineer',
  ...(A.agentTypes ?? {}),
}
// No model opt = the agent definition's frontmatter `model:` governs (agentType
// resolves from the same registry as the Agent tool: explicit opt > frontmatter
// > inherit). Analyst, implementer, and gate deliberately pass NO model so the
// installed AGENT.md stays the configuration surface; args override per run.
const WORKER = {
  ...(A.workerModel ? { model: A.workerModel } : {}),
  ...(A.workerEffort ? { effort: A.workerEffort } : {}),
}
// Reviewer: same rule — frontmatter governs unless an arg overrides. (An
// earlier hardcoded 'sonnet' floor here silently overrode a project's tuned
// qa-engineer frontmatter; the gate backstops review quality regardless.)
const REV = {
  ...(A.workerEffort ? { effort: A.workerEffort } : {}),
  ...((A.reviewerModel ?? A.workerModel) ? { model: A.reviewerModel ?? A.workerModel } : {}),
}
// Opt-in per-case tiering for extend-existing gap-fills (gate catches weakness).
const EXTEND_MODEL = A.extendImplementerModel ?? null
// ANALYST TIERING. The standalone analyst dispatch earns its cost on NOVEL
// ground — unmapped screens, ambiguous steps. On a surface the suite already
// maps (its _surface.md digest exists), most of that exploration re-reads
// known ground, so a cheap triage dispatch routes those units to a COMBINED
// analyse+build slot: one implementer dispatch does both halves (still
// executes the case live, still writes and commits the AFS on the trunk
// first). Conservative by construction — triage defaults to the analyst on
// any doubt, and the combined slot itself returns `needs-analyst` (before
// writing anything) when the ground turns out novel, falling back to the
// normal chain. `tiering: 'off'` restores the always-analyst behavior.
const TIERING = A.tiering ?? 'auto'
if (!['auto', 'off'].includes(TIERING)) throw new Error(`tiering must be 'auto' or 'off', got: ${TIERING}`)
// Resume-after-ceiling: the halt is detected from a worker's NOTES, and that
// return replays verbatim from cache under resumeFromRunId — without this
// flag the cached ceiling note would re-halt the run at the same unit forever.
const QUOTA_RESUME = A.quotaResume === true
const BREAKER = A.breakerThreshold ?? 3
const PANEL = A.reviewPanel === true
// Extend-rate quality flag (flag, never halt — mature suites legitimately run
// high extend rates): when extend+covered conclusions exceed this share of
// analyzed cases, the return carries a quality flag → the lead blind-audits a
// sample (re-analysis by a second analyst) before trusting the batch.
const EXTEND_RATE = A.extendRateThreshold ?? 0.5
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
// reportDir: the campaign conductor gives every wave (and the heads pass) its
// own dir — waves share this SLUG for the snapshot dir, and without a distinct
// report location each wave's report.json would overwrite the previous one's.
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
// quota-throttled Bedrock: one combined slot burned ELEVEN attempts, each
// re-implementing the same case from scratch, because nothing had ever landed
// on the case branch (the AFS, committed on the trunk per its own rule, was
// the one thing that survived). The continue-vs-rebuild judgment is the
// worker's: a script cannot tell "half-finished and coherent" from "abandoned
// and wrong", and both look identical to `git rev-parse`.
const CHECKPOINT_RULE =
  'CHECKPOINT DISCIPLINE — this dispatch can be killed and re-dispatched without warning (a stalled ' +
  'model stream is indistinguishable from thinking), and the retry inherits ONLY what is committed. ' +
  'So: (1) BEFORE writing anything, check whether your feature branch already exists with commits ' +
  'from a killed attempt (`git log <trunk>..<branch>`, `git status`): coherent work in progress -> ' +
  'continue it and say in notes what you inherited; wrong or contradicting the AFS -> rebuild those ' +
  'parts and say so. Never silently restart on a branch that already has work, and never assume it ' +
  'is finished because it exists. (2) Commit as milestones land — first coherent skeleton, spec ' +
  'green once, each fix — by exact path on your branch; push after the first commit and then per ' +
  'milestone ONLY if this project pushes to a remote (`.agents/profile.md` § Automation PR policy / ' +
  '`git remote -v`) — on a local-only project the commits alone are the checkpoint, skip pushes, ' +
  'that is expected, not a failure. '

// FOREIGN TEXT GOES THROUGH HERE. Case titles come from the TMS, blocking items
// and notes are written by other agents, tickets by the implementer — none of
// it is authored by this script, and all of it lands inside a prompt that IS
// instructions. Two failure modes, one guard: an unbounded blob crowds out the
// contract it was pasted into, and text carrying prompt structure (a heading, a
// fence, a role line) reads as structure rather than as the datum it is. So:
// clamp, defuse the markers, and keep it a quoted value.
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
  'layer ships. You COMMIT WHAT YOU PRODUCE: code, AFS, and knowledge ' +
  'promotions alike, `git add` by exact path on the branch you are on. A ' +
  'dispatch that forbids git (an analysis-only pass) leaves files on disk for ' +
  'a later stage to land. Committed knowledge survives tree cleaning and ' +
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
  'did not write: run receipts are untracked bookkeeping, and memory or AFS ' +
  'written since the last commit are just as exposed — all of it vanishes ' +
  'silently. Need a clean tree before a checkout? Stash BY PATH ' +
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
const ANALYST_VERDICT = ['ready-for-automation', 'extend-existing', 'blocked', 'un-automatable', 'already-covered', 'out-of-scope-by-author']
const ANALYST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['surface_key', 'family_afs', 'cases', 'notes', 'findings'],
  properties: {
    surface_key: { type: 'string' },
    // True only when every member shares ONE AFS file — cases that differ only
    // in DATA. Cases differing in STEPS get one AFS each and this stays false.
    // The workflow verifies it against the paths you actually wrote.
    family_afs: { type: 'boolean' },
    cases: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['case_id', 'verdict', 'afs_path', 'notes'],
        properties: {
          case_id: { type: 'string' },
          verdict: { type: 'string', enum: ANALYST_VERDICT },
          afs_path: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'status', 'branch', 'pr', 'reruns', 'notes', 'findings'],
  properties: {
    // Echo of the unit's case ids EXACTLY as dispatched — the parametric
    // attribution key: the telemetry capture reads it from this return's
    // receipt instead of regex-mining the prompt (field case 2026-08-18:
    // mining minted a phantom case from a run-report filename).
    unit_ids: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['built', 'blocked', 'needs-analyst-rerun', 'needs-escalation'] },
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
    // `blocked` on a ticket rather than `automated`.
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
          // would demote every OTHER case on the branch to `blocked` too.
          case_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
// Triage: one cheap read-only dispatch per batch that routes each unit —
// standalone analyst for novel ground, combined analyse+build for mapped ground.
const TRIAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['units', 'notes'],
  properties: {
    units: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['ids', 'route'],
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          route: { type: 'string', enum: ['analyst', 'combined', 'manual-qa-verified'] },
          why: { type: 'string' },
          // manual-qa-verified only: the paths the build dispatch works from
          // (authored case files, the run report, the KB dir).
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    notes: { type: 'string' },
  },
}
// Combined slot: the analyst return + the implementer return in one shape.
// `needs-analyst` is its escape hatch — returned BEFORE any write when the
// ground turns out novel, so the normal analyst chain takes over cleanly.
const COMBINED_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'surface_key', 'family_afs', 'cases', 'status', 'branch', 'pr', 'reruns', 'notes', 'findings'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },   // echo — see IMPL_SCHEMA; stays filled even on a needs-analyst return (cases[] may be empty there)

    surface_key: ANALYST_SCHEMA.properties.surface_key,
    family_afs: ANALYST_SCHEMA.properties.family_afs,
    cases: ANALYST_SCHEMA.properties.cases,
    status: { type: 'string', enum: ['built', 'blocked', 'needs-analyst', 'needs-analyst-rerun', 'needs-escalation'] },
    branch: { type: 'string' },
    pr: { type: ['integer', 'null'] },
    reruns: { type: 'integer' },
    rerun_causes: IMPL_SCHEMA.properties.rerun_causes,
    expected_red: IMPL_SCHEMA.properties.expected_red,
    notes: { type: 'string' },
    findings: FINDINGS,
  },
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'verdict', 'findings', 'blocking', 'notes'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },   // echo — see IMPL_SCHEMA
    verdict: { type: 'string', enum: ['APPROVED', 'CHANGES_REQUESTED'] },
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
    //   external        — it cannot be resolved on this branch at all (AFS
    //                     drift, a missing framework primitive, a product
    //                     defect, a broken environment). Stop and escalate.
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
// Analyst verdicts that mean "no automation work is needed here" map straight
// to a terminal outcome; the rest advance or stop.
const VERDICT_OUTCOME = {
  'already-covered': 'already-covered',
  'out-of-scope-by-author': 'out-of-scope',
  'un-automatable': 'un-automatable',
  blocked: 'blocked',
}
const IMPL_STOP = {
  blocked: 'blocked',
  'needs-analyst-rerun': 'blocked',
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
    log(`circuit breaker TRIPPED — ${breakerRun} consecutive '${cause}' analysis stops; remaining units stay not-started` +
      (cause === 'agent-died'
        ? ' (agents dying without a return is ALSO what an account ceiling looks like from here — check the last transcript before treating this as a batch defect)'
        : ''))
  }
}

// ---- infra stalls ----------------------------------------------------------
// The harness kills a subagent whose model stream stops making progress and
// retries it a few times; when EVERY attempt stalls, agent() THROWS ("agent
// stalled on all N attempts") instead of returning null. Field case
// 2026-08-17, quota-throttled Bedrock: one combined slot burned 11 attempts
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

// ---- slot dispatches -------------------------------------------------------
let analyzedCount = 0
let extendishCount = 0
const extendCases = []

// Admission guards shared by the analyst and combined slots — the reasons a
// unit is not even started (account ceiling, breaker, budget reserve).
function admitAnalysis(unit) {
  const ids = unit.map((c) => c.id)
  if (quotaHalted) {
    ids.forEach((id) => record(id, { note: 'account ceiling — admission halted before analysis' }))
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

async function runAnalyst(unit) {
  const ids = unit.map((c) => c.id)
  // Pre-analyzed unit (conductor heads pass): reconstruct from data, no dispatch.
  if (ids.every((id) => PRE.has(id))) {
    const members = ids.map((id) => PRE.get(id))
    members.forEach((m) => record(m.id, { outcome: 'analysed', afs: m.afs_path }))
    return {
      surface_key: PRE.get(ids[0]).surface_key || 'default',
      // Non-empty path required: two members with afs_path '' share a value,
      // not an AFS file — an empty "family" would demand a parameterized spec
      // triangulated against a file that does not exist.
      family_afs: members.length > 1 && Boolean(members[0].afs_path) && new Set(members.map((m) => m.afs_path)).size === 1,
      members: members.map((p) => ({ id: p.id, afs_path: p.afs_path })),
    }
  }
  if (!admitAnalysis(unit)) return null

  const clusterNote = unit.length > 1
    ? `This is a CLUSTER dispatch: ${unit.length} similar cases, ONE live session. Shared login/navigation/discovery is the point — but you MUST execute EVERY case's steps individually and record per-case observations; "executed the first, assumed the rest" is forbidden. A case that diverges from the family mid-exploration: return it with its own verdict and note (it will run solo). Where the cases are true variants of one flow, write ONE family AFS (parameter table, one row per case, per-case Coverage Map rows; family_afs=true, same afs_path for members). `
    : ''
  const a = await agent(
    `${PREAMBLE}\n\nAnalyst slot — analyse ${unit.map((c) => `${c.id}${c.title ? ` (${quote(c.title, 120)})` : ''}`).join(', ')} per the test-case-analysis skill § Analyst slot contract. ` +
    clusterNote +
    `Read each case's snapshot first: ${ids.map((id) => SRC(id)).join(' , ')} (written at intake); ONLY if missing, fetch via the project's TMS adapter (.agents/test-automation.yaml) and note the gap. ` +
    'Before exploring, read the feature\'s exploration digest test-specs/<feature>/_surface.md if present (verify handles as you use them); create or update it after your run. ' +
    // ANALYZE-ONLY runs (the campaign heads pass) have no build after them and
    // no branch switching at all, so there is nothing to protect the files
    // from — and the next stage (the foundation) reads them straight out of
    // this tree. Committing there would put doc commits on a branch nothing
    // merges. So: commit on a real batch, leave on disk for a heads pass.
    (ANALYZE_ONLY
      ? 'YOU OWN THE TREE RIGHT NOW and nothing else runs. This is an ANALYSIS-ONLY pass: write your AFS, the digest, and any memory entries to disk and LEAVE them there uncommitted — run no git command and do not switch branches. The next stage reads them out of this same tree, and the campaign FOUNDATION stage is the designated lander: it stages and commits your files with its own work, so leave them exactly where you wrote them. '
      : `YOU OWN THE TREE RIGHT NOW and nothing else runs, so ordinary git is yours. FIRST make sure you are on the batch trunk, because everything in this batch branches from it: \`git rev-parse --verify ${TRUNK}\` — if it exists (locally or on the remote), check it out; if it exists NOWHERE, create it: \`git checkout -B ${TRUNK} ${BASE}\`, then \`git push -u origin ${TRUNK}\` ONLY if this project pushes to a remote (\`.agents/profile.md\` § Automation PR policy / \`git remote -v\`) — on a local-only project skip pushes, that is expected, not a failure. Never -B a trunk that already exists — that discards units already merged into it. ` +
        `THEN write your AFS, the digest, and any role-memory entries you owe, \`git add\` them BY PATH, commit, and push (same remote rule — skip when there is none). Do NOT switch to any other branch — leave the tree on ${TRUNK} when you finish. ` +
        'Committing your own analysis is the point: it lands the moment it exists, so a case that turns out already-covered or blocked still has its AFS on the trunk, and an interrupted run loses nothing. Stage by exact path rather than `git add -A` — that is ordinary hygiene: the tree may hold artifacts from a previous unit that are not yours to commit. ') +
    'READ THE NEIGHBOURS FIRST, before you execute: grep test-specs/ and the suite dir BY BEHAVIOUR (the observable, the UI label, the endpoint) — never by case id — to arrive knowing the handles, the flow that reaches the screen, the fixtures and the conventions. That is what makes analysis cheap. This is REUSE, not a duplicate hunt: reading a spec that turns out to be unrelated costs minutes, but wrongly calling a case already-covered means it is never automated and the hole is invisible. So the normal outcome here is ready-for-automation WITH better context. already-covered is the rare exception and needs a spec merged to ' + BASE + ' proving the SAME observable with the SAME expected result, cited at file:line — same screen, same page object or a similar title is NOT coverage. When in doubt, ready-for-automation and say what you checked in notes. ' +
    'FAST-REACH: reuse the suite to travel — authenticate via the framework\'s auth state/fixture and drive deep navigation via existing specs/page-object scratch runs; transit is NOT execution (the case\'s own steps you still run and observe live), and a failing transit path falls back to manual navigation AND gets flagged in notes (possible regression). ' +
    'You are the only analyst running, so the shared Playwright MCP browser is yours — no lane, no isolated instance, no port juggling. ' +
    // The two verdicts have different exposure, so they get different targets.
    // `extend-existing` produces work that rides this batch and shares its fate,
    // so a target on the trunk is safe. `already-covered` is TERMINAL — it drops
    // the case out of the remainder — so it needs a fact that has already
    // landed, or a red gate later would close a case whose "coverage" never
    // shipped, invisibly.
    `MERGED-TARGET RULE: \`extend-existing\` may target a spec merged to ${BASE} OR already on this batch's trunk ${TRUNK} (earlier units in this batch have merged into it). \`already-covered\` is stricter: it may target ONLY a spec merged to ${BASE}, because it CLOSES the case — a terminal verdict needs coverage that has already landed. Never target a same-batch AFS that is not yet merged; when in doubt classify ready-for-automation. ` +
    'Execute against the live system per your contract — do not skip execution. Prefer scripted probes over full-page snapshots (browser-tools.md § Probe first). ' +
    'Write AFS files to the project\'s test-specs/ convention. ' +
    'surface_key: one stable kebab-case identifier for the page/component family this unit exercises (cluster members share it by construction). ' +
    'If you cannot proceed because of an ACCOUNT/USAGE LIMIT (not a problem with the app or the case), say exactly that in notes — it stops the batch cleanly instead of stopping healthy cases. ' +
    'Return one cases[] entry per case id, afs_path relative to the project root ("" if none written).',
    { label: `analyst:${label(unit)}`, phase: 'Analysis', agentType: TYPES.analyst, ...WORKER, schema: ANALYST_SCHEMA }
  )
  return absorbAnalysis(unit, a)
}

// Post-dispatch absorption shared by the analyst and combined slots: verdict
// routing, extend-rate accounting, breaker feeding, and family verification —
// over any analyst-shaped return ({cases, surface_key, family_afs, findings}).
function absorbAnalysis(unit, a) {
  const ids = unit.map((c) => c.id)
  if (!a || !Array.isArray(a.cases) || a.cases.length === 0) {
    // A null return is an agent that DIED (skipped, interrupted, terminal API
    // error) — which is also exactly what an account ceiling looks like from
    // here. Its own breaker cause, so a trip names that ambiguity instead of
    // reading as a batch defect.
    breakerCount('agent-died', '')
    ids.forEach((id) => record(id, { outcome: 'not-started', note: 'analysis agent died without a return — a harness death, nothing was learned about the case (it re-enters the next batch untouched); if several died in a row, suspect the account ceiling before the environment' }))
    return null
  }
  addFindings(ids, a.findings)
  const byCase = new Map(a.cases.map((c) => [c.case_id, c]))
  // Count only rows about THIS unit's ids: the schema cannot stop an analyst
  // returning a foreign case_id, and a confabulated row must not skew the
  // extend-rate flag or leak into extend_cases.
  const unitRows = a.cases.filter((c) => ids.includes(c.case_id))
  analyzedCount += unitRows.length
  for (const c of unitRows) {
    if (c.verdict === 'extend-existing' || c.verdict === 'already-covered') {
      extendishCount += 1
      if (c.verdict === 'extend-existing') extendCases.push(c.case_id)
    }
  }
  const adv = ids.filter((id) => ['ready-for-automation', 'extend-existing'].includes(byCase.get(id)?.verdict))
  const rest = ids.filter((id) => !adv.includes(id))
  if (rest.length) {
    // Only environment-shaped stops feed the breaker. already-covered /
    // out-of-scope / un-automatable are HEALTHY terminal verdicts — a mature
    // suite legitimately produces runs of them (see the extend-rate comment:
    // "flag, never halt") — and any completed analysis proves the environment
    // is alive, whatever it concluded.
    const blockedRest = rest.filter((id) => (VERDICT_OUTCOME[byCase.get(id)?.verdict] ?? 'blocked') === 'blocked')
    let ceilingNow = false
    if (blockedRest.length) {
      const first = byCase.get(blockedRest[0])
      const wasHalted = quotaHalted
      breakerCount('blocked', first?.notes ?? '')
      ceilingNow = !wasHalted && quotaHalted
    }
    for (const id of rest) {
      const c = byCase.get(id)
      // A ceiling is a HARNESS stop, not a case verdict: those cases are
      // not-started — nothing was learned — per playbook § blocked vs not-started.
      const ceiling = ceilingNow && (VERDICT_OUTCOME[c?.verdict] ?? 'blocked') === 'blocked'
      record(id, ceiling
        ? { outcome: 'not-started', note: 'account ceiling — nothing was learned about the case; it re-enters the next batch untouched' }
        : { outcome: VERDICT_OUTCOME[c?.verdict] ?? 'blocked', note: c?.notes || c?.verdict || 'no analyst verdict', afs: c?.afs_path || undefined })
      log(`${id} → ${OUTCOME[id].outcome}: ${OUTCOME[id].note}`)
    }
  }
  // Any completed verdict that is not 'blocked' resets the streak — the
  // breaker is for an unbroken run of environment-shaped stops only.
  if (adv.length || rest.some((id) => (VERDICT_OUTCOME[byCase.get(id)?.verdict] ?? 'blocked') !== 'blocked')) {
    breakerCause = null; breakerRun = 0
  }
  if (!adv.length) return null
  adv.forEach((id) => record(id, { outcome: 'analysed', afs: byCase.get(id).afs_path }))
  const members = adv.map((id) => ({ id, verdict: byCase.get(id).verdict, afs_path: byCase.get(id).afs_path }))
  // A family is DEFINED by the members sharing one AFS file, not by the analyst
  // saying so. Trusting the claim let the two disagree, and the disagreement
  // reached the implementer as a contradiction: "FAMILY UNIT — write ONE
  // parameterized spec" pointing at three different AFS paths, or the reverse.
  // The paths are an observable fact; the flag is a self-report. Prefer the fact
  // (the same rule the rest of this pipeline runs on) and say so when they part.
  // Non-empty path required: two members whose afs_path is '' (allowed for
  // extend-existing) share a VALUE, not a file, and must not read as a family.
  const sharesOneAfs = members.length > 1 && Boolean(members[0].afs_path) && new Set(members.map((m) => m.afs_path)).size === 1
  if (a.family_afs === true && !sharesOneAfs && members.length > 1) {
    log(`${adv.join('+')}: analyst returned family_afs=true but wrote ${new Set(members.map((m) => m.afs_path)).size} AFS files — treating as separate specs (the files decide)`)
  }
  return {
    surface_key: a.surface_key || 'default',
    family_afs: sharesOneAfs,
    members,
  }
}

// ---- tiering: triage + the combined analyse+build slot ---------------------
// One cheap dispatch routes every unit; nothing else about the pipeline moves.
// A 'combined' unit spends one implementer dispatch where the normal chain
// spends two (analyst + implementer) — the saving the tiering exists for.
const ROUTES = new Map()   // sorted unit ids -> 'combined' | 'manual-qa-verified'
const MQ_EVIDENCE = new Map() // sorted unit ids -> evidence paths (manual-qa-verified route)
const routeKey = (ids) => [...ids].sort().join('+')
const routeOf = (unit) => ROUTES.get(routeKey(unit.map((c) => c.id))) ?? 'analyst'

async function runTriage() {
  if (TIERING !== 'auto' || ANALYZE_ONLY) return
  const pending = UNITS.filter((unit) => !unit.every((c) => PRE.has(c.id)))
  if (!pending.length) return
  const t = await agent(
    `${PREAMBLE}\n\nTriage slot — a READ-ONLY routing decision: no git, no browser, no writes of any kind. ` +
    "For each unit below decide who analyses it: 'analyst' (a standalone analyst explores the surface live first), 'combined' (one implementer dispatch analyses AND builds, because the ground is already mapped), or 'manual-qa-verified' (the manual-qa team ALREADY executed this case live — one implementer dispatch derives the AFS from their evidence and builds, no re-execution).\n" +
    `Units:\n${pending.map((unit) => `- ${unit.map((c) => `${c.id}${c.title ? ` (${quote(c.title, 80)})` : ''}`).join(' + ')} — snapshots: ${unit.map((c) => SRC(c.id)).join(' , ')}`).join('\n')}\n` +
    'Method: `ls test-specs/*/_surface.md` (the exploration digests), then skim each unit\'s snapshots just enough to name the screens/flows they touch. ' +
    'Also check for manual-qa evidence: run reports (`reports/RUN-*.md`, `reports/metrics/*.json` — per-case PASS/FAIL verdicts), the manual-qa authored case files (commonly `tasks/<suite>/<ID>_*.md` — steps, expected results, often selectors), and the `.agents/manual-qa/` KB. ' +
    "Route 'combined' ONLY when EVERY case in the unit walks surfaces whose _surface.md digest exists AND the steps read routine against it (known screens, concrete steps, no exploratory language). " +
    "Route 'manual-qa-verified' ONLY when EVERY case in the unit has a manual-qa run record with verdict PASS AND its authored manual-qa case file exists — list those paths in evidence[] (each case file + the run report; the KB dir once). Run age does not matter; a FAIL/flaky/blocked run never qualifies — that unit needs the analyst's eyes. When both routes qualify, prefer 'manual-qa-verified' (it skips the live re-run). " +
    "Anything else — digest missing, snapshot missing, novel screen, ambiguous step, your own doubt — routes 'analyst'. The cost asymmetry decides doubt: a wasted analyst dispatch costs one dispatch; a shortcut on shaky ground costs a bad AFS. " +
    'Return ONE entry per unit with ids EXACTLY as listed — a unit shown as "A + B" is ONE entry with ids ["A","B"], never two entries. A split or partial unit cannot be matched back and falls to the analyst, wasting the shortcut you just chose.',
    { label: 'triage', phase: 'Analysis', agentType: TYPES.analyst, model: A.triageModel ?? 'haiku', effort: 'low', schema: TRIAGE_SCHEMA }
  )
  // A dead triage costs nothing: every unit takes the standalone analyst.
  if (!t) { log('triage agent died — every unit takes the standalone analyst (the conservative route)'); return }
  // Reassemble the return BY CASE COVERAGE, not by exact unit key. Field case
  // 2026-08-18: triage was shown the cluster "TC-001 + TC-002", chose
  // manual-qa-verified CORRECTLY — and returned it as two per-case rows; the
  // old exact-key guard silently dropped both, and the cluster fell to the
  // analyst default: a live-browser dispatch for the exact unit the shortcut
  // exists to save. Per-case votes keep both protections: an id naming no
  // pending case does nothing (hallucination guard), and a unit shortcuts
  // ONLY when EVERY member voted the SAME route — the mq eligibility rule is
  // per-case anyway. Partial or conflicting coverage stays on the
  // conservative analyst default, and both anomalies are logged, not silent.
  const unitOf = new Map()   // case id -> its unit's routeKey
  for (const unit of pending) { const k = routeKey(unit.map((c) => c.id)); for (const c of unit) unitOf.set(c.id, k) }
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
  for (const unit of pending) {
    const ids = unit.map((c) => c.id)
    const k = routeKey(ids)
    const v = votes.get(k)
    if (!v || v.size !== ids.length) continue          // partial coverage -> analyst default
    const routes = new Set(v.values())
    if (routes.size !== 1) continue                    // members disagree -> analyst default
    const route = routes.values().next().value
    if (route === 'combined') ROUTES.set(k, 'combined')
    else if (route === 'manual-qa-verified') { ROUTES.set(k, 'manual-qa-verified'); MQ_EVIDENCE.set(k, evid.get(k) ?? []) }
    if (ids.length > 1 && !returnedKeys.has(k)) reshaped++
  }
  if (foreign) log(`triage returned ${foreign} id(s) naming no pending case — ignored`)
  if (reshaped) log(`triage split ${reshaped} cluster(s) into per-case rows — reassembled by coverage (unanimous route required)`)
  const mq = [...ROUTES.values()].filter((v) => v === 'manual-qa-verified').length
  log(`triage: ${ROUTES.size}/${pending.length} unit(s) shortcut (${mq} manual-qa-verified, ${ROUTES.size - mq} combined); the rest take the standalone analyst`)
}

async function runCombined(unit, mqEvidence = null) {
  const ids = unit.map((c) => c.id)
  if (!admitAnalysis(unit)) return null
  // manual-qa-verified: the live execution ALREADY happened — manual-qa's
  // test-runner walked the case against the real app (per-step verdicts,
  // screenshots). Re-running it in a browser here would pay the most
  // expensive slot twice; the AFS derives from their evidence instead, and
  // anything thin escapes to the analyst the same way novel ground does.
  const mqIntro = mqEvidence
    ? `\nMANUAL-QA-VERIFIED unit. This case set was already executed live by the manual-qa team — do NOT re-run it in a browser. Evidence to work from: ${mqEvidence.join(' , ') || '(triage listed none — treat as thin)'} plus the .agents/manual-qa/ KB (app_profile, selectors, fragile areas).\n`
    : ''
  const c = await agent(
    `${PREAMBLE}\n\nCombined slot — analyse AND implement ${unit.map((m) => `${m.id}${m.title ? ` (${quote(m.title, 120)})` : ''}`).join(', ')} in ONE dispatch. ${mqEvidence ? 'Triage judged this unit manual-qa-verified' : 'Triage judged this surface already mapped'}, so the two halves share your session; each half's contract is unchanged.\n${mqIntro}` +
    (mqEvidence
      ? `FIRST, DECIDE — before writing anything: read the case snapshot(s) (${ids.map((id) => SRC(id)).join(' , ')}), the manual-qa case file(s) and run report from the evidence list, and the feature's test-specs/<feature>/_surface.md if present. If the evidence is thin (steps without expected results, no usable selectors in the case files or the KB), contradicts the snapshot, the run verdict is not PASS for any case, or anything is ambiguous — return status needs-analyst with why in notes and STOP: the standalone analyst takes over with a live session.\n` +
        'ANALYSIS HALF — derive the AFS per the test-case-analysis skill spec-format FROM THE EVIDENCE, no live execution: steps/expected from the manual-qa case file cross-checked against the TMS snapshot; selectors from the case file and the KB — they are hints, prefer the project\'s locator strategy (stable roles/ids) and mark any selector you could not ground as a risk in the AFS; cite the manual-qa run id as the AFS\'s execution provenance. A selector or expected value that exists NOWHERE in the evidence is a needs-analyst reason, never an invention. Then update the digest. '
      : `FIRST, DECIDE — before writing anything: read the case snapshot(s) (${ids.map((id) => SRC(id)).join(' , ')}) and the feature's test-specs/<feature>/_surface.md. If the digest is missing or stale, a flow is novel, a step is ambiguous, or honest analysis would need deep exploration — return status needs-analyst with why in notes and STOP: the standalone analyst takes over, and a wrong proceed costs a bad AFS while the fallback costs one dispatch.\n` +
        'ANALYSIS HALF — per the test-case-analysis skill § Analyst slot contract (read it if not loaded): execute the case live against the real system — the digest speeds travel, it never replaces execution; every step run and observed with per-case evidence — then write the AFS per spec-format and update the digest. ') +
    // Keep in step with the analyst dispatch: same trunk rule, same merged-target rule.
    `YOU OWN THE TREE and nothing else runs. Ensure the batch trunk first: \`git rev-parse --verify ${TRUNK}\` — check it out if it exists anywhere; if it exists NOWHERE, \`git checkout -B ${TRUNK} ${BASE}\` (never -B an existing trunk — that discards merged units). Commit the AFS, the digest, and any role-memory BY PATH on ${TRUNK} BEFORE you start building — analysis lands the moment it exists, even if the build half stops — and push ONLY if this project pushes to a remote (\`.agents/profile.md\` § Automation PR policy / \`git remote -v\`); on a local-only project the commit alone lands it, skip the push, that is expected, not a failure. ` +
    `MERGED-TARGET RULE: extend-existing may target a spec merged to ${BASE} or already on ${TRUNK}; already-covered may target ONLY a spec merged to ${BASE} (it is terminal); never a same-batch AFS not yet merged; in doubt, ready-for-automation. ` +
    (unit.length > 1 ? "Cluster: ONE live session, but EVERY case's steps executed and observed individually; true flow-variants of one flow → ONE family AFS (parameter table, same afs_path for members, family_afs=true). " : '') +
    "BUILD HALF — per your test-automation-implementation skill (preloaded): for the cases you just judged ready-for-automation/extend-existing, cut your feature branch FROM the trunk you are standing on, implement inside the existing framework (family AFS → ONE parameterized spec, a row per case asserting its OWN expected values), run green ONCE locally (determinism is the gate's job), retry ≤ 2 reruns on one root cause, declare red-by-design tests in expected_red[] with case_ids, land your work against the trunk (never the base) per \`.agents/profile.md\` § Automation PR policy — a PR against the trunk where the project uses PRs, otherwise leave your feature branch ready for the merge step — and leave the tree on your feature branch either way. If NO case advances (every verdict terminal), skip the build half and return status blocked with a one-line note. " +
    CHECKPOINT_RULE +
    `Return unit_ids EXACTLY as given here: [${ids.join(', ')}] — it keys this dispatch's telemetry attribution; never add, drop, or reformat ids. ` +
    'Return BOTH halves: cases[] (per-case verdict/afs_path/notes) + surface_key + family_afs, AND status/branch/pr/reruns (plus rerun_causes: one short root-cause label per rerun — the cap is per cause, not total) for the build. A needs-analyst return still satisfies the schema with EMPTY values — cases: [], surface_key: "", family_afs: false, branch: "", pr: null, reruns: 0 — never invented verdict rows.',
    { label: `${mqEvidence ? 'combined-mq' : 'combined'}:${label(unit)}`, phase: 'Build', agentType: TYPES.implementer, ...WORKER, schema: COMBINED_SCHEMA }
  )
  if (c && c.status === 'needs-analyst') {
    addFindings(ids, c.findings)
    log(`${label(unit)}: combined slot declined — ${quote(c.notes, 140)} — falling back to the standalone analyst`)
    return 'fallback'
  }
  const u = absorbAnalysis(unit, c)
  if (!u) return null
  // findings were recorded by absorbAnalysis; hand buildUnit an empty list so
  // they are not double-counted on the pre-built path.
  return { u, impl: { status: c.status, branch: c.branch, pr: c.pr ?? null, reruns: c.reruns, rerun_causes: c.rerun_causes ?? [], notes: c.notes, findings: [], expected_red: c.expected_red } }
}

const REVIEW_LENSES = [
  'assertion strength & per-step coverage (every case-side expected result asserted AT its step, not only end-state)',
  'defect masking & error swallowing (test.fail/skip/soft-pass patterns, catch-and-ignore, weakened assertions)',
  'coverage fidelity (case ↔ AFS ↔ diff triangulation: every Coverage Map row disposition holds in the code)',
]

function reviewOnce(u, impl, fixNote, lens) {
  const ids = u.members.map((m) => m.id)
  return agent(
    `${PREAMBLE}\n\nReviewer slot — STATIC review of ${ids.join(', ')} per the test-automation-workflow skill's references/reviewer-contract.md ` +
    '(do not execute the spec; the hardening gate does). ' +
    `Branch: ${impl.branch}. PR: ${impl.pr ?? 'n/a'}. AFS: ${[...new Set(u.members.map((m) => m.afs_path))].join(', ')}. ` +
    'Read the diff via `git diff <base>...<branch>` — do NOT check the branch out (the tree is shared and a build may follow yours). ' +
    `FIRST read each case snapshot (${ids.map((id) => SRC(id)).join(' , ')}; fetch via the TMS adapter only if missing), then triangulate case ↔ AFS ↔ diff FOR EVERY CASE. ` +
    (u.family_afs ? 'This is a FAMILY spec: per-ROW triangulation — every case id maps to a data-table row whose DISTINCT expected values are actually asserted; a shared flattened assertion is CHANGES_REQUESTED. ' : '') +
    'For every Coverage-Map row claiming covered-by/extend, verify the disposition against the covering spec\'s ACTUAL assertions (does that assertion really exist, at that step?) — never against its mere existence. ' +
    (lens ? `Your assigned review lens — judge ONLY through it: ${lens}. ` : 'Cover per-step assertions and the masking hunt. ') +
    (fixNote
      ? `This is the re-review after a fix round. Prior blocking findings:\n${fixNote}\n` +
        'For EVERY item you still block on, put an entry in blocking_detail[] with the status that is TRUE OF THE DIFF, not of your patience:\n' +
        '  - `unaddressed` — you can see no serious attempt against it. Nothing in the diff touches the code it names, or the change is cosmetic/partial. Forgotten and half-done both count here.\n' +
        '  - `persists` — a genuine attempt was made against the right code and the problem is still present. Say in notes what was tried and why it did not work.\n' +
        '  - `external` — it cannot be resolved on this branch at all: the AFS is wrong, a framework primitive is missing, it is a product defect, the environment is broken.\n' +
        'Scope every blocking_detail entry with case_ids[] — the ids from THIS unit the blocker actually binds. Omit case_ids only when it truly holds the whole unit (a shared fixture, the family AFS, a framework gap). Scoping is load-bearing: when every surviving blocker is confined to a subset of the cases, the workflow carves those cases out and lands the rest — an unscoped entry chains all the finished cases to the fate of one stuck one.\n' +
        'This decides whether the case gets another round. `unaddressed` sends it back — that is the point, and you must not use `persists` to end a loop you are tired of. Reserve `persists` for a real attempt that really failed; the difference is whether more effort could plausibly fix it. A NEW item you are raising for the first time is not in this list at all — new ground is progress and needs no status.\n'
      : '') +
    `Return unit_ids EXACTLY as given here: [${ids.join(', ')}] — it keys this dispatch's telemetry attribution. ` +
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

async function buildUnit(u, pre = null) {
  // `pre` is a combined slot's already-finished build half — the implement
  // dispatch is skipped and the result enters the same review/merge pipeline.
  let ids = u.members.map((m) => m.id)   // shrinks if the unit is split mid-loop
  const ul = ids.join('+')               // label keeps the original unit name
  // FINISHED WORK IS EXEMPT from admission guards, same rule as the merge
  // step: a combined slot's `pre` build already has a pushed branch and an
  // open PR, and dropping it here would strand reviewable work invisibly.
  if (!pre && budget.total && budget.remaining() < RESERVE) {
    ids.forEach((id) => record(id, { note: 'token budget reserve reached before implementation' }))
    return null
  }
  if (!pre && quotaHalted) {
    ids.forEach((id) => record(id, { note: 'account ceiling — halted before implementation' }))
    return null
  }

  const workspaceNote =
    'You work in the project\'s ONE working tree — its real checkout, with its installed dependencies and its env files. No worktree is created for you and you must not create one. NOTHING else runs while you do: units are strictly sequential, so the tree is yours alone for the whole dispatch. Two rules keep it usable for whoever comes next: stay on your own feature branch (never switch the tree to anything else), and stage ONLY your own paths (`git add <paths>`, never `-A`/`.`) so a stray artifact does not ride in on your commit. Leave the tree on your branch when you finish — the merge step takes it from there and returns it to the trunk. '
  const familyNote = u.family_afs
    ? `FAMILY implementation: these ${ids.length} cases share one AFS with a parameter table — implement ONE parameterized spec (one data row per case, each row asserting its OWN expected values, tagged with its case id). One branch, one landed unit for the family. `
    : (ids.length > 1 ? `Implement all ${ids.length} cases on ONE branch (separate specs are fine when the AFS files are separate). ` : '')

  const impl = pre ?? await agent(
    `${PREAMBLE}\n\nImplementer slot — implement ${ids.join(', ')} per your test-automation-implementation skill (preloaded; confirm per the preamble). ` +
    `AFS: ${[...new Set(u.members.map((m) => m.afs_path))].join(', ')}. Read the FULL case snapshot(s) for the coverage cross-check (Phase 1 Absorb): ${ids.map((id) => SRC(id)).join(' , ')}. ` +
    workspaceNote +
    // TWO BRANCH LEVELS, and the trunk is the KNOWN STATE. Every unit cuts from
    // the trunk and merges back into it, so the trunk accumulates the batch in
    // order and the tree is always somewhere named between units. Cutting from
    // the PREVIOUS unit's tip (an earlier revision) made the base of each build
    // depend on completion order — which broke resume caching — and deferred
    // every merge to one big integration step: 63 git commands, 90 conflict
    // hits and three git-surgery rescues in one measured session. Merging as we
    // go costs the same merges, smaller and while their author is still live.
    `The tree is on ${TRUNK} and that is where you start. Cut your feature branch FROM ${TRUNK} — it already carries every unit that finished before you, so page-object and fixture work accumulates and you are never rebasing onto a surprise. ` +
    `If ${TRUNK} does not exist anywhere yet (you are the first unit of a fresh batch), create it: \`git checkout -B ${TRUNK} ${BASE}\`, then \`git push -u origin ${TRUNK}\` ONLY if this project pushes to a remote (\`.agents/profile.md\` § Automation PR policy / \`git remote -v\`) — on a local-only project skip pushes, that is expected, not a failure. Never -B an existing trunk — that discards the units already merged into it. ` +
    `Landing is PER \`.agents/profile.md\` § Automation PR policy: where the project uses PRs, open yours against ${TRUNK}, NOT against ${BASE} — case PRs land on the batch trunk, and one PR takes the trunk to ${BASE} after the gate. On a project with no PR mechanism, skip the PR and leave your feature branch ready — the merge step lands it, and the trunk still reaches ${BASE} only after the gate. `+
    // A retried unit can arrive at a feature branch a previous attempt already
    // built on — CHECKPOINT_RULE carries both halves: continue-vs-rebuild is
    // the worker's judgment, and committing per milestone is what makes the
    // NEXT retry inherit anything at all.
    CHECKPOINT_RULE +
    // A multi-case unit is NOT automatically one spec. Clustering buys a shared
    // LIVE SESSION (one login, one discovery pass) — merging the output is a
    // separate judgement the analyst already made: one AFS means true
    // flow-variants, several means the cases only shared a surface. Without
    // saying so, the implementer has to infer the shape from a path count.
    (u.members.length > 1
      ? (u.family_afs
        ? `FAMILY UNIT: the analyst judged these true variants of ONE flow and wrote a single AFS with a parameter table, one row per case. Implement ONE parameterized spec — a data table with a row per case id, each row carrying its OWN expected values, and the case id tagged on its row's test so it fails by itself. Never flatten distinct expected values into a shared assertion: that is how a case silently stops being tested. `
        : `NOT a family: the analyst wrote a SEPARATE AFS per case (${u.members.length} of them), because these cases shared a surface but not a flow. Implement them as SEPARATE specs, one per case, exactly as if they had arrived alone. They ride ONE branch and land as ONE unit only because they were analysed together — that is a dispatch economy, not a reason to merge test code. Shared page objects and fixtures are of course reused. `)
      : '') +
    'If any assertion is red for a PRODUCT reason with a ticket (the `expect.soft()` + `// Known defect: <TICKET>` case), that test is RED BY DESIGN and stays red until the product ships. Do NOT weaken it — declare it in expected_red[] with the spec path, the test id, the ticket, one line of why, and (in a multi-case unit) the case_ids the red test belongs to, so only THOSE cases are held on the ticket and not their healthy neighbours on the same branch. The gate then runs it without counting it against the batch, and the affected case is reported blocked-on-that-ticket instead of automated. An undeclared red-by-design test makes the gate unpassable and blocks every healthy case beside it. ' +
    (ids.every((id) => PRE.has(id))
      ? `YOUR AFS comes from an earlier heads (analysis-only) pass: ${[...new Set(u.members.map((m) => m.afs_path))].join(', ')} — the campaign's foundation stage commits the heads output to ${BASE}, so it reaches your branch through the trunk. Read it from your branch; if it is NOT there, the heads output never landed — say so and return rather than reconstructing it from the case text. `
      : `YOUR AFS IS ALREADY COMMITTED on ${TRUNK}: ${[...new Set(u.members.map((m) => m.afs_path))].join(', ')} — the analyst committed it before you started, so read it from the branch you just cut. `) +
    'If your exploration finds it has drifted from the live product (a selector, an observable), AMEND it and commit the amendment on YOUR branch with the spec it belongs to, so the change is reviewed with the code that motivated it. Stage by exact path, never `git add -A`. '+
    familyNote +
    'The feature\'s `_surface.md` digest is the analyst\'s document: read it; you may APPEND attributed implementation-time facts on your branch (testids you added, fixture realities, blockers your run resolved — your implementation skill Rule 11 scopes this), but never rewrite its behavior or scope claims — report that drift in findings[] instead. ' +
    'Implement inside the existing framework, run it green ONCE locally (determinism is the gate\'s job, not repeated local runs), retry budget ≤ 2 reruns on the SAME root cause — distinct causes each get their own budget — then land the branch per your Phase 6 handoff and `.agents/profile.md` § Automation PR policy (a PR against the trunk where the project uses PRs, otherwise leave the branch ready for the merge step). ' +
    `Return unit_ids EXACTLY as given here: [${ids.join(', ')}] — it keys this dispatch's telemetry attribution; never add, drop, or reformat ids. ` +
    'Return the actual branch name, the PR number (null if none), your rerun count, and rerun_causes: one short root-cause label per rerun, so the cap can tell 4 reruns on 4 causes (fine) from 3 on one (blocked).',
    {
      label: `implement:${ul}`, phase: 'Build', agentType: TYPES.implementer,
      ...WORKER,
      ...(EXTEND_MODEL && u.members.every((m) => m.verdict === 'extend-existing') ? { model: EXTEND_MODEL } : {}),
      schema: IMPL_SCHEMA,
    }
  )
  if (!impl) { ids.forEach((id) => record(id, { outcome: 'blocked', note: 'implementer agent failed' })); return null }
  addFindings(ids, impl.findings)
  // The R2 cap is per ROOT CAUSE, not total — 4 reruns on 4 distinct causes is
  // within contract. Capping on the total conflated the two (measured twice in
  // the field: healthy units blocked as "R2 cap exceeded (4 reruns)" and the
  // lead hand-editing report.json to undo it). Without rerun_causes the total
  // is all there is, so the old conservative check stands as the fallback.
  const causeCounts = (impl.rerun_causes ?? []).reduce((m, c) => { m[c] = (m[c] ?? 0) + 1; return m }, {})
  const worstCause = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0]
  if (worstCause ? worstCause[1] > 2 : impl.reruns > 2) {
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `R2 cap exceeded (${worstCause ? `${worstCause[1]} reruns on "${worstCause[0]}"` : `${impl.reruns} reruns, causes not reported`}) — classify architectural vs AFS-drift vs product-change` }))
    return null
  }
  if (impl.status !== 'built') {
    ids.forEach((id) => record(id, { outcome: IMPL_STOP[impl.status] ?? 'blocked', note: impl.notes || impl.status }))
    return null
  }
  // Red-by-design declarations arrive from the INITIAL implement AND from any
  // fix round (a fixer restoring a weakened assertion declares it here too —
  // dropping those made the gate unpassable for exactly the case the mechanism
  // exists for). Attribution is per entry: an entry naming case_ids holds only
  // those cases; one naming none holds the whole unit.
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
  ids.forEach((id) => record(id, { outcome: 'built', branch: impl.branch, pr: impl.pr ?? undefined }))

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
  //     with a preservation sha), keeps their AFS, and sends the remainder
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
          `1. QUARANTINE by default — the code is usually fine and only the CASE is stuck. Mark ${carve.stuck.join(', ')}'s tests skipped per the project's convention (e.g. \`pytest.mark.skip(reason="blocked: <blocker> — carved from ${ul}, see <AFS path>")\`; family/data-table specs: mark just their rows via \`pytest.param(..., marks=...)\`). The finished code ships INERT on the trunk and re-arms by deleting the marker once the blocker clears. Quarantine is DECLARED, never silent: the reason must quote the blocker, the runner must report the test as skipped — that declaration is what makes this the sanctioned exception to the masking hunt, because a quarantined case recorded blocked claims nothing.\n` +
          '2. REMOVE instead ONLY when the blocker says the code ITSELF is wrong (masking, unsound, unreviewable). First record the preservation point: commit and push, then `git rev-parse HEAD` — once this unit merges that commit is in the trunk\'s history forever, and re-entry RESTORES from it (`git checkout <sha> -- <paths>`), never rebuilds. Then remove their test functions/files plus any page-object member or fixture NOTHING remaining uses (git grep a shared symbol before deleting it).\n' +
          '3. Either way KEEP their AFS on the branch — knowledge lands regardless. Amend each carved AFS: status blocked, one line quoting the blocker, plus the mode (quarantined at <path> | preserved@<sha> with the removed paths) so re-entry knows exactly how to resume.\n' +
          "4. Do NOT touch the remaining cases' logic or assertions beyond steps 1–2. Re-run the remaining spec(s) once (collect-only where execution is environment-blocked), confirm quarantined tests report as SKIPPED not passed, commit by path, then push and update the PR body with what was carved and why — where the project uses a remote/PRs (§ Automation PR policy); locally the commit alone is enough.\n" +
          'Return status built; your notes MUST START with `quarantined:<paths>` or `preserved@<sha>` per mode, then name exactly what was marked or removed. ' +
          `Return unit_ids EXACTLY as given here: [${ids.join(', ')}].`
        : `${PREAMBLE}\n\nImplementer slot — fix round ${round} for ${ids.join(', ')} on branch ${impl.branch} per your test-automation-implementation skill. ` +
          workspaceNote +
          'Load your receiving-code-review skill first if it is not in your context (it is on-demand, not preloaded) — it is the contract for this exact moment. ' +
          'Address EACH blocking finding (verify against the code first) and add the regression test that would have caught it, re-run the affected spec green once, commit — and update the PR where the project uses one (§ Automation PR policy):\n- ' +
          prior +
          (skipped.length
            ? `\n\nTHE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND — no attempt was visible in the diff:\n- ${skipped.join('\n- ')}\n`
              + 'Do them. If one genuinely cannot be done on this branch, say so in notes with the reason (missing primitive, AFS wrong, product defect) instead of leaving it silent — an unexplained gap reads as another skip and costs the unit another round.'
            : '') +
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
      ? `${prior}\n\n(${carve.stuck.join(', ')} were CARVED OUT of the unit after the round above — their blockers are moot; review only the carve itself. Each carved case is either QUARANTINED — a declared skip marker whose reason quotes the blocker, the sanctioned exception to the masking hunt; verify the marker and its quoted reason are present in the diff (a static check — the gate’s run is what shows it skipped) — or REMOVED with a preservation sha recorded. Their AFS remains marked blocked with the mode, and nothing the REMAINING cases use was removed or weakened.)`
      : prior)
    if (r) addFindings(ids, r.findings)
  }

  if (!r) { ids.forEach((id) => record(id, { outcome: 'blocked', note: `review/fix round ${round} failed` })); return null }
  if (r.verdict !== 'APPROVED') {
    const why = stopped ?? 'review CHANGES_REQUESTED'
    ids.forEach((id) => record(id, { outcome: 'blocked', note: `${why} after ${round} fix round(s): ${(r.blocking ?? []).join('; ').slice(0, 200)}` }))
    return null
  }
  ids.forEach((id) => record(id, { outcome: 'reviewed', branch: impl.branch, pr: impl.pr ?? undefined }))

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
  const perUnit = 3 + FIX_ROUNDS + (FIX_ROUNDS + 1) * (PANEL ? REVIEW_LENSES.length : 1)
    + (TIERING === 'auto' ? 1 : 0)               // a combined dispatch can precede a full fallback chain
  const worst = UNITS.length * perUnit + 2 + (TIERING === 'auto' ? 1 : 0)   // + gate, reporter, triage
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
const analyzed = []

phase('Analysis')
// A dead triage costs nothing either way — null OR thrown, every unit takes
// the standalone analyst (the conservative route).
try { await runTriage() } catch (e) {
  log(`triage threw (${String(e?.message ?? e).slice(0, 120)}) — every unit takes the standalone analyst`)
}

for (const unit of UNITS) {
  phase('Analysis')
  let u = null
  let pre = null
  const route = routeOf(unit)
  // A thrown analysis costs its unit, never the run. agent() returns null on
  // most deaths, but stall-retry exhaustion THROWS (measured 2026-08-17) —
  // uncaught, one stalled combined slot killed a whole batch with its report
  // unwritten. A stall is an environment fact, so it feeds the same breaker
  // as agent-died: three in a row stop admitting units.
  try {
    if (route === 'combined' || route === 'manual-qa-verified') {
      const c = await runCombined(unit, route === 'manual-qa-verified' ? (MQ_EVIDENCE.get(routeKey(unit.map((m) => m.id))) ?? []) : null)
      // 'fallback' = the shortcut slot judged the ground novel / the evidence
      // thin BEFORE writing anything — the normal analyst chain takes over.
      if (c === 'fallback') u = await runAnalyst(unit)
      else if (c) { u = c.u; pre = c.impl }
    } else {
      u = await runAnalyst(unit)
    }
  } catch (e) {
    const ids = unit.map((c) => c.id)
    const stalled = isStall(e)
    ids.forEach((id) => record(id, stalled
      ? { outcome: 'infra-stalled', note: stallNote('analysis', e) }
      : { outcome: 'not-started', note: `analysis dispatch threw: ${String(e?.message ?? e).slice(0, 160)}` }))
    breakerCount('agent-died', String(e?.message ?? e))
    log(`${label(unit)} ${stalled ? 'infra-stalled' : 'threw'} during analysis — continuing with the next unit`)
    continue
  }
  if (!u) continue
  if (ANALYZE_ONLY) {
    u.members.forEach((m) => analyzed.push({ id: m.id, afs_path: m.afs_path, surface_key: u.surface_key }))
    continue
  }
  // A thrown build costs its own unit and nothing else — the trunk is where it
  // was, so the next unit starts from a known state regardless.
  try {
    phase('Build')
    await buildUnit(u, pre)
  } catch (e) {
    const ids = u.members.map((m) => m.id)
    if (isStall(e)) {
      // A stall mid-build is the same environment fact as one mid-analysis —
      // but here the branch may hold checkpoint commits (CHECKPOINT_RULE), so
      // the note points the re-entry at them instead of at a blocker.
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

// ---- Phase 4: the hardening gate -------------------------------------------
// Its own agent — never the implementer, never the reviewer. It runs the
// batch's specs TOGETHER, N consecutive green: stronger than a per-case gate
// because it surfaces the parallel-interaction flakes a per-case run never
// sees. It does NOT merge, does NOT classify a red, does NOT fix. A red goes to
// the report; the lead classifies (product defect / flake / architectural) and
// may dispatch the stabilize workflow for the batch.
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit_ids', 'verdict', 'runs', 'green_specs', 'failures', 'notes'],
  properties: {
    unit_ids: { type: 'array', items: { type: 'string' } },   // echo of the batch's merged ids — see IMPL_SCHEMA

    // `incomplete` is NOT `not-run`. Measured 2026-08-09: three gates were cut
    // off with runs already banked and pytest still executing, reported
    // `not-run` because it was the only honest option in the enum, and their
    // merged units were labelled merged-ungated — so a lead-run green later had
    // nothing to attach to. Separating them lets the report say "resume here"
    // instead of "nothing is known".
    verdict: { type: 'string', enum: ['green', 'red', 'not-run', 'incomplete'] },
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
  },
}
let gate = null
const gateBranch = TRUNK
if (!ANALYZE_ONLY && !SKIP_GATE && merged.length) {
  phase('Gate')
  // A thrown gate (stall-retry exhaustion) proves nothing either way — gate
  // stays null, merged units become merged-ungated below exactly as if the
  // gate had been dropped, and the report still lands.
  try {
  gate = await agent(
    `${PREAMBLE}\n\nHardening gate for batch ${SLUG}. You did not write this code and you do not fix it — you PROVE it, and you report exactly what you saw.\n` +
    `Branch: ${gateBranch} (the batch trunk — every approved unit is already merged into it). Base: ${BASE}.\n` +
    `Run the batch's new/changed specs TOGETHER, ${GATE_N} CONSECUTIVE deterministic green runs, each a clean process against the live env. ` +
    'Use `scripts/gate/gate-case.mjs` for the mechanics (it merges the base FIRST — a run against a branch that lacks base proves nothing about what will land — refuses a dirty tree, and returns timings), ' +
    (GATE_CMD ? `with --cmd '${GATE_CMD}'. ` : 'resolving the suite command from .agents/testing.md § run commands. ') +
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
  // The gate proves the TRUNK, so it speaks for exactly the units on it.
  const integratedIds = new Set(merged.flatMap((r) => r.ids))
  if (gate?.verdict === 'green') {
    // A green gate proves the specs it COUNTED. A case carrying a red-by-design
    // test was deliberately excluded from that count, so the gate says nothing
    // about it — reporting it `automated` would claim proof the run never had.
    // Nor is it `blocked`: its red is pre-declared on a ticket, it merged with
    // the batch, and it re-enters when the product ships — that is its own
    // terminal outcome, `merged-sanctioned-red`, so audits stop reading a
    // deliberate, ticketed red as an unproven or failed unit.
    let autoCount = 0
    for (const id of integratedIds) {
      const red = OUTCOME[id]._expectedRed
      if (red?.length) {
        record(id, { outcome: 'merged-sanctioned-red', note: `red by design pending ${red.map((r) => r.ticket).join(', ')} — the gate ran it but could not count it; merged with the batch, re-enter once the product ships` })
        continue
      }
      record(id, { outcome: 'automated', gate: { runs: gate.runs, seconds: gate.seconds ?? [] } })
      autoCount++
    }
    log(`gate GREEN ${gate.runs}/${GATE_N} — ${autoCount} case(s) automated` + (EXPECTED_RED.length ? `, ${integratedIds.size - autoCount} held on ticketed defects` : ''))
  } else if (!gate || gate.verdict === 'not-run' || gate.verdict === 'incomplete') {
    // No verdict is NOT a red. An interrupted or dropped gate proves nothing
    // either way, and labelling its units `blocked` is how a dead run's own
    // summary becomes a false negative — measured live: a session killed
    // mid-gate reported "blocked: 14" while 13 of those 14 units were already
    // built, reviewed and MERGED on the trunk.
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
        note: cut
          ? `gate CUT OFF mid-run${banked}; merged on the trunk but unproven — resume the gate on ${gateBranch}, then WRITE THE VERDICT BACK into this report`
          : 'gate never produced a verdict (interrupted or dropped) — merged on the trunk but unproven; re-run the gate',
      })
    }
    log(`gate ${cut ? `incomplete${banked}` : 'not-run'} — ${integratedIds.size} merged unit(s) UNPROVEN, not blocked; re-run the gate on ${gateBranch}`)
  } else {
    const failedIds = new Set((gate.failures ?? []).flatMap((f) => f.case_ids ?? []))
    for (const id of integratedIds) {
      const why = failedIds.has(id)
        ? `gate red: ${(gate.failures.find((f) => (f.case_ids ?? []).includes(id))?.signature ?? '').slice(0, 200)}`
        : 'gate red for the batch — this spec did not itself fail; the batch is not proven until the red is resolved'
      record(id, { outcome: 'blocked', note: why })
    }
    log('gate red — classify (product defect / flake / architectural), then consider batch-stabilize')
  }
}

// ---- Phase 5: the report — ONE writer, at close -----------------------------
phase('Report')
// `_findingKeys` is dedup bookkeeping, not part of the report contract.
const rows = CASES.map((c) => { const { _findingKeys, _expectedRed, ...row } = OUTCOME[c.id]; return row })
const totals = rows.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc }, {})
const qualityFlags = []
if (analyzedCount >= 4 && extendishCount / analyzedCount > EXTEND_RATE) {
  qualityFlags.push(`extend-rate ${extendishCount}/${analyzedCount} exceeds ${EXTEND_RATE} — blind-audit a sample of the extend/covered conclusions (a second analyst re-analyzing 1-2) before trusting this batch's coverage`)
}
const stalledCount = rows.filter((r) => r.outcome === 'infra-stalled').length
if (stalledCount) {
  qualityFlags.push(`${stalledCount} case(s) infra-stalled — the harness killed their slot mid-flight (the model stream stopped; on a quota-limited provider check tokens/min throttling before blaming the batch); they re-enter the next batch untouched — check their unit branches for checkpoint commits first`)
}
// There is deliberately NO mirror flag for a batch with zero already-covered /
// extend-existing. Zero is the normal, healthy result: reading the neighbouring
// specs (§ 2b) exists to make ANALYSIS cheaper — handles, flows, conventions —
// not to close cases. A flag on "too little dedup" would push analysts toward
// calling cases covered, and the two errors are not symmetric: a redundant test
// is visible and cheap to delete, while a wrongly-deduped case is never
// automated and the hole never surfaces. Only the dangerous direction — too
// MANY extend/covered conclusions — is flagged, above.
const report = {
  batch: SLUG,
  base: BASE,
  // Tracker/TMS reference of the work-item this batch serves (issue, story,
  // suite link) — flows into the tokenomics dataset export's work_item_ref.
  // Optional: absent, the export uses a telemetry-cohort ref (T-<slug>).
  ...(A.workItemRef ? { work_item_ref: String(A.workItemRef) } : {}),
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
  `2. ${REPORT_DIR}/report.md — a readable rendering of the same data for a human: a totals line, then a table of case id / outcome / note, then any findings grouped by kind, then the gate verdict with its timings.\n` +
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
  analyzed,                                  // analyzeOnly runs feed this back as preAnalyzed
  extend_cases: extendCases,
  next: quotaHalted
    ? 'ACCOUNT CEILING — nothing to repair. Re-invoke with the SAME args plus resumeFromRunId AND quotaResume: true once the limit resets; completed units replay from cache (quotaResume keeps the replayed ceiling note from re-halting the run).'
    : gate?.verdict === 'green'
      // ONE PR takes the whole trunk to base — the units already merged into it,
      // so what was gated and what lands are the same object.
      ? `Gate green on ${gateBranch}. LAND IT: one PR from ${gateBranch} to ${BASE} per .agents/profile.md § Automation PR policy (auto-merge / human-approved / manual decides who presses it), then mirror to the TMS and run the close sweep. Replan anything not 'automated'. Where the tokenomics scope contract is active (a session-start line named your session id): record outcomes as they land (work-scope.mjs outcome <ID>=automated …), then work-scope.mjs close — it renders ${REPORT_DIR}/batch-report.md+.html and flags receipt DRIFT — and publish per .agents/profile.md § Reporting policy (dispatch the cheap publisher; no policy → the files ARE the report, flag the gap).`
      : merged.length && (!gate || gate.verdict === 'not-run' || gate.verdict === 'incomplete')
        // THE RECEIPT IS THE DELIVERABLE. Measured across two audits: leads
        // recover a failed gate flawlessly and then never correct report.json,
        // so 38 of 69 genuinely-green specs (55%) scored as unproven or absent
        // in the next rollup. Playbook prose did not fix it — this text is what
        // the lead actually reads at the moment it happens, so the obligation
        // lives here, next to the instruction that creates it.
        ? `${gate?.verdict === 'incomplete' ? `GATE CUT OFF MID-RUN (${gate.runs ?? 0}/${GATE_N} banked)` : 'GATE NEVER RAN'} — ${gateBranch} holds ${merged.length} merged unit(s) that are UNPROVEN, not blocked (outcome merged-ungated). Re-run the gate first (re-invoke with resumeFromRunId — completed units replay from cache — or dispatch the gate alone on ${gateBranch}) and classify nothing until a verdict exists. An interrupted run's own totals are a claim, not evidence: verify against .agents/telemetry/automation/returns/ (legacy _returns/) and git (playbook § Interruption). THEN, THE MOMENT YOU HAVE A VERDICT, WRITE IT BACK INTO ${REPORT_DIR}/report.json — gate.verdict, gate.runs, gate.seconds, and each case's real outcome ('automated' on green; 'merged-sanctioned-red' for a ticketed red-by-design). This file is the receipt every audit, every --resolved-from and the next batch's plan divide by: a gate you re-ran green but never wrote back scores as ZERO delivered, and the specs read as unproven forever. The scope contract, where active, backs this up: work-scope.mjs outcome + close after the write-back — the close render cross-checks report.json against the recorded gate verdict and prints DRIFT if the write-back was missed.`
        : `${stalledCount ? `${stalledCount} case(s) infra-stalled — an ENVIRONMENT failure (the model stream stalled), not a case failure: fix the provider first, check their unit branches for checkpoint commits, then re-enter them. ` : ''}Classify each blocked case (product defect → tracker; flake/test-code bug → batch-stabilize on ${gateBranch}; architectural → § Framework architecture), then replan the remainder. ${gateBranch} is NOT landed — nothing reaches ${BASE} until it is green. Record classifications as they land (work-scope.mjs outcome <ID>=blocked, where the scope contract is active) — the ledger stays honest even if this session dies before a close.`,
}
