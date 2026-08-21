---
name: test-automation-workflow
description: "Use when ready-made test cases (TMS or tasks/<suite>/TC-*.md) need to become automated tests — a single case or a batch — or when technical suite work (tech-debt, migrations, improvements, suite health) needs planning and batching. Batch pipeline: units run one at a time on a batch trunk — routed by execution evidence (manual-qa-verified / needs-execution / combined), built, statically reviewed against the coverage contract, merged back — then one N×-green hardening gate per batch and one TMS/tracker mirror sweep. Pluggable TMS (Zephyr/TestRail/Xray/Azure/markdown)."
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.3.0"
---

## Test Automation Workflow — the pipeline

This pipeline is a **compiler from test cases to test code**. Input: ready-made cases (TMS or `tasks/<suite>/TC-*.md`) plus execution evidence when available. Output: merged automated tests + TMS back-write + receipts. The only repo artifacts it produces are **test code** and the **surface cache** (`.agents/automation/surface/<feature>.md`). **Orchestration is the `test-automation-lead` agent's job** — routing, dispatch, coverage gating, merge, framework architecture; this skill fixes what each dispatched slot does and how the lead runs the loop. On projects without `test-automation-lead` installed, those responsibilities fall to whichever agent has been substituted via `.agents/role-overrides.md`.

**Division of labor with the manual-qa factory:** writing cases and executing them live is *their* work; automating them is *this* pipeline's. Running TA's OWN code — the hardening gate, the blast-radius regression — stays here: that is proving code, not executing cases. Co-install with manual-qa is the default first-class scenario; standalone (cases from a TMS, no manual-qa) is equally first-class — the route policy below is the switch.

**Core doctrine — execution evidence, not execution ritual.** Every case needs live-execution evidence before its automation is trusted, and there are exactly three ways to have it:

- **`manual-qa-verified`** — the manual-qa team already executed the case (PASS run record + authored case file). Build from that evidence; never pay the live run twice.
- **`needs-execution`** — policy says manual-qa executes, but no qualifying evidence exists. The lead dispatches manual-qa's `test-runner` per case; a PASS becomes the evidence, a FAIL becomes a defect.
- **`combined`** — no manual-qa on the project (`provider: self`). *The first green run of the automated test against the real system IS the case's first execution.* Live browsing is an investigation tool at the engineer's discretion, not a mandatory walkthrough.

The route is policy, never improvisation: `.agents/testing.md § Execution provider` (`manual-qa` | `self`, seeded by scout) decides, and when policy says manual-qa the pipeline **never silently self-executes** — a runner that cannot be dispatched leaves the unit `needs-execution` with instructions to the user.

**Why split the work across slots:** context. The build carries framework state (page objects, fixtures, live probing). The review carries adversarial-eye state (the case walked step-by-step against the code). The gate carries runner output. Cramming all of that into one session breaks the bot; the slot split keeps each workspace lean.

## Orchestrator slot contract

This skill section IS the orchestrator-slot contract for the test-automation pipeline. When any agent is filling the orchestrator role — `test-automation-lead` by default, or any other agent named in `.agents/team-comms.md` § Roster — role, behavior, dispatch mechanics, and decision rules are fixed here so the role is **portable**: load this skill + point the roster at any orchestrator-capable agent.

