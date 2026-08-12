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

**{N} cases → {low}–{high} active-hours, ≈${low_usd}–${high_usd} agent cost**
({point estimate}, confidence: {ROM | budgetary | calibrated})
**Work size: {case_sp} SP cases + {foundation_sp} SP foundation = {total_sp} SP**
{(≈${conventional} conventional at ${rate}/hr) — omit entirely if no blended rate was supplied}

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

## Cost layer — required, before any dollar figure

| Layer | Estimate |
|---|---|
| **Per-case build** (implement + review on the case's own branch) | ${X} (${low}–${high}) |
| **Fully loaded** (+ batch trunk: gate/merge/closure; + orchestrator share) ×1.79 | ${Y} (${low}–${high}) |

`base × tier × novelty` models the **first** layer only. State which layer every
quoted number belongs to — the two differ by ~1.8× and conflating them is how a
build-only estimate silently reads as a pipeline quote.

**Quote the batch total, not per-case dollars.** Measured on a 26-case blind
holdout: per-case figures had ~zero rank correlation with actual per-case cost
(Spearman 0.015), while batch totals landed within 0.89–1.83× of actuals. The
per-case table below is for **sizing and sequencing**; the money is only
meaningful in aggregate. Do not let a reader lift one row's dollar figure.

## Breakdown by tier

| Interaction tier | Cases | Avg est. min/case | Avg est. $/case | Confidence |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Risk-flagged cases — read before quoting

| Case | Risk flag(s) | Why it cannot be priced confidently |
|---|---|---|

{Cases carrying `nondeterministic-oracle` or `external-dependency` are the ones
most likely to blow the estimate: on two independent holdout batches the single
most expensive case in *each* carried one. Even the widest band (0.5–2.0×) did
not cover the worst of them. **Report those as unquotable until the oracle is
specified**, the same treatment `split_recommended` gets — do not hand over a
point estimate with a wide band and call it covered. "None flagged" is also a
finding worth stating.}

## Scope assumption — delivery clustering

{Required. "Assumes cases delivered in clusters of ~N; solo delivery prices
materially higher per case on measured data." Clustering is decided at delivery
time, after this estimate exists, so the per-case numbers cannot account for it:
measured, the estimate ran 1.30× hot on solo cases but 2.84× hot on clustered
ones. If the scope is full of near-identical sibling cases, say they will
probably cluster and land under this estimate.}

## Work size

| Size | Cases | SP | Conventional $ | Avg agent $/case |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

{One line stating that SP is conventional-effort size, not agent time, and
that the two columns are expected to diverge.}

## Foundation

| Item | Category | Size | SP | Conventional $ | Confidence | Why |
|---|---|---|---|---|---|---|

**Considered and excluded**: {list, with reasons — this list is load-bearing
in a proposal; it's what separates a scoped estimate from an optimistic one.
"Nothing excluded" is itself a finding worth stating.}

**Foundation share**: {X}% of total SP {against the 20–26% band measured on
two comparable engagements — and if outside it, why that's the real finding
rather than something to adjust}.

**Foundation agent cost**: {unpriced by design — it ran ~4.8× cheaper per SP
than case work on the source engagement, so the per-case rate would overstate
it several-fold | metered at $X from this project's efficiency-audit}.

## Suite total — both currencies

| | SP | Conventional $ | Agent $ |
|---|---|---|---|
| Cases ({N}) | ... | ... | ... |
| Foundation | ... | ... | ... |
| **Total** | ... | ... | ... |

**All-in ${X}/case at this scope of {N} cases** (versus ${Y}/case for case
work alone). {State the scope count every time — foundation amortizes, so
this number is not comparable across scopes of different sizes.}

## Per-case table

| Case | Size | SP | Tier | Steps | Novelty | Flags | Est. min | Est. $ | Notes |
|---|---|---|---|---|---|---|---|---|---|

## Assumptions & risks

- **Rate used**: ${rate}/active-min — {source: live project rate | generic
  cross-project fallback, dated {date}}. **Blended rate**: {${X}/hr, source
  | not supplied — SP quoted without a conventional-cost column, which is
  the correct output, not a gap to fill with a guessed rate}.
- **Sizing provenance**: {N of M sizes read by an agent and set explicitly |
  derived from the rubric | K `derived-partial`, i.e. the verdict omitted
  `surfaces`/`new_abstractions` so those score zero and the size is an
  under-estimate}. Name the partial ones — the bias runs one way.
- **Foundation gating**: {N items measured against the repo/live app, K
  estimated, J assumed}. In Mode 1/2 nearly everything here is an
  assumption; say so. A foundation set that is all-`assumption` after a
  Mode 3 pass means the gate was never actually walked.
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
- **Operating shape**: this estimate assumes {batched delivery in batches of
  ~{M}, dispatched {sequentially | via the Workflow tool} | single-case
  delivery}. Measured across four audits: single-case runs cost $19–$22 per
  delivered spec vs $7–$11 batched. But **size is not the lever — mechanism
  is**: the cheapest measured run was a 13-case *sequential* batch ($7.03),
  while a 39-case batch ($13.36) and a 55-case Workflow campaign ($11.44) both
  cost more per case than batches of 10–13. State batch size AND dispatch
  mechanism; treat >15 cases per batch as unvalidated, not better
  (complexity-taxonomy.md § Batch shape).
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
