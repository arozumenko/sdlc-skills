# Event model

One append-only line per observation, `.agents/telemetry/delivery/events-<user>.jsonl`
(spec §6.1/§6.2). This document describes the contract as it actually landed in
`scripts/lib/events.mjs` — the field table below, the event vocabulary, identity rules,
read-time resolution order and source precedence.

## Field table (this plan's representation choices)

```json
{"v":2,"at":"2026-09-16T11:00:00.000Z","recorded_at":"2026-09-16T13:00:00.000Z","user":"daniel-sallai","host":"cli","plan":"sec/run-1","item_id":"sec/run-1/task-task-023","ref":"TASK-023","level":"task","event":"done","transition_id":"sec/run-1/task-task-023/done/episode-1","source":"cli","source_record_id":"done-023","observation_id":"cli:done-023:sec%2Frun-1%2Ftask-task-023:done","revision":0,"status":"active","basis":"observed","session":null,"agentId":null,"role":null,"label":null,"raw":"merged","meta":{"git_sha":"<full-sha>","version":1}}
```

| Field | Rule |
|---|---|
| `v` | schema version; currently `2` (`SCHEMA_VERSION`) — a line whose `v` doesn't match is counted `unknown_version`, never read |
| `at`, `recorded_at` | canonical UTC ms ISO (`new Date(x).toISOString() === x`); `at` is the occurrence clock (corrections may move it), `recorded_at` is capture time |
| `plan` | **the run id, `<campaign_id>/<run_id>`** (e.g. `sec/run-1`) — not a bare campaign slug. A re-cut (`version`) does not change `plan`; the version travels in `meta.version` instead |
| `item_id` | **run-scoped**: `<run>/campaign`, `<run>/mission-<slug(ref)>`, `<run>/task-<slug(ref)>` (`assignIds` in `lib/plan.mjs`) — ids from two different runs can never collide, even if their human-readable `ref`s do |
| `ref`, `level` | the plan catalogue's human-readable ref (`TASK-023`, `G12`, …) and `campaign\|mission\|task\|case`; null only together with `item_id` for an admitted-but-unattributed hook dispatch (`meta.unattributed: true`) |
| `event` | one of the 18 below |
| `transition_id` | stable occurrence token. CLI: `<item_id>/<event>/episode-1` for `done`/`cancelled`/`reopened` (one occurrence per episode), else `<item_id>/<event>/<token>` (`--id`); the hook uses `<item_id-or-'unattributed'>/<event>/<agent_id>`; `plan register` uses `<item_id>/created/0` and `<item_id>/estimated/rev-<n>` |
| `source` | `cli \| automation-sync \| hook \| git` — who produced this observation (see precedence below) |
| `source_record_id` | the producer's own retry/request token — `--id` on the CLI, `claude:<session>:<agent_id>` for the hook, the commit sha's own token for `backfill --git` |
| `observation_id` | `<source>:<source_record_id>:<item_id \| 'unattributed'>:<event>`, percent-encoded per segment (`observationId()`) — the identity a retry is checked against |
| `revision` | integer ≥ 0; a correction is the same `observation_id` at a strictly higher revision, full replacement payload (never a diff) |
| `status` | `active \| retracted` — retraction is simply the next revision with `status: retracted` |
| `basis` | `observed \| derived-child \| scope-proxy \| gate-proxy \| receipt-proxy \| plan-commit` — how trustworthy the fact is, kept as a separate population from `source` (who produced it) |
| `meta.version` | the plan **catalogue version** (`run.version` at record time) this observation was made against — carried by registration, CLI `event`, and hook records; deliberately excluded from semantic identity (`facts()` in `lib/events.mjs`) so a plan re-cut or a CLI retry against the re-cut plan reproduces the same identity for an otherwise-unchanged historical observation |
| `meta.git_sha`, `meta.stage`, `meta.round`, `meta.clock`, `meta.note`, `meta.unattributed` | evidence locator / hook stage label / rework round / `'corrected'` when `--sha` and `--at` disagreed / free-text note / unattributed-dispatch flag |
| `estimate` | present only on `event: estimated`; `{unit,low,high,tier,proposed_by,proposed_at,accepted_by,accepted_at,reference?,probability?}` — see `references/plan-block.md` |
| `session`, `agentId`, `role`, `label` | nullable host-qualified handles the hook fills in; the CLI leaves them null |

## The 18 events, and what M1 does with each

`EVENTS` (`lib/events.mjs`) is the full accepted vocabulary; only some of it is *derived* into
item state by `reduceTimelineSnapshot` (`lib/timeline.mjs`) in M1 — the rest is accepted,
counted, and deferred.

**Derived (9)** — drive state, `started_at`/`done_at`/`cancelled_at`, WIP, throughput:

| Event | Producer(s) | Effect |
|---|---|---|
| `created` | `plan register` (created observations), `backfill --git` (`plan-commit` basis) | sets `created_at`/`created_basis`/`created_sha`; `planned` |
| `estimated` | `plan register` | appends to `estimates[]`; `estimate_original`/`estimate_latest` derive from it |
| `dispatched` | CLI `event`, Claude hook | `dispatch_count++`; only `basis: observed` can set `started_at` (task level, `stage` build/none); any other basis counts as `proxy_dispatches`; `planned → in_progress` |
| `first_commit` | CLI `event`, `backfill --git` | sets `first_commit_at`; `planned → in_progress` |
| `done` | CLI `event`, `backfill --git` (the hook only ever emits `dispatched`/`dispatch_ended`/`rework_observed` — never `done`) | task: sets `done_at`/`done_basis`/`done_sha`, state → `done`; non-task: only `basis: observed` counts as landing evidence (`landing_at`) |
| `cancelled` | CLI `event`, `plan register` (scope removal) | sets `cancelled_at`, state → `cancelled` (unless already `done` without a later `reopened` — then `invalid-chain`) |
| `reopened` | CLI `event`, `plan register` (scope re-addition) | flags `deferred-episode`, opens a new episode |
| `rework_observed` | Claude hook (`stage: fix`), `backfill --git` (`address review` commits) | `rework_count++` — activity/quality proxy, never a state transition |
| `dispatch_ended` | Claude hook only | no state effect (`break` in the switch) — closes the hook's own dispatch/completion pair |

**Accepted and deferred (9)** — schema-valid, ledger-recorded and counted
(`it.deferred_events++`, `counts.deferredEvents`) but **not derived into state in M1**:
`blocked`, `unblocked` (recorded now, block-interval derivation is M2 — see the
project-manager's *Handling Blockers*), `review_requested`, `review_returned`,
`review_approved`, `review_history` (M1 has no `review_rounds`/`first_pass_rate`), and the
`test-automation` sync-adapter events `scope_declared`, `gate_observed`, `outcome_observed`
(no `sync` subcommand ships in M1 — nothing currently produces these three).

## Identity rules

- **`observation_id`** is the retry/correction handle: `source:source_record_id:item_id:event`.
  Two records that share it are the *same fact at different points in time* (retries, corrections).
- **`revision`** orders those points; the highest revision for an `observation_id` wins at read
  time. A CLI retry with byte-identical semantics at the same revision is a no-op (`SKIP`); a
  changed payload at the *same* revision is `ID-CONFLICT` (append rejected — see
  `appendObservation`); a genuinely new fact (correction) must go to `revision + 1`.
- **`transition_id`** is the occurrence handle, independent of who reported it or how many times:
  `(plan, item_id, transition_id, basis)` is the key `selectOccurrences` groups candidate
  observations by before choosing a winner. Two different `observation_id`s (e.g. `cli:...` and
  `hook:...`) can legitimately describe the *same* transition_id/occurrence — that's where source
  precedence (below) applies.

## Read-time resolution order

1. **Parse and count.** `readRaw` walks every `events-*.jsonl` line independently — a malformed
   UTF-8/JSON/schema line is skipped and counted (`malformed`), a line with an unrecognised `v` is
   counted `unknown_version`, blank lines are skipped.
2. **Collapse by `observation_id` + `revision`.** `resolveObservations` buckets parsed records by
   `observation_id`, then by `revision`. Within one `(observation_id, revision)` bucket, records
   whose `semanticKey` (fact content, ignoring `meta.version`/capture envelope) matches are the same
   fact re-appended (a retry) — counted, not duplicated. Records that disagree are a genuine
   **ledger CONFLICT**: `status: active` variants at the *same revision* with *different* semantic
   content — excluded outright, counted in `coverage.ledger_conflicts`, never resolved by
   filename/arrival order.
3. **Take the highest surviving revision** per `observation_id`; earlier revisions are `superseded`
   (counted, not read). A `status: retracted` record at the winning revision drops the whole
   `observation_id` (`retracted` count) — a retraction withdraws only that one source's claim,
   letting other sources' observations of the same occurrence be reconsidered.
4. **Group survivors by occurrence** (`(plan, item_id, transition_id, basis)`) and apply **source
   precedence** (below). If the best-ranked candidates for an occurrence disagree on fact content
   (`factKey`), that is the second, **occurrence-level CONFLICT**: `equal-rank-disagreement` — no
   lower-source fallback, the occurrence is quarantined (`coverage.occurrence_conflicts`,
   `conflict_list`).
5. **Replay** the surviving, single-winner-per-occurrence set in `(at, transition_id)` order into
   per-item timelines (`references/metrics.md` / `references/plan-block.md` cover what happens next).

## Source precedence and the two CONFLICT kinds

`SOURCES = ['cli', 'automation-sync', 'hook', 'git']`, ranked in that order (`SOURCE_RANK`) —
`cli` is the highest-precedence source, `git` (backfill) the lowest. For one occurrence key,
`selectOccurrences` takes the candidate(s) at the **lowest rank number present** (highest
precedence) and ignores lower-precedence candidates entirely — *unless* that best rank is itself
disputed.

The two CONFLICT kinds, both excluded from the report with no fallback:

1. **`ledger-conflict`** — the occurrence's best-ranked candidate(s) include an observation that
   was already flagged as a ledger CONFLICT in step 2 above (same `observation_id`+`revision`,
   disagreeing content). A disputed observation at the top source rank blocks fallback to a
   lower-ranked source for that occurrence — the occurrence is quarantined, not silently resolved
   by demoting to `hook`/`git`.
2. **`equal-rank-disagreement`** — two or more *different* `observation_id`s, at the same best
   source rank, describe the same occurrence with different `factKey`s (e.g. two `cli` corrections
   under different `--id` tokens disagree about what happened). Also quarantined; also no
   lower-rank fallback.

Both kinds are printed in the report's `## Coverage & caveats` / `Envelope` sections
(`e.coverage.conflict_list`), one line per conflicting occurrence, with every `observation_id` that
disputed it.
