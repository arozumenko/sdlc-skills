# Workflow accelerant — a batch as one deterministic workflow (Claude Code only)

On hosts with the native **Workflow tool**, running the batch as ONE
deterministic workflow is the **default path**, not an option to weigh each
time: a batch on Claude Code goes through the canonical script below — a batch
of ONE included — unless a § When NOT condition applies. Same slot contracts, same
outcomes; what changes is who enforces the choreography: code, not your
conscience. (Invoking the tool here is within its explicit-opt-in rule: the
operator installed this factory and handed you a batch — this skill's
instruction IS the opt-in.) On every other host (and whenever the tool is
unavailable), run the sequential dispatches per the playbook — the contracts
are identical, so nothing forks.

**Why bother:** conversational orchestration costs one full orchestrator turn
per dispatch AND per return — a batch of 5 is ~20 turns, each re-processing
your whole context. The workflow replaces those with script code — units run strictly one at a
time (§ Who may run at once) — enforces the
R2 cap / sequencing / exception routing as `if` statements, and survives
crashes (`resumeFromRunId` replays completed agents from cache — a batch that
dies at case 4 does not redo three live runner sessions).

## The canonical script

Ships with this skill: [`../scripts/workflows/batch-build.workflow.mjs`](../scripts/workflows/batch-build.workflow.mjs).
Do not re-author it per session — invoke it:

```
Workflow({
  scriptPath: "<installed skill dir>/scripts/workflows/batch-build.workflow.mjs",
  args: {
    slug: "<batch-slug>",                  // required — names the run's dir under .agents/automation/
    base: "origin/main",                   // required
    cases: [{ id: "TC-101", title: "…" }], // required — Intake is yours; snapshots already on disk
    // clusters: [["TC-1","TC-2","TC-3"]]  — pass them on flat batches too: units are the wall clock
    // root: "."                            — repo root override (rarely needed)
    // agentTypes: { runner, builder, reviewer, gate } — defaults: test-runner (manual-qa factory) /
    //                                        test-automation-engineer for the other three
    // workerModel / workerEffort           — builder default: inherit session
    // reviewerModel: null                  — frontmatter governs (no floor); override per run,
    //                                        or use reviewPanel for stakes
    // triageModel: "haiku"                 — the read-only evidence-check dispatch's model
    // quotaResume: false                   — set true ONLY when resuming after an account-ceiling halt
    // fixRounds: 8                         — runaway backstop for the review/fix loop, not the control
    // mergeModel / reporterModel: "haiku"  — the two deliberate cheap-tier slots
    // gateModel: null                      — gate agent tier; the script does the mechanics
    //                                        (run, time, record), so haiku is viable — but the
    //                                        blast-radius diff read is judgment, so default inherits
    // gateN: 3                             — consecutive deterministic greens the gate demands
    // gateCmd: null                        — suite command; null → the gate agent resolves it from .agents/testing.md
    // integrationBranch: "tests/batch-<slug>"
    // skipGate: false                      — true = stop after the last unit merges, no gate
    // reviewPanel: false                   — true = 3-lens static review panel, unanimous to approve
    // breakerThreshold: 3                  — consecutive same-cause parks that halt the front
    // budgetReserve: 60000                 — stop admitting cases when budget.remaining() drops below this
  }
})
```

## The phases

Route (evidence check / runner) → `Build` → `Gate` → `Report`, with the
per-unit steps alternating as the loop walks the units. There is no
`Integrate` phase — units merge into the trunk as they finish. The last phase
is the run's **only disk write**: `.agents/automation/<slug>/report.json` and
`report.md`, one row per input case.

**Reading `/workflows` while it runs.** The per-unit phases alternate as the
loop walks the units, so their counters climb throughout rather than one
finishing before the other starts. And the `❯` marker is the TUI's selection
cursor, not the running phase — the right-hand pane describes whatever row you
have selected, so `Report · Not started yet` is an answer about Report, not a
complaint about the run.

**No board, no clerks, no intermediate status writes.** A board records
progress, and progress only needs recording if something reads it mid-run;
nothing did — resume replays from the runtime's cache, `journal.jsonl` holds
every agent's return, git holds the branches and PRs. The measured case
against keeping a second copy of the truth (a clerk dispatch per transition;
4 of 12 merged cases drifted to a stale status) lives in the playbook's
state-and-recovery sections — one home, not two.

## Two branch levels

```
<base>                                  ← .agents/profile.md § Automation PR policy
 └─ tests/batch-<slug>                  ← the batch trunk: created and PUSHED by the
     ├─ tests/TC-001-…  → PR → trunk       first build, gated at the end, ONE PR to base
     ├─ tests/TC-002-…  → PR → trunk
     └─ …
```

