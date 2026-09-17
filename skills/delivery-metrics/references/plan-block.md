# Plan block

The tech-lead's decomposition document carries one fenced ```` ```json delivery-plan ```` block —
the machine-readable plan `plan register` validates, assigns stable ids to, and stores as a run
under `.agents/telemetry/delivery/plans/<encoded-run-id>.json`. This document is the landed
schema (`scripts/lib/plan.mjs` `validatePlan`/`validateIds`/`assignIds`), the estimate object,
acceptance semantics, re-cut mechanics, and the markdown importer's limits. A filled example is
`templates/plan-block.template.md`.

## Block schema

```json
{
  "campaign_id": "sec", "run_id": "run-1", "version": 1, "factory": "feature-development",
  "observation_start": "2026-09-16T08:00:00Z",
  "source_epoch": {"from": "2026-09-16T08:00:00Z", "until": null, "integration_ref": "main"},
  "campaign": {"ref": "security-testing-bundle", "estimate": {"...": "optional, see below"}},
  "mission_kind": "group",
  "missions": [{"ref": "G12", "sequence": 12, "estimate": {"...": "optional"}, "tasks": [
    {"ref": "TASK-023", "story": "US-021", "class": "M", "role": "js-dev", "branch": "task/task-023",
     "estimate": {"unit": "h", "low": 1, "high": 3, "tier": "budgetary", "proposed_by": "tech-lead",
                  "proposed_at": "2026-09-16T08:00:00Z", "accepted_by": null, "accepted_at": null}}
  ]}],
  "supersedes": {"run": "sec/run-0", "item_map": {"sec/run-0/task-task-021": "sec/run-1/task-task-023"}}
}
```

`plan register --from <plan file> --id <token>` resolves this block from a fenced
```` ```json delivery-plan ```` section in the file (or accepts a bare JSON file as the whole
plan); a file that parses as neither is treated as a markdown import candidate (see below).

| Field | Rule (`validatePlan`) |
|---|---|
| `campaign_id`, `run_id` | must match `^[a-z0-9][a-z0-9-]*$`; **the run id is `campaign_id/run_id`** (`runIdOf`) — the `plan` field on every ledger observation for this run, and the `--plan`/`--head` argument everywhere else (e.g. `--plan sec/run-1`) |
| `version` | positive integer; the *first* registration of a run must be `version: 1`; a re-cut must strictly exceed the run's current stored version |
| `factory` | `feature-development \| test-automation \| manual-qa` — must be included in `--factories` (defaults to just this plan's own factory) when `plan register` computes the roster |
| `observation_start` | ISO — the earliest instant this plan's evidence should be trusted; also the report's default `--since` |
| `source_epoch` | `{from: ISO, until: ISO|null, integration_ref: <branch>}` — the window and integration ref `backfill --git` is allowed to read |
| `mission_kind` | `group \| milestone \| wave \| batch \| run` — cosmetic label for what a "mission" means on this plan |
| `campaign` | `{ref (required), item_id?, estimate?}` — the plan's single root item |
| `missions[]` | `{ref (unique), sequence (unique positive int), item_id?, estimate?, tasks[]}` |
| `missions[].tasks[]` | `{ref (unique across the whole plan), story? (must match `US-\d+` if present), class?, role?, branch?, item_id?, estimate?}` |
| `supersedes` | optional `{run, item_map}` — see *Re-cut* below |

Every `ref` (campaign, mission and task refs together) must be globally unique within one plan
document; every explicit `item_id` (if you supply one instead of letting `plan register` assign
it) must be unique too. `sequence` numbers must be unique among missions.

**Id assignment** (`assignIds`, when `item_id` is omitted): `<run>/campaign`,
`<run>/mission-<slugified-ref>`, `<run>/task-<slugified-ref>` — **run-scoped**, so the same
human-readable `ref` in two different runs never collides at the `item_id` level (see
`references/event-model.md`). `validateIds` then requires every `item_id` to start with
`<run>/`, be unique, and (if `parent_item_id` is explicitly supplied) point at an id that exists
in the same document.

## Estimate object

```json
{"unit": "h", "low": 1, "high": 3, "tier": "budgetary",
 "proposed_by": "tech-lead", "proposed_at": "2026-09-16T08:00:00Z",
 "accepted_by": null, "accepted_at": null,
 "reference": {"path": "...", "sha256": "<64 hex>", "population": "..."},
 "probability": 0.7}
