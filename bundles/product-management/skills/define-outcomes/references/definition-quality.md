# Outcome-anchor definition quality

The field spec says *what to record*; this file is the *definition-quality test* a candidate
must clear before it is worth ratifying. Run every candidate (and every north-star candidate)
through all three lenses and report each in one line. Adapted from phuryn/pm-skills (MIT,
© Pawel Huryn).

## The 7-criteria checklist

A good outcome / north-star metric is:

1. **Understandable** — plain language; the whole team grasps it without a footnote.
2. **Customer-centric** — measures value the *customer* receives, not company output.
3. **Reflects sustainable value** — a durable behavior, not a one-off spike or a vanity bump.
4. **Vision- / strategy-aligned** — moving it moves the product toward where it is going.
5. **Quantitative** — an actual number you can track over time.
6. **Actionable** — teams can influence it through the work they choose to do.
7. **A leading indicator** — it predicts the later business result (the `lagging_confirmation`),
   rather than being that result.

A candidate that fails several of these is not ready to ratify — sharpen it or pick a different
behavior.

## The NOT-list (what an anchor must NOT be)

- **NOT a vanity metric** — a number that only goes up-and-to-the-right regardless of whether
  customers are better off (cumulative totals, raw pageviews).
- **NOT a business / traction metric** — revenue, ARR, MRR, bookings, GMV, signups, seats.
  These are `lagging_confirmation::`, never the anchor. (This is the hard product-outcome rule
  the skill enforces, restated here as a definition test.)
- **NOT an output metric** — features shipped, tickets closed, story points. Output is not
  outcome.
- **NOT un-influenceable** — a number no team's work can move is a weather report, not a target.
- **NOT behavior-neutral** — "if a metric won't change what you *do*, it's a bad metric." Every
  anchor must earn a `counter_metric::` precisely because a metric worth having is one worth
  guarding against gaming.

## Three Business Games (selection heuristic)

Sanity-check that the anchor measures the value the product actually creates. Most products play
one dominant game; an anchor borrowed from the wrong game measures the wrong thing:

| Game | Value delivered | Anchor / north-star shape |
|---|---|---|
| **Attention** | the product is worth the customer's time | engaged time, sessions of real depth, return frequency |
| **Transaction** | the customer completes something of value | successful transactions per active customer, completion rate |
| **Productivity** | the customer accomplishes work faster / better | core jobs completed, time-to-value, output-per-session |

Name the game the product plays, then confirm the candidate anchor is drawn from it. If the
anchor comes from a different game than the product's value model, that is a red flag to resolve
before ratifying.

## The counter-metric

Every ratified anchor names exactly one **counter-metric**: a number that would move the *wrong*
way if the team optimized the anchor at the customer's expense (e.g. an activation-speed anchor
guarded by *support tickets per activated user*; a completion-rate anchor guarded by *rework /
error rate*). It is the gaming guard, and it is not optional.