The trunk exists from the FIRST UNIT — it is the known state everything
branches from, so it cannot appear later. The first unit's builder creates and
pushes it if it exists nowhere; every unit after that finds it. Two field reasons it
cannot be deferred. The gate checks out `origin/<trunk>`, so a trunk that only
appears at the end has to be pushed by the gate itself — a write its own
contract forbids. And gating a branch while merging N case PRs to base
**proves one object and ships another**: the gate ran the specs together, in one
tree, against one base; N separate merges reassemble that from parts nobody
proved in combination, and an interruption can leave base half-landed.

A batch of ONE degenerates cleanly: no trunk, the case branch targets base, one
PR either way.

## Who may run at once — nobody, and that is the design

> **Always return the tree to a known state, and always branch from it.**

A single working tree has ONE state at a time while slots need different ones:
a runner or a merge wants the trunk, a reviewer wants the branch it is judging,
a builder wants its own. Nothing reconciles that except ordering.

| Slot | Runs |
|---|---|
| Runner (`needs-execution` route) | one case at a time, on the trunk — writes only its own `reports/` |
| **Builder** | one at a time, on a branch cut from the trunk — commits spec + surface cache |
| Reviewer | after its own builder, on that branch's diff |
| Merge back | immediately after review approves; the tree returns to the trunk |
| Gate | once, on the trunk, after every unit has had its turn |
| Report writer | once, at the end |

The **only** sanctioned fan-out is read-only: several reviewers on one *finished*
diff (the opt-in `reviewPanel`), writing nothing, while no writer runs.

Why — with the field numbers (eight checkout aborts, 90 conflict hits, three
git-surgery rescues in one session) and what serialising buys back in agent
freedom — lives in playbook § ONE TREE, ONE MASTER. One home, not two.

**One working tree; isolation comes from branches.** A per-builder worktree
carries only *tracked* files, so it arrives without `.env` and without
installed dependencies. Measured on one campaign: 10 direct `.env.test`
failures plus **413** occurrences of the misleading symptom it produces
(`Invalid URL ''`, which reads as an auth bug), a dependency reinstall per
worktree that stalled two entire workflows, and 40 `branch is already used by
worktree` collisions. That tax is paid **per builder**, for isolation that
sequencing already gives.

**No worktrees anywhere in this pipeline.** Not as a default, not as an option:
the knob was removed from the build workflow, and the gate and the integrator —
which used to have their own — now work on a branch in the project's checkout
like everything else. **Isolation is branches; safety is order.** The tree has
exactly one writer at a time, and the sequence enforces it:

```
per unit, strictly in turn:
  earn the evidence if the route needs it (runner, on the trunk)
  → build (branch cut from trunk) → review → merge back (trunk)
then once:
  gate (trunk; refuses a dirty tree) → report
```

Dropping the gate's worktree **removed** work rather than adding it: a worktree
carries only tracked files, so the suite arrived there without its env file and
without dependencies, and `gate-case.mjs` had to carry env-resolution, symlink
repair and a `--fix-env` flag to undo that. The real checkout has all of it
already. One guard replaces the lot — and it is **precise, not blanket**
(reworked 2026-08-17): the gate refuses only dirt that matters — a dirty path
among the files it is proving (the base…branch diff), or one git itself
refuses to overwrite on checkout/merge (reported by exact path). Unrelated
noise — logs, configs, other factories' state — never blocks; it rides the
verdict record as `carriedDirt`.

**The cost, stated plainly.** Gating no longer overlaps the next batch's build —
wall clock goes from `max(build, gate)` to `build + gate`. That is real: in one
campaign the build side ran ~3× the gate's throughput and left 24 finished PRs
queued. The lever that pays it back is **clustering**: five similar cases as one
unit is one build *and* one gate run instead of five (campaign-planning.md
§ Clustering). Sequencing makes clustering worth more, not less.

**Nothing streams, and nothing overlaps.** A unit is analysed, built, reviewed
and merged before the next one starts. Page-object work accumulates because each
unit branches from the trunk *after* the previous one merged into it — by merge,
not by branch lineage, which also means the base of every build is a pure
function of the args rather than of who finished first.

One consequence worth knowing: only ONE slot drives the live environment at a
time, so an env that could not take two clients no longer constrains anything.
A **circuit breaker** halts the run after `breakerThreshold` consecutive
same-cause parks, so a dead environment stops costing after the third
case rather than the tenth.

**With builds sequenced, units are the wall clock** — which makes `clusters` the
main throughput lever, on flat batches as much as campaigns
(campaign-planning.md § Clustering): five similar cases as one cluster is one
unit on the chain, ≈ $14 instead of ≈ $69, and one review instead of five.

## The gate lives inside the run

