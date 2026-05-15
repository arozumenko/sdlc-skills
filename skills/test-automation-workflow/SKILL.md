---
name: test-automation-workflow
description: IC-facing test automation process — implementer six-phase loop (Absorb → Explore → Automate → Execute → Debug → Handoff), AFS-driven workflow, no-defect-masking rules, run-report template. Pluggable TMS adapters (Zephyr Scale / TestRail / Xray / Azure Test Plans / markdown). Load when implementing tests from an AFS, or when you need the canonical IC process for analyst → implementer → reviewer slots. Orchestration (slot routing, dispatch templates, AFS gating, automation merge gate) is owned by the `test-automation-lead` agent, not this skill.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.2.0"
---

## Test Automation Workflow — the IC process

This skill describes how individual contributors (analyst, implementer, reviewer) do their craft inside the analyst → implementer → reviewer pipeline. **Orchestration of that pipeline is the `test-automation-lead` agent's job.** TAL owns slot routing, dispatch templates, AFS quality gating, status discipline, automation merge gate, and framework architecture decisions. This skill describes what each IC slot does once dispatched.

If you arrived here looking for routing / slot defaults / "when to involve tech-lead" / canonical dispatch prompts, read [`agents/test-automation-lead/AGENT.md`](../../agents/test-automation-lead/AGENT.md). On projects without `test-automation-lead` installed, those responsibilities fall to whichever agent has been substituted via `.agents/role-overrides.md`.

**Core philosophy:** do not automate what you have not executed. Every case is run manually first (pick whichever browser tool is wired and fits the challenge — `playwright-testing` over MCP, `playwright-cli` from the shell, `browser-verify` over CDP; full triage in [`references/browser-tools.md`](references/browser-tools.md)) so defects, missing data, and environmental gaps surface *before* a line of automation code is written. Then a separate engineer implements the automation inside the project's existing framework. Then a reviewer re-runs it.

**Why split the work across slots:** context. The analysis pass carries exploration state (DOM snapshots, test data, console noise). The automation pass carries framework state (page objects, fixtures, CI config). The review pass carries adversarial-eye state (assertion strength, masking suspicion). Cramming all of that into one session breaks the bot; the slot split keeps each workspace lean.

## The eight steps (IC view)

```
1. Discover framework          (read what scout produced)
2. Ingest case from TMS         (pluggable adapter)
3. Execute manually             (analyst slot via `test-case-analysis`)
4. Produce automation-ready spec (analyst emits AFS markdown)
5. Implement automation         (implementer six-phase loop — see § Implementer below)
6. Run & stabilize              (implementer — green or real defect; Run Report)
7. Review                       (reviewer slot + code-review skill)
8. Deliver & sync TMS           (task-completion + TMS adapter back-write)
```

Steps 1–4 belong to the analyst slot (driven by [`test-case-analysis`](../test-case-analysis/SKILL.md)). Steps 5–6 belong to the implementer slot (driven by this skill — see § Implementer six-phase loop below). Step 7 is the reviewer slot (driven by [`code-review`](../code-review/SKILL.md)). Step 8 is the handoff.

`test-automation-lead` resolves each slot to a concrete agent at dispatch time. ICs don't need to know the routing rules — they need to know how to execute their phase once dispatched.

### 1. Discover framework

Before anything, read what scout / project-seeder produced:

- `AGENTS.md` — tech stack, test commands
- `.agents/testing.md` — test framework, commands, fixtures, CI
- `.agents/architecture.md` — system map (for data flow awareness)
- `.agents/profile.md` — languages, default branch
- `.agents/test-automation.yaml` — TMS config + framework hints (if present)

**If none of these exist**, ask `test-automation-lead` to run scout first. Do not try to automate into a codebase you have not mapped.

