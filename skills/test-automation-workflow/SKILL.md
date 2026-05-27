---
name: test-automation-workflow
description: Use when a TMS test case needs to become an automated test, or when automating a regression batch — "automate TC-NNN", "convert this case to Playwright", any flow from a manual case to green framework tests. Pluggable TMS (Zephyr/TestRail/Xray/Azure/markdown).
license: Apache-2.0
metadata:
  author: "Alexander Bychinkii (git: bermudas)"
  version: "0.2.0"
---

## Test Automation Workflow — the IC process

This skill describes how individual contributors (analyst, implementer, reviewer) do their craft inside the analyst → implementer → reviewer pipeline. **Orchestration of that pipeline is the `test-automation-lead` agent's job.** TAL owns slot routing, dispatch templates, AFS quality gating, status discipline, automation merge gate, and framework architecture decisions. This skill describes what each IC slot does once dispatched.

If you arrived here looking for routing / slot defaults / "when to involve tech-lead" / canonical dispatch prompts, read [`agents/test-automation-lead/AGENT.md`](../../agents/test-automation-lead/AGENT.md). On projects without `test-automation-lead` installed, those responsibilities fall to whichever agent has been substituted via `.agents/role-overrides.md`.

**Core philosophy:** do not automate what you have not executed. Every case is run manually first (pick whichever browser tool is wired and fits the challenge — `playwright-testing` over MCP, `playwright-cli` from the shell, `browser-verify` over CDP; full triage in [`references/browser-tools.md`](references/browser-tools.md)) so defects, missing data, and environmental gaps surface *before* a line of automation code is written. Then a separate engineer implements the automation inside the project's existing framework. Then a reviewer re-runs it.

**Why split the work across slots:** context. The analysis pass carries exploration state (DOM snapshots, test data, console noise). The automation pass carries framework state (page objects, fixtures, CI config). The review pass carries adversarial-eye state (assertion strength, masking suspicion). Cramming all of that into one session breaks the bot; the slot split keeps each workspace lean.

## Implementer slot contract

This skill IS the implementer slot in the test-automation pipeline. When dispatched — by an orchestrator like `test-automation-lead`, or standalone for "implement the AFS at `<path>`" — role, context, parameters, and return shape are fixed here so dispatch prompts don't have to inline them.

**Role.** Take a `ready-for-automation` or `extend-existing` AFS, write the spec (and any required page-object / fixture changes), run it green N times locally, hand back a PR-ready diff plus a Run Report. Full mechanics in § Implementer six-phase loop and § Hard Rules — implementer below.

**Session context — read once at session start.** Typically auto-imported via `@-blocks` in your agent's `AGENT.md`; if your agent doesn't auto-import, read them now:

- `.agents/profile.md` — project systems, base URL, sample users
- `.agents/workflow.md` — branch/PR rules, commit authority
- `.agents/testing.md` — framework, run commands, locator strategy, POM conventions
- `.agents/architecture.md` — surfaces under test
- `.agents/memory/<your-agent>/project_briefing.md` — accumulated project gotchas
- This skill's § Hard Rules — implementer (the forbidden list and additive-only rule)

Missing context → flag the gap; don't fabricate defaults.

**AFS gate** (refuse and return if violated — analyst output drives this):

