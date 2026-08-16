# Baselines

The baseline is the set of screenshots from the last time the UI was **correct and
reviewed** — an approved design set, or a signed-off release build. A run compares
today's captures against it. Baselines are data you commit, not build output; they
live in the consumer's repo beside the thing they cover.

## Where they live

Pick a committed directory near the artifact — e.g. `docs/design/visual-baselines/`
for design mocks, `qa/visual-baselines/` for an app under test:

```
<area>/
  visual-baselines/    # committed — the approved screenshots
    web-checkout-default-desktop.png
    screen-HYP-003-S-003-1-default-web-fluent-desktop.png
    …
  visual-diff/         # gitignored — reg-cli's diff output + report.html
```

Commit `visual-baselines/`. Gitignore `current/` and the diff output — they are
regenerated every run:

```
current/
**/visual-diff/
```

## The approve flow

`scripts/visual-diff.mjs` (over `reg-cli`) has two moves:

- **Check** (default): compare `current/` to `visual-baselines/`. Exit 0 = no
  change; exit 1 = something changed, and `report.html` shows each diff.
- **Promote** (`--update`): make today's capture the new baseline, then **commit the
  changed baselines** — the diff in review IS the record of what changed and who
  signed off.

Promote only after looking at the report and confirming the change is **intended**.
Never promote to clear a red run — an unintended change promoted becomes invisible
from then on.

## Reading the report

`report.html` groups items:

- **failed / changed** — matched a baseline but pixels differ. Open it: intended, or
  a regression? A regression is a finding — fix the cause or file the defect with the
  diff image; don't touch the baseline.
- **new** — a `current/` image with no baseline: a genuinely new screen (promote) or
  a **renamed** file (its old baseline shows as *deleted* — that pair is the rename).
- **deleted** — a baseline with no capture: a screen dropped from coverage or
  renamed. Confirm intentional before promoting it away.
- **passed** — unchanged; the bulk of a healthy run.

## First baseline

No baseline the first time. Capture into `current/`, review the screens against the
spec/acceptance criteria (the one time you judge *correctness*, not *change*), then
promote with `--update` to seed `visual-baselines/`, and commit. Every run after is
change-detection against that seed.

## When a change is legitimately everywhere

A token change (new primary color, a radius tweak) or a release-wide restyle moves
every screen — the report will be a wall of red, all intended. Confirm a
representative sample, promote the whole set, and let the baseline diff in review
carry the story. It's also the signal that the change was as broad as you thought —
a screen that stayed untouched when it shouldn't have is the interesting one.