A **separate agent in the workflow** — not the builder (who would be
certifying their own work), and not you — with a deliberately narrow contract:
**the coverage-grammar grep, then N consecutive deterministic greens; a red
anywhere ends the attempt, and it never merges, classifies, or fixes.** Mechanics are scripted
(`scripts/gate/gate-case.mjs`). The full doctrine — the two-count design (new
specs N×, blast radius once), the three scripted rules, and the measured
reason gating left the lead (12 vs 36 cases, 3h50m, 114 shell calls) — lives
in playbook § Gate — the merge signal; one home, not two. A red goes into the
report; classifying it is yours (playbook § Handling blockers), and a flake or
test-code bug routes to the **stabilize workflow** (below), never to per-case
fix dispatches.

### Two harness limits the gate lives inside (measured 2026-08-09/10)

They are host behaviour, not project behaviour, so they hold on every repo —
and between them they caused **3 of 7 wave gates to fail** in one campaign,
each time with the suite still running happily in the background.

1. **A foreground call is capped at 600s** (`timeout` defaults to 120s if you
   don't pass it). `gate-case.mjs --n 3` runs all three inside ONE process —
   12–19 minutes on a real UI batch — so a single call is guaranteed to be
   killed and auto-backgrounded. Both gates that passed cleanly ran **one run
   per call** (`--n 1`, `timeout: 600000`); every gate that failed used one long
   call. The dispatch now pins the one-run-per-call shape.
2. **A dispatched agent that ends its turn is finished, not waiting.** A
   controlled two-arm probe: a schema-bound subagent that ends its turn mid-job
   is forced to report **28 ms later**, and *both* the documented
   `run_in_background` completion notification and the Monitor tool lose that
   race. There is no waking — which also rules out polling a CI run across
   turns.

What *does* work, from the same probe: **blocking foreground `sleep`**. Three
45-second sleeps ran untouched. So a job longer than one call is launched
detached and waited out with `sleep 300; <check the file>` calls — one turn per
sleep, however long it is. That scales to any batch size: even an 87-minute
N=3 over 30 cases is ~18 tiny turns. The alternative is what wave-01 did —
busy-poll `kill -0` every 2 seconds, **27 poll turns and $1.29 (32% of that
agent) for no verdict**, because you pay a full resident context per turn.
Two `sleep 300` calls would have cost $0.10.

## The other shipped scripts

**Integrate** — [`../scripts/workflows/batch-integrate.workflow.mjs`](../scripts/workflows/batch-integrate.workflow.mjs).
A **repair tool, not a stage.** The batch workflow merges each unit into the
trunk as it is approved, so a normal run never needs this. Invoke it to
re-merge a unit that was PARKED on a semantic conflict once the collision is
resolved on its case branch, or to integrate a batch that was built without the
workflow —
`args: { slug, base, branch, cases: [{id, branch}, …] }` → `{integration_branch,
head_sha, merged, parked, notes}`. Its conflict rules are the merge-back rules
(playbook § Merge back and § Canonical dispatch templates → Merge-back — one
home): mechanical unions only, park anything semantic, never delete or
`--ours`/`--theirs` away a file. Field data (2026-07-21): conversational
integration fallout cost one lead session 63 merge-family commands, 90
conflict hits, and three git-surgery dispatches; merging per unit as the run
goes makes most of that impossible, and the integrator is the net, not the plan.

**Stabilize** — [`../scripts/workflows/batch-stabilize.workflow.mjs`](../scripts/workflows/batch-stabilize.workflow.mjs).
For a red gate you have already classified as a flake or test-code bug:
`args: { slug, base, branch, failures: [{spec, signature, case_ids?}, …] }`.
Diagnose ALL failures together (one agent, whole picture) → fix by **cause**,
sequentially, each adding the regression test that would have caught it →
re-gate. Bounded to 2 rounds, re-diagnosing between them, and it never decides
that a remaining red is acceptable.

Why the batch is the unit: the gate runs the specs together *precisely
because* that surfaces failures a per-case run never sees, so the failures it
uniquely finds are batch-level by construction. From one campaign's reds — an
unscoped global `console_errors` list leaking a step-1 404 into later unrelated
assertions; a fixture 500 firing before the test body ran; a test-data cleanup
race. Not one of those is a bug in "its" case, and three separate fix
dispatches would have seen three symptoms and never assembled the picture.

**Campaign conductor** — [`../scripts/workflows/batch-campaign.workflow.mjs`](../scripts/workflows/batch-campaign.workflow.mjs),
see § Campaigns below.

## What the build workflow returns

```
{ cases: [{id, outcome, coverage?, note, findings[], branch?, pr?, gate?}, …],
  totals: {delivered, blocked, …},
  gate: {verdict, runs, seconds, failures[]},
  integration_branch, quality_flags, quota_halted,
  report_written, report_path, extend_cases, next }
```

`cases` is the whole story: one row per input case, its outcome, its coverage
record (`{full, excluded[]}`), and any findings it produced. `next` is a
one-line instruction for you. Three fields are diagnostics worth reading
rather than skipping:

- **`quality_flags`** — batch-level quality signals (e.g. a high share of
  covered-elsewhere exclusions). These flag rather than halt: blind-audit a
  sample (a second reviewer re-walking one or two) before trusting the
  batch's coverage.
- **`quota_halted`** — the run stopped on an account ceiling with nothing to
  repair. Remaining cases are `not-started`.
- **`extend_cases`** — feeds your extend audit.

Then you merge the `delivered` cases, route the findings, and replan
everything else (playbook § The loop → Close).

## Division of labor

| Who | Does |
|---|---|
| You (lead), before | Intake: TMS sweep, dedup, clustering + screening verdicts, route policy read, **case snapshots to `.agents/automation/<slug>/cases/<ID>.md`** (fetch-once-to-disk — builder and reviewer read these instead of re-fetching) |
| Workflow | One unit at a time: earn the evidence if the route needs it (runner) → build on a branch cut from the trunk (spec + coverage declaration + surface cache) → static review → fix rounds until APPROVED, stopping only on `persists`/`external` (backstop 8) → merge back, tree returns to the trunk. Then one gate over the trunk, then the report |
| You (lead), after | Read the report. Merge + mirror the `delivered` (coverage note in the back-write); classify a red gate and route it; route the findings; `cleanup.mjs`; replan the remainder |

## Prompt determinism is the resume contract (2026-07-24 — the expensive one)

`resumeFromRunId` caches every `agent()` call keyed on the **exact (prompt,
opts) pair**. So any value interpolated into a prompt that depends on *run
timing* rather than on the args breaks the cache on every resume, and the agent
re-runs live — paying again for work that was already done and, for a runner,
re-driving a real browser session.

This is easy to introduce by accident and invisible until you measure it. An
earlier revision of the build script handed out browser lanes from a counting
semaphore (lane assigned by whoever finished first) and pasted the lane number
into the worker prompt. Lanes are gone with the concurrency that needed them,
but the lesson is the reason every prompt today interpolates only args and
worker results. Measured over one campaign, back when it happened:

| | |
|---|---|
| Analysed cases dispatched under ≥2 distinct lane numbers | **20 of 28** |
| Cases analysed more than once | **35 of 53** |
| Exploration dispatches for 53 cases | **106** |
| Build dispatches for the same 53 | **95** |
| Share of campaign spend that was replay + rework | **~60%** (~$890 of $1,489) |

Per-case economics for that campaign: **$41 actual vs ~$17 for a clean single
pass**. The fix was three lines — derive the lane from the unit's index instead
of the semaphore — and it is the single highest-leverage change in this
document.

**When you edit or fork a workflow script:** interpolate `args` and worker
*results* into prompts; never anything derived from who-finished-first — no
lane counters, no elapsed times, no queue positions, no "unit 3 of 7". If you
need a per-unit resource (a debug port, a lane, a directory), derive it from a
stable index. Serialising removed the last order-sensitive prompt this
pipeline had: every unit branches from the trunk, whose name comes from args,
so nothing interpolates "whatever finished last" any more.

Cheap check on any resumed run: if the transcript shows fresh live work for a
case whose branch and PR already exist, the cache missed — diff two dispatch
prompts for the same case before assuming the tool is at fault.

## Rules the script encodes (empirically validated 2026-07-20)

A live trial of this shape exposed exactly which disciplines must be code, not
prose. Keep these if you ever fork it:

1. **Route on failure.** A failed worker parks the case (`blocked` + the
   reason). The script never rolls a case forward past a failure — in the
   trial, rolling forward let a downstream step "repair" broken chains with
   false history notes.
2. **Never trust a self-report for a fact you can observe.** Worker
   "I updated the state" claims proved unreliable in the trial (one agent
   reported success while nothing landed). Anything that matters is read from
   git, from the gate's runs, or from the agent's own returned data — never
   from a claim about a side effect.
3. **Recover, never repair.** A step may confirm work that is already done and
   continue (idempotent resume), but never advances a case beyond what it was
   given, and never "fixes" a red result. A repair-happy step is defect
   masking with extra latency.
4. **Loops end on evidence, not on a counter.** The review/fix loop runs until
   the reviewer APPROVES, stopping when every surviving blocker is `persists`
   or `external` — anything still `unaddressed` earns another round, because
   *forgotten* and *impossible* demand opposite responses and look identical in
   a finding list. Stabilize is bounded at 2 rounds instead, and correctly so:
   its fixer must return `fixed` or `blocked` **per cause**, so "silently not
   done" is not representable there, and its arbiter is an objective gate
   rather than a reviewer's judgement. The R2 cap still binds builder
   *reruns* — a spec that will not go green against the same root cause twice
   is an objective wall. Round ceilings and the budget floor are backstops for
   a pathological pair, not the working control. At a real stop the case is
   returned `blocked` with the classification prompt — never walked on to the
   gate.
5. **Model resolution — the installed agent definition governs, on every
   path.** A dispatch that names an agent type and passes no model runs on
   the AGENT.md frontmatter `model:` — true for workflow `agent()` calls and
   for plain Agent-tool / Copilot dispatches alike, so the two paths cannot
   fork. Per-run args (`workerModel`, `reviewerModel`, …) and the Agent
   tool's `model` param are the overrides. Exactly two slots deliberately
   override frontmatter downward — merge-back and the report writer default
   to the cheap tier (mechanical work; the gate backstops) — and both take
   args (`mergeModel`, `reporterModel`) to undo it. The same frontmatter
   file also carries the worker's **MCP scope** (`mcpServers:`): direct
   dispatches and standalone runs pay every configured server's schemas
   per turn, while workflow-spawned workers' MCP access has flipped
   with host builds (present on 2.1.218, absent on 2.1.220) — scoping
   makes access explicit and deterministic on every path.
   Both workers ship an inline browser-server definition (subagent-scoped,
   one at a time under the serial pipeline); the per-project lists are seeded
   at Step 6.8 (`seeding-automation-project` → agent-tools-wiring § Claude Code).
6. **Routing is policy plus evidence, never improvisation.** The script reads
   `.agents/testing.md § Execution provider` and checks the evidence per unit
   (a cheap read-only triage dispatch — never the lead absorbing run
   reports): provider `self` → every unit `combined`; provider `manual-qa` →
   PASS run record + authored case file for every case in the unit →
   **`manual-qa-verified`** (the build derives from that evidence, no live
   re-run; run age does not matter; the run id becomes the execution
   provenance), anything less → **`needs-execution`** (a `test-runner`
   dispatch per case earns it: PASS → build, FAIL → `defect-found`,
   BLOCKED → `blocked`). A runner dispatch that fails because the agent type
   is unknown leaves the unit `needs-execution` in the report — the script
   NEVER falls back to self-execution against policy. The builder's own
   escape holds too: thin evidence → `needs-execution` return before any
   write. The gate proves the result N× green whichever route ran. Playbook
   § The loop, per unit carries the full rule.

7. **A stalled slot costs its unit, never the run** (field-measured
   2026-08-17, quota-throttled Bedrock). The harness stall-kills a subagent
   whose model stream stops making progress and retries it blind; when every
   attempt stalls, `agent()` THROWS (`agent stalled on all N attempts`)
   rather than returning null — and uncaught, that throw killed a whole run
   with its report unwritten while one slot burned 11 attempts. Every script
   now catches it: the unit is recorded **`infra-stalled`** (an ENVIRONMENT
   verdict — provider quota or stream stability, nothing about the case; see
   playbook § A dispatched slot that stalls), consecutive stalls feed the
   same breaker as agent-died, the batch continues, and the report always
   lands. The other half is the workers' CHECKPOINT DISCIPLINE: a retry
   inherits only what is committed, so build dispatches check
   for a killed attempt's branch first and commit per milestone — which is
   what makes the harness's blind retries incremental instead of 11×
   from-scratch.

## Hooks & memory (verified 2026-07-20)

`SubagentStart` hooks DO fire for workflow-spawned agents, and the payload
carries the agent type — so per-role memory/briefing injection works — **but
only for named dispatches**. An `agent()` call without `agentType:` arrives as
`workflow-subagent`: the hook fires and resolves no role. Hence: every worker
dispatch in the script names its agentType, and every worker prompt carries
the self-load fallback (memory skill + `.agents/*.md`) because this hook
behavior is version-observed, not documented contract.

**Anything that touches the repository must be a named agent of this factory.**
Not a style rule — a correctness one, and it fails silently. Measured on one
campaign: **1004 of 2123 units arrived as `workflow-subagent`**, i.e. with no
resolvable role and therefore no role memory and no project briefing. Those
particular ones were board clerks (since deleted) and it did not matter, but the
same silence would hide a real worker: nothing errors, the agent simply knows
nothing about the project it is editing. The shipped scripts name every dispatch
— runner, builder, reviewer, gate, **integrator, report writer** — and
`named-agents.test.mjs` fails the build if a new one forgets. Clerical dispatches
that touch nothing may be anonymous; anything that merges, edits or commits may
not.

The same data settles a question worth knowing: **workflow-spawned agents WITH
an `agentType` do resolve normally** — 380 of that campaign's workflow agents
came through under their named types. The generic name is
what an *omitted* `agentType` produces, never what the Workflow tool imposes.

Two more observed facts the script accounts for: `args` may arrive as a
JSON-encoded string (the script parses it), and workflow scripts have **no
filesystem access** and no `Date`/`Math.random`. The first is why the report is
written by an agent rather than by the script, and why the script carries no
timestamps at all — the report writer and git supply them.

## Tool capabilities worth knowing (the lead's option surface)

- **Branches, never worktrees — and what that replaces.** The pipeline uses no
  worktree at any stage (§ Who may run at once). The knobs that existed to make
  worktrees survivable are therefore gone too, and it is worth knowing what they
  were, because a fork that reintroduces a worktree inherits all of them:
  `.worktreeinclude` (Claude Code copies matching *gitignored* files into a
  worktree it creates — but copying a FILE is not the same as making a PATH
  resolve: a relative env symlink still points outside and resolves nowhere,
  which one campaign hit **10 times directly and 413 times as the misleading
  `Invalid URL ''` symptom**); the fact that a worktree sees **committed files
  only** (which stranded **47 uncommitted analysis files** in the same
  campaign); and `worktree.baseRef`, which silently branches from the repo's
  default branch rather than your automation base unless set to `"head"`. In
  this checkout none of that applies: the env file and the dependencies are
  simply there. One rule from that era still stands on its own merits, because
  it serves the reviewer rather than any worktree: reviewers read diffs by ref
  (`git diff base...branch`) and never check anything out. (The commit rule
  survives as the builder's: spec and surface cache are committed by exact
  path the moment they exist, because nothing else is in the tree while it
  runs. Nothing sweeps orphans, because there are none.)
- **`cleanup.mjs` still removes worktrees.** Not because the pipeline makes
  them, but because a project may still carry some from the earlier model or
  from hand-run work — and the periodic sweep would otherwise skip them forever
  (unpushed commits). Run it after the mirror sweep:
  `cleanup.mjs --report .agents/automation/<slug>/report.json` (dry-run), then
  `--apply`. **A branch goes only when a merged PR names it** — the report
  contributes the names, the PR state is the authority, and "cannot tell"
  (no `gh`) authorizes nothing.
- **`reviewPanel: true`** — turns the static review into the tool's
  perspective-diverse verify pattern: three reviewers with distinct lenses
  (correctness / honesty-of-coverage / maintainability), unanimous APPROVED to
  pass. ~2 extra reviewer dispatches per case; use for large or high-stakes
  batches or a new builder configuration.
- **`budget`** — if the operator sets a token target ("+500k"), the script
  hard-stops admitting new cases when `budget.remaining()` falls below
  `budgetReserve` and leaves the rest `not-started`. No target → no limit.
- **Account ceilings are invisible to `budget`** — and they are the limit you
  actually hit on a long campaign. A rolling usage window is a *clock*, not a
  batch defect: the script treats a quota-shaped failure as a clean halt
  (`quota_halted: true`, remaining units `not-started`), never as a
  circuit-breaker cause. That distinction was learned the hard way — three
  consecutive limit hits inside a 109-case dispatch tripped the breaker and
  cascaded **~100 healthy cases into parks** that all had to be walked back by
  hand. When it happens: don't retry immediately (check the stated reset time
  against local time first), then resume with the same args plus
  `resumeFromRunId`.
