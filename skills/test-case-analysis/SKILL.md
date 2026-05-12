---
name: test-case-analysis
description: Execute a TMS test case end-to-end, capture stable selectors, flag defects, and emit an Automation-Friendly Spec (AFS). Load for "analyse SCRUM-T101 for automation", "run this case end-to-end and emit an AFS", or any TMS-case exploration before automation. Does not write automation code — emits a spec the implementer picks up downstream.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

# Test Case Analysis

Execute a TMS test case against the live app, observe what actually
happens, and emit an **Automation-Friendly Spec (AFS)** a downstream
engineer can implement without re-exploring.

**Core philosophy:** a written test case is a hypothesis. The app is
the only source of truth. This skill never trusts the case as
authored — it runs it step by step, captures stable selectors,
flags defects, and only then produces a spec.

## Absolute boundaries

- **No automation code.** No `.spec.ts`, no `test_*.py`, no step
  definitions. The output is a markdown AFS file. Automation is
  implemented downstream — your agent knows which role / workflow
  picks the AFS up.
- **No automating un-automatable cases.** Physical device, visual
  judgment that can't be asserted, flows that genuinely can't be
  scripted — mark the AFS `un-automatable` and stop.
- **No skipping exploration.** Even if the TMS case looks complete,
  execute it. The case describes intent; only execution reveals truth.

## The six-phase loop (one case at a time)

