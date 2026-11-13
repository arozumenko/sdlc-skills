# Plan: bring effort calibration (#105) up to the learning-loop contract

Spec: `docs/superpowers/specs/2026-11-13-learning-loops-design.md` (§ Where the shipped loop stands, follow-up list).
Scope: `skills/delivery-monitor` + the PM agent text. Rule: **every new setting defaults to today's behaviour**;
an existing install that changes nothing sees identical files, events, reports and exit codes.

All settings live in the existing `profile.json` (validated against `templates/profile.template.json`).

| # | Deliverable | Setting (default = today) | Change |
|---|---|---|---|
| 1 | Publish policy | `publish: "push"` \| `"local-only"` | `sync.mjs`: local-only commits but never pushes; `install-hooks.mjs` bootstrap skips both pushes when local-only **or** `DELIVERY_NO_SYNC=1` |
| 2 | Field policy | `storeText: true` \| `false` | false → git/PR backfill store no subject/title in `raw`; CLI `--note`/`--raw` refused (`USAGE`); hook label never uses the description (overrides `capturePrompts`) |
| 3 | Calibration off switch | `calibration: "on"` \| `"off"` | off → `plan register` fills nothing (as `--no-calibrate`), `calibrate` writes nothing and prints `CALIBRATION-OFF`, exit 0 |
| 4 | Effective sample + freshness | `calibrationMinEffectiveN: null` \| number ≥ 1; `calibrationMaxAgeDays: null` \| number > 0 | every cell gains `n_eff` (Kish) and `newest_at` (additive); `lookup` also requires them when the table carries the thresholds |
| 5 | Cell schema check | — (bug fix) | `readCalibration` rejects cells with a non-integer `n`, non-numeric `p50_usd`/`p80_usd`, or a bad `effort_class` (`CALIBRATION-INVALID`) |
| 6 | Immutable state versions | — (additive) | `calibrate` also writes `calibration/<sha256>.json` (content-addressed, never overwritten) |
| 7 | Paired baseline + evaluator | — (additive) | a calibrated fill also stores `reference.baseline {cell:"all", low, high}`; `report` adds a `usd_paired` block (median absolute log ratio, calibrated vs baseline, same eligible tasks, `late_accepted` excluded) only when paired rows exist |
| 8 | `calibrate` owner without a PM | — (docs) | SKILL.md: the session that closes the plan runs `calibrate` |

Tests first for each item (node --test, existing files). Verification: `npm test`, `npm run validate`,
and the main-vs-branch report comparison on copies of two real ledgers (must be identical apart from
run timestamps, since no profile sets the new keys). Then an adversarial code review (Codex gpt-6-astra, high).
