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

### Novelty is per-SURFACE-per-WAVE, not per-case (v0.6.0 correction)

A 55-case campaign delivered in 7 sequential waves was measured wave by wave:

| Wave | $/delivered |
|---|---|
| wave-01 (first to touch the pipeline canvas) | **$14.18** |
| wave-03 | $7.81 |
| wave-04 | **$7.03** |
| wave-07 | $9.11 |

Wave-01 cost **2× the cheapest wave** because it built the page objects and
handles that waves 3–7 reused — the audit's own rule was *"expect wave-01 of
any new surface to cost ~2× steady-state; don't judge a campaign on its first
wave."*

**Two wrong conclusions to avoid, both tested and both wrong:**

1. **Don't raise `novel_surface_no_existing_coverage` toward 2.0.** It looks
   implied by the 2× above. It was tried against 89 blind-read cases across
   four batches and made *every* batch worse (2.07× / 3.02× / 4.58× over
   actuals). The 2× is a property of the **first wave on a surface**, not of
   each case in it.
2. **Don't resolve novelty by first-touch-per-abstraction.** Marking the first
   case that needs each page object as `novel` flagged 39 of 55 campaign cases
   novel, when the real foundation cost concentrated in wave-01's 8. Roughly
   5× too many cases charged the premium.

The right shape is to charge the foundation premium **once per surface, to the
first wave that touches it** — which in practice means it belongs in the
foundation line (`foundation-catalog.json` § `base-abstractions`,
`app-profiling`) and in the report's sequencing advice, not smeared across
per-case novelty. A blind Mode 1 estimate cannot see it at all: measured
against those 7 waves, blind per-case estimates ranked wave cost at
**Spearman −0.214** — slightly *anti*-correlated. Say so rather than implying
the per-case numbers carry sequencing information they don't.

## The size axis lives beside this model, not inside it

`complexity-taxonomy.json` also carries `size_scale` and `size_rubric` (added
in v0.5.0), which produce an XS/S/M/L/XL work size and its Service Points.
That is a **separate currency**, documented in
[`sizing-rubric.md`](sizing-rubric.md) — it does not feed `base × tier ×
novelty` and `base × tier × novelty` does not feed it.

Two reasons they stay apart. First, they answer different questions: this
model prices what the *agent pipeline* burns; the size axis prices the work
in *conventional engineer effort*, which is what a proposal quotes and what
a delivery tracker logs. Second, the empirical link between them is weak —
median agent cost by hand-assigned size on the source engagement ran S $6.12,
M $5.55, L $15.00, XL $17.22 (n=16, one $145 failure excluded): S and M do
not separate at all. Deriving one from the other would manufacture a
precision the data doesn't support, in both directions.

They share inputs, which is the whole reason the size axis was cheap to add:
`steps` and the interaction tier already existed, and `new_abstractions` is
just the countable form of `novelty_multiplier`'s binary novel/established
question. The verdict pass collects all of it in one read.

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

