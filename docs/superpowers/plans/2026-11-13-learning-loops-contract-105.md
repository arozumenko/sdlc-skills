# Plan: bring effort calibration (#105) up to the learning-loop contract — increment 1

Spec: `docs/superpowers/specs/2026-11-13-learning-loops-design.md`, § Implementation contract (increment 1); design
approved by adversarial review round 6. Rule: **every new setting defaults to today's behaviour**; an install that sets
nothing sees identical files, events, reports and exit codes for valid data.

| # | Deliverable | Where | Tests |
|---|---|---|---|
| 1 | Shared publish policy `.agents/telemetry/policy.json` (unset = legacy push; `private-remote`; `local-only`; broken = local-only). One decision per publisher, made before any stash or index change. Local-only with an `origin`: installers keep a plain directory. Settings check: stop with no change when a local `policy.json` / `delivery/profile.json` would be shadowed. `doctor` prints the policy and flags publishers that ignore it | delivery-monitor `lib/profile.mjs`, `lib/sync.mjs`, `install-hooks.mjs`; tokenomics `install-hooks.mjs` (installer, `--pull`), `hooks/telemetry-capture.mjs` | `profile.test`, `sync.test`, `install-hooks.test` (both skills), tokenomics `publish-policy.test` |
| 2 | Text policy `profile.json storeText` (default true): false vetoes dispatch descriptions, backfill commit subjects/PR titles, CLI `--note`/`--raw`; backfill replay over older text-bearing records SKIPs, structured changes still conflict, retracted records still revive | `delivery.mjs` (event, backfill), `hooks/dispatch-hook.mjs` | `text-policy.test`, `dispatch-hook.test` |
| 3 | `calibration: "off"`: `calibrate` (incl. dry-run, json) prints `CALIBRATION-OFF`, writes nothing, skips the closing sync; register fills nothing new; earlier fills kept | `delivery.mjs` | `calibrate-contract.test` |
| 4 | `calibrationSample: "effective"`: cells carry `n_eff` (Kish) and `newest_at`; eligibility needs a table built under effective, `n_eff ≥ min_n`, newest landing within two half-lives at registration; classes need total effective 12 | `lib/calibrate.mjs`, `delivery.mjs` | `calibrate-contract.test` |
| 5 | Cell schema check (`CALIBRATION-INVALID`), generated v1 tables still valid | `lib/calibrate.mjs` | `calibrate-contract.test` |
| 6 | Immutable snapshots `calibration/<sha256>.json`, atomic, pre-existing table preserved, none on dry-run | `delivery.mjs` | `calibrate-contract.test` |
| 7 | Paired capture + evaluator | **increment 2** (needs its own activation command and pair records) | — |
| 8 | `calibrate` owner without a PM: the session that closes the plan | delivery-monitor `SKILL.md`, PM `AGENT.md` | docs |

`profile set` accepts the policy keys and keeps those already set unless the new file sets them.

Verification: `npm test`, `npm run validate`, main-vs-branch `report --json` on copies of two real ledgers (identical apart
from run timestamps), then an adversarial code review (Codex gpt-6-astra, high).
