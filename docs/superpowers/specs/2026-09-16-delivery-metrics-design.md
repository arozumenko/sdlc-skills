# delivery-metrics — design spec (v5.1)

> **Rename (2026-09-17):** the skill shipped as `skills/delivery-monitor/` ("delivery monitor"); this spec and its review-round notes keep the working name `delivery-metrics` used while they were written. Paths, ids and titles below map 1:1 (`delivery-metrics` → `delivery-monitor`).

**Date:** 2026-09-16
**Skill:** `skills/delivery-metrics/` (new, orphan top-level; installed through factory `skills[]`)
**Branch:** feat/delivery-metrics-spec (worktree off `main`; spec only)
**Status:** v5 — proportionality pass: guarantees capped at tokenomics' own; 13 mechanisms replaced by explicit limitations; ready for round 5. **v5.1:** §13 re-cut to Slice 1 (M1 = cycle time, velocity, estimate delta per task/mission/campaign) on the user's decision, 2026-09-17; no other section changed.
**Inputs:** research `docs/superpowers/notes/2026-09-16-delivery-metrics-research-0[1-8]-*.md`; reviews `docs/superpowers/notes/2026-09-16-delivery-metrics-spec-v[1-4]-adversarial-review-codex.md`. House style: `docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md`, read from `feat/security-testing-bundle-spec` (absent in this worktree).
**Source aliases:** `TOK` = `bundles/test-automation/skills/tokenomics`; `TAW` = `bundles/test-automation/skills/test-automation-workflow`; `AS` = `bundles/test-automation/skills/automation-scoping`. All delivery schemas below are proposed requirements; §16 anchors existing-repository claims.

## 1. Purpose

A delivery performance tracker for the harness: tokenomics' cadence-and-cycle-time sibling. It records campaign → mission → task → case observations, derives flow/throughput/quality and compares accepted declared ranges with actuals. It never generates estimates, costs or synthetic counts. PM reports and assessor JSON expose evidence, denominators and limitations; calibration supplies measured reference ranges for planners to consult.

## 2. What the skill can and cannot promise

| Can promise (for readable records) | Cannot promise |
|---|---|
| Append-only per-user JSONL; latest revision wins at read time; occurrence/source identity, retractions and conflict counts | Lossless capture or atomic registration/batches; partial writes can leave missing observations (`registration-gaps`, `unregistered`) |
| One `appendFileSync` per line; malformed lines skipped and counted | Crash durability, byte recovery or exact-once appends; a malformed tail can also swallow the next append (`malformed-lines`) |
| Per-user files reduce conflicts; ordinary shared plan/profile files | Concurrent shared-file preservation: last writer wins; overwritten updates may be undetectable (`shared-files: last-writer-wins`) |
| Best-effort telemetry git sync, retry next time; doctor surfaces git conflicts | Cross-writer exclusion, safe subprocess lifetime/reboot recovery or automatic git conflict resolution (`sync: best-effort`, `git-conflicts`, `sync-pending`) |
| Schema validation and unknown-version counts | Producer capability compatibility or coordinated migration (`producer-compatibility: unverified`); tokenomics writers remain unchanged except §13's three small amendments |
| Claude start/end observations from admitted, correlated readable child transcripts | Complete capture, Copilot automatic capture, live pending starts or retention beyond host transcripts (`capture-gaps`) |
| Ranged estimates with proposer and `accepted_by`/`accepted_at`; fixed unit/level actual selection | Authenticated acceptance or user-selectable actual definitions; absent acceptance is `unaccepted`, recorded acceptance is `acceptance: unauthenticated` |
| Generation-qualified imports with source path/hash and explicit task↔PR/session↔plan association | General historical binding reconstruction or provenance attestation; hashes identify read bytes, not coherent producer inputs (`provenance: unverified`, `unattributed`) |
| Quote existing batch/case cost exports and their allocation/finality labels | Atomic cost export snapshots, proven freshness or accounting-window containment; active-minute accuracy is published-minute comparison (`snapshot: non-atomic`, `freshness: unknown`, `window: unverified`) |
| Corrections supersede prior revisions; disagreement quarantines without fallback | Revision-fork repair, atomic wrong-item repair or dedicated reinstatement controls (`CONFLICT`, `invalid-chain`, `partial-update`) |
| Flow/throughput/quality/accuracy with populations, units, evidence and coverage; archived JSON re-rendering | DORA, flow efficiency, benefit ROI, individual rankings, forecasting, Little's Law, or reproducible recomputation from changing live files |

## 3. Decisions (locked)

| # | Decision |
|---|---|
| D1 | Orphan `skills/delivery-metrics/`, attached through both factories' `skills[]`; Node ≥18 stdlib ESM. Never import or change tokenomics code except the three already-agreed M-1 amendments (§13). |
| D2 | Campaign → mission → task → case; story is a tag. Mission means declared feature group/milestone or automation wave/flat batch (§5). |
| D3 | `.agents/telemetry/delivery/` on the single shared telemetry submodule/branch; never write inside `automation/`. Delivery installer owns inner/root ignore blocks. P-0 amends namespace wording. |
| D4 | Per-user append-only observations reduce conflicts, no guarantee. Shared files use last-writer-wins; git conflicts are surfaced, never automatically resolved. |
| D5 | Separate `transition_id` occurrence from `observation_id` source identity; integer revisions, latest wins; retraction is `status: retracted`. Duplicate conflicting revisions are excluded/countable (§6.2). |
| D6 | Same occurrence and clock basis: `cli > automation-sync > hook > git`. Equivalent top-ranked facts coalesce; disagreement quarantines with printed `CONFLICT`, no lower-rank fallback. Proxies never compete with measured clocks. |
| D7 | First observed build dispatch → first qualifying completion; first throughput survives reopen. Separate first/open and reopen episodes; block duration is interval union. |
| D8 | Missing dispatch gives `commit_to_done`, never cycle time. PR open→merge is `time_to_merge`, labelled “PR open to merge — not story lead time, not cycle time.” |
| D9 | Estimates are declared ranges; one acceptance pair per estimate, absent pair excludes. Original = first accepted estimate; latest = latest accepted before start/cutoff in the same unit. Actual selection is fixed in §6.4. |
| D10 | UTC ms timestamps, seconds internally, hours to 2 dp in reports. Nearest-rank median n≥5, P85 n≥7, P90 n≥10; always n/min–max. No mean duration headline. |
| D11 | UTC ISO weeks, zero-filled only within declared coverage; partials flagged. Velocity = median whole-week throughput, minimum 3 whole weeks, otherwise null. |
| D12 | Per-metric validity: retain real sub-minute durations and confirmed zero blocked time; exclude retrospective lead proxies only with same-commit evidence. |
| D13 | Segment by level, class, role, model, factory and mission; no `byPerson` or agent leaderboard. User attribution is storage mechanics. |
| D14 | Every volume/speed stratum includes quality and reviewed/eligible/done denominators or explicit unknown. Missing review never means success. |
| D15 | Opt-in `_delivery` installer with `--remove`, `--doctor`, `--local`, `--host claude`; semantic removal preserves later unrelated edits. Installation alone never enables capture. |
| D16 | Hook admission needs open plan, participating-factory roster union and session↔plan guard. Legacy missing type relaxes only role check (P-1). |
| D17 | One async Claude `SubagentStop` reads child clocks; unsupported shapes unknown. Copilot/live markers parked; no SessionStart injection or Stop gate. CLI/git cross-host. |
| D18 | Resolve within generation: metadata description, full-first-message stage label, then declared branch alias; ambiguity unattributed. Cluster dispatch starts task, not cases. |
| D19 | Canonical fenced `json delivery-plan`; markdown importer dry-run reviewed. Stable run/item ids and injective re-cut map; registration is best-effort and gaps visible. |
| D20 | Generation-qualified `catalogue[]`; only existing batch/case cost exports consumed. Feature-task cost attribution parked. |
| D21 | CLI 0 success, 1 internal error, 2 invalid input/identity/conflict, 3 not measurable with explanation. Hooks always exit 0 with diagnostics. |
| D22 | Calibration is a saved measured reference, never an estimate writer. Index rebuilt from readable snapshots; no transactional plan/index consistency. |
| D23 | Installed sibling tests and fixtures; verbatim copies checked for duplicates, transformed fixtures carry source provenance. |

## 4. Placement and roles

Add the orphan registry entry `{id:"delivery-metrics",monorepo:"sdlc-skills",name:"delivery-metrics",description:…}` and attach through both factories' `skills[]`. Add `skills-on-demand:` to feature PM/tech-lead/scout and automation lead/scout; instructions name registration, transitions and reports. Scout records opt-in choice; only yes runs the hook installer.
Frontmatter: `name: delivery-metrics`, trigger description ≤1024 chars, `license: Apache-2.0`, quoted compatibility ≤500 chars, `metadata.authors`, version `"0.1.0"`; no `tools:` or extra top-level keys. CLI installation works without hooks or tokenomics.

