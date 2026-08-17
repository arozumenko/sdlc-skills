---
name: test-automation-workflow
description: "Use when TMS test cases need to become automated tests — a single case or a batch — or when technical suite work (tech-debt, migrations, improvements, suite health) needs planning and batching. Batch pipeline: units run one at a time on a batch trunk — live analysis (or a tech-task brief for non-case units), implement, static review, merge back — then one N×-green hardening gate per batch and one TMS/tracker mirror sweep. Pluggable TMS (Zephyr/TestRail/Xray/Azure/markdown)."
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.2.0"
---

## Test Automation Workflow — the IC process

This skill describes how individual contributors (analyst, implementer, reviewer) do their craft inside the analyst → implementer → reviewer pipeline. **Orchestration of that pipeline is the `test-automation-lead` agent's job.** That role owns slot routing, dispatch templates, AFS quality gating, status discipline, automation merge gate, and framework architecture decisions. This skill describes what each IC slot does once dispatched.

If you arrived here looking for routing / slot defaults / "when to involve tech-lead" / canonical dispatch prompts, read [`agents/test-automation-lead/AGENT.md`](../../agents/test-automation-lead/AGENT.md). On projects without `test-automation-lead` installed, those responsibilities fall to whichever agent has been substituted via `.agents/role-overrides.md`.

**Core philosophy:** do not automate what you have not executed. Every case is run manually first against the real system — amortized, never skipped: a plan-declared cluster of flow-variants gets ONE live session in which each case's distinct steps/rows are still executed and observed individually (test-case-analysis § Cluster dispatches) — with whatever tool fits the surface under test — a browser for UI, an HTTP client for API, a device/emulator for mobile, a load tool for perf (for a Playwright/browser project that's `playwright-testing` over MCP, `playwright-cli` from the shell, or `browser-verify` over CDP; full triage in [`references/browser-tools.md`](references/browser-tools.md)) — so defects, missing data, and environmental gaps surface *before* a line of automation code is written. Then a separate engineer implements the automation inside the project's existing framework. Then a reviewer statically reviews it, and the orchestrator's batch hardening gate independently re-runs it N× before merge.

**Why split the work across slots:** context. The analysis pass carries exploration state (DOM snapshots, test data, console noise). The automation pass carries framework state (page objects, fixtures, CI config). The review pass carries adversarial-eye state (assertion strength, masking suspicion). Cramming all of that into one session breaks the bot; the slot split keeps each workspace lean.

## Orchestrator slot contract

This skill section IS the orchestrator-slot contract for the test-automation pipeline. When any agent is filling the orchestrator role — `test-automation-lead` by default, or any other agent named in `.agents/team-comms.md` § Roster — role, behavior, dispatch mechanics, and decision rules are fixed here so the role is **portable**: load this skill + point the roster at any orchestrator-capable agent.