- **Operating envelope for a multi-hour campaign.** Derived live under a real
  ceiling and worth starting from rather than rediscovering: **max 2 concurrent
  `Workflow` calls** and **≤20–25 cases per dispatch**. Within a batch nothing
  is concurrent any more, so burn rate is set by how many workflows you have in
  flight, while **case-count-per-dispatch bounds the blast radius** if something trips
  mid-run. Resending the full `cases` array on a resume costs nothing: the
  cache absorbs completed units. And hitting a ceiling is not a crisis if the
  resume story holds — it was proven clean twice in one session.
- **Resume, two ways.** On a crash, kill, or operator pause (unpausing ENDS
  the run and the harness appends the exact resume call — invoke it as given,
  in the same session), re-invoke with the SAME scriptPath/args plus
  `resumeFromRunId`: completed agents (including live runner sessions) replay
  from cache; only the failed call onward re-runs. Same scriptPath means same
  script BYTES — don't update the installed factory between a pause/crash and
  its resume, or every unit from the first changed prompt re-runs live.
  **The runId is context-fragile:** write it to disk the moment the Workflow
  call returns it (the campaign card, or the batch's dir) so a crash OR a
  context compaction can't orphan the run. If resume isn't possible at all,
  rebuild the report by reading what is already on disk — the hook's receipts,
  then `journal.jsonl`, then git — per playbook § Interruption and resumption,
  and the **remainder** is the next batch. Verified against a real interrupted
  campaign that reconstruction was *more* accurate than the board it replaced,
  which had two merged cases still sitting at `approved-static`.
- **Named workflow** — copy the script to `.claude/workflows/` in the consumer
  project to invoke it as `Workflow({name: "ta-batch-build", args})` instead
  of by path.
- **Observability** — the operator watches live progress with `/workflows`;
  per-agent ground truth is `journal.jsonl` in the run's transcript dir, which
  records every agent's actual return value. Read it before diagnosing an odd
  result — and note that it is also what makes intermediate status writes
  unnecessary.
- **Caps** — ~10–16 concurrent agents per workflow (excess queue), 1000
  agents per run; scripts have no filesystem access and no
  `Date.now`/`Math.random`.
- **Cache invariant** — same-type workers share a cached prompt prefix
  (agent definition, preloaded skills, the byte-stable PREAMBLE), and running
  units back to back keeps dispatches inside the cache window. Keep it that way when
  editing the script: stable text first, case-variable text last, and don't
  vary agentTypes gratuitously.
- **Measure before tuning further** — after the first real batch, run the
  factory's `efficiency-audit` skill (`usage-rollup.mjs`) over the session to
  rank actual per-stage costs; let that data pick the next optimization, not
  intuition.

## Campaigns — batches composed for scale

For backlogs ≳ 2× the batch size, don't run flat batches — run a **campaign**
per [`campaign-planning.md`](campaign-planning.md): a dispatched planner
proposes waves/clusters/foundation from the intake snapshots (the lead
reviews the plan, never the case bodies), then
[`../scripts/workflows/batch-campaign.workflow.mjs`](../scripts/workflows/batch-campaign.workflow.mjs)
conducts the heads pass → foundation (early-return for your mini-gate) →
waves, each wave a build child that integrates and gates itself and hands you
one report. **`clusters` is not conductor-only** — every batch should carry it
(campaign-planning.md § Clustering): with builds sequenced, units are the wall
clock, so grouping similar cases is the main lever a flat batch has.

## Extending the canonical workflows

The shipped scripts are **defaults, not a cage** — but changes have a
gradient, and each step up needs more care:

1. **Args first.** Model/effort tiers, review panel, breaker, clusters, gate N,
   fix rounds, even `agentTypes` substitution — if the need fits an existing
   knob, turn the knob.
2. **Plan next.** New stages usually aren't new code: a compliance sign-off,
   an extra checkpoint, a different wave shape are plan compositions — the
   conductor already returns to the lead at every seam, so a process-mandated
   human moment slots between waves without touching a script.
3. **Fork or author when the shape is genuinely new.** Allowed — with four
   rules:
   - **Fork to a durable home:** copy into the project's own space (e.g.
     `.claude/workflows/<name>.mjs`, invoked by name) — NEVER edit the
     installed skill copy, `--update` clobbers it. A variant that proves out
     belongs upstream in the factory; say so in your status report.
   - **The invariants ride along, uncut.** These are not style preferences —
     each one is a failure this pipeline has already paid for:
     - **ONE TREE, ONE MASTER.** Nothing that writes runs concurrently with
       anything else. Always return the tree to a known state, and always
       branch from it. The single sanctioned fan-out is **read-only** — several
       reviewers on a *finished* diff, writing nothing. `parallel()` /
       `pipeline()` over anything that touches the repository is the specific
       trap: it puts two `git checkout` in one tree.
     - **Execution evidence per case** — manual-qa's record, a runner PASS, or
       the automated test's own first green run — never invented, and never
       silently self-executed when policy says manual-qa.
     - **Route-on-failure, never roll forward**, and **recover-never-repair**:
       no deleting files to unblock, no "fixing" a red result.
     - **Named `agentTypes`** on every dispatch — an anonymous one reaches the
       hook as `workflow-subagent`, resolves to no role, and gets no memory.
     - **A bounded loop and a stop on red** — rounds continue while a blocker
       is `unaddressed` and stop when what remains is `persists`/`external`,
       with a runaway ceiling; `return { blocked: … }` rather than walking a red
       case onward.
     - **Whoever proves the work is not whoever wrote it**, and it returns
       EVIDENCE (timings, shas, read-back diffs) rather than a claim.
     - **One writer for any artifact**, at a checkpoint.

     Dropping any of these is not a fork — it's a design change only the
     operator can authorize (Critical rule: scope is set by the user).
   - **Contracts stay compatible:** keep the return shape (`cases[]` with
     outcomes and findings, `gate`, `integration_branch`) so the conductor,
     `cleanup.mjs`, and the lead's doctrine keep working around your variant.
   - **Tell the operator once, in the plan or the status report** — a changed
     way-of-work is a scope statement, not an implementation detail.

   **Cases are not the only shape.** Atomic fixes, batched fixes, framework
   improvements, a suite-health sweep, a tech-debt batch all fit the same
   skeleton — only the investigation step differs (reproduce a failure or
   read the code rather than execute a case); build → review → integrate →
   gate is unchanged, and the outcome vocabulary already covers it. Each
   non-case unit carries a [tech-task brief](tech-task-brief.md) where the
   case would be — the reviewer's walk artifact and the gate's run
   set. `batch-stabilize` is the shipped instance of that variation; copy
   its shape rather than inventing a new one.

   Two authoring mistakes are common enough to name, because neither fails
   loudly:

   - **Resolve the agents against what is installed — never invent one.**
     `ls .claude/agents` first. A step naming an agent this project does not
     have produces a script that dies at run time, and nothing upstream
     objects: the shape is valid, only the name is fiction. If no suitable
     agent exists, say so and let the operator choose — install one, name an
     existing one, or drop the step. `implementer` / `tester` / `reviewer` are
     words in documentation, not agents.
   - **Design the not-green path, or you have written a wish.** A script that
     draws build → review → verify and stops has quietly assumed each passes
     first time. A real run returns findings. Put the remediation in the
     BODY — a static graph cannot draw a loop: after blocking review findings,
     loop *fix + add the regression test → re-review*, bounded; after a failed
     verification, loop *fix → re-verify*, bounded; and when it is still red at
     the bound, **stop and return `{ blocked: … }`**. Walking a red case
     forward is how a run reads as done when it isn't.

   Everything else about authoring a workflow script — adversarial
   verification, budget scaling, and the runtime constraints (`Date.now()`
   throws, prompts must stay deterministic for resume, a dead `agent()`
   resolves to `null`, nesting is ONE level) — is in the `Workflow` tool's own
   description, which you already have. Don't restate it here; read it there.
   One correction to its general advice, for this domain: it recommends
   `pipeline()` as the default shape. That is right for read-only fan-out and
   **wrong for anything touching this repository** — see the first invariant.