## 5. Vocabulary and work-item hierarchy

| Level | feature-development | test-automation | manual-qa (unwired) |
|---|---|---|---|
| campaign | spec/backlog run | approved campaign plan | — |
| mission | declared Gn group / Mn milestone | wave or flat batch | run |
| task | TASK-NNN dispatch/review/integration unit | cluster or solo build unit | — |
| case | —; ACs are not items | opaque TMS id | TC |
| story tag | US-NNN | — | — |

**Identity:** explicit stable `campaign_id`, `run_id`, integer `version`; `plan_id = campaign_id/run_id/version`. Rerun gets a new run. Each immutable `item_id` has display `ref`, level, parent and validity interval. Full ref is `plan_id:ref`; case ref includes mission/task/case, with raw `case_id` preserved. Bare ids require unique membership in explicit plan context. Hash canonical plan JSON (sorted keys, original array order), never mutable card State/Log.
**Re-cut:** declare `supersedes` and injective old→new mapping; unchanged work retains stable ids/history, removed work remains historical scope. Splits/merges create new ids with lineage, never copied completions. Claimed continuity without mapping fails `MIGRATION-REQUIRED`. Across versions union stable ids once; independent runs remain distinct. Imports carry generation/epoch plus exact item maps as operation metadata, not a general binding service.
**Parentage:** one parent, no cycles; campaign→mission→task→case. Feature tasks may be leaves; solo automation cases have one-case tasks. Parent/membership/class/role changes are effective-dated in plan versions; use the endpoint version for historical metrics.
**Rollup:** parent start = earliest eligible descendant build start (`derived-child-start`). Completion requires all required children terminal, at least one delivered, and evidenced integration boundary; clock = latest child terminal/integration. Partial cancellation prints counts/`partial-cancelled`; all cancelled means cancelled, unknown child keeps parent open. Task completion requires unit integration; missions require landing to declared base; campaign needs all missions terminal. Explicit done cannot hide unfinished children (`PARENT-INCOMPLETE`).
Child reopen/scope addition reopens ancestors without erasing first completion. Mission `sequence`/optional `predecessor` is explicit; turnaround = successor start minus predecessor last completion before that start. Open/overlapping predecessor gives null gap plus measurable overlap, never negative gap.
Example: W contains cluster K(A,B) and solo S(C). K starts 09:00, S 10:00; A/B accepted and K integrated 11:00, C blocked: W stays open. C accepted/S integrated 12:00, W lands 13:00: W elapsed 4 h; case cycles remain unknown without individual starts. C cancelled instead gives partial-cancelled W; another unfinished wave keeps campaign variance null.

## 6. Contracts

### 6.1 Records and paths

| Under `.agents/telemetry/delivery/` | Contract |
|---|---|
| `events-<user>.jsonl` | one `appendFileSync(path, JSON.stringify(record) + "\n")` per observation; no rewrite |
| `plans/<encoded-plan-id>.json`, `profile.json` | ordinary JSON, shared-file last-writer-wins; plan versions retain readable history |
| `sessions/<encoded-host-session>.json` | small hook guard `{host,session,plan}` only |
| `imports/<sha256>.json` | saved bytes actually read; hash/source path in observations; no producer attestation |
| `calibration/<date>-<uuid>.json`, `calibration-log.md` | saved reference snapshots and rebuildable index |
| `reports/`, `.lock/`, `.pending-*` | ignored generated/transient files |

Reversibly percent-encode path segments including `/` and `%`. User slug follows TOK identity precedence/normalization (§16); read all user files, so rename does not duplicate observation identity. Slug collision remains an attribution limitation.
Append without fsync, intent files or multi-file commit protocol. Parse lines independently; skip/count malformed UTF-8/JSON/schema lines as `malformed-lines` with path/line, unknown versions separately. Do not repair/truncate a torn tail; the next append may be swallowed into that malformed line too. Complete valid JSON at EOF is readable. Missing records stay unknown; retry may append again but read-time dedup, not recovery, handles duplicates.
A delivery-local mkdir lock may serialize its own small writes, using a 60 s stale rule; it is advisory only, never a tokenomics/shared-writer lock. Timeout/stale removal cannot prove a former process or Git child stopped. Do not add process-lifetime or reboot recovery machinery. Reports always state `concurrency: best-effort`; known lock skips are counted.
Every delivery mutation requests best-effort shared telemetry `git add -A`, commit if dirty, push; rejected push may fetch/merge and retry once, then simply retry next invocation. `DELIVERY_NO_SYNC=1` disables sync; offline/local records remain usable. Reuse/bootstrap the single self-referential telemetry submodule/branch. Doctor reports dirty/unpushed state, unfinished merge, git locks and conflicts; never auto-resolves, resets, or promises orphan-process recovery. Existing tokenomics remains independent.
Owned `# >>> delivery-metrics` / `# <<< delivery-metrics` ignore blocks cover `/delivery/reports/`, `/delivery/.lock/`, `/delivery/.pending-*` inside telemetry and prefixed equivalents in main. Preserve other owners' rules on install/upgrade/remove. Doctor checks actual `git check-ignore` and disposable-index staging; tracked transients are surfaced for manual repair. Never ignore the telemetry root itself.

### 6.2 Event line

```json
{"v":2,"at":"2026-09-16T11:00:00.000Z","recorded_at":"2026-09-16T13:00:00.000Z","user":"daniel-sallai","host":"cli","plan":"security-testing-bundle/run-1/2","item_id":"task-023","ref":"TASK-023","level":"task","event":"done","transition_id":"task-023/done/episode-1","source":"cli","source_record_id":"correction-17","observation_id":"cli:correction-17:task-023:done","revision":0,"status":"active","basis":"observed","session":null,"agentId":null,"raw":"merged","meta":{"git_sha":"<full-sha>"}}
```

| Field | Rule |
|---|---|
| `at`, `recorded_at` | valid UTC ISO ms occurrence/capture clocks; corrections may move occurrence earlier |
| `plan`, `item_id`, `ref`, `level` | generation-qualified; null item/ref only for admitted unattributed dispatch |
| `event` | created, estimated, dispatched, dispatch_ended, first_commit, review_requested, review_returned, review_approved, review_history, done, cancelled, blocked, unblocked, reopened, scope_declared, gate_observed, outcome_observed, rework_observed |
| `transition_id` | stable occurrence token: episode, review id, dispatch or block interval; repeated transitions get separate tokens |
| `source_record_id`, `observation_id` | upstream id/CLI retry token; encode source/record/item/event tuple injectively; do not drop lower-ranked evidence on append |
| `revision`, `status` | integer ≥0, active or retracted; correction is a new revision superseding the previous, with full replacement payload |
| `basis` | observed, derived-child, scope-proxy, gate-proxy, receipt-proxy, plan-commit; keep populations separate |
| `meta`, `raw`, `estimate` | evidence path/hash, episode/causal/interval/review details, raw factory outcome; estimate §6.4 |
| `session`, `agentId`, `role`, `label` | nullable host-qualified handles; ids only by default (`capturePrompts:false`) |

Reader: parse/count → collapse identical semantic retries across files (capture time ignored) → latest integer revision per observation → omit retracted → select D6 within occurrence/basis → effective-time replay. Different semantic payloads at the same revision number print `CONFLICT` and exclude that observation; no filename/arrival-order winner or fork-repair command. A higher unique revision supersedes earlier revisions. A conflicting current observation blocks fallback at its source rank for that occurrence.
At the highest surviving source rank, equivalence requires equal at/event/episode/causal/interval/review/result/estimate/gate/disposition facts; capture envelope/raw labels/evidence locators may differ and provenance is retained. Disagreement quarantines occurrence with `CONFLICT`, no lower-source fallback. Unknown equivalence gives `AMBIGUOUS-TRANSITION`; never join by nearest clock.
Retraction is simply the next revision with `status: retracted`; it withdraws only that source observation, allowing surviving sources to be reconsidered. Correct wrong-item A by retracting A and separately adding B; not atomic (`partial-update`). Same-source reimport of the old revision cannot resurrect A. No separate tombstone/reinstatement control schema; later corrections use the same revision rule.
Sort selected events by at, explicit episode/causal ordering, then observation id. Unresolved incompatible ties/dependent transitions are `invalid-chain` and excluded, never reinterpret recompletion as original done. Apply revisions before cutoff: reports show corrected effective-time history from the bytes read, not knowledge-as-of history. Old archived JSON remains unchanged; orphan-plan events are `unregistered` and excluded.

### 6.3 Plan registration

Canonical fenced `json delivery-plan` example (estimates carry their own acceptance pair):

