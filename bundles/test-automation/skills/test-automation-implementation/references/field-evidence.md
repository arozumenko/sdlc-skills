# Field evidence & worked examples

The measured incidents and worked examples behind the norms in `SKILL.md`.
The rules there are binding on their own; read this when you want the
reasoning, or when you're tempted to treat one as negotiable.

## Waiting on long runs (Phase 4)

**Why "never end a turn waiting" is absolute.** Measured in a controlled
probe (2026-08-10): a dispatched slot that ends its turn mid-job is forced
to report **28ms later**, and *both* the documented `run_in_background`
completion notification and the Monitor tool lose that race. What actually
happens is that your slot goes silent holding an unfinished branch; and
inside a batch, the workflow is blocked on your return, so one idled run
stalls the whole campaign behind it, with a `pending` journal entry and no
error anywhere to explain it.

**Why busy-polling is forbidden.** You pay a full resident context on every
turn: measured at 132k context, a poll costs ~$0.048, and one gate agent's
27 `kill -0` checks burned $1.29 — a third of its total cost — before being
cut off with no verdict. The same wait as two `sleep 300` calls: $0.10.

**The canonical failure.** Measured on the lazy-modal foundation build
(2026-07-30): the implementer backgrounded the full suite, wrote *"I'll
wait for this full-suite run to complete"*, and stopped. Twelve minutes
later its output file was still empty, the conductor was still waiting, and
it took a human noticing plus a rescue dispatch to finish a branch that was
nearly done. The rescue agent's own note is the rule: *"run synchronously
in the foreground — this is exactly the step the prior session backgrounded
and abandoned."*

## Context economy

**Turn economics.** Field measurement: workers averaged ~30 turns at ~1
tool call per turn before the batching rule; 15 batched turns carry what
~40 single-call turns did.

**The wholesale-clean incident (2026-08-03).** One
`git stash --include-untracked` before a `git checkout` swept six freshly
written memory entries and three receipts; every later agent ran without
them. Role memory is gitignored and returns live on the telemetry side
today, but your own uncommitted work is just as exposed as ever — anything
plain-untracked (an AFS just written, a spec mid-edit) vanishes with no
diff and no error.

**Why self-check greps scope to the code root.** An unscoped
locator-policy grep matched dozens of documentation strings in memory
prose — run mechanical diff scans against the project's code root
(e.g. `git diff … -- automation/`), never the whole tree.

## Reverse-masking — worked examples (Hard Rule 2)

The case text is a *hypothesis*; the live product is ground truth.
Weakening an assertion *toward* stale case text is masking too:

| Case text says | Live product does | Wrong — reverse-masking | Right — live-contract |
|---|---|---|---|
| Tap target ≥44px (WCAG AAA) | Tap target = 40px (per current design spec) | `expect(box.height).toBeGreaterThanOrEqual(44)` — fails on a non-defect | `expect(box.height).toBeGreaterThanOrEqual(40)` + file CLARIFICATION on case-text drift |
| "Save button visible on form" | Save button correctly removed in v2 redesign | `expect(saveBtn).toBeVisible()` — fails on intentional change | `expect(saveBtn).toHaveCount(0)` + CLARIFICATION |
| Field labelled "Customer" | Field labelled "Constituent" (legacy term, behaviour identical) | Assert "Customer" — fails on cosmetic | Assert "Constituent" + CLARIFICATION |
| Step "click confirm dialog" | No confirm dialog (removed in flow simplification) | `expect(dialog).toBeVisible()` — fails on improved UX | Skip the step in the spec + CLARIFICATION; AFS amended via Phase 2 amend-in-PR |

Why this matters empirically: a stale-hypothesis assertion will
pass-by-luck on the next product change that happens to land on the
asserted value, then fail unpredictably when the product moves again. The
live-contract assertion is durable.

## Read-only-by-default — why (Hard Rule 10)

Seed/cleanup is the largest flake source in any non-trivial suite — state
leaks across tests, fixtures interact with parallel runners, cleanup race
conditions. Eliminating the mutation eliminates the entire flake class.

The rule sequence: Rule 7 (reuse before create) tells you to find an
existing helper; Rule 10 tells you to find existing **data**. Both are the
same instinct — prefer what's already proven stable over freshly-built
state.

## Scaffold minimal — why (Hard Rule 12)

An unsolicited side-effect — the `jira-reporter`-firing-on-every-local-
`npx playwright test` class, making per-test network calls that fail and
spam offline — breaks local dev and erodes trust. The user asked for
tests, not for their machine to phone a TMS on every run.

## Memory commit safety — the numbers (Hard Rule 11)

cov60: 26 of 32 merge conflicts were memory add/add collisions from
parallel branches; serializing the pipeline retired that cause. That is
why commit-in-place is safe *only* under a pipeline dispatch that grants
exclusive tree ownership — and why the parallel-context default is the
memory skill's base-branch caution.