- Accept: `ready-for-automation` (fresh spec) or `extend-existing` (extend the named covering spec per the AFS's Gap assertions section).
- Refuse: `already-covered` (no implementation needed — traceability AFS only), `blocked`, `defect-found`, `un-automatable`, `out-of-scope-by-author`.

**Per-case parameters** (caller provides at dispatch time):

- TMS case ID
- AFS path
- User set — a key into `.agents/profile.md` § Roles & sample users (e.g. `${TEST_USER}`)
- Branch name — if the caller created the branch. **Don't `switch`, `commit`, `push`, or otherwise touch git unless `.agents/workflow.md` grants commit authority to this slot.**

**Retry budget.** Soft limit: **≤ 2 reruns** against the same root cause before escalating. The TAL's R2 cap rule will refuse R3 on the same cause regardless — see `agents/test-automation-lead/AGENT.md` § R2 cap rule.

**Return contract:**

- PR-ready diff (spec + page objects + fixtures in one commit set)
- Run Report per § Run Report — mandatory template (classification + evidence)
- If escalating after R2: name the class (architectural / AFS-drift / product-change) so the TAL routes correctly

## The eight steps (IC view)

```
1. Discover framework          (read what scout produced)
2. Ingest case from TMS         (pluggable adapter)
3. Execute manually             (analyst slot via `test-case-analysis`)
4. Produce automation-ready spec (analyst emits AFS markdown)
5. Implement automation         (implementer six-phase loop — see § Implementer below)
6. Run & stabilize              (implementer — green or real defect; Run Report)
7. Review                       (reviewer slot + code-review skill)
8. Deliver & sync TMS           (completing-a-task + TMS adapter back-write)
```

Steps 1–4 belong to the analyst slot (driven by [`test-case-analysis`](../test-case-analysis/SKILL.md)). Steps 5–6 belong to the implementer slot (driven by this skill — see § Implementer six-phase loop below). Step 7 is the reviewer slot (driven by [`code-review`](../code-review/SKILL.md)). Step 8 is the handoff.

`test-automation-lead` resolves each slot to a concrete agent at dispatch time. ICs don't need to know the routing rules — they need to know how to execute their phase once dispatched.

### 1. Discover framework

Before anything, read what scout / seeding-a-project produced:

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

Read the AFS end-to-end. Re-read `.agents/testing.md`. Open three neighbouring tests in the same feature area. Check the AFS `Status` field against the slot contract (§ Implementer slot contract above):

| Status | Action |
|---|---|
| `ready-for-automation` | **Accept.** Standard six-phase loop — write a fresh spec. |
| `extend-existing` | **Accept.** Read the covering spec named in AFS § Extension target end-to-end AND read its own AFS (typically in the same `test-specs/<feature>/` directory) so you know what's already proven. Then proceed through Phase 2–6 against AFS § Gap assertions only. The artefact you ship is an *edit to the covering spec*, not a fresh `.spec.ts`. |
| `already-covered` | **Refuse.** No-implementation status — the `lcovered_<…>.md` AFS is a traceability artefact only. Return to TAL noting the misrouting. |
| `out-of-scope-by-author` | **Refuse.** Analyst rejected at Phase 0 case-gate; should not reach implementer. Return to TAL. |
| `blocked` | **Refuse.** Report to TAL with the unblock requirement. |
| `defect-found` | **Conditional.** Confirm the defect ticket exists AND the AFS specifies handling (`expect.soft()` for isolated, let-it-fail-naturally for blocking). If unclear, refuse to TAL. |
| `un-automatable` | **Refuse.** Analyst should not have routed this. |

**This table is the single source of truth.** Orchestrator briefs, dispatch prompts, and project workflows defer to it. New statuses get added here first.

### Phase 2 — Explore (skip if AFS selectors are confirmed against current DOM)

If your Absorb pass surfaces a discrepancy between AFS selectors and the live DOM (UI changed since analyst pass, or AFS noted "to-verify" selectors), **explore before writing code**:

1. Use the project's browser-driving capability (`playwright-cli` codegen, `playwright-testing` MCP, or `browser-verify` for computed styles).
2. Diff observed selectors vs AFS-stated selectors.
3. **Amend the AFS in-place** with a `docs(afs): amend selectors per implementer exploration` commit — do NOT silently drift from the AFS.
4. If the gap is too wide (multiple steps obsolete, app flow changed), **return `needs-analyst-rerun` to TAL** — re-exploration is the analyst's job, not yours.

Phase 2 has a budget: **30 minutes of exploration** before escalating to TAL.

**For `extend-existing` AFS:** Phase 2 has an additional pre-step — read the covering spec end-to-end AND its own AFS (the one that authored it) before driving the live surface. The goal is to enter Phase 3 knowing *exactly* what's already proven, so the gap-fill is purely additive. If the covering AFS has been amended since the spec merged (selectors drifted, observable changed), surface that to TAL via `needs-analyst-rerun` *on the covering spec's case*, not on yours — the covering spec is unstable upstream and your extension would land on shifting ground.

### Phase 3 — Automate

Write the test. Follow the framework's conventions 1:1. Five rules (full detail in § Hard Rules below):

1. Match the project's framework — read three neighbouring tests first.
2. Extend existing page objects; never duplicate.
3. Locator ladder: getByRole → testid → label → text → CSS (last resort).
4. Env vars from `.env` via the project's existing loader. Never hardcode.
5. No `waitForTimeout` / `sleep`. Use web-first assertions.

Apply the **No Defect Masking Rule** (§ Hard Rules → 2 below). Forbidden: `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, demoted expects, weakened assertions.

#### Phase 3 for `extend-existing` AFS

When the AFS status is `extend-existing`, the artefact is an *edit to the covering spec*, not a fresh `.spec.ts`. Three mechanics differ from a fresh implementation:

1. **Additive-only on the covering spec.** The spec file is the shared-caller file (Hard Rule 3 → § Additive-only on shared-caller files applies): existing `test()` bodies stay byte-identical; new `test()` blocks (or new `test.step()` sections, or new `expect()` lines inside an existing test only when the AFS Gap assertions section names that exact insertion point) sit alongside. Verify with `git diff <covering-spec> | grep -E '^-[^-]' | head` → empty.

2. **Coverage tag chain.** Append `@<NEW-TMS-ID>` to the covering spec's `test.describe()` title alongside the existing `@<COVERING-TMS-ID>` tag. The describe-title tag list is the engagement-level coverage signal; each Jira/TMS case referenced by the spec gets its own tag in that list. Don't create a sibling `describe` block — that would fragment the cluster.

3. **Same-PR amendment if the AFS drifts.** If Phase 2 surfaces an observation that the AFS § Gap assertions section didn't anticipate, amend the AFS via the Phase 2 amend-in-PR rule and ship the AFS update in the same PR — same as fresh implementation. If the amendment widens scope to the point of being a near-rewrite of the covering spec, return `needs-analyst-rerun` and ask analyst to reclassify (typically `ready-for-automation` with a split).

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

**Soft retry budget:** ≤ 2 reruns against the same root cause. After R2, **stop and return `needs-tal`** with the rerun count + root-cause notes per rerun. TAL applies the R2 cap rule (escalate to architectural / re-route to analyst / park — never R3). Fishing your way to green by R3+ is a smell, not a strategy: empirically R1→R2 fixes most things, R3 either parks anyway or is wasted effort.

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

Five-step task-completion protocol (see [`completing-a-task`](../completing-a-task/) skill):

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
- **Implementer-local verdict:** GREEN N/M | RED N/M | BLOCKED  (you fill this in)
- **Independent-gate verdict:** (TAL fills this after the independent live-run gate; implementer leaves blank)
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

**Two-verdict split.** Your implementer-local verdict (your `N/M`) is what *you* observed running the spec in your workspace. The **Independent-gate verdict** is what *TAL* observes running the merged spec independently against the live environment — and that's the merge signal, not yours. Leave the independent-gate row blank; TAL fills it. Don't conflate the two: a GREEN N/N implementer-local + RED 1/3 independent-gate is a real outcome class (environment drift / parallel interaction / fresh-credential interaction), and the format must distinguish them.

**For `extend-existing` AFS, the verdict scopes the entire extended spec.** Run the covering spec end-to-end (original `test()` blocks + your appended ones); your `N/M` covers all of them. A GREEN delta + RED original is a regression — the additive-only contract broke. Same merge gate as any other regression: block until additive-only is restored OR follow the shared-file regression protocol (enumerate affected callers, name re-run results in the PR description). TAL's independent-gate verdict applies to the full extended spec too — same scope, different runner.

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

#### Reverse-masking guard (case-text drift from live product)

Masking is bi-directional. The case text is a *hypothesis*; the live product is ground truth. Weakening an assertion *away from* a real defect is the obvious masking class. Weakening an assertion *toward* the case text when live product correctly diverges is **also** masking — it asserts a stale hypothesis as if it were the contract:

| Case text says | Live product does | Wrong — reverse-masking | Right — live-contract |
|---|---|---|---|
| Tap target ≥44px (WCAG AAA) | Tap target = 40px (per current design spec) | `expect(box.height).toBeGreaterThanOrEqual(44)` — fails on a non-defect | `expect(box.height).toBeGreaterThanOrEqual(40)` + file CLARIFICATION on case-text drift |
| "Save button visible on form" | Save button correctly removed in v2 redesign | `expect(saveBtn).toBeVisible()` — fails on intentional change | `expect(saveBtn).toHaveCount(0)` + CLARIFICATION |
| Field labelled "Customer" | Field labelled "Constituent" (legacy term, behaviour identical) | Assert "Customer" — fails on cosmetic | Assert "Constituent" + CLARIFICATION |
| Step "click confirm dialog" | No confirm dialog (removed in flow simplification) | `expect(dialog).toBeVisible()` — fails on improved UX | Skip the step in the spec + CLARIFICATION; AFS amended via Phase 2 amend-in-PR |

**The case-text drift is itself a finding** — it goes in the AFS as a CLARIFICATION (lightweight ticket per the project's `Bug filing style`), not as a Bug. Asserting the stale case-text to "honour" the TMS is masking in the opposite direction.

Why this matters empirically: the test will pass-by-luck on the next product change that happens to land on the asserted value, then fail unpredictably when the product moves again. The live-contract assertion is durable.

> **TAL-side gate.** TAL also enforces this rule. Any dispatch prompt that explicitly instructs the implementer to use `test.fail()` / `xit()` / `@Ignore` / `pytest.skip()` for a product defect is a hard failure on TAL, not the implementer. If your dispatch prompt says "add `test.fail()`", refuse and route back to TAL with the violation noted.

**A red test exposing a real product bug is a correct test.** Your job is to keep it honest, not to keep it green.

### 3. Respect the page object layer

- Extend existing page objects. Don't duplicate. Don't introduce a second `LoginPage` next to the existing one.
- If a page object doesn't exist for the surface you're testing, create it — in the exact style the existing ones use.
- Centralize selectors in the page object. A `data-testid` should appear in exactly one file.
- Semantic method names (`login()`, `applyPromoCode()`), not `clickButton3()`.

#### Additive-only on shared-caller files

When the page object / fixture / helper you're editing has **≥3 merged callers** (`grep -rl '<method-name>' tests/ | wc -l`), default to pure-append patches:

- Add new methods alongside existing ones — never modify the body of an existing method that merged callers depend on.
- Existing tests that need different behaviour use the new method; the old method stays byte-identical.
- Verify the additive contract before commit:
  ```bash
  git diff <file> | grep -E '^-[^-]' | head     # should be empty — no real removals
  ```

**The spec file itself counts as a shared-caller file when AFS status is `extend-existing`.** The covering spec is your edit target; the original `test()` bodies stay byte-identical alongside the new ones you append. Run the same `grep -E '^-[^-]'` verification on the spec diff. The mechanics are identical — the "callers" of an existing `test()` block are downstream CI / TMS back-write / coverage reporters; modifying the test body breaks their state silently.

If the change genuinely cannot be additive (the existing method is broken, or the API needs to change), follow the shared-file regression protocol:

1. Enumerate every affected caller: `grep -rl '<method>' tests/`.
2. Re-run all of them locally before opening the PR.
3. Name every affected spec + its re-run verdict in the PR description.
4. If any affected spec fails post-modification, either make the change backward-compatible (additive) or amend the failing specs in the same PR.

Silent modification of a shared method called by N merged specs is how regression-by-stealth ships. Additive-default is the cheap path; full-regression-with-evidence is the explicit path; neither path is "trust me, the change is safe."

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

### 10. Read-only-by-default

Before writing seed-and-cleanup logic, ask: **can this observable be asserted on existing stable data?**

- If YES — prefer it. Pick a stable existing record matching the AFS's data predicates; assert against it; no setup, no teardown. **Zero-leak by construction, parallel-safe by construction** — the strongest cleanliness posture available, because there's no mutation to leak.
- If NO (the observable inherently requires fresh state — new-document upload, new-relationship, new-case): seed minimally, cleanup loudly.

You (implementer) are the right person to make this call — you've seen the surface in Phase 2 Explore. If the AFS specifies seed-and-cleanup but your exploration shows the observable can be satisfied read-only on stable existing data, **amend the AFS via the Phase 2 amend-in-PR rule and ship read-only.**

Why this matters empirically: seed/cleanup is the largest flake source in any non-trivial suite — state leaks across tests, fixtures interact with parallel runners, cleanup race conditions. Eliminating the mutation eliminates the entire flake class.

The rule sequence: Rule 7 (reuse before create) tells you to find an existing helper; this rule tells you to find existing **data**. Both are the same instinct — prefer what's already proven stable over freshly-built state.

---

## Reviewer slot

This section IS the reviewer-slot contract for test-automation PRs. When dispatched — by an orchestrator like `test-automation-lead`, or standalone for "review test PR #N" — role, context, parameters, and return shape are fixed here so dispatch prompts don't have to inline them. (Generic review mechanics — checklist categories, output format — live in the separate `code-review` skill, loaded alongside.)

**Role.** Adversarial review of a test-automation PR. **You did NOT write this code** — that framing is mandatory; without it the review collapses into rubber-stamp. Two reviewers in parallel:

- **`qa-engineer` (Sage) — fresh session** with the `code-review` skill loaded for generic review mechanics. This section adds the test-automation-specific expectations (triangulation, standing checks).
- **Optional `tech-lead` (Rio)** for framework-scale changes only — not for routine test PRs.

**Session context — read once at session start.** Typically auto-imported via `@-blocks` in your agent's `AGENT.md`; if not, read now:

- `.agents/profile.md`, `.agents/workflow.md`, `.agents/testing.md`, `.agents/architecture.md` — same set as analyst/implementer
- `.agents/memory/<your-agent>/project_briefing.md` — accumulated gotchas
- This skill's § Triangulate three artifacts and § Standing reviewer checks below

Missing context → flag the gap; don't fabricate defaults.

**Per-case parameters** (caller provides at dispatch time):

- TMS case ID
- AFS path — the analyst's translation (one of the three artifacts you triangulate)
- PR ID / branch — the implementation (the second artifact)
- The TMS case itself — fetched via your project's TMS adapter (the third artifact)

**Return contract:**

- Verdict: `APPROVED` | `CHANGES_REQUESTED`
- Findings list with `file:line` refs (Critical / Important / Nit per the `code-review` skill's Output Format)
- Recommendation: ship vs amend. The TAL decides final disposition; reviewer recommends.

### Triangulate three artifacts — never two

The reviewer's mandatory triangle:

1. **Original TMS case** — fetch via the project's TMS adapter (full fields, not summary view). This is the *upstream contract*.
2. **AFS** at `test-specs/<feature>/l*_<id>.md` — the analyst's translation of (1).
3. **Implementation** — the PR diff, the spec, the page-object changes.

A reviewer who looks only at AFS ↔ implementation is doing half the job — they miss the class of bug where the AFS itself drifted from the TMS case. Three failure modes, three responses:

| Pattern | Verdict |
|---|---|
| AFS faithful to TMS case + implementation faithful to AFS | APPROVED |
| AFS faithful, implementation drifts | CHANGES_REQUESTED (implementer fix) |
| AFS drifts from TMS case | Either: (a) amend AFS back to faithful translation AND ship the AFS update in the same PR, or (b) document the drift as a CLARIFICATION under Reverse-masking guard (live product diverges from case-text, case-text is the bug) |

Empirically: AFS-drift bugs slip through file:line review because the file and the line both match the AFS — the AFS is the bug. Only triangulation catches it.

### Standing reviewer checks

- Assertion strength (no demoted expects, no missing `toBeEnabled` guards)
- Selector stability (locator ladder per testing.md)
- Defect masking — bi-directional: no `test.fail`/`xit`/weakened assertions away from defects; no assertions held to stale case-text against live-correct product (§ Reverse-masking guard)
- POM discipline (no raw selectors in spec files; additive-only on shared-caller files — § Hard Rules → 3)
- Naming + dead code
- AFS amendments — any selector / observable drift between AFS and implementation must be reflected in an AFS docs commit in the same PR
- Read-only-by-default check — if seed/cleanup logic shipped where the observable could have been asserted read-only on stable data, flag for refactor (§ Hard Rules → 10)

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
