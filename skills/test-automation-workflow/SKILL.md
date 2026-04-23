---
name: test-automation-workflow
description: End-to-end test automation workflow — Explore → Specify → Implement → Review — with a pluggable TMS (Zephyr Scale / TestRail / Xray / Azure Test Plans / markdown). Load for "automate TC-NNN", "convert this case to Playwright", "wire these Zephyr cases into the framework", or any flow from a manual test case to green framework-resident tests.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

## Test Automation Workflow: Explore → Specify → Implement → Review

**Core philosophy:** do not automate what you have not executed. Every case is
run manually (via `browser-verify` or Playwright MCP) first — defects, missing
data, and environmental gaps are surfaced *before* a line of automation code is
written. Then a separate engineer implements the automation inside the
project's existing framework. Then a reviewer re-runs it.

**Why split the work into two agents:** context. The analysis pass
carries exploration state (DOM snapshots, test data, console noise)
through the `test-case-analysis` skill — Sage (qa-engineer) owns that.
The automation engineer carries framework state (page objects,
fixtures, CI config) — Axel owns that. Review is a natural third step
but re-uses Sage once the test is written. Cramming all of that into
one context breaks the bot; the skill split keeps each workspace lean
even though only two personas touch it.

**Re-used skills:** composes on top of `playwright-testing`,
`browser-verify`, `bugfix-workflow`, `code-review`, `tdd`,
`task-completion`, and `project-seeder`. It does not reinvent them.

## Routing — how PM resolves slots to agents

This section is PM's **source of truth** for the flow. PM's own
AGENT.md keeps only the triage-row entry and a pointer back here —
the details below are what PM loads when the first TMS-case request
lands.

The pipeline has three **slots** — each a separate session, gated on
intermediate status:

- **Analyst slot** — execute the case, emit an AFS
- **Implementer slot** — AFS → green test → PR
- **Reviewer slot** — approve the PR

```
User drops TMS case / batch
   ↓
PM (Max)    — routes intake, owns merge gate
   ↓
Analyst slot → AFS file on disk + status
   ↓ (PM gates on status before forwarding)
Implementer slot → green test + PR
   ↓ (PM routes for review)
Reviewer slot (+ code-review skill) → approval
   ↓
PM          — merges, closes the issue, confirms TMS back-write
```

### Slot defaults

When all dedicated agents are installed:

| Slot | Agent | Skill loaded |
|---|---|---|
| Analyst | `qa-engineer` (Sage) | `test-case-analysis` |
| Implementer | `test-automation-engineer` (Axel) | `test-automation-workflow` |
| Reviewer | `qa-engineer` (fresh session) | `code-review` |

