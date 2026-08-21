---
name: test-automation-implementation
description: "Use when a test case needs to become a green, framework-resident test — the build slot of the test-automation pipeline, from case to green test. Six-phase loop (Absorb → Investigate → Automate → Execute → Debug → Handoff), the 12 Hard Rules, the coverage declaration, the Run Report. Orchestration: test-automation-workflow."
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Test Automation Implementation

The engineer slot's own skill — the full IC contract, preloaded by
`test-automation-engineer`. Pipeline philosophy, orchestration, and the batch
mechanics live in the
[`test-automation-workflow`](../test-automation-workflow/SKILL.md) skill (load
on demand); this skill is what the engineer needs at hand on every dispatch.

## Engineer slot contract

This skill IS the build slot in the test-automation pipeline. When dispatched — by an orchestrator like `test-automation-lead`, or standalone for "automate the case at `<path>`" — role, context, parameters, and return shape are fixed here so dispatch prompts don't have to inline them.

**Role.** Take a test case — from the TMS or `tasks/<suite>/TC-*.md`; **the case is never edited by TA** — plus execution evidence when it exists, write the spec (and any required page-object / fixture changes) carrying a coverage declaration (§ Coverage declaration below), and run it green once locally — determinism is proven by the orchestrator's batch hardening gate, not by repeated local runs; hand back a PR-ready diff plus a Run Report.

**Two build modes** (the dispatch names the route):

- **Evidence-backed** — route `manual-qa-verified`, or `needs-execution` after the lead obtained a PASS test-runner record. The case has been executed live by the manual-qa side; build from the case plus its run record (`reports/RUN-*.md`), **no re-execution** — cite the run id as execution provenance in the Run Report. Evidence missing for a case on this route → return to the lead; **never silently self-execute when policy says manual-qa** (`.agents/testing.md` § Execution provider).
- **Combined** — route `combined` (provider `self`). No prior execution exists and none is required first: **the first green run of your automated test against the real system IS the case's first execution.** The old ritual "execute the full case manually before automating" is dead. Live investigation is a tool at your discretion, not a phase you owe — see Phase 2.

**Session context — read once at session start.** Typically auto-imported via `@-blocks` in your agent's `AGENT.md`; if your agent doesn't auto-import, read them now:

- `.agents/profile.md` — project systems, base URL, sample users
- `.agents/workflow.md` — branch/PR rules, commit authority
- `.agents/testing.md` — framework, run commands, locator strategy, coverage idiom, execution provider
- `.agents/architecture.md` — surfaces under test
- `.agents/memory/<your-agent>/project_briefing.md` — accumulated project gotchas
- This skill's § Hard Rules — engineer (the forbidden list and additive-only rule)

Missing context → flag the gap; don't fabricate defaults.

**Case gate** (refuse and return if violated):

- The case body must be readable (TMS fetch, `tasks/` file, or the intake snapshot your dispatch names). Unreachable case → return to the caller; never reconstruct one from memory.
- Intake verdicts drive routing: a unit screened `un-automatable` or whole-case `covered-elsewhere` should not reach this slot — return it, noting the misrouting. **You cannot mint un-automatability the intake screening didn't see** — request it with an escalation to the lead, never declare it unilaterally.
- `extend-existing` verdict → accept; the artefact is an *edit to the covering spec*, not a fresh spec file ([`references/extend-existing.md`](references/extend-existing.md)).
- Known filed defect on the flow → conditional: accept only when the defect is filed and the remaining flow is automatable (Phase 5 handling); otherwise it ends at the orchestrator.