**Role.** Route test-automation work through the route → build → review pipeline, enforce the coverage contract, classify blockers and route them, own the automation merge, own test-framework architecture decisions. Cases are the common instance, not the boundary: technical work — tech-debt, migrations, improvements, suite health — runs the same loop with a [tech-task brief](references/tech-task-brief.md) as the unit contract (playbook § The same loop runs work that isn't a case).

**Session context — read once at session start.** Typically auto-imported via your agent's `AGENT.md`; if your agent doesn't auto-import, read them now:

- `.agents/profile.md` — project systems map (issue tracker, TMS, base branch, merge policy)
- `.agents/workflow.md` — branch/PR conventions, EPIC pattern, sub-task filing rules
- `.agents/testing.md` — framework, run commands, fixture/POM conventions, locator strategy, merge-gate N, **Execution provider**, **Coverage idiom**
- `.agents/team-comms.md` — host, dispatch syntax, installed roster
- `.agents/role-overrides.md` (if present) — slot substitutions when the default agent isn't installed

Missing files are tolerated; when ALL are absent the project was never seeded — **self-orient by running the `seeding-automation-project` skill yourself** (scout's own onboarding procedure — load it on demand), asking the user only for the blocking unknowns it can't infer, then proceed — rather than dead-stopping. Full procedure: [`references/orchestration-playbook.md`](references/orchestration-playbook.md) § Self-orientation.

**Per-batch parameters** (caller / user provides):

- One or more case IDs (or "all of SPRINT-42's regression suite", etc.)
- Implicit: `.agents/profile.md` § Automation PR policy (base branch, merge policy, merge strategy)

**Return contract:**

- Status updates at batch milestones, not after every turn (see playbook § Status reporting — milestones)
- After each merge: tracker close + TMS back-write + user notification
- Escalations classified and routed (see playbook § Handling blockers)

**One report, not a running state.** A run says where each case ended — the terminal outcomes (`delivered` · `defect-found` · `blocked` · `un-automatable` · `needs-execution` · `infra-stalled` · `not-started`), each with any `findings[]` and its `coverage` record, written once to `.agents/automation/<slug>/report.{json,md}`. One state is deliberately NOT terminal: `merged-ungated` — the unit is built, reviewed and merged on the trunk but an interrupted run's gate never produced a verdict. It means "re-run the gate", never "failed"; labelling such units `blocked` is how a dead run's summary once claimed `blocked: 14` while 13 of 14 were merged (playbook § anti-patterns). And when a re-run gate — yours, or a stabilize round's — finally produces the verdict, **write it back into the report** (playbook § Close): the report is the receipt every audit and next-batch plan reads; a recovered-green batch left `merged-ungated` scores as undelivered. There is no board and no mid-run bookkeeping, because nothing reads progress while the run is live. That is also the compaction story: an interrupted run resumes from cache (`resumeFromRunId`), or you rebuild it by reading what is already on disk — the hook's receipts, the run journal, then git — and write the report yourself (playbook § Interruption and resumption). Either way the **remainder** feeds the next batch. What the orchestrator writes down the moment it learns it — because nothing else holds it — is the runId, operator decisions, and checkpoint args (playbook § Where state lives, § Interruption).

**Default execution shape — workflows, standing opt-in.** On Claude Code, a batch of ANY size — one case included — runs as ONE deterministic workflow via the shipped scripts ([`references/workflow-accelerant.md`](references/workflow-accelerant.md)) — it merges each unit as it is approved and gates the trunk, then hands back the report. **This skill's instruction is the standing explicit opt-in the Workflow tool's multi-agent gate requires** — the orchestrator neither asks the operator again nor re-litigates the gate per batch, and falls back to sequential dispatches only for the accelerant's § When NOT to use it (an atomic fix, an unseeded project, no Workflow tool, or an operator supervising step by step — a batch of one is NOT an exception; it runs through the workflow like any other); a shape no shipped script fits is authored/forked per accelerant § Extending, not hand-run. On every other host: sequential dispatches, same contracts — the outcome vocabulary, the findings channel, the coverage contract, the gate's independence, and **the fix loop's stop conditions** (rounds continue while any blocker is `unaddressed`; they stop only when what remains is `persists` or `external` — [`reviewer-contract.md`](references/reviewer-contract.md) § On a RE-REVIEW) hold on both paths. Where a script runs the loop on Claude Code, the orchestrator *is* the loop elsewhere; nothing about the contract changes, only who executes it. Either way the orchestrator stays **context-frugal** (playbook Critical rule 7): plans, dispatches, and verdicts in context; payloads — case bodies, diffs, logs — on disk and in PRs where the slots read them.

**Dispatch card** — the routine Workflow invocation, so the accelerant only needs opening for its edge cases (extending/forking, model tiering, quota resume, § When NOT to use it):

```js
Workflow({
  scriptPath: "<installed skill dir>/scripts/workflows/batch-build.workflow.mjs",
  args: {
    slug: "<batch-slug>",                   // names .agents/automation/<slug>/
    base: "origin/<base-branch>",           // from .agents/profile.md
    cases: [{ id: "TC-101", title: "…" }],  // intake is yours — bodies snapshotted before dispatch
    // clusters: [["TC-1","TC-2"]]          // plan-declared flow-variant clusters
    // gateN, gateCmd, fixRounds, skipGate  // loop/gate knobs — defaults are right
  }
})
```

Write the **runId to disk the moment the call returns** (context-fragile). Crash or pause → re-invoke the same scriptPath+args plus `resumeFromRunId` (completed units replay from cache). Red gate classified flake/test-code → `batch-stabilize.workflow.mjs` on the trunk. The report and case rows land in `.agents/automation/<slug>/report.{json,md}`.

**Full playbook** — the batch loop, the three routes, dispatch mechanics, pre-flight checklists, canonical dispatch templates, status discipline, tracker discipline, status reporting, handling blockers, R2 cap rule, framework architecture (greenfield / framework-scale / mid-flow), merge protocol, anti-patterns — lives in [`references/orchestration-playbook.md`](references/orchestration-playbook.md). **Load it by situation, not by ritual.** On the workflow path the scripts carry the loop and the report's `next:` names your close moves — open the specific section when its moment arrives: red gate → § Handling blockers · interrupted run → § Interruption and resumption · unseeded project → § Self-orientation · framework decision → § Framework architecture · non-case batch → § The same loop runs work that isn't a case · batch close (scope outcomes, batch report, publish) → § 3. Close. Running the loop **by hand** — no Workflow tool, another host, sequential dispatches — the playbook *is* the loop: read it before the first dispatch.

**Wiring this role on a project.** To swap the default orchestrator for another agent (e.g. PM):

1. Add `test-automation-workflow` to the substitute agent's `skills:` frontmatter.
2. Update `.agents/team-comms.md` § Roster so the orchestrator slot points at the substitute.
3. The substitute now has the orchestrator slot contract + playbook access — the test-automation lead role is filled without `test-automation-lead` agent being installed.

## Builder slot contract

Take a routed unit (case + its execution evidence, or the mandate to earn it) → PR-ready diff carrying the coverage declaration + Run Report, green once locally (the batch hardening gate proves determinism). Retry budget ≤2 reruns on the same root cause. Full procedure — six-phase loop, the three route disciplines, Run Report template, the Hard Rules — in the [`test-automation-implementation`](../test-automation-implementation/SKILL.md) skill, the engineer's own preloaded skill. Hard-Rules index: match the project's framework · no defect masking · respect the abstraction layer · env vars, never hardcoded values · no sleeps · most stable semantic handle · reuse before create · helpers are trusted · data-dependency → serial · read-only-by-default · shared files have one writer on base · scaffold minimal.

## The pipeline (slot view)

```
1. Discover framework      (read what scout produced)
2. Ingest cases            (pluggable adapter — TMS or tasks/ files)
3. Screen + route          (intake clustering+sizing pass; route per execution evidence)
4. Build                   (engineer — implementation skill; coverage declaration in the code)
5. Review                  (engineer-typed reviewer dispatch — coverage walk per reviewer-contract)
6. Gate                    (fresh agent — N× green + blast radius + coverage grammar)
7. Deliver & sync TMS      (completing-a-task; orchestrator back-writes post-merge)
```

The lead owns 1–3 and 7 and dispatches 4–6. Slots don't need the routing rules — they need their own contract once dispatched.

### 1. Discover framework

Before anything, read what scout / seeding-automation-project produced:

- `AGENTS.md` — tech stack, test commands
- `.agents/testing.md` — test framework, commands, fixtures, CI, execution provider, coverage idiom
- `.agents/architecture.md` — system map (for data flow awareness)
- `.agents/profile.md` — languages, default branch
- `.agents/test-automation.yaml` — TMS config + framework hints (if present)

**If none of these exist**, return to `test-automation-lead` — who self-orients the project (or runs scout) before re-dispatching you. Do not try to automate into a codebase you have not mapped.

Framework detection patterns (if `testing.md` doesn't name it):

```bash
test -f playwright.config.ts -o -f playwright.config.js && echo "playwright"
test -f cypress.config.ts -o -f cypress.config.js && echo "cypress"
find . -name "pom.xml" -maxdepth 3 -exec grep -l "selenium\|playwright" {} \;
grep -r "pytest-playwright\|playwright.sync_api" --include="*.txt" --include="*.toml" . 2>/dev/null | head
test -f wdio.conf.ts -o -f wdio.conf.js && echo "wdio"
```

**No framework yet?** Return `needs-escalation` (mid-flow escalation). The orchestrator owns the bootstrap decision per [`references/orchestration-playbook.md`](references/orchestration-playbook.md) § Framework architecture. Once an approved plan is handed back, execute it against [`references/framework-scaffold.md`](references/framework-scaffold.md).

### 2. Ingest the case (source-pluggable — TMS or otherwise)

A case can come from a **TMS** (the most common source in practice) or from the **repo itself** — manual-qa-authored files under `tasks/<suite>/TC-*.md`, or case bodies someone committed as markdown. The source + adapter + transport are declared in `.agents/test-automation.yaml` (see [`references/tms-adapters.md`](references/tms-adapters.md)); if unset, the source defaults to `markdown`. For a TMS source there are two further axes — **adapter** (which TMS) and **transport** (HTTP or MCP).

Supported adapters out of the box: `zephyr-scale`, `testrail`, `xray`, `azure-test-plans`, `markdown` (plain files). Each adapter exposes the same verbs regardless of transport:

```
fetch_case(id)       → returns { id, name, preconditions, steps, expected, cleanup, links }
update_execution(id, status, evidence) → back-writes result
```

**Full-field fetch is mandatory.** TMS adapters typically expose a "quick search" verb (returns minimal fields) and a "full fetch" verb (returns all custom fields including step + expected text). **Always use full fetch.** If your adapter has only quick-search and the step text comes back null, the case is unusable — stop and ask `test-automation-lead` how to get the full content (open the case in the browser and copy, if necessary). Never proceed on a partial case.

**Transport choice:**

- `transport: mcp` — preferred when the host has a TMS MCP server configured (Elitea, Atlassian Remote MCP, vendor TestRail / Xray MCP). The adapter calls `mcp__<server>__<tool>` instead of issuing HTTP. Secrets live in the host's MCP config.
- `transport: http` — the TMS's public API with credentials from env vars. Works everywhere without host integration.

With no TMS configured, the `markdown` source is a first-class peer (not a degraded fallback): cases live in the repo (manual-qa's `tasks/<suite>/` convention, or any committed case files), and the same `fetch_case`/`update_execution` verbs apply over files. **The case file is upstream input — TA never edits it.**

**Never hardcode a TMS.** All TMS logic flows through the adapter.

### 3. Screen + route

At intake the lead dispatches ONE cheap clustering+sizing pass over the case snapshots (playbook § 1. Intake): it groups similar cases into units and returns per-case **automation-scoping verdicts** — tier, size, and un-automatability judged against the complexity taxonomy. The verdicts are the batch's screening (a case the taxonomy rules out closes `un-automatable` before any build) **and its exclusion budget** — the reviewer later cross-checks every `un-automatable` exclusion in delivered code against them ([`references/coverage-contract.md`](references/coverage-contract.md)).

**The pass is mandatory before the batch opens — this binds WHOEVER fills the orchestrator slot** (the shipped lead, a project manager, an external orchestrator loading this skill), on every host. The verdicts land at `.agents/estimation/<slug>-verdicts.json`; on Claude Code the batch workflow's triage attests that file and lands a `quality_flags` entry in the report when it's missing — running the loop by hand, the orchestrator IS the attestation and writes the same flag into the report it authors at Close. The only sanctioned skip is an explicit operator waiver, recorded in the report note.

Then each unit takes one of **three routes**, decided by `.agents/testing.md § Execution provider` and the evidence on disk (full rules: playbook § The loop, per unit):

| Route | When | What the build works from |
|---|---|---|
| `manual-qa-verified` | provider `manual-qa`; PASS run record + authored case file exist for every case in the unit | their evidence — no re-execution; run id cited as provenance |
| `needs-execution` | provider `manual-qa`; evidence missing or non-PASS | a fresh `test-runner` dispatch per case; PASS → build, FAIL → defect |
| `combined` | provider `self` (no manual-qa on the project) | the engineer's own build; first green run against the real system is the first execution |

When policy says `manual-qa` and the runner cannot be dispatched (agent type unknown on this host), the unit ends `needs-execution` — the report tells the user to run the manual-qa suite and re-run the batch. **Never silently fall back to self-execution.**

### 4–6. Build, review, gate

The engineer builds inside the project's existing framework per the [`test-automation-implementation`](../test-automation-implementation/SKILL.md) skill — the delivered spec carries the **coverage declaration** ([`references/coverage-contract.md`](references/coverage-contract.md)): case id in the test identity, every case step asserted or validly excluded, in the machine-findable grammar. What live probing revealed goes back into the surface cache (`.agents/automation/surface/<feature>.md`). Review is a fresh engineer-typed dispatch walking the case against the code ([`references/reviewer-contract.md`](references/reviewer-contract.md)); the gate is a separate agent proving the trunk N× green plus the blast radius, and grepping the coverage grammar.

---

## The batch pipeline

**Batch is the default unit of work; a single case is a batch of 1.** The orchestrator plans the work set, runs it, and reads one report:

1. **Intake** *(lead)* — resolve the case list, dedup against merged specs and the tracker, snapshot each case body to `.agents/automation/<slug>/cases/<ID>.md` (in-repo case files pass by path instead), dispatch the clustering+sizing pass, read the route policy.
2. **Per unit, in order** — route (evidence or runner dispatch) → build on a branch cut from the trunk → static review → fix rounds to APPROVED → merge back, tree returns to the trunk. **Nothing overlaps:** one tree has one state at a time, and ordering is the only thing that reconciles slots needing different ones.
3. **Build loop** — per unit: build, then static-review, then fix rounds **until the reviewer approves** — a round more whenever a blocker went unaddressed; stop only when every survivor is `persists`/`external` (reviewer-contract § On a RE-REVIEW; runaway backstop 8). **Sequential** — builders write code in the one working tree.
4. **Gate** — once every unit has merged, the trunk carries the batch: N consecutive deterministic green runs over its specs together (default 3), **plus one run of the specs the batch could have broken** — the blast radius, scoped by what the batch *modified*, not what it touched: specs reaching a changed symbol are in; purely additive changes to shared files pull in nothing (playbook § The loop → Run). The gate is **its own agent** — never the builder certifying its own work.
5. **Report** — one write: per-case outcome + coverage + findings + gate verdict. Then the lead merges, routes findings, back-writes the TMS (status + coverage note), and replans whatever isn't `delivered`.

Phases 2–5 are ONE `Workflow` call on Claude Code and the same sequence of dispatches everywhere else. There are no intermediate status writes: the run reports once, and an interrupted one is recovered from git + the run journal, never rebuilt by hand.

Full mechanics and defaults (M/N) live in [`references/orchestration-playbook.md`](references/orchestration-playbook.md) § The loop; dispatch recipes in [`references/commands.md`](references/commands.md).

---

## Anti-patterns

- **Silently self-executing when policy says manual-qa.** A missing runner is a `needs-execution` outcome and a message to the user — never a quiet fallback.
- **Re-executing a case manual-qa already proved.** A PASS run record + authored case file IS the execution evidence; paying the live run twice is the waste the routes exist to prevent.
- **Free-text exclusion reasons.** "Flaky", "hard", "not needed" are invalid grammar — every exclusion is one of the four closed categories with its referent, or it blocks ([`references/coverage-contract.md`](references/coverage-contract.md)).
- **Copying framework conventions from a different project.** Read `.agents/testing.md` and the existing `tests/` directory. Match what's there.
- **Hardcoding the TMS.** Everything goes through the adapter.
- **Wiring a TMS/result reporter that fires on every local run, makes per-test network calls, and spams/fails offline** — gate it (CI/env), make it graceful (the `test-automation-implementation` skill, [`references/reporters.md`](../test-automation-implementation/references/reporters.md)).
- **Scaffolding more than was asked — wiring unsolicited integrations.** A fresh scaffold or setup that adds a TMS/result reporter, analytics, or any network-calling hook the task didn't request and the project doesn't declare. Scaffold minimal; integrations are explicit, gated decisions (`test-automation-implementation` § Hard Rules → 12).
- **Ignoring the seeded write-policy.** Back-writing a TMS, filing a ticket, or posting status on a project whose seed doesn't establish it — **or** skipping a write the seeded way-of-work requires. External writes are governed by `.agents/*` (`test-automation.yaml` § tms, `profile.md` § Bug filing / § Status reporting / § Automation PR policy), decided at seeding: do what the seed says, no more, no less. Seeding itself performs none of these — it only records the policy.
- **Masking a product defect with `test.fail()`, `xit`, `@Ignore`, or weakened assertions.** File the defect and declare a `blocked-by-defect` exclusion — the honest, reviewable form. Hiding the red is never it.
- **One-shot mega-agent.** Context fragmentation is a feature, not a bug. Respect the slot split.
- **Bypassing the orchestrator on routing decisions.** Routing is the orchestrator's call; slots execute their phase and return status. Don't decide who runs next yourself.
- **"I wrote the code and it compiles."** Not done. Not until the test ran green (or the defect is filed and declared), the coverage block is in the code, evidence captured, PR open with the Run Report, and the seeded back-writes done by their owner (orchestrator post-merge; you only when standalone).

## References

- [`references/coverage-contract.md`](references/coverage-contract.md) — the coverage contract: invariants, baseline grammar, closed exclusion vocabulary, per-framework idiom, enforcement split.
- [`references/tms-adapters.md`](references/tms-adapters.md) — adapter contract, supported TMSes, dual-write policy, `.agents/test-automation.yaml` schema.
- [`references/commands.md`](references/commands.md) — framework detection, sub-agent spawning per host, TMS CLI examples, back-write recipes.
- [`references/framework-scaffold.md`](references/framework-scaffold.md) — minimal scaffolds for projects without a framework, per language.
- [`references/browser-tools.md`](references/browser-tools.md) — browser-tool triage for live investigation.
- [`test-automation-implementation`](../test-automation-implementation/SKILL.md) — the engineer's own skill (preloaded by `test-automation-engineer`): slot contract, six-phase loop, route disciplines, Run Report template, the Hard Rules.
- [`references/reviewer-contract.md`](references/reviewer-contract.md) — reviewer slot contract: the case↔code step walk, exclusion checking, masking checks.
- [`references/tech-task-brief.md`](references/tech-task-brief.md) — the unit contract for work that isn't a case (tech-debt, migrations, improvements): required sections, quality gate, example. Sits where the case sits; its blast radius is the gate's run set.
- [`references/framework-architecture.md`](references/framework-architecture.md) — orchestrator's framework-architecture reference: greenfield bootstrap, framework-scale work, mid-flow escalation.
- `scripts/gate/gate-case.mjs` — the **mechanical** half of the gate: fetch, check the branch out in this checkout (no worktree; dirt is refused only when it touches the files being proved or collides with the checkout/merge — unrelated noise rides the verdict as `carriedDirt`), merge the base first, run the spec N× with timings, return a verdict. It never merges a PR, classifies a red, or resolves a conflict.
- `scripts/cleanup.mjs` — close-out sweep for delivered branches and any leftover worktrees, dry-run by default. **You decide, it refuses:** you read `.agents/workflow.md` § Host and ask that system what merged; `--merged` is required and has no fallback probe, and nothing is deleted without a merged claim naming it. The remote comes from `git remote`, not from an assumption.
- `scripts/git-env.mjs` — the few facts a script may read for itself (today: which remote). It states the rule the other scripts follow: **read facts, take conventions as parameters, refuse to guess anything else.**
- **Recovering an interrupted run has no script, on purpose** — it needs this project's branch naming, case-id shape and PR host, which are seed conventions a script can only hardcode wrongly. The procedure is playbook § Interruption and resumption: read the receipts the `SubagentStop` hook already wrote (`.agents/telemetry/automation/returns/`, legacy `_returns/`), then the run journal, then git, then write the report.
- [`references/workflow-accelerant.md`](references/workflow-accelerant.md) — Claude Code's **default** batch path: the whole batch as one deterministic workflow via `scripts/workflows/batch-build.workflow.mjs` (any batch size, one included; exceptions in its § When NOT to use it), which integrates inline (one integrator agent) and gates internally; `batch-integrate.workflow.mjs` remains for the lead's standalone integrate jobs. Also `batch-stabilize.workflow.mjs` for a red gate classified as a flake or test-code bug — batch-level diagnosis before any fix. Other hosts use sequential dispatches, same contracts.
- [`references/campaign-planning.md`](references/campaign-planning.md) — composing batches for scale: campaigns (waves + foundation pass + clusters of similar cases), plan proposed by a dispatched planner, conducted by `scripts/workflows/batch-campaign.workflow.mjs`; the lead reviews plans and reads one report per wave, never case bodies.
- [`agents/test-automation-lead/AGENT.md`](../../agents/test-automation-lead/AGENT.md) — orchestration: routing, dispatch templates, coverage gating, automation merge gate, framework architecture.