````markdown
```json delivery-plan
{"campaign_id":"security-testing-bundle","run_id":"run-1","version":2,"factory":"feature-development","observation_start":"2026-09-16T08:00:00Z","source_epoch":{"from":"2026-09-16T08:00:00Z","until":null,"integration_ref":"main"},"campaign":{"item_id":"campaign-1","ref":"security-testing-bundle"},"mission_kind":"group","missions":[{"item_id":"mission-12","ref":"G12","sequence":12,"tasks":[{"item_id":"task-023","ref":"TASK-023","story":"US-021","class":"M","role":"js-dev","branch":"task/task-023","estimate":{"unit":"h","low":1,"high":3,"tier":"budgetary","proposed_by":"tech-lead","proposed_at":"2026-09-16T08:00:00Z","accepted_by":null,"accepted_at":null}}]}]}
```
````

`plan register --from <file> --id <retry-token>` validates schema/tree/epoch/explicit observation start/migration, assigns missing stable ids and returns the completed block for reuse. Catalogue rows carry item/ref/level/parent/story/class/role/generation/valid_from/valid_until. Plan holds source path/hash, participating factories/rosters, declared item branch aliases, and optional task `{repository,pr}` association; no universal binding store.
Write the plan file and append created/estimated/cancelled observations independently. Created time = explicit `--created-at`, else pinned first plan commit containing item, else now with basis stated. Missing active items cancel unless `--keep-missing`; removing delivered scope never cancels its history; re-addition explicitly reopens. Emit registration observations using stable request/item/event identities on every retry, not only a catalogue diff. An interruption may still leave gaps: doctor/report compare readable catalogue to observations and print `registration-gaps`, never claim automatic recovery. `plan close` ends capture eligibility, not delivery state.
Markdown import reads TASK headings and Story/Complexity/Assigned-to/Gn declarations, prints canonical block without inventing estimates, requires `--dry-run` then `--yes`. Plan re-cuts require explicit effective `--at`; ordinary mutable profile/session/PR metadata updates are last-writer-wins, historical overwritten values cannot be reconstructed. `session set` stores host/session→plan for the hook guard; `plan pr` stores task→repository/PR number. These are the only explicit association commands.

### 6.4 Estimates

Estimate: `{unit,low,high,tier,class?,proposed_by,proposed_at,accepted_by,accepted_at,basis?}`. Finite nonnegative bounds, low≤high; equal bounds flag `point:true`. Unit is `h` or `active_min`, never working-day `d` or points. Tier ROM/budgetary/calibrated/unknown; calibrated requires saved reference path/hash/population. Optional probability 0<p<1 is declared, never inferred from confidence prose.
**Actual selection, fixed once:** `h` means task/case `cycle_time` (first observed build dispatch→first qualifying completion), or mission/campaign parent elapsed (earliest eligible descendant build start→first qualifying container completion, derived-child). `active_min` means tokenomics' quoted case `direct.activeMin` as published; mission `totals.activeMin` is a separate labelled batch-total comparison including overhead, never pooled with case direct. No task/campaign active actual without an existing matching export. Lead time and commit proxies never substitute. Active acceptance timeliness uses generation-qualified scope declaration as its declared start; completion/landing chooses the report cohort, **not** a proven accounting window. All active comparisons print `window: unverified` (§6.12).
Both `accepted_by` (named human) and valid `accepted_at` must be present; otherwise `unaccepted` and excluded. This records attribution, not authentication. Acceptance is fields on the estimate, not a signed digest or separate control object. Changed range/unit/tier requires a newly declared pair. Original = first accepted estimate retained even if late/ineligible; latest policy selects latest accepted strictly before the applicable start and cutoff, same unit. Missing start→`missing-start`; at/after start→`late-accepted`; missing actual→`missing-actual`. Report all exclusions and `acceptance: unauthenticated`.
`automation-scoping-v1` imports exact estMin/lowMin/highMin/confidence, source path/hash and available scorer/taxonomy/calibration provenance. Bounds→active_min, size→ordinal class; explicit tier else unknown. Commit/mtime is proposal-record time, never acceptance. Pass generation/item map on import; ambiguous mappings are excluded. Source confidence never becomes probability or automatic calibrated tier.
`midpoint=(low+high)/2`; `work_ratio=actual/midpoint`; `MRE=abs(actual-midpoint)/actual`; MdMRE=median MRE, PRED(25)=share MRE≤.25, MAE=mean absolute error. Zero midpoint excludes ratio; zero actual excludes MRE/PRED but remains in MAE; print counts. Hit rate = low≤actual≤high over ranged, eligible estimates only; point/unknown-probability counts explicit, no calibration-probability claim. Group by unit/level/basis/class/tier, retain unestimated/unaccepted counts. Parent schedule variance band = actual−high to actual−low, first-completion elapsed; scope changes and current episode reported separately.

### 6.5 CLI — `scripts/delivery.mjs`

| Command | Contract |
|---|---|
| `plan register --from <f> --id <token> [--at <iso>] [--created-at <iso>] [--keep-missing] [--dry-run] [--yes]` | §6.3 |
| `plan close/list/show --plan <id>`; `profile set --from <f>` | ordinary files; no transactional reconciliation |
| `plan pr --plan <id> --task <ref> --repository <repo> --pr <n>`; `session set --host <h> --session <s> --plan <id>` | small explicit PR association / admission guard only |
| `event <ref> <event> --plan <id> --id <token> --transition <occurrence> [--at <iso>] [--sha <sha>] [--revision <n>] [--status active/retracted] [--interval <id>] [--raw <s>] [--note <s>]` | correction/retraction uses same observation identity and higher revision |
| `event --from <jsonl>` | validated event-specific payloads; sequential appends, not atomic |
| `status [--plan <id>]`; `doctor` | state/age/coverage, capture/storage/sync diagnostics |
| `backfill --git --plan <id> --head <sha> [--since <iso>] [--cutoff <iso>] [--pr] [--dry-run]` | integration ref in registered source epoch (§6.7) |
| `sync --automation --plan <id> --from <inputs.json> [--dry-run]` | generation/item map and source paths supplied with each import (§6.8/6.12) |
| `report [--plan <id>…] [--since <iso>] [--until <iso>] [--cutoff <iso>] [--level …] [--class …] [--json/--html] [--out <f>] [--from-json <f>] [--latest-estimate] [--calibrate]` | §§6.9–6.11 |

`--sha` uses committer timestamp/full SHA; a differing explicit at must be a correction. Retry semantic equality prints `SKIP`; changed same-id/revision input exits 2 `ID-CONFLICT`. Other errors: USAGE, SCHEMA-INVALID, INVALID-TRANSITION, AMBIGUOUS-PLAN/TRANSITION, MIGRATION-REQUIRED, LOCK-BUSY, CONFLICT (2); NO-PLAN/NO-EVENTS (3); internal error (1). Doctor prints diagnostics and exits 0. Known zero-throughput/carried-in state remains measurable. stdout PLAN/EVENT/BACKFILL/SYNC/REPORT/STATUS includes counts; `--from-json` rejects recomputation flags.

### 6.6 Hooks

Owned installer registers one `_delivery` Claude `SubagentStop`, matcher `*`, async, timeout 30, command `node hooks/dispatch-hook.mjs --stop`; unsupported host exits 2. Bounded 64 KiB stdin/deadline, no stdout, all hook failures exit 0. Use git worktree metadata to find the telemetry owner; this is proposed behavior, gated by SPIKE-1.
Admission: open session-associated plan and role in its participating factory roster union. Foreign roles silently exit; missing type relaxes role test only and counts `unknown-role`. Unbound session creates a capture diagnostic, outside delivery denominators. No general scope/branch/session binding history.
Correlate `(host,session_id,agent_id)`; prefer validated child transcript path only after SPIKE-1 fixtures; fallback matching child under parent transcript's session/subagents with metadata. Validate path/session association, never role/time correlation. First/last valid transcript clocks supply observed start/end only with completion evidence; missing/partial transcript stays unknown/incomplete. Resolve metadata description, else stage label in full first user message before truncation, else plan branch alias (§16).
Build/implement starts measured task cycle; review dispatch is request proxy; fix/address-review emits `rework_observed`, never review_returned. Gate/merge/other stages are activity only. Qualified member lists may identify multiple items, but cluster start stays task-only. Ambiguous ids yield one unattributed dispatch pair. Retry SKIP/growth revision and best-effort sync follow §6.1. Doctor checks rosters/guard/transcripts/ignores; remove only owned entries semantically, never ledger/submodule data.

### 6.7 Git backfill

