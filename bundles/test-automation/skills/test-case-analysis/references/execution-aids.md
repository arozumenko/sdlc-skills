# Execution aids — situational helpers for the live run

Read the section that matches your situation; the always-on execution rules
stay in `SKILL.md` § 3 Execute.

## When the digest outgrows one file — split it into an index

A surface batches keep returning to accumulates handles for screens a given
case never touches, and every reader pays for all of it. When `_surface.md`
stops being a comfortable single read (~150 lines is the smell, not a rule),
split it — you are its writer, so the split is yours to make: `_surface.md`
stays the ENTRY POINT and becomes the index — how to reach the area (auth,
transit), the waits and quirks that hold area-wide, and a table of subareas
(one line of scope each) linking to `test-specs/<feature>/_surface/<subarea>.md`,
where that subarea's handle tables, waits and quirks move. Readers then load
the index plus only the subarea(s) their case touches; the single-writer
rule applies per file, and implementers append to the subarea file the index
points at. Never split pre-emptively: most surfaces stay comfortably in one
file, and an index over three lines of content is pure ceremony.

## A manual-qa knowledge base is a warm start — reuse it before re-deriving

If the project runs the manual-qa team, its knowledge base lives under
`.agents/manual-qa/` — `app_profile.md` is its entry point (module table +
a knowledge map saying what to read when), with the detail in
`knowledge/modules/<module>.md`, `knowledge/selectors.md`,
`knowledge/ui-patterns.md`, and `knowledge/fragile-areas.md`. Before live
exploration, read `app_profile.md` and the module file covering your case's
area: their selectors are candidate handles, their ui-patterns are candidate
waits, and `fragile-areas.md` is a pre-built quirk list — a known bug with a
ticket there is a red-by-design candidate to hand the implementer rather
than a surprise mid-run. Same discipline as the digest: it is a hint cache
from a *different team's* live runs — verify everything as you use it — and
it is READ-ONLY for you: the manual team owns those files, so drift you
observe goes into your findings[] and your own digest, never as an edit to
theirs.

## Parallel-analyst fallback (historical)

The shared Playwright MCP browser is simply yours — units are serialized, so
there is no lane, no isolated instance, no port to juggle. The lane
machinery existed for a parallel front that no longer exists. If you are
somehow dispatched alongside another analyst, fall back to `browser-verify`
(CDP) or `playwright-cli` on an ISOLATED instance so observations never
switch each other's tabs.

## Why commit-immediately exists (field evidence)

One campaign left **47 AFS files stranded uncommitted** with no owner to
pick them up, and an earlier fix (leaving them for the implementer) meant a
case that never reached a build had nobody to commit it at all. Committing
the AFS the moment it exists retires both failure modes: the analysis lands
even for a case that ends `already-covered`, `blocked`, or `un-automatable`.
