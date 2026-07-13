---
name: test-case-analysis
description: Use when a TMS test case needs manual execution, handle discovery (selectors / endpoints / element-ids / metric queries — whatever the surface uses), or defect investigation before automation — "analyse SCRUM-T101", "run this case and emit an AFS", any pre-automation case exploration. Produces an Automation-Friendly Spec (AFS); does not write test code.
license: Apache-2.0
metadata:
  authors:
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Test Case Analysis

Execute a TMS test case against the live system, observe what actually
happens, and emit an **Automation-Friendly Spec (AFS)** a downstream
engineer can implement without re-exploring.

**Core philosophy:** a written test case is a hypothesis. The running
system is the only source of truth. This skill never trusts the case as
authored — it runs it step by step against the real system, captures
the stable handles the implementer will need, flags defects, and only
then produces a spec.

## Absolute boundaries

- **No automation code.** No `.spec.ts`, no `test_*.py`, no step
  definitions. The output is a markdown AFS file. Automation is
  implemented downstream — your agent knows which role / workflow
  picks the AFS up.
- **No automating un-automatable cases.** Physical device, visual
  judgment that can't be asserted, flows that genuinely can't be
  scripted — return `un-automatable` to the orchestrator (no AFS
  file is written) and stop.
- **No skipping exploration.** Even if the TMS case looks complete,
  execute it. The case describes intent; only execution reveals truth.
- **External writes follow the seeded policy.** Whether you file a
  tracking ticket for a defect — and where / in what style — is set by
  `.agents/profile.md` § Bug filing; whether the run syncs to a TMS is
  set by `.agents/test-automation.yaml` § `tms`. Do those per the seed,
  for the case you were dispatched for — not for cases you're merely
  surveying. If the seed establishes no tracker filing or no TMS sync,
  don't invent one.

## Analyst slot contract

This skill IS the analyst slot in the test-automation pipeline. When
dispatched — by an orchestrator like `test-automation-lead`, or
standalone for "analyse SCRUM-T101" — role, context, parameters, and
return shape are fixed here so dispatch prompts don't have to inline
them.

**Role.** Execute one TMS test case end-to-end against the live
system, capture the stable handles the implementer needs, classify
the finding, emit an AFS. No automation code (see § Absolute
boundaries).

**Session context — read once at session start.** Typically
auto-imported via `@-blocks` in your agent's `AGENT.md`; if your
agent doesn't auto-import, read them now:

- `.agents/profile.md` — project systems, base URL, credentials
  matrix, sample users, bug filing target
- `.agents/workflow.md` — branch/PR rules, EPIC pattern
- `.agents/testing.md` — framework, locator strategy, TMS case-gate
  exclusion list
- `.agents/memory/<your-agent>/project_briefing.md` — accumulated
  project gotchas from prior sessions
- `.agents/architecture.md` — the surfaces you'll touch (also
  referenced in Phase 2)

Missing context → flag the gap; don't fabricate defaults.

**Per-case parameters** (caller provides at dispatch time):

- TMS case ID (e.g. `SCRUM-T101`)
- User set — a key into `.agents/profile.md` § Roles & sample users
  (e.g. `${TEST_USER}` / `${TRIAL_USER}`)
- Base URL — usually from `.agents/profile.md`, but caller may
  override
- EPIC parent key — for defect filing under `story-subtask` style

**Return contract:**

- **Status** — one of `ready-for-automation` / `already-covered` /
  `extend-existing` / `blocked` / `defect-found` /
  `out-of-scope-by-author` / `un-automatable`. Full semantics in
  Phase 0 (out-of-scope) and § 5 Classify findings (the rest).
- **AFS path** — `test-specs/<feature>/l<pri>_<slug>_<tms-id>.md`
  for fresh-implementation, `lcovered_*` for already-covered,
  `lextend_*` for extend-existing. Omitted for `un-automatable` and
  `out-of-scope-by-author` (no AFS emitted).