Require registered generation, source epoch `[from,until)`, integration ref and immutable `--head` on that ref; pin selected refs/SHAs/cutoff and PR response hashes. Never scan `--all`. `--since` limits new imports, not later report replay. Resolve declared lowercase branch aliases before filtering canonical case-sensitive refs.
Creation = first pinned plan commit containing item (`plan-commit`); first_commit = earliest nonmerge `<ref>:` in generation's pinned unit/integration history; address-review commits = `rework_observed`. Local done needs first-parent integration merge, declared branch alias and second-parent evidence; arbitrary ancestor containment is insufficient. PR reads use explicit task↔repository/number, verify head/base/generation/merge SHA/epoch, and paginate reviews completely. No task-id-in-title requirement; squash/deleted branches work via PR mapping.
Missing gh/auth/mapping/pagination yields unavailable/partial, never complete review history. PR creation is time_to_merge start, not review request. Later completion needs explicit reopen/episode evidence. Local/PR observations for one merge share occurrence and obey D6. Golden fixture uses fixed-date temp git (59 tasks, 30 missions, 33 first completions, 11 rework-proxy items); later branch growth cannot change pinned output.

### 6.8 test-automation sync adapter

Read existing sources into delivery-only imports/observations; never write automation artifacts. Each invocation names plan/run, mission, source paths and exact item map; reject ambiguous/reused ids. Campaign Plan JSON supplies tree; State/Log edits do not mint identity. Flat batches require run id. Scoring imports proposals per §6.4. Scope declaredAt is scope-proxy; outcomes[id].at is outcome_observed unless independent evidence confirms acceptance. Mutable missing past outcomes stay unknown.
Read/dedup both telemetry `automation/gate-runs/<slug>.jsonl` and main `.agents/automation/<slug>/gate-runs.jsonl`. Existing fields at §16 lack tested SHA/sequence id; lead supplies event metadata `{tested_sha,base_sha,required_n,ordered_gate_row_hashes,covered_case_ids,evidence}` for this generation. This is declared evidence, not a new binding service or writer amendment.
Require required-N consecutive green, distinct run rows, tested revision/base and coverage. One-run row counts one; multi-run row needs consistent n/consecutiveGreen/seconds length. Red/incomplete/invalid coverage resets streak; changed code/base resets sequence. Later red invalidates earlier qualification. Pending merge remains gated, not done; landing must match tested revision or evidenced equivalent squash tree/base, otherwise rerun gate.
Case done needs delivered disposition (delivered/defect-found, legacy automated/merged-sanctioned-red), individual accepted outcome, generation membership and unit integration. Blocked/not-started/infra-stalled/needs-execution stay unresolved; un-automatable cancels only by explicit scope-removal decision. Green alone never delivers cases. Receipt mtime is receipt-proxy, never done. Covered delivered receipt plus gate can give gate-proxy completion only, excluded from observed cycles/throughput/accuracy; show proxy counts. Mission done additionally needs trunk landing and §5 child rules. Hook/sync order must not change populations.

### 6.9 Timeline derivation

`end=min(until,cutoff)`; cutoff defaults generated-at, until defaults cutoff, since defaults earliest explicit selected-plan observation_start. Require since<end. Replay all corrected readable history at<end before cohort filtering, including earlier versions; use UTC half-open `[since,end)`. Future effective events cannot change cutoff state; later corrections can change new reports, never archived JSON.
Created→planned; observed build dispatch→in_progress; first_commit gives separately labelled WIP proxy. Observed review request→in_review, explicit return→in_progress; approval alone is not done. Done/cancelled closes episode; reopened creates next episode. Block/unblock pairs use interval ids; overlapping intervals union, unmatched unblocks invalid, open block clipped at terminal/end and right-censored. No block records means unknown unless explicitly complete history proves zero. Invalid imported chains are quarantined/countable; CLI rejects them.
First qualifying completion counts once per stable item. Current state/recompletion replay separately. Never-terminal `work_item_age` = first build→end; reopened_age = latest valid reopen→end; history_age = first build→end including closed gaps, no comparator. Reopen_cycle_time = observed reopen→qualifying later completion; cancelled episodes excluded. Negative clocks exclude affected duration only (`clock-skew`), not throughput. Derived ancestor clocks remain separate.
`review_history` carries `{episode,from,through,complete,evidence_ids[]}`. First-pass requires complete first-review→first-completion history and final approval; no request is unknown absent explicit evidence of its start. Missing/partial→review_rounds null, known returns a lower bound. First_pass_rate = complete approved histories with zero returns / complete approved histories. Print reviewed (≥1 result), eligible (complete approved), done, unknown/partial; fix activity only rework proxy.
Completion cohort drives first-delivery duration/quality/accuracy; creation cohort drives current cancelled_share; WIP/age is state immediately before end. Carried-in starts/blocks count even with no new creations. Reopen samples use later completions within window, distinct from first-delivery cohort. Every intersecting UTC ISO week appears; whole iff Monday≥since, next Monday≤end and full declared coverage. Partial+whole completions conserve cohort size; aggregation uses common covered interval or separate per-plan velocity. Declared coverage does not prove complete capture.

### 6.10 Metrics

Compute before rounding; floors D10, below floor show samples/min–max/n. Separate level/plan/class/factory/mission/basis; role/model only when known. No invented mixed-role allocation.

| Group | Metric | Definition / denominator / caveat |
|---|---|---|
| Flow Time | cycle_time / parent elapsed | first build→first completion / child-derived parent boundaries (§5); never pool |
| | commit_to_done / lead_time | first commit→done only when dispatch missing / created→done, “plan-tracked, not idea-to-done” |
| | time_to_merge / time_in_review | PR open→merge / observed first review request→first completion; partial request unknown |
| | time_blocked | union clipped block intervals; complete history or censored observed lower bound |
| | work_item_age / reopened_age / history_age / reopen_cycle_time | separate clocks/populations §6.9 |
| | scope_to_done | mission declaration→observed landing, scope proxy only |
| Throughput | throughput / velocity | first completions by UTC week / median ≥3 whole covered weeks |
| | wip / mission_turnaround / cadence | current active/review plus blocked overlay / §5 predecessor gap / grouping of throughput, velocity, turnaround |
| Quality | review_rounds / first_pass_rate / rework_proxy | §6.9 completeness denominators; fix dispatch and address-review commit counts separate |
| | cancelled_share / reopen_count / unattributed_share | cancelled in creation cohort / reopen occurrences in window / unresolved admitted dispatches ÷ admitted dispatches, dedup host/session/agent |
| | coverage | event/basis/review/block completeness, conflicts, unknowns and exclusions |
| Estimates | work_ratio / MdMRE / PRED(25) / MAE / hit_rate | §6.4 fixed actuals and exclusions; per-case ratios are analysis pointers |
| | schedule_variance / calibration | parent range deviation with scope changes / observed cycle reference snapshots by factory/level/class/episode kind |
| Cost | active_min / cost_usd | quoted direct/loaded/batch totals with allocation/freshness/window labels (§6.12) |

Retain genuine 30-second cycles/reviews and confirmed zero block time. Lead_time alone is excluded as retrospective-plan-proxy when same source commit contains creation/completion **and** elapsed≤profile.zeroDurationSec; duration alone is insufficient. Calibration contains only valid observed cycles, sample window and event references. Separate first episodes (no prior cancellation/reopen) from reopen episodes, include distinct-item count and prior terminal kind. Age P85 needs ≥7 compatible factory/level/class/basis/episode samples; no reopen reference→`not-comparable`, never first-cycle fallback. No Little's Law line.

### 6.11 Report envelope and formats

JSON pins generated_at/cutoff/requested/effective window, git SHA/refs/is_working_tree, plan/profile hashes, source file path/hash, schema/adapter versions, observation_start, whole_week_keys, policy and baselines (null default). Hash the buffers actually read; this identifies read bytes without claiming multi-file consistency. Metrics carry unit/start/finish/basis/population, numerator/denominator/n, eligible/unknown/excluded counts and ledger path:line/import hash. No transaction inventory or byte-range locators.
Markdown default, JSON assessor export, self-contained HTML (own CSS). `--from-json` re-renders archived data/metadata without recomputation or JSON rewrite. `--calibrate` writes reference snapshot, then refreshes index from readable snapshots, independently; missing/malformed entries counted. Select latest compatible by recorded timestamp/id, not filesystem order. Profile `{capturePrompts:false,zeroDurationSec:60,minWholeWeeks:3,baselines:{cycle_time_task_h:null,throughput_task_per_week:null,first_pass_rate:null,hit_rate:null},tokenomics:"auto"}`; explicit cost path may override discovery.
Coverage prints §8 caveats plus observed counts, including zero when checked and unknown when not observable. Do not claim an undetected lost update count of zero. Each active accuracy figure carries `window: unverified`; quoted tokenomics rows retain tokens-only/PROVISIONAL/DRIFT/allocation and foldedFromLive **if present**, otherwise folding provenance unknown. Label UTC/local-week divergence when comparing with tokenomics (§16). No `byPerson`.

