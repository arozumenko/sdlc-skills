# Baselines

The baseline is the set of screenshots from the last time the design was **correct
and reviewed**. A diff compares today's capture against it. Baselines are data you
commit, not build output — they live in the consumer's repo, beside the design.

## Where they live

Suggested layout in the target project:

```
docs/design/
  visual-baselines/        # committed — the approved screenshots
    screen-HYP-003-S-003-1-default-web-fluent-desktop.png
    flow-hotelbooking.png
    …
  visual-diff/             # gitignored — reg-cli's diff output + report.html
```

Commit `visual-baselines/`. Gitignore `current/` and the diff/report output — they
are regenerated every run. Add to the project's `.gitignore`:

```
current/
docs/design/visual-diff/
```

## The approve flow

`reg-cli` (via `scripts/visual-diff.mjs`) has exactly two moves:

- **Check** (default): compare `current/` to `visual-baselines/`. Exit 0 = no
  change; exit 1 = something changed, and `report.html` shows each diff.
- **Promote** (`--update`): copy `current/` over `visual-baselines/`, making today's
  capture the new truth. Then **commit the changed baselines** — the diff in code
  review IS the record of what visually changed and who approved it.

Promote only after you've looked at the report and the change is intended. Never
promote to make a red run green — an unintended change promoted is a regression
baked into the baseline, invisible from then on.

## Reading the report

`report.html` groups items:

- **failed / changed** — matched a baseline but the pixels differ. Open it: is the
  change what you meant to do? If not, it's a finding — fix the cause.
- **new** — a `current/` image with no baseline. Either a genuinely new screen/variant
  (promote it) or a **renamed** file (its old baseline now shows as *deleted* — the
  pair is the rename; re-approve).
- **deleted** — a baseline with no `current/` match. The variant stopped being
  captured, or was renamed. Confirm it's intentional before promoting away a
  baseline you might still want.
- **passed** — unchanged. The bulk of a healthy run.

## First baseline

There's no baseline the first time. Capture into `current/`, eyeball the pages
against the spec (this is the one time you're judging *correctness*, not *change*),
then promote with `--update` to seed `visual-baselines/`, and commit. Every run
after that is change-detection against that seed.

## When a change is legitimately everywhere

A token change (new primary color, a radius tweak, a different type scale) moves
every screen — the report will be a wall of red, all intended. That's fine:
confirm a few represent the change you made, promote the whole set, and let the
baseline diff in code review carry the story. This is also the signal that the
change was as broad as you thought — if a palette tweak somehow left a screen
untouched, that screen is the interesting one.