- **Filed bug IDs** — if `defect-found`, the tracker IDs created
  per § 5's bug-filing routing.

## Phase 0 — Case-gate (preflight, runs BEFORE Phase 1)

Before fetching the case body, probe its author metadata. **When `source: tms`** this is the TMS author-status / folder / version probe below; **for `markdown`/`story`/`url` sources** it degrades to: the case exists and isn't marked `draft` / `out-of-scope` in its frontmatter. Skip cases the author has marked as not actionable — there's no analyst value in executing them, and downstream the implementer / orchestrator will reject them.

**What to probe** (project-defined in `.agents/testing.md` § TMS case-gate; if absent, default to fetching all and flag the gap):

| Metadata field | Typical exclusions | Why |
|---|---|---|
| **Status** | `Out of Scope`, `Untested`, `Draft`, `Deprecated` | Author has signalled the case isn't currently a target — don't burn cycles |
| **Folder / parent membership** | Mismatch vs requested folder | Catches raw-key-ASC iteration drift across folders (e.g. `KEY-NNN` is in folder A, `KEY-NNN+1` jumped to folder B) — drift recurs when iterating by key |
| **Version / last-modified** | Stale per the project's freshness threshold | Stale cases often contradict the live product (case-text drift) — see [`test-automation-workflow`](../test-automation-workflow/SKILL.md) § Reverse-masking guard |

**How to probe.** Probe the *single-case status field* directly via your adapter (`get_field_value` / `fetch_case(id, fields=[status])` / equivalent). **Don't query-set** — JQL-style `status in (...)` queries on TMS custom fields are unreliable across adapters; verify the field on each case directly.

**Outcomes:**

- All probes clear → continue to Phase 1.
- Status excluded → don't fetch the body; return `out-of-scope-by-author` with the field value as evidence. The orchestrator closes/updates the tracker entry per its Tracker discipline (on standalone runs: per the seeded policy) — don't write the tracker transition yourself.
- Folder/membership mismatch → don't dispatch; return to the orchestrator with the discrepancy. Iteration drift is an orchestrator-side routing issue, not an analyst-side execution issue.
- TMS unreachable for the probe → fall back to fetching the body (Phase 1 will surface it); flag the gap for scout to fill in `.agents/testing.md`.

## The six-phase loop (one case at a time, runs AFTER Phase 0)

```
1. Fetch the case         → TMS adapter (pluggable; see test-automation.yaml)
2. Read app context       → .agents/architecture.md + previous AFS files
3. Execute                → run it against the real system with whatever tool fits the surface, step-by-step
4. Capture handles        → concrete handles (selectors / endpoints / element-ids / metric queries), fallback-ready
5. Classify findings      → ready / already-covered / extend-existing / blocked / defect-found / un-automatable
6. Emit AFS               → test-specs/<feature>/l<pri>_<slug>_<tms-id>.md
```

### 1. Fetch the case

Use the adapter declared in `.agents/test-automation.yaml`. If
`transport: mcp` and the MCP server is online, prefer MCP tool calls
(`mcp__<server>__<tool>` / `<server>/<tool>` depending on host) —
no secrets travel through the agent's context. Otherwise use HTTP
with the configured `auth_env`. If no adapter is configured, read
the markdown case from `test-specs/`. If the TMS is unreachable,
open the case in the browser and copy it by hand — do not block on a
flaky TMS.

Extract every field the TMS carries: name, **description**, priority,
**preconditions**, steps, expected, cleanup, linked story, attachments.
Some TMSs put real acceptance criteria in the description or preconditions —
not just the steps table — so capture those too; they become Coverage-Map
rows (spec-format § Coverage Map), not dropped prose.

### 2. Read app context

- `.agents/architecture.md` — know the surfaces you'll touch
- Previous AFS files in `test-specs/<feature>/` — match their shape
- The project's existing abstraction layer (page objects for UI, API
  clients / service objects for API, screen objects for mobile) —
  your captured handles should align with what exists