### Other kinds of test-automation work

The same shape generalises, and a lead facing a job the shipped scripts do not
cover should compose one rather than hand-run it. `batch-stabilize` is already
an instance: its investigation step differs (reproduce a failure rather than
execute a case) while build / review / gate are the identical skeleton.

Framework work fits it too — a framework refactor is `diagnose the current
shape → change it on a branch → review → prove the existing suite still
passes`, which is the same graph with a different first step and the whole
suite as its gate. So does a migration, a flake sweep, or a dependency bump.

Whatever the job: **investigate → change → review → prove → report, one writer
at a time, evidence not claims.** If your draft has two steps writing at once,
it is not a new shape — it is the old bug.

## When NOT to use it — and what carries the state then

- **An operator who wants to supervise step by step.** This is the real
  exception, and it is about visibility, not size: someone watching each slot's
  return before the next dispatch cannot do that through a workflow.
  (**A batch of ONE is not an exception** — run it through the workflow like any
  other. Size was conflated with supervision here for a while, and it was wrong:
  conversationally a single case costs ~8–10 orchestrator turns — dispatch and
  read a return per slot, plus the gate mechanics — each re-processing the whole
  context, against **2** for a workflow call and its report. Proportionally the
  saving is larger on one case than on five. The script degenerates cleanly:
  one unit, one build, an integration branch holding one case, one gate
  run, one report.)