```

`validateEstimate` (`scripts/lib/events.mjs`, shared by the plan schema and every `estimated`
ledger record):

- `unit` must be `h` or `active_min` — never a working day or a story point.
- `low`/`high` must be finite numbers ≥ 0, `low ≤ high` (equal bounds are a valid **point**
  estimate — flows through as `point: true`-equivalent in the metrics exclusion set, see
  `references/metrics.md`).
- `tier` must be `ROM \| budgetary \| calibrated \| unknown`.
- **`tier: "calibrated"` requires `reference: {path, sha256, population}`** — `path` and
  `population` non-empty, `sha256` exactly 64 hex characters. A calibrated tier with no saved
  reference is rejected at registration (`SCHEMA-INVALID`); M1 has no `--calibrate` writer yet
  (see `references/metrics.md` M2+ list), so `calibrated` is only reachable by hand-pointing at a
  reference snapshot you already trust.
- `proposed_by` required (any non-empty value); `proposed_at` must be a valid ISO timestamp.
- `accepted_by`/`accepted_at` are independently nullable, but validated when present:
  `accepted_by` a non-empty string, `accepted_at` a valid ISO timestamp.
- `probability`, if present, must satisfy `0 < p < 1` — declared, never inferred from tier/prose.

## Acceptance semantics

An estimate only counts toward accuracy once **both** `accepted_by` (a named human) and
`accepted_at` (a timestamp) are present (`estimateStatus`) — this records attribution, not
authentication (`caveats: acceptance: unauthenticated` is unconditional on every report). An
estimate missing either field is `unaccepted`: recorded in the ledger, excluded from
`estimate_original`/accuracy.

`estimateChange(prev, next)` (`plan.mjs`) classifies what a re-cut's estimate diff means, per
item, and drives which `estimated` observations get emitted:

| Result | When | Registered as |
|---|---|---|
| `new` | item had no previous estimate | new `estimated` observation |
| `changed` | `{unit, low, high, tier}` differ from the previous version, and the new pair has a later `accepted_at` than the old (or the old was never accepted) | new `estimated` observation, `meta.acceptance: "accepted"` |
| `changed-stale-acceptance` | the range/unit/tier changed but the new `accepted_at` is not later than the old (or missing) | still recorded (so the change itself is never silently dropped), but `meta.acceptance: "stale-acceptance"` — excluded from `estimate_original` until a fresh, later acceptance lands |
| `accepted` | the range/unit/tier is **unchanged**, but `accepted_at` newly appears or is re-affirmed with a later timestamp than before | new `estimated` observation — the ordinary "propose once, accept later (or re-affirm)" workflow is itself a real, registrable fact, not a no-op |
| `none` | genuinely nothing changed | no observation emitted |

**A changed range always needs its own, newer acceptance pair** — you cannot carry an old
`accepted_by`/`accepted_at` forward onto a new `[low, high]`; `estimateChange` will class it
`changed-stale-acceptance` and it stays excluded from accuracy until re-accepted.
`estimate_revision` (on the ledger record, `meta.estimate_revision`) counts how many `estimated`
observations already exist for that item — set by the CLI from the live ledger, never invented
by `plan.mjs` itself.

## Re-cut (`version`, `--at`, `supersedes`)

- **`version`** must strictly exceed the run's current stored version (`prev.version`) — you
  cannot register a lower or equal version over an existing run.
- **`--at <effective iso>`** is required for any re-cut (`version > 1`) that is a genuinely new
  request (not a byte-identical retry of an already-registered version) — it is the historical
  effective instant the timeline replay uses (`buildTimelines`'s `catalogueAt`) to decide which
  catalogue snapshot was true at any past instant. Membership/scope changes only take effect from
  `--at` forward; earlier timeline replay still uses the prior version's catalogue.
- Items missing from the new catalogue are cancelled unless `--keep-missing` is passed; an item
  already `done` when it drops out of scope is **never** retroactively cancelled — it's counted
  `scope_removed_delivered` instead, and stays `done` in history. Re-adding a missing item
  (`reopened`) or an already-cancelled one un-cancels it.
- **`supersedes: {run, item_map}`** declares that this run continues a *different* predecessor
  run's identity (as opposed to an ordinary re-cut of the same run). M1 permits only **identity**
  carry-overs: `run` must equal the predecessor's own run id, every `item_map` key must exist in
  the predecessor's saved catalogue, every value must exist in this plan, the map must be
  injective, and neither side of a non-identity (`old !== new`) mapping may *also* independently
  exist as a distinct item on the other side (that would be a merge/split in disguise, not a
  rename) — any violation is `MIGRATION-REQUIRED`, never silently applied. A valid mapping is
  applied by `mergeCatalogue`'s `renameMap` *before* diffing, so the item's registration history
  (`version_added`) survives under its new, run-scoped `item_id`.
- A **byte-identical retry** of an already-registered request (same `--id` token, same resolved
  plan content) re-emits the exact same saved observations and prints `PLAN <run> v<n> (retry)` —
  this is a no-op at the ledger level (`SKIP`), safe to re-run.

## Importer limits (markdown → canonical block)

When the input file has no ```` ```json delivery-plan ```` block, `plan register` falls back to
the bounded markdown importer (`scripts/lib/plan-markdown.mjs`) — it **requires**
`--campaign --run --observation-start` on the command line (there is nothing in prose to infer
them from) and always prints the derived block first (`DRY-RUN … — re-run with --yes to
register`); nothing is written until you pass `--yes`.

- **Tasks**: recognised only as `#### TASK-<nnn>: <title>` headings (`nnn` ≥ 3 digits); the next
  1–3 lines are scanned for `**Story:**`/`**Complexity:**` fields (a bare-field line format the
  tech-lead's own task template already uses). `Story` is kept only if it matches `US-\d+`
  (otherwise dropped, not guessed); `Complexity` becomes `class`; `**Assigned to:**` or
  `**Assigned:**` becomes `role`.
- **Groups/missions**: read from a fenced code block under a `## 1. Execution plan` heading.
  Each `Gn <membership list>` line is a mission; continuation lines (indented, no leading `Gn`)
  extend the previous group. Parenthetical notes `(...)` and trailing `← depends on ...`
  dependency arrows are stripped before parsing membership numbers — membership tokens are
  3+-digit numbers separated by ` · ` or multi-space column gaps, matched against each task's
  numeric suffix.
- **Ungrouped tasks**: any `TASK-*` heading found but never listed in a group is placed into a
  synthetic `"ungrouped"` mission (appended last) and reported as a `WARN` line — never dropped.
- **Never invents estimates.** The imported block has no `estimate` fields at all — the tech-lead
  (or a human at the terminal) must add ranged estimates before/at acceptance; the importer's job
  is only to turn an execution-plan document into a valid, registerable tree.
- **`import` provenance**: `{basis: "markdown-import", task_count, group_count, source_sha256}` is
  attached to the produced block so a later report/audit can tell a markdown-imported plan from a
  hand-authored one.