### 3. Execute

Run the case against the real system with whatever tool fits the
surface under test — a browser for UI, an HTTP client for API, a
device/emulator for mobile, a load tool for perf. Pick by what the
case touches and what's wired; switching tools mid-case is fine when
the first one isn't producing useful evidence — note which tool
produced which observation in the AFS so the next reader can follow.

**Worked UI example** — three browser tools sit at different layers.
Full triage:
[`../test-automation-workflow/references/browser-tools.md`](../test-automation-workflow/references/browser-tools.md).
In short:

- **Default UI tool** — [`playwright-testing`](../playwright-testing/)
  (Playwright MCP). Prefer its accessibility-snapshot tool for accessible-name
  discovery — it yields both the ref you need to click and the
  role-name pair you'll assert on.
- **MCP server not wired** — the Playwright CLI from the shell
  drives the same browser surface (`codegen`,
  `--trace`, multi-tab, storage, request mocking).
- **Visual / CDP / a11y** — [`browser-verify`](../browser-verify/)
  for computed styles, real CDP input events, storage/cookies, or axe
  audits.

For each step:

1. Perform the real action against the live surface. Never synthesize
   it (e.g. a UI click via `page.evaluate`, or a hand-crafted response
   instead of a real request) — the system may react differently.
2. Capture evidence. Always — a screenshot for UI, the request/response
   pair for API, the device log for mobile, the metric sample for perf.
3. Check the side channels. **Even when the surface looks fine** —
   console messages for UI, error fields / status codes for API,
   crash logs for mobile. Silent errors are the worst bugs.
4. Note the underlying traffic — which requests fire and which payloads
   matter (for UI cases; for API cases this is the action itself).
5. Observe actual vs expected. Record both if they differ.

### 4. Capture handles

Capture the concrete handles the implementer needs — whatever the
surface uses: selectors for UI, endpoints + named response fields for
API, accessibility-ids / ids for mobile, metric queries + thresholds
for perf. Resolve the most stable, semantic handle available.

**Worked UI example** — selector priority order, document in the AFS
for every interactive element:

1. `data-testid` / `data-test` — stable, intentional
2. ARIA role + accessible name — `getByRole('button', { name: 'Apply' })`
3. Accessible label — `getByLabel('Email')`
4. Text content — `getByText('Sign in')` (fragile to i18n)
5. CSS selector — last resort; prefer one anchored to a stable attribute

(API analogue: named response field-path → JSON schema → status code.
Mobile analogue: accessibility-id → id → visible text.)

Always give a **fallback**. Systems change. A single handle per thing
under test is a single point of failure.

### 5. Classify findings

Status per case (goes in the AFS metadata block):

- **ready-for-automation** — case executed end-to-end, selectors
  captured, no blockers
- **already-covered** — Rule-6 behavioural-equivalence dedup against
  an existing merged spec. The observable this case asserts is
  already proven by another spec on file. No own implementation
  needed. Emit a *traceability AFS* at
  `test-specs/<feature>/lcovered_<slug>_<tms-id>.md` containing the
  **dedup proof**: covering spec at `file:line` + a one-paragraph
  behavioural-equivalence argument (why the existing assertion
  satisfies this case's expected observable). Link the original
  TMS case to the covering one in the tracker so the audit trail
  resolves both ways. The `lcovered_` filename prefix is the
  contract — downstream audits grep for it to enumerate
  Rule-6-dedup coverage distinct from fresh-implementation coverage.
- **extend-existing** — Rule-6 *partial*-overlap. An existing merged
  spec covers most of this case's observable, but a small number of
  assertions are missing. Don't write a fresh `.spec.ts`; the
  implementer extends the covering spec with the gap assertions.
  Emit an *extension AFS* at
  `test-specs/<feature>/lextend_<slug>_<tms-id>.md` containing: the
  covering spec at `file:line`, a one-paragraph behavioural-overlap
  argument (what's already proven), and a **Gap assertions** section
  listing exactly what the existing spec doesn't cover (the new
  selectors / observations / expecteds the implementer needs to
  append). Link the TMS case to the covering one in the tracker.
  The `lextend_` filename prefix is the contract — downstream audits
  distinguish extension work from fresh-implementation and from full
  `lcovered_` dedup. Boundary call: if the gap is large enough that
  the extension would be a near-rewrite of the covering spec, treat
  as `ready-for-automation` instead and let the implementer decide
  whether to extend or split.
- **blocked** — analyst hit a wall (access, data, env); the AFS's
  "Blocked Steps" section lists what's needed to unblock
- **defect-found** — real product bug prevents completion. File the
  ticket via your agent's bug-filing capability (see *When you find a
  defect* below for the routing rules) before emitting the AFS;
  reference the bug ID in the AFS
