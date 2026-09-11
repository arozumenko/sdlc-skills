# eval-inputs

**Real acceptance-criteria inputs — the "question" half of a benchmark,
never the "answer."** Not installed by any bundle, factory, or plugin
manifest — this directory exists purely for teams to read from directly in
their own repo checkout (or copy out of), the same way `docs/` and the
non-negated parts of `tasks/` already aren't part of any install path.

## What this is

`manual-qa/ac-holdout/<site>/*.md` — 96 real acceptance-criteria inputs
used to drive the `quality-evals` skill's authoring track
(`bundles/manual-qa/skills/quality-evals/`) against 5 public demo sites
(eviltester.com, demoqa.com, saucedemo.com, the-internet.herokuapp.com,
todomvc.com). Each file is exactly the input a `test-author` would receive
— a short "As a user, I want..." framing plus 1-3 acceptance-criteria
bullets — in the format documented at
`bundles/manual-qa/knowledge/acceptance-criteria-input-format.md`.

Use these instead of (or alongside) the skill's own synthetic "Widgetize"
worked example when you want a larger, real batch of inputs to pilot
`test-author` + the authoring-track scorer against, before writing your
own AC for your own app.

## What this deliberately does NOT include

**The gold-authored test cases these ACs produced, and the structured
ground truth behind them, are never public.** A benchmark only means
something if the party being evaluated doesn't hold the answer key —
that's true independent of any particular leak risk, and it doesn't
change just because this repo happens to be public. If you want to grade
`test-author`'s output against these specific ACs — not just try the
mechanism on them — that requires the matching gold/ground-truth pair,
which lives in a separate, private, access-controlled corpus and is
available on a case-by-case request basis. Ask the maintainer.

A few of these ACs are deliberately written to describe a real, confirmed
application behavior that reads as ordinary and unremarkable — that's by
design (see "blind-detection" in the skill's `README.md`), not an
oversight. Nothing here needs redacting.

## Layout

```
eval-inputs/
└── manual-qa/
    └── ac-holdout/
        ├── baseline-web-smoke-journey-ac-holdout.md   (this bundle's own dogfood target — see tasks/baseline-web/)
        ├── eviltester/    (46 files)
        ├── demoqa/        (12 files)
        ├── saucedemo/     (10 files)
        ├── the-internet/  (21 files)
        └── todomvc/       (6 files)
```
