---
name: test-automation-implementation
description: "Use when an Automation-Friendly Spec (AFS) needs to become a green, framework-resident test — the implementer slot of the test-automation pipeline. Six-phase loop (Absorb → Explore → Automate → Execute → Debug → Handoff), the 12 Hard Rules, the Run Report template. Analyst counterpart: test-case-analysis; orchestration: test-automation-workflow."
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Test Automation Implementation

The implementer slot's own skill — the full IC contract, preloaded by
`test-automation-engineer` the same way `test-case-analysis` is the analyst's.
Pipeline philosophy, orchestration, and the batch mechanics live in the
[`test-automation-workflow`](../test-automation-workflow/SKILL.md) skill (load
on demand); this skill is what the implementer needs at hand on every dispatch.

## Implementer slot contract

This skill IS the implementer slot in the test-automation pipeline. When dispatched — by an orchestrator like `test-automation-lead`, or standalone for "implement the AFS at `<path>`" — role, context, parameters, and return shape are fixed here so dispatch prompts don't have to inline them.

**Role.** Take a `ready-for-automation` or `extend-existing` AFS, write the spec (and any required page-object / fixture changes), and run it green once locally — determinism is proven by the orchestrator's batch hardening gate, not by repeated local runs; hand back a PR-ready diff plus a Run Report. Full mechanics in § Implementer six-phase loop and § Hard Rules — implementer below.

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
- Conditional: `defect-found` — only under the Phase 1 gate table's conditions (the defect is filed and the remaining flow is automatable); otherwise it ends at the orchestrator.
- Refuse: `already-covered` (no implementation needed — traceability AFS only), `blocked`, `un-automatable`, `out-of-scope-by-author`.

