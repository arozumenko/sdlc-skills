---
name: test-generation
description: Use when proposing candidate test scenarios from a live page or audit findings as a prioritized coverage-gap report — handed to qa-engineer for AFS, never written as framework test files.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
allowed-tools: Bash(node:*) Bash(bash:*)
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Test Generation — coverage-gap proposal

Propose candidate test scenarios for a page or feature as a **prioritized
coverage-gap report**. This skill is agent-orchestrated: `quality-architect`
loads it during an exploratory pass to surface what *should* be tested but
isn't yet, derived from a live page plus any prior audit findings.

**This skill emits a findings artifact, not test code.** The output is a
prioritized markdown list of candidate / missing test scenarios — a proposal a
human (or `qa-engineer`) reviews and then takes through the real automation
pipeline. It does **not** write executable tests, CDP stubs, or framework
specs. Read the § Guardrail before producing anything.

## Where the proposal goes next

This skill sits *upstream* of automation, never inside it:

```
test-generation (this skill)         →  qa-engineer            →  test-automation-engineer
prioritized coverage-gap proposal       test-case-analysis →       implements in the project
(candidate scenarios, no code)           AFS (automation-friendly    framework — green specs
                                          spec)
```

You produce the coverage-gap proposal. `qa-engineer` runs
[`test-case-analysis`](skills/test-case-analysis/SKILL.md) to turn an accepted
gap into an Automation-Friendly Spec (AFS). `test-automation-engineer` (via
[`test-automation-workflow`](skills/test-automation-workflow/SKILL.md))
implements the AFS as a real framework test. **Do not skip the middle.**

## Step 0: Read context, gather page data

Read the project context before proposing anything:

- `.agents/profile.md` (§ Project systems) — what the system under test is.
- `.agents/testing.md` — framework already in use, existing suites, locator
  strategy, what's already covered (so you don't propose what exists).
- the role's injected `memory/<role>/project_briefing.md` — accumulated gotchas.
- `.agents/quality.md` if present — per-product quality profile (seeding writes
  it; optional, skip if absent).

Then gather page data using the [`browser-verify`](skills/browser-verify/SKILL.md)
skill (CDP). **Read `skills/browser-verify/SKILL.md` first.** Resolve its scripts
path, start Chrome, and probe the page. Relevant Step-0 commands:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless

node "$SCRIPTS/cdp.mjs" navigate "{url}"
node "$SCRIPTS/cdp.mjs" page-info                                  # title, counts, viewport, meta
node "$SCRIPTS/cdp.mjs" get-meta                                   # meta tags, OG, structured data
node "$SCRIPTS/cdp.mjs" query-all "form, input, button, a[href]"   # interactive surfaces
node "$SCRIPTS/cdp.mjs" get-console                                # existing errors
node "$SCRIPTS/cdp.mjs" get-network --status error                 # failed requests
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/testgen-{page}-overview.png
```

Any optional probe output (screenshots, JSON dumps) goes to **ephemeral `/tmp`
only** — e.g. `/tmp/testgen-{page}-{step}.png`. Never write probe artifacts to a
project-root `reports/` or `tests/` directory.

Also check for findings from a prior bug audit (`reproducing-issues`,
`accessibility-audit`, `security-audit`, `performance-audit`, etc.) — proposed
scenarios should explicitly cover known issues so they don't regress silently.

Identify the page type and the key user flows from the screenshot + DOM probe.

## Step 1: Derive coverage gaps

Compare what the page *can* do (flows, inputs, states observed in Step 0)
against what `.agents/testing.md` says is *already covered*. The delta is your
coverage gap. Organize candidate scenarios into four categories:

### Smoke (critical path)
The minimum scenarios that must pass — the primary happy path. Typically 3-8.

### Regression
Edge cases, boundary values, previously-found bugs, error states, empty states,
validation failures.

### Accessibility
WCAG-focused: keyboard navigation, screen-reader flow, color contrast, focus
management. Cross-reference any `accessibility-audit` findings.

### Negative
Invalid inputs, unauthorized access attempts, boundary violations, network
failures.

## Step 2: Score each candidate as a finding

Every proposed scenario is a **finding** in the standard QA schema — it is a
gap, not a verified defect, so the evidence discipline is what keeps it honest.

```
[priority] (confidence/10) {Title}
  category:      Smoke | Regression | Accessibility | Negative
  rationale:     why this flow matters / what risk it covers
  preconditions: what must be true before the scenario can run
  steps:         1. {observed action}  2. {observed action}  3. …
  expected:      what should happen (the assertion the AFS will encode)
  evidence:      /tmp/testgen-{page}-{step}.png  (or DOM/console proof)
  source:        live-probe | audit-finding:{id} | flow-inference
  suggested_fix: n/a for a gap — leave blank or note "add coverage"
  fix_prompt:    one-line handoff: "qa-engineer: run test-case-analysis on {flow} → AFS"
  specialist:    🧪 test-coverage-analyst
