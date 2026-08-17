# Test Automation Team (`test-automation`)

A **universal** automation-focused agent team that turns TMS cases into merged,
honest automated tests — across **any framework, any test type (UI, API, mobile,
performance, …), and any TMS.** The team matches whatever the project already
uses rather than imposing a tool. A lead orchestrator (Tal) runs the batch
pipeline (one unit at a time: live analysis → implement + static review → merge →
one hardening gate per batch), owns test-framework architecture, and owns the
automation merge gate.

## Install

```bash
npx github:arozumenko/sdlc-skills init --bundle test-automation
```

## Quick start

The pipeline runs in **three phases**. You launch `scout` once, then drive
**Tal** directly for every automation task; Tal runs the batch pipeline —
units run one at a time on a batch trunk, implement + static review per unit, one
hardening gate per batch — dispatching each slot as a subagent.

Launch each as your **main agent** straight from the terminal (Claude Code):

```bash
claude --agent scout                 # Phase 1 — seed the repo (once)
claude --agent test-automation-lead  # Phase 2+ — drive every automation task
```

GitHub Copilot CLI finds the same agents in `.github/agents/` on its own, and
reads the repo-root `.mcp.json` as workspace servers — no extra wiring. Add
`--yolo` (or at least `--allow-all-tools`), or an orchestrator that dispatches
subagents stalls on every confirmation:

```bash
copilot --agent scout
copilot --agent test-automation-lead --yolo
```