### 6.12 Join to tokenomics

Self-contained reader quotes existing batch/case `cost.json` only. Each import supplies generation/mission, source path, generatedAt and exact injective case→item map; saved bytes/hash go in delivery imports and observation metadata. One selected export per mission/cutoff: later generatedAt replaces earlier, never adds; conflicting equal-time exports excluded/countable. Export after cutoff excluded unless explicitly imported as a labelled historical correction. No general binding store, wrapper or change to tokenomics export API.
Read bytes once, hash what was read, skip malformed input with count. This does **not** prove atomic publication, coherent upstream inputs or freshness: print `snapshot: non-atomic`, `provenance: unverified`, `freshness: unknown` unless known stale from available evidence. Missing/ambiguous generation or missing aggregate yields no attributed cost and a coverage reason; never infer generation from a reused case id alone.
Quote cases[].direct and loaded activeMin/costUsd side by side, loaded labelled allocation; quote totals separately, never sum direct+loaded or batch+cases. Direct may itself be cluster allocation (§16); preserve sources/liveNote/shared-session notes, records.gateDrift/outcomeDrift, stats.note and coverage. Missing dollar is null/tokens-only. No raw usage/live/final/resumed folding, clipping, redistribution, new dollar computation or feature-task aggregate.
Accuracy follows §6.4 on published figures with valid generation, actual and timely acceptance; known PROVISIONAL/DRIFT/stale/unattributed values are excluded and counted. Unknown freshness/provenance/window remains visibly qualified, not silently upgraded or excluded for lacking a new manifest. Parent/shared contributions can lie outside declaration→landing: window containment is not proven, always `window: unverified` with `window-unverified` comparison count. Parent 5→50 extra minutes may change a batch total 55→100 while case direct stays 50; quote unchanged, allow only labelled published-total comparison, never claim measured in-window accuracy. No accounting proof or attestation is required.

## 7. Entry points and dependencies

| Ask | Entry / needs |
|---|---|
| Register / record / report | plan/event/status/report; skill alone, declared evidence |
| Associate dispatch / PR | session set / plan pr; host session / repository and PR number |
| Fill history / automation | backfill (git, optional gh) / sync (local records plus generation map) |
| Enable / diagnose / remove | owned install-hooks.mjs (Claude only) / doctor / --remove |

## 8. Guarantees and Not guaranteed

README repeats §2 and the table below. Guarantee = honest derivation from readable evidence, not durability, authenticity or complete capture. Data stays local except opted-in telemetry git sync and optional PR reads; no uploads/dashboard. Every limitation is printed where relevant; a capability caveat is unconditional, a detected incident count is derived, and unavailable counts are unknown.

| Not guaranteed | Required caveat / count |
|---|---|
| Atomic registration, multi-event correction or plan/index update | Detectable `registration-gaps`/`unregistered` counts; `partial-update: possible`, undetectable losses unknown; `writes: non-transactional` |
| Crash durability / torn-tail recovery / exact-once writes | `malformed-lines`, duplicate count; `capture-loss: possible` (loss total unknown) |
| Concurrent shared-file preservation or causal merge resolution | `shared-files: last-writer-wins`; overwritten-update total unknown; `git-conflicts` surfaced by doctor, unresolved sources excluded |
| Cross-writer locks, subprocess fencing or reboot recovery | `concurrency: best-effort`, `sync: best-effort`, lock skips, `sync-pending`; doctor reports interrupted git state, manual repair required |
| Producer compatibility / coherent cost snapshot / complete provenance | `producer-compatibility: unverified`, unknown schemas; `snapshot: non-atomic`, `provenance: unverified`, `freshness: unknown` or known stale |
| Accounting-window containment, including parent/shared minutes | `window: unverified`, `window-unverified` count on published-minute accuracy; keep allocation labels |
| General association history or automatic identity recovery | `unattributed`, `ambiguous-generation`, `association-history: unavailable`; no guessed joins |
| Custom estimate actuals or authenticated human acceptance | fixed-definition note (§6.4); `acceptance: unauthenticated`, `unaccepted`, `late-accepted`, unit/level exclusions |
| Revision-fork repair, atomic withdrawal/reinstatement | `CONFLICT`, `invalid-chain`, `partial-update`; new ordinary correction only |
| Host completeness, full reviews/blocks, origin or cross-team comparability | capture/review/block unknown counts; unsupported hosts explicit; hashes are byte identifiers only |

## 9. Hand-offs

### 9.1 feature-development
Tech-lead adds canonical ranged proposals beside existing Complexity; human acceptance is the pair on each estimate. PM registers, sets session guard/task PR, names qualified ids in dispatches and records merge/cancel/block/reopen plus review history. Status Report gains `### Delivery`. Scout asks once for opt-in. Existing template/merge anchors are §16.
### 9.2 test-automation
Lead registers campaign/run/tree and passes generation/source/item map on each sync; prompts retain full-message qualified stage ids. Supply gate sequence/tested/base/case evidence before close, sync after landing; pending merge stays open. Scoping may consult compatible calibration references, keeping elapsed/active units separate; lead/scout load on demand.
### 9.3 manual-qa
No native wiring; RUN document can carry canonical block for importer. No automatic run-field inference or unrelated dispatch admission.
### 9.4 AI-maturity assessor
JSON exposes Flow Time/Throughput/Quality, n, evidence, denominators, baselines and caveats. Team writes dated review/decision; tracker saves references, never asserts governance from absent reviews.

## 10. Files and manifests

`skills/delivery-metrics/`: SKILL.md, README.md; `scripts/delivery.mjs`, `install-hooks.mjs`; `scripts/lib/{paths,schema,storage,events,plan,plan-markdown,resolve,timeline,metrics,report,git-backfill,automation-sync,tokenomics-join}.mjs`; `hooks/dispatch-hook.mjs`, each with sibling test. Storage is append/read plus best-effort sync, not a transaction subsystem.
Templates: delivery-plan JSON/block Markdown, profile JSON. References: event-model, metrics, plan-block, calibration, host-capabilities. Fixtures: security-testing fixed git/golden; automation scorer/scopes/receipts/gate sequences; Claude Agent/Workflow/concurrent/main/worktree; tokenomics existing exports with allocation/live/stale/malformed cases. No general bindings template or producer-attestation fixtures.
Distribution: orphan skills.json, both factory skills[], on-demand roles/instructions; regenerate marketplaces via `npm run gen:marketplaces`, decide hand-curated Claude entry at M1. Verbatim copies add duplicate GROUPS; transformations record source/hash. No compatibility migration of tokenomics, scope, gate, fold, export or installer writers; only §13's three M-1 amendments.

## 11. Report structure

Envelope; Flow Time observed/derived/proxy; Throughput series/whole-week velocity/mission gaps; Quality complete/partial/unknown and rework; Estimates accepted/unaccepted/unestimated, exclusions and scope variance; optional Cost; Coverage & caveats; Open items with first/reopened/history age and comparator or not-comparable. Every speed/volume stratum carries quality denominators. Unknown allowed, blank forbidden; status is one-screen subset. Archived JSON preserves the caveats shown at generation.

## 12. Tests

Offline stdlib `node --test` with fixed clocks/temp dirs; fixtures pin source path/revision/hash, transformed versus verbatim status. Tests validate honest degradation rather than stronger storage promises.