- **un-automatable** — keep as manual; do not emit an AFS; update
  the TMS note

> **Reverse-masking guard — case-text drift is a CLARIFICATION, not
> a defect.** When the live product correctly diverges from the case
> text (case says ≥44px, product = 40px and that's the design;
> case says "Save button visible", product correctly removed Save),
> the **case text** is what's stale, not the product. Don't classify
> as `defect-found`; classify as `ready-for-automation` and assert
> the live contract. File the case-text drift as a CLARIFICATION
> per the project's `Bug filing style`, not a Bug. Full treatment
> in [`test-automation-workflow`](../test-automation-workflow/SKILL.md)
> § Reverse-masking guard.

When you find a defect during execution:

- Do not force-continue past it hoping it "probably works later".
- **Observed only via simulated input? Gate it first.** A finding first
  seen through synthetic event dispatch (or mid-debugging, after earlier
  experimental input in the same page) does not classify as a real
  defect until it passes the pristine-repro gate in
  [references/defect-filing.md](references/defect-filing.md) — fresh
  isolated context, single complete gesture.
- **File every finding — nothing slips through tracking.** Every
  finding (clarification, question, blocker, full defect) gets tracked
  somewhere the team sees.
- **Route by `.agents/profile.md` § Bug filing** — it carries the
  issue tracker (the *system*), the filing style (the *shape*), and the
  target. Your agent's wired bug-filing skill does the *how*; this skill
  hands it the *what* and the *where*.
- **Default strict-per-bug; `bundle-per-case` is opt-in** and only when
  both its prerequisites hold (umbrella-title convention + documented
  comment-anchor format). The umbrella-lookup is the fragile step —
  getting it wrong duplicates tickets, so without both prerequisites
  `strict-per-bug` is the safe default; one more ticket is cheaper than
  a missed clarification.

Full bug-filing + bundle-per-case mechanics:
[references/defect-filing.md](references/defect-filing.md).

### 6. Emit AFS

A single markdown file per case, per the structure in
[`references/spec-format.md`](references/spec-format.md). Path:

```
test-specs/<feature>/l<priority>_<slug>_<tms-id>.md
```

The AFS is the contract. If it's ambiguous, the downstream engineer
will come back asking — which means the execution pass wasn't
complete. Make it stand alone.

**Before you emit, build the Coverage Map — it's your self-audit.** Walk
*every* element of the original case into an Axis-1 row (Case element → Expected
result → Covered by → Asserted where → Disposition) — not just the numbered
steps, but **any requirement the case carries in its description or
preconditions** too (some TMSs put acceptance criteria there; pure-setup
preconditions go to § Preconditions instead). Decomposition (one case step you
executed as several) goes in "Covered by", and any element you couldn't satisfy
gets a `blocked` / `clarification` / `out-of-scope` disposition that also lands
in § Blocked Steps or § Known Defects — never a bare omission. Then list in
Axis 2 every observable you assert *beyond* the case, each with a one-line
grounded reason. Constructing the map is how you catch a dropped or
misread step here, at the source, instead of leaking it downstream. Full shape:
[`references/spec-format.md`](references/spec-format.md) § Coverage Map.

