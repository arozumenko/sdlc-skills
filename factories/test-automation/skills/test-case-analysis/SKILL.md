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

**Context economy (hard rules — same wording as the workflow PREAMBLE;
keep in step).** The bill is resident-context × turns — every turn
re-sends your whole context, so turn count and payload size ARE the
cost. Batch independent tool calls into ONE message (fetch the case,
read the app context, and grep the suite together — never one tool per
turn); read a file once and work from what you read (ranged reads for
big files; no re-reads to double-check what is already in context);
evidence goes to DISK, not into context — save screenshots to the
§ Evidence paths convention and cite the path; re-open pixels only
when a step's verdict genuinely needs visual judgment. Aim to finish
under ~15 tool turns per case as a self-check, not a cap (batching
makes turns dense — 15 batched turns carry what ~40 single-call turns
did). A genuinely long case — 30 steps, a deep product probe — may
exceed it; what the check catches is CIRCLING: re-reading what is
already in context, retrying the same probe, exploring without acting.
At each ~15-turn mark ask: did the last stretch advance the case, or
circle? Advance → continue. Circle → classify from what you have and
record the gap in findings. And a permission denial blocks an EFFECT,
not the task: never re-achieve the same blocked effect through a
different tool or command shape (that evades a pattern, not a policy),
but a genuinely different allowed route to the goal — one that does
not produce the blocked effect — is legitimate: take it and record the
substitution in findings (what was denied, what you did instead). No
such route → the case is `blocked` with the denial recorded, and you
continue with what remains.

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
2b. Read the neighbours   → grep test-specs/ + tests/ BY BEHAVIOUR — to work faster, not to close the case
3. Execute                → run it against the real system with whatever tool fits the surface, step-by-step
4. Capture handles        → concrete handles (selectors / endpoints / element-ids / metric queries), fallback-ready
5. Classify findings      → ready / already-covered / extend-existing / blocked / defect-found / un-automatable
6. Emit AFS               → test-specs/<feature>/l<pri>_<slug>_<tms-id>.md
```

### 1. Fetch the case

**Snapshot first:** in a batch run, intake has usually already written the
full case body to
`.agents/automation/<slug>/cases/<ID>.md` — read that
and skip the fetch entirely (one TMS round-trip per case per batch, and you
and the reviewer triangulate against the identical snapshot). Fetch via the
adapter only when the snapshot is missing, and note the gap in your return.

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

### 2b. Read the neighbours first — to work faster, not to close the case

**Before you execute, read what the suite already knows about this area.** The
point is to arrive informed: handles that already work, the flow that reaches
the screen, the fixtures and test data that exist, the conventions your AFS
should match. That is what makes an analysis cheap — you skip rediscovering what
someone already wrote down.

| Where | Command shape | What you get from it |
|---|---|---|
| `test-specs/<feature>/` | `grep -ril "<feature keyword>" test-specs/` | prior AFS for this area: handles, observables, gotchas |
| the suite (`tests/`, …) | `grep -rn "<observable / label>" tests/` | how this area is actually driven and asserted today |
| the abstraction layer | `grep -rn "<page/API object>" pages/ fixtures/` | objects and fixtures you can build on |

Search by **behaviour** (the observable, the UI label, the endpoint), not by
case id — ids differ across authors even when the area is the same.

**This is reuse, and reuse is about SPEED. It is not a hunt for duplicates.**
Those are different jobs with opposite error costs, and conflating them is how a
suite quietly loses coverage:

- **Reuse** — you borrow knowledge. Wrong guess costs a few minutes: you read a
  spec that turned out to be unrelated. Cheap, do it always.
- **Duplicate** — you assert that this case's behaviour is *already proven
  elsewhere*, and the case is never automated. Wrong guess costs a permanent,
  **invisible** hole: nothing fails, nothing reports, the coverage number even
  looks fine. Expensive, so the bar is high.

So the default outcome of this step is **`ready-for-automation` with better
context** — you now know the handles and the flow. `already-covered` is the rare
exception: it needs a spec **merged to base** that proves the *same observable
with the same expected result*, cited at `file:line`. A spec that touches the
same screen, uses the same page object, or shares a title is NOT coverage.
`extend-existing` sits between them and needs the same merged target plus a
named gap.

**When in doubt, `ready-for-automation`.** A redundant test is visible and cheap
to delete; a missing one is invisible until it lets a bug through. If the
covering spec looks close but you are not certain, say so in your notes and let
the case proceed — that is the intended asymmetry, not a failure to decide.

### 3. Execute

Run the case against the real system with whatever tool fits the
surface under test — a browser for UI, an HTTP client for API, a
device/emulator for mobile, a load tool for perf. Pick by what the
case touches and what's wired; switching tools mid-case is fine when
the first one isn't producing useful evidence — note which tool
produced which observation in the AFS so the next reader can follow.

**Fast-reach — reuse the suite to travel.** Don't start from scratch:
authenticate via the framework's auth fast-path (storage state / auth
fixture — `.agents/testing.md` § Hooks) instead of manual login, and drive
deep navigation by running an existing spec or a page-object scratch script
to arrive at the area under test. Two boundaries keep it honest: **transit is
not execution** — the case's OWN steps and expected results you still execute
and observe live; and a **failing transit path falls back to manual
navigation AND gets flagged** in your return (a broken existing flow is a
possible regression, free signal). You are the only analyst
running — units are serialized — so the shared Playwright MCP browser is
simply yours: no lane, no isolated instance, no port to juggle. (The lane
machinery existed for a parallel front that no longer exists; if you are
somehow dispatched alongside another analyst, fall back to `browser-verify`
(CDP) or `playwright-cli` on an ISOLATED instance so observations never
switch each other's tabs.)

**Exploration digest — read before, update after.** Before driving the
surface, read `test-specs/<feature>/_surface.md` if it exists: confirmed
handles, waits, and quirks from earlier live runs on this surface (yours or
a prior batch's). It is a handle *cache*, never a substitute for execution —
you still run your case live, verifying the digest's handles as you use
them. After your run, create or update the digest with what you confirmed
(and remove what drifted). Three readers benefit: same-surface analysts in
this batch skip re-deriving handles, the implementer enters Phase 2 with
them pre-confirmed, and the next batch on this app starts warm.

**Cluster dispatches — one session, every case executed.** When your dispatch
names several similar cases (a plan-declared cluster), run them in ONE live
session: pay login/navigation/discovery once, then execute **each case's
steps individually** and record per-case observations — "executed the first,
assumed the rest are similar" is the banned failure mode, and the reviewer
triangulates every case. A case that diverges from the family mid-exploration
is returned with its own status (it will run solo).

**Then decide the OUTPUT shape — a separate call from the decision to cluster.**
Clustering bought you a shared session; whether the cases share a *spec* is a
different question, and you are the only one positioned to answer it because you
just watched all of them run. The test:

> **Merge cases that differ only in DATA. Keep separate anything that differs in
> STEPS.**

- **Differ only in data** (same actions, same order, different values, labels,
  endpoints, counts) → one **family AFS**: a parameter table with one row per TMS
  case (each row's own expected values + case id), per-case Coverage Map rows,
  shared preconditions. Downstream it becomes one parameterized spec. Set
  `family_afs=true` and give every member the same `afs_path`.
- **Differ in steps** (an extra confirmation, a different entry point, one case
  asserts something the other never does) → **one AFS per case**, exactly as if
  each had arrived alone. They still ride one branch and one PR, because they
  were analysed together — that is a dispatch economy, not a reason to merge the
  test code. Shared page objects and fixtures get reused either way.

The asymmetry decides the close calls: a needlessly separate spec costs some
duplication, which is visible and deletable. A wrongly merged one makes two
cases share assertions that were never meant to be shared — the weaker case
stops being tested and **nothing turns red**. When the flows are not obviously
the same flow, write them separately.

**One writer at a time.** You are the digest's author, and you commit it
yourself along with your AFS (below). Implementers may **append** attributed
implementation-time notes on their case branch — testids they added, fixture
realities, blockers their run resolved (`test-automation-implementation`
Phase 2 scopes this) — but your behavior and scope claims are yours alone:
disagreement with those comes back to you as reported drift, never as an
edit. When you next work this surface, verify appended notes as you use them,
like any cached handle, and keep or prune them as you would your own entries.

You are also the only analyst running — units are strictly sequential — so
there is no "last writer wins" race any more. The digest is still a **cache of
handles** rather than a source of truth: verify a handle as you use it, and
treat a stale entry as a prompt to look at the app, not as a fact.

**Write the AFS and commit it yourself, on the batch trunk.** Units run one at
a time, so the working tree is yours alone for the whole dispatch — ordinary
git applies. Make sure you are on the batch trunk first (create it from the
base branch if it does not exist anywhere yet), then stage the AFS, the
digest, **and any role-memory entries you wrote** — all **by exact path** —
commit, and push. Never switch to another branch, and leave the tree on the
trunk when you finish.

Committing immediately is the point: your analysis lands the moment it exists,
so a case that ends `already-covered`, `blocked` or `un-automatable` still has
its AFS in history even though no build ever carried it. Two failure modes are
retired by this — one campaign left **47 AFS files stranded uncommitted** with
no owner to pick them up, and an earlier fix (leaving them for the implementer)
meant a case that never reached a build had nobody to commit it at all.

One exception: an **analysis-only** pass (the campaign heads run, where no
build follows and the next stage reads your files out of this same tree) leaves
them on disk uncommitted and runs no git at all. Your dispatch says which you
are in; when it does not, you are in a normal batch — commit.

**Worked UI example** — three browser tools sit at different layers.
Full triage:
[`../test-automation-workflow/references/browser-tools.md`](../test-automation-workflow/references/browser-tools.md).
In short:

- **Default UI tool** — [`playwright-testing`](../playwright-testing/)
  (Playwright MCP). Prefer its accessibility-snapshot tool for accessible-name
  discovery — it yields both the ref you need to click and the
  role-name pair you'll assert on. Under the bundle's lean server flags,
  actions do NOT echo the page back (`--snapshot-mode none`) — snapshot
  explicitly when you need to read it — and screenshots land on disk as
  paths (`--image-responses omit`).
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
   **To disk, not into context**: save under § Evidence paths and cite
   the path. A ~150k-char base64 screenshot that lands in your transcript
   rides along on every remaining turn; view pixels only when the step's
   verdict needs visual judgment.
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

**Merged-target rule** — asymmetric, because one of these verdicts CLOSES a
case and the other produces work:

- **`extend-existing`** may target a spec merged to base **or already merged
  onto this batch's trunk** by an earlier unit. It is safe there because the
  extension rides the same trunk and shares the batch's fate — if the batch
  never lands, the case is in the remainder anyway.
- **`already-covered`** may target **only** a spec merged to base. It is
  terminal: it drops the case out of the remainder entirely, so it needs
  coverage that has already landed. A trunk that later fails its gate would
  otherwise close a case whose "coverage" never shipped, invisibly.

Never target an AFS or spec that has not merged at all. Same-batch similarity
is expressed as a cluster/family (one parameterized spec), not an extend chain: an in-flight sibling is an
unstable comparison basis, and under a large cluster the "looks like case 3"
shortcut is exactly how coverage silently goes missing. When in doubt,
classify `ready-for-automation` — a duplicate fresh spec is visible and
cheap; a false extend is invisible and expensive.

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

## Batching cases — you never dispatch sub-agents

**This skill dispatches nobody, in any mode.** In the pipeline you ARE the
dispatched sub-agent: clustering is decided upstream (the plan/triage forms
the cluster) and arrives as ONE dispatch to you — and a dispatched agent
cannot nest further dispatches anyway. Standalone, the same rule holds,
because every analyst writes AFS files, the digest, and memory into one
shared working tree — parallel analyst fan-out is exactly the collision
class serialization retired.

When invoked directly with multiple cases:

- Single case → run it.
- Similar cases sharing a surface → run them yourself as ONE clustered
  session (§ Cluster dispatches above): per-case evidence, then the
  family-vs-separate output call.
- A pile of unrelated cases → that is a *batch*, and batches belong to the
  pipeline — hand it to the orchestrator role (`test-automation-workflow`)
  rather than grinding it through one analyst session. If you must proceed
  standalone anyway, run the cases one after another in this session,
  verify each AFS exists on disk as you go, and say in your return where
  you stopped — never spawn parallel workers.

## Handoff

When the AFS is ready:

1. **Commit your AFS yourself, on the branch you were dispatched on.**
   Units run one at a time, so nothing else is in the working tree while
   you are: stage the AFS and the `_surface.md` digest **by exact path**,
   commit, push, and leave the tree on the branch you found it on — never
   switch branches. Committing immediately is the point: the analysis
   lands the moment it exists, so a case that ends `already-covered` or
   `blocked` still has its AFS, and an interrupted run loses nothing.
2. Return the AFS path and status to the caller. Open no PR for the
   AFS — it rides the PR of the case it belongs to.

   *Standalone use only* — when you were invoked directly, not from a
   batch, nothing else is writing the tree. Then follow
   `.agents/workflow.md`: commit the AFS yourself if that grants you
   commit authority, otherwise still just hand back the path.
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