```
1. Fetch the case         → TMS adapter (pluggable; see test-automation.yaml)
2. Read app context       → .agents/architecture.md + previous AFS files
3. Execute                → browser-driving capability (your agent's wired MCP), step-by-step
4. Capture selectors      → stable, accessible, fallback-ready
5. Classify findings      → ready / blocked / defect-found / un-automatable
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

Extract: name, priority, preconditions, steps, expected, cleanup,
linked story, attachments.

### 2. Read app context

- `.agents/architecture.md` — know the surfaces you'll touch
- Previous AFS files in `test-specs/<feature>/` — match their shape
- Existing page objects — selector notes should align with what exists

### 3. Execute

Use the browser-driving capability your agent has wired — typically a
Playwright-MCP toolset providing `browser_navigate`,
`browser_snapshot`, `browser_click`, etc. Prefer `browser_snapshot`
for accessible-name discovery — it yields both the ref you need to
click and the role-name pair you'll assert on.

For deeper inspection (computed styles, real CDP input events,
storage/cookies, axe accessibility audits) use whichever
verification-grade browser tooling your agent has — different from
the standard MCP and intended for ground-truth checks the snapshot
API can't answer.

For each step:

1. Perform the real action. Never synthesize a click via
   `page.evaluate` — the app may react differently.
2. Screenshot. Always.
3. Check console messages. **Even when the UI looks fine.** Silent
   JS errors are the worst bugs.
4. Check network. Note which requests fire and which payloads matter.
5. Observe actual vs expected. Record both if they differ.

### 4. Capture selectors

Priority order — document in the AFS for every interactive element:

1. `data-testid` / `data-test` — stable, intentional
2. ARIA role + accessible name — `getByRole('button', { name: 'Apply' })`
3. Accessible label — `getByLabel('Email')`
4. Text content — `getByText('Sign in')` (fragile to i18n)
5. CSS selector — last resort; prefer one anchored to a stable attribute

Always give a **fallback**. Apps change. A single selector per
element is a single point of failure.

### 5. Classify findings

Status per case (goes in the AFS metadata block):

- **ready-for-automation** — case executed end-to-end, selectors
  captured, no blockers
- **blocked** — analyst hit a wall (access, data, env); the AFS's
  "Blocked Steps" section lists what's needed to unblock
- **defect-found** — real product bug prevents completion. File the
  ticket via your agent's bug-filing capability (see *When you find a
  defect* below for the routing rules) before emitting the AFS;
  reference the bug ID in the AFS
- **un-automatable** — keep as manual; do not emit an AFS; update
  the TMS note

When you find a defect during execution:

- Do not force-continue past it hoping it "probably works later".
- **Always file a tracking ticket.** Nothing slips through: every
  finding (clarification, question, blocker, full defect) gets
  tracked somewhere the team sees. How depends on profile.md.
- Determine **where** the ticket lands by reading
  `.agents/profile.md` § Project systems § Bug filing. Two orthogonal
  fields drive the routing — scout's Step 0.7 fills both:

  **Issue tracker** — the *system* the ticket lands in
  (`github-issues` / `gitlab-issues` / `jira` / `azure-devops` /
  `linear` / …). Your agent has a bug-filing capability wired in; use
  it. Filing the ticket itself is not this skill's job — this skill
  hands you the *what* (severity, repro, evidence) and the *where*
  (tracker + style + target); your agent's bug-filing skill does
  the *how*.

  **Bug filing style** — the *shape* of the ticket. Three styles:
  - **`github-issue`** *(default)* — open a standalone issue in the
    tracker named above. Same shape regardless of tracker system (a
    standalone issue in GitHub / GitLab / Jira / …).
  - **`story-subtask`** — create a sub-task under the originating
    story (Jira / Azure DevOps only; the story the TMS case is
    linked to). Fetch the story ID via the TMS adapter's
    `get_test_case_links`, then pass it as the parent when handing
    off to the bug-filing skill.
  - **`separate-ticket`** — file in a dedicated QA/bugs project,
    not the main development tracker. Target is named in
    profile.md § Bug filing target. Same tracker system, different
    project key.
- Determine **whether to bundle or split** by reading
  § Bundling policy and classifying the finding's severity:
  - **Classify the finding first**:
    - *Lightweight clarification / question* — expected behavior
      unclear, minor UI copy ambiguity, missing doc, "should this
      modal close on outside-click?"-type questions
    - *Real defect* — reproducible bug, functional breakage,
      incorrect data, blocker — anything where the product is
      provably wrong
  - **`strict-per-bug`** *(default)* — every finding (either class)
    gets its own ticket. Done.
  - **`bundle-per-case`** *(opt-in, requires umbrella-ticket
    convention already in place on the project)*:
    - If the finding is a *real defect* → its own ticket (same as
      strict-per-bug). Real defects never bundle.
    - If the finding is a *lightweight clarification* → check if
      there's already an open "umbrella" ticket for this TMS case.
      - If yes: add the finding as a comment on the existing ticket.
      - If no: file a new umbrella ticket (title e.g.
        "Clarifications for SCRUM-T101") and make this the first
        comment. Future lightweight findings on the same case
        attach here.

    The umbrella-lookup is the fragile step — getting it wrong
    duplicates tickets. Defer to `strict-per-bug` unless the
    operator's `profile.md § Bug filing style` explicitly selects
    `bundle-per-case` **and** the project already has:
    - A title convention for umbrella tickets (so the
      find-or-create search has something stable to match on).
    - A documented comment-anchor format that Sage can reference
      from the AFS (e.g. "comment-3" or a permalink fragment).
    Without both, `strict-per-bug` is the safe default; one more
    ticket is cheaper than a missed clarification.
- Hand the body, tracker, style, and (for `story-subtask`) parent
  story ID to your agent's bug-filing skill. Do not run a dev-side
  fix lifecycle (failing test → RCA → implement fix → verify) — those
  steps belong to whoever picks the defect up later, not to you
  during analysis. You file and walk away.
- If `.agents/profile.md` § Bug filing is `Unconfirmed`, or your
  agent has no wired tooling for the named tracker, stop and ask the
  operator before filing — don't pick a default silently. Flag the
  gap in the AFS so scout can fill the field on the next onboarding
  pass.
- Note the finding in the AFS under "Known Defects Found" with the
  ticket ID, filing style, and a recommendation — soft-expect
  (isolated) or natural-fail (blocking). Under `bundle-per-case`,
  reference both the umbrella ticket ID and the comment anchor so
  Axel can find the specific note (e.g. "Known defect: JIRA
  SCRUM-BUG-42 comment-3 — soft-expect", or
  "Known defect: GH#234 — natural-fail").

### 6. Emit AFS

A single markdown file per case, per the structure in
[`references/spec-format.md`](references/spec-format.md). Path:

```
test-specs/<feature>/l<priority>_<slug>_<tms-id>.md
```

The AFS is the contract. If it's ambiguous, the downstream engineer
will come back asking — which means the execution pass wasn't
complete. Make it stand alone.

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
  subagent dispatch — `Agent(...)` (Claude), `runSubagent(...)`
  (Copilot), `relay.py send` (taskbox). Each sub-agent gets its own
  browser context.
- After sub-agents finish, retrieve each one's final message via the
  host's result-retrieval tool (NOT a shell command), extract the
  AFS path, **verify the file exists on disk**, and recreate it
  yourself from the returned content if it didn't persist.

## Handoff

When the AFS is ready:

1. Commit the AFS on a feature branch — `test(spec): add AFS for <id>`
2. Push; open a small PR if the project reviews specs before
   automation starts, otherwise hand the AFS path directly back to
   the caller (your agent knows whether the automation role expects
   the spec via PR or via direct handoff)
3. If a defect was found, link the issue in the PR body
4. If the case is `blocked` or `un-automatable`, stop here and
   report up — do not pass a broken spec downstream

## Anti-patterns

- **Writing automation code.** Not this skill's scope. Stop.
- **Copying the case text into the AFS verbatim without executing.**
  The AFS needs *discovered* selectors, *observed* network calls,
  *confirmed* expected vs actual. A copy-paste AFS is lying.
- **Skipping the console check** because "the UI looks fine". Silent
  errors are the ones that ship.
- **Force-continuing past a defect** to complete the AFS. A defect
  invalidates downstream steps — you no longer know what "expected"
  means.
- **Inventing selectors.** If you didn't click it, it doesn't go in
  the selector table. Run the step.
- **`test.fail()`-style thinking.** If a step fails for a real
  product reason, that's a defect, not a caveat in the AFS.

## References

- [references/spec-format.md](references/spec-format.md) — the
  Automation-Friendly Spec (AFS) structure, required sections,
  examples. This is what the skill's output looks like.