**v0.6.0: measured again on a blind holdout, and it is the largest single
source of per-case error.** Against 26 cases with individual actuals, the
estimate ran **1.30× hot on solo cases but 2.84× hot on clustered ones** — a
~2.2× error swing attributable to clustering alone. In one batch the three
cases a blind reader judged most expensive were delivered as **one cluster on
one branch for $10.60 total** ($3.53/case, near that batch's cheapest). The
estimate was right about the work and wrong about the **unit**.

Because clustering is decided at delivery time, *after* the estimate exists, a
per-case estimate structurally cannot see it. So v0.6.0 makes it a **required
stated scope assumption** in the report (`complexity-taxonomy.json`
§ `clustering.report_requirement`) rather than leaving the reader to infer a
delivery shape. A scope full of near-identical sibling cases will cluster and
should be flagged as likely to land under a per-case estimate.

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

## Risk flags — the factor the model was missing (v0.6.0)

Across two independent blind-holdout batches, the **single most expensive case
in each** was driven by something with no term anywhere in `base × tier ×
novelty`:

- One at $26.52 (3× the next case in an 11-case batch): a nested-agent case
  needing a credentialed external tool server the case text assumes into
  existence, asserting only that "the response references the tool output" —
  naming no string, field or schema. The reader's words: *"the parent model
  must choose to call the sub-agent, and the sub-agent must choose to call the
  tool, so a healthy app can fail and a broken one can pass."*
- One at $18.18 (most expensive in its 55-case window): *"non-deterministic
  oracle + live model credentials; the input payload is never specified."*

Both were correctly identified as the priciest case in their set **by blind
readers**, and both were then priced *below baseline* by the formula — because
both wait on a model, and `async-realtime` carries 0.87. The reads were right;
the arithmetic discarded them.

So `risk_flags` is now first-class vocabulary: **`nondeterministic-oracle`**,
**`external-dependency`**, plus **`low-confidence-verdict`** and
**`split-recommended`** promoted automatically from the reader's own
`confidence` and split advice (in v0.5.0 those two rode along as decoration and
moved nothing).

**Still band-wideners, not multipliers**, for the same reason as everything
else here: two clear anecdotes is a real signal, not a measured premium.
Inventing a coefficient from n=2 is the guessed-from-first-principles number
this taxonomy exists to avoid. They are the #1 candidate factor for the next
calibration whose training rows carry them.

**An honest residual limit.** Even the widest band (0.5–2.0×) does not cover
that $26.52 case — its point estimate was $5.79, band $2.89–$11.57, actual
4.6× the point. Widening the band far enough to cover it would make every
other estimate useless. The right treatment for a case whose oracle is
unspecified is therefore the same as `split_recommended`: **report it as
unquotable until the oracle is specified**, rather than quoting a number with a
wide band around it.

## Why the flags don't move the price — the measured answer

The obvious objection: if a case is flagged as harder, why doesn't the number
go up? Until v0.6.1 the answer was procedural ("no measured premium yet").
Measured on a 26-case blind holdout, the answer turns out to be substantive —
**most of these signals don't have the sign you'd assume.** Median actual ÷
estimate (below 1.0 means the estimate was already too high):

| Signal | Flagged | Unflagged |
|---|---|---|
| `split_recommended` | **0.46×** | 0.79× |
| `heavy-teardown` | **0.45×** | 0.79× |
| `complex-preconditions` | 0.70× | 0.83× |
| any modifier | 0.70× | 0.83× |
| **`confidence: low`** | **1.59×** | 0.73× |

Three of the four "this looks like more work" signals predict the case coming
in **cheaper**. A case with heavy teardown and complex preconditions *looks*
expensive and reliably isn't — that setup work is boilerplate the pipeline
already has fixtures for. Pricing those as premiums would have pushed every
flagged case in the wrong direction, permanently.

**One signal earns a change: `confidence: low`.** It's the only one pointing up
(1.59× vs 0.73×), so it now contributes an **asymmetric** band skewed high
rather than the symmetric cold band — the point estimate is untouched, but the
uncertainty reaches further up than down. n=4: a lead, not a coefficient.

The broader shape worth knowing: median case runs **1.37× hot** while the total
across all 26 lands at **0.99×**. Those reconcile only one way — the model
**over-estimates the typical case and under-estimates the tail**, and the tail
is where the money is. No symmetric band fixes either end; that's why the
unspecified-oracle cases are reported as *unquotable* rather than banded.

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

- **Operating shape — size is not the driver; dispatch mechanism is
  (v0.6.0 rewrite).** Four independent audits now measure it:

  | Mode | $/delivered | Delivery | Orchestration tax |
  |---|---|---|---|
  | single-case (44 runs) | $22.10 | 80% | 22.2% |
  | single-case (10 runs) | $21.59 | 90% | 27.9% |
  | batched, 10–11 cases | $9.34–$10.76 | 100% | 11.1% |
  | **batched, 13 cases, sequential dispatch** | **$7.03** | 92% | 16.1% |
  | batched, 39 cases | $13.36 | 85% | — |
  | campaign, 55 cases / 7 waves, Workflow tool | $11.44 | 91% | 12.9% |

  **Batching roughly halves per-case cost against single-case operation** —
  that finding is robust across all four audits, and the mechanism is the
  orchestration tax (intake, seed re-read, close-out) paid once per batch
  rather than once per case.

  **But bigger is not better.** The cheapest run was a 13-case *sequential*
  batch; a 39-case batch and a 55-case Workflow campaign both cost more per
  case than batches of 10–13. Earlier revisions of this section implied a
  monotonic batch-size benefit and cited only the +87% single-case figure —
  that was an over-read. State the assumed batch size **and** dispatch
  mechanism, and treat anything above ~15 cases in one batch as *unvalidated*
  rather than better. The 39-case batch's own audit attributes its cost to
  more individual gate/merge passes plus 6 blocked cases that burned full
  analyst time before landing.
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