In the VS Code extension, pick the agent in the chat panel and switch the
session to auto-approve/bypass first. Full per-host detail, flag table, and
the CI form: [onboarding § Launching the agents](../../docs/onboarding/test-automation.md#launching-the-agents--run-them-as-your-main-agent).

**Install (once)** — `npx github:arozumenko/sdlc-skills init --bundle test-automation`.
Drops the four agents into `.claude/`, pulls their skills (incl.
`test-automation-workflow` + `test-case-analysis`), wires the memory/context
hooks, and splices `instructions.md` into `AGENTS.md`.

**Before Phase 1 — two prerequisites.** scout's tool-wiring inspects the
**live MCP servers + installed skills** on the host, so wire those *before*
scouting: **(A)** install any project-specific skills the roster doesn't declare
— find them with `npx skills find <tech>` (e.g. `playwright`, `appium`) or the
registry catalogue ([`skills.json`](../../skills.json)), and **(B)** wire MCP /
connectivity in the **host** (never the repo) — the installer can do it:
`init --bundle test-automation --interactive` (menu) or `--mcp playwright,atlassian,onetest,elitea-next`.
Full detail — plus the **way-of-work** you set at seeding (task source, TMS/tracker
reporting, bug-vs-subtask filing, branch + PR policy):
[onboarding § Prerequisites → Before you seed](../../docs/onboarding/test-automation.md#before-you-seed).

**Phase 1 — Inception (`scout`, once per repo).** Launch scout as your main
agent — `claude --agent scout` — then tell it: _"Onboard this repo for the
test-automation workflow."_ It asks you what it can't infer,
explores the repo, then generates the project config — `AGENTS.md` plus the
`.agents/` set, recording the test framework, TMS adapter, base branch,
merge policy, and credential matrix into `profile.md` / `workflow.md`, and
seeding a per-role briefing under `.agents/memory/<role>/`. **Why it's
first:** the whole pipeline reads this config. scout is the thorough, dedicated
onboarding pass (full interview, PR-history mining, the `session-retrospective`
refresh). Skip it and Tal still **self-orients** — he runs the *same*
`seeding-automation-project` skill himself to seed the `.agents/*` set rather than
dead-stopping — but a deliberate scout pass is richer, so prefer it when you can.

You don't need to fill in a rigid form — plain language works, scout will ask
for whatever's missing:

> Onboard this repo for the test-automation workflow. We track work in Jira,
> project `PLAT` (https://ourco.atlassian.net/browse/PLAT). Test cases live in
> Zephyr Scale, same project key. I'll drop you case IDs to automate — file
> each as a sub-task under our `PLAT-4200` automation epic. If you find a bug
> along the way, open it as its own Jira ticket (not a sub-task) and link the
> case ID in the description. After a run, push pass/fail back to the Zephyr
> Scale execution record so the TMS stays honest — don't skip that. PRs branch
> off `develop`; auto-merge once review green, that's fine by
> default. Ask me about anything else you need.

For a **GitHub-only** shop (no Jira) it reads just as plainly:

> Onboard this repo. Everything's tracked as GitHub issues in this repo — no
> separate TMS, test cases live as markdown under `test-specs/`. File each
> automation task as its own issue under the `Automation` milestone, and open
> bugs as regular issues too, linked back to the file. Auto-merge is fine.

See [onboarding § Seed via scout](../../docs/onboarding/test-automation.md#2-seed-via-scout)
for the full field-by-field prompt if you'd rather be explicit up front.

**Phase 2 — Usage (Tal runs the batch pipeline).** Launch Tal as your main
agent — `claude --agent test-automation-lead` — and drop a batch of TMS cases
on him (a single case is just a batch of one): _"Automate TC-1234, TC-1235,
TC-1236."_ He resolves the work set with **one TMS sweep** and snapshots each
case body to disk (**Intake**), then launches the run. **Units run one at a
time on a batch trunk** — analyse live (`qa-engineer` explores the real app and
commits its AFS to the trunk) → the **status gate** (`ready-for-automation` and
`extend-existing` advance) → implement on a branch cut from the trunk
(`test-automation-engineer` green once, PR open) → a fresh `qa-engineer` runs a
**static** review (no execution) → fix rounds until approved → merge back, and
the tree returns to the trunk for the next unit. Nothing overlaps: one tree has
one state at a time. Once every unit has merged, the **hardening gate** — its
own agent, never the one who wrote the code — runs the batch's specs together
for N consecutive green (default 3), plus one run of the specs the batch could
have broken. Then **one report**. Tal reads it and closes: merges the
`automated` cases, routes any findings, back-writes the TMS/tracker once, and
replans whatever didn't land. **The logic:** each subagent boots
from a fresh context that the `agent-start` hook seeds with the shared
`.agents/*` config and its own memory — so every analyst, implementer, and
reviewer already knows the framework, merge policy, and TMS adapter.

**Not just cases.** Tech-debt, migrations, framework improvements and suite
health run the **same loop** — a [tech-task brief](skills/test-automation-workflow/references/tech-task-brief.md)
takes the AFS's place as the unit contract, and everything downstream is
unchanged (build → static review → merge → one gate). For scale beyond a single
batch, batches compose into **campaigns** (waves + a foundation pass + clusters
of similar cases): [`campaign-planning.md`](skills/test-automation-workflow/references/campaign-planning.md).

**Phase 3 — Reinforcement (assisted; owned by `scout`, not Tal).** Two
moving parts, and only one is automatic:
- **Replay is automatic.** The hooks re-inject each role's memory snapshot
  and the shared `.agents/*` config at every dispatch (survives `/clear`,
  compaction, resume) — it only replays what's already written.
- **Capture is assisted.** The pipeline agents jot durable facts (framework
  quirks, recurring flake causes, review patterns) into
  `.agents/memory/<role>/` when worth keeping, and you periodically **re-run
  `scout`** to refresh the shared config + briefings — scout re-reads the
  **code, PR history, and (via the `session-retrospective` skill) past agent
  sessions**, proposes the delta, and **waits for your ack**.
  Tal orchestrates the pipeline; scout owns the durable project lens, so the
  refresh is a scout job.

**Note:** mining past sessions is **on-demand, not automatic** — it happens
only when you run scout's `session-retrospective`, which proposes deltas you
must ack. The automatic half of reinforcement is just the hooks replaying
already-written `.agents/memory/` content at dispatch.

**Phase 0 (optional, before or alongside Phase 1) — Scoping.** Need a cost/
time estimate for a batch of cases *before* committing to automating them —
presales, a proposal, "how long would this take"? That's scout's
`automation-scoping` skill: works from case text alone (no app access
needed), from a representative sample of a larger backlog, refined with a
live app check when access exists, and recalibrated against a project's own
delivered-case history once one exists (the same "mine what happened, propose
a delta" shape as `session-retrospective`, applied to estimation accuracy
instead of memory). Always outputs a range with a stated confidence level,
never a bare number.

**What it costs (measured, not remembered).** Ask _"what did this batch
cost?"_ and the `efficiency-audit` skill breaks metered spend down per session,
per role, per day and per sub-agent, then joins it to the run's own report for
**cost per case delivered** and **per case examined**. The `tokenomics` skill
ships with the bundle too: once its capture hooks are enabled (opt-in),
session hooks record each finished session into a git-committed ledger
(`.agents/telemetry/automation/`) — surviving transcript expiry, across Claude Code,
Copilot CLI and the VS Code sidebar — and every batch gets an automatic
`.agents/automation/<slug>/cost.json`: outcomes, cost per case (direct,
measured), overhead shown once, avg/median/min/max spreads, with markdown and
self-contained HTML views via `team-report.mjs --batch <slug>` and an optional
cross-factory dataset export.

**A kickstarter, not a locked product.** Everything installed is plain files,
and tuning is expected — but tune the **project knowledge** (`.agents/`, via
scout's retrospective or a plain ask), not the agent files: that keeps your
install cleanly updatable with `init --update`. Edit agents/skills themselves
only to contribute back or to deliberately fork your own variant.

### How it flows

```mermaid
flowchart TD
    install(["npx … init --bundle test-automation"]) --> scout

    subgraph p1["Phase 1 — Inception · you launch scout (once per repo)"]
        scout["scout (kit) — interview + explore"]
        seed[/"project config: AGENTS.md + .agents/<br/>(framework, TMS, base branch,<br/>merge policy, per-role briefings)"/]
        scout --> seed
    end

    subgraph p2["Phase 2 — Usage · you launch Tal with a batch (or a single case)"]
        tal["test-automation-lead (Tal)<br/>plans the work set, launches the run, owns the merge"]
        intake["Intake — one TMS sweep, dedup,<br/>case snapshots to disk, clustering"]
        analyst["Analyse — one unit at a time, on the trunk<br/>qa-engineer: live exploration, commits its own AFS"]
        afsgate{"AFS advances?<br/>(ready-for-automation /<br/>extend-existing)"}
        build["Build — branch cut FROM the trunk<br/>test-automation-engineer: green once<br/>+ qa-engineer (fresh): STATIC review"]
        integ["Merge back into tests/batch-&lt;slug&gt;<br/>mechanical unions only; semantic → parked<br/>tree returns to the trunk → next unit"]
        hgate{"Hardening gate — its own agent<br/>N× consecutive green over<br/>the batch's specs together"}
        report[/"ONE report — per-case outcome<br/>+ findings + gate verdict"/]
        close(["Tal closes — merges, routes findings,<br/>one TMS/tracker write, replans the rest"])
        tal --> intake --> analyst --> afsgate
        afsgate -->|"yes"| build --> integ --> analyst
        integ -->|"all units done"| hgate
        hgate -->|"N green → automated"| report
        hgate -->|"red → blocked"| report
        afsgate -->|"blocked / covered / un-automatable / …"| report
        report --> close
        close -. "the remainder is the next batch" .-> tal
    end

    seed -->|"pipeline boots from this"| tal
    case[/"a TMS case or batch"/] --> tal

    subgraph p3["Phase 3 — Reinforcement · assisted (you re-run scout)"]
        mem[(".agents/memory/&lt;role&gt;/<br/>briefings · curated entries · daily log")]
    end

    tal -. "jot learnings (assisted)" .-> mem
    build -. "jot learnings (assisted)" .-> mem
    scout -. "re-run scout to refresh —<br/>proposes delta, waits for ack" .-> mem
    mem == "auto-replayed at every dispatch<br/>(survives /clear · compact · resume)" ==> tal
```

### Where state lives

Under `.agents/automation/<slug>/`: the **case snapshots** Tal writes at
Intake (`cases/<ID>.md` — one TMS fetch per case, and every worker
triangulates against the identical body), and the **report** the run writes at
the end (`report.json` + `report.md` — one row per case: its outcome, any
findings, the gate verdict). The TMS and any tracker are **import/mirror
boundaries** only: one sweep in at Intake, one sweep out at close.

There is deliberately **no progress board**. Progress only needs recording if
something reads it mid-run, and nothing does — so a batch that is interrupted
is recovered from evidence that already exists rather than from bookkeeping
somebody had to maintain: `resumeFromRunId` replays the run from cache, or
Recovery folds git (AFS files on base, branches, merged PRs) and
the run journal into the same report **plus the remainder** to feed the next
batch. Measured, that is also more accurate than the board it replaced, which
had 4 of 12 merged cases mis-stated on one campaign.

## Roster

| Role | Agent | Source | Job |
|---|---|---|---|
| Lead / orchestrator (PM + tech-lead combined) | `test-automation-lead` (Tal) | bundle-local | Runs the batch pipeline, owns framework architecture + the automation merge gate. The user launches Tal directly. |
| Onboarding | `scout` | bundle-local | Seeds framework / TMS / base branch / merge policy into `.agents/`. |
| Implementer | `test-automation-engineer` (Axel) | bundle-local | Turns a ready AFS into a PR + Run Report. |
| Analyst + Reviewer | `qa-engineer` (Sage) | bundle-local | Writes the AFS (analyst); reviews for test honesty (reviewer, fresh session). |

The pipeline-critical skills — `test-automation-workflow` and
`test-case-analysis` — are bundle-local (`localSkills` in `bundle.json`) and
install with the agents that declare them in their frontmatter. The project's TMS adapter skill loads conditionally
(e.g. `xray-testing` for an Xray project, only when the project declares
`tms.adapter: xray`).

## When to use it

- A **test-automation-only** engagement, or any project where automation work
  runs as its own pipeline with a dedicated lead.
- You want a single orchestrator (Tal) to own routing, framework decisions, and
  the automation merge — without standing up a full feature-development team.

Compared to **`feature-development`**, which includes `test-automation-engineer` +
`qa-engineer` as part of a cross-platform delivery team but has no automation
orchestrator, this bundle adds Tal and focuses the whole team on the
TMS → merged-test pipeline.

## What gets installed

- The four agents above (all bundle-owned — Tal and the other three copied from
  this bundle), with their declared skills.
- `test-automation-workflow` + `test-case-analysis` skills (bundle-local, via
  `localSkills` + the agents' frontmatter).
- Project briefings seeded to `.agents/memory/<role>/project_briefing.md` for all
  four roles.
- Team conventions spliced into `AGENTS.md` (inside
  `<!-- BUNDLE:test-automation -->` markers).
