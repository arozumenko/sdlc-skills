# Test Automation — Orchestration Playbook

The full orchestration playbook for the test-automation pipeline. Whoever fills the **orchestrator slot** (default: `test-automation-lead`; any agent loading `test-automation-workflow` skill can fill the role) runs by these rules.

## Contents

- [The loop: plan → run → close](#the-loop-plan--run--close)
- [Outcomes — what a run says about a case](#outcomes--what-a-run-says-about-a-case)
- [Where state lives](#where-state-lives)
- [Interruption and resumption](#interruption-and-resumption)
- [Critical orchestrator rules](#critical-orchestrator-rules)
- [Failure recovery & git hygiene](#failure-recovery--git-hygiene)
- [How to dispatch a subagent (host preflight)](#how-to-dispatch-a-subagent-host-preflight)
- [Slot defaults](#slot-defaults)
- [Self-orientation (fast onboard when unseeded)](#self-orientation-fast-onboard-when-unseeded)
- [Pre-flight checklist (per dispatch)](#pre-flight-checklist-per-dispatch)
- [Canonical dispatch templates](#canonical-dispatch-templates) — analyst · implementer · reviewer · integrator · gate
- [AFS quality gate](#afs-quality-gate)
- [Status discipline (TaskCreate / TaskUpdate)](#status-discipline-taskcreate--taskupdate)
- [Status reporting — milestones](#status-reporting--milestones)
- [Handling blockers — classify and route](#handling-blockers--classify-and-route)
- [R2 cap rule](#r2-cap-rule--never-dispatch-r3-on-the-same-root-cause)
- [Rule of thumb — no parallel automation per implementer](#rule-of-thumb--no-parallel-automation-per-implementer)
- [Framework architecture](#framework-architecture)
- [Orchestrator anti-patterns](#orchestrator-anti-patterns)

## The loop: plan → run → close

Work arrives as a set — TMS cases, a red suite, a framework improvement — and leaves as **one report**. Your loop has three moves, and only the first and last are yours:

**Plan it, run it, close it. If some of it didn't land, replan the remainder and run again.**

There is no mid-run bookkeeping to keep, because nothing reads it: the run reports once, at the end, and everything needed to recover an interrupted run is already on disk (§ Where state lives). A batch of one degenerates to the old per-case flow minus the ceremony. For backlogs ≳ 2× the batch size — or a new coverage area — compose batches as a **campaign** (waves + a foundation pass + clusters of similar cases) per [`campaign-planning.md`](campaign-planning.md).

### 1. Intake — resolve the work set (yours)

Resolve the cases: operator IDs, or the selector in `.agents/profile.md` § Task source (TMS folder/suite, board query, issue label) — don't idle for pasted IDs on a project whose seed names a queue.

Then **ONE** TMS sweep: fetch every case and probe each author's metadata directly — status (skip author-not-actionable: "Out of Scope" / "Untested" / "Draft"), folder-membership (catch raw-key iteration drift), version. Probing the single-case status field directly is authoritative; JQL-style `status in (...)` queries on TMS custom fields are unreliable across adapters — verify the field directly, never query-set. Apply `.agents/testing.md` § TMS case-gate's exclusion list (absent → fetch all, flag the gap), and dedup survivors against existing AFS files and the tracker (Critical rule 5).

**Fetch once, to disk:** write each surviving case's full body to `.agents/automation/<slug>/cases/<ID>.md` — the batch-scoped snapshot the analyst and reviewer read (they re-fetch only if it's missing); keep only id + title + status in your own context. One TMS fetch per case per batch, and both slots triangulate against the identical snapshot — a mid-batch author edit can't silently skew the review.

If `.agents/testing.md` names a known blocking modal (session-expired, forced-password-change, MFA, cookie banner), inject its dismissal snippet into *every* dispatch this batch — not after the first hang. Chunk to batch size **M** (§ Batch pipeline, default 5). If the seeded tracker policy requires visible WIP, create all sub-tasks in one batched write; else the tracker waits for the close sweep.

**Cut and push the batch trunk.** `git checkout -B tests/batch-<slug> <base> && git push -u origin tests/batch-<slug>`. Case branches live under it and their PRs target it; the gate proves it; one PR takes it to base. Push it now, not later: the gate checks out `origin/tests/batch-<slug>`, and a trunk that only exists locally fails the gate for an infrastructure reason that reads as a red case. (On Claude Code the shipped workflow's first build does this for you.) **A batch of one skips the trunk** — the case branch targets base directly.

**Cluster the batch — by DISPATCHING one pass, never by reading the cases yourself.** Grouping similar cases needs their bodies, and your context is the batch's scarcest resource (Critical rule 7), so this is the one Intake step you delegate: dispatch a single agent over the snapshots you just wrote, and take back only the grouping.

```
Clustering pass — read the case snapshots at .agents/automation/{SLUG}/cases/*.md
and group the ones a single analyst could explore in ONE live session: same
surface, same flow family (field-validation variants, CRUD permutations on one
entity). Every case's own steps still get executed individually inside that
session, so group only what shares a setup path — when in doubt, leave it solo.
Return clusters: [[id, …], …] plus one line of rationale per cluster. Nothing else.
```

Pass the result as `args.clusters`. **Do not `cat` the case files.** Field-measured on a live lead session: clustering by hand pulled **14 case bodies — 40,865 bytes, ~10K tokens — into the orchestrator's context**, more than its entire startup injection, before a single case was dispatched. The rule was written down, but in [`campaign-planning.md`](campaign-planning.md) § Clustering, which a flat batch never opens; that is why it is restated here, where Intake actually happens.

### 2. Run — one workflow, one unit at a time (not yours)

On Claude Code a batch runs through the canonical shipped script **by default** — a batch of one included; size is not the exception, wanting to supervise each step is — `scripts/workflows/batch-build.workflow.mjs`; see [`workflow-accelerant.md`](workflow-accelerant.md) (invoke it, don't re-author it). **This instruction is the standing explicit opt-in the Workflow tool's multi-agent gate requires** (a skill instructing the call is a sanctioned opt-in path; the operator opted in by installing the bundle and handing you the batch) — do not re-litigate the gate per batch or ask the operator again. Fall back to sequential dispatches only for its § When NOT to use it (unseeded project, tool unavailable, or the operator asks to supervise step-by-step).

**The workflow and the hand-run loop are the SAME algorithm**, not two designs sharing a name. The script executes it deterministically; you execute it by dispatching. That is only true because nothing here runs concurrently — see below.

#### ONE TREE, ONE MASTER

> **Always return the tree to a known state, and always branch from it.**

Everything in this section rests on that one line. A single working tree has **one state at a time**, but slots need different ones — an analyst wants the trunk, a reviewer wants the branch it is judging, an implementer wants its own. No rule reconciles that; only ordering does.

So: **units run strictly one at a time, and nothing overlaps.** The trunk `tests/batch-<slug>` is the known state. Each unit branches from it, does its whole life on that branch, merges back, and leaves the tree sitting on the trunk for the next one.

An earlier revision ran analysts in parallel with builds and paid for it in the field: **eight `local changes would be overwritten by checkout` aborts** (an analyst's `_surface.md` against a build's branch switch), merge conflicts concentrated in shared page objects, **90 conflict hits and three git-surgery rescues** in one session. Serialising deletes that entire class rather than guarding it.

**What serialising buys back is agent freedom.** Every prohibition the pipeline used to carry — analysts run no git, write but never commit, never `git add -A`, the digest is read-only — existed only because a *second* agent might be in the tree. Alone, an analyst commits and pushes its own work like anyone else.

**Throughput comes from clustering, not concurrency.** Units are the wall clock, so a cluster of 5 is one unit rather than five — a 4× reduction, against the 2× that analyst concurrency bought and every hazard above. **Cluster similar cases at Intake** and pass them as `args.clusters`, on flat batches too.

The one sanctioned fan-out is **read-only**: several reviewers on one *finished* diff (the opt-in `reviewPanel`), writing nothing, while no writer runs.

#### The loop, per unit

**Analyse** — on the trunk. Live exploration to the AFS quality gate (§ below); a miss goes back to analyst. A plan-declared **cluster** ([`campaign-planning.md`](campaign-planning.md) § Clustering) is one analyst dispatch: one live session over ≤ ~5 same-surface variants — shared login/discovery, but **every case's steps executed and observed individually** (per-case evidence mandatory; a diverging case is ejected to solo); **true flow-variants** get one family AFS with a parameter table and one parameterized spec; cases that merely share a surface get **one AFS and one spec each**.

The analyst **owns the tree and commits its own work**: AFS and `_surface.md` staged by exact path, committed to the trunk, pushed — then it leaves the tree on the trunk. It never switches branches. Committing immediately is the point: the analysis lands the moment it exists, so a case that turns out `already-covered` or `blocked` still has its AFS on the trunk, and an interrupted run loses nothing. (This is why there is no orphan-AFS sweep any more — an earlier revision left **47 AFS files stranded uncommitted**.)

**Tiering — the standalone analyst is for novel ground.** The workflow triages units (accelerant § Rules the script encodes → 6): a unit whose every surface has a `_surface.md` digest and whose steps read routine against it goes to a **combined** analyse+build dispatch — one engineer doing both halves, still executing the case live and still committing the AFS on the trunk before cutting its branch. Running by hand, apply the same judgement yourself; on any doubt — digest missing, novel screen, ambiguous step — the standalone analyst. The cost asymmetry decides doubt: a wasted analyst dispatch costs one dispatch, a combined slot on novel ground costs a bad AFS.

**Implement** — cut the feature branch **from the trunk** (`.agents/workflow.md` convention, typically `tests/<TMS-ID>-<slug>`). The trunk already carries every unit that finished before this one, so page-object and fixture work accumulates by *merge* rather than by branch lineage. Implement, green ONCE locally, ≤ 2 reruns — determinism is the gate's job, not repeated local runs. The AFS is already committed; amend it on this branch if exploration shows it has drifted, so the change is reviewed with the code that motivated it. Open the PR against the **trunk**, never against base.

**Review** — static, on that branch's diff. Then bounded fix rounds.

**The fix loop runs until the reviewer APPROVES.** It is not a budget for how much quality a unit is allowed. Dispatch a fix round with the blocking findings, then a FRESH review, and repeat. What ends it is the reviewer telling you another round cannot help — never a round count, and never your patience.

On each re-review, the reviewer classifies **every surviving blocker** ([`reviewer-contract.md`](reviewer-contract.md) § On a RE-REVIEW):

- **Any blocker still `unaddressed`** — nobody acted on it; the diff does not touch the code it names, or the change was cosmetic → **go round again**, and name the skipped items explicitly in the fix dispatch. A fixer handed a bare re-list reads it as new work and skips the same item twice.
- **Every blocker `persists`** (real attempt against the right code, still failing) **or `external`** (not resolvable on this branch) → **stop.** The obstacle is not effort. Record `blocked` and classify per § R2 cap rule.
- **…unless every surviving blocker is scoped (`case_ids`) to a proper subset of the unit's cases → split the unit instead** (once per unit). A grouped unit amortizes dispatch cost, and the price was fate-coupling: one policy-stuck case once stranded four merged-ready cases. The carve is one implementer dispatch, and it **keeps sound work deliverable — quarantine, don't delete**. An almost-ready test whose *case* is stuck is a status problem, not a code problem: mark it skipped per project convention with a declared reason quoting the blocker and naming the unit/AFS (family specs: mark just their rows), so the finished code **ships inert on the trunk and re-arms by removing the marker** when the blocker clears. This is the sanctioned exception to the masking hunt — the hunt targets silent skips beneath cases claiming `automated`; a declared quarantine on a case recorded `blocked` claims nothing (same "declared, not discovered" principle as red-by-design). **Removal is the fallback** for code the blocker itself condemns (masking, unsound): then the carve first records the branch head — `preserved@<sha>` leads the blocked note and is written into the AFS with the removed paths — because once the unit merges that commit is in trunk history permanently, and re-entry **restores** (`git checkout <sha> -- <paths>`) instead of rebuilding. Either way the AFS stays on the branch marked blocked with the mode, shared symbols are removed only after a `git grep` proves nothing remaining uses them, and the shrunken unit goes back through review and merges as usual. Running by hand, the same moves apply.

The distinction is the whole point: *forgotten* and *impossible* look identical in a finding list and are opposites in what they demand. Stopping on "forgotten" ships a nearly-finished unit as `blocked` — neither delivered nor honestly stuck, and nobody goes back to it. Ask the reviewer directly; it is the only party that saw both rounds and the diff between them, and judging by the *wording* of findings just measures phrasing.

Two guards, and both are backstops rather than controls: a **round ceiling** (`fixRounds`, default 8) for a review/fix pair that has gone pathological — reaching it is a defect worth reporting, not a normal ending — and a **budget floor**, so one stuck unit cannot strand the batch. The shipped workflow encodes all of this; **running by hand, you are the loop, and the contract is identical** — same classification, same stop conditions, same ceiling.

**Merge back** — the approved unit merges into the trunk immediately (`git merge --no-ff`), pushes, and **the tree returns to the trunk**. A conflict is resolved only when it is a **mechanical union** (both-added imports, additive page-object members, independent files); anything semantic **parks the unit** — reviewed but not merged, `blocked`, its branch kept for re-entry. One hard rule, hand-run or scripted: **never delete, `rm`, or `--ours`/`--theirs` away a content file to make a merge pass**; destructive unblocking is how AFS files get lost.

Merging per unit rather than integrating at the end is deliberate. It keeps the trunk a known state for the next unit, surfaces conflicts small and while their author is still live, and means an interrupted run leaves the trunk carrying exactly the units that finished — which is what makes recovery a `git log` instead of archaeology. `batch-integrate.workflow.mjs` remains as a **repair tool** for re-merging a parked unit, not as a stage.

**Memory is committed like everything else — commit what you produce, where you stand.** Every slot writes durable learnings to `.agents/memory/<role>/` and commits them **by exact path on the branch it is on**: the analyst with its AFS on the trunk, the implementer and reviewer with their work on the case branch, the merge carrying it all to the trunk. When a unit **parks** on a semantic conflict, the merge agent lands its memory anyway (`git checkout <branch> -- .agents/memory/`, commit, push) — the code may not land, but what we learned always does. The lead's close sweep is pure curation: dedupe, promote to `MEMORY.md`, compact — editing committed files, never capturing loose ones.

*Why this rule replaced its predecessor.* The old rule — "role memory never rides a case branch; workers report via `findings[]` and the lead records at close" — existed because field measurement (cov60) found **26 of 32 merge conflicts** were add/add collisions in `MEMORY.md`/`daily/*.md`, from **parallel** case branches cut off one base each creating the same file. Serialization removed the cause: unit N+1's branch is cut *after* unit N merged, so it inherits N's memory and appends — a modify, never an add/add. The old rule's residue was worse than nothing: workers (whose preloaded memory skill says "write what you learn") wrote anyway, the entries sat **untracked for the whole campaign**, and one wholesale stash (field incident 2026-08-03) swept six of them mid-wave while every later agent ran without them. One scoping rule survives from that era: mechanical self-check greps run against the project's code root (e.g. `-- automation/`), never the whole tree, so memory prose can't pollute a diff scan.

**Red by design is declared, not discovered.** A ticketed product defect is asserted softly with a `// Known defect: <TICKET>` comment (Critical rule 2) — the test fails loudly and keeps failing until the product ships. That is the correct signal and it must not be weakened. But it also means the gate can never be green, and a gate that can never be green **blocks every healthy case beside it**: measured on one batch, a single ticketed defect held four other cases red. So the implementer *declares* such tests; the gate runs them and reports them but excludes them from the N-green count; and the case is reported **`blocked` on its ticket, never `automated`**. When one of those tests comes back GREEN, that is news: the product shipped, the ticket can close, and the case re-enters the next batch.

#### Gate — the merge signal

Once every unit has had its turn, the trunk carries the batch. Gate it, and gate it **twice over, with two different counts**:

- **The batch's new/changed specs, N× consecutive GREEN** (§ Merge gate, default 3), each a clean process against the live env. New code is unproven, so repetition is what catches a flake. Within each run, use the framework's own parallel workers where the env allows — that is a *stronger* gate, not a shortcut, since it surfaces parallel-interaction flakes a per-case run never sees.
- **The specs this batch could have BROKEN, once.** Already-proven code needs one run to reveal a regression, not N. Scope by **what changed, not what was touched**: read the batch's non-spec diff (page objects, fixtures, helpers, config) hunk by hunk, however this project diffs — git, the PR view, or on a VCS-less project the change list in the briefs. A purely **additive** hunk — a new method, handle or constant that nothing existing calls — has no blast radius: new code cannot break a spec that never calls it. A hunk that **modifies or deletes** existing behavior names an impacted *symbol* (diff hunk headers show the enclosing function); the impacted specs are the ones that *reach* that symbol — search by symbol name, one hop through shared helpers — never "every spec importing the file". Measured live on an 11-case batch: import-level selection swept 57 tests where the truly impacted set was a handful, and the gate agent stalled on the runtime. Import shuffles and formatting are no-ops. Run the set once, selected by node-id/spec. All-additive → no blast radius; say so. A modified symbol in a base class or fixture everything reaches makes the big set *real* — report its size and estimated runtime and hand the lead the run-vs-sample decision instead of silently burning an hour.

The gate is a **separate agent inside the run** — not the implementer (who would be certifying their own work) and not you. That placement is deliberate and was measured: a hand-run gate drained 12 cases while the pipeline delivered 36, at 3h50m and 114 shell calls for 8 merges. Its mechanics are scripted (`scripts/gate/gate-case.mjs` — fetch, checkout, merge base, run N× with timings, verdict); three rules it encodes each cost real time when left to memory:

- **Merge the base FIRST, then gate.** On a busy campaign the base moves under every merge, so a run against a branch that lacks base proves nothing about what will land — gate runs had to be discarded and redone for exactly this.
- **Gate in this checkout, on a branch — no worktree.** The real tree already has the env file and installed dependencies a worktree would lack. The tree must be **clean**, or checking a branch out eats work in progress; `gate-case.mjs` refuses a dirty tree for that reason. Leave the tree on the trunk when done.
- **The gate does not merge, classify, or fix.** A red ends the attempt and goes into the report. Classifying it is yours (§ 3).
- **One run per call — never all N in one process.** `gate-case.mjs --n 1`, foreground, `timeout: 600000`, repeated N times with the consecutive-green count kept by the agent. `--n <N>` runs them back-to-back inside a single call, and a foreground call cannot exceed 600s: on a real UI batch N=3 is 12–19 minutes, so the call is killed and the agent is stranded holding a suite that is still running. Measured across seven waves: both gates that passed cleanly ran one run per call; all three that failed used one long call. If even a single run doesn't fit, launch it detached and wait with blocking `sleep 300` polls (§ Never idle on a background job).

**A gate cut off mid-flight is `incomplete`, not `not-run`.** They read the same in a report and mean opposite things: `not-run` is "nothing was attempted", `incomplete` is "runs are banked and here is where to resume". Both leave their units `merged-ungated` — unproven, never `blocked` — but only `incomplete` tells the next reader whether one run remains or all N. Whichever it is, when you then run the gate yourself and it goes green, **write that verdict back into the report** (§ 3 Close → Write the verdict back): the recovery isn't finished until the receipt matches it.

**Report** — one write, at the end: `.agents/automation/<slug>/report.json` and `report.md`. One row per input case with its outcome, note and findings, plus the gate verdict and anything parked. This is the only disk write the run makes.

### 3. Close — read the report, act on it (yours)

Read the report, not the transcript. Then:

**Merge ONE PR: the batch trunk into base.** Two branch levels, and the second is the one that lands. Case branches live under `tests/batch-<slug>` and their PRs target it; the trunk is what the gate proved, so the trunk is what merges. Read `.agents/profile.md` § Automation PR policy first — base branch; merge policy `auto-merge` / `human-approved` / `manual`; strategy `squash` / `rebase` / `merge` (absent → default `auto-merge` + `squash` + the default branch, flag the gap). Confirm the PR is `OPEN`, checks green, base matches, and every case PR under it is merged or closed; under `human-approved` merge only on the human signal, under `manual` skip and post a summary.

Why one and not N: gating the trunk and then merging case PRs individually **proves one object and ships another** — the gate ran the batch's specs together, against one base, in one tree; N separate merges reassemble that from parts nobody proved in combination. It also means an interrupted close cannot leave base half-landed. A batch of ONE degenerates: no trunk, the case branch targets base directly, one PR either way.

**Route the findings.** They are orthogonal to the outcome — a case can be `automated` and still have produced a `defect`. Nothing about the outcome cancels a finding, and a finding never downgrades a green case (§ Outcomes).

**Handle a red gate.** Classify it — product defect / flake or test-code bug / architectural — then route per § Handling blockers. For a flake or test-code bug the answer is the **stabilize workflow**, not per-case fix dispatches: `scripts/workflows/batch-stabilize.workflow.mjs` diagnoses ALL the failures together before fixing anything, because the gate runs the specs together precisely to surface failures a single-spec run cannot produce — so its unique failures are batch-level by construction. Three separate fix dispatches see three symptoms and never assemble the picture.

**Write the verdict back — before the closure comment, not "later".** Any gate that runs *outside* the workflow's own report write — a re-run after `merged-ungated`, a stabilize round's re-gate, a gate you re-scoped and ran yourself — updates `.agents/automation/<slug>/report.json` **the moment it has a verdict**:

1. `gate.verdict`, `gate.runs`, `gate.seconds` — what actually ran.
2. Each affected case's outcome: `merged-ungated` → **`automated`** on green, or **`merged-sanctioned-red`** where the red was pre-declared against a ticketed defect. The workflow could not know either — it had already written the file and gone.
3. Only then the closure record / tracker comment. A closure comment claiming green over a report saying `not-run` is the exact state that keeps happening.

The report is the machine-readable receipt every audit, `--resolved-from`, and the next batch's plan divides by. **This is the single most-repeated miss in the pipeline, and prose has already failed to fix it twice.** Measured on an 11-case batch: a lead-run gate went 3/3 green and merged 11 cases while the report still said `not-run` / `merged-ungated` — zero delivered in the next rollup, 11 proven specs recorded as unproven. Measured again three days later, *with this paragraph already installed*: it recurred three more times in one campaign, and **38 of 69 delivered cases (55%)** were misrecorded or had no receipt at all. So treat it as a hard step with a verification, exactly like the close sweep's read-back: after writing, re-read the file and confirm the totals match what you merged. Recovering the gate without correcting the receipt is half the recovery — and the half nobody can see.

**Then ONE close sweep:** back-write the TMS execution and transition the tracker for every merged and parked case (while there, compare each case's live TMS body against its intake snapshot — an author edit mid-batch is a drift flag for the next batch, not a silent skew you absorbed), then **ONE** read-back — this batch mutation across >1 tracker item must be followed by an explicit read-back: re-fetch every affected item, diff against the expected-state map you wrote *before* the mutation, report mismatches. Only then claim "complete" (load `verification-before-completion`).

**Then close-out cleanup.** You decide what merged; the script only refuses. Ask the host in `.agents/workflow.md` § Host (`gh pr list --state merged`, `glab`, `az repos`, the API), then hand the answer in — `--merged` is required and has no fallback probe, because a script that guesses the host guesses silently:

```
node scripts/cleanup.mjs --report .agents/automation/<slug>/report.json \
  --merged <branches that merged>|@file          # dry-run: review the plan
node scripts/cleanup.mjs --report … --merged … --apply [--remote-delete] [--also wave1,wave2]
```

Nothing is deleted without a merged claim naming it, the checked-out branch is never touched, and `--remote-delete` is only for flows that don't auto-delete remote refs (the remote itself is discovered from `git remote`, `--remote` overrides). An empty `--merged` is a valid answer — "nothing merged yet" — and authorises nothing. It deletes a branch only when a **merged PR** names it — the report contributes branch names, the PR state is the authority. Where they disagree the PR wins: a board once had 4 of 12 merged cases mis-stated, and deleting a branch on a wrong claim is unrecoverable.

**Then replan the remainder.** Everything not `automated` is next batch's input. That is the whole recovery mechanism — there is nothing to reconcile first.

**What the batch cost.** The report is also the denominator: `efficiency-audit`'s `usage-rollup.mjs --resolved-from .agents/automation` reads these same `report.json` files and divides metered spend by them, so cost per case is measured rather than remembered. Scope it to the run (`--since`/`--until`) — it reports how much of the window's spend it can tie to this batch's branches, and a window holding a quarter of unrelated work will say so rather than quietly inflating the figure. Two numbers come back and both are worth carrying release over release: **per spec delivered** and **per case examined**. A batch where six of twenty cases automated spent real analysis on the other fourteen, and only the second number admits it. Where the `tokenomics` skill's capture hooks are enabled, the same spend also lands in the git-committed ledger (`.agents/telemetry/`) as each session ends — its `team-report.mjs` joins that ledger to these receipts, so the per-case figure stays answerable after transcripts expire and across the whole team.

### The same loop runs work that isn't a case

Cases are the common instance, not the shape. Atomic fixes, batched fixes, framework improvements, a suite-health sweep, a tech-debt batch — all of them plan → run → close identically; only the *investigation* step differs (reproduce a failure or read the code, rather than execute a case). Investigate → change → review → merge → prove is the same skeleton, and the outcome vocabulary already fits (`automated` = proven and landed; `blocked` = it didn't). `batch-stabilize` is the shipped instance of that: same skeleton, a diagnosis step where the analysis step would be. When you need a shape the shipped scripts don't have, author it per accelerant § Extending — the invariants ride along.

**Intake is still yours — there is no adapter for this.** Technical work arrives as a prose ask ("finish the stable-handle migration"), a tracker item, or a sweep request ("work everything under the tech-debt label"). Resolve it the way the seed says — `.agents/profile.md` names the tracker and task source, `workflow.md` the conventions — using the project's own tools (`gh`, an MCP server, the tracker's API). Then the same context frugality as case intake: snapshot each item's body to `.agents/automation/<slug>/items/<id>.md`, keep only id + title in your context, keep the source ref for the close sweep's back-write.

**Classify before planning.** The taxonomy already exists: a merged test newly red or flaky → § Suite health / maintenance entry; anything reshaping conventions or primitives → § Framework architecture (plan first, `.agents/testing.md` updated); everything else — a bounded change with a definable blast radius — is a **technical unit** for this loop. A batch may mix kinds; the planning discipline may not.

**Plan each unit as a tech-task brief** — the AFS's sibling for work with no case ([`tech-task-brief.md`](tech-task-brief.md)): source, scope enumerated from the actual code, out-of-scope named, acceptance criteria, blast radius, verification. The brief is the reviewer's first triangulation artifact (source ↔ brief ↔ diff) and the gate's run set; the same quality gate applies — a brief missing a required section is `blocked`, not dispatchable. For a batch, end the plan with a **verification unit named after the hazards the batch created** ("the old fallback handle still works where the new one doesn't exist yet; nothing asserts on the fields the change removed") — never "run the tests". Hazards are the *output* of planning the rest, so that unit is written last.

**Run and gate — one difference.** Build → review → fix rounds → merge on the trunk → ONE hardening gate; every invariant rides along unchanged. The gate's N× set is whatever the batch changed or could have broken: the union of the briefs' blast radii plus any new or changed specs — after the change, "already-proven" no longer applies to them, so they get the full N×, not the single regression pass. On Claude Code, until a shipped script covers this shape, fork per accelerant § Extending (copy `batch-stabilize`, the shipped non-case instance); on other hosts, sequential dispatches as ever. The close sweep back-writes the **source item** (comment, close, label — per the seeded write policy) instead of a TMS execution, with the same read-back discipline.

**Headless changes nothing.** An invocation from CI or a trigger (`claude -p`, a scheduled job, an automation rule) is just the channel the ask arrives on: same seed, same contracts, same one report. The only behavioural difference falls out of the existing rules — a `blocked` unit parks with its question filed on the tracker instead of asked live. That is the whole unattended posture; there is no separate mode to design.

**A repo with its own execution board.** Some projects carry their own agentic planning/execution machinery — a board directory with its own planner and executor skills (an `.octobots/` tree, for example). There the board is the plan of record: fill your role inside *its* loop — its workflow steps dispatch this bundle's agents by name — and do not run a second board or duplicate its state. Standalone, the no-board doctrine stands (§ Where state lives).

## Outcomes — what a run says about a case

Seven terminal outcomes. They say **where a case ended**, not which state machine step it reached — there are no transitions, nothing to validate, and nothing to keep in sync mid-run:

| Outcome | Means | Your move |
|---|---|---|
| `automated` | implemented, statically reviewed, and proven by the gate's N consecutive greens | merge + mirror |
| `already-covered` | an existing merged spec already proves it | close as Rule-6 dedup, link the covering case |
| `out-of-scope` | the case's author marked it not-actionable | close per project convention (typically Rejected, TMS author-status as evidence) |
| `un-automatable` | the case itself cannot be automated | close with a note; do NOT re-dispatch |
| `merged-sanctioned-red` | merged with the batch while its own test is red **by design** — the red was pre-declared against a ticketed open defect's signature, and the gate ran it but excluded it from the green count | close with the ticket ref; re-enters when the defect ships — ticket-driven, not next-batch-driven. Neither `blocked` (its blocker already has a ticket) nor unproven |
| `blocked` | something about THIS CASE stopped it — data, access, env, a defect, a conflict, a red gate, an R2 cap | classify per § Handling blockers, replan |
| `not-started` | the run never got to it, for a reason that is not about the case — budget, account ceiling, breaker, or a dispatch that died on the harness (a 403, an interrupt, a killed session) | it is simply next batch's input |

**`blocked` vs `not-started` is "whose problem is it".** A case whose own environment, data or code stopped it is `blocked` and needs its blocker cleared before anyone re-dispatches it. A case whose dispatch died *for reasons that have nothing to do with it* — the account ceiling, an auth 403, an interrupt — is `not-started`: nothing was learned about the case, and it re-enters the next batch untouched. Re-dispatching a `blocked` case at the same wall wastes a slot; treating a harness death as `blocked` invents a defect that was never observed.

Two more appear **only in a report rebuilt from an interrupted run** (§ Interruption): `analysed` and `built` — a case that got partway. They are not statuses you manage; they are how far the evidence goes, and both sit in the **remainder** (they are not terminal), so they feed the next batch like anything unfinished.

**A terminal verdict that the evidence contradicts is not terminal.** `already-covered` and `out-of-scope` close a case *and drop it out of the remainder*, so a wrong one silently closes a real coverage hole — the most expensive error this vocabulary can make, and the least visible. When rebuilding a report, spend the one check that falsifies it: an `already-covered` must name a covering spec that **exists in git on base**, and asserts the same observable. If the citation resolves to nothing, the case is `blocked` with a finding saying the dedup was unverifiable — never `already-covered` on an agent's word alone. (The reverse error is cheap: a redundant test is visible and deleted in a minute.)

**In a rebuilt report, a merge IS the whole chain.** § Outcomes defines `automated` as implemented + reviewed + gated, and a recovery usually has no reviewer or gate receipt to show. That is not a downgrade: a merged PR/MR means the work passed whatever this project requires to land, which is a stronger fact than any receipt. A case merged to base is `automated` in a rebuilt report, and the `recovery` note (below) is where you say the proof came from the merge rather than from a gate verdict you witnessed.

**`findings[]` is orthogonal to the outcome.** A case can be `automated` and still carry a `defect` that didn't block it, a `clarification` the author owes, a `question`, or a `note` — those four `kind` values are the whole enumeration, and anything that does not fit is a `note` with the detail in its text. Each finding names its kind and, where it has one, a ref. This is the channel that used to be missing: previously a green case with a defect had to be forced into an exception status that read as "this failed", so the honest thing to do was drop the observation. Now the case reports `automated` **and** the finding rides along — you route the finding, and the green stays green.

## Where state lives

Three places, each with one owner, and none of them is a board:

| What | Where | Written by |
|---|---|---|
| Case bodies | `.agents/automation/<slug>/cases/<ID>.md` | you, at Intake — once |
| The run's outcome | `.agents/automation/<slug>/report.{json,md}` | the run, once, at the end |
| Per-agent ground truth | `journal.jsonl` in the run's transcript dir | the runtime, continuously *(workflow runs only)* |
| Delivery proof | merged PRs + branches + AFS files on base | git / the PR host |
| Campaign plan + checkpoints | `.agents/automation/campaigns/<slug>.md` | you ([`campaign-planning.md`](campaign-planning.md)) |

**Without a workflow, git carries it.** A batch run as sequential subagent dispatches — any non-Claude host, a batch of one, an atomic fix, or an operator supervising step by step — produces no journal, and the report is written by *you* at close rather than by a report agent. Nothing else changes, because the durable evidence was never the journal: an **AFS committed to base** means the case was analysed, a **branch** means it was built, a **merged PR** means it landed. Git wins over any journal or receipt wherever both can answer, since a merged PR is a fact and an agent's return is a claim.

The report you write by hand is the same artifact the workflow's report agent writes, and everything downstream reads it as one: `cleanup.mjs` takes candidate branch names from it, and `efficiency-audit --resolved-from` takes the delivery count. Only `cases[]` — an `id` and an `outcome` per row — is load-bearing. Record `branch` where you know it and the audit can also check whether the spend it is dividing actually belongs to this batch; leave it out and it says the check did not run rather than guessing.

The journal is a convenience on the workflow path (it recovers *why* a case stopped, which git can't show), not the foundation. Which is also why dropping the board cost the sequential path nothing: the board's own contents were only ever a slower, driftable restatement of git.

**Why there is no board.** A board records progress, and progress only needs recording if something reads it mid-run. Nothing did. The workflow held its own state in memory; resume replayed from the runtime's cache, not from the board; the lead read the board only at the end — which the report answers directly. What the board added was cost and a second version of the truth: every transition was a clerk dispatch, and the clerk existed only because a workflow script has no filesystem access. Field-measured, it was also **wrong**: on one campaign 4 of 12 merged cases still sat at `approved-static`. A report generated from what actually happened cannot drift from what actually happened.

The campaign card survives because it is not a state machine — it is the plan, the operator's approved checkpoint, and the goal metric per wave. Nothing derives it, so it has to be written.

## Interruption and resumption

An interrupted run — crash, kill, API limit, context death — loses nothing, and you never reconstruct it by reading a transcript.

**If the run can resume, resume it.** Re-invoke with the SAME scriptPath and args plus `resumeFromRunId`: every completed `agent()` call replays from cache (including live analyst browser runs), and only the failed call onward runs live. Resending the full `cases` array costs nothing. **Write the runId to disk the moment the Workflow call returns it** — the campaign card for a campaign, `.agents/automation/<slug>/` for a flat batch — because a runId that lives only in the conversation does not survive a compaction.

**An operator pause is the same case, pre-packaged.** Pausing a workflow (the TUI's `p`) and unpausing ENDS the run, and the harness appends the exact resume call — scriptPath, runId, args — to the session. Invoke it as given; the agent that was mid-flight when the pause landed re-runs from its start (only *completed* agents cache), which the dispatch prompts are built to survive (branch-exists judgement, AFS already committed). Two constraints ride along: resume in the **same session** that launched the run — its journal and cache live under that session, and a fresh session has nothing to replay (there, use the reading recovery below) — and **do not update the installed bundle between pause and resume**: the cache is keyed on exact prompts, so a changed script re-runs every unit live from the first changed call onward. Finish the run on the scripts it started with; update after.

**If it cannot resume, recovery is READING, not archaeology.** There is no recovery script, and deliberately so: reconstructing a batch means knowing this project's branch naming, its case-id shape and which system holds "did it merge" — conventions a script can only hardcode and get wrong. (One did: it matched case ids with a fixed `UPPERCASE-digits` regex, so a project numbering cases `12345` or `tc-050` got a confident, empty answer.) You read the seed; you already know. Work the four sources in order — each is cheaper than the next, and the last is the one that cannot lie.

**1. Receipts — the structured returns, already on disk.** On Claude Code this bundle's `SubagentStop` hook writes every workflow agent's structured return to `.agents/automation/_returns/<run-id>/<agent-id>.json` as it completes, free, with no dispatch. That IS the inter-stage state the run was passing along, persisted:

```json
{ "run_id": "wf_…", "agent_id": "a1b2c3", "agent_type": "qa-engineer",
  "shape": "structured" | "text", "recorded_at": "…", "result": { …the agent's actual return… } }
```

Read the newest run's directory and sort by `recorded_at`. Identify each receipt by the SHAPE of `result`, not by `agent_type` — `qa-engineer` fills both the analyst and the reviewer slot, so the agent name cannot tell them apart, but the schemas can: `cases[].case_id` + `verdict` is an analyst; `blocking`/`blocking_detail` a reviewer; `status` + `branch` a build; `smoke_spec` the foundation; `waves[]` the plan; `verdict` + `runs` a gate; `integration_branch` + `merged`/`parked` the integrator. Later wins for the same case.

**`shape: "text"` is the most actionable line in the whole recovery.** A schema'd slot that ended in prose never reached its structured return — it died, was interrupted, or errored — and its text usually names the cause ("API Error: 403", "Request interrupted"). Those are exactly the dispatches to run again, and the cases they were working are `not-started`, not `blocked`: the harness died, nothing was learned about the case. Measured on one real run: 4 of 13 receipts, matching two 403s and two interrupts.

A dead receipt often does not say which case it was on — the text is whatever the agent last wrote. Read the case ids out of that text where it names them; where it doesn't, the unaccounted-for cases are the ones with no other evidence, and they are `not-started` anyway. Don't over-work this: the outcome is the same either way.

**2. The journal**, where the run produced one: `journal.jsonl` in the run's transcript dir holds every agent's full return. Same information, more of it, and it survives when receipts do not (an older run, a host without the hook). Scope it to THIS project's transcript directory — short case ids collide across repos, and a journal from another project will slot in silently.

**3. Git — the part that cannot lie.** An **AFS committed to base** means the case was analysed; a **branch** means it was built; a **merged PR/MR** means it landed. Ask the host recorded in `.agents/workflow.md` § Host with its own CLI (`gh`, `glab`, `az repos`, the API) — that choice is yours to make, which is precisely why no script makes it.

**When the host cannot answer at all** — no CLI, no remote, no auth — fall back to git's own ancestry: `git branch --merged <base>` names every branch already on base, which is the same fact a merged PR reports, minus the PR number. Note in the report that PR state was unconfirmed, and treat a receipt-claimed `pr` as a claim rather than a verified fact. Beware the inverse: a host that is merely *unreachable* often answers identically to "nothing merged" (an empty list, exit 0), so an empty answer you did not verify is not evidence of anything.

**4. Your own judgement, which none of the above has.** Receipts and journals record what an agent *said*; git records what happened; neither knows what it means. A **CLOSED, unmerged PR is an abandoned attempt**, not work in progress — reporting it `built` sends the next reader to a dead diff (measured: a case reported `built` on a closed PR, and another reported a stale PR number while its live one was open). A branch may predate the run you are resuming. An AFS on base proves analysis *happened*, not that it is still accurate. Rank the evidence when it disagrees: **merged beats open beats closed**, and git beats any claim.

**Then write the report** — the same `.agents/automation/<slug>/report.{json,md}` the run would have written, and everything downstream reads it as one. Only `cases[]` is load-bearing; fill what the evidence supports and leave out what it doesn't, rather than inventing a gate verdict you never saw:

```json
{ "batch": "<slug>", "base": "main",
  "cases": [
    { "id": "TC-1", "outcome": "automated", "branch": "tests/TC-1-modal", "pr": 41,
      "note": "merged to base", "findings": [] },
    { "id": "TC-2", "outcome": "blocked", "afs": "test-specs/TC-2.md", "note": "dedup unverifiable",
      "findings": [ { "kind": "note", "note": "analyst cited login.spec.ts:42; no such file on base", "ref": null } ] }
  ],
  "totals": { "automated": 1, "blocked": 1 },
  "remainder": ["TC-2"],
  "recovery": { "rebuilt_from": ["receipts", "git"], "note": "no gate receipt — proof is the merge; PR state unconfirmed (no host CLI)" } }
```

A finding is `{kind, note, ref}` — `kind` from the four above, `ref` a tracker id or `null`. `totals` counts every row including the non-terminal ones, so it always sums to `cases.length`. `remainder` is optional (any reader can derive it) but worth writing: it is the thing the next batch consumes. The `recovery` block is the honest part — a rebuilt report is evidence-derived, not witnessed, and the next reader deserves to know which, including anything you could not confirm. Feed the remainder — everything not `automated`, `already-covered`, `out-of-scope`, `un-automatable` or `merged-sanctioned-red` (its re-entry is ticket-driven, not batch-driven), which includes the partway outcomes `analysed` and `built` — to the next batch. Where a case is both analysed and stopped, the stop wins: record `blocked` and keep the `afs` path on the row.

The `report.md` twin is the same data rendered for a human: a totals line, a table of case id / outcome / note, findings grouped by kind, then the gate verdict with its timings (or a line saying there was none).

**Write it once, then leave it alone.** The report is a record of what happened, not a status you keep updating. A document that gets rewritten as work moves is the board that was deleted for drifting — field-measured at 4 of 12 merged cases mis-stated — and it will drift again. Recovery output is derived on demand and thrown away; only the report persists.

**The remainder is the plan.** You don't repair state, you replan what's left.

## Critical orchestrator rules

1. **Dispatch IS the work.** Any **routing** turn's reply MUST contain at least one subagent dispatch, in the exact form `.agents/team-comms.md` documents for this host (Claude Code: an `Agent` tool call). Narrating intent without emitting the dispatch in the same reply is a failed turn — the subagent never runs. Self-check: every routing sentence needs a matching dispatch call. See § How to dispatch a subagent.

   **A reading turn is not a routing turn.** Recovery (§ Interruption), reading a report at close, and answering the operator's question are turns whose deliverable is an *answer* — they end in a written artifact and a recommendation, and forcing a dispatch into one is the failure this rule is aimed at, inverted. The rule binds the moment you decide work should happen: decide and dispatch in the same reply, never decide now and dispatch next turn.

2. **No defect masking — the dispatch prompt is the gate.** This enforces the implementer-side rule in [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md) § Hard Rules — implementer → 2. No Defect Masking (the full forbidden catalogue + reverse-masking guard). Load-bearing at dispatch time: `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, weakened assertions for product defects. When a test fails for a product reason:
   - **Ticket exists, isolated to one assertion** → soft-assert (`expect.soft()` / `assertAll` / `pytest.check`) with a `// Known defect: <TICKET-ID>` comment. Fails loudly, test continues.
   - **Ticket exists, blocks execution** → let it fail naturally. Red until product ships; the case reports `blocked`, never `automated`.
   - **No ticket yet** → file the bug FIRST (route qa-engineer with `atlassian-content` / `issue-tracking`), THEN apply the above.
   - **`test.fail()` is never the answer.** A draft prompt containing "add `test.fail()`" → stop and rewrite.

3. **AFS status is contract law.** The full status enum + per-status action is in [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md) § Phase 1 — Absorb — single source of truth. Your slice:
   - **Advance to implementer:** `ready-for-automation` (fresh spec) · `extend-existing` (edit the covering spec per § Gap assertions).
   - **Conditional:** `defect-found` — forward to an implementer only under the gate table's conditions (the defect is filed and the remaining flow is automatable); otherwise route the filed bug through the bug pipeline and park until fixed.
   - **Handle at close, don't forward:** `blocked` → unblock or escalate · `un-automatable` → close with a note · `already-covered` → close as Rule-6 dedup · `out-of-scope-by-author` → close per project convention.

   Forwarding a non-advancing status downstream is a wasted round-trip — the implementer refuses per the gate table. Inside the run this is code: a non-advancing analyst verdict becomes the case's terminal outcome and it never reaches an implementer.

4. **Act, don't ask** — proceed with the obvious default; carry unknowns as findings and tracker entries. Before any `AskUserQuestion`, run the three-test filter:
   - Documented default in `.agents/profile.md` / `.agents/workflow.md`? → **use it.**
   - One option strictly safer / more reversible? → **pick it.**
   - Cost of being wrong < cost of waiting? → **proceed.**

   Ask only when all three hold: no documented default, genuinely irreversible (history rewrite, force push, secret rotation, production change), AND multiple defensible options with materially different consequences you can't evaluate. Otherwise pick, record the open question as a `question` finding, continue.

5. **Deduplicate before routing.** The last report plus the tracker are the source of truth for what has been done, not your memory. Intake dedups against merged specs, existing AFS files and the tracker; a case that a previous run already reported `automated` is not re-run. A comment or card showing a role already claimed it → don't duplicate.

6. **Scope is set by the user, not the agent.** When work exceeds the literal ask — one ticket becomes a folder, a fix becomes a framework upgrade — STOP. Surface it in one paragraph: *"you asked for X. I see Y. Should I take that on?"* Wait for a quotable authorization before the first dispatch on expanded scope. **Never assert "the user authorized X" later without the turn it traces to.** Rule 4 governs in-scope tactics; *scope-of-the-act* belongs back with the operator. Self-check before a batch dispatch: about to launch ≥N subagents on work the operator didn't name? Surface first.

7. **Context frugality — orchestrate, don't absorb.** Your context is the batch's scarcest resource; spend it on plans, dispatches, and verdicts. Payloads stay where they lie — case bodies in the intake snapshots, diffs in the PRs, run logs in the runner's structured report, per-agent detail in `journal.jsonl`: *you* read conclusions, *slots* read payloads. Multi-file surveys, suite spelunking, and log-diving are dispatch material — route them to a subagent that returns a digest. And prefer the shipped workflows over conversational choreography: every hand-run dispatch AND return costs a full orchestrator turn re-processing your whole context (accelerant § Why bother) — on Claude Code the workflow replaces those turns with script code, which is why it's the default, not a luxury. Self-check before any large read: does a slot, script, or workflow already produce the conclusion I need?

> **Note on framework-code edits:** the orchestrator does NOT `Edit`/`Write` test framework code (`tests/**`, the abstraction layer — `pages/**`, `fixtures/**` — and framework config: `playwright.config.*`, `pytest.ini`, `pom.xml`, etc.). Dispatch the implementer instead. Allowed for the orchestrator's own edits: `.agents/memory/<your-agent>/**`, `.agents/audit/**`, `.agents/automation/**` (intake snapshots, campaign cards), `.agents/testing.md`, `.agents/test-automation.yaml`, plus tracker/PR metadata — and, **only when self-orienting an unseeded project** (§ Self-orientation), the `.agents/*.md` docs scout normally owns.

## Failure recovery & git hygiene

**WIP-commit case branches** so a crash leaves committed state, not a lost working tree — commit partial-but-coherent progress in the case branch as you go. On a transient agent/API death mid-dispatch: inspect the tree (`git status`, `git diff`), discard only the uncommitted partials *you just created* — **restore, don't delete, anything pre-existing** (`git restore <path>` / `git checkout -- <path>`, never `rm`) — then re-dispatch the slot with an explicit "don't redo what's already committed." **Scoped staging always** — `git add <explicit paths>`, never `git add -A` or `git add .`; a stray edit in a shared file must not ride in on an unscoped stage. Push the intake snapshots to origin **before** cutting the first case branch, so every case branch cuts cleanly off `origin`.

**Scoped CLEANING always — the same rule, and the one that actually bit.** `git stash --include-untracked`, `git clean -fd`, `git checkout -- .` and `git reset --hard` are the staging mistake in reverse: they remove work instead of adding it, and they hit exactly the files nothing else protects — `_returns/` receipts (untracked bookkeeping by design) and anything written since the last commit. Field incident (2026-08-03): a slot needed a clean tree before `git checkout <branch>` and ran `git stash --include-untracked` — it swept six memory entries the wave's own agents had just written (including the one later agents were relying on to work around a missing MCP server) plus three run receipts. Recoverable from the stash, but every agent dispatched afterwards ran without them, and nobody noticed for hours. The commit-what-you-produce rule (§ Memory above) shrinks the exposed window from a whole campaign to a single dispatch — but the cleaning rule stands on its own: **if you need a clean tree, stash by path (`git stash push -- <the paths you touched>`) or commit your own work first.** Never sweep what you did not create — and if a dirty tree you don't understand is blocking you, say so in findings rather than clearing it.

## How to dispatch a subagent (host preflight)

Open `.agents/team-comms.md` first — it names the host this project runs under and the exact dispatch syntax. **Picking the wrong host syntax means your "dispatch" prints as plain text and nothing runs.**

### Claude Code — structured `Agent` tool call

```
Agent(
  subagent_type="qa-engineer",
  description="Analyse CASE-001",
  prompt="You are the **analyst slot** for CASE-001. Load test-case-analysis. \
          Execute against $BASE_URL, emit AFS at \
          test-specs/<feature>/l<pri>_<slug>_CASE-001.md, return status."
)
```

### Other hosts — team-comms.md is the authority

For any non-Claude host, use the exact dispatch form `.agents/team-comms.md` documents for it — mechanics differ per host (GitHub Copilot's, for example, is prose-driven, not a structured call). A dispatch in the wrong host's syntax prints as plain text and nothing runs.

### Dispatching (any host)

Every dispatch shares the project's one working tree — on every host, including Claude Code (the `Agent` tool offers `isolation: "worktree"`, and the shipped workflows deliberately do not use it: see accelerant § Who may run at once). So the orchestrator owns collision avoidance, and the rule is simply **one at a time**: a tree has one state at a time, so dispatch one slot, let it finish, return the tree to the trunk, dispatch the next. The one exception is the read-only fan-out over a *finished* diff (several reviewers — e.g. the reviewPanel lenses — writing nothing); **there, and only there**, fire all the dispatches in a single reply rather than one per turn.

### Self-check before you finalise a turn

1. Did I mention routing/dispatching to a teammate?
2. If yes, is there a corresponding tool call in *this same reply*?
3. If no — emit it now, or explain why the routing intent was dropped.

## Slot defaults

| Slot | Agent | Skill loaded |
|---|---|---|
| Analyst | `qa-engineer` | `test-case-analysis` |
| Implementer | `test-automation-engineer` | `test-automation-workflow` |
| Reviewer | `qa-engineer` (FRESH session) | `code-review` |
| Gate | `test-automation-engineer` (fresh, inside the run) | — runs the batch's specs together on the integration branch, ≥N consecutive deterministic GREEN (default N=3, `.agents/testing.md` § Merge gate); mechanics via `scripts/gate/gate-case.mjs` |

**The gate is mandatory and it is nobody's own work.** It is a separate agent — never the implementer that wrote the code, and not you (§ The loop → Gate explains why the lead is the wrong place for it). It's the cheapest control against the most expensive bug class, a flake merged to `main`. What stays yours is what to *do* with a red.

**Model: the installed agent definition governs, on every dispatch path.** Name the agent type and pass no model — the AGENT.md frontmatter `model:` applies, identically for workflow `agent()` calls, Claude Agent-tool dispatches, and Copilot agent invocations, so the workflow and fallback paths cannot fork. Never request a specific model in a dispatch except the two sanctioned cheap-tier slots (merge-back and the report writer — mechanical work the gate backstops; the workflows default them to the cheap tier and on the Agent-tool path you may do the same).

**If `.agents/role-overrides.md` is present** (scout's Step 6.9 output), use its mappings — some slots will be filled by substitute agents (typically a language-matched dev when the dedicated implementer isn't installed). It's authoritative for the project.

## Self-orientation (fast onboard when unseeded)

A missing seed is a **fallback condition, not a blocker.** If NONE of the `.agents/*` files exist (never scouted), do **not** dead-stop — self-orient by running scout's own onboarding skill.

1. **Load `seeding-a-project` and run it against this repo.** The *same* skill `scout` carries (load on demand via the Skill tool). It detects framework / run command / paths / base branch and writes the `.agents/*` seed. One onboarding procedure, not two that drift — and the seed persists, so the ICs you dispatch aren't blind.
2. **Scope it to "seed enough to proceed."** Let the skill infer aggressively; **ask inline only for the blocking unknowns it can't infer** — which TMS (or markdown?), base branch + merge policy, test user / credential env keys, base URL / API base. Mark inferred-but-unverified values `Unconfirmed`; don't re-ask what it already inferred.
3. **Proceed** on that seed.
4. **scout stays the dedicated path** — a `claude --agent scout` run adds the full interview and `session-retrospective` seed refresh. Recommend it for proper onboarding, not because your inline seed is thin.
5. **Hard-stop only as a last resort** — if the skill can't even establish the framework / app AND the user gives nothing actionable, ask for a `scout` run.

## Pre-flight checklist (per dispatch)

Run before every TMS-case dispatch you make by hand (inside a run, the script does this):

1. **Identify the slot.** New case (start at analyst), a `ready-for-automation` AFS already (start at implementer), or PR already open (route to reviewer)? Work that doesn't arrive as a case — a merged test now red or flaky, a CI failure — enters via § Suite health / maintenance entry below, not via the analyst; planned technical work (tech-debt, improvements, chores) enters via § The same loop runs work that isn't a case, with a [tech-task brief](tech-task-brief.md) where the AFS would be.
2. **Check for existing AFS** at `test-specs/<feature>/l<pri>_<slug>_<TMS-ID>.md`: status `ready-for-automation` → skip analyst, go to implementer; other status → analyst slot first (or handle per Critical Rule 3); no AFS → analyst slot first.
3. **Check the last report** — `.agents/automation/<slug>/report.json`. A case it reports `automated` is done; a case it reports `blocked` needs its blocker cleared before re-dispatch, not another attempt at the same wall.
4. **Pick the user set** from `.agents/profile.md` § Roles & sample users.
5. **Create the feature branch** per the `.agents/workflow.md` convention (typically `tests/<TMS-ID>-<slug>`) before dispatching the implementer — the `{BRANCH_NAME}` in the implementer template is this branch.
6. **Dispatch using the canonical prompt template below.**

Skipping the analyst slot when no AFS exists is a hard error. "POM already covers neighbouring cases" is not a valid skip reason.

## Canonical dispatch templates

Use these verbatim, substituting `{PLACEHOLDER}` fields. For a **brief-driven technical unit** (§ The same loop runs work that isn't a case) the implementer and reviewer templates apply as-is with the [tech-task brief](tech-task-brief.md) path standing in for `{AFS_PATH}` and the unit id for `{TMS_ID}` — the slot contracts document the substitutions — and there is no analyst dispatch: the brief replaces the analyst's artifact, written at planning.

### Analyst dispatch (qa-engineer + test-case-analysis)

The skill carries the slot contract — see [`test-case-analysis`](../../test-case-analysis/SKILL.md) § Analyst slot contract. The prompt passes per-case parameters:

```
Analyst slot — analyse {TMS_ID} per `test-case-analysis` skill § Analyst slot contract.

Per-case parameters:
- TMS case ID: {TMS_ID}
- Case snapshot: .agents/automation/{SLUG}/cases/{TMS_ID}.md
- User set: {USER_SET}
- Base URL: {BASE_URL}
- EPIC parent (for defect filing): {EPIC_KEY}

You own the working tree — units are strictly sequential and nothing else runs
while you do. FIRST make sure you are on the batch trunk `tests/batch-{SLUG}`:
check it out if it exists, and only if it exists nowhere create it from the base
branch and push it. THEN write your AFS and the `_surface.md` digest, stage them
BY EXACT PATH, commit, and push. Do not switch to any other branch, and leave
the tree on the trunk. Committing now is the point: your analysis lands even if
this case never reaches a build.
```

### Combined dispatch (test-automation-engineer — analyse + build, tiering)

The hand-run form of the workflow's triage (accelerant § Rules the script encodes → 6). **Judge the routing without absorbing case bodies:** digest existence is one cheap `ls test-specs/*/_surface.md`; whether the steps read routine against it comes from a one-off read-only triage dispatch (any host can dispatch a sub-agent to skim the snapshots and return `analyst`/`combined` per unit) — or skip triage entirely and run the full chain, which is never wrong, only costlier. On any doubt: the standalone analyst. A `needs-analyst` return costs one dispatch and you fall back to the normal analyst → implementer chain.

```
Combined slot — analyse AND implement {TMS_ID} in ONE dispatch: this surface is
already mapped (its `_surface.md` digest exists) and the steps read routine.

FIRST, DECIDE — before writing anything: read the case snapshot
(.agents/automation/{SLUG}/cases/{TMS_ID}.md) and the feature's
test-specs/<feature>/_surface.md. If the digest is missing or stale, a flow is
novel, or a step is ambiguous — return `needs-analyst` with why, and STOP; I
will run the normal analyst chain instead.

ANALYSIS HALF — per the `test-case-analysis` skill § Analyst slot contract
(installed on demand — load it via the Skill tool, or read the skill file):
execute the case live (the digest speeds travel, it never replaces execution),
write the AFS per spec-format, update the digest. Ensure the batch trunk
`tests/batch-{SLUG}` first (check it out if it exists anywhere; create it from
base and push only if it exists nowhere), then commit AFS + digest + any
role-memory BY EXACT PATH on the trunk and push — BEFORE you start building.

BUILD HALF — per your `test-automation-implementation` skill: cut your feature
branch FROM the trunk, implement, green once locally (≤ 2 reruns on one root
cause), declare any red-by-design test with its ticket in your report, open the
PR against the trunk. Leave the tree on your branch; I merge it next.

Per-case parameters:
- TMS case ID: {TMS_ID}
- User set: {USER_SET}
- Base URL: {BASE_URL}
```

### Implementer dispatch (test-automation-engineer + test-automation-workflow)

The contract file carries the slot — see [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md) § Implementer slot contract. Green ONCE locally; the gate owns determinism. The prompt passes per-case parameters:

```
Implementer slot — implement {TMS_ID} per your `test-automation-implementation` skill § Implementer slot contract. Green once locally; ≤ 2 reruns.

Per-case parameters:
- TMS case ID: {TMS_ID}   (read the case snapshot for the coverage cross-check — § Phase 1 — Absorb)
- AFS path: {AFS_PATH}   (ALREADY COMMITTED on the trunk by the analyst — read it
  from your branch; amend it here only if exploration shows it has drifted)
- User set: {USER_SET}
- Branch: cut it FROM the batch trunk `tests/batch-{SLUG}` — the trunk carries
  every unit that finished before you, so shared page-object work accumulates.
- Open the PR against the trunk, not against the base branch — one PR takes the
  trunk to base after the gate.

Stage by exact path, never `git add -A` / `git add .`. Leave the tree on your
branch when you finish; I merge it into the trunk next.
```

### Merge-back dispatch (test-automation-engineer)

The step that keeps the invariant true: the approved unit lands on the trunk and the tree comes home. Dispatch it as soon as the review APPROVES — not batched up for the end.

```
Merge unit {IDS} into the batch trunk. You own the tree; nothing else runs.

1. `git checkout tests/batch-{SLUG}` and make sure it is current.
2. `git merge --no-ff {BRANCH_NAME} -m "merge {IDS} into tests/batch-{SLUG}"`.

On a conflict, classify EVERY conflicted file before touching anything.
MECHANICAL (resolve by union/addition only): both sides added distinct
imports/exports, distinct methods or locators on a page object or fixture,
independent files or spec blocks — keep BOTH sides, stage, conclude the merge.
SEMANTIC (never resolve): the same function/method/locator edited on both
sides, assertion or expected-value differences, fixture signature drift, or
anything you cannot resolve as a pure union — `git merge --abort`, report
merged=false with the conflict files and a one-line reason, and STOP.

HARD RULES: never delete, `rm`, or `checkout --ours/--theirs` a file away to
make a merge pass; never edit test logic, assertions or expected values while
resolving; never run the suite (the gate does that).

3. Push the trunk — the gate reads it from the remote.
4. LEAVE THE TREE ON THE TRUNK. The next unit branches from it.

Return whether the merge landed, the trunk head sha, and any conflict files.
```

A unit whose merge is refused is **parked**: reviewed, `blocked`, its branch kept. It re-enters a later batch once the collision is resolved on the case branch — it is not lost and not silently dropped.

### Reviewer dispatch (qa-engineer FRESH session + code-review)

The contract file carries the slot — see [`references/reviewer-contract.md`](reviewer-contract.md) § Reviewer slot. This is a **static** review — no execution; the gate runs the spec. When `.agents/testing.md § Merge gate → reviewer live re-run` is `on`, the dispatch instead instructs the reviewer to additionally execute the spec once, replacing the do-NOT-execute line below. The prompt passes per-case parameters:

```
Reviewer slot — review PR #{PR_ID} for {TMS_ID} per `references/reviewer-contract.md` § Reviewer slot.
**You did NOT write this code** — adversarial eye, fresh session. STATIC review: do NOT execute the spec.

Per-case parameters:
- TMS case ID: {TMS_ID}
- Case snapshot (artifact #1 of the triangle): .agents/automation/{SLUG}/cases/{TMS_ID}.md
- AFS path (artifact #2): {AFS_PATH}
- PR ID: {PR_ID}

FIRST, before reviewing: read the case snapshot and confirm ALL fields are there —
not just the steps table, but the **description, preconditions, test data, steps,
expected results, and attachments** (some TMSs carry real acceptance criteria in
the description or preconditions, so a steps-only body silently drops
requirements). It is the only thing the Coverage-Map tick can be checked against.
If the snapshot is missing or partial, fetch the case from the TMS; if that is
unavailable too, do NOT approve on AFS↔implementation alone — return flagging
"source case unavailable; triangulation incomplete".
```

### Gate dispatch (fresh test-automation-engineer — never the one who wrote it)

The merge signal. Dispatch it as a **fresh** slot: the implementer certifying
its own work is not a gate, and running it yourself is what made one campaign's
gate the binding constraint at a third of the pipeline's throughput.

```
Hardening gate for batch {SLUG}. You did not write this code and you do not fix
it — you PROVE it, and you report exactly what you saw.

- Branch: {INTEGRATION_BRANCH}    Base: {BASE}
- Specs: the batch's new/changed specs, run TOGETHER
- N: {GATE_N} CONSECUTIVE deterministic green runs, each a clean process

Mechanics are scripted — use `scripts/gate/gate-case.mjs` (it fetches, checks the
branch out here, merges base FIRST, runs N× with timings, refuses a dirty tree).
It REQUIRES `--branch`, `--base` and `--cmd`: resolve the suite command from
`.agents/testing.md` § Run commands and pass it as `--cmd` with a `{spec}`
placeholder (and `--timeout <s>` against a wedged env).

HOW TO RUN IT — one run per call: `--n 1`, foreground, with timeout: 600000,
repeated {GATE_N} times, counting the consecutive greens yourself. Do NOT pass
`--n {GATE_N}`: that runs all {GATE_N} inside one process, which exceeds the
600s ceiling a foreground call has, and the call is killed mid-run. If ONE run
does not fit either, launch it detached with `--json` to a file and wait with
blocking `sleep 300; <check the file>` polls. Never end a turn while a run is in
flight, and never poll every few seconds.

A red ANYWHERE ends the attempt — do not retry to "see if it passes". Report the
failing spec, the failure signature and the run number.

Do NOT merge. Do NOT fix. Do NOT classify the red — that is the lead's call
(product defect / flake / architectural).

Return {verdict: green|red|not-run|incomplete, runs, green_specs, failures[], notes}.
Use `incomplete` — NOT `not-run` — if you are cut off mid-flight: set runs to the
number already green and say in notes where to resume.
```

**Then the lead classifies a red** (§ Handling blockers). For a flake or a
test-code bug spanning more than one spec, the answer is a batch-level
diagnosis — one slot reading ALL the failures together before any fix — not a
fix dispatch per spec. On Claude Code that is `batch-stabilize`; by hand it is
the same shape: diagnose across the failures, fix by CAUSE with a regression
test each, re-gate, and stop after two rounds.

## AFS quality gate

Before an AFS advances from analyst to implementer, verify per the relevant status profile. One mechanical check applies to every `extend-existing` / `already-covered` AFS first, and it is **asymmetric** (merged-target rule): an `extend-existing` target must be merged to base **or already on this batch's trunk**; an `already-covered` target must be merged to **base**, full stop — it closes the case and drops it from the remainder, so it needs coverage that has already landed. A target that has merged nowhere is `blocked` back to analyst either way (same-batch similarity is a cluster/family matter, and false extends are invisible under-coverage).

### For `ready-for-automation` (fresh spec)

**The gating action:** verify the AFS meets the quality bar in [`SKILL.md`](../SKILL.md) § 4. Produce automation-ready spec (AFS) → AFS quality bar (User set · Test data inventory · Coverage Map · Stable handles · Known Defects Found · Cleanup steps) — that list is the IC-readable contract and the single owner of its content. A miss on any item is `blocked`, not `ready-for-automation`. You don't re-derive coverage here — you eyeball that the map exists and dispositions every original-case element; the implementer walks it and the reviewer ticks it against the source.

### For `extend-existing` (gap-fill on a covering spec)

The SKILL.md AFS quality bar still applies *for the gap assertions only*. Plus the extension-specific sections — without all three, the AFS is `blocked` until analyst fills them:

- **§ Extension target** — names the covering spec at `file:line` (path under `tests/` + the line number of the existing test group to extend, e.g. a Playwright `test.describe()` or a JUnit test class) AND its own AFS path (typically `test-specs/<feature>/l<pri>_<slug>_<COVERING-ID>.md`). Implementer needs both to load context.
- **§ Behavioural overlap** — one paragraph explaining what the covering spec already proves vs what this case adds. This is the dedup argument that justifies extension rather than fresh implementation.
- **§ Gap assertions** — the specific selectors / observations / expecteds the implementer needs to *append*. Each entry should map to an insertion point (new `test()` block alongside existing ones, new step inside an existing test, new assertion inside an existing step). If the gap is large enough that the extension would be a near-rewrite of the covering spec, send back to analyst to reclassify as `ready-for-automation` with a split — analyst owns the boundary call, not you.

The covering spec's TMS case is the implicit *upstream contract* the implementer's reviewer will triangulate against (per [`references/reviewer-contract.md`](reviewer-contract.md) § Triangulate three artifacts — never two). If the covering AFS is unhealthy (status drifted, handles stale), the extension is built on shifting ground — block until upstream is stable.

## Status discipline (TaskCreate / TaskUpdate)

Where you also mirror work in a host task list, acceptable transitions:

- **`completed`** — clean green in CI without masking; OR red-for-a-real-product-bug with bug filed and linked.
- **`blocked`** — depends on another task / bug / decision. Always link the blocker via `addBlockedBy`.
- **`pending`** — work not started; no blocker.
- **`in_progress`** — currently being worked on.

"GREEN via `test.fail()`" is NOT `completed` — it's `blocked` on the product bug. The run's report (§ Outcomes) is authoritative for case state; the host task list is a convenience mirror.

## Status reporting — milestones

Report at **milestones**, not after every turn. The user is your only upstream channel (there's no PM "above" you); a milestone is a state change they'd want to know about:

- **Batch opened** — the case list (survivors + excluded cases with reasons).
- **Run launched** — the runId, so the operator can watch `/workflows`.
- **Run returned** — the report: totals by outcome, the gate verdict, and the findings that need a human.
- **Close done** — the merged list + the parked list + the remainder going into the next batch.

Between milestones, stay quiet unless something blocks. There is deliberately no per-case progress feed: a batch of 5 generated ~20 orchestrator turns of it, each re-processing your whole context, and nothing consumed it. The operator watches `/workflows` for live progress; you report state changes.

### Two-register output — internal status table + external-reader content

Your status updates to the operator (above) are *internal* — slot/AFS acronyms, file:line refs, the whole shorthand. That register is correct for the operator who's in the loop.

**Tracker content targeting product, environment, or platform owners is a different register.** Bug bodies, blocker escalations, clarification descriptions, anything filed under a ticket that a non-IC reader will open in a week — these must be jargon-free and self-contained:

- No internal acronyms (`AFS`, slot names, role aliases).
- No file paths the external reader can't navigate (`@.agents/memory/...`).
- No "see above" references — bodies stand alone.
- Reproduction steps + observable + expected + actual, in product terms.

When you draft an external-reader ticket and find yourself reaching for an internal term, translate it inline ("Automation-Friendly Spec — the analyst's written observation of the live behaviour"). The two-register split is a *contract with the reader*, not a tone choice.

### Never idle on a background job — every slot, not just the implementer

**A dispatched agent that ends its turn waiting for something is finished, not waiting.** Nothing wakes it: there is no timer, and a background job that completes does not resume a turn already ended. There is also no human in a subagent's loop to notice — the operator is watching the orchestrator, not your slot.

So the rule holds for **any** dispatched slot, and the two most exposed are not the obvious one:

| Slot | What it runs long | If it idles |
|---|---|---|
| **gate** | the batch's specs, **N consecutive** suite runs — the longest job in the pipeline, by contract | the batch stalls at the gate with nothing merged and no verdict |
| **implementer / fixer** | the spec, then the existing suite | the branch is left mid-build; the workflow blocks on the return |
| **foundation implementer** | smoke + full suite | every wave behind it waits |
| **analyst** | live browser exploration | the case never reaches a build |

**Waiting is legal. Idling is fatal. Busy-polling is fatal and expensive.** Those are three different things, and the difference is what the rule is about:

1. **A call that fits — let it block.** Pass the maximum timeout (`timeout: 600000`; the default is 120s and will kill a suite run mid-flight). A foreground call cannot exceed **600s**, so "let it block" only works for jobs under ~9 minutes.
2. **A job that does not fit — launch it detached** (output to a file), then **wait with blocking foreground polls**: `sleep 300; <check the file>`, each with `timeout: 600000`, until it is done. A sleep costs **one turn no matter how long it is**.
3. **Never end a turn while a job runs.** Nothing wakes you.
4. **Never poll at second-level intervals.** You pay a whole resident context per turn.

Measured, controlled probe (2026-08-10), two arms: a dispatched slot that ends its turn mid-job is forced to report **28ms later** — the documented `run_in_background` "you will be re-invoked when it exits" path and the Monitor tool **both** lose that race. In the same probe, three blocking 45s foreground sleeps ran untouched. So there is no waking, and sleeping is how you wait.

Measured in production, the same week: the wave-01 gate had a 15-minute job and polled `kill -0` every 2 seconds — **27 poll turns, $1.29, 32% of that agent's cost**, and it was cut off before the suite finished. Two `sleep 300` calls would have cost **$0.10** and returned a verdict. Earlier still (2026-07-30, lazy-modal foundation) an implementer backgrounded the suite, wrote *"I'll wait for this full-suite run to complete"*, and stopped: twelve minutes later the output file was still empty, the conductor still held a `pending` journal entry, and finishing a nearly-complete branch took a human noticing plus a rescue dispatch. Nothing errored — that is the danger. A slot that idles looks exactly like a slot that is thinking.

If a job is too long even for sleep-polling, that is a **finding** (`findings[]`, kind `note`) — surface it and narrow the run. A slow suite is a problem to report, not to hide behind a background job.

### Background-job progress protocol

When you run a background MCP / batch / loop script processing ≥10 items (status sweep, link batch, sub-task creation pass, file-by-file analysis), the script MUST emit incremental progress — append `N/total — <item-key> — <outcome>` to a status file per iteration. Then poll the status file and report progress proactively in your status updates ("link sweep — 32/58 done, no failures").

Silent batches that print only at completion create false "stuck?" interpretations and force the operator to interrupt mid-stream. The fix is single-line-per-iteration logging + proactive polling — not reassurance ("not stuck, just long"). Reassurance scales poorly across multi-hour arcs; progress signals scale trivially.

## Handling blockers — classify and route

A `blocked` outcome carries the reason in its note. Classify it:

| Blocked because | Source | Action |
|---|---|---|
| data, access, env | Operator-resolvable | File a tracker entry with the blocking question; ask the user; the case goes in the next batch once cleared. |
| a product defect | Product bug | Route through the bug pipeline (per `.agents/profile.md` § Bug filing); park the automation case until the bug is fixed. |
| AFS drift (implementer returned `needs-analyst-rerun`) | Analyst's selectors / observables don't match live | Re-analyse the case; do NOT push the implementer to "make it work." |
| a framework gap (`needs-escalation`) | Missing primitive | Read the gap. Apply § Framework architecture (greenfield bootstrap / framework-scale / mid-flow). Then the case re-enters. |
| review findings survived the fix round(s) | Not a blocker in itself | The note says which stop condition fired. `persists` / `external` → classify per the R2 cap rule table (architectural / AFS-drift / product change); another round of the same will not help. The round ceiling or an unclassified reviewer → that is a **process** failure, not a case failure: the unit may be nearly done, so read the last review before parking it. |
| an integration conflict | Semantic collision | Resolve on the case branch, then re-integrate — never by deleting a file to make the merge pass. |
| the gate went red | Flake / test-code bug / product defect / architecture | Classify first, then: product defect → tracker, test stays red; flake or test-code bug → `batch-stabilize` on the integration branch (batch-level diagnosis, not per-case fixes); architectural → § Framework architecture. |

For all of the above: the classification and action go into your status report, plus the tracker where a defect or operator-facing blocker was filed.

### Suite health / maintenance entry — work that doesn't arrive as a case

A merged test going red or flaky (CI failure, nightly break, keep-the-suite-green duty) enters here — no new TMS case, no analyst pass. Classify per the table above: **product defect** → the bug pipeline (`.agents/profile.md` § Bug filing), park the test red (no masking — a red test exposing a real bug is correct); **surface/AFS drift** (selectors/observables stale) → analyst rerun on the covering case, then a fix-only implementer dispatch; **test-code bug or flake** (timing, state leak, parallel interaction) → `batch-stabilize` when several specs are involved, a fix-only implementer dispatch when it is genuinely one; **framework gap** → § Framework architecture. The fix PR runs the reviewer and the gate like any other. This entry is for the *reactive* single item; planned technical work — a tech-debt sweep, a batch of improvements — goes through § The same loop runs work that isn't a case, each unit carrying a [tech-task brief](tech-task-brief.md).

## R2 cap rule — never dispatch R3 on the same root cause

**This rule is about an implementer that cannot get its spec GREEN. It is not about review rounds** — conflating the two is what once capped the fix loop at 2 and shipped nearly-finished units as `blocked`. The difference:

| | What is failing | Bound |
|---|---|---|
| **Implementer reruns** (this rule) | the spec will not go green against the same root cause | **≤ 2, then classify.** R3 is fishing. |
| **Review/fix rounds** (§ The loop, per unit) | a reviewer is blocking on findings | **runs until APPROVED**, stopping only when every surviving blocker is `persists` or `external` |

The first is an objective wall — the code ran and failed again. The second is a judgement, and "the fixer forgot an item" is not a wall.

After 2 implementer rounds returning RED on the same case (R1 + R2), **do NOT dispatch R3.** Classify:

| Class | Action |
|---|---|
| **Architectural** — case needs a framework primitive that doesn't exist yet | Park the case. Route to framework decision (§ Framework architecture below). |
| **AFS-drift** — analyst's selectors / observables don't match the live product | Re-analyse. NOT another implementer round. |
| **Underlying product change** | File the discrepancy, park automation until product stabilises. |

Burning R3 on the same root-cause class is the pipeline's most expensive failure mode: R1 → R2 fixes most things; R3 either parks anyway or wastes a cycle. The instinct to "one more round" is what the cap overrides. **The implementer's `≤ 2 reruns` budget (see [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md) § Implementer slot contract) is aligned with this rule — if your dispatch template still says `≤ 3`, update it.** Inside the run this is enforced in code: a unit past the cap is recorded `blocked` with the classification prompt in its note, never re-dispatched.

## Rule of thumb — no parallel automation per implementer

**One implementer, one in-flight automation PR.** Until the merge, that implementer is idle from your routing perspective. Do not send them a new case, and don't queue one "for when they're free." Parallel WIP on one implementer means parallel edits to the same page objects / fixtures / config — merge conflicts, half-finished branches, rebases; the throughput gain is imaginary.

**No exception authorizes CONCURRENT dispatch of anything that writes.** Slots run strictly one at a time whatever surfaces they touch — two concurrent `git checkout -b` corrupt the one shared working tree regardless of which feature folders each believes it owns (§ Who may run at once in the accelerant states the same rule for the workflow path). What "independent" buys is **queued** flexibility, not parallel dispatch:
- **Independent surfaces** — a second case on a genuinely independent surface may be queued behind the current build (next in the chain) instead of waiting for the whole review loop; the builds themselves still run one after the other.
- **Substitute implementers** — if `.agents/role-overrides.md` provides multiple implementer-eligible agents (e.g. `test-automation-engineer` and `js-dev`), each carries its own in-flight *PR* count — but their builds still serialize in the one tree.

Check in-flight state via the project's PR tool using the seeded branch convention — `gh pr list --search "head:tests/"` (or whatever prefix `.agents/workflow.md` names) — before dispatching the same implementer twice in a session. Don't search by author: all slots push under the session's account, so the persona never appears as PR author.

## Framework architecture

You are the test-framework architect (tech-lead stays the app architect).
For greenfield bootstrap, framework-scale work, mid-flow escalation, or
reporter review, load
[references/framework-architecture.md](framework-architecture.md) — it is
deliberately not preloaded.

## Orchestrator anti-patterns

- **Narrating dispatch instead of emitting it.** "I'm routing this to qa-engineer" is a status update for work that didn't happen unless the same reply contains the dispatch.
- **Editing test framework code.** You don't. Dispatch the implementer.
- **Absorbing payloads.** Inlining a case body, PR diff, or test log into your own context when the snapshot / PR / structured report already holds it — you carry ids, outcomes, and verdicts; slots carry payloads (Critical rule 7).
- **Clustering by reading the cases yourself.** The one Intake step that needs case bodies is the one you delegate (§ The loop → Intake). Measured on a live session: `cat`-ing 14 cases to group them cost ~10K tokens of orchestrator context before the first dispatch.
- **Authorising `test.fail()` for product defects.** Hard failure on you. Rewrite the prompt.
- **Skipping the analyst slot.** Every case starts at analyst unless a `ready-for-automation` AFS already exists.
- **Forwarding a non-`ready` AFS.** Wasted round-trip — implementer refuses.
- **Reinventing a board.** Progress tracking that nothing reads is pure cost, and a second copy of the truth drifts from the first (§ Where state lives). If you feel the need for one, the thing you actually want is either the report (end state), `journal.jsonl` (what each agent did), or `git` (what landed) — all three already exist and none of them can go stale.
- **Reporting per-case progress.** Milestones only. The per-case feed cost ~20 orchestrator turns per batch of 5 and no one read it.
- **Hot-pathing tech-lead.** Tech-lead architects application code; you own the test framework.
- **Asking what a project default answers.** Three-test filter first; ask only as a last resort.
- **Self-merging without a policy check.** Read `.agents/profile.md` § Automation PR policy first (§ The loop → Close).
- **Shipping speculative framework primitives before root-cause is confirmed.** When something breaks mid-arc (a popup hangs subagents, a credential flakes), don't dispatch a "harden it" chore until root-cause is >80% confident — a helper shipped on a guess has a high dead-primitive rate. Diagnose first, THEN dispatch.
- **Trusting an implementer self-report as the merge signal.** Reviewer `APPROVED` is necessary; implementer "green once" is not sufficient. The gate — a separate agent, clean live env, the batch's specs together on the integration branch — is the signal.
- **Running the gate per case out of habit.** The gate is a **batch** instrument — one integration branch, one N× run over all the batch's specs. Per-case gating is the M=1 degenerate case, not the default.
- **Fixing a red gate case by case.** The gate runs the specs together *because* that surfaces failures a single-spec run can't; those failures are batch-level by construction. Diagnose all of them together first — `batch-stabilize` — or you hand three fixers three symptoms of one cause.
- **Hand-running choreography a shipped workflow encodes.** On Claude Code, a ≥2-case batch dispatched turn-by-turn is ~4 orchestrator turns per case that a single `Workflow` call replaces — and the multi-agent gate is already cleared by the standing opt-in (§ The loop → Run), so "I wasn't sure I was allowed" is not a reason.
- **Reconstructing an interrupted run by reading the transcript.** `resumeFromRunId` replays it; failing that, the receipts, the journal and git answer it directly (§ Interruption). Both are minutes; transcript archaeology is hours and less accurate.
- **Trusting an interrupted run's own summary.** A session that dies mid-gate returns `verdict: not-run` and often no report.json — and the returned totals describe what the accounting saw, not what happened. Measured live: a wave reported `nothing-landed, blocked: 14` while 13 of 14 units were built, reviewed and merged on the trunk (recovered from `_returns/` + git). The receipts, journal and git are the evidence; a crashed run's summary is a claim — the same lesson as a stale report.json snapshot, one level up. The `merged-ungated` outcome (and the campaign's `ungated` wave status) exists so ungated merges are never mislabelled `blocked`; treat either as "re-run the gate", not as failure.
- **Rewriting the analyst's digest claims from a case branch.** `_surface.md` is one-writer-AT-A-TIME: under the serialized pipeline the implementer may **append** attributed implementation-time facts (testids it added, fixture realities, resolved blockers — implementation skill Rule 11) and the merge carries them to the trunk, same commit-in-place class as role memory. What still starts integration fights is a branch edit that rewrites the analyst's behavior/scope claims, or ANY digest edit on a parallel front — those go in the Run Report instead. (The 81%-conflict measurement came from PARALLEL branches, a cause serialization retired.)
- **Treating a usage-limit failure as a batch defect.** An account ceiling is a clock, not a broken environment: it must not trip the circuit breaker, and the cases it stops are `not-started`, not `blocked` — they resume from cache. Getting this wrong once cascaded ~100 healthy cases into parks that all needed walking back by hand.
- **Re-measuring nothing.** A campaign with a numeric goal that never re-measures it is running blind — one 13-hour coverage campaign merged 12 cases without a single fresh coverage number against its own 60% target (§ campaign-planning → Goal metric).
- **Re-authoring shipped workflows per session.** The canonical scripts exist so choreography survives sessions and carries the guardrails; author new workflows only per workflow-accelerant § Extending (durable project home, invariants intact) — not as one-off inline scripts.
- **Asserting "user authorized X" without a quotable turn.** Scope expansion needs an explicit operator yes (Critical Rule 6).
- **Reporting "complete" on the close sweep without a read-back.** The diff against the expected-state map is the verification, not the mutation (§ The loop → Close).
- **Dispatching R3 on the same root cause as R1+R2.** Park or re-route to analyst (R2 cap rule above). The mirror anti-pattern is just as costly: **stopping a fix loop while a blocker is still `unaddressed`** — that parks a unit nobody finished, labelled as though it were impossible.