## Evidence paths (convention)

```
test-results/screenshots/<tms-id>-step-<n>-<action>.png
test-results/json/<tms-id>-<iso-timestamp>.json
```

Relative paths inside the AFS; the automation engineer re-uses the
same convention for CI artifacts.

## Batching cases

When handed multiple cases:

- Single case → run directly. No delegation.
- Multiple cases → delegate one sub-agent per case via the host's
  subagent dispatch, in the form `.agents/team-comms.md` documents
  (Claude Code: an `Agent(...)` tool call). Each sub-agent gets its
  own isolated execution context
  (its own browser context for UI, its own client/session for API).
- After sub-agents finish, retrieve each one's final message via the
  host's result-retrieval tool (NOT a shell command), extract the
  AFS path, **verify the file exists on disk**, and recreate it
  yourself from the returned content if it didn't persist.

## Handoff

When the AFS is ready:

1. If `.agents/workflow.md` grants commit authority to this slot,
   commit the AFS on a feature branch — `test(spec): add AFS for <id>`.
   If it doesn't, don't touch git (the working tree is shared with
   other slots) — return the AFS path and content to the caller and
   skip step 2.
2. Push; open a small PR if the project reviews specs before
   automation starts, otherwise hand the AFS path directly back to
   the caller (your agent knows whether the automation role expects
   the spec via PR or via direct handoff)
3. If a defect was found, link the issue in the PR body
4. If the case is `blocked`, stop here and report up — do not pass a
   broken spec downstream. (`un-automatable` never reaches this
   handoff — it's return-only, no AFS is written.)

## Anti-patterns

- **Writing automation code.** Not this skill's scope. Stop.
- **Copying the case text into the AFS verbatim without executing.**
  The AFS needs *discovered* handles, *observed* traffic, *confirmed*
  expected vs actual. A copy-paste AFS is lying.
- **Skipping the side-channel check** because "the surface looks fine"
  (console for UI, error fields / status codes for API, crash logs for
  mobile). Silent errors are the ones that ship.
- **Force-continuing past a defect** to complete the AFS. A defect
  invalidates downstream steps — you no longer know what "expected"
  means.
- **Inventing handles.** If you didn't exercise it, it doesn't go in
  the handles table (a selector you never clicked, an endpoint you
  never called). Run the step.
- **`test.fail()`-style thinking.** If a step fails for a real
  product reason, that's a defect, not a caveat in the AFS.
- **Skipping Phase 0 (case-gate)** because the case "looked fine"
  in a previous batch. Status / folder-membership / version drift
  between batches — re-probe per case, every dispatch.
- **Classifying case-text drift as `defect-found` instead of
  CLARIFICATION.** If live product is correct and the case is
  stale, the case is the bug, not the product. Asserting the
  stale case-text is reverse-masking (see § Classify findings note).
- **Re-implementing a case whose observable is already proven by
  another merged spec.** Rule-6 dedup → `already-covered` with a
  traceability AFS (`lcovered_*.md`), not a duplicate `.spec.ts`.
- **Filing partial overlap as fresh `ready-for-automation`.** When
  an existing merged spec covers most of the observable and only a
  small number of assertions are missing, classify as
  `extend-existing` with `lextend_*.md` + a Gap assertions section.
  Forcing the implementer to rediscover the overlap defeats Rule-6
  dedup and ends with two specs asserting the same behaviour.

## References

- [references/spec-format.md](references/spec-format.md) — the
  Automation-Friendly Spec (AFS) structure, required sections,
  examples. This is what the skill's output looks like.
- [references/defect-filing.md](references/defect-filing.md) — full
  bug-filing mechanics: issue-tracker routing, the three filing styles,
  and the bundle-per-case umbrella-ticket convention.
