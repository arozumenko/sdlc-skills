# Sizing rubric — S/M/L/XL for automation work, and foundation effort

This file explains the **second currency** the skill reports:
`complexity-taxonomy.json` § `size_scale` / § `size_rubric` (per-case size)
and [`foundation-catalog.json`](foundation-catalog.json) (the one-time work
that isn't attached to any case). The JSON files are what the scripts read;
keep this doc in sync by hand when they change.

## Why a second currency at all

The `base × tier × novelty` model prices what the **agent pipeline burns**
in active-minutes and dollars. That's the right number for "what will this
cost us to run" and the wrong number for three questions presales actually
gets asked:

1. *How big is this piece of work?* — a stakeholder wants a size, not a
   token bill.
2. *What would this have cost the conventional way?* — the comparison that
   justifies the engagement.
3. *What does the foundation work cost?* — which the agent-cost model prices
   at near-zero, and badly.

That third one is the sharp edge. Measured on the source engagement's own
tracker:

| | Share of delivered SP | Share of AI token cost |
|---|---|---|
| Test development | 65.4% | 72.7% |
| **Framework / foundation** | **25.8%** | **5.9%** |
| Orchestration overhead (unattributable) | 2.5% | 16.8% |
| Planning / maintenance / results review | 6.3% | 4.6% |

Foundation was **a quarter of the delivered work and a twentieth of the
token spend** — roughly $0.64/SP against $3.07/SP for test development, a
~4.8× gap (n=7 foundation activities, one project). Estimate foundation in
agent-dollars and you price a quarter of the engagement as a rounding error.
Estimate it in SP alone and you hide that it is the cheapest SP the pipeline
delivers. So the report quotes both, always.

The orchestration row is worth noticing too: **16.8% of token cost bought
2.5% of the SP** — the same per-batch orchestration tax
`complexity-taxonomy.md` § Batch shape already prices. It is not foundation
and must not be folded into it.

## The scale

`XS = 1 SP, S = 2, M = 4, L = 8, XL = 16`, where **1 SP = 1 hour of
conventional (non-AI) engineer effort**. The doubling scale and its anchors
come from the source engagement's SP Reference sheet, adopted unchanged so
estimates produced here drop straight into that tracker's Activity Log
without a translation step.

**SP is effort-equivalent, not agent time.** An L case is "about a day's
work the old way" — it is *not* a claim that the pipeline will spend 8 hours
on it. The whole point of quoting both currencies is that these two numbers
diverge, and by how much is the engagement's value story.

**Money needs a rate this skill does not default.** SP → dollars requires an
engagement blended rate, which is commercial and varies; a baked-in default
would silently misquote. Pass `--blended-rate`; without it the report quotes
SP only. Observed for reference: **$45/hr** on the automation engagement,
**$35/hr** on a manual-QA one from the same programme.

## Per-case sizing

A reader's explicit `verdict.size` always wins. What follows is the
**fallback derivation** — same discipline as tier classification, where a
verdict beats the keyword scan.

Four drivers, scored to points. **Weights were inverted in v0.6.0** — see
§ Why these four, below, for the measurement that forced it.

| Driver | 0 pts | 1 pt | 2 pts | 3 pts |
|---|---|---|---|---|
| **Surfaces** (distinct screens/endpoints/views) | ≤1 | 2 | 3–4 | 5+ |
| **Steps** (real actions) | ≤5 | 6–10 | 11+ | — |
| **New abstractions** (page objects / service clients / screen objects that don't exist yet) | 0 | 1–2 | 3+ | — |
| **Expensive interaction tier** (tier multiplier ≥1.4 — `rich-widget` in the default) | no | yes | — | — |

Total → size:

| Points | Size | SP |
|---|---|---|
| 0–1 | **S** | 2 |
| 2–3 | **M** | 4 |
| 4–6 | **L** | 8 |
| 7+ | **XL** | 16 |

The source tracker's own anchors still land on the same letters under the new
weights: *1 case / 1 screen / existing PO / 3–5 steps* → 0 pts → S;
*1–2 screens / 1 new simple PO / 5–8 steps* → 3 pts → M; *2–3 screens / 1–2 new
moderate POs / 8–15 steps* → 4–5 pts → L; *full feature area / multiple new POs
/ 10–20 steps* → 7–8 pts → XL.

Plus two rules:

- **`split_recommended: true` skews the row's band *downward* — it does *not*
  change the size.** Until v0.6.1 it forced XL, on the intuition that a case too
  big to size must be big. Measured, that was backwards: split-flagged cases came
  in at a median **0.46×** their estimate versus 0.79× for unflagged ones, so
  forcing the top of the scale made an already-high number roughly twice as
  wrong. *"Too big to estimate"* is a statement about **messiness**, not
  magnitude — a case bundling three unrelated checks splits into three small
  cases, not one huge one. The row keeps its driver-derived size, **stays in the
  total**, and gets a band skewed *downward* — splitting will refine the number
  down, not withhold it. (An earlier revision excluded these rows from the
  quotable total; that was worse than the problem, since the work is real and
  dropping it under-quotes the engagement. Zero is the only value known to be
  wrong.) (n=8, directional.)
- **XS is never derived for a case.** It is the maintenance/foundation scale
  (locator fix, assertion update, +1–2 methods on an existing abstraction).
  It only arrives via an explicit verdict or a foundation item.

### Why these four drivers — and why the weights flipped in v0.6.0

v0.5.0 made **`new_abstractions`** the heaviest driver (up to 3 points), on the
strength of the source tracker's hand-assigned sizes: 15 of its 19 new page
objects sat in L-sized rows. That reasoning was circular — it validated the
rubric against *other human size labels*, never against money.

Measured against **actual per-case cost** on a 26-case blind holdout:

| Driver | Pearson r vs actual cost | Portable across stacks? |
|---|---|---|
| **`surfaces`** | **+0.522** | **yes** — "distinct screen or endpoint" means something everywhere |
| `new_abstractions` | +0.169 | no — "page object" is a UI-web artifact |
| `steps` | +0.051 | yes |
| *the whole composite estimate* | +0.166 | — |
| *sub-agent count (post-hoc rework proxy)* | +0.373 | not knowable at estimate time |

**`surfaces` was the strongest estimate-time predictor found anywhere in this
model** — better than the composite estimate itself, and the only knowable-in-
advance signal that beats the post-hoc rework proxy. So it takes the top weight
(3 points), `new_abstractions` drops to a refinement (2), and `steps` drops to a
floor (2), matching its near-zero correlation.

Portability was the second reason and it points the same way: an API, mobile or
perf scope has no page objects, but every scope has distinct endpoints, screens
or flows. Weighting the stack-specific driver hardest was making the rubric less
transferable *and* less accurate at the same time.

**`surfaces` also replaces the multi-page tier bonus.** `multi-step-flow`
(multiplier 1.15) deliberately does *not* earn the expensive-tier point,
because multi-page-ness is exactly what the `surfaces` driver counts.
Awarding both would inflate every wizard case — the same double-counting the
modifier list already avoids (`complexity-taxonomy.md` § Modifiers).

**`new_abstractions` is kept, not deleted.** It is weak for predicting *cost*,
but it remains the honest driver for *work-size* — how much new code exists to
write is a different question from what the pipeline burns, and that question
has not been validated either way. It also stays the countable form of novelty:
a boolean `novel_surface` can't tell one new page object from six.

Both new fields are **optional**. When a verdict omits them they score 0 and
the size is marked `derived-partial`, which **systematically under-sizes**.
A partial size is fine for triage and must never be quoted without saying
which cases carried it.

### How well it fits — checked against the source tracker

Replaying the rubric against that engagement's hand-sized rows, it
reproduces the logged size on most and misses on some. Two worked examples
in each direction:

- *Spanish-language verification, 6 new page objects, full flow* — steps 1 +
  surfaces 2 + abstractions 3 + tier 0 = **6 → L**. Tracker: L. ✓
- *Photo upload/delete/validation, no new POs* — steps 1 + surfaces 0 +
  abstractions 0 + upload tier 1 = **2 → M**. Tracker: M. ✓
- *A dialog-heavy edit/delete/add case, no new POs* — scores **1 → S**;
  tracker logged M. The rubric can't see that repeated dialog interactions
  cost more than their step count implies.
- *An admin overview case* — scores **3 → M**; the tracker's final version
  logged XL. Its own earlier revision logged it **M** and was later re-sized,
  so the "truth" here is a human judgement that changed its mind, not a
  measurement.

That last one is the honest summary of this rubric's accuracy ceiling: **the
hand sizes it's checked against are themselves noisy**, revised between
tracker versions, and there are only ~16 of them from one engagement. The
rubric is a defensible starting point that a reader overrides — not a
measurement. Treat a derived size as a prompt to agree or disagree, and
record the disagreement in `verdict.size`.

### Size does not finely predict agent cost — say so

Median agent cost by logged size on the source tracker (n=16 test-development
activities, one $145 blow-up excluded as a documented failure):

| Size | n | Median AI cost |
|---|---|---|
| S | 2 | $6.12 |
| M | 5 | $5.55 |
| L | 7 | $15.00 |
| XL | 1 | $17.22 |

**S and M are indistinguishable; L/XL run ~2.5–3× either.** Size separates
cheap from expensive and does not resolve finer than that — consistent with
the model's existing finding that step count alone correlates only r≈0.37–0.41
with cost. This is *why* the size axis does not replace `base × tier ×
novelty` for the agent-cost number: it is a work-size currency that happens
to correlate coarsely with spend, not a cost predictor. Report them as two
columns, never reconcile one into the other.

## Foundation

Foundation is the one-time, non-per-case work: framework, CI, abstractions,
data layer, reporting, handover. [`foundation-catalog.json`](foundation-catalog.json)
holds the items, each with a `default_size`, an `applies_when`, a `skip_when`
and where its size came from.

**"If required" is the operative phrase — every item is gated.** An item is
included only when its `applies_when` holds against what the target project
*actually has*, which is a question Mode 3 already answers: the repo-grep
reuse check and live spot-check establish what exists. Cold (Mode 1/2), you
cannot know, and the honest move is to say the foundation set is assumed and
band it wide — not to quietly include everything or quietly include nothing.

Three mechanics worth knowing:

- **Items can supersede others.** `framework-full-greenfield` (XL) supersedes
  `framework-core` + `base-abstractions` + `ci-pipeline`; `ci-advanced`
  supersedes `ci-pipeline`. The script drops superseded items and says it
  did, so a selection can't double-count a framework build.
- **Excluded items are recorded, not deleted.** Marking an item
  `"include": false` with a reason keeps it in the report as *considered and
  ruled out*. In a proposal that list is load-bearing: it shows what was
  checked, which is the difference between a scoped estimate and an
  optimistic one.
- **Per-item confidence, borrowed from the trackers' baseline sheets.**
  Each selection carries `measured` (we looked at the repo/app) /
  `estimated` / `assumption`. A foundation total built mostly of assumptions
  is a different artifact from one built on a repo inspection, and the
  report says which.

### Amortization — the number that moves most

Foundation is paid once and spread across the scope, so **per-case
all-in cost is a function of scope size**, and small scopes look terrible:

```
all-in $/case = (foundation_SP × rate + Σ case_SP × rate) ÷ case_count
```

The corroborating evidence for the shape: the manual-baseline engagement
tracked **11.1 h/TC for test development but 21.1 h/TC all-in including
framework** across a 10-case scope — foundation nearly doubled the per-case
figure at that size. The AI-delivered engagement shows the same curve from
the other side: its first cases cost ~5–6× its later ones, because
exploration and abstraction work amortized once the framework existed.

So: **quote the foundation line separately and quote all-in $/case at the
stated scope count**, and if the scope might grow, show what all-in $/case
becomes at a larger count. A client comparing a 10-case pilot's all-in
per-case number against a 100-case programme's is comparing two different
questions.

### Sanity band

Foundation as a share of total engagement SP, when a framework is built from
scratch: **21%** (manual-baseline engagement, 45 h of 211 h) and **26%**
(AI-delivered engagement, 41 SP of 159 SP). Two independent sources, close
agreement, both from one programme and one stack family — indicative, not
calibrated.

Use it as a **prompt, not a rule**. Landing far outside 20–26% means
re-check the selection; it does not mean force the number into the band. A
20-case scope with a greenfield framework legitimately lands above it, and
that ratio *is* the finding — it's the argument for either widening the
scope or reusing an existing framework, and it belongs in the report rather
than being smoothed away.

## Extending this for a different stack

Same rule as the interaction tiers: the *shape* generalizes, the *specifics*
are a UI-web starting point. An API engagement's foundation set looks
different (contract/schema fixtures, service clients, mock/stub
infrastructure) and its `surfaces` driver counts endpoints, not screens. Add
or rename items in a project-local
`.agents/estimation/foundation-catalog.json` rather than stretching these
labels to cover work they weren't measured against, and say in the report's
methodology paragraph which catalog applied.
