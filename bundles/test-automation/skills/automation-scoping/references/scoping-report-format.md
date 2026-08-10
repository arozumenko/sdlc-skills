# Scoping report format

The output of every mode is a single markdown file,
`.agents/estimation/<scope-slug>-scoping-report.md`, written to be readable
standalone by someone who wasn't in the session — a presales engineer lifting
numbers into a proposal, a delivery lead sanity-checking a quote months
later. Every section below is required; omit nothing even when the answer is
"unknown."

```markdown
# Automation scoping — {scope name} ({date})

## Headline

**{N} cases → {low}–{high} active-hours, ≈${low_usd}–${high_usd}**
({point estimate}, confidence: {ROM | budgetary | calibrated})

{One paragraph: mode used (blind / sample-extrapolated / app-informed),
what it's based on, and the single most important caveat a reader needs
before quoting this number.}

## Methodology (copy-paste ready for a proposal doc)

{2-4 sentences, written for a non-technical reader: "This estimate applies a
complexity taxonomy calibrated from {N} previously-delivered automation
cases, scoring each case's interaction pattern (form/table vs. drag-drop
canvas vs. real-time chat, etc.) rather than its raw step count — the
strongest predictor found in that historical data. {Mode-specific sentence}.
Actuals are tracked against this estimate after delivery and the model is
recalibrated per project."}

## Breakdown by tier

| Interaction tier | Cases | Avg est. min/case | Avg est. $/case | Confidence |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Per-case table

| Case | Tier | Steps | Novelty | Flags | Est. min | Est. $ | Notes |
|---|---|---|---|---|---|---|---|

## Assumptions & risks

- **Rate used**: ${rate}/active-min — {source: live project rate | generic
  cross-project fallback, dated {date}}.
- **Classification provenance**: {N of M cases verdict-read (agents read the
  case bodies) | keyword-fallback for the rest}. A keyword-only scored scope
  is a triage, not a proposal number — if that's what this is, say so here.
- **Case quality**: {N of M cases carry quality flags (list which flags
  dominate) | none flagged}. Flagged cases keep their point estimate but are
  priced at the widest band — expect analyst re-derivation time there, and
  treat a scope where flags cluster in one feature area as a drift warning
  about that area's cases, not just those rows.
- **Setup/data/teardown modifiers**: {N of M cases carry modifiers (name the
  dominant ones) | none}. Unpriced by design (complexity-taxonomy.md
  § Modifiers) — say plainly that fixture/data-factory/cleanup work in those
  cases sits OUTSIDE the point estimate, which is exactly what a presales
  reader adds contingency for. {K} split candidate(s): estimate those lines
  only after splitting.
- **Novelty**: {live-spot-checked for N of M surfaces (name which) | grep-only
  for the rest, unconfirmed against the live app | unknown, no app access,
  assumed established}. A grep hit is a tentative reading, not a confirmed
  one (Mode 3 § step 3/4) — say plainly which surfaces got the live check
  and which didn't, since that's exactly where a real risk hides: a
  false-positive "already covered" grep match on an unchecked surface reads
  as cheap right up until the case runs.
- **Sample representativeness** (Mode 2 only): {see sampling-methodology.md
  block}.
- **Operating shape**: this estimate assumes {batched delivery (batches of
  ~{M}) | single-case delivery}. Measured on a live pipeline: single-case
  operation cost +87% per delivered spec vs batched (the per-batch
  orchestration tax stops amortizing) — if delivery will dribble in one case
  at a time, say so and price it (complexity-taxonomy.md § Batch shape).
- **Delivery rate**: assumed {R}% (measured 80–90% on calibrated projects).
  Blocked cases cost ~1.85× a median delivered one, so the $/spec-delivered
  figure above already carries the non-delivering share at the assumed rate —
  a lower real rate moves it up, not the scope's total.
- **Rework tail-risk**: {N} of {M} cases fall in tiers/novelty classes with
  historically elevated rework rates — point estimate does not include
  rework, the high end of the confidence band does.
- **What would invalidate this estimate**: {model/pricing change since
  {date}; scope cases turn out to differ materially from the sample/rubric
  assumptions; target app surfaces are less mature than assumed}.

## Confidence statement

{One sentence stating plainly what tier of confidence this is and why —
"This is a Rough Order of Magnitude estimate (±50-100%) because no
project-specific historical data existed at estimate time" or "This is a
calibrated estimate (±20-30%) based on N delivered cases in matching tiers."}
```

## Formatting rules

- **Always a range, never a bare point number.** A single dollar figure
  presented without its band reads as false precision — this is the
  anti-pattern the taxonomy's `confidence_bands` exist to prevent.
- **State the rate's source and date** next to every dollar figure derived
  from it — model pricing changes, and a stale rate silently understating a
  quote is worse than an honestly-labeled generic one.
- **Never omit the Assumptions & risks section**, even for a high-confidence
  calibrated estimate — "what would invalidate this" is often the most
  useful sentence in the whole report for a presales reader deciding how much
  contingency to quote.