Framework detection patterns (if `testing.md` doesn't name it):

```bash
test -f playwright.config.ts -o -f playwright.config.js && echo "playwright"
test -f cypress.config.ts -o -f cypress.config.js && echo "cypress"
find . -name "pom.xml" -maxdepth 3 -exec grep -l "selenium\|playwright" {} \;
grep -r "pytest-playwright\|playwright.sync_api" --include="*.txt" --include="*.toml" . 2>/dev/null | head
test -f wdio.conf.ts -o -f wdio.conf.js && echo "wdio"
```

**No framework yet?** Return `needs-tal` (mid-flow escalation). TAL owns the bootstrap decision per [`agents/test-automation-lead/AGENT.md`](../../agents/test-automation-lead/AGENT.md) § Framework Architecture. Once TAL hands back an approved plan, execute it against [`references/framework-scaffold.md`](references/framework-scaffold.md).

### 2. Ingest case from TMS

TMS is pluggable along two axes — **adapter** (which TMS) and **transport** (HTTP or MCP). The active combination is declared in `.agents/test-automation.yaml` (see [`references/tms-adapters.md`](references/tms-adapters.md)).

Supported adapters out of the box: `zephyr-scale`, `testrail`, `xray`, `azure-test-plans`, `markdown` (plain files). Each adapter exposes the same verbs regardless of transport:

```
fetch_case(id)       → returns { id, name, preconditions, steps, expected, cleanup, links }
update_execution(id, status, evidence) → back-writes result
```

**Full-field fetch is mandatory.** TMS adapters typically expose a "quick search" verb (returns minimal fields) and a "full fetch" verb (returns all custom fields including step + expected text). **Always use full fetch.** If your adapter has only quick-search and the step text comes back null, the case is unusable — stop and ask `test-automation-lead` how to get the full content (open the case in the browser and copy, if necessary). Never proceed on a partial case.

**Transport choice:**

- `transport: mcp` — preferred when the host has a TMS MCP server configured (Elitea, Atlassian Remote MCP, vendor TestRail / Xray MCP). The adapter calls `mcp__<server>__<tool>` instead of issuing HTTP. Secrets live in the host's MCP config.
- `transport: http` — the TMS's public API with credentials from env vars. Works everywhere without host integration.

If no adapter is configured, default to `markdown`: cases live in `test-specs/{feature}/l{priority}_{name}.md`.

**Never hardcode a TMS.** All TMS logic flows through the adapter.

### 3. Execute manually (analyst slot)

The analyst — typically `qa-engineer` (Sage), occasionally a substitute — runs the case step-by-step against the real application, using the [`test-case-analysis`](../test-case-analysis/) skill:

- UI cases → [`playwright-testing`](../playwright-testing/) MCP tools, preferring `browser_snapshot` for accessible-name discovery.
- Fallback / deep inspection → [`browser-verify`](../browser-verify/) (CDP — real input events, computed styles, storage).
- API cases → `curl` / project's HTTP client.

For every step: screenshot, console, network. For every assertion: proof.

**Output of this phase is truth, not code.** What actually happened, not what the case says should happen.

### 4. Produce automation-ready spec (AFS)

The analyst writes an **Automation-Friendly Spec** (AFS) — a markdown file in `test-specs/{feature}/l{priority}_{slug}_{tms-id}.md`. Format and required sections live in [`../test-case-analysis/references/spec-format.md`](../test-case-analysis/references/spec-format.md).

**AFS quality bar — implementer-readable contract.** Every AFS must satisfy:

- **User selection section** — explicitly names the env var keys (e.g. `${TEST_USER}` / `${TRIAL_USER}` for projects with multi-credential sets).
- **Test data inventory** — three buckets: `reuse-existing` / `generate-per-test` / `generate-shared-with-cleanup`. Every datum classified.
- **Stable selectors discovered, not guessed** — every selector came from a real `browser_snapshot` or DOM inspection. Unobserved selectors marked "to-verify in implementer Phase 2 (Explore)".
- **Known Defects Found** — every defect filed with ticket ID + recommended handling (`expect.soft()` or natural-fail).
- **Cleanup steps** — state mutations + reset between runs.

An AFS missing any of these is `blocked`, not `ready-for-automation`. `test-automation-lead` enforces this gate before forwarding to the implementer.

If the case cannot be automated at all (e.g. physical card reader), the analyst says so explicitly and stops. Don't write automation for un-automatable cases.

## Implementer six-phase loop

**Absorb → Explore → Automate → Execute → Debug → Handoff.** Six phases. Each ends with a checkpoint. Skip nothing.

### Phase 1 — Absorb

Read the AFS end-to-end. Re-read `.agents/testing.md`. Open three neighbouring tests in the same feature area. If AFS § Status is not `ready-for-automation`, refuse:

- `blocked` → report up to TAL with the unblock requirement.
- `defect-found` → confirm the defect ticket exists in the project EPIC AND the AFS specifies handling (`expect.soft()` for isolated, let-it-fail-naturally for blocking). If unclear, refuse.
- `un-automatable` → reject; analyst should not have sent this.

### Phase 2 — Explore (skip if AFS selectors are confirmed against current DOM)

If your Absorb pass surfaces a discrepancy between AFS selectors and the live DOM (UI changed since analyst pass, or AFS noted "to-verify" selectors), **explore before writing code**:

1. Use the project's browser-driving capability (`playwright-cli` codegen, `playwright-testing` MCP, or `browser-verify` for computed styles).
2. Diff observed selectors vs AFS-stated selectors.
3. **Amend the AFS in-place** with a `docs(afs): amend selectors per implementer exploration` commit — do NOT silently drift from the AFS.
4. If the gap is too wide (multiple steps obsolete, app flow changed), **return `needs-analyst-rerun` to TAL** — re-exploration is the analyst's job, not yours.

Phase 2 has a budget: **30 minutes of exploration** before escalating to TAL.

### Phase 3 — Automate

Write the test. Follow the framework's conventions 1:1. Five rules (full detail in § Hard Rules below):

1. Match the project's framework — read three neighbouring tests first.
2. Extend existing page objects; never duplicate.
3. Locator ladder: getByRole → testid → label → text → CSS (last resort).
4. Env vars from `.env` via the project's existing loader. Never hardcode.
5. No `waitForTimeout` / `sleep`. Use web-first assertions.

Apply the **No Defect Masking Rule** (§ Hard Rules → 2 below). Forbidden: `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, demoted expects, weakened assertions.

### Phase 4 — Execute

Run the single test locally with the exact CI command from `.agents/testing.md`. Capture the **Run Report** template (mandatory — see § Run Report below).

If green: proceed to handoff.
If red: enter Phase 5 — Debug.

### Phase 5 — Debug

Classify the failure honestly:

| Class | Action |
|---|---|
| **Infrastructure** (selector mismatch, timing, env var, framework upgrade) | Fix the test or POM. Re-run. |
| **Product-isolated** (one assertion fails for product reason, rest of flow works) | `expect.soft()` with `// Known defect: <TICKET>` comment. File the defect via `atlassian-content` / `issue-tracking` if not already filed. |
| **Product-blocking** (downstream steps can't run) | **Let it fail naturally.** File the defect. Return task status `blocked` to TAL. Forbidden: `test.fail()`. |

**Soft retry budget:** ≤ 3 reruns against the same root cause. After the 3rd, **stop and escalate to TAL** with the rerun count + root-cause notes per rerun. Fishing your way to green is a smell, not a strategy.

Read failure artifacts: `test-results/`, `playwright-report/`, `allure-results/`, `error-context.md`. The framework usually pinpoints the exact mismatch.

**When the artifacts aren't informative.** Three tiers of logging enhancement, three different authorities:

| Tier | What to do | Authority |
|---|---|---|
| **In-test logging** — `test.step()` annotations, `console.log` for one-off noise, richer POM error messages | Add freely — local to the spec/POM, no config touched | Implementer's call |
| **Additive reporter** — wire a SECONDARY reporter alongside the existing one (Playwright `reporter: [['html'], ['junit'], ['list']]`, pytest `-v` plugin, Cypress `mocha-multi-reporters`, custom log file utility) | Implementer adds in the PR; **PR description flags the addition explicitly** so TAL reviews specifically for: existing reporter output unchanged, CI/TMS consumers still work, no significant runtime/disk cost | Implementer adds, TAL reviews — never silent |
| **Reporter replacement / removal** — swap `['junit']` for `['allure']`, change output schema, drop an existing reporter | Return `needs-tal` to TAL. Framework-scale decision; the existing reporter is almost certainly feeding TMS back-write or CI dashboards | TAL only |

**Hard rule: never remove or replace an existing reporter mid-PR.** The reporter contract is downstream-facing. Additive is reversible (one line removed and you're back to baseline); replacement breaks integrations silently. If the existing reporter is "wrong format" or "noisy," that's a `needs-tal` escalation.

**Recommended pattern: parallel verbose reporter.** Add a stdout-only reporter alongside the existing file reporter:

```ts
// playwright.config.ts — example
reporter: [
  ['html', { open: 'never' }],   // existing — keep verbatim
  ['junit', { outputFile: 'test-results/junit.xml' }],  // existing — keep verbatim
  ['list'],  // ADDED — stdout only, no file
],
```

The existing reporter's output file (`junit.xml` above) is unchanged, so anything parsing it (TMS adapter, CI pipeline, dashboard) keeps working. The stdout `['list']` gives the implementer richer console output during debug runs.

### Phase 6 — Handoff

Five-step task-completion protocol (see [`task-completion`](../task-completion/) skill):

1. **Verify locally** — single test green, lint clean, diff reviewed.
2. **Commit on a feature branch** — match the convention from `.agents/workflow.md` (typically `tests/<TMS-ID>-<slug>` or `automation/<case-id>-<slug>`).
3. **Push & open PR** via the project's PR tool — `gh pr create` (GitHub), `glab mr create` (GitLab), `az repos pr create` (Azure DevOps). Target branch per `.agents/profile.md` § Automation PR policy.
4. **Comment on the originating story/issue** with the PR link via `issue-tracking` (tracker-aware; reads `.agents/profile.md` § Issue tracker).
5. **Back-write the TMS execution** via the configured adapter.

Return the **Run Report** to TAL as your final message.

---

## Run Report — mandatory template

End every implementer / runner session with this exact structure (no prose summary — TAL scans the structured block):

```markdown
## Run Report — {TEST_TAG}
- **Verdict:** GREEN | RED | BLOCKED
- **Duration:** {n}s
- **Steps passed:** (list each AFS step that ran clean, by name)
- **Failed step:** {step name} — POM method {Page.method()} — {file:line}
- **Failure type:** infrastructure | product-isolated | product-blocking
- **Locator that failed:** `{selector}` — timeout {n}ms
- **Console errors:** (paste, or "none")
- **Network failures:** (4xx/5xx requests, or "none")
- **Artifacts:** `test-results/...`, `playwright-report/...`
- **Reruns:** {n} (root cause of each — infrastructure / product / flake)
- **Final run duration baseline:** {n}s (TAL uses this for future regression checks)
- **Recommendation:** route to (analyst rerun / implementer fix / TAL merge / file bug {PROJECT-NNNN})
```

Missing fields are unacceptable — every field has a defensible "none" or "n/a" value if not applicable.

---

## Hard Rules — implementer

### 1. Match the project's framework, don't import your own

- Read `.agents/testing.md` first. Whatever framework it names, that's your framework.
- If nothing is documented, detect it (see § Discover framework above). First hit wins.
- No framework at all? Return `needs-tal` — framework bootstrap is TAL's call.

### 2. No Defect Masking

| Failure type | Permitted action |
|---|---|
| Infrastructure (bad selector, timing, env) | Fix selector / wait / env. Re-run. |
| Product defect, isolated step | `expect.soft()` (or framework equivalent) with `// Known defect: <id>` comment. Rest of test runs. |
| Product defect, blocks execution | Let the test fail naturally. File a bug via `issue-tracking` / `atlassian-content` (tracker-aware). Do NOT invoke `bugfix-workflow` end-to-end — that's a dev skill. Do NOT `test.fail()`, `xit()`, `@Ignore`, or `pytest.skip()`. |

**Forbidden — regardless of any scope or schedule argument:**

- Removing an assertion that fails to turn green
- Demoting `expect()` to `console.warn` / `log.info`
- Swapping a failing assertion for a weaker one (e.g. `toHaveAttribute` → `toBeVisible`)
- Using `page.evaluate()` to bypass a CSS/DOM check the AC requires
- Using `test.fail()` / `xit()` / `@Ignore` / `pytest.skip()` to hide a real product bug
- Re-scoping: "this assertion belongs to a different test so I'll delete it from this one" — if the AFS says assert it, assert it

> **TAL-side gate.** TAL also enforces this rule. Any dispatch prompt that explicitly instructs the implementer to use `test.fail()` / `xit()` / `@Ignore` / `pytest.skip()` for a product defect is a hard failure on TAL, not the implementer. If your dispatch prompt says "add `test.fail()`", refuse and route back to TAL with the violation noted.

**A red test exposing a real product bug is a correct test.** Your job is to keep it honest, not to keep it green.

### 3. Respect the page object layer

- Extend existing page objects. Don't duplicate. Don't introduce a second `LoginPage` next to the existing one.
- If a page object doesn't exist for the surface you're testing, create it — in the exact style the existing ones use.
- Centralize selectors in the page object. A `data-testid` should appear in exactly one file.
- Semantic method names (`login()`, `applyPromoCode()`), not `clickButton3()`.

### 4. Environment variables, never hardcoded values

URLs, credentials, IDs, feature flags — all through the project's existing env loader (`process.env`, `os.environ`, `System.getenv`, whatever the project uses). If a value the AFS expects isn't wired yet, add it to `.env.example` and wire it through the same pattern the project already uses.

### 5. No sleeps

Use framework-native waits — `waitForResponse`, `waitForURL`, `wait_for_selector`, auto-waiting assertions. A raw `sleep(2000)` is almost always wrong. The one exception: a proven animation window that a condition wait can't catch. Comment it with the reason.

If you think you need a sleep to make a test stable, **escalate to TAL** with the reasoning before adding it.

### 6. Locator ladder

Pick selectors in this order, walking down only when the previous tier genuinely can't disambiguate:

1. `getByRole(role, { name })` with the accessible name
2. `getByTestId(...)` / `data-testid`
3. `getByLabel(...)` / `getByPlaceholder(...)`
4. `getByText(...)`
5. CSS / XPath — last resort, with a one-line comment explaining why the higher tiers didn't fit

**Stop+flag** if the target element has no test ID **and** roles / labels can't disambiguate it. Surface the gap to TAL, who routes it to the dev to add a test ID or accessibility attribute.

### 7. Reuse before create

- Helpers, fixtures, page objects, env keys, test data: `grep` for what exists before adding anything new.
- A third repetition of the same literal is the threshold for extracting a helper.
- Suite-local helpers stay in the spec file; cross-suite helpers belong in the project's helpers folder.
- Before adding an env var to `.env.example` or any config file, `grep` for an existing key serving the same purpose.

### 8. Helpers are trusted

When a test fails and the helper has worked for other tests, suspect the test first, the helper second. Don't mutate shared code to fix an isolated symptom.

### 9. Data-dependency → serial mode

If the AFS test-data inventory declares shared state across steps or tests in the file, set serial mode (`test.describe.configure({ mode: 'serial' })` or the framework equivalent). Parallel execution on shared state is a flake source, not a feature.

---

## Reviewer slot

Two reviewers in parallel (TAL dispatches both):

- **`qa-engineer` (Sage) — fresh session** with the `code-review` skill loaded. Reviewer must be explicitly informed they did NOT write the code, to keep the review adversarial. See `code-review` skill for the review prompt template.
- **Optional `tech-lead` (Rio)** for framework-scale changes only — not for routine test PRs.

Reviewer checks:
- Assertion strength (no demoted expects, no missing toBeEnabled guards)
- Selector stability (locator ladder per testing.md)
- Defect masking (no test.fail, no xit, no weakened assertions)
- POM discipline (no raw selectors in spec files)
- Naming + dead code
- AFS amendments — any selector drift between AFS and implementation must be reflected in an AFS docs commit

Verdict: `APPROVED` | `CHANGES_REQUESTED` with file:line findings. Findings go back to implementer; TAL decides ship-vs-amend.

---

## Batching multiple cases

When TAL hands you N AFS files (rare — usually one at a time):

- Cases touching the same page object → **serial**. Two agents editing `checkout.page.ts` will collide.
- Cases on independent surfaces → can be parallelized by TAL via host subagent dispatch.

All dispatches share the parent's working tree; the same-surface-serial rule is the only collision guard. See [`references/commands.md`](references/commands.md) for concrete recipes.

---

## Anti-patterns

- **Automating an unexecuted case.** You don't know what the app does until you've driven it. Don't skip step 3.
- **Copying framework conventions from a different project.** Read `.agents/testing.md` and the existing `tests/` directory. Match what's there.
- **Hardcoding the TMS.** Everything goes through the adapter.
- **Masking a product defect with `test.fail()`, `xit`, `@Ignore`, or weakened assertions.** A red test is the correct signal. File the bug, don't hide it.
- **One-shot mega-agent.** Context fragmentation is a feature, not a bug. Respect the slot split.
- **Bypassing TAL on routing decisions.** TAL is the orchestrator; ICs execute their phase and return status. Don't decide who runs next yourself.
- **"I wrote the code and it compiles."** Not done. Not until the test ran green (or red for a real product reason), evidence captured, PR open, TMS updated.

## References

- [`../test-case-analysis/references/spec-format.md`](../test-case-analysis/references/spec-format.md) — AFS structure, required sections, examples.
- [`references/tms-adapters.md`](references/tms-adapters.md) — adapter contract, supported TMSes, `.agents/test-automation.yaml` schema.
- [`references/commands.md`](references/commands.md) — framework detection, sub-agent spawning per host, TMS CLI examples, AFS template.
- [`references/framework-scaffold.md`](references/framework-scaffold.md) — minimal scaffolds for projects without a framework, per language.
- [`references/browser-tools.md`](references/browser-tools.md) — browser-tool triage for analyst execution.
- [`../../agents/test-automation-lead/AGENT.md`](../../agents/test-automation-lead/AGENT.md) — orchestration: slot routing, dispatch templates, AFS gating, automation merge gate, framework architecture.
