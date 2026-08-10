# Complexity taxonomy — the reasoning behind `complexity-taxonomy.json`

This file explains *why* the numbers in [`complexity-taxonomy.json`](complexity-taxonomy.json)
are shaped the way they are. The JSON is what the scripts read; keep this doc
in sync by hand when you change it.

## The model

```
estimated_active_minutes = base_minutes(step_count) × interaction_tier_multiplier × novelty_multiplier
```

Three factors, each earning its place from measured evidence (not guessed
from first principles) on `seed-project-1` — a client Playwright/pytest UI
test-automation engagement, name withheld (this bundle is public; see
`complexity-taxonomy.json`'s `calibrated_from` for what's disclosable),
19 cases, 2026-08-04/05, via that project's own `efficiency-audit` output:

### 1. `base_minutes(step_count)` — the floor, not the driver

Classic use-case-point / test-point-analysis methods treat step/transaction
count as the *primary* size driver. Measured on the seed project, it wasn't:
correlation with actual cost was **r≈0.37**, with actual time **r≈0.41** — weak
to moderate. Two cases with the same step count varied in cost by more than
2×. So step count sets a floor (a 20-step case is never going to be cheaper
than a 3-step one) but should never be trusted alone.

### 2. `interaction_tier_multiplier` — the strongest signal found

Grouping the same 19 cases by **what kind of UI interaction they exercise**
(not their nominal TMS module) explained far more variance than step count:
canvas/node-graph cases averaged **~55% more expensive and ~43% slower** than
CRUD/form cases with an *almost identical* average step count (9.3 vs 8.7
steps). The taxonomy's five tiers are that finding generalized beyond that
one app's specific page names — keyed on **interaction pattern**, not on any
one project's sidebar labels, so it transfers to a different app on a
different stack.

**Why priority-order, first-match-wins:** a case can plausibly mention
keywords from two tiers (a form embedded in a wizard, a canvas node that
opens a settings panel). The seed data suggests the *pricier* interaction
dominates actual cost whenever a case mixes patterns — so tiers are checked
richest-interaction-first and the first match wins, rather than averaging or
summing multipliers.

### 3. `novelty_multiplier` — reuse vs. cold-start

