# Sampling methodology — extrapolating from a sample to a full backlog

Mode 2 (`SKILL.md` § Mode 2) exists for the presales-realistic case: a
prospect hands over 15 example requirements/user-stories/test cases and says
"there are roughly 200 of these across the whole app." You can't (and
shouldn't, this early) analyze all 200 — but you can score the 15 honestly
and extrapolate, **if you say how confident that extrapolation is**.

## The extrapolation

1. Score every case in the sample (`score-cases.mjs`, Mode 1 logic — steps ×
   tier × novelty).
2. Compute the sample's **tier distribution** (what fraction fell in each
   interaction tier) and its **mean $/case** and **mean minutes/case**.
3. Extrapolate: `total_estimate = mean_per_case × total_scope_count`, with
   the confidence band widened relative to a same-size *scored* set (see
   below) to reflect sampling error on top of scoring error.

## Reporting the extrapolation honestly — the checks that matter more than the arithmetic

**Sample size sets the floor of the confidence band, not the taxonomy.**
Even a perfectly-calibrated taxonomy can't rescue a 5-case sample claiming to
represent 200 unseen cases — report the sample fraction (`n_sample /
n_total`) plainly in the scoping report, and use the widest confidence band
(`cold_no_history` or wider) for any extrapolation drawn from `n_sample < 10`
regardless of what the per-case scoring confidence would otherwise be.

**Ask whether the sample is *representative*, don't assume it.** Two
concrete checks before trusting an extrapolation:

- **Was the sample chosen to represent the whole, or is it just "the ones
  the prospect happened to send first"?** The latter is very common (early
  requirements docs skew toward the simpler, better-understood flows written
  first) and will under-estimate. Ask the human providing the sample how it
  was selected; if unknown, say so as an explicit risk in the report rather
  than treating the sample as neutral.
- **Does the tier distribution look plausible for the stated scope?** If a
  15-case sample is 100% `crud-form` but the prospect describes "a canvas-based
  workflow builder" as a major feature, the sample almost certainly
  under-represents the expensive tier — flag this explicitly rather than
  extrapolating a distribution you have reason to distrust. If app access is
  available, Mode 3's live exploration is the better check here: it can
  confirm or contradict the sample's implied tier mix against what the app
  actually contains.

**Never extrapolate past a 10x multiplier without flagging it loudly.** A
15-case sample projecting to 200 (13x) is a materially different confidence
claim than 15 projecting to 30 (2x) — the report must show the multiplier
next to the number, not bury it in a methodology footnote.

## Output shape addition (on top of `scoping-report-format.md`)

A Mode 2 report adds, immediately under the headline range:

```markdown
**Extrapolated from a sample of N of ~M cases (Nx multiplier).**
Sample tier distribution: {tier: %, tier: %, ...}
Sample selection: {as told by the provider, or "unknown — ask before trusting this number"}
```