| Group | Counterexample / expected result |
|---|---|
| Observations / D6 | earlier CLI correction beats git in both arrival orders, git retained; identical retry coalesces; unequal same revision or equal-rank semantic disagreement→CONFLICT with no lower fallback |
| Corrections | retract mistaken A then add B sequentially; interruption retains readable results with partial-update: possible (missing B is not necessarily detectable); old adapter retry stays withdrawn; dependent reopen invalid-chain until ordinary corrections restore valid history |
| Storage / sync | malformed tail skipped/count, including swallowed next append; no truncation/recovery; readable prior rows remain. Crash between plan/events/index yields gap/unknown. Shared-file last-writer-wins and unresolved git conflict caveats; offline next sync retries |
| Concurrency ceiling | optional mkdir lock busy/stale cases; no tokenomics participation needed; killed caller may leave child, doctor reports state and best-effort caveat, no fenced-writer assertion or boot-id prerequisite |
| Actual selection | created Mon 09:00, commit Wed 08:00, dispatch Wed 09:00, done Wed 11:00: lead 50 h, cycle 2 h; 1–3 h accepted Tue has ratio 1/hit 1. Remove dispatch: commit_to_done 3 h, accuracy missing-actual. Parent 4 h vs 2–6 gives ratio 1/hit 1, separate derived population |
| Published active minutes | direct 50, batch total 55 then 100 from parent work extending past landing: preserve totals and case value; window unverified/count on each comparison, no proof-based exclusion; no double-count. PROVISIONAL/DRIFT/known stale exclude, absent producer wrapper does not |
| Identity / rollup | concurrent TASK-001/reused TC-1 cannot cross-join; State/Log edits stable; injective re-cut conserves totals; cluster/solo, partial/all cancellation, missing child, scope reopen and overlap (§5) |
| Automation | both gate paths dedup; required 3 green/red/green incomplete, 3 greens pending merge not done, later red resets, changed SHA resets; receipt mtime never done, cluster never invents case start; hook/sync order invariant |
| Reviews / episodes | absent review unknown, partial lower bound, complete zero-return eligible; fix activity only proxy; 3 completions/2 reopens throughput 1; first/reopen P85 separate, n=6 no P85/n=7 eligible, history age visible |
| Estimates | missing acceptance pair unaccepted; late excluded; changed range new pair; unauthenticated label; source confidence/tier/probability preserved without inference; points/unit mismatch and zero denominators counted |
| Windows / validity | carried-in starts/blocks and no-creation window; exact Monday cutoff/future exclusion/common coverage/whole+partial conservation; percentile floors, real 30 s and confirmed zero block retained; retrospective lead exclusion requires same-commit evidence |
| Hooks / installer | real pinned Agent/Workflow payloads, same-role concurrent children, full-message ids, missing child/foreign role/unbound session/legacy missing type; main/worktree resolution; hook errors 0; Copilot unsupported; semantic remove preserves user edits |
| Backfill / reports | fixed golden (59 tasks/30 missions/33 first completions/11 rework proxies), cycle/review unknown, commit_to_done valid; pinned growth invariant, mapped squash PR with pagination, retry SKIP; hand-computed 12-item metrics, archived JSON re-render unchanged |
| Ignores / costs | inner/root check-ignore and disposable-index add -A protect transients; exact identity normalization/rename cases; no raw/live/final/resumed addition, missing/ambiguous generation refused; every §8 caveat rendered in Markdown/JSON/HTML |

Implementation gates: npm test; npm run validate (factories/marketplaces/externals/dupes); skills-ref validate skills/delivery-metrics; both factory installer smokes on Claude plus CLI installs on Copilot/Codex, offline external cache. These are future implementation gates, not claims that this spec-only edit ran them.

## 13. Plan

Re-cut on 2026-09-17 (v5.1, user decision): **M1 is Slice 1** — cycle time, velocity and estimate-vs-actual delta per task / mission / campaign, nothing else. Every contract in §6 still applies to what M1 ships; the parts M1 does not ship are deferred, not removed. M1 works without tokenomics; the Claude hook is inside M1 because without it task cycle time has no observed start.

| # | Milestone | Capability |
|---|---|---|
| M-1 | Small prerequisites | Docs/catalog refresh (orphan count), P-0/P-1 amendments to `bundles/SPEC.md`; SPIKE-1 (real Claude Agent/Workflow child-transcript, concurrent and main/worktree fixtures for `SubagentStop`). The three tokenomics one-liners (`estMin` key, dispatch `startedAt`, `work_item_level` vocabulary) move to M3 — nothing in Slice 1 reads tokenomics. |
| **M1 — Slice 1** | **Plan + estimates** | `plan register --from <plan.md\|.json>` reading the ```` ```json delivery-plan ```` block (§6.3): campaign → missions → tasks, stable `campaign_id`/`run_id`/version, `created`/`estimated`/`cancelled` delta events, estimate `{unit: h, low, high, tier, class, accepted_by, accepted_at}` (§6.4; `unaccepted` counted, excluded). Markdown importer (`#### TASK-NNN`, `**Complexity:**`, `Gn` groups) with `--dry-run`/`--yes`. |
| | **Actuals** | `event <ref> dispatched\|done\|cancelled [--sha] [--at] --id <token>` (§6.5); `backfill --git --head <sha>` deriving `created`, `first_commit`, `done` for the local-branch mode (§6.7; PR mode deferred); one opt-in Claude `SubagentStop` hook emitting `dispatched`/`dispatch_ended` with roster/session guard and id resolution (§6.6), `install-hooks.mjs --host claude [--local] [--remove] [--doctor]`. Storage per §6.1 (append-only per-user JSONL, advisory mkdir lock, best-effort sync, `malformed-lines` counted). Timeline per §6.9 restricted to `created → dispatched/first_commit → done/cancelled` (blocked/reopen/review transitions are accepted by the schema but not derived in M1 — counted as `deferred-events`). |
| | **Metrics** | `cycle_time` (task: first observed build dispatch → first `done`; mission/campaign: child-derived, labelled), `commit_to_done` when no dispatch, `lead_time`; `throughput` per UTC ISO week per level and `velocity` (≥3 whole weeks) (§6.9–6.10); estimate delta: per item actual vs `[low, high]` (inside/outside, `work_ratio` = actual ÷ midpoint), per level `MdMRE`, `PRED(25)`, `hit_rate`, per mission/campaign `schedule_variance` with scope added/removed (§6.4, §6.10). Coverage: dispatched/first-commit/done shares by source, unestimated/unaccepted counts, `malformed-lines`, `CONFLICT` count. |
| | **Output + wiring** | `status` (PM one-screen), `report [--json] [--since --until --cutoff]` markdown + JSON envelope (§6.11); SKILL.md/README, `skills.json`, both `factory.json`, marketplaces; tech-lead template block, PM merge-step call, scout opt-in (§9.1). Golden fixture from the security-testing dataset (§12). |
| M2 | Quality + episodes | `review_history`/`review_rounds`/`first_pass_rate`, `rework_observed`, `blocked`/`unblocked` intervals, `reopened` episodes and their separate ages/cycles, `work_item_age` vs P85, retraction/correction revisions, PR-mode backfill via `gh` and task↔PR association. |
| M3 | Automation + cost | test-automation `sync --automation` (generation-qualified imports, scorer estimates in `active_min`, scope/gate/receipt proxies, landing), the three tokenomics one-liners, cost quoting from existing exports with published-minute caveats (§6.12), calibration snapshots/index and playbook wiring (§9.2). |
| M4 | Presentation | self-contained HTML, `--from-json` re-render, `--calibrate`; no forecasting. (HTML + `--from-json` delivered in M1, 2026-09-17) |

Each milestone includes its §12 tests and §17 acceptance criteria; AC rows that name M2+ capabilities (review completeness, reopen, automation, cost) are asserted at their milestone, not at M1. This edit changes only §13 and the header; cited amendments remain proposed implementation work.

## 14. Open questions

SPIKE-1 must establish Claude child-path/legacy fallback and linked-worktree behavior; unsupported shapes remain unknown. Hand-curated Claude marketplace entry is a maintainer decision at M1. Copilot automatic capture requires a separate future adapter spec; registration names alone prove no payload capability.

## 15. Consistency check against §2

Storage D4/D19/D22 → §6.1/6.3/§8 → M1/2 → AC-11/16: best-effort and visible gaps. Source identity/D6 → §6.2 → AC-4/17: retain evidence, quarantine disagreement. Fixed estimates → §6.4/6.12 → AC-10/14: published values with explicit limits. Honest hierarchy/gates/reviews/episodes/windows → §5/6.8–6.10 → AC-8/12/13/15/18. All caveats travel through §6.11/§11 exports. Any sentence demanding stronger storage/provenance guarantees than §2 is a defect; historical resolutions in §19.1–19.3 are superseded where §19.4 says so.

## 16. Repo facts relied on that the reviewer should re-verify