The single most expensive non-defect case in the seed set (+67% over its
tier's average) turned out to be **entirely rework overhead** on a
"brand-new surface, no prior page object" case — confirmed from the
session's own memory log, not inferred. This is a real, distinct cost driver
from interaction tier: a *simple* CRUD form on a surface nobody has automated
yet can cost more than a *complex* canvas case on a well-trodden one.

This factor can only be resolved with **live app access** (Mode 3 — see
`SKILL.md` § Mode 3) — checking whether the page objects / API clients /
testids the case would need already exist. Cold (Mode 1/2), it's always
`unknown = 1.0`: the honest move when you can't check reuse is to widen the
confidence band, not guess.

## Repetition/clustering discount — real signal found, not yet a taxonomy factor

**Correction (v0.4.0): an earlier version of this section claimed no
repetition/clustering discount existed, "tested and found NOT confirmed."
That conclusion was built on data corrupted by three tool bugs
(`calibration-log.md`'s v0.4.0 entry has the full story) and does not hold
on corrected data — it's been rewritten rather than left standing.**

A natural question: once a surface is "known," or when several similar
cases are dispatched together as a cluster, do they cost less? On corrected
data (`calibration-log.md` v0.4.0), **yes, a real, moderate signal exists**:
`corr(clusterSize, cost) = -0.402`, holding up when controlled for both tier
(checked separately in `crud-form`, `async-realtime`, `rich-widget` — the
gap holds in all three) and step count (solo and clustered cases have
similar average step counts, so this isn't just "clustered cases are
shorter"). Solo cases averaged $12.36, clustered cases $8.32 — roughly
30–50% lower per case when clustered.

**Still not folded into the base × tier × novelty formula**, for a real,
unresolved reason: clustering is a *choice* the lead makes, not a random
assignment — cases that look similar/related get clustered, so a case
already destined to be cheap for other reasons is also more likely to end up
clustered. This dataset can't separate "clustering causally saves cost via
shared exploration overhead" from "the kinds of cases that get clustered
were already going to be cheap." The model stays base × tier × novelty for
now — not because a repetition term was ruled out, but because this one
needs a fourth project (or a project where clustering decisions are logged
with their rationale) to resolve the confound before it's trustworthy enough
to bake into a formula that outputs numbers for a proposal.

## Modifiers — the setup/data/teardown axis (observational, from test-sizer)

The interaction tier prices what the test *does on the surface*; it says
nothing about what it costs to *stand the test up and tear it down*. The
manual-qa bundle's `test-sizer` rubric has priced exactly that axis for
manual/agent execution since before this skill existed — its six modifiers,
field-tested there. Four transfer to automation cost and are this skill's
verdict-pass vocabulary: **`complex-preconditions`** (specific role + seeded
data + reached app state — fixture work), **`rich-test-data`** (5+ fields /
upload / dynamically generated unique values — data-factory work),
**`heavy-teardown`** (3+ cleanup steps, persistent-data deletion, config
reset — cleanup-fixture work), **`high-assertion-density`** (6+ distinct
checkpoints — assertion + stabilization work). The other two —
multi-page flows and drag-drop/editor interactions — are deliberately
EXCLUDED: they are what the tier axis already prices
(`multi-step-flow`, `rich-widget`), and counting them twice would bake a
hidden double premium into every estimate.

**Observational, not priced.** No automation-cost premium for any modifier
has been measured yet, so — same discipline as rework and case quality —
modifiers never move the point estimate or the band. They ride the verdict,
the output rows, and the report's risks section as *comparable, named*
observations (vs the free-form `signals`), so that once training rows carry
them, calibration can test which of the four earns a real multiplier.
test-sizer's own escalation table (S + 2 modifiers → L) is calibrated for
*execution* cost on its host, not for automation-implementation cost — don't
import its arithmetic, only its eyes.

## Case quality / drift — a band-widener, not a multiplier (yet)

Field observation across projects: cases of equal step count and tier still
vary in cost with the quality of the case *text* itself — vague steps
("verify it works"), missing expected results, unstated test data, text that
has drifted from the live product. Each predictably costs analyst time
(re-derivation) and raises rework odds (drift discovered mid-implementation —
the same failure the pipeline's `needs-analyst-rerun` path exists for). No
*measured* premium exists yet, so — same discipline as rework below — quality
flags do NOT move the point estimate: a flagged case is priced with the
widest confidence band regardless of calibration state, and the report
aggregates the flags as a named risk. The verdict pass (SKILL.md) is what
produces the flags; once training rows carry them, a future calibration can
test whether a real multiplier is earned — until then, inventing one would
be exactly the guessed-from-first-principles number this taxonomy exists to
avoid.

## Why rework isn't a fourth multiplier

Rework-round count correlated with cost at r≈0.48 — real, but it's a
**tail-risk**, not a **typical-case cost**: most cases in the seed set needed
zero extra rounds. Baking a rework premium into every estimate's *mean* would
systematically overstate the median case to cover a risk that doesn't apply
to most of them. Instead:

- It widens the **confidence interval** (a case flagged novel-surface or
  known-defect-area gets a wider high-side band, not a higher point estimate).
- It's called out as a **named risk** in the scoping report — "this bucket
  has historically needed a fix round in ~N% of cases" — so a reader can
  reason about tail risk explicitly instead of it being silently smeared into
  every number.

## Batch shape & delivery rate — SCOPE-level factors, stated not multiplied

Two cost drivers live above the per-case formula entirely, measured on a live
pipeline project's weekly audit (2026-08-06, ~44 cases/window, ccusage-metered):

- **Operating shape.** The same pipeline ran batched (3 batches of 10/11/39)
  and then single-case (44 batches of 1) across one boundary:
  **$11.80/delivered batched vs $22.10 single-case (+87%)**, delivery rate
  90% vs 80%. The mechanism is the orchestration tax — intake, seed re-read,
  close-out — paid **once per batch**: ~$3.90/case (22.2% of all spend) at
  batch-of-1, amortized to noise at batch-of-10+. A calibrated $/case
  implicitly bakes in the batch shape its training data ran under; an
  estimate must therefore SAY which shape it assumes, and a scope destined
  for one-off dribble delivery deserves the measured premium named as a risk.
- **Delivery rate & the blocked-case premium.** Blocked cases cost **~1.85×
  the median delivered case** (they burn the full analyse+build+review+gate
  loop, then don't land); in the measured window 19% of all spend bought
  cases that didn't go green. This is why the report always quotes **both
  denominators** — $/case-examined (what putting a case through costs) and
  $/spec-delivered (what a shipped spec costs) — and states the assumed
  delivery rate. Quoting only $/examined silently promises a 100% delivery
  rate nobody measures.

Neither factor enters `base × tier × novelty` — they scale the SCOPE, not a
case. They live in the scoping report's assumptions (scoping-report-format.md)
as stated, sourced numbers.

## Extending the taxonomy for a different stack

The five tiers here were derived from a Playwright/UI test suite. A mobile,
API, or performance-testing project will need different keyword sets (and
possibly different tiers entirely — e.g. an API project's expensive tier
might be "multi-service orchestration / async callback" rather than
"canvas/drag-drop"). Don't force-fit; add or rename tiers in a
project-local `.agents/estimation/complexity-taxonomy.json` copy
(see `calibration-methodology.md`) rather than stretching these keywords to
cover a pattern they weren't measured against. The *shape* (base × tier ×
novelty, first-match-wins tiers, rework as variance not mean) generalizes;
the *specific tiers and keywords* are a UI-testing starting point, not a law.
