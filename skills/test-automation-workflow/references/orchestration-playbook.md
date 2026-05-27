# Test Automation — Orchestration Playbook

The full orchestration playbook for the test-automation pipeline. Whoever fills the **orchestrator slot** (default: `test-automation-lead`; any agent loading `test-automation-workflow` skill can fill the role) runs by these rules.

## Contents

- [Critical orchestrator rules](#critical-orchestrator-rules)
- [How to dispatch a subagent (host preflight)](#how-to-dispatch-a-subagent-host-preflight)
- [Slot defaults](#slot-defaults)
- [Session-start preflight](#session-start-preflight)
- [Pre-flight checklist (per dispatch)](#pre-flight-checklist-per-dispatch)
- [Canonical dispatch templates](#canonical-dispatch-templates)
- [AFS quality gate](#afs-quality-gate)
- [Status discipline (TaskCreate / TaskUpdate)](#status-discipline-taskcreate--taskupdate)
- [Tracker discipline — every dispatch updates the tracker](#tracker-discipline--every-dispatch-updates-the-tracker)
- [Status reporting cadence](#status-reporting-cadence)
- [Handling blockers — classify and route](#handling-blockers--classify-and-route)
- [R2 cap rule](#r2-cap-rule--never-dispatch-r3-on-the-same-root-cause)
- [Rule of thumb — no parallel automation per implementer](#rule-of-thumb--no-parallel-automation-per-implementer)
- [Framework architecture](#framework-architecture)
- [Merging automation PRs](#merging-automation-prs)
- [Batching](#batching)
- [Orchestrator anti-patterns](#orchestrator-anti-patterns)

## Critical orchestrator rules

1. **Dispatch IS the work.** For any routing/coordination turn, your reply MUST contain at least one subagent dispatch — a Claude `Agent` tool call or a Copilot `runSubagent` tool call — matching the host declared in `.agents/team-comms.md`. Narrating intent ("I'll route this to qa-engineer") without emitting the dispatch in the same reply is a failed turn: the subagent never runs. Self-check before sending: every routing sentence must have a matching dispatch call. See § How to dispatch a subagent (host preflight) below.

2. **No defect masking — and the dispatch prompt is the gate.** `test-automation-workflow` § "No Defect Masking" forbids `test.fail()`, `xit()`, `@Ignore`, `pytest.skip()`, and weakened assertions for product defects. You enforce this rule at dispatch time. Decision tree when a test fails for a product reason:
   - **Defect ticket exists** AND **defect is isolated to one assertion** → instruct implementer to use `expect.soft()` with `// Known defect: <TICKET-ID>` comment. Test continues, fails loudly.
   - **Defect ticket exists** AND **defect blocks execution** → let it fail naturally. Test is red until product ships. CI noise is the correct signal. Task status: `blocked` (not `completed`).
   - **No defect ticket yet** → file the bug FIRST (route qa-engineer with `atlassian-content` or `issue-tracking`), THEN apply one of the rules above.
   - **`test.fail()` is never the answer.** If a draft implementer prompt contains "add `test.fail()`", stop and rewrite.

3. **AFS status is contract law.** The full status enum + per-status action is the implementer slot contract in [`SKILL.md`](../SKILL.md) § Phase 1 Absorb — single source of truth. Your routing decision is the small slice of that table:
   - **Advance to implementer:** `ready-for-automation` (fresh spec) · `extend-existing` (implementer edits the covering spec per the AFS's § Gap assertions).
   - **Handle here, don't forward:** `blocked` → unblock (access, data, env) or escalate · `defect-found` → route the filed bug through the bug pipeline; parked automation resumes after the fix · `un-automatable` → close with a note · `already-covered` → close as Rule-6 dedup, link the covering case in the tracker; the `lcovered_<…>.md` AFS is the traceability artefact · `out-of-scope-by-author` → close per project convention (typically Rejected with the TMS author-status as evidence).

   Forwarding a non-advancing status downstream is a wasted round-trip — the implementer will refuse per the skill's gate table.

4. **Act, don't ask — proceed with the obvious default; flag unknowns as tracker entries; never block on a question that has a defensible default.** Before opening any `AskUserQuestion`, run this three-test filter:
   - Is there a project default in `.agents/profile.md` or `.agents/workflow.md`? → **use it.**
   - Is one option strictly safer / more reversible than the others? → **pick it.**
   - Is the cost of being wrong < the cost of waiting for the operator? → **proceed.**

   Only ask when all three conditions hold: no documented default, decision is genuinely irreversible (history rewrite, force push, secret rotation, production change), AND multiple defensible options have materially different downstream consequences you cannot evaluate. Otherwise: pick, file a tracker sub-task with the unanswered question for review, continue.

5. **Deduplicate before routing.** Check the tracker (via `issue-tracking` or `atlassian-content`) before dispatching:
   - Tracker labels / status are the source of truth for task state.
   - If a case already has an `in-progress` (or equivalent) status → it's being worked on. Don't re-dispatch.
   - If a comment shows a role already claimed it → don't duplicate.

6. **Scope is set by the user, not by the agent.** When the work in front of you exceeds the literal ask — one ticket becomes a folder, a folder becomes a tracker reorganization, a fix becomes a framework upgrade — STOP. Surface the expansion back to the operator in one paragraph: *"you asked for X. I see Y. Should I take that on?"* Wait for a quotable authorization before the first dispatch on the expanded scope. **Never assert "the user authorized X" in subsequent narrative without the turn it traces to.** Rule 4's "act, don't ask" filter governs in-scope tactical choices; *scope-of-the-act* is a different question and always belongs back with the operator.

   Self-check before a batch dispatch: am I about to launch ≥N subagents on work the operator didn't explicitly name? If yes, surface first.

7. **Multi-item tracker mutations: read back before reporting "complete".** Any batch mutation across >1 tracker item (status sweep, link creation, re-parent, type conversion, sub-task closure pass) must be followed by an explicit read-back: re-fetch every affected item, diff against the expected-state map you wrote *before* the mutation, report mismatches. Only then claim "complete". Load the [`verification-before-completion`](../../verification-before-completion/) skill — it exists in the package; wire it into your pipeline.

   For destructive mutations (delete-recreate, link removal, parent re-home in trackers with parent-lock): create the expected-state map FIRST, have the operator sanity-check it, then execute.

> **Note on framework-code edits:** the orchestrator does NOT call `Edit` or `Write` on test framework code (`tests/**`, `pages/**`, `fixtures/**`, `playwright.config.*`, etc.). The dispatch goes to the implementer instead. Allowed paths for the orchestrator's own edits: `.agents/memory/<your-agent>/**`, `.agents/audit/**`, `.agents/testing.md`, `.agents/test-automation.yaml`, plus tracker/PR metadata. The orchestrator-agent's AGENT.md may carry the path-specific guardrails as a hard-stop check.

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

### GitHub Copilot CLI — `runSubagent` tool call

```
runSubagent(
  agent="qa-engineer",
  prompt="You are the **analyst slot** for CASE-001. Load test-case-analysis. ..."
)
```

### Parallel dispatch (any host)

Fire **all** dispatches in a single reply, not one per turn. Multiple `Agent` / `runSubagent` invocations in one assistant message.

All dispatches share the parent's working tree — there's no host-level filesystem isolation. When you parallelize, the orchestrator is responsible for collision avoidance: serialize cases that edit the same page object, fixture, or shared helper; parallelize only when surfaces are genuinely independent.

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
| **Live-run gate** | **You (orchestrator)** | — runs the merged spec independently against the live env, ≥N consecutive deterministic GREEN before merge (default N=3, project-configurable in `.agents/testing.md` § Merge gate) |

**The live-run gate is mandatory and is yours.** No implementer self-report is ever a sufficient merge signal. Reviewer `APPROVED` is necessary but not sufficient. You re-run the spec yourself, in a clean process, against the live environment, N times. Only then merge. Empirically: implementer-local runs miss flakes that an independent runner catches (environment drift, parallel-context interaction, fresh-credential interaction). The gate is the cheapest control that catches the most expensive class of bug — a flaky test merged to `main`.

**If `.agents/role-overrides.md` is present** (scout's Step 6.9 output), use its mappings — some slots will be filled by substitute agents (typically a language-matched dev when the dedicated implementer isn't installed). The override file is authoritative for the project.

## Session-start preflight

Run ONCE at the start of every session, before the first dispatch. The per-case Pre-flight checklist below assumes the *session* itself is healthy. These two probes catch the failures that hang subagents mid-dispatch and burn cycles before the first artefact is produced:

1. **Known-mitigation snippets — inject at dispatch, not after the hang.** If `.agents/testing.md` documents a known blocking modal / popup / interstitial for this app (session-expired, forced-password-change, MFA, terms-acceptance, cookie banner), inject the mitigation snippet into *every* analyst and implementer dispatch prompt — not after the first hang. Pattern: *"Before any UI action, dismiss `<modal-name>` if present via `<selector>`."* The cost of redundant inclusion is one paragraph; the cost of the alternative is a hung subagent + manual rescue.

2. **TMS case-gate — confirm cases are actionable before dispatching analyst.** For every case you're about to route, probe the TMS author metadata: status (skip cases the author has marked not-actionable, e.g. "Out of Scope" / "Untested" / "Draft"), folder-membership (catch raw-key iteration drift across folders), version. Probing the single-case status field directly is authoritative; JQL-style `status in (...)` queries on TMS custom fields are unreliable across adapters — verify the field directly, never query-set. The exclusion list is project-defined in `.agents/testing.md` § TMS case-gate; if absent, default to fetching all and flag the gap.

## Pre-flight checklist (per dispatch)

Run before every TMS-case dispatch:

1. **Identify the slot.** Is this a new case (start at analyst), or do we have a `ready-for-automation` AFS already (start at implementer), or is the PR already open (route to reviewer)?
2. **Check for existing AFS** at `test-specs/<feature>/l<pri>_<slug>_<TMS-ID>.md`:
   - Status `ready-for-automation` → skip analyst, go to implementer.
   - Other status → analyst slot first (or handle the status per Critical Rule 3).
   - No AFS → analyst slot first.
3. **Check for a tracker sub-task** under the project EPIC for this case:
   - None → file it first via `atlassian-content` (Jira) or `issue-tracking` (GitHub/GitLab/etc.), then dispatch.
4. **Pick the user set** from `.agents/profile.md` § Roles & sample users.
5. **Dispatch using the canonical prompt template below.**

Skipping the analyst slot when no AFS exists is a hard error. "POM already covers neighbouring cases" is not a valid skip reason.

## Canonical dispatch templates

Use these verbatim, substituting `{PLACEHOLDER}` fields.

### Analyst dispatch (qa-engineer + test-case-analysis)

The skill carries the slot contract (role, session context, return shape) —
see [`test-case-analysis`](../../test-case-analysis/SKILL.md) § Analyst slot contract. The
dispatch prompt just passes per-case parameters:

```
Analyst slot — analyse {TMS_ID} per `test-case-analysis` skill § Analyst slot contract.

Per-case parameters:
- TMS case ID: {TMS_ID}
- User set: {USER_SET}
- Base URL: {BASE_URL}
- EPIC parent (for defect filing): {EPIC_KEY}
```

### Implementer dispatch (test-automation-engineer + test-automation-workflow)

The skill carries the slot contract (role, session context, AFS gate, retry budget, return shape) —
see [`SKILL.md`](../SKILL.md) § Implementer slot contract. The
dispatch prompt just passes per-case parameters:

```
Implementer slot — implement {TMS_ID} per `test-automation-workflow` skill § Implementer slot contract.

Per-case parameters:
- TMS case ID: {TMS_ID}
- AFS path: {AFS_PATH}
- User set: {USER_SET}
- Branch (I created it; do NOT touch git unless workflow.md authorises): {BRANCH_NAME}
```

### Reviewer dispatch (qa-engineer FRESH session + code-review)

The skill carries the slot contract (role, session context, triangulation, standing checks, return shape) —
see [`SKILL.md`](../SKILL.md) § Reviewer slot. The
dispatch prompt just passes per-case parameters:

```
Reviewer slot — review PR #{PR_ID} for {TMS_ID} per `test-automation-workflow` skill § Reviewer slot.
**You did NOT write this code** — adversarial eye, fresh session.

Per-case parameters:
- TMS case ID: {TMS_ID}
- AFS path (one of the three artifacts to triangulate): {AFS_PATH}
- PR ID: {PR_ID}
```

## AFS quality gate

Before forwarding an AFS from analyst to implementer, verify per the relevant status profile.

### For `ready-for-automation` (fresh spec)

- **Status is `ready-for-automation`.** Other statuses follow Critical Rule 3's routing.
- **User selection section** names env var keys explicitly (e.g. `${TRIAL_USER}` / `${TEST_USER}` for projects with multi-credential sets).
- **Test data inventory** classifies every datum: `reuse-existing` / `generate-per-test` / `generate-shared-with-cleanup`.
- **Stable selectors discovered, not guessed** — every selector came from a real browser snapshot or DOM inspection. Unobserved selectors marked "to-verify in implementer Phase 2 (Explore)".
- **Known Defects Found** — every defect filed with ticket ID + recommended handling (`expect.soft()` or natural-fail).
- **Cleanup steps** — state mutations + reset between runs.

An AFS missing any of these is `blocked`, not `ready-for-automation`. Send it back to analyst.

### For `extend-existing` (gap-fill on a covering spec)

The above quality bar still applies *for the gap assertions only*. Plus the extension-specific sections — without all three, the AFS is `blocked` until analyst fills them:

- **§ Extension target** — names the covering spec at `file:line` (path under `tests/` + the line number of the existing `test.describe()` to extend) AND its own AFS path (typically `test-specs/<feature>/l<pri>_<slug>_<COVERING-ID>.md`). Implementer needs both to load context.
- **§ Behavioural overlap** — one paragraph explaining what the covering spec already proves vs what this case adds. This is the dedup argument that justifies extension rather than fresh implementation.
- **§ Gap assertions** — the specific selectors / observations / expecteds the implementer needs to *append*. Each entry should map to an insertion point (new `test()` block alongside existing ones, new step inside an existing test, new assertion inside an existing step). If the gap is large enough that the extension would be a near-rewrite of the covering spec, send back to analyst to reclassify as `ready-for-automation` with a split — analyst owns the boundary call, not you.

The covering spec's TMS case is the implicit *upstream contract* the implementer's reviewer will triangulate against (per [`SKILL.md`](../SKILL.md) § Reviewer slot → Triangulate three artifacts). If the covering AFS is unhealthy (status drifted, selectors stale), the extension is built on shifting ground — block until upstream is stable.

## Status discipline (TaskCreate / TaskUpdate)

Acceptable status transitions:

- **`completed`** — clean green in CI without masking; OR red-for-a-real-product-bug with bug filed and linked.
- **`blocked`** — depends on another task / bug / decision. Always link the blocker via `addBlockedBy`.
- **`pending`** — work not started; no blocker.
- **`in_progress`** — currently being worked on.

"GREEN via `test.fail()`" is NOT `completed` — it's `blocked` on the underlying product bug.

## Tracker discipline — every dispatch updates the tracker

Tracker labels / status are the source of truth for case state, not your turn-by-turn memory. Use the [`issue-tracking`](../../issue-tracking/) skill (or `atlassian-content` for Jira) every time:

1. **Before dispatching analyst** — ensure a sub-task exists under the project EPIC for this case. None → file one. Existing → check it's not already `in-progress` (someone else may be on it).
2. **When you dispatch any slot** — mark the corresponding tracker entry `in-progress` (or the project's equivalent label/status) and add a one-line comment naming the slot + the dispatch prompt summary.
3. **When the slot returns** — update the tracker entry per the result: `ready-for-review` after implementer green, `blocked` (link the blocker) after a `blocked`/`needs-escalation`/`needs-analyst-rerun` return, `defect-filed` after a defect-found.
4. **When the automation PR merges** — verify the tracker entry auto-closed via `Closes #N` (or equivalent); close it manually if not, and back-write the TMS execution.

If `.agents/profile.md` § Issue tracker is `Unconfirmed`, `issue-tracking` defaults to `gh` and flags the gap — surface it to the operator so scout can fix the field.

## Status reporting cadence

After every action, tell the user. The user is your only upstream channel (there's no PM "above" you). After every meaningful turn — dispatch issued, slot returned, PR merged, framework decision committed — emit a status update so the user knows what just happened and what's next.

### Status report format

```markdown
## TA Status Update — {timestamp}

### Completed
- CASE-001: PR #42 merged, TMS back-written ✓
- CASE-002: AFS ready-for-automation (analyst returned)

### In Progress
- CASE-002: dispatched implementer — branch `tests/CASE-002-checkout`
- CASE-003: dispatched analyst — initial exploration in progress

### Blocked
- CASE-004: needs-analyst-rerun — DOM drifted post-2026-05-12 release. Analyst taking second pass.
- CASE-005: product defect blocking flow — filed BUG-123, paused until fix lands.

### Framework decisions pending
- Playwright 1.58 upgrade — drafted plan, awaiting your sign-off.

### Risks
- TMS adapter (Xray) returning partial fields on customfield_19206. Adapter SKILL refresh queued.

### Next Actions
- Reviewer slot for CASE-002 PR once implementer returns green
- Decision needed from operator: should we widen the framework-upgrade scope to include `expect.soft()` ergonomics?
```

Brief is fine — only completed/in-progress fields are mandatory. Empty sections may be elided.

### Two-register output — internal status table + external-reader content

Your status updates to the operator (above) are *internal* — slot/AFS acronyms, file:line refs, the whole shorthand. That register is correct for the operator who's in the loop.

**Tracker content targeting product, environment, or platform owners is a different register.** Bug bodies, blocker escalations, clarification descriptions, anything filed under a ticket that a non-IC reader will open in a week — these must be jargon-free and self-contained:

- No internal acronyms (`AFS`, slot names, role aliases).
- No file paths the external reader can't navigate (`@.agents/memory/...`).
- No "see above" references — bodies stand alone.
- Reproduction steps + observable + expected + actual, in product terms.

When you draft an external-reader ticket and find yourself reaching for an internal term, translate it inline ("Automation-Friendly Spec — the analyst's written observation of the live behaviour"). The two-register split is a *contract with the reader*, not a tone choice.

### Background-job progress protocol

When you run a background MCP / batch / loop script processing ≥10 items (status sweep, link batch, sub-task creation pass, file-by-file analysis), the script MUST emit incremental progress — append `N/total — <item-key> — <outcome>` to a status file per iteration. Then poll the status file and report progress proactively in your status updates ("link sweep — 32/58 done, no failures").

Silent batches that print only at completion create false "stuck?" interpretations and force the operator to interrupt mid-stream. The fix is single-line-per-iteration logging + proactive polling — not reassurance ("not stuck, just long"). Reassurance scales poorly across multi-hour arcs; progress signals scale trivially.

## Handling blockers — classify and route

When a slot returns a non-`ready` status, classify:

| Status returned | Source | Action |
|---|---|---|
| `blocked` (data, access, env) | Operator-resolvable | File a tracker entry with the blocking question; ask the user; pause the case. |
| `defect-found` | Product bug | Route through the bug pipeline (per `.agents/profile.md` § Bug filing); park the automation case until the bug is fixed. |
| `un-automatable` | Case itself | Close the request with a note; do NOT re-dispatch. |
| `needs-analyst-rerun` (from implementer) | AFS drift | Re-dispatch analyst slot with the discrepancy notes; do NOT push the implementer to "make it work." |
| `needs-escalation` (from analyst or implementer) | Framework gap | Pause the case. Read the gap. Apply § Framework architecture (greenfield bootstrap / framework-scale / mid-flow). Resume from where it stopped. |

For all of the above: write the classification + action into the tracker entry as a comment, then send a status update to the user.

## R2 cap rule — never dispatch R3 on the same root cause

After 2 implementer rounds returning RED on the same case (R1 + R2), **do NOT dispatch R3.** Classify:

| Class | Action |
|---|---|
| **Architectural** — case needs a framework primitive that doesn't exist yet | Park the case. Route to framework decision (§ Framework architecture below). |
| **AFS-drift** — analyst's selectors / observables don't match the live product | Return `needs-analyst-rerun`. NOT to implementer. |
| **Underlying product change** | File the discrepancy, park automation until product stabilises. |

Burning R3 on the same root-cause class is the most expensive failure mode in the pipeline. Empirically: R1 → R2 fixes most things; R3 either parks anyway or is wasted effort. The instinct to "one more round" is exactly what the cap exists to override. **The implementer's `≤ 2 reruns` budget (see [`SKILL.md`](../SKILL.md) § Implementer slot contract) is aligned with this rule — if your dispatch template still says `≤ 3`, update it.**

## Rule of thumb — no parallel automation per implementer

**One implementer, one in-flight automation PR.** Until the merge, that implementer is idle from your routing perspective. Do not send them a new case. Do not queue one "for when they're free." Wait for the merge.

Why: parallel WIP on the same implementer means parallel edits to the same page objects / fixtures / config files. Two AFS files for the same checkout flow can't be implemented in parallel by one agent without trashing context and conflicting edits. The throughput gain is imaginary; the rework cost (merge conflicts, half-finished branches, rebases) is real.

**Exceptions:**
- **Independent surfaces** — if two cases touch genuinely independent files (different feature folders, different page objects, different fixtures), parallel dispatch is fine but you (the orchestrator) are responsible for collision detection. Same-surface = serial.
- **Substitute implementers** — if `.agents/role-overrides.md` provides multiple implementer-eligible agents (e.g. `test-automation-engineer` and `js-dev`), each carries its own in-flight count.

Check in-flight state via the project's PR tool: `gh pr list --search "author:test-automation-engineer"` (or equivalent) before dispatching the same implementer twice in a session.

## Framework architecture

The orchestrator absorbs the three framework-architecture responsibilities that previously routed through tech-lead. Tech-lead remains the system architect for application code; the orchestrator is the architect for the test framework.

### The division of labour — you plan, the implementer writes the code

**You do NOT edit framework code yourself.** The tool-edit guardrail (orchestrator's own AGENT.md should carry the path-specific stops) applies here too — `playwright.config.*`, `pages/**`, `fixtures/**`, `package.json`, etc. are off-limits to your `Edit` / `Write` tool. The pattern is the same one PM uses with devs:

| You (orchestrator) | Implementer |
|---|---|
| Decide the framework choice, scaffold shape, fixture pattern, reporter wiring | Write the actual config files, page objects, fixtures, test runner setup |
| Write the plan into `.agents/testing.md` / `.agents/test-automation.yaml` | Read the plan, execute it in a feature branch, open the PR |
| Pair on the PR review since the change is architectural | Return Run Report with PR URL |

Your editable paths in this section are limited to:

- `.agents/testing.md` — framework conventions, run commands, locator strategy, **Reporters** sub-section
- `.agents/test-automation.yaml` — TMS adapter + framework block
- `.agents/architecture.md` — when the test-framework decision interacts with system-side architecture (rare)

Everything else — config files, page objects, fixtures, package manifests — is **dispatched** to the implementer with an explicit plan. If you find yourself reaching for `Edit` on `playwright.config.ts`, stop and dispatch instead.

### 1. Greenfield framework bootstrap

No existing test framework in the repo. Your call to make, the implementer's hands to write it:

- Pick the scaffold per project language from [`framework-scaffold.md`](./framework-scaffold.md). TypeScript → Playwright, Python → pytest + playwright-python, Java → JUnit5 + Playwright-Java, C# → NUnit + Playwright.NET. Match the project's primary language — don't import a foreign stack.
- Define the initial conventions: page-object style, fixture pattern, naming, run command, CI command. **Write these into `.agents/testing.md` yourself** so downstream agents inherit them.
- Decide the TMS adapter with the operator (Xray / Zephyr / TestRail / Azure / markdown fallback — see [`tms-adapters.md`](./tms-adapters.md)).
- **Dispatch the implementer** with the plan: "Scaffold the test framework per `.agents/testing.md` (just written). Create `playwright.config.ts`, the `pages/` directory base class, a `fixtures/` auth helper, and a smoke test proving the scaffold works. Return a Run Report when the smoke is green."

### 2. Framework-scale work

New fixture infrastructure, new page-object base class, CI pipeline changes, framework version upgrades, new TMS adapter beyond the supported set. Flow:

1. **Plan the change** — interface contract, migration shape, blast radius, rollout order. Use `plan-feature` for non-trivial planning. Update `.agents/testing.md` with the new convention so downstream agents see it.
2. **Dispatch the implementer to execute** — with a concrete prompt naming the files to touch, the new pattern to apply, and any migration steps. Implementer writes the code.
3. **Pair with the reviewer slot on the PR** — this is one of the few cases where you also review the PR yourself, because the change is architectural, not a single-test deliverable. You're checking the implementer followed your plan; the reviewer slot is checking test honesty + selectors as usual.

### 3. Mid-flow architectural escalation

Analyst or implementer returns `needs-escalation` — an AFS or partial implementation surfaced a gap the existing conventions don't cover. Examples: a new shared auth-state pattern, a cross-cutting page-object refactor that can't stay local, a new test type that needs a new fixture primitive.

Pause the case. **Plan the resolution; update `.agents/testing.md` with the new convention; dispatch the implementer to execute.** Do not write the fixture / page-object / config change yourself — that's still the implementer's hands on the keyboard. Once the implementer ships and the change is merged, resume the paused case from where it stopped so the next case doesn't re-escalate for the same reason.

### Reporter / logging review (additive changes from implementer)

The implementer may add a **secondary, additive** reporter to the framework config when the existing reporter doesn't surface enough information for debugging — Playwright `['list']` alongside `['junit']`, pytest `-v` plugin, Cypress `mocha-multi-reporters`, etc. Implementer makes the call and ships it in the PR. **You review specifically for impact** before merging:

1. **The existing reporter output is unchanged.** TMS back-write, CI dashboards, and anything that parses the prior format must still see byte-for-byte equivalent output. If the diff touches the existing reporter's options or output file, that's a replacement, not an addition — block the PR.
2. **No significant runtime / disk cost.** Verbose stdout reporter is fine; a reporter that writes a 500MB trace per run is not. Eyeball the reporter's known behavior; ask the implementer for a one-run-cost estimate if uncertain.
3. **PR description flags the addition explicitly.** "Adds `['list']` reporter alongside existing `['junit']`" — if the description doesn't call it out, send the PR back for a clearer write-up rather than approving an invisible config change.

**Reporter replacement or removal is yours alone**, not the implementer's. Swapping `['junit']` for `['allure']`, changing an output schema, dropping a reporter — these are framework-scale decisions. Implementer returns `needs-escalation`; you plan the change, coordinate downstream consumers (TMS adapter, CI config, dashboards), then dispatch the implementer to execute. Add it to `.agents/testing.md` § Reporters so the next implementer inherits the rationale.

### When to involve tech-lead anyway

You **may** dispatch tech-lead when the framework change has cross-cutting application-code implications — e.g., adding a `data-testid` strategy that affects the application's frontend, or wiring an auth-state setup that needs an application-side API. Tech-lead handles the application-side decisions; you handle the test-framework decisions.

## Merging automation PRs

Merging an automation PR is **your** responsibility on TA-only projects. On hybrid projects, you and PM coordinate per `.agents/workflow.md` — typically PM owns feature PRs, you own automation PRs.

**The merge protocol, every time:**

0. **Read `.agents/profile.md` § Automation PR policy.** Three fields control what you do:
   - **Base branch** — confirm the PR targets the right branch.
   - **Merge policy** — `auto-merge` / `human-approved` / `manual`.
   - **Merge strategy** — `squash` / `rebase` / `merge`.

   If `.agents/profile.md` is absent or the section is missing, default to `auto-merge` + `squash` + the project's default branch, and flag the absence in your next user-facing update so scout can fill it in.

1. **Confirm the PR is actually ready.** Use the project's PR tool (`gh pr view` / `az repos pr show` / `glab mr view`). Required: `OPEN`, `APPROVED`, all checks green, base branch matches policy.

2. **Merge with the policy's strategy.** Under `human-approved`, only run this after seeing the human signal. Under `manual`, skip entirely and post a summary.

3. **Close the loop on the tracker.** Verify auto-close fired (`Closes #N` link); close manually via `issue-tracking` if not.

4. **Back-write the TMS execution** via the adapter declared in `.agents/test-automation.yaml`. A merged PR whose TMS still says "not executed" is half done.

5. **Tell the user it shipped.** One-line update: "PR #M merged — <summary>. <implementer-name> free for next case."

**Do not merge** if review is `CHANGES_REQUESTED`, CI is red or pending, PR is draft, or PR touches anything flagged for human approval in `.agents/profile.md`.

## Batching

When a batch of cases lands ("automate all of SPRINT-42's regression suite"):

- **Analysis phase** parallelizes well. Spawn one analyst subagent per case; each gets its own AFS file.
- **Implementation phase** can also parallelize, **but** guard the page-object layer. Two implementers racing to edit `login.page.ts` will collide. Same-surface = serial; independent surfaces = parallel.
- **Review phase** — one reviewer pass per PR. Batch is fine.

After parallel runs, retrieve each subagent's final message via the host's read mechanism, verify files on disk, recreate any that didn't persist.

## Orchestrator anti-patterns

- **Narrating dispatch — always emit it.** "I'm routing this to qa-engineer" is a status update for work that didn't happen unless the same reply also contains the dispatch.
- **Editing test framework code.** You don't. Dispatch the implementer.
- **Authorising `test.fail()` for product defects.** Hard failure on you, not on the implementer. Rewrite the prompt.
- **Skipping the analyst slot.** Every case starts at analyst unless a `ready-for-automation` AFS for it already exists.
- **Forwarding a non-`ready` AFS.** Wasted round-trip — implementer refuses.
- **Hot-pathing tech-lead.** Tech-lead is system-architect for application code. You own test-framework architecture.
- **Asking questions a project default already answers.** Three-test filter first; ask only as a last resort.
- **Marking `completed` on a `test.fail()`-masked green.** That's `blocked`. Fix the status.
- **Self-merging without policy check.** Read `.agents/profile.md` § Automation PR policy first.
- **Shipping speculative framework primitives before root-cause is confirmed.** When something breaks mid-arc (a popup hangs subagents, a credential fails intermittently, a fixture flakes), the temptation is to dispatch a framework-chore implementer to "harden" it. Don't — until root-cause is confirmed to >80% confidence, any helper you ship is speculation, and speculation has a high "dead primitive" rate (shipped, no callers, later reverted). Diagnose first (read the artefacts, reproduce in isolation, name the failing surface), THEN dispatch the chore. The pipeline cycle for a framework chore is expensive; don't spend it on a wrong hypothesis.
- **Trusting an implementer self-report as the merge signal.** Reviewer `APPROVED` is necessary; implementer "green ×2" is not sufficient. The independent live-run gate (you, against a clean live env) is yours, mandatory, and the cheapest control against the flake class.
- **Asserting "user authorized X" without a quotable turn.** Scope expansion needs an explicit operator yes (Critical Rule 6); inferring authorization from silence or related context is the failure mode the rule exists to prevent.
- **Reporting "complete" on a multi-item tracker mutation without a read-back.** Critical Rule 7: the diff against the expected-state map is the verification; the mutation itself is not.
- **Dispatching R3 on the same root cause as R1+R2.** Park or re-route to analyst; don't burn another implementer cycle (R2 cap rule above).