| Verified source (line numbers in this worktree unless ref named) | Existing fact / implication |
|---|---|
| `TOK/hooks/telemetry-capture.mjs:75-94,120-123,1464-1491`; `TOK/scripts/team-report.mjs:48-73` | username/OS/email slug; one appendFileSync per line; best-effort whole-submodule git sync; readable-session latest-wins dedup, not transactions |
| `feat/security-testing-bundle-spec:bundles/security-testing/skills/security-evidence/scripts/lib/fsx.mjs:12-24,115,128-151` | mkdir lock with 60 s stale rule; documented live-holder races, not process fencing (file absent from this worktree) |
| `TOK/hooks/telemetry-capture.mjs:187,328-333,438-452,608-620,1339,1359-1367` | available startTs but live line ends only; child metadata/full-message stage derivation; repo via argument/env/cwd; parent transcript fallback. Delivery worktree/child-path support is proposed |
| `TOK/scripts/install-hooks.mjs:145-158,305-311,517-532` | Copilot registrations do not prove payload; current inner ignores omit delivery transients; owned ignore rewriting is not byte-preserving |
| `TOK/scripts/work-scope.mjs:46-102`; `TOK/scripts/build-tokenomics-export.mjs:165-180` | mutable scope/outcomes and export upserts; no coordination required by delivery |
| `TOK/scripts/batch-cost.mjs:439-459,511-568,583-586,617-707,724-745`; `TOK/hooks/telemetry-capture.mjs:752-754` | generation heuristic, parent/shared/cluster allocation, direct/loaded/totals and caveats; live file reads and ordinary cost.json write do not prove containment/coherence |
| `TOK/scripts/batch-cost.mjs:344`; `TOK/templates/factory-profile.template.json:8`; `TOK/scripts/build-tokenomics-export.mjs:66,105` | missing scorer estMin key; batch template/feature defaults need the agreed vocabulary amendment |
| `TOK/scripts/team-report.mjs:106-114`; `TOK/hooks/telemetry-capture.mjs:489` | local-calendar weeks; foldedFromLive is a session-line flag, not guaranteed in cost export |
| `TAW/scripts/gate/gate-case.mjs:191-221`; `TAW/references/orchestration-playbook.md:200-210`; `TAW/references/campaign-planning.md:254-280` | two gate paths/fields without tested SHA; separate N calls then trunk landing; approved Plan distinct from mutable State/Log |
| `AS/scripts/score-cases.mjs:381-388,466-472` | numeric bounds/estMin and descriptive confidence; neither human acceptance nor numeric coverage probability |
| `bundles/SPEC.md:291-304`; `skills.json:246-257`; both factories' `factory.json` (`feature-development:166-169`, `test-automation:11-14`) | roster/legacy/shared telemetry policy and orphan registration/attachment precedents; P-0/P-1 remain necessary |
| `bundles/feature-development/agents/tech-lead/AGENT.md:181-201`; `bundles/feature-development/agents/project-manager/AGENT.md:95`; `package.json:5-19` | task template, squash/delete-branch command, Node/ESM and test/validation/generation commands |

## 17. Acceptance criteria

- **AC-1** Implementation passes npm test/validate, marketplace/dupe and skills-ref gates; §4 frontmatter, no tools key.
- **AC-2** Both factories install skill without hooks; Claude install/remove preserves unrelated/later edits; actual inner staging protects all delivery transients.
- **AC-3** Fixed golden: 59 tasks, 30 missions, 33 first completions, 11 rework-proxy items; review/cycle unknown, commit_to_done retained; later branch growth unchanged.
- **AC-4** Concurrent Claude children correlate independently; retry SKIP; earlier CLI correction wins both arrival orders while retaining git evidence.
- **AC-5** No plan/foreign role/unbound session/malformed payload/unreadable child cannot generate attributed delivery; hooks exit 0; missing type relaxes role only; Copilot unsupported.
- **AC-6** No byPerson, mean duration headline, below-floor percentile, invented baseline, forecast or Little's Law comparison; quality denominators accompany speed/volume.
- **AC-7** Archived JSON re-renders same content/metadata/caveats without recomputation or rewrite.
- **AC-8** Automation writes delivery artifacts only; both gate paths dedup; required-N sequence/later-red reset and landing precede mission done; proxy/cluster clocks never become measured case cycles or throughput.
- **AC-9** Hand-computed metrics and CLI error paths/codes pass; §8 labels and counts present in every report format.
- **AC-10** Fixed actual mapping selects 2 h cycle, not 50 h lead; 1–3 h accepted before dispatch gives ratio 1/hit 1. No dispatch gives accuracy unknown despite commit proxy. Parent 4 h vs 2–6 separate. Acceptance pair absent→unaccepted, late→excluded, recorded→unauthenticated; zeros/points/unit/tier/probability cases counted.
- **AC-11** Malformed/torn line skipped and counted as malformed-lines without repair/truncation; swallowed next append is not rescued or claimed present. Interrupted plan/events/index writes show gaps/unknown and non-transactional caveat; retries dedup readable records only.
- **AC-12** Mixed hierarchy, partial/all cancellation, missing child, scope reopen and overlapping missions follow §5; parent/proxy populations separate.
- **AC-13** Missing review gives null first-pass; valid sub-minute/confirmed zero block survive; retrospective lead requires evidence; calibration excludes proxies.
- **AC-14** Existing cost exports import without producer wrapper; read-byte hashes retained, snapshot/provenance/freshness limits printed. Direct/loaded/batch values never added together; tokens-only/PROVISIONAL/DRIFT/allocation/folding availability preserved. Parent/shared out-of-window work leaves quotes unchanged with window-unverified count on accuracy; no raw folding/recomputation/containment claim.
- **AC-15** Half-open historical replay includes prior starts/blocks, excludes future state, supports no-creation windows, conserves whole/partial counts and stable identities across re-cuts.
- **AC-16** Delivery works with unmodified tokenomics writers; best-effort sync retries after offline failure, shared-file overwrites print last-writer-wins limitation, doctor surfaces unresolved git conflicts/locks and interrupted state without resolving them. Optional 60 s stale lock promises no process exclusion; unavailable lost-update counts stay unknown. Identity compatibility fixtures pass.
- **AC-17** Ordinary correction/retracted revision and lower-source reconsideration work; same-number conflicting revisions print CONFLICT/exclude; equal-rank disagreement has no fallback; dependent invalid chain counted; wrong-item repair explicitly non-atomic.
- **AC-18** First-open/reopened ages use separate compatible floors/distributions; repeated reopen retains history_age/reopen count and throughput 1; reopen calibration never falls back to first-cycle.

## 18. Not in scope / parking lot

DORA, flow efficiency, benefit ROI, per-person/per-agent productivity, dashboards/uploads/OTel, story-point velocity, time-in-status heatmaps. Manual-qa native wiring and automatic run inference; Cursor/Kiro/Codex hooks; Stop gate/merge webhooks. Copilot automatic delivery capture and live pending starts (v1 F6) need separately tested host adapters. Raw tokenomics usage/live folding and feature-task attribution (v1 F13) remain parked. Little's Law (v1 F18) has no report line; forecasting/Monte Carlo (v1 F22) needs its own future scope. Removed durability/provenance machinery is not deferred into these four milestones.

## 19. Review rounds

Artifacts: `docs/superpowers/notes/2026-09-16-delivery-metrics-spec-vN-adversarial-review-codex.md`. Verdicts: resolved / resolved by contract / resolved by narrowing / rejected (reason).

### 19.1 v1 findings → v2

23 addressed: 6 blockers, 16 majors, 1 minor; 23 resolved, 0 rejected. Four findings use narrowing; F6 parks two capture capabilities. Architecture retained; promise/decision changes marked below.

| F | Resolution | Where |
|---|---|---|
| F1 | **resolved by contract** — observation/occurrence split and deterministic corrections; changes §2 and §3 D4–D6. | §2–3, §6.1–6.2, §6.7–6.9, §10, §12, §15, §17 |
| F2 | **resolved by contract** — scope/cluster proxies cannot become measured case cycles; changes §3 D6–D7,D18. | §3, §5, §6.6, §6.8–6.10, §12, §15, §17 |
| F3 | **resolved by contract** — both gate paths, bound required-N proof/tested revision, landing and case eligibility. | §5, §6.8–6.10, §9.2, §10, §12–13, §15, §17 |
| F4 | **resolved by contract** — stable run/item identities, migration and bound generation joins; changes §3 D18–D20. | §3, §5, §6.2–6.3, §6.6–6.12, §12, §15, §17 |
| F5 | **resolved by contract** — complete observed reviews only, rework proxies/unknown denominators; changes §2 backfill promise and §3 D14. | §2–3, §6.2, §6.6–6.11, §11–12, §15, §17 |
| F6 | **resolved by narrowing** — park Copilot capture/live markers, pin Claude correlation fixtures; changes §2 and §3 D15,D17. | §2–3, §6.1, §6.6, §7, §10, §12–15, §17–18 |
| F7 | **resolved** — owned telemetry inner ignore upgrade and actual staging checks; changes §3 D3. | §3, §6.1, §6.6, §12–13, §16–17 |
| F8 | **resolved** — full-first-message stage derivation and tested child-path fallback; changes §3 D18. | §3, §6.6, §9, §12–14, §16–17 |
| F9 | **resolved by contract** — participating roster union plus session binding and legacy rule; changes §3 D16. | §3, §6.3, §6.6, §9, §12–13, §15, §17, §20 |
| F10 | **resolved by contract** — half-open UTC windows, full replay/cohorts and week conservation; clarifies §3 D11,D21. | §3, §6.5, §6.9–6.11, §12, §15, §17 |
| F11 | **resolved by contract** — occurrence/episode/retry ids and repeat reopen/block validation; changes §3 D5,D7. | §3, §6.2, §6.5, §6.9–6.10, §12, §15, §17 |
| F12 | **resolved by contract** — strict hierarchy, partial/missing-child rollups, scope reopen and mission ordering. | §5, §6.3, §6.8–6.10, §12, §15, §17 |
| F13 | **resolved by narrowing** — pinned batch/case exports only, raw/task-cost reader parked; changes §2 and §3 D20. | §2–3, §6.12, §10, §12–13, §15–18 |
| F14 | **resolved by contract** — committed manifests/recovery/shared lock, active sync and conflict reconciliation; changes §3 D4,D19,D22. | §3, §6.1–6.3, §6.5–6.6, §10, §12–13, §15, §17 |
| F15 | **resolved by contract** — exact confidence preserved, explicit tier/probability/calibration provenance; changes §3 D9. | §3, §6.4, §6.8, §6.10, §9.2, §12, §15, §17 |
| F16 | **resolved by contract** — proposals distinct from named human acceptance/timely commitments; changes §2 and §3 D9. | §2–3, §6.3–6.4, §8–9, §12, §15, §17 |
| F17 | **resolved by contract** — per-metric validity, proven retrospective lead exclusion and valid zeros; changes §3 D12 and completes D10 percentile floors. | §3, §6.4, §6.9–6.10, §12, §15, §17 |
| F18 | **resolved by narrowing** — park invalid Little’s Law comparison; changes §2 exclusions. | §2, §6.10, §12, §15, §17–18 |
| F19 | **resolved by contract** — integration/epoch binding, lowercase aliases, mapped paginated PRs and fixed golden; changes §2 backfill promise. | §2, §6.3, §6.5, §6.7, §9.1, §10, §12, §15–17 |
| F20 | **resolved** — exact name/OS/email slug rule and rename/collision fixtures. | §6.1, §12, §16–17 |
| F21 | **resolved by contract** — semantic owned removal preserves later edits; changes §3 D15. | §3, §6.6, §12, §16–17 |
| F22 | **resolved by narrowing** — forecasting removed from milestone and parked with future requirements; changes §2 exclusions. | §2, §13, §15, §17–18 |
| F23 | **resolved** — corrected anchors; volatile tracked count removed in v3 (§19.2 F7); actual code distinguished from proposed worktree/host behavior. | Sources of truth, §6.6, §14, §16 |

