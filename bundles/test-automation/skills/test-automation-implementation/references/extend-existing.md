# The `extend-existing` variant — full mechanics

Read this when your AFS `Status` is `extend-existing`: the case is partially
covered by a merged spec, and your artefact is an *edit to the covering
spec*, not a fresh `.spec.ts`. Everything not stated here follows the normal
six-phase loop and Hard Rules in `SKILL.md`.

## Phase 2 pre-step — know what's already proven

Before driving the live surface, read the covering spec named in AFS
§ Extension target end-to-end AND its own AFS (typically in the same
`test-specs/<feature>/` directory). The goal is to enter Phase 3 knowing
*exactly* what's already proven, so the gap-fill is purely additive. If the
covering AFS has been amended since the spec merged (selectors drifted,
observable changed), surface that to the orchestrator via
`needs-analyst-rerun` *on the covering spec's case*, not on yours — the
covering spec is unstable upstream and your extension would land on
shifting ground.

## Phase 3 mechanics — three differences from a fresh implementation

1. **Additive-only on the covering spec.** The spec file is the
   shared-caller file (Hard Rule 3 → § Additive-only on shared-caller files
   applies): existing `test()` bodies stay byte-identical; new `test()`
   blocks (or new `test.step()` sections, or new `expect()` lines inside an
   existing test only when the AFS Gap assertions section names that exact
   insertion point) sit alongside. Verify with
   `git diff <covering-spec> | grep -E '^-[^-]' | head` → empty.

2. **Coverage tag chain.** Append `@<NEW-TMS-ID>` to the covering test
   group's tag list alongside the existing `@<COVERING-TMS-ID>` tag —
   `test.describe()` title tags are the Playwright example; pytest markers /
   JUnit `@Tag`s / scenario tags are the analogues. The group-level tag list
   is the engagement-level coverage signal; each Jira/TMS case referenced by
   the spec gets its own tag in that list. Don't create a sibling
   group/describe block — that would fragment the cluster.

3. **Same-PR amendment if the AFS drifts.** If Phase 2 surfaces an
   observation that the AFS § Gap assertions section didn't anticipate,
   amend the AFS via the Phase 2 amend-in-PR rule and ship the AFS update in
   the same PR — same as fresh implementation. If the amendment widens scope
   to the point of being a near-rewrite of the covering spec, return
   `needs-analyst-rerun` and ask the analyst to reclassify (typically
   `ready-for-automation` with a split).

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