**If `.agents/role-overrides.md` is present** (scout's Step 6.9
output, auto-imported at the top of PM's AGENT.md via
`@.agents/role-overrides.md`), use its mappings instead — some slots
will be filled by substitute agents (typically a language-matched
dev when Axel isn't installed). The file is authoritative for the
project; the defaults above are the sdlc-skills baseline. See
`project-seeder` § Step 6.9 for how scout writes the overrides.

### The three-step flow

1. **Analyst slot.** Executes the case end-to-end against the live
   app, captures stable selectors, files defects via `bugfix-workflow`
   if any, and emits an AFS at
   `test-specs/<feature>/l<pri>_<slug>_<tms-id>.md`. Returns AFS path
   plus a status:
   `ready-for-automation` / `blocked` / `defect-found` / `un-automatable`.

2. **PM gates on the status before forwarding.** Only
   `ready-for-automation` advances. For the others:
   - `blocked` → unblock (access, data, env) or escalate
   - `defect-found` → route the filed bug through the normal bug
     pipeline; parked automation resumes after the fix
   - `un-automatable` → close the request with a note; do not route

3. **Implementer slot.** Reads AFS, writes the test in the project's
   existing framework (per `.agents/testing.md`), runs it locally and
   in CI, opens a PR, back-writes the TMS execution.

4. **Reviewer slot.** Runs the `code-review` skill for code quality +
   test-correctness checks.

PM merges once both gates pass (see `project-manager` § Merging
approved PRs for the merge protocol — that lives with PM because the
merge gate is PM's responsibility regardless of work type).

### Handoff prompts name the slot

Always name the slot in the handoff so the agent is clear about its
role in the pipeline. Under substitution, this framing lets any
installed agent pick up the slot without confusion:

> You are the **implementer** for SCRUM-T101 (AFS at
> `test-specs/checkout/l2_apply-promo_SCRUM-T101.md`). Follow
> `test-automation-workflow` Step 5–6.

### Why three separate sessions (even when one persona fills two slots)

Each *session* carries different context — analysis holds DOM
snapshots and test data, implementation holds framework state and
page-object code, review holds test-honesty suspicion. Cramming all
of that into one session fragments context and breaks the bot, even
when the persona is the same.

**Freshness is the default, not a host-specific mechanism.** On
every host relevant to this workflow — Claude Code, Copilot CLI,
Cursor, Windsurf, Octobots — invoking a subagent spawns an
**isolated context**: `messages=[]`, only the task prompt flows
in, only the final message comes back. Nothing from the analysis
session leaks into review. PM just calls the reviewer subagent
normally.

**What PM does have to get right is the prompt.** The reviewer
subagent starts with no memory of who wrote the code, so PM must
frame the task explicitly:

> You are the **reviewer** for SCRUM-T101. You did NOT write this
> code — another session of qa-engineer wrote the AFS and
> test-automation-engineer implemented the PR. Load the
> `code-review` skill, read AFS at `test-specs/checkout/l2_…md`
> and PR `<url>`, and report findings with file:line references.
> Be honest about assertions, selector stability, and defect
> masking.

Without that framing, the subagent might assume it wrote the
code and rubber-stamp. See `code-review` skill § review prompt
for the full template.

### When to involve tech-lead (Rio) instead

The routine flow is self-contained: analyst → implementer → reviewer.
Tech-lead is **not** in the hot path for routine TMS cases — pulling
tech-lead into every review defeats the pipeline's throughput. PM
routes through tech-lead for three situations:

1. **Greenfield framework bootstrap.** No existing test framework in
   the repo. Tech-lead picks the scaffold per language (see
   [references/framework-scaffold.md](references/framework-scaffold.md)),
   defines the page-object and fixture conventions, and writes /
   approves the initial `.agents/testing.md`. The implementer (Axel
   or substitute) then executes that plan for the first case.
2. **Framework-scale work.** New fixture infrastructure, new
   page-object base class, CI pipeline changes, framework version
   upgrades, new TMS adapter beyond the supported set — tech-lead
   owns the decision. Route: PM → tech-lead (plan) → implementer
   (execution) → reviewer slot + tech-lead (PR review, paired).
3. **Mid-flow architectural escalation.** When analyst or implementer
   explicitly returns `needs-tech-lead` — a gap surfaced that the
   existing conventions don't cover (shared auth-state problem,
   missing fixture primitive, cross-cutting page-object refactor).
   PM pauses the case, pairs tech-lead with the escalator to resolve,
   then resumes the flow from where it paused.

If unsure whether a request is routine or framework-scale: check
`.agents/testing.md`. If the framework is named and the AFS fits the
existing page-object / fixture model, it's routine. If the AFS needs
something `.agents/testing.md` doesn't describe, it's an escalation.

**If `tech-lead` isn't installed**, PM uses the substitute named in
`.agents/role-overrides.md` (scout's Step 6.9 output) — typically
the language-matched dev (`python-dev` for a Python project,
`js-dev` for TS/JS, etc., per the fallback table in
`project-seeder` `references/role-overrides.md`). Axel's
"return `needs-tech-lead` to PM" protocol still works: the return
lands at PM, PM reads `role-overrides.md`, PM routes to the
substitute. Axel doesn't need to know who the substitute is.

### Status gating, restated

PM must not forward a `blocked` / `defect-found` / `un-automatable`
AFS downstream. The implementer will refuse and it's a wasted
round-trip. Resolve or close upstream first.

## The eight steps

```
1. Discover framework          (read what scout produced)
2. Ingest case from TMS         (pluggable adapter)
3. Execute manually             (analyst slot via `test-case-analysis`)
4. Produce automation-ready spec (analyst emits AFS markdown)
5. Implement automation         (implementer slot — project framework)
6. Run & stabilize              (implementer — green or real defect)
7. Review                       (reviewer slot + code-review skill)
8. Deliver & sync TMS           (task-completion + TMS adapter back-write)
```

Steps 1–4 belong to the analyst slot. Steps 5–6 belong to the
implementer slot. Step 7 is the reviewer slot. Step 8 is the
handoff. PM resolves each slot to a concrete agent at routing time.

### 1. Discover framework

Before anything, read what the scout / project-seeder already produced:

- `AGENTS.md` — tech stack, test commands
- `.agents/testing.md` — test framework, commands, fixtures, CI
- `.agents/architecture.md` — system map (for data flow awareness)
- `.agents/profile.md` — languages, default branch
- `.agents/test-automation.yaml` — TMS config + framework hints (if present)

**If none of these exist**, run [`project-seeder`](../project-seeder/) first.
Do not try to automate into a codebase you have not mapped.

Detect the framework yourself if `testing.md` doesn't name it:

```bash
# Playwright
test -f playwright.config.ts -o -f playwright.config.js && echo "playwright"
# Cypress
test -f cypress.config.ts -o -f cypress.config.js && echo "cypress"
# Selenium / Java
find . -name "pom.xml" -maxdepth 3 -exec grep -l "selenium\|playwright" {} \;
# Pytest + Playwright-python
grep -r "pytest-playwright\|playwright.sync_api" --include="*.txt" --include="*.toml" . 2>/dev/null | head
# WebdriverIO
test -f wdio.conf.ts -o -f wdio.conf.js && echo "wdio"
```

**No framework yet?** Scaffold a minimal one aligned with the project's
language (see [references/framework-scaffold.md](references/framework-scaffold.md)).
Never import a foreign stack — if the project is Python, don't ship a
Node-based framework.

### 2. Ingest case from TMS

TMS is pluggable along two axes — **adapter** (which TMS) and
**transport** (HTTP or MCP). The active combination is declared in
`.agents/test-automation.yaml` (see [references/tms-adapters.md](references/tms-adapters.md)).

Supported adapters out of the box: `zephyr-scale`, `testrail`, `xray`,
`azure-test-plans`, `markdown` (plain files). Each adapter exposes the
same verbs regardless of transport:

```
fetch_case(id)       → returns { id, name, preconditions, steps, expected, cleanup, links }
update_execution(id, status, evidence) → back-writes result
```

**Transport choice:**

- `transport: mcp` — preferred when the host already has a TMS MCP
  server configured (Elitea, Atlassian Remote MCP, a vendor TestRail /
  Xray MCP). The adapter calls `mcp__<server>__<tool>` instead of
  issuing HTTP. Secrets live in the host's MCP config, never in the
  project repo.
- `transport: http` — the TMS's public API with credentials from env
  vars. Works everywhere without host integration.

If no adapter is configured, default to `markdown`: cases live in
`test-specs/{feature}/l{priority}_{name}.md`.

**Never hardcode a TMS.** All TMS logic flows through the adapter.

### 3. Execute manually (Sage via `test-case-analysis`)

The [`qa-engineer`](../../agents/qa-engineer/) agent — persona **Sage** —
runs the case step-by-step with the real application, using the
[`test-case-analysis`](../test-case-analysis/) skill:

- UI cases → [`playwright-testing`](../playwright-testing/) MCP tools,
  preferring `browser_snapshot` for accessible-name discovery.
- Fallback / deep inspection → [`browser-verify`](../browser-verify/)
  (CDP — real input events, computed styles, storage).
- API cases → `curl` / project's HTTP client.

For every step: screenshot, console, network. For every assertion: proof.

**Output of this phase is truth, not code.** What actually happened, not
what the case says should happen.

### 4. Produce automation-ready spec (AFS)

Sage (running `test-case-analysis`) writes an **Automation-Friendly Spec** (AFS) — a markdown file
in `test-specs/{feature}/l{priority}_{slug}_{tms-id}.md`. Format and
required sections live in [../test-case-analysis/references/spec-format.md](../test-case-analysis/references/spec-format.md).
Key additions beyond a plain test case:

- **Stable selectors** discovered during exploration (`data-testid` >
  ARIA role > label > text > CSS — last resort)
- **Test data inventory** — what already exists, what must be generated,
  what must be cleaned up
- **Defects found during exploration** — opened as issues via
  [`bugfix-workflow`](../bugfix-workflow/) handoff; the AFS lists them as
  known-failing expectations
- **Blocked steps** — steps Sage could not execute (access, environment,
  missing data) — Axel must resolve or escalate

If the case cannot be automated at all (e.g. physical card reader),
Sage says so explicitly and stops. Don't write automation for
un-automatable cases.

### 5. Implement automation (automation engineer)

The [`test-automation-engineer`](../../agents/test-automation-engineer/)
agent — persona **Axel** — reads the AFS and:

1. Loads the AFS plus the detected framework conventions.
2. Locates or creates the page object / request-builder / helper that
   owns the target surface.
3. Writes the test using the framework's conventions — never imposes
   foreign patterns. Page Object Model for UI, fixture scope per the
   existing pattern, assertions that fail loudly.
4. Uses environment variables from the project's `.env` — never hardcodes
   URLs, creds, test data.
5. Applies a TDD mindset: run-fail-fix-run until green, never
   demote assertions.

**No Defect Masking Rule:**

| Failure type | Permitted action |
|---|---|
| Infrastructure (bad selector, timing, env) | Fix selector/wait/env. Re-run. |
| Product defect, isolated step | `expect.soft()` (or framework equivalent) with `// Known defect: <id>` comment. Rest of test runs. |
| Product defect, blocks execution | Let it fail naturally. Open ticket via `bugfix-workflow`. Do NOT `test.fail()`. |

Forbidden — regardless of any scope argument:

- Removing an assertion to turn green
- Demoting `expect()` to `console.warn`
- Swapping the failing assertion for a weaker one
- Using `page.evaluate()` to bypass a CSS/DOM check the AC requires
- Using `test.fail()` / `xit()` / `@Ignore` to hide a real product bug

### 6. Run & stabilize

The test runs reliably (pass or fails for a *real* product reason). Run
it locally, then whatever the CI equivalent is. Flaky tests are not done
— identify the source (network, timing, data) and fix it, or mark the
test `@flaky` only if the project already has that tagging convention.

### 7. Review

Two reviewers in parallel:

- **[`qa-engineer`](../../agents/qa-engineer/)** (Sage) — does the test
  actually prove the AC? Is the assertion strong enough? Would a
  refactor survive? Is the sad path covered?
- **[`code-review`](../code-review/)** skill — code quality, fixture
  discipline, selector stability, naming, dead code.
NOTE: Reviewer must be explicitely informed that it reviews someone else's work, not its own. Otherwise it will be biased and less effective. See `code-review` skill for review prompt details.
Reviewer comments feed back to Axel. Re-run after changes.

### 8. Deliver & sync TMS

Follow [`task-completion`](../task-completion/) — commit on a feature
branch, push, `gh pr create`, comment on the originating issue. Then use
the TMS adapter to back-write the execution result (`update_execution`)
so the TMS dashboard reflects reality.

## Batching multiple cases

When the user drops a bag of cases ("automate all of SPRINT-42's regression
suite"):

- **Analysis phase** parallelizes well. Spawn one Sage sub-agent per
  case (each runs the `test-case-analysis` skill in its own session)
  — each gets its own browser context and its own AFS output file.
  Collect results, verify files on disk, recreate any that didn't persist.
- **Automation phase** can also parallelize, *but* guard the page-object
  layer — two agents racing to edit `login.page.ts` will collide. Serialize
  any case that touches the same page object.
- **Review phase** — batch is fine; one reviewer pass per PR, not per case.

See [references/commands.md](references/commands.md) for concrete
`runSubagent` / `Agent` / `Task` recipes by host.

## Anti-patterns

- **Automating an unexecuted case.** You don't know what the app does
  until you've driven it. Don't skip step 3.
- **Copying framework conventions from a different project.** Read
  `.agents/testing.md` and the existing `tests/` directory. Match
  what's there.
- **Hardcoding the TMS.** Everything goes through the adapter. If the
  project migrates from Zephyr to TestRail, you swap one config line,
  not the workflow.
- **Masking a product defect with `test.fail()`, `xit`, or `@Ignore`.**
  A red test is the correct signal. File the bug, don't hide it.
- **One-shot mega-agent.** Context fragmentation is a feature, not a
  bug. Respect the three-role split.
- **"I wrote the code and it compiles."** Not done. Not until the test
  ran green (or red for a real product reason), evidence captured, PR
  open, TMS updated.

## References

- [../test-case-analysis/references/spec-format.md](../test-case-analysis/references/spec-format.md) — Automation-Friendly
  Spec (AFS) structure, required sections, examples.
- [references/tms-adapters.md](references/tms-adapters.md) — adapter contract,
  supported TMSes (Zephyr Scale / TestRail / Xray / Azure Test Plans /
  markdown), `.agents/test-automation.yaml` schema.
- [references/commands.md](references/commands.md) — concrete recipes:
  framework detection, sub-agent spawning per host (Claude / taskbox /
  Copilot), TMS CLI examples, the AFS template in copy-pasteable form.
- [references/framework-scaffold.md](references/framework-scaffold.md) —
  minimal scaffolds for projects that don't yet have a framework,
  per language (JS/TS, Python, Java, C#).