**Role.** Route test-automation work through the analyst → implementer → reviewer pipeline, gate AFS quality, classify blockers and route them, own the automation merge, own test-framework architecture decisions. Cases are the common instance, not the boundary: technical work — tech-debt, migrations, improvements, suite health — runs the same loop with a [tech-task brief](references/tech-task-brief.md) where the AFS would be (playbook § The same loop runs work that isn't a case).

**Session context — read once at session start.** Typically auto-imported via your agent's `AGENT.md`; if your agent doesn't auto-import, read them now:

- `.agents/profile.md` — project systems map (issue tracker, TMS, base branch, merge policy)
- `.agents/workflow.md` — branch/PR conventions, EPIC pattern, sub-task filing rules
- `.agents/testing.md` — framework, run commands, fixture/POM conventions, locator strategy, merge-gate N
- `.agents/team-comms.md` — host, dispatch syntax, installed roster
- `.agents/role-overrides.md` (if present) — slot substitutions when the default agent isn't installed

Missing files are tolerated; when ALL are absent the project was never seeded — **self-orient by running the `seeding-automation-project` skill yourself** (scout's own onboarding procedure — load it on demand), asking the user only for the blocking unknowns it can't infer, then proceed — rather than dead-stopping. Full procedure: [`references/orchestration-playbook.md`](references/orchestration-playbook.md) § Self-orientation.

**Per-batch parameters** (caller / user provides):

- One or more TMS case IDs (or "all of SPRINT-42's regression suite", etc.)
- Implicit: `.agents/profile.md` § Automation PR policy (base branch, merge policy, merge strategy)

**Return contract:**

- Status updates at batch milestones, not after every turn (see playbook § Status reporting — milestones)
- After each merge: tracker close + TMS back-write + user notification
- Escalations classified and routed (see playbook § Handling blockers)

**One report, not a running state.** A run says where each case ended — seven terminal outcomes (`automated` · `already-covered` · `out-of-scope` · `un-automatable` · `merged-sanctioned-red` — merged while red *by design*, the red pre-declared against a ticketed open defect · `blocked` · `not-started`), each with any `findings[]` it produced, written once to `.agents/automation/<slug>/report.{json,md}`. One outcome is deliberately NOT terminal: `merged-ungated` — the unit is built, reviewed and merged on the trunk but an interrupted run's gate never produced a verdict. It means "re-run the gate", never "failed"; labelling such units `blocked` is how a dead run's summary once claimed `blocked: 14` while 13 of 14 were merged (playbook § anti-patterns). And when a re-run gate — yours, or a stabilize round's — finally produces the verdict, **write it back into the report** (playbook § Close): the report is the receipt every audit and next-batch plan reads; a recovered-green batch left `merged-ungated` scores as undelivered. There is no board and no mid-run bookkeeping, because nothing reads progress while the run is live. That is also the compaction story: an interrupted run resumes from cache (`resumeFromRunId`), or you rebuild it by reading what is already on disk — the hook's receipts, the run journal, then git — and write the report yourself (playbook § Interruption and resumption). Either way the **remainder** feeds the next batch. What the orchestrator writes down the moment it learns it — because nothing else holds it — is the runId, operator decisions, and checkpoint args (playbook § Where state lives, § Interruption).

**Default execution shape — workflows, standing opt-in.** On Claude Code, a batch of ANY size — one case included — runs as ONE deterministic workflow via the shipped scripts ([`references/workflow-accelerant.md`](references/workflow-accelerant.md)) — it merges each unit as it is approved and gates the trunk, then hands back the report. **This skill's instruction is the standing explicit opt-in the Workflow tool's multi-agent gate requires** — the orchestrator neither asks the operator again nor re-litigates the gate per batch, and falls back to sequential dispatches only for the accelerant's § When NOT to use it (an atomic fix, an unseeded project, no Workflow tool, or an operator supervising step by step — a batch of one is NOT an exception; it runs through the workflow like any other); a shape no shipped script fits is authored/forked per accelerant § Extending, not hand-run. On every other host: sequential dispatches, same contracts — the outcome vocabulary, the findings channel, the gate's independence, and **the fix loop's stop conditions** (rounds continue while any blocker is `unaddressed`; they stop only when what remains is `persists` or `external` — [`reviewer-contract.md`](references/reviewer-contract.md) § On a RE-REVIEW) hold on both paths. Where a script runs the loop on Claude Code, the orchestrator *is* the loop elsewhere; nothing about the contract changes, only who executes it. Either way the orchestrator stays **context-frugal** (playbook Critical rule 7): plans, dispatches, and verdicts in context; payloads — case bodies, diffs, logs — on disk and in PRs where the slots read them.

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

**Full playbook** — the batch loop, dispatch mechanics, pre-flight checklists, canonical dispatch templates, AFS quality gate, status discipline, tracker discipline, status reporting, handling blockers, R2 cap rule, framework architecture (greenfield / framework-scale / mid-flow), merge protocol, anti-patterns — lives in [`references/orchestration-playbook.md`](references/orchestration-playbook.md). **Load it by situation, not by ritual.** On the workflow path the scripts carry the loop and the report's `next:` names your close moves — open the specific section when its moment arrives: red gate → § Handling blockers · interrupted run → § Interruption and resumption · unseeded project → § Self-orientation · framework decision → § Framework architecture · non-case batch → § The same loop runs work that isn't a case · batch close (scope outcomes, batch report, publish) → § 3. Close. Running the loop **by hand** — no Workflow tool, another host, sequential dispatches — the playbook *is* the loop: read it before the first dispatch.

**Wiring this role on a project.** To swap the default orchestrator for another agent (e.g. PM):

1. Add `test-automation-workflow` to the substitute agent's `skills:` frontmatter.
2. Update `.agents/team-comms.md` § Roster so the orchestrator slot points at the substitute.
3. The substitute now has the orchestrator slot contract + playbook access — the test-automation lead role is filled without `test-automation-lead` agent being installed.

## Implementer slot contract

Take a `ready-for-automation` / `extend-existing` AFS → PR-ready diff + Run
Report, green once locally (the batch hardening gate proves determinism).
Retry budget ≤2 reruns on the same root cause. Full procedure — six-phase
loop, Run Report template, the 12 Hard Rules —
in the [`test-automation-implementation`](../test-automation-implementation/SKILL.md) skill,
the implementer's own preloaded skill.
Hard-Rules index: match the project's framework · no defect masking · respect
the abstraction layer · env vars, never hardcoded values · no sleeps · most
stable semantic handle · reuse before create · helpers are trusted ·
data-dependency → serial · read-only-by-default · shared files have one writer
on base · scaffold minimal.

## The eight steps (IC view)

```
1. Discover framework          (read what scout produced)
2. Ingest case from TMS         (pluggable adapter)
3. Execute manually             (analyst slot via `test-case-analysis`)
4. Produce automation-ready spec (analyst emits AFS markdown)
5. Implement automation         (implementer six-phase loop — the `test-automation-implementation` skill)
6. Run & stabilize              (implementer — green or real defect; Run Report)
7. Review                       (reviewer slot + code-review skill)
8. Deliver & sync TMS           (completing-a-task; orchestrator back-writes post-merge)
```

Steps 1–4 belong to the analyst slot (driven by [`test-case-analysis`](../test-case-analysis/SKILL.md)). Steps 5–6 belong to the implementer slot (driven by the [`test-automation-implementation`](../test-automation-implementation/SKILL.md) skill). Step 7 is the reviewer slot (driven by [`code-review`](../code-review/SKILL.md)). Step 8 is the handoff.

`test-automation-lead` resolves each slot to a concrete agent at dispatch time. ICs don't need to know the routing rules — they need to know how to execute their phase once dispatched.

### 1. Discover framework

Before anything, read what scout / seeding-automation-project produced:

- `AGENTS.md` — tech stack, test commands
- `.agents/testing.md` — test framework, commands, fixtures, CI
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

A case can come from a **TMS** (the most common source in practice) or from another source — a **markdown** spec in-repo, a linked **story/issue**, or a plain **URL/feature** brief. The source + adapter + transport are declared in `.agents/test-automation.yaml` (see [`references/tms-adapters.md`](references/tms-adapters.md)); if unset, the source defaults to `markdown`. For a TMS source there are two further axes — **adapter** (which TMS) and **transport** (HTTP or MCP).

Supported adapters out of the box: `zephyr-scale`, `testrail`, `xray`, `azure-test-plans`, `markdown` (plain files). Each adapter exposes the same verbs regardless of transport:

```
fetch_case(id)       → returns { id, name, preconditions, steps, expected, cleanup, links }
update_execution(id, status, evidence) → back-writes result
```

**Full-field fetch is mandatory.** TMS adapters typically expose a "quick search" verb (returns minimal fields) and a "full fetch" verb (returns all custom fields including step + expected text). **Always use full fetch.** If your adapter has only quick-search and the step text comes back null, the case is unusable — stop and ask `test-automation-lead` how to get the full content (open the case in the browser and copy, if necessary). Never proceed on a partial case.

**Transport choice:**

- `transport: mcp` — preferred when the host has a TMS MCP server configured (Elitea, Atlassian Remote MCP, vendor TestRail / Xray MCP). The adapter calls `mcp__<server>__<tool>` instead of issuing HTTP. Secrets live in the host's MCP config.
- `transport: http` — the TMS's public API with credentials from env vars. Works everywhere without host integration.

With no TMS configured, the `markdown` source is a first-class peer (not a degraded fallback): cases live in `test-specs/{feature}/l{priority}_{name}.md`, and the same `fetch_case`/`update_execution` verbs apply over files.

**Never hardcode a TMS.** All TMS logic flows through the adapter.

### 3. Execute manually (analyst slot)

The analyst — typically `qa-engineer`, occasionally a substitute — runs the case step-by-step against the real application, using the [`test-case-analysis`](../test-case-analysis/) skill:

- UI cases → [`playwright-testing`](../playwright-testing/) MCP tools, preferring `browser_snapshot` for accessible-name discovery.
- Fallback / deep inspection → [`browser-verify`](../browser-verify/) (CDP — real input events, computed styles, storage).
- API cases → `curl` / project's HTTP client.

For every step: screenshot, console, network. For every assertion: proof.

**Output of this phase is truth, not code.** What actually happened, not what the case says should happen.

### 4. Produce automation-ready spec (AFS)

The analyst writes an **Automation-Friendly Spec** (AFS) — a markdown file in `test-specs/{feature}/l{priority}_{slug}_{tms-id}.md`. Format and required sections live in [`skills/test-case-analysis/references/spec-format.md`](../test-case-analysis/references/spec-format.md).

**AFS quality bar — implementer-readable contract.** Every AFS must satisfy:

- **User set** — explicitly names the env var keys (e.g. `${TEST_USER}` / `${TRIAL_USER}` for projects with multi-credential sets), per spec-format's metadata block.
- **Test data inventory** — three buckets: `reuse-existing` / `generate-per-test` / `generate-shared-with-cleanup`. Every datum classified.
- **Coverage Map** (spec-format § Coverage Map) — Axis 1 has a row + disposition for **every** original-case element: each step, plus any requirement carried by the description or preconditions (pure-setup preconditions reflected in AFS § Preconditions) — nothing silently dropped; decomposition shown in "Covered by". Axis 2 lists every assertion added beyond the case. This is the traceability spine the implementer walks and the reviewer ticks.
- **Stable handles discovered, not guessed** — every handle came from real observation (a `browser_snapshot` / DOM inspection for UI, a real response for API, an accessibility-id for mobile). Unobserved handles marked "to-verify in implementer Phase 2 (Explore)".
- **Known Defects Found** — every defect filed with ticket ID + recommended handling (`expect.soft()` or natural-fail).
- **Cleanup steps** — state mutations + reset between runs.

An AFS missing any of these is `blocked`, not `ready-for-automation`. `test-automation-lead` enforces this gate before forwarding to the implementer.

If the case cannot be automated at all (e.g. physical card reader), the analyst says so explicitly and stops. Don't write automation for un-automatable cases.

## Reviewer slot

Static review — triangulate the original case ↔ AFS ↔ diff, verify per-step
assertions and hunt masking; no execution (the hardening gate runs the spec).
Full checklist in [references/reviewer-contract.md](references/reviewer-contract.md).

---

## The batch pipeline

**Batch is the default unit of work; a single case is a batch of 1.** The orchestrator plans the work set, runs it, and reads one report:

1. **Intake** *(lead)* — resolve the case list, dedup against existing AFS files, snapshot each case body to `.agents/automation/<slug>/cases/<ID>.md`, cluster similar cases.
2. **Per unit, in order** — analyse live (the analyst owns the tree and commits its own AFS to the trunk) → implement on a branch cut from the trunk → static review → fix rounds to APPROVED → merge back, tree returns to the trunk. **Nothing overlaps:** one tree has one state at a time, and ordering is the only thing that reconciles slots needing different ones.
3. **Build loop** — per unit: implement, then static-review, then fix rounds **until the reviewer approves** — a round more whenever a blocker went unaddressed; stop only when every survivor is `persists`/`external` (reviewer-contract § On a RE-REVIEW; runaway backstop 8). **Sequential** — implementers write code in the one working tree.
4. **Gate** — once every unit has merged, the trunk carries the batch: N consecutive deterministic green runs over its specs together (default 3), **plus one run of the specs the batch could have broken** — the blast radius, scoped by what the batch *modified*, not what it touched: specs reaching a changed symbol are in; purely additive changes to shared files pull in nothing (playbook § The loop → Run). The gate is **its own agent** — never the implementer certifying its own work.
5. **Report** — one write: per-case outcome + findings + gate verdict. Then the lead merges, routes findings, and replans whatever isn't `automated`.

Phases 2–5 are ONE `Workflow` call on Claude Code and the same sequence of dispatches everywhere else. There are no intermediate status writes: the run reports once, and an interrupted one is recovered from git + the run journal, never rebuilt by hand.

Full mechanics and defaults (M/K/N) live in [`references/orchestration-playbook.md`](references/orchestration-playbook.md) § The loop; dispatch recipes in [`references/commands.md`](references/commands.md).

---

## Anti-patterns

- **Automating an unexecuted case.** You don't know what the app does until you've driven it. Don't skip step 3.
- **Copying framework conventions from a different project.** Read `.agents/testing.md` and the existing `tests/` directory. Match what's there.
- **Hardcoding the TMS.** Everything goes through the adapter.
- **Wiring a TMS/result reporter that fires on every local run, makes per-test network calls, and spams/fails offline** — gate it (CI/env), make it graceful (the `test-automation-implementation` skill, [`references/reporters.md`](../test-automation-implementation/references/reporters.md)).
- **Scaffolding more than was asked — wiring unsolicited integrations.** A fresh scaffold or setup that adds a TMS/result reporter, analytics, or any network-calling hook the task didn't request and the project doesn't declare. Scaffold minimal; integrations are explicit, gated decisions (`test-automation-implementation` § Hard Rules → 12).
- **Ignoring the seeded write-policy.** Back-writing a TMS, filing a ticket, or posting status on a project whose seed doesn't establish it — **or** skipping a write the seeded way-of-work requires. External writes are governed by `.agents/*` (`test-automation.yaml` § tms, `profile.md` § Bug filing / § Status reporting / § Automation PR policy), decided at seeding: do what the seed says, no more, no less. Seeding itself performs none of these — it only records the policy.
- **Masking a product defect with `test.fail()`, `xit`, `@Ignore`, or weakened assertions.** A red test is the correct signal. File the bug, don't hide it.
- **One-shot mega-agent.** Context fragmentation is a feature, not a bug. Respect the slot split.
- **Bypassing the orchestrator on routing decisions.** Routing is the orchestrator's call; ICs execute their phase and return status. Don't decide who runs next yourself.
- **"I wrote the code and it compiles."** Not done. Not until the test ran green (or red for a real product reason), evidence captured, PR open with the Run Report, and the seeded back-writes done by their owner (orchestrator post-merge; you only when standalone).

## References

- [`skills/test-case-analysis/references/spec-format.md`](../test-case-analysis/references/spec-format.md) — AFS structure, required sections, examples.
- [`references/tms-adapters.md`](references/tms-adapters.md) — adapter contract, supported TMSes, `.agents/test-automation.yaml` schema.
- [`references/commands.md`](references/commands.md) — framework detection, sub-agent spawning per host, TMS CLI examples, AFS template.
- [`references/framework-scaffold.md`](references/framework-scaffold.md) — minimal scaffolds for projects without a framework, per language.
- [`references/browser-tools.md`](references/browser-tools.md) — browser-tool triage for analyst execution.
- [`test-automation-implementation`](../test-automation-implementation/SKILL.md) — the implementer's own skill (preloaded by `test-automation-engineer`): slot contract, six-phase loop, Run Report template, the 12 Hard Rules.
- [`references/reviewer-contract.md`](references/reviewer-contract.md) — reviewer slot contract: static-review checklist, triangulate-three-artifacts, masking checks.
- [`references/tech-task-brief.md`](references/tech-task-brief.md) — the unit contract for work that isn't a case (tech-debt, migrations, improvements): required sections, quality gate, example. Sits where the AFS sits; its blast radius is the gate's run set.
- [`references/framework-architecture.md`](references/framework-architecture.md) — orchestrator's framework-architecture reference: greenfield bootstrap, framework-scale work, mid-flow escalation.
- `scripts/gate/gate-case.mjs` — the **mechanical** half of the gate: fetch, check the branch out in this checkout (no worktree; dirt is refused only when it touches the files being proved or collides with the checkout/merge — unrelated noise rides the verdict as `carriedDirt`), merge the base first, run the spec N× with timings, return a verdict. It never merges a PR, classifies a red, or resolves a conflict.
- `scripts/cleanup.mjs` — close-out sweep for delivered branches and any leftover worktrees, dry-run by default. **You decide, it refuses:** you read `.agents/workflow.md` § Host and ask that system what merged; `--merged` is required and has no fallback probe, and nothing is deleted without a merged claim naming it. The remote comes from `git remote`, not from an assumption.
- `scripts/git-env.mjs` — the few facts a script may read for itself (today: which remote). It states the rule the other scripts follow: **read facts, take conventions as parameters, refuse to guess anything else.**
- **Recovering an interrupted run has no script, on purpose** — it needs this project's branch naming, case-id shape and PR host, which are seed conventions a script can only hardcode wrongly. The procedure is playbook § Interruption and resumption: read the receipts the `SubagentStop` hook already wrote (`.agents/telemetry/automation/returns/`, legacy `_returns/`), then the run journal, then git, then write the report.
- [`references/workflow-accelerant.md`](references/workflow-accelerant.md) — Claude Code's **default** batch path: the whole batch as one deterministic workflow via `scripts/workflows/batch-build.workflow.mjs` (any batch size, one included; exceptions in its § When NOT to use it), which integrates inline (one integrator agent) and gates internally; `batch-integrate.workflow.mjs` remains for the lead's standalone integrate jobs. Also `batch-stabilize.workflow.mjs` for a red gate classified as a flake or test-code bug — batch-level diagnosis before any fix. Other hosts use sequential dispatches, same contracts.
- [`references/campaign-planning.md`](references/campaign-planning.md) — composing batches for scale: campaigns (waves + foundation pass + clusters of similar cases), plan proposed by a dispatched planner, conducted by `scripts/workflows/batch-campaign.workflow.mjs`; the lead reviews plans and reads one report per wave, never case bodies.
- [`agents/test-automation-lead/AGENT.md`](../../agents/test-automation-lead/AGENT.md) — orchestration: slot routing, dispatch templates, AFS gating, automation merge gate, framework architecture.