- Unseeded project — self-orient first; the workflow assumes a seeded project,
  TMS adapter, and `.agents/testing.md` config.
- Any host without the Workflow tool — sequential dispatches, same contracts.
  Nothing forks here: this pipeline already assumes ONE working tree with its
  writers sequenced, which is exactly what every other runner (Copilot, Cursor,
  Codex, …) gives you anyway. The rules that keep it safe — what may run in
  parallel, scoped staging, one writer at a time — are host-independent.

On that path **you** are the orchestration: you dispatch each slot, you run
the gate (mechanics still via `gate-case.mjs`), and you write the report at
close instead of a report agent. Two differences are worth stating plainly,
because neither weakens the model:

- **No journal.** `journal.jsonl` is a Workflow-runtime artifact; sequential
  dispatches produce none. It does not matter, because the durable evidence
  was never the journal: a branch means the case was built, a merged PR means
  it landed, the coverage declaration says what it covers. Recovery prefers exactly that evidence
  anyway — git wins over any journal or receipt wherever both can answer, since
  a merged PR is a fact and an agent's return is a claim. On a real interrupted
  campaign, git-only reconstruction produced the identical remainder. (Take care
  not to read a journal from an EARLIER run or another project: short case ids
  collide, and foreign facts slot in silently.)
- **No resume cache.** `resumeFromRunId` has nothing to replay, so recovery is
  read the evidence → remainder → dispatch the remainder. Same move as a
  workflow that can't resume, and the same reason it works: the remainder is
  the plan, not a state to repair.

What does NOT change: the outcome vocabulary, the findings channel, one
writer per artifact, the gate never certifying its own author's work, and the
bounded fix rounds. Those are contracts, not workflow features — and it is
precisely because they hold on both paths that there is nothing to fork.
