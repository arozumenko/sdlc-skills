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
- [Canonical dispatch templates](#canonical-dispatch-templates) — runner · build (three routes) · reviewer · merge-back · gate · publisher
- [Extending a covering spec — the merged-target rule](#extending-a-covering-spec--the-merged-target-rule)
- [Status discipline (TaskCreate / TaskUpdate)](#status-discipline-taskcreate--taskupdate)
- [Status reporting — milestones](#status-reporting--milestones)
- [Handling blockers — classify and route](#handling-blockers--classify-and-route)
- [R2 cap rule](#r2-cap-rule--never-dispatch-r3-on-the-same-root-cause)
- [Rule of thumb — no parallel automation per builder](#rule-of-thumb--no-parallel-automation-per-builder)
- [Framework architecture](#framework-architecture)
- [Orchestrator anti-patterns](#orchestrator-anti-patterns)

## The loop: plan → run → close

Work arrives as a set — TMS cases, a red suite, a framework improvement — and leaves as **one report**. Your loop has three moves, and only the first and last are yours:

**Plan it, run it, close it. If some of it didn't land, replan the remainder and run again.**

There is no mid-run bookkeeping to keep, because nothing reads it: the run reports once, at the end, and everything needed to recover an interrupted run is already on disk (§ Where state lives). A batch of one degenerates to the old per-case flow minus the ceremony. For backlogs ≳ 2× the batch size — or a new coverage area — compose batches as a **campaign** (waves + a foundation pass + clusters of similar cases) per [`campaign-planning.md`](campaign-planning.md).

### 1. Intake — resolve the work set (yours)

Resolve the cases: operator IDs, or the selector in `.agents/profile.md` § Task source (TMS folder/suite, board query, issue label) — don't idle for pasted IDs on a project whose seed names a queue.

Then **ONE** TMS sweep: fetch every case and probe each author's metadata directly — status (skip author-not-actionable: "Out of Scope" / "Untested" / "Draft"), folder-membership (catch raw-key iteration drift), version. Probing the single-case status field directly is authoritative; JQL-style `status in (...)` queries on TMS custom fields are unreliable across adapters — verify the field directly, never query-set. Apply `.agents/testing.md` § TMS case-gate's exclusion list (absent → fetch all, flag the gap), and dedup survivors against merged specs (their coverage declarations name their case ids) and the tracker (Critical rule 5).

**Fetch once, to disk:** write each surviving case's full body to `.agents/automation/<slug>/cases/<ID>.md` — the batch-scoped snapshot the builder and reviewer read (they re-fetch only if it's missing); keep only id + title + status in your own context. One TMS fetch per case per batch, and both slots work from the identical snapshot — a mid-batch author edit can't silently skew the review.

**Already in the repo? Don't copy.** When the task source IS this repository —
manual-qa-authored TC files, or case bodies someone already committed as md —
the source file *is* the snapshot: pass its repo-relative path per case
(`cases: [{id, path}]` to the workflow; campaigns via `plan.casePaths`; name
the path in hand dispatches) and skip the `cases/` copy entirely. Git supplies
everything the copy existed for: the version-of-record is pinned by the intake
commit, both slots read identical bytes in the same tree, and the drift check
becomes `git log -- <path>` over the batch window instead of a TMS re-fetch.
Status gates read the files' frontmatter where present. `cases/` stays for
bodies fetched from an EXTERNAL system — one body per case, never two.

If `.agents/testing.md` names a known blocking modal (session-expired, forced-password-change, MFA, cookie banner), inject its dismissal snippet into *every* dispatch this batch — not after the first hang. Chunk to batch size **M** (§ Batch pipeline, default 5). If the seeded tracker policy requires visible WIP, create all sub-tasks in one batched write; else the tracker waits for the close sweep.

**Cut and push the batch trunk.** `git checkout -B tests/batch-<slug> <base> && git push -u origin tests/batch-<slug>`. Case branches live under it and their PRs target it; the gate proves it; one PR takes it to base. Push it now, not later: the gate checks out `origin/tests/batch-<slug>`, and a trunk that only exists locally fails the gate for an infrastructure reason that reads as a red case. (On Claude Code the shipped workflow's first build does this for you.) **A batch of one skips the trunk** — the case branch targets base directly.

**Cluster AND size the batch — by DISPATCHING one pass, never by reading the cases yourself.** Grouping similar cases needs their bodies, and your context is the batch's scarcest resource (Critical rule 7), so this is the one Intake step you delegate: dispatch a single cheap agent (haiku-tier, read-only — any generic agent type, no role memory needed) over the snapshots you just wrote, and take back only the grouping and the sizing verdicts. The same read answers both questions — sizing rides free on the dispatch you were paying for anyway. The prompt below is self-sufficient: it tells the reader where its verdict contract and tier definitions live, so it never improvises a taxonomy.

This pass is **mandatory before the batch opens, on every host** — it is the un-automatable screen, the reviewer's exclusion budget, and the export's effort fields, and skipping it silently is how batches ship with no effort data. The enforcement is host-split: on Claude Code the shipped workflow's triage ATTESTS the verdicts file exists (`.agents/estimation/<slug>-verdicts.json`) and lands a `quality_flags` entry in the report when it doesn't; **running the loop by hand (no Workflow tool, Copilot), you are the attestation** — check the file yourself before the first build dispatch, and if you proceeded without it, write the same quality_flags line into the report.json you author at Close. The only sanctioned skip is the operator explicitly waiving the pass — record the waiver in the report note.

```
Clustering + sizing pass — read each case's body (the intake snapshots at
.agents/automation/{SLUG}/cases/*.md, or the in-repo source paths where intake
skipped the copy) and return TWO things, nothing else:
1. clusters: [[id, …], …] — group the ones ONE build dispatch could deliver
   together: same surface, same flow family (field-validation variants, CRUD
   permutations on one entity). Every case still gets its own coverage
   declaration inside that unit, so group only what shares a setup path —
   when in doubt, leave it solo. One line of rationale per cluster.
2. verdicts: one per case — but FIRST read your contract, in this order:
   a. .agents/estimation/complexity-taxonomy.json — IF it exists, its tier
      names/definitions are THIS project's calibrated truth;
   b. else <skills root>/automation-scoping/references/complexity-taxonomy.md
      — the bundled tier definitions and modifier list;
   c. <skills root>/automation-scoping/SKILL.md § "The verdict pass" — the
      verdict field semantics and rules (~40 lines; read just that section).
   Then judge each case BODY against the tier DEFINITIONS — what interaction
   it actually exercises, never keyword-matching — and return per case:
   { id, tier, tier_rationale, steps, surfaces, new_abstractions, size,
     size_rationale, modifiers, quality_flags, risk_flags, signals,
     split_recommended, confidence }.
   If the automation-scoping skill is not installed (paths above missing),
   return clusters only and verdicts: [] with a one-line note.
```

Save the verdicts to `.agents/estimation/<slug>-verdicts.json` and let the script do the arithmetic (never price by hand):

```bash
node <skills root>/automation-scoping/scripts/score-cases.mjs \
  .agents/automation/<slug>/cases --verdicts .agents/estimation/<slug>-verdicts.json \
  --json --out .agents/estimation/<slug>-scored.json
```

`<skills root>` is the HOST's skills directory — substitute it before
dispatching: `.claude/skills/` on Claude Code, `.github/skills/` on Copilot
CLI, `.cursor/skills/` on Cursor (the host is named in
`.agents/team-comms.md`). The same substitution applies inside the dispatch
prompt above.

That file is what the close-time sizing join reads: per-case `size` columns, size-class deviation flags, est-vs-actual at batch grain, and the dataset-export fields (`size_tshirt` / `self_size` / `effort`) all come from it. **It is also the batch's screening and its exclusion budget:** a case the verdicts rule out closes `un-automatable` before any build (the verdict is the evidence), and every `un-automatable` exclusion in delivered code must trace back to these verdicts — the reviewer cross-checks them ([`coverage-contract.md`](coverage-contract.md)); an engineer cannot mint un-automatability the screening didn't see, only request it with an escalation to you. No automation-scoping skill installed → skip the verdicts half silently (clusters alone are still worth the dispatch); the pipeline degrades to reports without size columns, never to a failure. **A scoping-grade scope (20+ cases, a presales backlog) doesn't go through this single pass** — use the scoping skill's own mini-workflow instead (`automation-scoping/scripts/sizing.workflow.mjs` — parallel reader fan-out, same output files), and keep this Intake pass for the batch in hand.

Pass the clusters as `args.clusters`. **Do not `cat` the case files.** Field-measured on a live lead session: clustering by hand pulled **14 case bodies — 40,865 bytes, ~10K tokens — into the orchestrator's context**, more than its entire startup injection, before a single case was dispatched. The rule was written down, but in [`campaign-planning.md`](campaign-planning.md) § Clustering, which a flat batch never opens; that is why it is restated here, where Intake actually happens.

**Declare the session's work scope — now, while the work set is fresh.** Where
the `tokenomics` capture hooks are enabled (a session-start line names your
session id and the exact command), one call records what this session is for:
`node <tokenomics skill>/scripts/work-scope.mjs open --session <id> --intent
automation --batch <slug> --cases <the ids you just resolved>`. This is the
durable record every cost/delivery report joins on — declared before the first
dispatch, it survives a killed session; reconstructed afterwards, it is a
guess. On a host without the session-start line (older Copilot CLI), use
`--session auto`. A batch that grows mid-session: re-run `open` with the new
ids — it merges, never drops.

### 2. Run — one workflow, one unit at a time (not yours)

On Claude Code a batch runs through the canonical shipped script **by default** — a batch of one included; size is not the exception, wanting to supervise each step is — `scripts/workflows/batch-build.workflow.mjs`; see [`workflow-accelerant.md`](workflow-accelerant.md) (invoke it, don't re-author it). **This instruction is the standing explicit opt-in the Workflow tool's multi-agent gate requires** (a skill instructing the call is a sanctioned opt-in path; the operator opted in by installing the factory and handing you the batch) — do not re-litigate the gate per batch or ask the operator again. Fall back to sequential dispatches only for its § When NOT to use it (unseeded project, tool unavailable, or the operator asks to supervise step-by-step).

**The workflow and the hand-run loop are the SAME algorithm**, not two designs sharing a name. The script executes it deterministically; you execute it by dispatching. That is only true because nothing here runs concurrently — see below.

#### ONE TREE, ONE MASTER

> **Always return the tree to a known state, and always branch from it.**

Everything in this section rests on that one line. A single working tree has **one state at a time**, but slots need different ones — a runner or a merge wants the trunk, a reviewer wants the branch it is judging, a builder wants its own. No rule reconciles that; only ordering does.

So: **units run strictly one at a time, and nothing overlaps.** The trunk `tests/batch-<slug>` is the known state. Each unit branches from it, does its whole life on that branch, merges back, and leaves the tree sitting on the trunk for the next one.

An earlier revision ran exploration slots in parallel with builds and paid for it in the field: **eight `local changes would be overwritten by checkout` aborts** (one slot's surface digest against another's branch switch), merge conflicts concentrated in shared page objects, **90 conflict hits and three git-surgery rescues** in one session. Serialising deletes that entire class rather than guarding it.

**What serialising buys back is agent freedom.** Every prohibition the pipeline used to carry — exploration slots ran no git, wrote but never committed, never `git add -A`, the digest was read-only — existed only because a *second* agent might be in the tree. Alone, a slot commits and pushes its own work like anyone else.

**Throughput comes from clustering, not concurrency.** Units are the wall clock, so a cluster of 5 is one unit rather than five — a 4× reduction, against the 2× that exploration concurrency bought and every hazard above. **Cluster similar cases at Intake** and pass them as `args.clusters`, on flat batches too.

The one sanctioned fan-out is **read-only**: several reviewers on one *finished* diff (the opt-in `reviewPanel`), writing nothing, while no writer runs.

#### The loop, per unit

**Route** — policy first, evidence second. `.agents/testing.md § Execution provider` names who executes cases live: `manual-qa` (the manual-qa factory runs on this repo) or `self` (standalone) — seeded by scout, never guessed per batch. Per unit:

- **provider `self`** → **`combined`**, for everything.
- **provider `manual-qa`** — check the evidence: a PASS run record (`reports/RUN-*.md`, the case id showing Pass in its Results table; `reports/metrics/*.json` is optional corroboration — the metrics add-on may not be installed) AND the authored case file (commonly `tasks/<suite>/<ID>_*.md`) for **every** case in the unit → **`manual-qa-verified`**; anything less → **`needs-execution`**.

Evidence existence is a cheap disk check — fold it into the clustering+sizing dispatch or run the `ls` yourself; never absorb the run reports. When policy says `manual-qa`, self-execution is never the fallback — see the `needs-execution` rules below.

**`manual-qa-verified` — don't pay the live run twice.** The case was already executed live by the team whose job that is. One build dispatch derives the automation **from that evidence**: steps/expected from their case file cross-checked against the intake snapshot, selectors from the case file and the `.agents/manual-qa/` knowledge base treated as hints against the project's locator strategy (read-only), the manual-qa run id cited as execution provenance in the PR / Run Report. Run age does not matter; a FAIL/flaky/blocked run never qualifies — that unit routes `needs-execution`, and likely carries a defect. Thin evidence — steps without expected results, no groundable selector — is a `needs-execution` return from the builder, never an invention. The gate still proves the result N× green either way — the shortcut trades the live re-run, not the proof.

**`needs-execution` — the runner earns the evidence first.** Dispatch manual-qa's **`test-runner` per case**, on their exact contract: `Execute the test case at {file_path} against base_url={base_url}` — it executes step by step over Playwright MCP and returns one trailing ```json block (PASS/FAIL/BLOCKED, step counts + failure step, evidence paths). Then:

- **PASS** → proceed to build with that run as the evidence — cited as provenance, same as manual-qa-verified.
- **FAIL** → the defect route: unit outcome **`defect-found`**, defect filed per the defect-filing discipline (file and walk away), the case NOT automated until the defect is fixed.
- **BLOCKED** → unit outcome **`blocked`**; classify per § Handling blockers.
- **The dispatch itself fails** (agent type unknown on this host) → unit outcome **`needs-execution`** — a not-started sibling: the final report tells the user to run the manual-qa suite and re-run the batch. **NEVER silently fall back to self-execution when policy says manual-qa.**

**`combined` — the first green run IS the first execution.** Standalone doctrine: there is no separate "execute the full case before automating" ritual. The engineer builds the automation, and its first green run against the real system is the case's first live execution. Live browsing (Playwright MCP / `browser-verify`) is an investigation tool at the engineer's discretion — extract a locator, clarify a step, figure out why the direct approach fails — minutes of targeted probing, never a full walkthrough. Locator ladder, cheapest first: 1) `.agents/automation/surface/<feature>.md` (the surface cache); 2) manual-qa knowledge (`.agents/manual-qa/app_profile.md` § Reliable Selectors and § Fragile Areas) — READ-ONLY; 3) the case file itself; 4) targeted live probing. Everything learned live goes BACK into the surface cache.

A plan-declared **cluster** ([`campaign-planning.md`](campaign-planning.md) § Clustering) is one unit and one build dispatch over ≤ ~5 same-surface variants. The builder decides the output shape: **true flow-variants** get one parameterized spec with a data-table row AND a coverage declaration per case; cases that merely share a surface get **one spec each**. A case that diverges mid-build is ejected to solo.

**Build** — cut the feature branch **from the trunk** (`.agents/workflow.md` convention, typically `tests/<ID>-<slug>`). The trunk already carries every unit that finished before this one, so page-object and fixture work accumulates by *merge* rather than by branch lineage. Build per the `test-automation-implementation` skill: the delivered spec carries the coverage declaration ([`coverage-contract.md`](coverage-contract.md)), and what live probing revealed is written back to `.agents/automation/surface/<feature>.md` and committed by exact path on the branch — the cache lands even if the case ends `blocked`. Green ONCE locally, ≤ 2 reruns — determinism is the gate's job, not repeated local runs. Open the PR against the **trunk**, never against base.

**Review** — static, on that branch's diff. Then bounded fix rounds.

**The fix loop runs until the reviewer APPROVES.** It is not a budget for how much quality a unit is allowed. Dispatch a fix round with the blocking findings, then a FRESH review, and repeat. What ends it is the reviewer telling you another round cannot help — never a round count, and never your patience.

On each re-review, the reviewer classifies **every surviving blocker** ([`reviewer-contract.md`](reviewer-contract.md) § On a RE-REVIEW):

- **Any blocker still `unaddressed`** — nobody acted on it; the diff does not touch the code it names, or the change was cosmetic → **go round again**, and name the skipped items explicitly in the fix dispatch. A fixer handed a bare re-list reads it as new work and skips the same item twice.
- **Every blocker `persists`** (real attempt against the right code, still failing) **or `external`** (not resolvable on this branch) → **stop.** The obstacle is not effort. Record `blocked` and classify per § R2 cap rule.
- **…unless every surviving blocker is scoped (`case_ids`) to a proper subset of the unit's cases → split the unit instead** (once per unit). A grouped unit amortizes dispatch cost, and the price was fate-coupling: one policy-stuck case once stranded four merged-ready cases. The carve is one builder dispatch, and it **keeps sound work deliverable — quarantine, don't delete**. An almost-ready test whose *case* is stuck is a status problem, not a code problem: mark it skipped per project convention with a declared reason quoting the blocker and naming the unit/case id (family specs: mark just their rows), so the finished code **ships inert on the trunk and re-arms by removing the marker** when the blocker clears. This is the sanctioned exception to the masking hunt — the hunt targets silent skips beneath cases claiming `delivered`; a declared quarantine on a case recorded `blocked` claims nothing (the same "declared, not discovered" principle as a `blocked-by-defect` exclusion). **Removal is the fallback** for code the blocker itself condemns (masking, unsound): then the carve first records the branch head — `preserved@<sha>` leads the blocked note, with the removed paths — because once the unit merges that commit is in trunk history permanently, and re-entry **restores** (`git checkout <sha> -- <paths>`) instead of rebuilding. Either way shared symbols are removed only after a `git grep` proves nothing remaining uses them, and the shrunken unit goes back through review and merges as usual. Running by hand, the same moves apply.

The distinction is the whole point: *forgotten* and *impossible* look identical in a finding list and are opposites in what they demand. Stopping on "forgotten" ships a nearly-finished unit as `blocked` — neither delivered nor honestly stuck, and nobody goes back to it. Ask the reviewer directly; it is the only party that saw both rounds and the diff between them, and judging by the *wording* of findings just measures phrasing.

Two guards, and both are backstops rather than controls: a **round ceiling** (`fixRounds`, default 8) for a review/fix pair that has gone pathological — reaching it is a defect worth reporting, not a normal ending — and a **budget floor**, so one stuck unit cannot strand the batch. The shipped workflow encodes all of this; **running by hand, you are the loop, and the contract is identical** — same classification, same stop conditions, same ceiling.

**Merge back** — the approved unit merges into the trunk immediately (`git merge --no-ff`), pushes, and **the tree returns to the trunk**. A conflict is resolved only when it is a **mechanical union** (both-added imports, additive page-object members, independent files); anything semantic **parks the unit** — reviewed but not merged, `blocked`, its branch kept for re-entry. One hard rule, hand-run or scripted: **never delete, `rm`, or `--ours`/`--theirs` away a content file to make a merge pass**; destructive unblocking is how content files get lost.

Merging per unit rather than integrating at the end is deliberate. It keeps the trunk a known state for the next unit, surfaces conflicts small and while their author is still live, and means an interrupted run leaves the trunk carrying exactly the units that finished — which is what makes recovery a `git log` instead of archaeology. `batch-integrate.workflow.mjs` remains as a **repair tool** for re-merging a parked unit, not as a stage.

**Two memory layers — commit knowledge, keep role memory local (instructions § Agent memory).** Role memory (`.agents/memory/<role>/`) is each role's own working notes: **local and gitignored** — the ignore IS the protection (ignored files survive `git stash -u` and `git clean -fd`; the untracked-not-ignored era lost six entries to one wholesale stash, 2026-08-03). It is never committed and never assumed to exist on another machine. What DOES ship is `.agents/knowledge/` — cross-role, **verified**, durable facts promoted per the `knowledge-curation` skill: every slot commits its promotions **by exact path on the branch it is on**, the same commit-what-you-produce rule as code and the surface cache. When a unit **parks** on a semantic conflict, the merge agent lands its knowledge promotions anyway (`git checkout <branch> -- .agents/knowledge/`, commit, push) — the code may not land, but what we learned always does. The lead's close sweep curates both layers: local memory via the `memory` skill, the shared layer via `knowledge-curation`.

*Why this rule replaced its predecessor.* The old rule — "role memory never rides a case branch; workers report via `findings[]` and the lead records at close" — existed because field measurement (cov60) found **26 of 32 merge conflicts** were add/add collisions in `MEMORY.md`/`daily/*.md`, from **parallel** case branches cut off one base each creating the same file. Serialization removed the cause: unit N+1's branch is cut *after* unit N merged, so it inherits N's memory and appends — a modify, never an add/add. The old rule's residue was worse than nothing: workers (whose preloaded memory skill says "write what you learn") wrote anyway, the entries sat **untracked for the whole campaign**, and one wholesale stash (field incident 2026-08-03) swept six of them mid-wave while every later agent ran without them. One scoping rule survives from that era: mechanical self-check greps run against the project's code root (e.g. `-- automation/`), never the whole tree, so memory prose can't pollute a diff scan.

**A known defect is declared, not masked — and declared in the coverage grammar.** A step blocked by a filed defect is excluded `blocked-by-defect: <TICKET>` in the spec's coverage block ([`coverage-contract.md`](coverage-contract.md)): the rest of the case automates with `coverage: partial`, the spec stays honestly green (the excluded step is not asserted, and the review verified the ticket), and the TMS back-write carries the exclusion. A defect that blocks the whole case is the **`defect-found`** outcome — defect filed, case not automated until the fix ships. Either way the masking catalogue (`test.fail()`, skip markers, weakened assertions) stays forbidden: the declaration is checkable, the mask is not. A permanently-red test in the batch would also block every healthy case beside it at the gate — measured on one batch, a single ticketed defect held four other cases red — which is exactly what the exclusion form avoids. When the defect ships, removing the exclusion re-arms the step; re-entry is ticket-driven, not next-batch-driven.

#### Gate — the merge signal

Once every unit has had its turn, the trunk carries the batch. Gate it, and gate it **twice over, with two different counts**:

- **The batch's new/changed specs, N× consecutive GREEN** (§ Merge gate, default 3), each a clean process against the live env. New code is unproven, so repetition is what catches a flake. Within each run, use the framework's own parallel workers where the env allows — that is a *stronger* gate, not a shortcut, since it surfaces parallel-interaction flakes a per-case run never sees.
- **The specs this batch could have BROKEN, once.** Already-proven code needs one run to reveal a regression, not N. Scope by **what changed, not what was touched**: read the batch's non-spec diff (page objects, fixtures, helpers, config) hunk by hunk, however this project diffs — git, the PR view, or on a VCS-less project the change list in the briefs. A purely **additive** hunk — a new method, handle or constant that nothing existing calls — has no blast radius: new code cannot break a spec that never calls it. A hunk that **modifies or deletes** existing behavior names an impacted *symbol* (diff hunk headers show the enclosing function); the impacted specs are the ones that *reach* that symbol — search by symbol name, one hop through shared helpers — never "every spec importing the file". Measured live on an 11-case batch: import-level selection swept 57 tests where the truly impacted set was a handful, and the gate agent stalled on the runtime. Import shuffles and formatting are no-ops. Run the set once, selected by node-id/spec. All-additive → no blast radius; say so. A modified symbol in a base class or fixture everything reaches makes the big set *real* — report its size and estimated runtime and hand the lead the run-vs-sample decision instead of silently burning an hour.

**Plus the grammar check — the gate's mechanical half of the coverage contract.** Before the runs, grep the batch's specs for the coverage grammar ([`coverage-contract.md`](coverage-contract.md) § Enforcement): a coverage line exists for every case id the batch claims, excluded lines parse, categories are from the closed vocabulary. A grammar miss fails the gate like a red run — it means a delivered spec cannot say what it covers.

The gate is a **separate agent inside the run** — not the builder (who would be certifying their own work) and not you. That placement is deliberate and was measured: a hand-run gate drained 12 cases while the pipeline delivered 36, at 3h50m and 114 shell calls for 8 merges. Its mechanics are scripted (`scripts/gate/gate-case.mjs` — fetch, checkout, merge base, run N× with timings, verdict); three rules it encodes each cost real time when left to memory:

- **Merge the base FIRST, then gate.** On a busy campaign the base moves under every merge, so a run against a branch that lacks base proves nothing about what will land — gate runs had to be discarded and redone for exactly this.
- **Gate in this checkout, on a branch — no worktree.** The real tree already has the env file and installed dependencies a worktree would lack. Dirt is judged **precisely, not blanketly**: `gate-case.mjs` refuses only a dirty path among the files it is proving (the base…branch diff) or one git itself refuses to overwrite (named by exact path); unrelated noise — logs, other factories' state, installer-touched configs — never blocks and is booked in the verdict as `carriedDirt`. Leave the tree on the trunk when done.
- **The gate does not merge, classify, or fix.** A red ends the attempt and goes into the report. Classifying it is yours (§ 3).
- **One run per call — never all N in one process.** `gate-case.mjs --n 1`, foreground, `timeout: 600000`, repeated N times with the consecutive-green count kept by the agent. `--n <N>` runs them back-to-back inside a single call, and a foreground call cannot exceed 600s: on a real UI batch N=3 is 12–19 minutes, so the call is killed and the agent is stranded holding a suite that is still running. Measured across seven waves: both gates that passed cleanly ran one run per call; all three that failed used one long call. If even a single run doesn't fit, launch it detached and wait with blocking `sleep 300` polls (§ Never idle on a background job).

**A gate cut off mid-flight is `incomplete`, not `not-run`.** They read the same in a report and mean opposite things: `not-run` is "nothing was attempted", `incomplete` is "runs are banked and here is where to resume". Both leave their units `merged-ungated` — unproven, never `blocked` — but only `incomplete` tells the next reader whether one run remains or all N. Whichever it is, when you then run the gate yourself and it goes green, **write that verdict back into the report** (§ 3 Close → Write the verdict back): the recovery isn't finished until the receipt matches it.

**Report** — one write, at the end: `.agents/automation/<slug>/report.json` and `report.md`. One row per input case with its outcome, note, findings and its `coverage` record (`{ full, excluded: [{step, category, referent, note}] }` — lifted from the delivered spec's declaration), plus the gate verdict and anything parked. This is the only disk write the run makes.

### 3. Close — read the report, act on it (yours)

Read the report, not the transcript. Then:

**Merge ONE PR: the batch trunk into base.** Two branch levels, and the second is the one that lands. Case branches live under `tests/batch-<slug>` and their PRs target it; the trunk is what the gate proved, so the trunk is what merges. Read `.agents/profile.md` § Automation PR policy first — base branch; merge policy `auto-merge` / `human-approved` / `manual`; strategy `squash` / `rebase` / `merge` (absent → default `auto-merge` + `squash` + the default branch, flag the gap). Confirm the PR is `OPEN`, checks green, base matches, and every case PR under it is merged or closed; under `human-approved` merge only on the human signal, under `manual` skip and post a summary.

Why one and not N: gating the trunk and then merging case PRs individually **proves one object and ships another** — the gate ran the batch's specs together, against one base, in one tree; N separate merges reassemble that from parts nobody proved in combination. It also means an interrupted close cannot leave base half-landed. A batch of ONE degenerates: no trunk, the case branch targets base directly, one PR either way.

**Route the findings.** They are orthogonal to the outcome — a case can be `delivered` and still have produced a `defect`. Nothing about the outcome cancels a finding, and a finding never downgrades a green case (§ Outcomes).

**Handle a red gate.** Classify it — product defect / flake or test-code bug / architectural — then route per § Handling blockers. For a flake or test-code bug the answer is the **stabilize workflow**, not per-case fix dispatches: `scripts/workflows/batch-stabilize.workflow.mjs` diagnoses ALL the failures together before fixing anything, because the gate runs the specs together precisely to surface failures a single-spec run cannot produce — so its unique failures are batch-level by construction. Three separate fix dispatches see three symptoms and never assemble the picture.

**Write the verdict back — before the closure comment, not "later".** Any gate that runs *outside* the workflow's own report write — a re-run after `merged-ungated`, a stabilize round's re-gate, a gate you re-scoped and ran yourself — updates `.agents/automation/<slug>/report.json` **the moment it has a verdict**:

1. `gate.verdict`, `gate.runs`, `gate.seconds` — what actually ran.
2. Each affected case's outcome: `merged-ungated` → **`delivered`** on green. The workflow could not know — it had already written the file and gone.
3. Only then the closure record / tracker comment. A closure comment claiming green over a report saying `not-run` is the exact state that keeps happening.

The report is the machine-readable receipt every audit, `--resolved-from`, and the next batch's plan divides by. **This is the single most-repeated miss in the pipeline, and prose has already failed to fix it twice.** Measured on an 11-case batch: a lead-run gate went 3/3 green and merged 11 cases while the report still said `not-run` / `merged-ungated` — zero delivered in the next rollup, 11 proven specs recorded as unproven. Measured again three days later, *with this paragraph already installed*: it recurred three more times in one campaign, and **38 of 69 delivered cases (55%)** were misrecorded or had no receipt at all. So treat it as a hard step with a verification, exactly like the close sweep's read-back: after writing, re-read the file and confirm the totals match what you merged. Recovering the gate without correcting the receipt is half the recovery — and the half nobody can see.

Two records back this step up — use them, don't rely on them replacing it:
`gate-case.mjs` already appended every verdict to
`.agents/automation/<slug>/gate-runs.jsonl` the moment it existed (script-
authored — check it when reconstructing what actually ran), and where the
`tokenomics` scope contract is active, **record each case's outcome the moment
it becomes true**, not at "the end": `work-scope.mjs outcome --session <id>
<ID>=automated` after the write-back, `<ID>=blocked` when you classify a
blocker, then `work-scope.mjs close --session <id>` after the close sweep.
**Close generates the batch report** — it recomputes `cost.json` and renders
`.agents/automation/<slug>/batch-report.md` + `.html` (delivered, per-case
cost, overhead), cross-checking receipt vs records and printing a **DRIFT**
warning when they disagree. Drift at close is the miss detector for this
exact paragraph: fix report.json and re-run `close` — the render is
idempotent.

**Then publish it — per policy, by dispatch, never by hand.** Read
`.agents/profile.md` § Reporting policy: absent or `none` → the files in the
repo ARE the report, flag the missing policy in your closure note and move
on. A named destination (`tracker-item` / `pr-comment`) → dispatch the
**publisher** (§ Canonical dispatch templates) — a cheap-tier agent that
reads the ALREADY-ASSEMBLED `batch-report.md`, posts per the policy's format,
and returns the URL as evidence. Two rules keep this lean: the publisher
never assembles or recomputes anything (the script did — an agent re-deriving
numbers is spend without trust), and you never paste report contents into
your own context to post them (that is the exact inflation the dispatch
exists to avoid).

**Then ONE close sweep:** back-write the TMS for every merged and parked case — the automation execution (gate outcome) via `update_execution`, plus the case's coverage note (`full | partial` and the excluded steps with categories/referents) and the PR link; manual-qa's live runs are their own record, never yours to write ([`tms-adapters.md`](tms-adapters.md) § Dual-write policy) — and transition the tracker (while there, compare each case's live TMS body against its intake snapshot — in-repo sources: `git log -- <path>` since intake — an author edit mid-batch is a drift flag for the next batch, not a silent skew you absorbed), then **ONE** read-back — this batch mutation across >1 tracker item must be followed by an explicit read-back: re-fetch every affected item, diff against the expected-state map you wrote *before* the mutation, report mismatches. Only then claim "complete" (load `verification-before-completion`).

**Then close-out cleanup.** You decide what merged; the script only refuses. Ask the host in `.agents/workflow.md` § Host (`gh pr list --state merged`, `glab`, `az repos`, the API), then hand the answer in — `--merged` is required and has no fallback probe, because a script that guesses the host guesses silently:

```
node scripts/cleanup.mjs --report .agents/automation/<slug>/report.json \
  --merged <branches that merged>|@file          # dry-run: review the plan
node scripts/cleanup.mjs --report … --merged … --apply [--remote-delete] [--also wave1,wave2]
```

Nothing is deleted without a merged claim naming it, the checked-out branch is never touched, and `--remote-delete` is only for flows that don't auto-delete remote refs (the remote itself is discovered from `git remote`, `--remote` overrides). An empty `--merged` is a valid answer — "nothing merged yet" — and authorises nothing. It deletes a branch only when a **merged PR** names it — the report contributes branch names, the PR state is the authority. Where they disagree the PR wins: a board once had 4 of 12 merged cases mis-stated, and deleting a branch on a wrong claim is unrecoverable.

**Then replan the remainder.** Everything not `delivered` or `un-automatable` or `defect-found` (ticket-driven re-entry) is next batch's input. That is the whole recovery mechanism — there is nothing to reconcile first.

**What the batch cost.** The report is also the denominator: `efficiency-audit`'s `usage-rollup.mjs --resolved-from .agents/automation` reads these same `report.json` files and divides metered spend by them, so cost per case is measured rather than remembered. Scope it to the run (`--since`/`--until`) — it reports how much of the window's spend it can tie to this batch's branches, and a window holding a quarter of unrelated work will say so rather than quietly inflating the figure. Two numbers come back and both are worth carrying release over release: **per spec delivered** and **per case examined**. A batch where six of twenty cases automated spent real analysis on the other fourteen, and only the second number admits it. Where the `tokenomics` skill's capture hooks are enabled, the same spend also lands in the git-committed ledger (`.agents/telemetry/automation/`) as each session ends — its `team-report.mjs` joins that ledger to these receipts, so the per-case figure stays answerable after transcripts expire and across the whole team.

### The same loop runs work that isn't a case

Cases are the common instance, not the shape. Atomic fixes, batched fixes, framework improvements, a suite-health sweep, a tech-debt batch — all of them plan → run → close identically; only the *investigation* step differs (reproduce a failure or read the code, rather than execute a case). Investigate → change → review → merge → prove is the same skeleton, and the outcome vocabulary already fits (`delivered` = proven and landed; `blocked` = it didn't). `batch-stabilize` is the shipped instance of that: same skeleton, a diagnosis step where the investigation step would be. When you need a shape the shipped scripts don't have, author it per accelerant § Extending — the invariants ride along.

**Intake is still yours — there is no adapter for this.** Technical work arrives as a prose ask ("finish the stable-handle migration"), a tracker item, or a sweep request ("work everything under the tech-debt label"). Resolve it the way the seed says — `.agents/profile.md` names the tracker and task source, `workflow.md` the conventions — using the project's own tools (`gh`, an MCP server, the tracker's API). Then the same context frugality as case intake: snapshot each item's body to `.agents/automation/<slug>/items/<id>.md`, keep only id + title in your context, keep the source ref for the close sweep's back-write. Use **tracker-shaped ids** (`TD-123`, a JIRA key) as the unit ids — telemetry attribution keys on them; a freeform slug survives only the workflow path (receipts carry it), not a hand dispatch (see tech-task-brief.md).

**Classify before planning.** The taxonomy already exists: a merged test newly red or flaky → § Suite health / maintenance entry; anything reshaping conventions or primitives → § Framework architecture (plan first, `.agents/testing.md` updated); everything else — a bounded change with a definable blast radius — is a **technical unit** for this loop. A batch may mix kinds; the planning discipline may not.

**Plan each unit as a tech-task brief** — the unit contract for work with no case ([`tech-task-brief.md`](tech-task-brief.md)): source, scope enumerated from the actual code, out-of-scope named, acceptance criteria, blast radius, verification. The brief sits where the case sits in the reviewer's walk (source ↔ brief ↔ diff) and defines the gate's run set; a brief missing a required section is `blocked`, not dispatchable. For a batch, end the plan with a **verification unit named after the hazards the batch created** ("the old fallback handle still works where the new one doesn't exist yet; nothing asserts on the fields the change removed") — never "run the tests". Hazards are the *output* of planning the rest, so that unit is written last.

**Run and gate — one difference.** Build → review → fix rounds → merge on the trunk → ONE hardening gate; every invariant rides along unchanged. The gate's N× set is whatever the batch changed or could have broken: the union of the briefs' blast radii plus any new or changed specs — after the change, "already-proven" no longer applies to them, so they get the full N×, not the single regression pass. On Claude Code, until a shipped script covers this shape, fork per accelerant § Extending (copy `batch-stabilize`, the shipped non-case instance); on other hosts, sequential dispatches as ever. The close sweep back-writes the **source item** (comment, close, label — per the seeded write policy) instead of a TMS execution, with the same read-back discipline.

**Headless changes nothing.** An invocation from CI or a trigger (`claude -p`, a scheduled job, an automation rule) is just the channel the ask arrives on: same seed, same contracts, same one report. The only behavioural difference falls out of the existing rules — a `blocked` unit parks with its question filed on the tracker instead of asked live. That is the whole unattended posture; there is no separate mode to design.

**A repo with its own execution board.** Some projects carry their own agentic planning/execution machinery — a board directory with its own planner and executor skills (an `.octobots/` tree, for example). There the board is the plan of record: fill your role inside *its* loop — its workflow steps dispatch this factory's agents by name — and do not run a second board or duplicate its state. Standalone, the no-board doctrine stands (§ Where state lives).

## Outcomes — what a run says about a case

Seven terminal outcomes. They say **where a case ended**, not which state machine step it reached — there are no transitions, nothing to validate, and nothing to keep in sync mid-run:

| Outcome | Means | Your move |
|---|---|---|
| `delivered` | built, statically reviewed, and proven by the gate's N consecutive greens — coverage `full`, or `partial` with declared exclusions | merge + mirror; the coverage note rides the back-write |
| `defect-found` | live execution (the runner, or the combined route's first green attempt) hit a product defect that blocks the case | defect filed per the defect-filing discipline (file and walk away); the case re-enters when the fix ships — ticket-driven, not next-batch-driven |
| `blocked` | something about THIS CASE stopped it — data, access, env, a conflict, a red gate, an R2 cap | classify per § Handling blockers, replan |
| `un-automatable` | the screening verdicts rule the case out (complexity taxonomy) | close with the verdict as the note; do NOT re-dispatch |
| `needs-execution` | policy says manual-qa executes, no qualifying evidence exists, and the runner could not be dispatched | tell the user to run the manual-qa suite and re-run the batch; the case re-enters untouched |
| `not-started` | the run never got to it, for a reason that is not about the case — budget, account ceiling, breaker, or a dispatch that died on the harness (a 403, an interrupt, a killed session) | it is simply next batch's input |
| `infra-stalled` | the harness killed the slot mid-flight — the model stream stopped making progress and every retry stalled the same way; the case itself was never judged | an ENVIRONMENT failure: check provider throttling (tokens/min quota, stream stability) before re-dispatching anything; the case re-enters the next batch untouched — but check its unit branch for checkpoint commits first |

A case the intake sweep screens out — the author marked it not-actionable, or a merged spec's coverage declaration already claims it — never enters the run at all: it closes at intake per project convention, with the author status or the covering spec named as evidence.

**`blocked` vs `not-started` is "whose problem is it".** A case whose own environment, data or code stopped it is `blocked` and needs its blocker cleared before anyone re-dispatches it. A case whose dispatch died *for reasons that have nothing to do with it* — the account ceiling, an auth 403, an interrupt — is `not-started`: nothing was learned about the case, and it re-enters the next batch untouched. Re-dispatching a `blocked` case at the same wall wastes a slot; treating a harness death as `blocked` invents a defect that was never observed. **`infra-stalled` is `not-started`'s louder sibling**: the same "nothing was learned", but the death has a name — the model stream stalled under the slot — and the remedy is specific: fix the provider (quota, stream) before spending another dispatch, and look at the unit branch first, because a checkpointing worker may have landed partial work a retry can continue (see § A dispatched slot that stalls).

One more appears **only in a report rebuilt from an interrupted run** (§ Interruption): `built` — a case whose branch exists but never merged. It is not a status you manage; it is how far the evidence goes, and it sits in the **remainder** (it is not terminal), so it feeds the next batch like anything unfinished.

**A close that the evidence contradicts is not a close.** Two verdicts drop a case without code landing: a screening `un-automatable` and a dedup ("a merged spec already covers it" — at intake, or as a `covered-elsewhere` exclusion in delivered code). A wrong one silently closes a real coverage hole — the most expensive error this vocabulary can make, and the least visible. When rebuilding a report, spend the one check that falsifies it: a dedup must name a covering spec that **exists in git on base**, and asserts the same observable. If the citation resolves to nothing, the case is `blocked` with a finding saying the dedup was unverifiable — never closed on an agent's word alone. (The reverse error is cheap: a redundant test is visible and deleted in a minute.)

**In a rebuilt report, a merge IS the whole chain.** § Outcomes defines `delivered` as built + reviewed + gated, and a recovery usually has no reviewer or gate receipt to show. That is not a downgrade: a merged PR/MR means the work passed whatever this project requires to land, which is a stronger fact than any receipt. A case merged to base is `delivered` in a rebuilt report, and the `recovery` note (below) is where you say the proof came from the merge rather than from a gate verdict you witnessed.

**`findings[]` is orthogonal to the outcome.** A case can be `delivered` and still carry a `defect` that didn't block it, a `clarification` the author owes, a `question`, or a `note` — those four `kind` values are the whole enumeration, and anything that does not fit is a `note` with the detail in its text. Each finding names its kind and, where it has one, a ref. This is the channel that used to be missing: previously a green case with a defect had to be forced into an exception status that read as "this failed", so the honest thing to do was drop the observation. Now the case reports `delivered` **and** the finding rides along — you route the finding, and the green stays green.

## Where state lives

Three places, each with one owner, and none of them is a board:

| What | Where | Written by |
|---|---|---|
| Case bodies | `.agents/automation/<slug>/cases/<ID>.md` | you, at Intake — once |
| The run's outcome | `.agents/automation/<slug>/report.{json,md}` | the run, once, at the end |
| Per-agent ground truth | `journal.jsonl` in the run's transcript dir | the runtime, continuously *(workflow runs only)* |
| Delivery proof | merged PRs + branches + coverage declarations on base | git / the PR host |
| Campaign plan + checkpoints | `.agents/automation/campaigns/<slug>.md` | you ([`campaign-planning.md`](campaign-planning.md)) |

**Without a workflow, git carries it.** A batch run as sequential subagent dispatches — any non-Claude host, a batch of one, an atomic fix, or an operator supervising step by step — produces no journal, and the report is written by *you* at close rather than by a report agent. Nothing else changes, because the durable evidence was never the journal: a **branch** means the case was built, a **merged PR** means it landed, and the spec's **coverage declaration** says what it covers. Git wins over any journal or receipt wherever both can answer, since a merged PR is a fact and an agent's return is a claim.

The report you write by hand is the same artifact the workflow's report agent writes, and everything downstream reads it as one: `cleanup.mjs` takes candidate branch names from it, and `efficiency-audit --resolved-from` takes the delivery count. Only `cases[]` — an `id` and an `outcome` per row — is load-bearing. Record `branch` where you know it and the audit can also check whether the spend it is dividing actually belongs to this batch; leave it out and it says the check did not run rather than guessing.

The journal is a convenience on the workflow path (it recovers *why* a case stopped, which git can't show), not the foundation. Which is also why dropping the board cost the sequential path nothing: the board's own contents were only ever a slower, driftable restatement of git.

**Why there is no board.** A board records progress, and progress only needs recording if something reads it mid-run. Nothing did. The workflow held its own state in memory; resume replayed from the runtime's cache, not from the board; the lead read the board only at the end — which the report answers directly. What the board added was cost and a second version of the truth: every transition was a clerk dispatch, and the clerk existed only because a workflow script has no filesystem access. Field-measured, it was also **wrong**: on one campaign 4 of 12 merged cases still sat at `approved-static`. A report generated from what actually happened cannot drift from what actually happened.

The campaign card survives because it is not a state machine — it is the plan, the operator's approved checkpoint, and the goal metric per wave. Nothing derives it, so it has to be written.

## Interruption and resumption

An interrupted run — crash, kill, API limit, context death — loses nothing, and you never reconstruct it by reading a transcript.

**If the run can resume, resume it.** Re-invoke with the SAME scriptPath and args plus `resumeFromRunId`: every completed `agent()` call replays from cache (including live runner/browser sessions), and only the failed call onward runs live. Resending the full `cases` array costs nothing. **Write the runId to disk the moment the Workflow call returns it** — the campaign card for a campaign, `.agents/automation/<slug>/` for a flat batch — because a runId that lives only in the conversation does not survive a compaction.

**Editing the script first voids the cache from the first changed call.** The replay cache keys on each `agent()` call's exact (prompt, opts) — patch the workflow script (or anything its prompts interpolate) and every call whose text shifted, plus everything after it, runs LIVE again. Field case (2026-08-17): a lead patched a dispatch prompt, resumed, and reported "cached, replaying" while a fresh worker re-ran a ~25-minute live browser pass — the money was already spent when the journal said otherwise. After a script edit, expect re-runs from the earliest changed stage, say so in the checkpoint instead of promising a replay, and check the run's journal (`started` without a cached result = live) rather than assuming.

**An operator pause is the same case, pre-packaged.** Pausing a workflow (the TUI's `p`) and unpausing ENDS the run, and the harness appends the exact resume call — scriptPath, runId, args — to the session. Invoke it as given; the agent that was mid-flight when the pause landed re-runs from its start (only *completed* agents cache), which the dispatch prompts are built to survive (branch-exists judgement, committed checkpoints). Two constraints ride along: resume in the **same session** that launched the run — its journal and cache live under that session, and a fresh session has nothing to replay (there, use the reading recovery below) — and **do not update the installed factory between pause and resume**: the cache is keyed on exact prompts, so a changed script re-runs every unit live from the first changed call onward. Finish the run on the scripts it started with; update after.

**If it cannot resume, recovery is READING, not archaeology.** There is no recovery script, and deliberately so: reconstructing a batch means knowing this project's branch naming, its case-id shape and which system holds "did it merge" — conventions a script can only hardcode and get wrong. (One did: it matched case ids with a fixed `UPPERCASE-digits` regex, so a project numbering cases `12345` or `tc-050` got a confident, empty answer.) You read the seed; you already know. Work the four sources in order — each is cheaper than the next, and the last is the one that cannot lie.

**1. Receipts — the structured returns, already on disk.** On Claude Code this factory's `SubagentStop` hook writes every workflow agent's structured return to `.agents/telemetry/automation/returns/<run-id>/<agent-id>.json` as it completes, free, with no dispatch (legacy `_returns/` in repos without the telemetry area — check both). That IS the inter-stage state the run was passing along, persisted:

```json
{ "run_id": "wf_…", "agent_id": "a1b2c3", "agent_type": "test-automation-engineer",
  "shape": "structured" | "text", "recorded_at": "…", "result": { …the agent's actual return… } }
```

Read the newest run's directory and sort by `recorded_at`. Identify each receipt by the SHAPE of `result`, not by `agent_type` — `test-automation-engineer` fills the build, reviewer and gate slots, so the agent name cannot tell them apart, but the schemas can: a `result` with step counts + failure step is a runner; `blocking`/`blocking_detail` a reviewer; `status` + `branch` a build; `smoke_spec` the foundation; `waves[]` the plan; `verdict` + `runs` a gate; `integration_branch` + `merged`/`parked` the integrator. Later wins for the same case.

**`shape: "text"` is the most actionable line in the whole recovery.** A schema'd slot that ended in prose never reached its structured return — it died, was interrupted, or errored — and its text usually names the cause ("API Error: 403", "Request interrupted"). Those are exactly the dispatches to run again, and the cases they were working are `not-started`, not `blocked`: the harness died, nothing was learned about the case. Measured on one real run: 4 of 13 receipts, matching two 403s and two interrupts.

A dead receipt often does not say which case it was on — the text is whatever the agent last wrote. Read the case ids out of that text where it names them; where it doesn't, the unaccounted-for cases are the ones with no other evidence, and they are `not-started` anyway. Don't over-work this: the outcome is the same either way.

**2. The journal**, where the run produced one: `journal.jsonl` in the run's transcript dir holds every agent's full return. Same information, more of it, and it survives when receipts do not (an older run, a host without the hook). Scope it to THIS project's transcript directory — short case ids collide across repos, and a journal from another project will slot in silently.

**3. Git — the part that cannot lie.** A **branch** means the case was built; a **merged PR/MR** means it landed; the merged spec's **coverage declaration** says which case ids it claims. Ask the host recorded in `.agents/workflow.md` § Host with its own CLI (`gh`, `glab`, `az repos`, the API) — that choice is yours to make, which is precisely why no script makes it.

**When the host cannot answer at all** — no CLI, no remote, no auth — fall back to git's own ancestry: `git branch --merged <base>` names every branch already on base, which is the same fact a merged PR reports, minus the PR number. Note in the report that PR state was unconfirmed, and treat a receipt-claimed `pr` as a claim rather than a verified fact. Beware the inverse: a host that is merely *unreachable* often answers identically to "nothing merged" (an empty list, exit 0), so an empty answer you did not verify is not evidence of anything.

**4. Your own judgement, which none of the above has.** Receipts and journals record what an agent *said*; git records what happened; neither knows what it means. A **CLOSED, unmerged PR is an abandoned attempt**, not work in progress — reporting it `built` sends the next reader to a dead diff (measured: a case reported `built` on a closed PR, and another reported a stale PR number while its live one was open). A branch may predate the run you are resuming. A surface-cache entry proves probing *happened*, not that it is still accurate. Rank the evidence when it disagrees: **merged beats open beats closed**, and git beats any claim.

**Then write the report** — the same `.agents/automation/<slug>/report.{json,md}` the run would have written, and everything downstream reads it as one. Only `cases[]` is load-bearing; fill what the evidence supports and leave out what it doesn't, rather than inventing a gate verdict you never saw:

```json
{ "batch": "<slug>", "base": "main",
  "cases": [
    { "id": "TC-1", "outcome": "delivered", "branch": "tests/TC-1-modal", "pr": 41,
      "coverage": { "full": true, "excluded": [] },
      "note": "merged to base", "findings": [] },
    { "id": "TC-2", "outcome": "blocked", "note": "dedup unverifiable",
      "findings": [ { "kind": "note", "note": "covered-elsewhere cited login.spec.ts:42; no such file on base", "ref": null } ] }
  ],
  "totals": { "delivered": 1, "blocked": 1 },
  "remainder": ["TC-2"],
  "recovery": { "rebuilt_from": ["receipts", "git"], "note": "no gate receipt — proof is the merge; PR state unconfirmed (no host CLI)" } }
```

A finding is `{kind, note, ref}` — `kind` from the four above, `ref` a tracker id or `null`. `totals` counts every row including the non-terminal ones, so it always sums to `cases.length`. `remainder` is optional (any reader can derive it) but worth writing: it is the thing the next batch consumes. The `recovery` block is the honest part — a rebuilt report is evidence-derived, not witnessed, and the next reader deserves to know which, including anything you could not confirm. Feed the remainder — everything not `delivered`, `un-automatable` or `defect-found` (its re-entry is ticket-driven, not batch-driven), which includes the partway state `built` — to the next batch. Where a case is both partway and stopped, the stop wins: record `blocked` and keep the `branch` on the row.

The `report.md` twin is the same data rendered for a human: a totals line, a table of case id / outcome / note, findings grouped by kind, then the gate verdict with its timings (or a line saying there was none).

**Write it once, then leave it alone.** The report is a record of what happened, not a status you keep updating. A document that gets rewritten as work moves is the board that was deleted for drifting — field-measured at 4 of 12 merged cases mis-stated — and it will drift again. Recovery output is derived on demand and thrown away; only the report persists.

**The remainder is the plan.** You don't repair state, you replan what's left.

## Critical orchestrator rules

1. **Dispatch IS the work.** Any **routing** turn's reply MUST contain at least one subagent dispatch, in the exact form `.agents/team-comms.md` documents for this host (Claude Code: an `Agent` tool call). Narrating intent without emitting the dispatch in the same reply is a failed turn — the subagent never runs. Self-check: every routing sentence needs a matching dispatch call. See § How to dispatch a subagent.

   **A reading turn is not a routing turn.** Recovery (§ Interruption), reading a report at close, and answering the operator's question are turns whose deliverable is an *answer* — they end in a written artifact and a recommendation, and forcing a dispatch into one is the failure this rule is aimed at, inverted. The rule binds the moment you decide work should happen: decide and dispatch in the same reply, never decide now and dispatch next turn.

2. **No defect masking — the dispatch prompt is the gate.** This enforces the builder-side rule in [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md) § Hard Rules → No Defect Masking (the full forbidden catalogue + reverse-masking guard). Load-bearing at dispatch time: `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, weakened assertions for product defects. When live execution or the test hits a product defect:
   - **No ticket yet** → the engineer files the defect FIRST (defect-filing discipline — pristine repro, file and walk away), THEN applies the below.
   - **Defect isolated to one step** → exclude that step `blocked-by-defect: <TICKET-ID>` in the coverage block; the rest of the case ships `coverage: partial` (§ The loop — a known defect is declared, not masked).
   - **Defect blocks the case** → outcome `defect-found`; the case is not automated until the fix ships.
   - **`test.fail()` is never the answer.** A draft prompt containing "add `test.fail()`" → stop and rewrite.

3. **Coverage is contract law.** Every delivered spec carries the coverage declaration — case id in the test identity, every case step asserted or excluded in the fixed grammar, categories from the closed vocabulary with their referents ([`coverage-contract.md`](coverage-contract.md) — single source of truth). Your slice: the reviewer walks it (silent gap = blocking; referents touched; `un-automatable` exclusions cross-checked against the intake verdicts), the gate greps it, and the close sweep back-writes it (`full | partial` + excluded steps). A unit without a parsable declaration is not `delivered` — it cannot say what it covers.

4. **Act, don't ask** — proceed with the obvious default; carry unknowns as findings and tracker entries. Before any `AskUserQuestion`, run the three-test filter:
   - Documented default in `.agents/profile.md` / `.agents/workflow.md`? → **use it.**
   - One option strictly safer / more reversible? → **pick it.**
   - Cost of being wrong < cost of waiting? → **proceed.**

   Ask only when all three hold: no documented default, genuinely irreversible (history rewrite, force push, secret rotation, production change), AND multiple defensible options with materially different consequences you can't evaluate. Otherwise pick, record the open question as a `question` finding, continue.

5. **Deduplicate before routing.** The last report plus the tracker are the source of truth for what has been done, not your memory. Intake dedups against merged specs (their coverage declarations name their case ids) and the tracker; a case that a previous run already reported `delivered` is not re-run. A comment or card showing a role already claimed it → don't duplicate.

6. **Scope is set by the user, not the agent.** When work exceeds the literal ask — one ticket becomes a folder, a fix becomes a framework upgrade — STOP. Surface it in one paragraph: *"you asked for X. I see Y. Should I take that on?"* Wait for a quotable authorization before the first dispatch on expanded scope. **Never assert "the user authorized X" later without the turn it traces to.** Rule 4 governs in-scope tactics; *scope-of-the-act* belongs back with the operator. Self-check before a batch dispatch: about to launch ≥N subagents on work the operator didn't name? Surface first.

7. **Context frugality — orchestrate, don't absorb.** Your context is the batch's scarcest resource; spend it on plans, dispatches, and verdicts. Payloads stay where they lie — case bodies in the intake snapshots, diffs in the PRs, run logs in the runner's structured report, per-agent detail in `journal.jsonl`: *you* read conclusions, *slots* read payloads. Multi-file surveys, suite spelunking, and log-diving are dispatch material — route them to a subagent that returns a digest. And prefer the shipped workflows over conversational choreography: every hand-run dispatch AND return costs a full orchestrator turn re-processing your whole context (accelerant § Why bother) — on Claude Code the workflow replaces those turns with script code, which is why it's the default, not a luxury. Self-check before any large read: does a slot, script, or workflow already produce the conclusion I need?

> **Note on framework-code edits:** the orchestrator does NOT `Edit`/`Write` test framework code (`tests/**`, the abstraction layer — `pages/**`, `fixtures/**` — and framework config: `playwright.config.*`, `pytest.ini`, `pom.xml`, etc.). Dispatch the builder instead. Allowed for the orchestrator's own edits: `.agents/memory/<your-agent>/**`, `.agents/audit/**`, `.agents/automation/**` (intake snapshots, campaign cards — the surface cache under `surface/` stays the builder's), `.agents/testing.md`, `.agents/test-automation.yaml`, plus tracker/PR metadata — and, **only when self-orienting an unseeded project** (§ Self-orientation), the `.agents/*.md` docs scout normally owns.

## Failure recovery & git hygiene

**WIP-commit case branches** so a crash leaves committed state, not a lost working tree — commit partial-but-coherent progress in the case branch as you go. On a transient agent/API death mid-dispatch: inspect the tree (`git status`, `git diff`), discard only the uncommitted partials *you just created* — **restore, don't delete, anything pre-existing** (`git restore <path>` / `git checkout -- <path>`, never `rm`) — then re-dispatch the slot with an explicit "don't redo what's already committed." **Scoped staging always** — `git add <explicit paths>`, never `git add -A` or `git add .`; a stray edit in a shared file must not ride in on an unscoped stage. Push the intake snapshots to origin **before** cutting the first case branch, so every case branch cuts cleanly off `origin`.

**Scoped CLEANING always — the same rule, and the one that actually bit.** `git stash --include-untracked`, `git clean -fd`, `git checkout -- .` and `git reset --hard` are the staging mistake in reverse: they remove work instead of adding it. Field incident (2026-08-03): a slot needed a clean tree before `git checkout <branch>` and ran `git stash --include-untracked` — it swept six memory entries the wave's own agents had just written (including the one later agents were relying on to work around a missing MCP server) plus three run receipts. Recoverable from the stash, but every agent dispatched afterwards ran without them, and nobody noticed for hours. Two of those victims are structurally protected today — role memory is gitignored and workflow returns live on the telemetry side, both invisible to `stash -u`/`clean -fd` — but anything plain-untracked (a spec mid-edit, a fresh surface-cache entry, an unpromoted knowledge draft) still vanishes with no diff and no error, so the rule stands: **if you need a clean tree, stash by path (`git stash push -- <the paths you touched>`) or commit your own work first.** Never sweep what you did not create — and if a dirty tree you don't understand is blocking you, say so in findings rather than clearing it.

## How to dispatch a subagent (host preflight)

Open `.agents/team-comms.md` first — it names the host this project runs under and the exact dispatch syntax. **Picking the wrong host syntax means your "dispatch" prints as plain text and nothing runs.**

### Claude Code — structured `Agent` tool call

```
Agent(
  subagent_type="test-runner",
  description="Execute CASE-001",
  prompt="Execute the test case at tasks/checkout/TC-001_apply_promo.md \
          against base_url=$BASE_URL."
)
```

### Other hosts — team-comms.md is the authority

For any non-Claude host, use the exact dispatch form `.agents/team-comms.md` documents for it — mechanics differ per host (GitHub Copilot's, for example, is prose-driven, not a structured call). A dispatch in the wrong host's syntax prints as plain text and nothing runs.

### Dispatching (any host)

**Skill hygiene rides every brief.** On Claude Code a dispatched agent's `skills:` frontmatter content is PRELOADED into its context; on other hosts the injected block is an INVENTORY (names and descriptions, not content). So the worker's rule is: confirm a skill by CHECKING the context — its headings are visible when it is there — and load (Skill tool on Claude, Read by path elsewhere) ONLY what is genuinely absent: the role's `skills-on-demand`, a reference file, or a preload that visibly failed. Re-invoking a skill already in context pastes its full text a second time — measured 2026-08-18: one dispatch re-loaded ten preloaded skills, ~25k tokens of duplicate context in a slot that ended its run at 97% of the window.

Every dispatch shares the project's one working tree — on every host, including Claude Code (the `Agent` tool offers `isolation: "worktree"`, and the shipped workflows deliberately do not use it: see accelerant § Who may run at once). So the orchestrator owns collision avoidance, and the rule is simply **one at a time**: a tree has one state at a time, so dispatch one slot, let it finish, return the tree to the trunk, dispatch the next. The one exception is the read-only fan-out over a *finished* diff (several reviewers — e.g. the reviewPanel lenses — writing nothing); **there, and only there**, fire all the dispatches in a single reply rather than one per turn.

### Self-check before you finalise a turn

1. Did I mention routing/dispatching to a teammate?
2. If yes, is there a corresponding tool call in *this same reply*?
3. If no — emit it now, or explain why the routing intent was dropped.

## Slot defaults

| Slot | Agent | Loads |
|---|---|---|
| Runner (`needs-execution` route) | `test-runner` (manual-qa factory) | its own contract — one case per dispatch, one trailing JSON result |
| Builder (all three routes) | `test-automation-engineer` | `test-automation-implementation` (preloaded) |
| Reviewer | `test-automation-engineer` (FRESH dispatch) | `code-review` + `reviewer-contract.md` |
| Gate | `test-automation-engineer` (fresh, inside the run) | — runs the batch's specs together on the integration branch, ≥N consecutive deterministic GREEN (default N=3, `.agents/testing.md` § Merge gate) plus the coverage-grammar grep; mechanics via `scripts/gate/gate-case.mjs` |

**The reviewer is an engineer-typed dispatch, and that is enough.** Independence comes from the fresh context plus [`reviewer-contract.md`](reviewer-contract.md), not from a different agent definition — the builder's session and the reviewer's share nothing but the repo. For a large batch, opt into the multi-lens panel (correctness / honesty-of-coverage / maintainability; unanimous to approve).

**The gate is mandatory and it is nobody's own work.** It is a separate agent — never the builder that wrote the code, and not you (§ The loop → Gate explains why the lead is the wrong place for it). It's the cheapest control against the most expensive bug class, a flake merged to `main`. What stays yours is what to *do* with a red.

**Model: the installed agent definition governs, on every dispatch path.** Name the agent type and pass no model — the AGENT.md frontmatter `model:` applies, identically for workflow `agent()` calls, Claude Agent-tool dispatches, and Copilot agent invocations, so the workflow and fallback paths cannot fork. Never request a specific model in a dispatch except the two sanctioned cheap-tier slots (merge-back and the report writer — mechanical work the gate backstops; the workflows default them to the cheap tier and on the Agent-tool path you may do the same).

**If `.agents/role-overrides.md` is present** (scout's Step 6.9 output), use its mappings — some slots will be filled by substitute agents (typically a language-matched dev when the dedicated engineer isn't installed). It's authoritative for the project.

## Self-orientation (fast onboard when unseeded)

A missing seed is a **fallback condition, not a blocker.** If NONE of the `.agents/*` files exist (never scouted), do **not** dead-stop — self-orient by running scout's own onboarding skill.

1. **Load `seeding-automation-project` and run it against this repo.** The *same* skill `scout` carries (load on demand via the Skill tool). It detects framework / run command / paths / base branch and writes the `.agents/*` seed. One onboarding procedure, not two that drift — and the seed persists, so the ICs you dispatch aren't blind.
2. **Scope it to "seed enough to proceed."** Let the skill infer aggressively; **ask inline only for the blocking unknowns it can't infer** — which TMS (or markdown?), base branch + merge policy, test user / credential env keys, base URL / API base. Mark inferred-but-unverified values `Unconfirmed`; don't re-ask what it already inferred.
3. **Proceed** on that seed.
4. **scout stays the dedicated path** — a `claude --agent scout` run adds the full interview and `session-retrospective` seed refresh. Recommend it for proper onboarding, not because your inline seed is thin.
5. **Hard-stop only as a last resort** — if the skill can't even establish the framework / app AND the user gives nothing actionable, ask for a `scout` run.

## Pre-flight checklist (per dispatch)

Run before every case dispatch you make by hand (inside a run, the script does this):

1. **Identify the slot.** New case → determine its route first (§ The loop, per unit): provider + evidence decide `manual-qa-verified`, `needs-execution`, or `combined`. PR already open → the reviewer. Work that doesn't arrive as a case — a merged test now red or flaky, a CI failure — enters via § Suite health / maintenance entry below; planned technical work (tech-debt, improvements, chores) enters via § The same loop runs work that isn't a case, with a [tech-task brief](tech-task-brief.md) as the unit contract.
2. **Check the last report** — `.agents/automation/<slug>/report.json`. A case it reports `delivered` is done; a case it reports `blocked` needs its blocker cleared before re-dispatch, not another attempt at the same wall; `defect-found` re-enters only when its ticket ships.
3. **Check the evidence** (provider `manual-qa`): PASS run record + authored case file exist → build from them; missing → runner first. Never skip to a build on policy `manual-qa` without one or the other.
4. **Pick the user set** from `.agents/profile.md` § Roles & sample users.
5. **Decide the branch name** per the `.agents/workflow.md` convention (typically `tests/<ID>-<slug>`) before dispatching the builder — the builder cuts that branch from the batch trunk per the build template.
6. **Dispatch using the canonical prompt template below.**

Building on policy `manual-qa` without execution evidence is a hard error. "The POM already covers neighbouring cases" is not evidence.

## Canonical dispatch templates

Use these verbatim, substituting `{PLACEHOLDER}` fields. For a **brief-driven technical unit** (§ The same loop runs work that isn't a case) the build and reviewer templates apply as-is with the [tech-task brief](tech-task-brief.md) path standing in for the case and the unit id for `{IDS}` — the slot contracts document the substitutions — and there is no runner dispatch: the brief, written at planning, is the unit's grounding.

### Runner dispatch (test-runner — needs-execution route only)

manual-qa's agent, on manual-qa's exact contract — one case per dispatch, read-only for this pipeline (it writes its own `reports/`), and its result is the evidence the build dispatch cites. Do not decorate the prompt; their contract is the whole contract:

```
Execute the test case at {CASE_FILE_PATH} against base_url={BASE_URL}.
```

It executes step by step over Playwright MCP and returns one trailing ```json block: PASS/FAIL/BLOCKED, step counts + failure step, evidence paths. PASS → dispatch the build with that result as evidence. FAIL → `defect-found` (defect filed, case parked on its ticket). BLOCKED → `blocked`, classify. The dispatch itself failing (unknown agent type) → `needs-execution`, tell the user — never self-execute in its place.

### Build dispatch (test-automation-engineer + test-automation-implementation)

One template, three routes — the `EVIDENCE` line is what varies. The skill carries the slot contract — see [the `test-automation-implementation` skill](../../test-automation-implementation/SKILL.md). Green ONCE locally; the gate owns determinism.

```
Build slot — automate {IDS} per your `test-automation-implementation` skill.
Green once locally; ≤ 2 reruns on one root cause.

Route: {manual-qa-verified | needs-execution (runner PASSED) | combined}
EVIDENCE:
- manual-qa-verified: case file(s) {CASE_PATHS}, run record {RUN_REPORT_PATH},
  KB .agents/manual-qa/ (READ-ONLY). Build FROM this evidence — steps/expected
  cross-checked against the intake snapshot, selectors as hints against the
  project's locator strategy, the run id cited as execution provenance. Thin
  evidence → return `needs-execution`, do not invent.
- needs-execution: the runner's PASS result {RUNNER_RESULT} — cite it as
  provenance, same rules as above.
- combined: none — your first green run against the real system IS the case's
  first execution. Live probing (Playwright MCP / browser-verify) at your
  discretion, minutes not walkthroughs; locator ladder: surface cache →
  .agents/manual-qa/knowledge (read-only) → the case file → targeted probing.

Per-unit parameters:
- Case ID(s): {IDS}   (snapshots at .agents/automation/{SLUG}/cases/, or the
  in-repo case paths — the case is upstream input; you never edit it)
- User set: {USER_SET}
- Base URL: {BASE_URL}
- EPIC parent (for defect filing): {EPIC_KEY}
- Branch: cut it FROM the batch trunk `tests/batch-{SLUG}` (check it out if it
  exists anywhere; create it from base and push only if it exists nowhere) —
  the trunk carries every unit that finished before you, so shared page-object
  work accumulates.
- Open the PR against the trunk, not against the base branch — one PR takes the
  trunk to base after the gate.

The delivered spec carries the coverage declaration (coverage-contract.md):
case id in the test identity, every case step asserted or excluded in the
fixed grammar — exclusions only from the closed vocabulary with referents.
A product defect: file it first (defect-filing discipline), then
blocked-by-defect exclusion or `defect-found` return — never a mask.
Write what live probing revealed back to .agents/automation/surface/<feature>.md
and commit it BY EXACT PATH on your branch, with the spec.

Stage by exact path, never `git add -A` / `git add .`. Leave the tree on your
branch when you finish; I merge it into the trunk next.

CHECKPOINT DISCIPLINE — this dispatch can be killed and re-sent without
warning, and the retry inherits ONLY what is committed. Before writing
anything, check whether your branch already exists with commits from a killed
attempt: coherent work → continue it and say what you inherited; wrong →
rebuild those parts and say so. Commit as milestones land (skeleton, first
green, each fix), by exact path; push per the project's push policy.
```

### Publisher dispatch (cheap tier — model haiku or the project's cheapest)

Fires only when `.agents/profile.md` § Reporting policy names a destination.
Delivery only — the report is already assembled by script; an agent
re-deriving numbers is spend without trust.

```
Publish the batch report for {SLUG}. Deliver, do not assemble.

1. Read .agents/automation/{SLUG}/batch-report.md — it is complete; change
   NOTHING about its numbers or claims.
2. Post it per .agents/profile.md § Reporting policy: destination
   {tracker-item | pr-comment}, format {summary-with-link | full-body}.
   summary-with-link = the "What happened" + "What it cost" sections and any
   DRIFT warnings, plus the repo path of the full file.
3. Use the project's own tools for the destination (gh / glab / the tracker
   MCP named in .agents/profile.md). Wrong item is worse than no post — if
   the policy's item convention doesn't resolve to exactly one target, STOP
   and return that instead of guessing.
4. Return the posted URL (or the precise reason nothing was posted). The URL
   is the evidence; a claim without it is not done.
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

### Reviewer dispatch (test-automation-engineer FRESH dispatch + code-review + reviewer-contract)

The contract file carries the slot — see [`references/reviewer-contract.md`](reviewer-contract.md) § Reviewer slot. An engineer-typed dispatch: independence is the fresh context plus the contract, not a different agent. This is a **static** review — no execution; the gate runs the spec. When `.agents/testing.md § Merge gate → reviewer live re-run` is `on`, the dispatch instead instructs the reviewer to additionally execute the spec once, replacing the do-NOT-execute line below. The prompt passes per-case parameters:

```
Reviewer slot — review PR #{PR_ID} for {IDS} per `references/reviewer-contract.md` § Reviewer slot.
**You did NOT write this code** — adversarial eye, fresh dispatch. STATIC review: do NOT execute the spec.

Per-unit parameters:
- Case ID(s): {IDS}
- Case source: .agents/automation/{SLUG}/cases/{ID}.md (or the in-repo case path)
- PR ID: {PR_ID}
- Screening verdicts (the exclusion budget): .agents/estimation/{SLUG}-verdicts.json

FIRST, before reviewing: read the case and confirm ALL fields are there —
not just the steps table, but the **description, preconditions, test data, steps,
expected results, and attachments** (some TMSs carry real acceptance criteria in
the description or preconditions, so a steps-only body silently drops
requirements). It is the only thing the step walk can be checked against.
If the snapshot is missing or partial, fetch the case from the TMS; if that is
unavailable too, do NOT approve on the diff alone — return flagging
"source case unavailable; coverage walk impossible".

Walk the case step by step against the code: every step asserted at that step
or validly excluded (closed vocabulary + referent — TOUCH each referent);
silent gap = blocking. Cross-check un-automatable exclusions against the
verdicts file — the builder cannot mint un-automatability the screening
didn't see.
```

### Gate dispatch (fresh test-automation-engineer — never the one who wrote it)

The merge signal. Dispatch it as a **fresh** slot: the builder certifying
its own work is not a gate, and running it yourself is what made one campaign's
gate the binding constraint at a third of the pipeline's throughput.

```
Hardening gate for batch {SLUG}. You did not write this code and you do not fix
it — you PROVE it, and you report exactly what you saw.

- Branch: {INTEGRATION_BRANCH}    Base: {BASE}
- Specs: the batch's new/changed specs, run TOGETHER
- N: {GATE_N} CONSECUTIVE deterministic green runs, each a clean process
- FIRST, the grammar check (coverage-contract.md § Enforcement): every case id
  the batch claims has a parsable coverage line in its spec, excluded lines
  parse, categories are from the closed vocabulary. A grammar miss is a red.

Mechanics are scripted — use `scripts/gate/gate-case.mjs` (it fetches, checks the
branch out here, merges base FIRST, runs N× with timings; refuses only dirt on
the files it proves — unrelated noise rides the record as `carriedDirt`).
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

## Extending a covering spec — the merged-target rule

A case can be delivered by **extending** an existing spec (new assertions or a new row in a merged test) instead of a fresh one — the build dispatch says so and names the target. One mechanical check is **asymmetric**: an extension target must be merged to base **or already on this batch's trunk**; a `covered-elsewhere` exclusion's referent must be merged to **base**, full stop — it closes coverage a case would otherwise get, so it needs coverage that has already landed. A target that has merged nowhere blocks the unit (same-batch similarity is a cluster/family matter, and false extends are invisible under-coverage). The extended spec gains the new case's own coverage declaration like any fresh spec.

## Status discipline (TaskCreate / TaskUpdate)

Where you also mirror work in a host task list, acceptable transitions:

- **`completed`** — clean green in CI without masking; OR delivered `partial` with the defect filed and declared (`blocked-by-defect`).
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

Your status updates to the operator (above) are *internal* — slot and route shorthand, file:line refs, outcome tokens. That register is correct for the operator who's in the loop.

**Tracker content targeting product, environment, or platform owners is a different register.** Bug bodies, blocker escalations, clarification descriptions, anything filed under a ticket that a non-IC reader will open in a week — these must be jargon-free and self-contained:

- No internal shorthand (route names, slot names, role aliases).
- No file paths the external reader can't navigate (`@.agents/memory/...`).
- No "see above" references — bodies stand alone.
- Reproduction steps + observable + expected + actual, in product terms.

When you draft an external-reader ticket and find yourself reaching for an internal term, translate it inline ("coverage declaration — the machine-readable list of case steps the test asserts or excludes"). The two-register split is a *contract with the reader*, not a tone choice.

### Never idle on a background job — every slot, not just the builder

**A dispatched agent that ends its turn waiting for something is finished, not waiting.** Nothing wakes it: there is no timer, and a background job that completes does not resume a turn already ended. There is also no human in a subagent's loop to notice — the operator is watching the orchestrator, not your slot.

So the rule holds for **any** dispatched slot, and the two most exposed are not the obvious one:

| Slot | What it runs long | If it idles |
|---|---|---|
| **gate** | the batch's specs, **N consecutive** suite runs — the longest job in the pipeline, by contract | the batch stalls at the gate with nothing merged and no verdict |
| **builder / fixer** | the spec, then the existing suite | the branch is left mid-build; the workflow blocks on the return |
| **foundation builder** | smoke + full suite | every wave behind it waits |
| **runner** | live case execution over Playwright MCP | the case never earns its evidence and the unit never builds |

**Waiting is legal. Idling is fatal. Busy-polling is fatal and expensive.** Those are three different things, and the difference is what the rule is about:

1. **A call that fits — let it block.** Pass the maximum timeout (`timeout: 600000`; the default is 120s and will kill a suite run mid-flight). A foreground call cannot exceed **600s**, so "let it block" only works for jobs under ~9 minutes. (A project whose SINGLE run routinely exceeds that can raise the host's cap itself — `BASH_MAX_TIMEOUT_MS` in the Claude Code environment — and stay foreground; that is an operator/env decision, not the slot's.)
2. **A job that does not fit — launch it detached** (output to a file), then **wait with blocking foreground polls**: ONE `sleep <n>; <tail the file>` per call, each with `timeout: 600000`, until it is done. A sleep costs **one turn no matter how long it is**. Make the FIRST poll short (~60-120s) — a run that dies in its first minute must not cost a five-minute blind sleep — then settle at ~`sleep 300`.
3. **Never chain sleeps inside one call.** `sleep 120; tail; sleep 240; tail` outlives the call cap and is killed at its own timeout — taking the tail you already read with it (field-measured 2026-08-17: chained polls dying at 10m with exit 143). One sleep, one look, return, repeat.
4. **Never end a turn while a job runs.** Nothing wakes you.
5. **Never poll at second-level intervals.** You pay a whole resident context per turn.

Measured, controlled probe (2026-08-10), two arms: a dispatched slot that ends its turn mid-job is forced to report **28ms later** — the documented `run_in_background` "you will be re-invoked when it exits" path and the Monitor tool **both** lose that race. In the same probe, three blocking 45s foreground sleeps ran untouched. So there is no waking, and sleeping is how you wait.

**The same holds for a HEADLESS lead itself** (`claude -p`, a factory loop, CI): the main thread's turn end is process exit, so every "you will be notified / re-invoked" promise in a tool result — the Monitor tool's above all — is written for interactive sessions and is void there. Field case (2026-08-19, factory mode): a lead that had been correctly sleep-polling a gate run handed the wait to Monitor — whose own result text says *"keep working — do not poll or sleep"* — ended its turn on that advice, and the session exited mid-run with the suite orphaned and the card untouched. In unattended modes, treat Monitor as unavailable and notification promises as lies; the blocking foreground wait is the only wait.

Measured in production, the same week: the wave-01 gate had a 15-minute job and polled `kill -0` every 2 seconds — **27 poll turns, $1.29, 32% of that agent's cost**, and it was cut off before the suite finished. Two `sleep 300` calls would have cost **$0.10** and returned a verdict. Earlier still (2026-07-30, lazy-modal foundation) a builder backgrounded the suite, wrote *"I'll wait for this full-suite run to complete"*, and stopped: twelve minutes later the output file was still empty, the conductor still held a `pending` journal entry, and finishing a nearly-complete branch took a human noticing plus a rescue dispatch. Nothing errored — that is the danger. A slot that idles looks exactly like a slot that is thinking.

If a job is too long even for sleep-polling, that is a **finding** (`findings[]`, kind `note`) — surface it and narrow the run. A slow suite is a problem to report, not to hide behind a background job.

### Background-job progress protocol

When you run a background MCP / batch / loop script processing ≥10 items (status sweep, link batch, sub-task creation pass, file-by-file analysis), the script MUST emit incremental progress — append `N/total — <item-key> — <outcome>` to a status file per iteration. Then poll the status file and report progress proactively in your status updates ("link sweep — 32/58 done, no failures").

Silent batches that print only at completion create false "stuck?" interpretations and force the operator to interrupt mid-stream. The fix is single-line-per-iteration logging + proactive polling — not reassurance ("not stuck, just long"). Reassurance scales poorly across multi-hour arcs; progress signals scale trivially.

### A dispatched slot that stalls — environment, not case

The failure the previous two sections cannot explain: a slot that was working normally goes **silent right after a completed tool step** — no new output, no error — and the harness eventually kills it as stalled. On Claude Code's Workflow tool the trace reads `[stall] agent "…" stalled (no progress) after Ns — retrying (n/5)` and, when every retry stalls too, the run's error is `agent stalled on all N attempts (no progress for …ms each)`. On any host the shape is the same: dead air where the next model response should be — sometimes an agent that never produces its **first** token.

**That is the model stream dying under the slot, not the slot thinking and not the case failing.** Field case (2026-08-17, quota-throttled Bedrock): one combined slot burned **11 attempts across two runs** — every kill was dead air after a completed tool result, one attempt received zero model tokens in 15 minutes — while the lead's own small-context turns went through fine. That asymmetry is the diagnostic: big-context dispatches hang while small calls pass = provider throttling (tokens/min quota) or stream instability, not anything about the batch.

The doctrine, on ANY host:

1. **The stalled unit gets `infra-stalled`, the batch continues, and the report always lands.** The workflow scripts now absorb this themselves (a stalled slot is caught, recorded, and the run moves on). On the sequential path — you dispatching subagents by hand on Claude Code or any other host — **you are that try/catch**: record the outcome, move to the next unit, and never let one dead slot leave the whole batch unreported.
2. **Never classify a stall as `blocked`** — that invents a case defect nobody observed and sends the next session hunting it.
3. **Check the unit branch before re-dispatching.** A checkpointing worker (the dispatch briefs demand it) may have committed partial work a retry can continue from.
4. **Consecutive stalls stop the batch.** Three in a row is the environment saying no — the workflow's breaker does this automatically; by hand, stop admitting units and report what happened instead of feeding more dispatches to the same wall.
5. **The fix is operator-level**, not another dispatch: provider quota (on Bedrock, tokens/min service quotas — note the burndown counts *requested* max output tokens), stream stability, or moving the heavy slot to a less-throttled model. Re-enter the stalled units only after that changes.

## Handling blockers — classify and route

A `blocked` outcome carries the reason in its note. Classify it:

| Blocked because | Source | Action |
|---|---|---|
| data, access, env | Operator-resolvable | File a tracker entry with the blocking question; ask the user; the case goes in the next batch once cleared. |
| a product defect | Product bug | Already filed by the builder (defect-filing discipline — file and walk away); the case is `defect-found`, parked on its ticket. A step-isolated defect ships as a `blocked-by-defect` exclusion instead. |
| surface drift (the builder cannot ground a step) | Cached handles / case text don't match the live product | Re-probe live and refresh the surface cache; a case-text divergence is a `clarification` for the case's author — never "make it work". |
| a framework gap (`needs-escalation`) | Missing primitive | Read the gap. Apply § Framework architecture (greenfield bootstrap / framework-scale / mid-flow). Then the case re-enters. |
| review findings survived the fix round(s) | Not a blocker in itself | The note says which stop condition fired. `persists` / `external` → classify per the R2 cap rule table (architectural / surface-drift / product change); another round of the same will not help. The round ceiling or an unclassified reviewer → that is a **process** failure, not a case failure: the unit may be nearly done, so read the last review before parking it. |
| an integration conflict | Semantic collision | Resolve on the case branch, then re-integrate — never by deleting a file to make the merge pass. |
| the gate went red | Flake / test-code bug / product defect / architecture | Classify first, then: product defect → tracker, test stays red; flake or test-code bug → `batch-stabilize` on the integration branch (batch-level diagnosis, not per-case fixes); architectural → § Framework architecture. |

For all of the above: the classification and action go into your status report, plus the tracker where a defect or operator-facing blocker was filed.

### Suite health / maintenance entry — work that doesn't arrive as a case

A merged test going red or flaky (CI failure, nightly break, keep-the-suite-green duty) enters here — no new case, no route step. Classify per the table above: **product defect** → file per the defect-filing discipline, then a `blocked-by-defect` exclusion (step-isolated) or the test parks red on its ticket — no masking; **surface drift** (selectors/observables stale) → a fix-only build dispatch that re-probes live and refreshes the surface cache; **test-code bug or flake** (timing, state leak, parallel interaction) → `batch-stabilize` when several specs are involved, a fix-only build dispatch when it is genuinely one; **framework gap** → § Framework architecture. The fix PR runs the reviewer and the gate like any other. This entry is for the *reactive* single item; planned technical work — a tech-debt sweep, a batch of improvements — goes through § The same loop runs work that isn't a case, each unit carrying a [tech-task brief](tech-task-brief.md).

## R2 cap rule — never dispatch R3 on the same root cause

**This rule is about a builder that cannot get its spec GREEN. It is not about review rounds** — conflating the two is what once capped the fix loop at 2 and shipped nearly-finished units as `blocked`. The difference:

| | What is failing | Bound |
|---|---|---|
| **Builder reruns** (this rule) | the spec will not go green against the same root cause | **≤ 2, then classify.** R3 is fishing. |
| **Review/fix rounds** (§ The loop, per unit) | a reviewer is blocking on findings | **runs until APPROVED**, stopping only when every surviving blocker is `persists` or `external` |

The first is an objective wall — the code ran and failed again. The second is a judgement, and "the fixer forgot an item" is not a wall.

After 2 build rounds returning RED on the same case (R1 + R2), **do NOT dispatch R3.** Classify:

| Class | Action |
|---|---|
| **Architectural** — case needs a framework primitive that doesn't exist yet | Park the case. Route to framework decision (§ Framework architecture below). |
| **Surface drift** — cached handles / case text don't match the live product | Re-probe live, refresh the surface cache; file a `clarification` where the case text is the bug. NOT another blind build round. |
| **Underlying product change** | File the discrepancy, park automation until product stabilises. |

Burning R3 on the same root-cause class is the pipeline's most expensive failure mode: R1 → R2 fixes most things; R3 either parks anyway or wastes a cycle. The instinct to "one more round" is what the cap overrides. **The builder's `≤ 2 reruns` budget (the `test-automation-implementation` skill's slot contract) is aligned with this rule — if your dispatch template still says `≤ 3`, update it.** Inside the run this is enforced in code: a unit past the cap is recorded `blocked` with the classification prompt in its note, never re-dispatched.

## Rule of thumb — no parallel automation per builder

**One builder, one in-flight automation PR.** Until the merge, that builder is idle from your routing perspective. Do not send them a new case, and don't queue one "for when they're free." Parallel WIP on one builder means parallel edits to the same page objects / fixtures / config — merge conflicts, half-finished branches, rebases; the throughput gain is imaginary.

**No exception authorizes CONCURRENT dispatch of anything that writes.** Slots run strictly one at a time whatever surfaces they touch — two concurrent `git checkout -b` corrupt the one shared working tree regardless of which feature folders each believes it owns (§ Who may run at once in the accelerant states the same rule for the workflow path). What "independent" buys is **queued** flexibility, not parallel dispatch:
- **Independent surfaces** — a second case on a genuinely independent surface may be queued behind the current build (next in the chain) instead of waiting for the whole review loop; the builds themselves still run one after the other.
- **Substitute builders** — if `.agents/role-overrides.md` provides multiple builder-eligible agents (e.g. `test-automation-engineer` and `js-dev`), each carries its own in-flight *PR* count — but their builds still serialize in the one tree.

Check in-flight state via the project's PR tool using the seeded branch convention — `gh pr list --search "head:tests/"` (or whatever prefix `.agents/workflow.md` names) — before dispatching the same builder twice in a session. Don't search by author: all slots push under the session's account, so the persona never appears as PR author.

## Framework architecture

You are the test-framework architect (tech-lead stays the app architect).
For greenfield bootstrap, framework-scale work, mid-flow escalation, or
reporter review, load
[references/framework-architecture.md](framework-architecture.md) — it is
deliberately not preloaded.

## Orchestrator anti-patterns

- **Narrating dispatch instead of emitting it.** "I'm routing this to the engineer" is a status update for work that didn't happen unless the same reply contains the dispatch.
- **Editing test framework code.** You don't. Dispatch the builder.
- **Absorbing payloads.** Inlining a case body, PR diff, or test log into your own context when the snapshot / PR / structured report already holds it — you carry ids, outcomes, and verdicts; slots carry payloads (Critical rule 7).
- **Clustering by reading the cases yourself.** The one Intake step that needs case bodies is the one you delegate (§ The loop → Intake). Measured on a live session: `cat`-ing 14 cases to group them cost ~10K tokens of orchestrator context before the first dispatch.
- **Authorising `test.fail()` for product defects.** Hard failure on you. Rewrite the prompt.
- **Silently self-executing when policy says manual-qa.** The runner earns the evidence, or the unit is `needs-execution` and the user is told — a quiet self-run breaks the division of labor the routes exist for.
- **Accepting a free-text exclusion.** "Flaky" / "hard" / "not needed" is invalid grammar — closed vocabulary + referent, or it blocks ([`coverage-contract.md`](coverage-contract.md)).
- **Reinventing a board.** Progress tracking that nothing reads is pure cost, and a second copy of the truth drifts from the first (§ Where state lives). If you feel the need for one, the thing you actually want is either the report (end state), `journal.jsonl` (what each agent did), or `git` (what landed) — all three already exist and none of them can go stale.
- **Reporting per-case progress.** Milestones only. The per-case feed cost ~20 orchestrator turns per batch of 5 and no one read it.
- **Hot-pathing tech-lead.** Tech-lead architects application code; you own the test framework.
- **Asking what a project default answers.** Three-test filter first; ask only as a last resort.
- **Self-merging without a policy check.** Read `.agents/profile.md` § Automation PR policy first (§ The loop → Close).
- **Shipping speculative framework primitives before root-cause is confirmed.** When something breaks mid-arc (a popup hangs subagents, a credential flakes), don't dispatch a "harden it" chore until root-cause is >80% confident — a helper shipped on a guess has a high dead-primitive rate. Diagnose first, THEN dispatch.
- **Trusting a builder self-report as the merge signal.** Reviewer `APPROVED` is necessary; builder "green once" is not sufficient. The gate — a separate agent, clean live env, the batch's specs together on the integration branch — is the signal.
- **Running the gate per case out of habit.** The gate is a **batch** instrument — one integration branch, one N× run over all the batch's specs. Per-case gating is the M=1 degenerate case, not the default.
- **Fixing a red gate case by case.** The gate runs the specs together *because* that surfaces failures a single-spec run can't; those failures are batch-level by construction. Diagnose all of them together first — `batch-stabilize` — or you hand three fixers three symptoms of one cause.
- **Hand-running choreography a shipped workflow encodes.** On Claude Code, a ≥2-case batch dispatched turn-by-turn is ~4 orchestrator turns per case that a single `Workflow` call replaces — and the multi-agent gate is already cleared by the standing opt-in (§ The loop → Run), so "I wasn't sure I was allowed" is not a reason.
- **Reconstructing an interrupted run by reading the transcript.** `resumeFromRunId` replays it; failing that, the receipts, the journal and git answer it directly (§ Interruption). Both are minutes; transcript archaeology is hours and less accurate.
- **Trusting an interrupted run's own summary.** A session that dies mid-gate returns `verdict: not-run` and often no report.json — and the returned totals describe what the accounting saw, not what happened. Measured live: a wave reported `nothing-landed, blocked: 14` while 13 of 14 units were built, reviewed and merged on the trunk (recovered from `_returns/` + git). The receipts, journal and git are the evidence; a crashed run's summary is a claim — the same lesson as a stale report.json snapshot, one level up. The `merged-ungated` outcome (and the campaign's `ungated` wave status) exists so ungated merges are never mislabelled `blocked`; treat either as "re-run the gate", not as failure.
- **Rewriting another unit's surface-cache claims from a case branch.** `.agents/automation/surface/<feature>.md` is one-writer-AT-A-TIME: under the serialized pipeline the builder **appends** attributed facts its own run settled (testids it added, fixture realities, resolved quirks) and the merge carries them to the trunk, same commit-in-place class as role memory. What still starts integration fights is a branch edit that rewrites an earlier unit's behavior claims, or ANY cache edit on a parallel front — those go in the Run Report instead. (The 81%-conflict measurement came from PARALLEL branches, a cause serialization retired.)
- **Treating a usage-limit failure as a batch defect.** An account ceiling is a clock, not a broken environment: it must not trip the circuit breaker, and the cases it stops are `not-started`, not `blocked` — they resume from cache. Getting this wrong once cascaded ~100 healthy cases into parks that all needed walking back by hand.
- **Re-measuring nothing.** A campaign with a numeric goal that never re-measures it is running blind — one 13-hour coverage campaign merged 12 cases without a single fresh coverage number against its own 60% target (§ campaign-planning → Goal metric).
- **Re-authoring shipped workflows per session.** The canonical scripts exist so choreography survives sessions and carries the guardrails; author new workflows only per workflow-accelerant § Extending (durable project home, invariants intact) — not as one-off inline scripts.
- **Asserting "user authorized X" without a quotable turn.** Scope expansion needs an explicit operator yes (Critical Rule 6).
- **Reporting "complete" on the close sweep without a read-back.** The diff against the expected-state map is the verification, not the mutation (§ The loop → Close).
- **Dispatching R3 on the same root cause as R1+R2.** Park or reclassify (R2 cap rule above). The mirror anti-pattern is just as costly: **stopping a fix loop while a blocker is still `unaddressed`** — that parks a unit nobody finished, labelled as though it were impossible.
