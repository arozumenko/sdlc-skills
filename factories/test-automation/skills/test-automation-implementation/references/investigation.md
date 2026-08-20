# Investigation — live discipline for the build slot

The case text is a *hypothesis*; the running system is the only ground truth.
But TA does not execute cases as a ritual — live case execution belongs to the
manual-qa side, and on the combined route **the first green run of your
automated test IS the case's first execution**. Investigation is targeted: you
go live to answer a specific question, for minutes, and write what you learned
into the surface cache so nobody pays for the answer twice.

## When to go live — and when not

Go live when:

- a handle you need isn't on any rung of the ladder below;
- a case step is ambiguous ("verify the record saved" — where, asserted how?);
- the direct implementation isn't yielding a reliable test and you need to see
  why (timing, an intermediate state, an unexpected redirect);
- a suspected product defect needs the pristine-repro gate before filing
  ([defect-filing.md](defect-filing.md)).

Don't go live to:

- re-execute a case that has a PASS run record — on an evidence-backed route
  the evidence is the execution; re-running it "to be safe" is waste;
- walk the full case start-to-finish before writing code — that ritual is
  dead; the automated test's first green run is that walkthrough;
- confirm what a cache or knowledge file already answers — read first.

## The locator ladder — cheapest first

1. **`.agents/automation/surface/<feature>.md`** — TA's own cache of confirmed
   handles, waits, and quirks (§ The surface cache below).
2. **manual-qa knowledge** (READ-ONLY): `.agents/manual-qa/app_profile.md`
   § Reliable Selectors and § Fragile Areas. Their selectors are candidate
   handles, and a fragile area with a ticket is a soft-expect candidate
   rather than a surprise mid-run. (Any extra docs the manual team keeps
   under `.agents/manual-qa/knowledge/` are a bonus warm start when present —
   the factory itself seeds only format references there.) It is a hint
   cache from a *different team's* live runs: verify everything as you use
   it, and never edit their files — drift you observe goes into your
   findings and your own cache.
3. **The case file itself** (and its run record) — authors often embed the
   exact label, URL, or data the step touches; a run record's screenshots show
   the real screen.
4. **Targeted live probing** — Playwright MCP, `browser-verify` for computed
   styles / CDP, or whatever tool fits the surface. Minutes, not a
   walkthrough: answer the question, capture the handle, get out.

Write-back rule: rung-4 results go INTO the surface cache; rung-2 results are
**referenced, never copied** (§ The surface cache → anti-duplication). Every
handle from any rung is a cache entry, not a fact — verify it as you use it.

## Fast-reach — travel on the suite

Don't start from scratch: authenticate via the framework's auth fast-path
(storage state / auth fixture — `.agents/testing.md` § Hooks) instead of manual
login, and drive deep navigation by running an existing spec or a page-object
scratch script to arrive at the area under investigation. Two boundaries keep
it honest: **transit is not proof** — the observable you came to check you
still observe yourself; and a **failing transit path gets flagged** in your
return — a broken existing flow is a possible regression, free signal.

## Real input, real evidence

- **Perform real actions.** Never synthesize what you're probing (a UI click
  via `page.evaluate`, a hand-crafted response instead of a real request) —
  the system may react differently. Where synthesis is unavoidable (OS-level
  drag, clipboard), follow [defect-filing.md](defect-filing.md) § Synthetic
  input hygiene.
- **Evidence to DISK, cited by path** — never into context:
  ```
  test-results/screenshots/<case-id>-step-<n>-<action>.png
  test-results/json/<case-id>-<iso-timestamp>.json
  ```
  Re-open pixels only when a verdict genuinely needs visual judgment.
- **Check the side channels, even when the surface looks fine** — console
  messages for UI, error fields / status codes for API, crash logs for mobile.
  Silent errors are the worst bugs, and a green-looking screen with a console
  error is a finding.

## Blocked-step reasoning

- Hit a wall (access, data, env)? Don't improvise around it. Record exactly
  what's needed to unblock — the missing role, the absent fixture data, the
  env var — and return `blocked` with that requirement. A guessed workaround
  produces a test that proves the workaround, not the case.
- Found a defect mid-investigation? **Don't force-continue past it** hoping
  downstream steps "probably work" — a defect invalidates downstream
  expectations; you no longer know what "expected" means. Classify per
  SKILL.md Phase 5 and file per [defect-filing.md](defect-filing.md).
- A step first seen failing only after synthetic input is not a defect yet —
  pristine-repro gate first.

## The surface cache — `.agents/automation/surface/<feature>.md`

TA's working cache of confirmed handles, waits, and quirks, one file per
feature surface. It is a **cache, never a source of truth**: verify a handle
as you use it, and treat a stale entry as a prompt to look at the app, not as
a fact.

- **It accretes.** After every live probe, create or update the file: add what
  you confirmed (handle, wait, quirk — with a one-line note of how you
  confirmed it), prune what drifted. This write-back is the whole point of
  rung 4 — the next case on this surface starts at rung 1.
- **You are the writer.** Units are serialized, so the tree is yours while
  dispatched. Commit cache edits **by exact path** on your case branch,
  alongside the code that motivated them; the merge carries them to the trunk.
- **Anti-duplication.** Before writing an app fact, check
  `.agents/manual-qa/app_profile.md` — if it's already there, write a
  reference ("selector: see `app_profile.md` § Reliable Selectors, <area>"),
  never a copy. Copies drift; references stay true.
- **Split when it outgrows one read.** When `<feature>.md` stops being a
  comfortable single read (~150 lines is the smell, not a rule), it becomes
  the ENTRY POINT and index — how to reach the area (auth, transit), the
  waits and quirks that hold area-wide, and a one-line-scope table of
  subareas linking to `.agents/automation/surface/<feature>/<subarea>.md`,
  where that subarea's handle tables move. Readers then load the index plus
  only the subarea their case touches. Never split pre-emptively: most
  surfaces stay comfortably in one file, and an index over three lines of
  content is pure ceremony.