```

**Priority (p0–p3):**

- `p0` — critical path is entirely uncovered (login, checkout, the core flow).
- `p1` — a high-traffic flow or a known-bug regression has no coverage.
- `p2` — edge / boundary / secondary flow gap.
- `p3` — nice-to-have, low-risk, cosmetic.

**Confidence (1–10):** how sure you are this is a *real, uncovered* gap.

> **Evidence discipline (non-negotiable).** A proposed scenario is only as
> credible as the proof that the flow exists and isn't already covered. If you
> can't prove the flow exists on the live page (DOM node, screenshot, console
> trace) **and** can't confirm it's absent from the existing suite, lower the
> confidence. Mark inferred-but-unobserved flows `source: flow-inference` with
> confidence ≤ 5. **Never fabricate a selector, a flow, or a "known bug" you
> didn't actually observe or read in an audit finding.** A confident-looking
> proposal for a flow that doesn't exist wastes the whole downstream pipeline.

## Step 3: Emit the coverage-gap proposal

Present the proposal in chat as a prioritized markdown list, grouped by category
with category-level counts. This is the entire deliverable — there is no file to
save into the project tree.

```
## Coverage-Gap Proposal — {target}
{total} candidate scenarios across 4 categories. Existing suite covers {X}; these are gaps.

### Smoke (5 candidates)
- [p0] (9/10) Homepage loads within 3s and primary CTA renders
    rationale: core entry path; no smoke spec found in tests/
    source: live-probe  evidence: /tmp/testgen-home-overview.png
    → qa-engineer: run test-case-analysis on "homepage load" → AFS
- [p0] (8/10) Primary CTA navigates to the funnel
    ...

### Regression (8 candidates)
- [p1] (7/10) Cart total recalculates on quantity change (regresses BUG-142)
    source: audit-finding:BUG-142  evidence: /tmp/testgen-cart-qty.png
    ...

### Accessibility (4 candidates)
- [p1] (6/10) Checkout form fully keyboard-navigable, visible focus ring
    source: audit-finding:a11y-03
    ...

### Negative (3 candidates)
- [p2] (7/10) Submitting empty required fields surfaces inline validation
    ...

### Handoff
Accepted gaps → qa-engineer (test-case-analysis → AFS) → test-automation-engineer.
This skill wrote NO test files.
```

## Guardrail — this skill writes NO test code

This is a hard boundary. The skill emits a **proposal**, never an artifact the
test pipeline would ingest as code.

- **NEVER write to** `tests/**`, `test/**`, `spec/**`, `e2e/**`, `pages/**`,
  `fixtures/**`, or any framework test directory. If you find yourself about to
  create a `.spec.ts` / `.test.js` / `_test.py` / page-object / fixture, **stop**
  — that's `test-automation-engineer`'s job downstream.
- **NEVER emit "executable" CDP stubs, Playwright snippets, or runnable test
  scaffolds** as the deliverable. The steps in a finding are *prose describing
  the scenario*, not code to paste into a spec. Writing runnable stubs invites a
  downstream consumer to skip `test-case-analysis` and `qa-engineer`'s manual
  execution — which violates the "don't automate what you haven't executed"
  rule the real pipeline depends on.
- **Optional probe output is scoped to `/tmp` only** — screenshots and JSON
  dumps from Step 0 are throwaway evidence, never committed artifacts.
- **The only deliverable is the prioritized coverage-gap proposal in chat.**
  Accepted gaps are handed to `qa-engineer`, who runs
  [`test-case-analysis`](skills/test-case-analysis/SKILL.md) to produce the AFS,
  which `test-automation-engineer` then implements. You stop at the proposal.

If a request seems to ask this skill to "generate the tests," reframe: produce
the coverage-gap proposal and name the handoff. Generating framework tests is
out of scope for `test-generation` by design.

## Anti-patterns

- **Writing a `.spec.ts` "to save time."** That's the exact boundary this skill
  exists to hold. Propose the gap; let the pipeline implement it.
- **Proposing coverage for a flow you never observed.** Lower confidence or drop
  it — a fabricated flow poisons the downstream AFS.
- **Re-proposing what's already covered.** Read `.agents/testing.md` first;
  a gap that isn't a gap is noise.
- **Writing probe artifacts into the project tree.** `/tmp` only.
- **Skipping the handoff line.** Every accepted gap needs a one-line
  `qa-engineer: …` route, or the proposal dead-ends.

## References

- [`skills/browser-verify/SKILL.md`](skills/browser-verify/SKILL.md) — CDP probe
  commands used in Step 0 (`navigate`, `page-info`, `get-meta`, `query-all`,
  `get-console`, `get-network`, `screenshot`).
- [`skills/test-case-analysis/SKILL.md`](skills/test-case-analysis/SKILL.md) —
  what `qa-engineer` runs to turn an accepted gap into an AFS.
- [`skills/test-automation-workflow/SKILL.md`](skills/test-automation-workflow/SKILL.md) —
  what `test-automation-engineer` runs to implement the AFS as framework tests.
