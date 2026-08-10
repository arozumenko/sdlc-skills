# Calibration methodology — Mode 4

Mode 4 is what turns this skill from "a plausible generic rubric" into "a
model that gets more accurate about *this* project every time it delivers a
batch." It is a two-step, human-gated process — nothing self-mutates
silently.

## Step 1 — `build-training-set.mjs`: reconstruct per-case ground truth

Inputs, both already produced by the pipeline/other skills, nothing new to
capture:

- **`.agents/automation/**/report.json`** (recursive glob — a campaign may
  nest batches in subfolders, e.g. `approved-next50/wave-02-05-merged/`;
  don't assume one level deep) — gives `cases[].id`, `.outcome`, `.branch`,
  `.afs`, and the batch's `integration_branch`.
- **A `usage-rollup.mjs --json` rollup** (from the `efficiency-audit` skill,
  run separately and passed in via `--ledger`) — gives the metered `ledger`
  array, where every unit carries `gitBranch`, `costUsd`, `durationMin`.

The join key is **`gitBranch`**: sum every ledger unit whose `gitBranch`
equals a case's `report.json` `branch` (its dedicated implement+review work)
plus an even share of units on the batch's `integration_branch` (shared
gate/merge/closure overhead, split across that batch's own case count). This
mirrors the layered cost breakdown a hand-run efficiency audit produces
(case-branch work / batch-trunk overhead / orchestrator share) — see that
skill's own per-case reports for the worked shape.

**When the branch join comes up empty for a case** (deleted branch, direct
trunk commit, a session structure where sub-agents don't carry a distinct
`gitBranch` — this happens; a prior hand-run audit hit it for 3 of 60 cases),
the script reports the case as `cost: null` rather than guessing or silently
dropping it from the total. A training row with `cost: null` is excluded from
per-tier statistics but still counted in the "N cases seen, M priced"
reconciliation line — see `efficiency-audit`'s own "never let `n/a` become
`0`" principle, which this inherits.

For each priced case, the script also reads the case's own snapshot file
(`.agents/automation/<slug>/cases/<ID>.md`) to extract step count and the
title/module text needed for tier classification (reusing `score-cases.mjs`'s
own keyword classifier, so training and scoring use the identical rule).

Output: `training-set.json` — one row per case:
```json
{ "id": "CASE-1042", "tier": "rich-widget", "steps": 9, "cost_usd": 32.44,
  "active_min": 122, "outcome": "blocked", "rework_signal": false }
```

**Cross-check `report.json`'s `outcome` field before trusting it as
terminal.** A field snapshot written mid-loop (at first gate-red, before a
`batch-stabilize` recovery or a manual fix-round closes the case out) can lag
the real result — confirmed twice on the seed project's own audit, both cases
had actually merged clean despite `outcome: "blocked"`. `build-training-set.mjs`
flags any case where the branch it joined against later appears in a merge
commit on the base branch (`git log <base> --grep <id>` — cheap, run once per
training-set build) as `outcome_verified: true/false` — a `false` doesn't
block the row from being used, but the calibration proposal must surface how
many unverified rows fed it.

### When the automated join comes up mostly empty

`build-training-set.mjs`'s branch-join assumes each batch's `report.json` is
current. It sometimes isn't — a batch still mid-run has its `report.json`
snapshot written at whatever stage intake/analysis left it (often before any
case has a `branch` field at all), and the file is never regenerated once
the batch actually finishes merging cases later. Observed directly: a
7-case batch where the automated join recovered cost data for only 1 case,
because the on-disk report predated 4 real merges.

**The fallback, worked**: cross-check `gh pr list --state merged` (or the
project's git host equivalent) for the case branches by name/pattern, match
each merged PR's branch against the ledger's `gitBranch` units by hand, and
hand-build a training-set-shaped JSON (`{rows: [...], summary: {...}}` —
same shape `build-training-set.mjs` emits) with a `summary.note` explaining
the manual construction. `calibrate.mjs` doesn't care how a training-set file
was produced, only that it matches the shape — feed the hand-built file in
via `--training-set` exactly like an automated one, and say plainly in the
row/summary provenance that it was hand-verified, not joined. See
`calibration-log.md`'s v0.3.0 entry for a full worked example.

## Step 2 — `calibrate.mjs`: recompute bucket statistics, propose, don't apply

1. Group the training set's priced rows by `tier`.
2. For any tier with `n ≥ 2`, compute `mean_min`, `stdev_min`, `mean_cost`,
   `n`.
3. **Dry-run by default**: print a diff table (current taxonomy multiplier vs
   what the data implies) and write it to
   `.agents/estimation/calibration-proposal-<date>.md`. Nothing else changes.
4. **`--apply`**: writes the computed `bucket_stats` into the project-local
   `.agents/estimation/complexity-taxonomy.json` (a copy of the bundled
   default on first run, never the bundle's own shipped file — recalibration
   is always project-scoped) and appends a dated entry to
   `.agents/estimation/calibration-log.md` naming what changed, from how many
   cases, and linking the proposal file it came from.

**Why the dry-run gate, not silent auto-apply.** A presales number needs to
be defensible months later — "why do we believe $X/case for canvas work"
should always resolve to a dated, human-approved calibration entry, not an
opaque script decision. This mirrors the same "declared, not silent"
discipline used elsewhere in this bundle for judgment calls a script can
propose but shouldn't unilaterally commit.

### Known limitation: review/recovery work dispatched against the trunk, not the case branch

A case's review (or a crash-recovery fix) is sometimes dispatched while the
reviewer/fixer is working from the **trunk** context (post-merge-back, or
recovering a stalled batch) rather than the case's own feature branch — its
ledger unit's `gitBranch` is the trunk, not `c.branch`. `sumByBranch(ledger,
c.branch)` then misses that unit entirely for that case. It's usually still
counted in the batch overall (via the `integration_branch` trunk-share split,
if that report.json's `integration_branch` field is populated) — but if the
report.json snapshot predates the trunk being finalized (`integration_branch:
null`, as happens when a batch's automated run crashes before writing its
final report — see calibration-log.md's TC-012 worked example), that cost is
currently **not captured by `build-training-set.mjs` at all**, not even
smeared across the batch. Confirmed twice by hand (two different projects,
two different cases) while investigating a routing hypothesis — in both
cases the "missing" role turned out to be present, just tagged to the trunk
branch. Not yet fixed (would need fuzzy-matching a case id against
`dispatched[].description` text across ALL branches, not just an exact
`gitBranch` equality check) — flagged here so a future calibration pass
knows to sanity-check a suspiciously single-role case against the ledger's
`description`/`dispatched` fields (as done manually in the TC-012 example)
before trusting `build-training-set.mjs`'s number as complete.

## `bucket_stats` overrides the formula, when present

Once a project-local taxonomy has `bucket_stats` for a tier, `score-cases.mjs`
uses `mean_min ± 1 stdev` directly for cases in that tier instead of
`base_minutes × multiplier` — real observed distribution beats the generic
formula the moment there's enough of it. The `confidence_bands` table's
`bucket_n_lt_5` / `bucket_n_ge_5` rows set how wide a band still surrounds
that empirical mean (a `n=2` tier is not a `n=20` tier even though both now
have "real data").

## When calibration data disagrees sharply with the shipped prior

If a recalibration would move a tier's multiplier by more than ~40% from the
bundled default, treat that as a signal worth a closer look before applying
blind — it can mean the project's tier keyword matches are catching the wrong
cases (check the classifier against a few training rows by hand), or it can
mean this project's stack/pipeline genuinely differs enough from the seed
project that the prior was never going to fit well here. Either way, note the
reasoning in the calibration-log entry — future readers should be able to
tell "we verified this and it's real" from "we applied it uninspected."
