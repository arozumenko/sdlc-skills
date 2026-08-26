# The `extend-existing` variant — full mechanics

Read this when your unit's intake verdict is `extend-existing`: an existing
merged spec covers most of the case's observable, and your artefact is an
*edit to the covering spec*, not a fresh `.spec.ts`. The verdict (or your
dispatch) names the covering spec and the gap — the assertions the existing
spec doesn't make. Everything not stated here follows the normal build loop
and Hard Rules in `SKILL.md`.

## Phase 1 pre-step — know what's already proven

Before writing anything, read the covering spec end-to-end, including its
coverage declaration — that declaration tells you exactly which of its case's
steps are already asserted, so the gap-fill is purely additive. If the
covering spec has drifted from the live product (a selector, an observable),
your extension would land on shifting ground — return `needs-escalation` to
the lead naming the drift, rather than patching the covering spec in passing.

## Phase 3 mechanics — three differences from a fresh implementation

1. **Additive-only on the covering spec.** The spec file is the
   shared-caller file (Hard Rule 3 → § Additive-only on shared-caller files
   applies): existing `test()` bodies stay byte-identical; new `test()`
   blocks (or new `test.step()` sections, or new `expect()` lines inside an
   existing test only when the dispatch names that exact insertion point)
   sit alongside. Verify with
   `git diff <covering-spec> | grep -E '^-[^-]' | head` → empty.

2. **Coverage tag chain + declaration.** Append `@<NEW-TMS-ID>` to the
   covering test group's tag list alongside the existing tag —
   `test.describe()` title tags are the Playwright example; pytest markers /
   JUnit `@Tag`s / scenario tags are the analogues. Don't create a sibling
   group/describe block — that would fragment the cluster. The file also
   gains the new case's own coverage declaration block
   (`TC-<new-id> coverage: …` per SKILL.md § Coverage declaration); the
   existing case's declaration stays untouched. Where a new-case step is
   already asserted by the original blocks, its declaration says so — that
   is precisely what `covered-elsewhere` with the named test as referent is
   for.

3. **Scope growth escalates, never sprawls.** If the gap-fill turns out to
   be a near-rewrite of the covering spec, return `needs-escalation` to the
   lead — the unit is typically re-routed as a fresh spec. Surface-cache
   facts learned en route ride the same PR either way (SKILL.md Hard
   Rule 11).

## Why the spec file counts as a shared-caller file

The covering spec is your edit target; the original `test()` bodies stay
byte-identical alongside the new ones you append. Run the same
`grep -E '^-[^-]'` verification on the spec diff. The mechanics are
identical to a shared page-object edit — the "callers" of an existing
`test()` block are downstream CI / TMS back-write / coverage reporters;
modifying the test body breaks their state silently.

## Run Report — the verdict scopes the entire extended spec

Run the covering spec end-to-end (original `test()` blocks + your appended
ones); your `N/M` covers all of them. A GREEN delta + RED original is a
regression — the additive-only contract broke. Same merge gate as any other
regression: block until additive-only is restored OR follow the shared-file
regression protocol (enumerate affected callers, name re-run results in the
PR description). The orchestrator's independent-gate verdict applies to the
full extended spec too — same scope, different runner.