### 19.2 v2 findings → v3

7 addressed: 0 blockers, 6 majors, 1 minor; 7 resolved, 0 rejected. No scope narrowing. Architecture retained; §2/§3 changes marked per finding. Finding ids in this subsection refer to the v2 review, not §19.1.

| F | Resolution | Where |
|---|---|---|
| F1 | **resolved by contract** — source-specific tombstone/reinstatement revisions, atomic wrong-item repair and dependent-chain quarantine; changes §2 and §3 D5. | §2–3, §6.2/6.5/6.9, §10, §12, §15, §17 |
| F2 | **resolved by contract** — coalesce equal semantic facts at the winning rank; quarantine disagreement without fallback until explicit repair; changes §2 and §3 D6. | §2–3, §6.2, §10, §12, §15, §17 |
| F3 | **resolved by contract** — fsynced byte intents, append-only torn-tail delimiting and record-level manifest publication/recovery. | §6.1, §10, §12, §15, §17 |
| F4 | **resolved by contract** — migrate all participating writers/readers, nonrecursive lock contexts, capability checks and immutable snapshot export/provenance. | §6.1/6.12, §10, §12–13, §15–17 |
| F5 | **resolved by contract** — accepted metric/version/start/finish binding fixes actual and timely-acceptance eligibility; changes §2 and §3 D9. | §2–3, §6.3–6.4/6.10–6.12, §10, §12, §15, §17 |
| F6 | **resolved by contract** — separate first/reopen age and completed-episode reference populations, retain history age; changes §2 and §3 D7. | §2–3, §6.9–6.11, §10–12, §15, §17 |
| F7 | **resolved** — remove volatile tracked-path count and correct round-1 resolution wording; historical add commands remain unknown. | Sources of truth, §19.1 F23 |

### 19.3 v3 findings → v4

2 addressed: 0 blockers, 2 majors, 0 minors; 2 resolved, 0 rejected. No scope narrowing; approved architecture, §2 promises and §3 decisions unchanged. Finding ids refer to the v3 review.

| F | Resolution | Where |
|---|---|---|
| F1 | **resolved by contract** — complete parent/dispatch/shared contribution manifest and containment proof; unknown/crossing bounds exclude accuracy while quoted totals remain; §2/§3 unchanged. | §6.4/6.12, §10, §12–13, §15–17 |
| F2 | **resolved by contract** — durable pre-spawn ownership, descendant-closure proof and exclusive interrupted-Git recovery before new writers; indeterminate ownership stays blocked; §2/§3 unchanged. | §6.1, §10, §12–13, §15–17 |

### 19.4 v4 proportionality pass → v5

Round 4 approved v4 (0 findings); this pass changes its guarantee ceiling, not that historical verdict. Thirteen mechanisms are replaced below; §19.1–19.3 describe historical resolutions, not current implementation requirements.

| Mechanism removed | Finding it answered | Replacement (limitation row / caveat / count) | Where |
|---|---|---|---|
| Immutable transaction manifests / atomic multi-file registration | v1 F14 plan-ledger gap | Non-transactional writes; registration-gaps/unregistered/partial-update | §2, §6.1/6.3, §8, AC-11 |
| Fsynced `.txn/` byte intents, byte-range locators and torn-tail recovery | v2 F3 interrupted append | One appendFileSync; malformed-lines skipped/count, capture-loss possible | §2, §6.1/6.11, §8, AC-11 |
| telemetry-lock-v1 and migration of tokenomics/scope/gate/fold writers | v2 F4 uncoordinated participants; v1 F14 | Local mkdir at most; concurrency best-effort, no producer changes beyond three M-1 amendments | §2–3, §6.1, §8, §10/13, AC-16 |
| Subprocess-lifetime/pre-spawn journals and descendant fencing | v3 F2 surviving Git child | sync best-effort; doctor reports interrupted git/lock state; no lifetime guarantee | §2, §6.1, §8, AC-16 |
| Boot-id/exclusive crash recovery and stopped-mutator proof | v3 F2 dead caller recovery | No automated recovery proof; manual git repair, sync-pending/unknown loss | §2, §6.1, §8, AC-16 |
| Capability registry / SYNC-INCOMPATIBLE | v2 F4 obsolete producer detection | producer-compatibility unverified; unknown schemas counted, no global pause | §2, §6.1/6.11, §8, AC-16 |
| Atomic cost bundle / source_manifest wrapper / inventory drift retry | v2 F4 coherent export provenance; v1 F13 | Read-byte hash only; snapshot non-atomic, provenance unverified, freshness unknown | §2, §6.12, §8, AC-14 |
| Per-contribution accounting-window/attestation manifest | v3 F1 parent/shared window gap | Published-minute comparison; window unverified and window-unverified count | §2, §6.4/6.12, §8, AC-10/14 |
| Parent-head DAG / plan reconcile --heads | v1 F14 shared mutable conflicts | Last-writer-wins shared files; git-conflicts surfaced by doctor, not resolved | §2–3, §6.1/6.5, §8, AC-16 |
| General plan bind service for branches/scopes/scoring/cost/history | v1 F4/F9/F19 identity/admission/PR joins | Only task↔PR and session↔plan; generation metadata supplied per import, unattributed/association-history unavailable | §2, §6.3/6.5–6.8/6.12, §8, AC-5/15 |
| Versioned actual_metric / actual-window in estimate digests | v2 F5 ambiguous actual boundaries | Unit/level fixes actual once; no custom actuals, missing-start/actual exclusions | §2–3, §6.4, §8, AC-10 |
| Digested/authenticated acceptance and separate human acceptance revisions | v1 F16 ownership; v2 F5 accepted boundary | One accepted_by/accepted_at pair; unaccepted excluded, acceptance unauthenticated | §2–3, §6.3/6.4, §8, AC-10 |
| Revision forks, tombstone/reinstatement controls, meta.resolves[] repair | v2 F1 retraction/F2 conflict; v1 F1 precedence | Ordinary higher correction/retracted revision; duplicate-number CONFLICT, invalid-chain/partial-update counts | §2–3, §6.2/6.5, §8, AC-17 |

Guarantee ceiling: tokenomics' own append-only per-user JSONL, one appendFileSync, latest-wins reading, best-effort git sync and visible caveats; a local mkdir lock at most, no stronger storage or provenance promise.

## 20. Planning amendments

| # | Amendment | Where |
|---|---|---|
| P-0 | Amend `bundles/SPEC.md:298-304` “one subfolder per factory” to include cross-factory concerns (`delivery/`), preserving shared telemetry D3. | M-1 |
| P-1 | Amend `bundles/SPEC.md:291-297` to allow participating-factory roster union for cross-factory hooks, retaining legacy missing-type rule and requiring plan/session binding; changes §3 D16, never substitutes plan-exists for admission. | M-1 |