**Brief-driven dispatch (work that isn't a case).** The orchestrator may dispatch this slot on a [tech-task brief](../test-automation-workflow/references/tech-task-brief.md) instead of a case — a technical unit with no TMS case behind it. Same loop, the brief reference's substitutions apply; everything else (Hard Rules, context economy, retry budget, Run Report, return contract) is unchanged.

**Per-case parameters** (caller provides at dispatch time):

- Case id + source (TMS id, or path to `tasks/<suite>/TC-*.md` / intake snapshot)
- Route (`manual-qa-verified` / `combined`) and, when evidence-backed, the run-record path(s)
- User set — a key into `.agents/profile.md` § Roles & sample users (e.g. `${TEST_USER}`)
- Branch name — if the caller created the branch. **Don't `switch`, `commit`, `push`, or otherwise touch git unless `.agents/workflow.md` grants commit authority to this slot.**

**Context economy (hard rules — same wording as the workflow PREAMBLE; keep in step).** The bill is resident-context × turns — every turn re-sends your whole context, so turn count and payload size ARE the cost (measurements behind each rule: [`references/field-evidence.md`](references/field-evidence.md) § Context economy):

- **Batch independent tool calls into ONE message** — issue non-dependent reads/greps together, never one tool per turn.
- **Read a file once and work from what you read** — ranged reads for big files; no re-reads to double-check what is already in context.
- **Keep runner output lean** — line/dot reporter, tail long failures; never dump a full HTML report or trace into the transcript.
- **Screenshots only when a step fails or visual judgment is the task** — save to disk and cite the path instead of re-emitting pixels into context.
- **Soft budget, a self-check not a cap: ~15 tool turns per case in your unit** (batching makes turns dense — 15 batched turns carry what ~40 single-call turns did). A genuinely long case — 30 steps, a deep debug — may exceed it; what the check catches is **circling**: re-reading what's already in context, retrying the same probe, exploring without acting. At each ~15-turn mark ask: did the last stretch advance the case, or circle? Advance → continue. Circle → act on what you have and record the gap in your Run Report notes.
- **Never clean the tree wholesale.** `git stash --include-untracked`, `git clean -fd`, `git checkout -- .` and `git reset --hard` delete work you did not write — anything plain-untracked (a surface-cache note just written, a spec mid-edit) vanishes with no diff and no error. Need a clean tree before switching branches? **Stash by path** (`git stash push -- <the paths you touched>`) or commit your own work first. If a dirty tree you didn't create is blocking you, report it in findings instead of clearing it.
- **Commit what you produce — memory included.** Durable learnings you write under `.agents/memory/<your-agent>/` are part of your deliverable: `git add` them **by exact path** with your work on your case branch, and the merge carries them to the trunk (a parked unit's memory is landed by the merge agent anyway — the code may not land, but what you learned always does). Two disciplines keep this clean: memory rides in **your own commits by path** — never swept in by a broad stage — and any mechanical self-check grep runs against the project's **code root** (e.g. `git diff … -- automation/`), never the whole tree, so memory prose can't produce false hits in a diff scan.
- **A permission denial blocks an effect, not the task.** Never re-achieve the *same* blocked effect through a different shape — a script instead of the denied command, an alternate binary, a broader allowed command; that evades a pattern, not a policy. But a genuinely different allowed route to the task goal — one that does **not** produce the blocked effect — is legitimate adaptation: take it, and record the substitution in your Run Report notes (what was denied, what you did instead) so a human can veto one that broke intent. No such route → the case goes `blocked` with the denial recorded, and you continue with what remains.

**Retry budget.** Soft limit: **≤ 2 reruns** against the same root cause before escalating. The orchestrator's R2 cap rule will refuse R3 on the same cause regardless — see [`orchestration-playbook.md`](../test-automation-workflow/references/orchestration-playbook.md) § R2 cap rule.

**That budget is about a spec that will not go green. It is NOT a budget for fix rounds after a review** — those run until the reviewer approves. On a fix round:

- **Address every blocking finding.** Not the easy ones, not most of them. A finding you leave untouched comes back classified `unaddressed` and costs the unit another whole round, which is the expensive way to arrive where doing it would have.
- **If one genuinely cannot be done on this branch, say so in `notes` with the reason** — missing framework primitive, the case is wrong, it is a product defect, the environment is broken. An unexplained gap is indistinguishable from a skip, and it will be read as one.

Saying "I could not do this, because X" is a complete and respected answer. Leaving it silent is not.

**Return contract:**

- PR-ready diff (spec + page objects + fixtures in one commit set)
- `coverage: { full: boolean, excluded: [{step, category, referent, note}] }` in the structured return — mirrors the in-file declaration (§ Coverage declaration)
- Run Report per § Run Report — mandatory template (classification + evidence)
- If escalating after R2: name the class (architectural / case-drift / product-change) so the orchestrator routes correctly

## The build loop

**Absorb → Investigate → Automate → Execute → Debug → Handoff.** Six phases. Each ends with a checkpoint. Skip nothing (Phase 2 may legitimately be empty — see its gate).

### Phase 1 — Absorb

Read the **FULL case** — description, preconditions, test data, steps + expected results, not just the steps table; some authors put real acceptance criteria in the description or preconditions. On an evidence-backed route, read the run record(s) too: observed behavior, screenshots, deviations the runner logged — that evidence is your execution ground truth, and re-running the case live to "double-check" it is waste. **Plan coverage now:** every case step must end as an assertion or a valid exclusion (§ Coverage declaration); a step you can't yet place is an investigation target for Phase 2, never a silent drop. Re-read `.agents/testing.md`. Open three neighbouring tests in the same feature area. Check the case gate (§ Engineer slot contract above) — misrouted units return here, before any code.

### Phase 2 — Investigate (at your discretion — a tool, not a ritual)

Go live when you have a specific question: a handle you can't resolve on paper, an ambiguous step ("verify the record saved" — where?), a direct implementation that isn't yielding a reliable test. Minutes of targeted probing, never a full case walkthrough. **Resolve handles up the ladder, cheapest first:**

1. `.agents/automation/surface/<feature>.md` — TA's own cache of confirmed handles, waits, quirks
2. manual-qa knowledge (**read-only**): `.agents/manual-qa/app_profile.md` § Reliable Selectors and § Fragile Areas (plus any extra docs the manual team keeps under `.agents/manual-qa/knowledge/`)
3. the case file itself (and its run record) — authors often embed labels, URLs, data
4. targeted live probing (Playwright MCP / [`browser-verify`](../browser-verify/) / the tool that fits the surface)

**Everything learned live goes BACK into the surface cache** — that write-back is what makes the next case on this surface cheap. Full discipline — when to go live, fast-reach, evidence, side channels, blocked-step reasoning, surface-cache mechanics: [`references/investigation.md`](references/investigation.md).

Investigation is *technique* latitude (the **how**). It does not extend to changing *what* is asserted or the case's scope — a scope problem (steps obsolete, flow changed, the case needs different assertions) is a CLARIFICATION filed on the case plus an escalation to the lead, never a silent re-scope; the case is not yours to edit. Budget: **30 minutes** of live investigation before escalating.

### Phase 3 — Automate

Write the test. Follow the framework's conventions 1:1. **Cluster shape:** merge cases that differ only in DATA into one parameterized spec — one data row per case, each row asserting its OWN expected values and tagged with its case id, never a shared flattened assertion across rows. Keep separate anything that differs in STEPS: a wrongly merged pair makes the weaker case stop being tested and nothing turns red; needless separation is visible and deletable. Five rules (full detail in § Hard Rules below):

1. Match the project's framework — read three neighbouring tests first.
2. Extend the project's existing abstraction layer (page object / API client / screen object / scenario module); never duplicate.
3. Resolve the most stable, semantic handle (UI example: getByRole → testid → label → text → CSS last resort).
4. Env vars from `.env` via the project's existing loader. Never hardcode.
5. No `waitForTimeout` / `sleep`. Use the framework's native waits (web-first assertions for UI).

**Write the coverage declaration** as you go — the baseline comment block plus the project's idiom (§ Coverage declaration below). Apply the **No Defect Masking Rule** (§ Hard Rules → 2 below). Forbidden: `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, demoted expects, weakened assertions.

**Templating bridge.** Authored cases write URLs as `{{base_url}}/path` (the manual-qa convention). Test code never carries the placeholder or a substituted literal: `{{base_url}}` maps to the project's base-URL config variable — the concrete env var name is recorded in `.agents/testing.md` — read through the project's existing loader per Hard Rule 4.

For an `extend-existing` unit the artefact is an *edit to the covering spec*: additive-only (existing `test()` bodies stay byte-identical), the coverage tag chain grows, the file gains the new case's coverage declaration. Full mechanics: [`references/extend-existing.md`](references/extend-existing.md).

### Phase 4 — Execute

Run the single test locally with the exact CI command from `.agents/testing.md`. Capture the **Run Report** template (mandatory — see § Run Report below).

**On the combined route this run is the case's first execution — treat it like one.** Check the side channels even when it goes green (console errors for UI, error fields / status codes for API), save evidence to disk, and treat any divergence between case text and live product as Phase 5 / reverse-masking territory, never a silent adjustment.

**Run it in the FOREGROUND and let the call block — with `timeout: 600000`.** The default timeout is 120s and will kill a suite run mid-flight; 600000ms (10 min) is the maximum a foreground call can have.

**If the run is longer than that**, do not end your turn and do not busy-poll. Launch it detached, writing its output to a file, then wait with **blocking foreground polls** — `sleep 300; <check the output file>`, each with `timeout: 600000` — until it is done. A sleep is **one turn however long it lasts**, so waiting this way is both legal and nearly free.

Two absolutes, both measured the expensive way (incidents and numbers: [`references/field-evidence.md`](references/field-evidence.md) § Waiting on long runs). **Never end a turn with "I'll wait for this to complete"** — nothing wakes you, your slot goes silent holding an unfinished branch, and inside a batch the whole campaign stalls behind it. And **never poll every few seconds** — every poll pays your full resident context, and two `sleep 300` calls do the same wait for a fraction of the cost.

If a suite is too long even for sleep-polling, that is a finding worth reporting (`findings[]`, kind `note`) — say so and run the narrower selection your case needs. A slow suite is a problem to surface, not to hide behind a background job.

If green: proceed to handoff.
If red: enter Phase 5 — Debug.

### Phase 5 — Debug

Classify the failure honestly:

| Class | Action |
|---|---|
| **Infrastructure** (selector mismatch, timing, env var, framework upgrade) | Fix the test or POM. Re-run. |
| **Product-isolated** (one assertion fails for product reason, rest of flow works) | `expect.soft()` with `// Known defect: <TICKET>` comment. File the defect per [`references/defect-filing.md`](references/defect-filing.md) if not already filed. **Then DECLARE it** — return it in `expected_red[]` (spec, test id, ticket, why). The test is now red until the product ships, and an undeclared one makes the batch gate unpassable, holding every healthy case in the batch with it. |
| **Product-blocking** (downstream steps can't run) | **Let it fail naturally.** File the defect and walk away — the fix lifecycle belongs to whoever picks it up ([`references/defect-filing.md`](references/defect-filing.md)). Return task status `defect-found` to the orchestrator; the case is not automated until the defect is fixed. Forbidden: `test.fail()`. |

A finding first observed through synthetic input passes the **pristine-repro gate** before it is filed at all — [`references/defect-filing.md`](references/defect-filing.md) § Pristine-repro gate.

**Soft retry budget:** ≤ 2 reruns against the same root cause. After R2, **stop and return `needs-escalation`** with the rerun count + root-cause notes per rerun. The orchestrator applies the R2 cap rule (escalate to architectural / re-route / park — never R3). Fishing your way to green by R3+ is a smell, not a strategy: empirically R1→R2 fixes most things, R3 either parks anyway or is wasted effort.

Read whatever failure artifacts the project's framework emits (for a Playwright/browser project: `test-results/`, `playwright-report/`, `allure-results/`, `error-context.md`; for other frameworks the equivalent — JUnit/TAP/JSON reports, HAR/response dumps, perf result files). The framework usually pinpoints the exact mismatch.

**When the artifacts aren’t informative** — three tiers of logging enhancement (in-test logging is your call; an ADDITIVE secondary reporter ships in the PR explicitly flagged; reporter replacement/removal is `needs-escalation`, never a mid-PR move) and the gating rules for TMS / result-reporting reporters (CI / opt-in gated, graceful on failure, config-validated — never firing on a local run): read [`references/reporters.md`](references/reporters.md) when you actually face one. Two rules stay absolute here: **never remove or replace an existing reporter mid-PR** (downstream-facing; escalate instead), and an ungated reporter spamming local runs is a defect to fix, not noise to ignore.

### Phase 6 — Handoff

Six-step task-completion protocol (see [`completing-a-task`](../completing-a-task/) skill):

1. **Verify locally** — single test green, lint clean, diff reviewed.
2. **Doc-sync pass** — walk your branch diff for every handle, expected value, or step your implementation changed or discovered, and check each against the paper it came from: the **coverage declaration** states the SHIPPED truth (every case step → an assertion or a valid exclusion, referents real); the **surface cache** carries what your probing revealed and no claim your code now contradicts; any **case-text divergence is FILED** as a clarification per the project's bug-filing style (§ Reverse-masking guard) — the case itself is never edited. The pass extends to whatever cross-references THIS project's seeded conventions define — the seed (`.agents/testing.md`, `.agents/profile.md`), not this skill, says which exist: where the project maps case priority to test markers, the marker must match the case; where tests carry tracker/TMS links, each must resolve to a real artifact, never a guessed slug. And **re-run this pass after every fix round** — a fix that adds a page-object method or renames a handle re-creates the same debt. Field-measured twice: 4 of 5 blocking findings on two small batches (2026-08-17/18), and **78 of 150 blocking findings (52%) across 112 field reviews** on a mature project — stale paper, not test code, is the single biggest reason a unit fails review; every skipped sync buys another review/fix round.
3. **Commit on a feature branch** — only if `.agents/workflow.md` grants commit authority to this slot; match the convention (typically `tests/<TMS-ID>-<slug>` or `automation/<case-id>-<slug>`; when the caller created the branch, use it). No commit authority → stop after step 1 and return the diff + Run Report; the caller lands the branch and opens the PR.
4. **Push & open PR** via the project's PR tool — `gh pr create` (GitHub), `glab mr create` (GitLab), `az repos pr create` (Azure DevOps). Target branch per `.agents/profile.md` § Automation PR policy. **Include the Run Report in the PR description** — that copy is the durable one the reviewer and orchestrator read (§ Run Report below).
5. **Comment on the originating story/issue** with the PR link via `issue-tracking` — **only if `.agents/profile.md` § Status reporting → "Comment PR link" is `yes`** (skip silently if `no` or no tracker is configured).
6. **Verify the TMS back-write wiring** — the execution back-write itself happens **post-merge and belongs to the orchestrator**; at handoff you confirm the wiring exists (a CI-gated reporter or the orchestrator's adapter protocol) — **only if the seed configures it** (§ Status reporting → "TMS execution back-write" `yes`, i.e. a real `tms.adapter`, not `markdown` / `none`). **Dual-write policy:** TA back-writes only automation executions (gate outcomes), case status/coverage note, and the PR link; manual-qa's live runs are their own record — TA never writes those (see the workflow skill's `tms-adapters.md`). Perform the write yourself only when running standalone (no orchestrator) — then per the seeded policy, gated + graceful per [`references/reporters.md`](references/reporters.md) § TMS / result-reporting reporters: never on a local iteration; gate on CI / an opt-in flag, degrade gracefully offline (log once, never fail the run). No TMS sync in the seed → nothing to back-write.

Steps 5–6 are **seed-governed**: perform the external writes the project's seeded way-of-work establishes, skip the ones it doesn't. The seed (`.agents/*`) is the contract; never invent a write it didn't set up, never drop one it did.

Return the **Run Report** to the orchestrator as your final message — and make sure the same Run Report is in the PR description (step 4): that copy is durable, and it's where the orchestrator fills the Independent-gate verdict row.

---

## Coverage declaration

The writing-side half of the factory's coverage contract — the full contract (invariants, reviewer enforcement, gate mechanics) lives in [`../test-automation-workflow/references/coverage-contract.md`](../test-automation-workflow/references/coverage-contract.md). What you owe in every delivered spec file:

**Baseline grammar (always present — it's what the gate greps), in a comment block:**

```
TC-<id> coverage: steps 1-6, 8
TC-<id> excluded: 7 (un-automatable: captcha — no test hook), 9 (covered-elsewhere: test_password_reset_api — email delivery asserted via API)
```

Three invariants: (1) the case id appears in the test's identity (title / annotation / tag); (2) **every case step traces to an assertion or an explicit exclusion** — a silent gap is a blocking finding; (3) the declaration is machine-findable in this fixed grammar.

**Closed exclusion vocabulary — each category REQUIRES a verifiable referent:**

| Category | Referent |
|---|---|
| `covered-elsewhere` | name of the existing test that asserts it |
| `blocked-by-defect` | filed defect id |
| `un-automatable` | category from `automation-scoping`'s complexity taxonomy |
| `by-seeded-policy` | the policy line in `.agents/testing.md` |

Free-text reasons ("flaky", "hard", "not needed") are INVALID grammar — blocking at review and at the gate. And exclusions are cross-checked against the intake verdict: you cannot mint `un-automatable` the screening didn't see, only request it with an escalation to the lead.

**Idiom layer (project-owned).** `.agents/testing.md` § Coverage idiom names how this project expresses steps in code — Playwright `test.step()` + header comment, pytest docstring/markers, JUnit `@DisplayName`/`@Tag`, k6 `group()`. Follow it; the baseline comment block is present regardless.

## Knowledge routing

Four destinations; put each fact where it belongs, once:

| What | Where |
|---|---|
| Hot handles, waits, quirks (high churn, app-specific) | `.agents/automation/surface/<feature>.md` — TA's working cache; write back after every live probe ([`references/investigation.md`](references/investigation.md) § The surface cache) |
| Durable, verified, cross-role system facts | promote to `.agents/knowledge/` via the shared `knowledge-curation` skill — admission tests: cross-role + verified + durable + costly to rediscover |
| Process / personal lessons | `.agents/memory/<your-agent>/` via the memory skill, as today |
| manual-qa's `.agents/manual-qa/**` | READ-ONLY warm start. **Anti-duplication:** before writing an app fact to the surface cache, check their `knowledge/` — if present, reference it, never copy; copies drift. |

---

## Run Report — mandatory template

End every build session with this exact structure (no prose summary — the orchestrator scans the structured block):

```markdown
## Run Report — {TEST_TAG}
- **Engineer-local verdict:** GREEN N/M | RED N/M | BLOCKED  (you fill this in)
- **Independent-gate verdict:** (the orchestrator fills this after the independent hardening gate; engineer leaves blank)
- **Execution provenance:** manual-qa RUN-{id} | test-runner result (this batch) | first-green-run (combined)
- **Coverage:** full | partial — excluded: step {n} ({category}: {referent}), …
- **Duration:** {n}s
- **Steps passed:** (list each case step that ran clean, by name)
- **Failed step:** {step name} — abstraction-layer method ({Page.method()} for UI; client/service method elsewhere) — {file:line}
- **Failure type:** infrastructure | product-isolated | product-blocking
- **Handle that failed:** `{selector / response field-path / accessibility-id / metric query}` — timeout {n}ms
- **Console errors:** (paste, or "none")
- **Network failures:** (4xx/5xx requests, or "none")
- **Artifacts:** framework report dir — `test-results/` / `playwright-report/` / `allure-results/` / JUnit XML / HAR or perf summary
- **Reruns:** {n} (root cause of each — infrastructure / product / flake)
- **Final run duration baseline:** {n}s (the orchestrator uses this for future regression checks)
- **Recommendation:** route to (engineer fix round / the orchestrator merge / escalate to lead / file bug {PROJECT-NNNN})
```

Missing fields are unacceptable — every field has a defensible "none" or "n/a" value if not applicable.

**Two-verdict split.** Your engineer-local verdict (your `N/M`) is what *you* observed running the spec in your workspace. The **Independent-gate verdict** is what *the orchestrator* observes running the merged spec independently against the live environment — and that's the merge signal, not yours. Leave the independent-gate row blank; the orchestrator fills it. Don't conflate the two: a GREEN N/N engineer-local + RED 1/3 independent-gate is a real outcome class (environment drift / parallel interaction / fresh-credential interaction), and the format must distinguish them.

**For `extend-existing` units, the verdict scopes the entire extended spec** — run the covering spec end-to-end; your `N/M` covers original and appended blocks alike. A GREEN delta + RED original is a regression. Details: [`references/extend-existing.md`](references/extend-existing.md) § Run Report.

---

## Hard Rules — engineer

### 1. Match the project's framework, don't import your own

- Read `.agents/testing.md` first. Whatever framework it names, that's your framework.
- If nothing is documented, detect it (see the `test-automation-workflow` skill § Discover framework). First hit wins.
- No framework at all? Return `needs-escalation` — framework bootstrap is the orchestrator's call.

**Skills are accelerants, not prerequisites.** Use an installed skill when one fits the project's framework; for Playwright, [`references/playwright-patterns.md`](references/playwright-patterns.md) carries the POM + fixture patterns. If nothing fits you are not blocked: conform to the existing framework by reading `.agents/testing.md` + three neighbouring tests; if the framework is unfamiliar or greenfield, learn it from its official docs; worst case, write from first principles + the docs and say so in your Run Report. Only return `needs-escalation` when something is genuinely unobtainable — a paid license, a physical device, an unknown undocumented tool. Never silently force a framework or tool the project doesn't use.

### 2. No Defect Masking

| Failure type | Permitted action |
|---|---|
| Infrastructure (bad selector, timing, env) | Fix selector / wait / env. Re-run. |
| Product defect, isolated step | `expect.soft()` (or framework equivalent) with `// Known defect: <id>` comment. Rest of test runs. |
| Product defect, blocks execution | Let the test fail naturally. File per [`references/defect-filing.md`](references/defect-filing.md) and walk away — no dev-side fix lifecycle. Do NOT `test.fail()`, `xit()`, `@Ignore`, or `pytest.skip()`. |

**Forbidden — regardless of any scope or schedule argument:**

- Removing an assertion that fails to turn green
- Demoting `expect()` to `console.warn` / `log.info`
- Swapping a failing assertion for a weaker one (e.g. `toHaveAttribute` → `toBeVisible`)
- Using `page.evaluate()` to bypass a CSS/DOM check the case requires
- Using `test.fail()` / `xit()` / `@Ignore` / `pytest.skip()` to hide a real product bug
- Re-scoping: "this assertion belongs to a different test so I'll delete it from this one" — if the case's expected result says assert it, assert it or declare a **valid exclusion** (§ Coverage declaration); silent deletion is masking

#### Reverse-masking guard (case-text drift from live product)

Masking is bi-directional. The case text is a *hypothesis*; the live product is ground truth. Weakening an assertion *away from* a real defect is the obvious masking class. Weakening an assertion *toward* the case text when live product correctly diverges is **also** masking — it asserts a stale hypothesis as if it were the contract. Assert the live contract instead, **file the case-text drift as a finding** — a CLARIFICATION (lightweight ticket per the project's `Bug filing style`), not a Bug — and note the divergence beside the coverage line so the reviewer can triangulate. The case is the author's to amend, never yours. Worked examples of both directions: [`references/field-evidence.md`](references/field-evidence.md) § Reverse-masking.

> **The orchestrator-side gate.** The orchestrator also enforces this rule. Any dispatch prompt that explicitly instructs the engineer to use `test.fail()` / `xit()` / `@Ignore` / `pytest.skip()` for a product defect is a hard failure on the orchestrator, not the engineer. If your dispatch prompt says "add `test.fail()`", refuse and route back to the orchestrator with the violation noted.

**A red test exposing a real product bug is a correct test.** Your job is to keep it honest, not to keep it green.

### 3. Respect the project's abstraction layer

Use the project's existing abstraction over the thing under test — page object for UI, API client / service object for API, screen object for mobile, scenario module for perf. Extend it, don't duplicate it, and centralize the address of the thing under test there. The page-object example:

- Extend existing page objects. Don't duplicate. Don't introduce a second `LoginPage` next to the existing one.
- If a page object doesn't exist for the surface you're testing, create it — in the exact style the existing ones use. (Exception: if `.agents/testing.md` records the project's flat-path default — no abstraction layer yet; layers emerge at 3+ duplication per the `test-automation-workflow` skill’s framework-scaffold.md § Path-dependent — follow that instead of minting a lone page object.)
- Centralize selectors in the page object. A `data-testid` should appear in exactly one file. (Same discipline for the analogues: an endpoint path / base URL lives once in the API client; a screen's accessibility-ids live once in the screen object.)
- Semantic method names (`login()`, `applyPromoCode()`), not `clickButton3()`.

#### Additive-only on shared-caller files

When the page object / fixture / helper you're editing has **≥3 merged callers** (`grep -rl '<method-name>' tests/ | wc -l`), default to pure-append patches:

- Add new methods alongside existing ones — never modify the body of an existing method that merged callers depend on.
- Existing tests that need different behaviour use the new method; the old method stays byte-identical.
- Verify the additive contract before commit:
  ```bash
  git diff <file> | grep -E '^-[^-]' | head     # should be empty — no real removals
  ```

**The spec file itself counts as a shared-caller file when the unit is `extend-existing`** — the "callers" of an existing `test()` block are downstream CI / TMS back-write / coverage reporters ([`references/extend-existing.md`](references/extend-existing.md)).

If the change genuinely cannot be additive (the existing method is broken, or the API needs to change), follow the shared-file regression protocol:

1. Enumerate every affected caller: `grep -rl '<method>' tests/`.
2. Re-run all of them locally before opening the PR.
3. Name every affected spec + its re-run verdict in the PR description.
4. If any affected spec fails post-modification, either make the change backward-compatible (additive) or amend the failing specs in the same PR.

Silent modification of a shared method called by N merged specs is how regression-by-stealth ships. Additive-default is the cheap path; full-regression-with-evidence is the explicit path; neither path is "trust me, the change is safe."

### 4. Environment variables, never hardcoded values

URLs, credentials, IDs, feature flags — all through the project's existing env loader (`process.env`, `os.environ`, `System.getenv`, whatever the project uses). If a value the case expects isn't wired yet, add it to `.env.example` and wire it through the same pattern the project already uses. `{{base_url}}` in a case body is the manual-qa placeholder for exactly this — see Phase 3 § Templating bridge.

### 5. No sleeps

Use framework-native waits — `waitForResponse`, `waitForURL`, `wait_for_selector`, auto-waiting assertions. A raw `sleep(2000)` is almost always wrong. The one exception: a proven animation window that a condition wait can't catch. Comment it with the reason.

If you think you need a sleep to make a test stable, **escalate to the orchestrator** with the reasoning before adding it.

### 6. Resolve the most stable, semantic handle

Bind to whatever you're observing through the most stable, semantic handle the surface offers, walking down to less stable tiers only when the previous one genuinely can't disambiguate. The worked example below is the **UI** ladder; the same instinct applies per surface — API: named response field / JSON-schema path → status; mobile: accessibility-id → id → text; perf: a named metric / threshold rather than a positional sample.

UI ladder (Playwright example):

1. `getByRole(role, { name })` with the accessible name
2. `getByTestId(...)` / `data-testid`
3. `getByLabel(...)` / `getByPlaceholder(...)`
4. `getByText(...)`
5. CSS / XPath — last resort, with a one-line comment explaining why the higher tiers didn't fit

**Stop+flag** if the handle can't be made stable and semantic — e.g. a UI target with no test ID **and** roles / labels that can't disambiguate it. Surface the gap to the orchestrator, who routes it to the dev to add a test ID, accessibility attribute, or stable identifier.

### 7. Reuse before create

- Helpers, fixtures, page objects, env keys, test data: `grep` for what exists before adding anything new.
- A third repetition of the same literal is the threshold for extracting a helper.
- Suite-local helpers stay in the spec file; cross-suite helpers belong in the project's helpers folder.
- Before adding an env var to `.env.example` or any config file, `grep` for an existing key serving the same purpose.

### 8. Helpers are trusted

When a test fails and the helper has worked for other tests, suspect the test first, the helper second. Don't mutate shared code to fix an isolated symptom.

### 9. Data-dependency → serial mode

If the case's test data implies shared state across steps or tests in the file, set serial mode (`test.describe.configure({ mode: 'serial' })` or the framework equivalent). Parallel execution on shared state is a flake source, not a feature.

### 10. Read-only-by-default

Before writing seed-and-cleanup logic, ask: **can this observable be asserted on existing stable data?**

- If YES — prefer it. Pick a stable existing record matching the case's data predicates; assert against it; no setup, no teardown. **Zero-leak by construction, parallel-safe by construction** — the strongest cleanliness posture available, because there's no mutation to leak.
- If NO (the observable inherently requires fresh state — new-document upload, new-relationship, new-case): seed minimally, cleanup loudly.

You are the right person to make this call — you've seen the surface in Phase 2. If the case's preconditions describe seed-and-cleanup but the observable can be satisfied read-only on stable existing data, **ship read-only and say so in the Run Report** — the case is not yours to amend; if its data setup is genuinely wrong, file a clarification.

Seed/cleanup is the largest flake source in any non-trivial suite; eliminating the mutation eliminates the entire flake class (why, and how this pairs with Rule 7: [`references/field-evidence.md`](references/field-evidence.md) § Read-only-by-default).

### 11. Shared files have one writer — know whose you may touch

Files that several roles could write need a declared owner, or every merge relitigates them:

| File | Writer |
|---|---|
| `.agents/automation/surface/<feature>.md` (+ `<feature>/<subarea>.md` once split) | **you** — the engineer is the cache's writer; units are serialized, so the tree is yours while dispatched. Add what live probing confirmed, prune what drifted; commit by exact path on your case branch. Mechanics: [`references/investigation.md`](references/investigation.md) § The surface cache. |
| `.agents/memory/<your-agent>/…` | you — **commit what you produce**, by exact path, on the branch you are on (§ Context economy above); the merge carries it to the trunk. In a PARALLEL context (no pipeline dispatch granting you the tree), the memory skill's base-branch caution applies instead — the serialized pipeline is what makes commit-in-place safe (the numbers: [`references/field-evidence.md`](references/field-evidence.md) § Memory commit safety). |
| The case (TMS or `tasks/<suite>/TC-*.md`) | manual-qa / the TMS author — **TA never edits it.** Divergence from the live product goes back as a filed CLARIFICATION; your code asserts the live contract (Rule 2 § Reverse-masking guard). |
| manual-qa's `.agents/manual-qa/**` | theirs — read-only warm start. Drift you observe goes into your findings and (as a reference, never a copy) your surface cache. |

### 12. Scaffold minimal — no unsolicited integrations

When you scaffold a framework or set up test infra (framework-execution mode), build only what runs tests: runner + config, abstraction layer, fixtures, one smoke test, run/CI command. **Don't wire integrations the task didn't ask for and the project doesn't declare — especially network-calling ones** (TMS/result reporters, analytics, dashboards, notification hooks). A TMS-reporting reporter is opt-in: add it only when explicitly requested **or** declared in `.agents/test-automation.yaml`, and then gated + graceful per [`references/reporters.md`](references/reporters.md) § TMS / result-reporting reporters. Genuinely-needed integration? Propose it to the orchestrator and wait; never wire it silently.

An unsolicited network-calling side-effect breaks local dev and erodes trust — the user asked for tests, not for their machine to phone a TMS on every run (the canonical failure class: [`references/field-evidence.md`](references/field-evidence.md) § Scaffold minimal).

## References

- [references/investigation.md](references/investigation.md) — live investigation discipline: when to go live, the locator ladder, fast-reach, evidence, blocked-step reasoning, surface-cache mechanics.
- [references/defect-filing.md](references/defect-filing.md) — bug-filing mechanics: pristine-repro gate, synthetic input hygiene, tracker routing, the three filing styles, bundle-per-case.
- [references/playwright-patterns.md](references/playwright-patterns.md) — POM, fixture strategy, framework-specific selectors, common gotchas.
- [references/extend-existing.md](references/extend-existing.md) — the `extend-existing` variant: additive-only mechanics, tag chain, verdict scope.
- [references/field-evidence.md](references/field-evidence.md) — measured incidents behind the norms.
- [references/reporters.md](references/reporters.md) — diagnostics tiers and TMS result-reporting gates.
- [../test-automation-workflow/references/coverage-contract.md](../test-automation-workflow/references/coverage-contract.md) — the full coverage contract (invariants, reviewer enforcement, gate mechanics).