**Brief-driven dispatch (work that isn't a case).** The orchestrator may dispatch this slot on a [tech-task brief](../test-automation-workflow/references/tech-task-brief.md) instead of an AFS — a technical unit (tech-debt, a stable-handle migration, a config or reporting fix) with no TMS case behind it. Same loop, three substitutions: Phase 1 absorbs the brief (scope, out-of-scope, acceptance criteria) instead of walking a Coverage Map — a brief missing a required section goes back to the orchestrator naming the section, the same move as `needs-analyst-rerun` aimed at the brief's author; Phase 2 explores by reproducing the failure or reading the code the brief names; Phase 4 runs the brief's **Verification** set (its blast-radius specs) green once locally instead of a new spec. Everything else — Hard Rules, context economy, retry budget, Run Report, return contract — applies unchanged. The dispatch passes the brief path where the AFS path would go, and adjacent debt spotted mid-build returns as a finding, never as silent scope widening.

**Per-case parameters** (caller provides at dispatch time):

- TMS case ID
- AFS path
- User set — a key into `.agents/profile.md` § Roles & sample users (e.g. `${TEST_USER}`)
- Branch name — if the caller created the branch. **Don't `switch`, `commit`, `push`, or otherwise touch git unless `.agents/workflow.md` grants commit authority to this slot.**

**Context economy (hard rules — same wording as the workflow PREAMBLE; keep in step).** The bill is resident-context × turns — every turn re-sends your whole context, so turn count and payload size ARE the cost (field measurement: workers averaged ~30 turns at ~1 tool call per turn):

- **Batch independent tool calls into ONE message** — issue non-dependent reads/greps together, never one tool per turn.
- **Read a file once and work from what you read** — ranged reads for big files; no re-reads to double-check what is already in context.
- **Keep runner output lean** — line/dot reporter, tail long failures; never dump a full HTML report or trace into the transcript.
- **Screenshots only when a step fails or visual judgment is the task** — save to disk and cite the path instead of re-emitting pixels into context.
- **Soft budget, a self-check not a cap: ~15 tool turns per case in your unit** (batching makes turns dense — 15 batched turns carry what ~40 single-call turns did). A genuinely long case — 30 steps, a deep debug — may exceed it; what the check catches is **circling**: re-reading what's already in context, retrying the same probe, exploring without acting. At each ~15-turn mark ask: did the last stretch advance the case, or circle? Advance → continue. Circle → act on what you have and record the gap in your Run Report notes.
- **Never clean the tree wholesale.** `git stash --include-untracked`, `git clean -fd`, `git checkout -- .` and `git reset --hard` delete work you did not write — `_returns/` receipts are untracked bookkeeping, and anything written since the last commit is just as exposed; all of it vanishes with no diff and no error (field incident 2026-08-03: one such stash before a `git checkout` swept six freshly written memory entries and three receipts; later agents ran without them). Need a clean tree before switching branches? **Stash by path** (`git stash push -- <the paths you touched>`) or commit your own work first. If a dirty tree you didn't create is blocking you, report it in findings instead of clearing it.
- **Commit what you produce — memory included.** Durable learnings you write under `.agents/memory/<your-agent>/` are part of your deliverable: `git add` them **by exact path** with your work on your case branch, and the merge carries them to the trunk (a parked unit's memory is landed by the merge agent anyway — the code may not land, but what you learned always does). Two disciplines keep this clean: memory rides in **your own commits by path** — never swept in by a broad stage — and any mechanical self-check grep runs against the project's **code root** (e.g. `git diff … -- automation/`), never the whole tree, so memory prose can't produce false hits in a diff scan (field-measured failure: an unscoped locator-policy grep matched dozens of documentation strings).
- **A permission denial blocks an effect, not the task.** Never re-achieve the *same* blocked effect through a different shape — a script instead of the denied command, an alternate binary, a broader allowed command; that evades a pattern, not a policy. But a genuinely different allowed route to the task goal — one that does **not** produce the blocked effect — is legitimate adaptation: take it, and record the substitution in your Run Report notes (what was denied, what you did instead) so a human can veto one that broke intent. No such route → the case goes `blocked` with the denial recorded, and you continue with what remains.

**Retry budget.** Soft limit: **≤ 2 reruns** against the same root cause before escalating. The orchestrator's R2 cap rule will refuse R3 on the same cause regardless — see [`orchestration-playbook.md`](../test-automation-workflow/references/orchestration-playbook.md) § R2 cap rule.

**That budget is about a spec that will not go green. It is NOT a budget for fix rounds after a review** — those run until the reviewer approves. On a fix round:

- **Address every blocking finding.** Not the easy ones, not most of them. A finding you leave untouched comes back classified `unaddressed` and costs the unit another whole round, which is the expensive way to arrive where doing it would have.
- **If one genuinely cannot be done on this branch, say so in `notes` with the reason** — missing framework primitive, the AFS is wrong, it is a product defect, the environment is broken. An unexplained gap is indistinguishable from a skip, and it will be read as one.

Saying "I could not do this, because X" is a complete and respected answer. Leaving it silent is not.

**Return contract:**

- PR-ready diff (spec + page objects + fixtures in one commit set)
- Run Report per § Run Report — mandatory template (classification + evidence)
- If escalating after R2: name the class (architectural / AFS-drift / product-change) so the orchestrator routes correctly

## Implementer six-phase loop

**Absorb → Explore → Automate → Execute → Debug → Handoff.** Six phases. Each ends with a checkpoint. Skip nothing.

### Phase 1 — Absorb

Read the AFS end-to-end. **Read the FULL original case** (TMS case ID / path from your dispatch — its description, preconditions, test data, steps + expected, not just the steps table) and **walk the AFS Coverage Map row by row against it** (spec-format § Coverage Map): every original-case element — each step, **plus any requirement carried by the case's description or preconditions** — must have an Axis-1 row with a real disposition (or, for pure-setup preconditions, be reflected in AFS § Preconditions), and every `asserted` row must name where its expected result is asserted. If a case element has no row, or a row claims `asserted` with no assertion to point at, return `needs-analyst-rerun` naming the row — before writing any code (don't silently implement the shortfall; coverage is the contract, and the reviewer + orchestrator gate on it). Sanity-check Axis 2 too: each "addition" should be a grounded observable, not silent scope creep. Re-read `.agents/testing.md`. Open three neighbouring tests in the same feature area. Check the AFS `Status` field against the slot contract (§ Implementer slot contract above):

| Status | Action |
|---|---|
| `ready-for-automation` | **Accept.** Standard six-phase loop — write a fresh spec. |
| `extend-existing` | **Accept.** Read the covering spec named in AFS § Extension target end-to-end AND read its own AFS (typically in the same `test-specs/<feature>/` directory) so you know what's already proven. Then proceed through Phase 2–6 against AFS § Gap assertions only. The artefact you ship is an *edit to the covering spec*, not a fresh `.spec.ts`. |
| `already-covered` | **Refuse.** No-implementation status — the `lcovered_<…>.md` AFS is a traceability artefact only. Return to the orchestrator noting the misrouting. |
| `out-of-scope-by-author` | **Refuse.** Analyst rejected at Phase 0 case-gate; should not reach implementer. Return to the orchestrator. |
| `blocked` | **Refuse.** Report to the orchestrator with the unblock requirement. |
| `defect-found` | **Conditional.** Confirm the defect ticket exists AND the AFS specifies handling (`expect.soft()` for isolated, let-it-fail-naturally for blocking). If unclear, refuse to the orchestrator. |
| `un-automatable` | **Refuse.** Analyst should not have routed this. |

**This table is the single source of truth.** Orchestrator briefs, dispatch prompts, and project workflows defer to it. New statuses get added here first.

### Phase 2 — Explore (skip if AFS handles are confirmed against the current surface)

If your Absorb pass surfaces a discrepancy between the AFS-stated handles and the live surface under test (the surface changed since analyst pass, or the AFS noted "to-verify" handles) — **or** the straightforward implementation isn't yielding a reliable test — **explore before (and during) writing code**. Exploration here is *technique* latitude (the **how**): drive the surface with whatever tool fits it (for a Playwright/browser project, switch between `playwright-cli` codegen / `playwright-testing` MCP / `browser-verify`, headed vs headless), try a different handle or wait strategy. It does **not** extend to changing *what* is asserted or the case's scope (the **what**) — that's the analyst/reviewer contract; a scope change returns `needs-analyst-rerun`. Before driving the surface, read the feature's exploration digest `test-specs/<feature>/_surface.md` if present — handles, waits, and quirks the analyst confirmed live; verify them as you use them. The digest has **one writer at a time**, and for facts your implementation itself creates or settles, that writer is you: testids/handles you added or renamed, fixture and test-data realities discovered at run time (the auth state's actual project, which rows exercise a branch), a blocker the digest lists that your run resolved. Append those as attributed notes (`**Resolved/added during <CASE-ID> implementation:** …`) and commit the edit on your case branch by exact path, exactly like an AFS amendment (Rule 11) — the merge carries it to the trunk, and the next analyst on this surface verifies your notes like any cached handle. What you may **not** do is rewrite the analyst's behavior or scope claims — disagreeing with those is Run-Report + `needs-analyst-rerun` territory. In a PARALLEL context (no serialized pipeline granting you the tree), the old rule stands: read-only, drift goes in your Run Report. Fast-reach applies to you too: reproduce behavior via the framework's auth state and existing page-object methods in a scratch run instead of re-deriving flows by hand — transit and confirmation, never a substitute for running your own spec. Steps:

1. Drive the surface under test with whatever capability fits it (for a browser project: `playwright-cli` codegen, `playwright-testing` MCP, or `browser-verify` for computed styles).
2. Diff observed handles vs AFS-stated handles.
3. **Amend the AFS in-place** with a `docs(afs): amend selectors per implementer exploration` commit — do NOT silently drift from the AFS.
4. If the gap is a **scope/coverage** change (multiple steps obsolete, app flow changed, the case needs different assertions), **return `needs-analyst-rerun` to the orchestrator** — re-*scoping* is the analyst's job. (Re-exploring *technique* to make the existing scope testable is yours — that's this phase.)

Phase 2 has a budget: **30 minutes of exploration** before escalating to the orchestrator.

**For `extend-existing` AFS:** Phase 2 has an additional pre-step — read the covering spec end-to-end AND its own AFS (the one that authored it) before driving the live surface. The goal is to enter Phase 3 knowing *exactly* what's already proven, so the gap-fill is purely additive. If the covering AFS has been amended since the spec merged (selectors drifted, observable changed), surface that to the orchestrator via `needs-analyst-rerun` *on the covering spec's case*, not on yours — the covering spec is unstable upstream and your extension would land on shifting ground.

### Phase 3 — Automate

Write the test. Follow the framework's conventions 1:1. A **family AFS**
(one AFS covering a cluster of flow-variants via a parameter table) becomes
ONE parameterized spec: one data row per TMS case, each row asserting its
OWN expected values and tagged with its case id — never a shared flattened
assertion across rows. Five rules (full detail in § Hard Rules below):

1. Match the project's framework — read three neighbouring tests first.
2. Extend the project's existing abstraction layer (page object / API client / screen object / scenario module); never duplicate.
3. Resolve the most stable, semantic handle (UI example: getByRole → testid → label → text → CSS last resort).
4. Env vars from `.env` via the project's existing loader. Never hardcode.
5. No `waitForTimeout` / `sleep`. Use the framework's native waits (web-first assertions for UI).

Apply the **No Defect Masking Rule** (§ Hard Rules → 2 below). Forbidden: `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, demoted expects, weakened assertions.

#### Phase 3 for `extend-existing` AFS

When the AFS status is `extend-existing`, the artefact is an *edit to the covering spec*, not a fresh `.spec.ts`. Three mechanics differ from a fresh implementation:

1. **Additive-only on the covering spec.** The spec file is the shared-caller file (Hard Rule 3 → § Additive-only on shared-caller files applies): existing `test()` bodies stay byte-identical; new `test()` blocks (or new `test.step()` sections, or new `expect()` lines inside an existing test only when the AFS Gap assertions section names that exact insertion point) sit alongside. Verify with `git diff <covering-spec> | grep -E '^-[^-]' | head` → empty.

2. **Coverage tag chain.** Append `@<NEW-TMS-ID>` to the covering test group's tag list alongside the existing `@<COVERING-TMS-ID>` tag — `test.describe()` title tags are the Playwright example; pytest markers / JUnit `@Tag`s / scenario tags are the analogues. The group-level tag list is the engagement-level coverage signal; each Jira/TMS case referenced by the spec gets its own tag in that list. Don't create a sibling group/describe block — that would fragment the cluster.

3. **Same-PR amendment if the AFS drifts.** If Phase 2 surfaces an observation that the AFS § Gap assertions section didn't anticipate, amend the AFS via the Phase 2 amend-in-PR rule and ship the AFS update in the same PR — same as fresh implementation. If the amendment widens scope to the point of being a near-rewrite of the covering spec, return `needs-analyst-rerun` and ask analyst to reclassify (typically `ready-for-automation` with a split).

### Phase 4 — Execute

Run the single test locally with the exact CI command from `.agents/testing.md`. Capture the **Run Report** template (mandatory — see § Run Report below).

**Run it in the FOREGROUND and let the call block — with `timeout: 600000`.** The default timeout is 120s and will kill a suite run mid-flight; 600000ms (10 min) is the maximum a foreground call can have.

**If the run is longer than that**, do not end your turn and do not busy-poll. Launch it detached, writing its output to a file, then wait with **blocking foreground polls** — `sleep 300; <check the output file>`, each with `timeout: 600000` — until it is done. A sleep is **one turn however long it lasts**, so waiting this way is both legal and nearly free.

**Never end a turn with "I'll wait for this to complete"** — nothing is going to wake you. Measured in a controlled probe (2026-08-10): a dispatched slot that ends its turn mid-job is forced to report **28ms later**, and *both* the documented `run_in_background` completion notification and the Monitor tool lose that race. What actually happens is that your slot goes silent holding an unfinished branch; and inside a batch, the workflow is blocked on your return, so one idled run stalls the whole campaign behind it, with a `pending` journal entry and no error anywhere to explain it.

**Never poll every few seconds either.** You pay a full resident context on every turn: measured at 132k context, a poll costs ~$0.048, and one gate agent's 27 `kill -0` checks burned $1.29 — a third of its total cost — before being cut off with no verdict. The same wait as two `sleep 300` calls: $0.10.

Measured on the lazy-modal foundation build (2026-07-30): the implementer backgrounded the full suite, wrote *"I'll wait for this full-suite run to complete"*, and stopped. Twelve minutes later its output file was still empty, the conductor was still waiting, and it took a human noticing plus a rescue dispatch to finish a branch that was nearly done. The rescue agent's own note is the rule: *"run synchronously in the foreground — this is exactly the step the prior session backgrounded and abandoned."*

If a suite is too long even for sleep-polling, that is a finding worth reporting (`findings[]`, kind `note`) — say so and run the narrower selection your case needs. A slow suite is a problem to surface, not to hide behind a background job.

If green: proceed to handoff.
If red: enter Phase 5 — Debug.

### Phase 5 — Debug

Classify the failure honestly:

| Class | Action |
|---|---|
| **Infrastructure** (selector mismatch, timing, env var, framework upgrade) | Fix the test or POM. Re-run. |
| **Product-isolated** (one assertion fails for product reason, rest of flow works) | `expect.soft()` with `// Known defect: <TICKET>` comment. File the defect via `atlassian-content` / `issue-tracking` if not already filed. **Then DECLARE it** — return it in `expected_red[]` (spec, test id, ticket, why). The test is now red until the product ships, and an undeclared one makes the batch gate unpassable, holding every healthy case in the batch with it. |
| **Product-blocking** (downstream steps can't run) | **Let it fail naturally.** File the defect. Return task status `blocked` to the orchestrator. Forbidden: `test.fail()`. |

**Soft retry budget:** ≤ 2 reruns against the same root cause. After R2, **stop and return `needs-escalation`** with the rerun count + root-cause notes per rerun. The orchestrator applies the R2 cap rule (escalate to architectural / re-route to analyst / park — never R3). Fishing your way to green by R3+ is a smell, not a strategy: empirically R1→R2 fixes most things, R3 either parks anyway or is wasted effort.

Read whatever failure artifacts the project's framework emits (for a Playwright/browser project: `test-results/`, `playwright-report/`, `allure-results/`, `error-context.md`; for other frameworks the equivalent — JUnit/TAP/JSON reports, HAR/response dumps, perf result files). The framework usually pinpoints the exact mismatch.

**When the artifacts aren’t informative** — three tiers of logging enhancement (in-test logging is your call; an ADDITIVE secondary reporter ships in the PR explicitly flagged; reporter replacement/removal is `needs-escalation`, never a mid-PR move) and the gating rules for TMS / result-reporting reporters (CI / opt-in gated, graceful on failure, config-validated — never firing on a local run): read [`references/reporters.md`](references/reporters.md) when you actually face one. Two rules stay absolute here: **never remove or replace an existing reporter mid-PR** (downstream-facing; escalate instead), and an ungated reporter spamming local runs is a defect to fix, not noise to ignore.

### Phase 6 — Handoff

Five-step task-completion protocol (see [`completing-a-task`](../completing-a-task/) skill):

1. **Verify locally** — single test green, lint clean, diff reviewed.
2. **Commit on a feature branch** — only if `.agents/workflow.md` grants commit authority to this slot; match the convention (typically `tests/<TMS-ID>-<slug>` or `automation/<case-id>-<slug>`; when the caller created the branch, use it). No commit authority → stop after step 1 and return the diff + Run Report; the caller lands the branch and opens the PR.
3. **Push & open PR** via the project's PR tool — `gh pr create` (GitHub), `glab mr create` (GitLab), `az repos pr create` (Azure DevOps). Target branch per `.agents/profile.md` § Automation PR policy. **Include the Run Report in the PR description** — that copy is the durable one the reviewer and orchestrator read (§ Run Report below).
4. **Comment on the originating story/issue** with the PR link via `issue-tracking` — **only if `.agents/profile.md` § Status reporting → "Comment PR link" is `yes`** (skip silently if `no` or no tracker is configured).
5. **Verify the TMS back-write wiring** — the execution back-write itself happens **post-merge and belongs to the orchestrator** (playbook § 3. Close — read the report, act on it); at handoff you confirm the wiring exists (a CI-gated reporter or the orchestrator's adapter protocol) — **only if the seed configures it** (§ Status reporting → "TMS execution back-write" `yes`, i.e. a real `tms.adapter`, not `markdown` / `none`). Perform the write yourself only when running standalone (no orchestrator) — then per the seeded policy, gated + graceful per [`references/reporters.md`](references/reporters.md) § TMS / result-reporting reporters: never on a local iteration; gate on CI / an opt-in flag, degrade gracefully offline (log once, never fail the run). No TMS sync in the seed → nothing to back-write.

Steps 4–5 are **seed-governed**: perform the external writes the project's seeded way-of-work establishes, skip the ones it doesn't. The seed (`.agents/*`) is the contract; never invent a write it didn't set up, never drop one it did.

Return the **Run Report** to the orchestrator as your final message — and make sure the same Run Report is in the PR description (step 3): that copy is durable, and it's where the orchestrator fills the Independent-gate verdict row.

---

## Run Report — mandatory template

End every implementer / runner session with this exact structure (no prose summary — the orchestrator scans the structured block):

```markdown
## Run Report — {TEST_TAG}
- **Implementer-local verdict:** GREEN N/M | RED N/M | BLOCKED  (you fill this in)
- **Independent-gate verdict:** (the orchestrator fills this after the independent hardening gate; implementer leaves blank)
- **Duration:** {n}s
- **Steps passed:** (list each AFS step that ran clean, by name)
- **Failed step:** {step name} — abstraction-layer method ({Page.method()} for UI; client/service method elsewhere) — {file:line}
- **Failure type:** infrastructure | product-isolated | product-blocking
- **Handle that failed:** `{selector / response field-path / accessibility-id / metric query}` — timeout {n}ms
- **Console errors:** (paste, or "none")
- **Network failures:** (4xx/5xx requests, or "none")
- **Artifacts:** framework report dir — `test-results/` / `playwright-report/` / `allure-results/` / JUnit XML / HAR or perf summary
- **Reruns:** {n} (root cause of each — infrastructure / product / flake)
- **Final run duration baseline:** {n}s (the orchestrator uses this for future regression checks)
- **Recommendation:** route to (analyst rerun / implementer fix / the orchestrator merge / file bug {PROJECT-NNNN})
```

Missing fields are unacceptable — every field has a defensible "none" or "n/a" value if not applicable.

**Two-verdict split.** Your implementer-local verdict (your `N/M`) is what *you* observed running the spec in your workspace. The **Independent-gate verdict** is what *the orchestrator* observes running the merged spec independently against the live environment — and that's the merge signal, not yours. Leave the independent-gate row blank; the orchestrator fills it. Don't conflate the two: a GREEN N/N implementer-local + RED 1/3 independent-gate is a real outcome class (environment drift / parallel interaction / fresh-credential interaction), and the format must distinguish them.

**For `extend-existing` AFS, the verdict scopes the entire extended spec.** Run the covering spec end-to-end (original `test()` blocks + your appended ones); your `N/M` covers all of them. A GREEN delta + RED original is a regression — the additive-only contract broke. Same merge gate as any other regression: block until additive-only is restored OR follow the shared-file regression protocol (enumerate affected callers, name re-run results in the PR description). the orchestrator's independent-gate verdict applies to the full extended spec too — same scope, different runner.

---

## Hard Rules — implementer

### 1. Match the project's framework, don't import your own

- Read `.agents/testing.md` first. Whatever framework it names, that's your framework.
- If nothing is documented, detect it (see the `test-automation-workflow` skill § 1. Discover framework). First hit wins.
- No framework at all? Return `needs-escalation` — framework bootstrap is the orchestrator's call.

**Skills are accelerants, not prerequisites.** Use an installed skill when one fits the project's framework (e.g. `playwright-testing` for a Playwright/browser project). If none is installed you are not blocked: conform to the existing framework by reading `.agents/testing.md` + three neighbouring tests; if the framework is unfamiliar or greenfield, learn it from its official docs (and, where the host has skill-discovery wired, optionally install a matching skill — or author a small project-local skill that persists for later cases); worst case, write from first principles + the docs and say so in your Run Report. Only return `needs-escalation` when something is genuinely unobtainable — a paid license, a physical device, an unknown undocumented tool. Never silently force a framework or tool the project doesn't use.

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

> **The orchestrator-side gate.** The orchestrator also enforces this rule. Any dispatch prompt that explicitly instructs the implementer to use `test.fail()` / `xit()` / `@Ignore` / `pytest.skip()` for a product defect is a hard failure on the orchestrator, not the implementer. If your dispatch prompt says "add `test.fail()`", refuse and route back to the orchestrator with the violation noted.

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

If the AFS test-data inventory declares shared state across steps or tests in the file, set serial mode (`test.describe.configure({ mode: 'serial' })` or the framework equivalent). Parallel execution on shared state is a flake source, not a feature.

### 10. Read-only-by-default

Before writing seed-and-cleanup logic, ask: **can this observable be asserted on existing stable data?**

- If YES — prefer it. Pick a stable existing record matching the AFS's data predicates; assert against it; no setup, no teardown. **Zero-leak by construction, parallel-safe by construction** — the strongest cleanliness posture available, because there's no mutation to leak.
- If NO (the observable inherently requires fresh state — new-document upload, new-relationship, new-case): seed minimally, cleanup loudly.

You (implementer) are the right person to make this call — you've seen the surface in Phase 2 Explore. If the AFS specifies seed-and-cleanup but your exploration shows the observable can be satisfied read-only on stable existing data, **amend the AFS via the Phase 2 amend-in-PR rule and ship read-only.**

Why this matters empirically: seed/cleanup is the largest flake source in any non-trivial suite — state leaks across tests, fixtures interact with parallel runners, cleanup race conditions. Eliminating the mutation eliminates the entire flake class.

The rule sequence: Rule 7 (reuse before create) tells you to find an existing helper; this rule tells you to find existing **data**. Both are the same instinct — prefer what's already proven stable over freshly-built state.

### 11. Shared files have one writer — know whose you may touch

Files that several roles could write need a declared owner, or every merge relitigates them:

| File | Writer | Where it is committed |
|---|---|---|
| `test-specs/<feature>/_surface.md` | analyst authors it; you may **append** attributed implementation-time facts (testids you added, fixture realities, resolved blockers — Phase 2 scopes this), never rewrite its behavior/scope claims; parallel context → read-only, drift in Run Report | the trunk (the analyst commits it); your appended notes ride your case branch like an AFS amendment |
| `.agents/memory/<your-agent>/…` | you — **commit what you produce**, by exact path, on the branch you are on (§ Context economy above); the merge carries it to the trunk. In a PARALLEL context (no pipeline dispatch granting you the tree), the memory skill's base-branch caution applies instead — the serialized pipeline is what makes commit-in-place safe (cov60: 26 of 32 merge conflicts were memory add/add collisions from parallel branches; serialization retired that cause) | your case branch |
| The AFS (`test-specs/…`) | analyst writes AND commits it to the trunk; you amend | **the analyst already committed it** before your branch was cut — amend it on your branch when exploration shows drift, by exact path, with the spec that motivated the change |

**Expect the AFS already COMMITTED on the trunk when you start.** Units run one at a time, so the analyst owned the tree before you and committed its own AFS there; your branch is cut from the trunk, so the file is simply present. If exploration shows it has drifted from the live product (a selector, an observable), **amend it on your branch** and commit the amendment with the spec that motivated it, so the change is reviewed alongside the code — stage by exact path, never `git add -A`/`.`. If the dispatch names an `afs_path` that is not on your branch at all, the analyst did not finish the handoff — say so and return, rather than reconstructing the spec from the case text. Reconstructing silently is how a batch ends up with an implementation that no longer matches the reviewed AFS.

### 12. Scaffold minimal — no unsolicited integrations

When you scaffold a framework or set up test infra (framework-execution mode), build only what runs tests: runner + config, abstraction layer, fixtures, one smoke test, run/CI command. **Don't wire integrations the task didn't ask for and the project doesn't declare — especially network-calling ones** (TMS/result reporters, analytics, dashboards, notification hooks). A TMS-reporting reporter is opt-in: add it only when explicitly requested **or** declared in `.agents/test-automation.yaml`, and then gated + graceful per [`references/reporters.md`](references/reporters.md) § TMS / result-reporting reporters. Genuinely-needed integration? Propose it to the orchestrator and wait; never wire it silently.

Why this matters: an unsolicited side-effect — the `jira-reporter`-firing-on-every-local-`npx playwright test` class, making per-test network calls that fail and spam offline — breaks local dev and erodes trust. The user asked for tests, not for their machine to phone a TMS on every run.
