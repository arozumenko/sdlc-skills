# delivery-metrics — design spec (v4)

**Date:** 2026-09-16
**Skill:** `skills/delivery-metrics/` (new, orphan top-level; installed through factory `skills[]`)
**Branch:** feat/delivery-metrics-spec (worktree off `main`; spec only)
**Status:** v4 — round 3 `needs-changes` addressed: 2 resolved (0 blockers, 2 majors, 0 minors), 0 rejected; no scope narrowing; ready for round 4 (§19.3).
**Inputs:** research `docs/superpowers/notes/2026-09-16-delivery-metrics-research-0[1-8]-*.md`; reviews `docs/superpowers/notes/2026-09-16-delivery-metrics-spec-v1-adversarial-review-codex.md`, `docs/superpowers/notes/2026-09-16-delivery-metrics-spec-v2-adversarial-review-codex.md`, `docs/superpowers/notes/2026-09-16-delivery-metrics-spec-v3-adversarial-review-codex.md`; house style `docs/superpowers/specs/2026-09-14-security-testing-bundle-design.md` §17–§20.

**Source aliases.** `R01` = `docs/superpowers/notes/2026-09-16-delivery-metrics-research-01-tokenomics-internals.md`; `TOK` = `bundles/test-automation/skills/tokenomics`; `TAW` = `bundles/test-automation/skills/test-automation-workflow`; `AS` = `bundles/test-automation/skills/automation-scoping`; `R03` = `docs/superpowers/notes/2026-09-16-delivery-metrics-research-03-test-automation-estimates-and-receipts.md`; `R05` = `docs/superpowers/notes/2026-09-16-delivery-metrics-research-05-dm-kb-ai-maturity-delivery-performance.md`; `R06` = `docs/superpowers/notes/2026-09-16-delivery-metrics-research-06-industry-delivery-metrics.md`. Alias citations expand to these real files; proposed delivery schemas below are requirements, not existing repo fields.

**Sources of truth for repo claims.** `bundles/SPEC.md:291-304` requires roster admission and one shared telemetry submodule. `skills.json:246-257`, `bundles/feature-development/factory.json:166-169`, `bundles/test-automation/factory.json:11-14` establish orphan registration/attachment. `TOK/scripts/install-hooks.mjs:145-158` registers Copilot `sessionStart`, `sessionEnd`, `subagentStart`, `subagentStop`, `agentStop`; registration does not prove payload fields. `TOK/hooks/telemetry-capture.mjs:187,328-333,440-447,608-620,1359-1367` establishes transcript clocks, metadata, full-message label derivation and parent-transcript fallback. Its repo selection at `:1339` uses argument/environment/cwd, not a main-worktree walk. `TOK/scripts/install-hooks.mjs:305-311` does not ignore delivery transients; `TOK/hooks/telemetry-capture.mjs:1473` stages the entire submodule. `.gitignore:34` ignores `docs/superpowers/`; tracked state is established by `git ls-files docs/superpowers`, which does not prove historical add commands; no volatile path count is asserted. §16 provides the remaining anchors.

## 1. Purpose

A delivery performance tracker for the harness: the cadence-and-cycle-time sibling of `tokenomics`. It answers how long delivery took and how that compared with declared commitments, using an append-only event ledger keyed to campaign → mission → task → case across feature-development and test-automation. It derives flow, throughput, quality and estimate-accuracy figures from recorded evidence, labels proxies, and never generates estimates, dollars or synthetic counts. Reports serve a PM and the AI-maturity Performance Tracking instrument; a calibration table supplies measured reference ranges for a planner to consult, never writes estimates for them.

## 2. What the skill can and cannot promise

| Can promise (on records it owns or reads) | Cannot promise |
|---|---|
| Append-only source observations with occurrence identity, corrections/retractions, deterministic conflict quarantine, timestamp, provenance and raw factory outcome | Complete capture; absent evidence stays unknown with coverage |
| Durable Claude dispatch start/end when an admitted, bound child transcript is readable | Copilot automatic capture or live pending start markers in this release; starts before capture existed |
| `cycle_time`, `lead_time`, `commit_to_done`, `time_to_merge`, `time_in_review`, `time_blocked`, `work_item_age`, `reopened_age`, `reopen_cycle_time`, `throughput`, `velocity`, `wip`, `mission_turnaround`, review/first-pass metrics, cancellation/reopen/coverage, accuracy, schedule variance and calibration, each with population, unit, evidence and denominator | DORA, flow efficiency, benefit ROI, per-person/per-agent scores, forecasts or a Little’s Law comparison |
| Declared ranged estimates bound to a versioned actual metric/start/finish, with proposer, named human acceptance, timestamp, tier and immutable revisions | Treating unaccepted AI proposals as commitments or missing estimates as defaults |
| Quoted tokenomics batch/case `cost.json` values, generation-bound with snapshot provenance and allocation labels | Recomputing dollars/active minutes, folding raw live/session logs, feature-task cost attribution without an aggregate |
| Generation-bound git backfill for creation, first commit, rework proxies and completion; mapped PRs additionally supply observed reviews | Deriving dispatch, block or cancellation from git, or fix activity proving review failure |
| Reproducible archived JSON rendering, pinned source hashes/SHAs, cutoff and caveats | Uploads/dashboards; network use beyond opted-in telemetry git sync and optional `gh` backfill |

## 3. Decisions (locked)

| # | Decision |
|---|---|
| D1 | **Orphan** `skills/delivery-metrics/`; attach through both factories’ `skills[]`. Self-contained stdlib ESM; may read tokenomics artifacts but never import its code. |
| D2 | Canonical hierarchy campaign → mission → task → case; story is a tag. Mission = delivery increment, feature group/milestone or automation wave/flat batch (§5). |
| D3 | Records under `.agents/telemetry/delivery/` on the shared self-referential telemetry submodule/branch; never inside `automation/`. Owned inner/root ignore blocks protect transients, including upgrades. P-0 amends factory-only folder wording. |
| D4 | Store observations, derive transitions. Append-only `events-<user>.jsonl`; per-user files reduce conflicts, not a guarantee of conflict-free shared state (§6.1). |
| D5 | Closed vocabulary in §6.2; separate logical occurrence from source observation; immutable corrections/retractions and deterministic dedup, never discard another source at append time. |
| D6 | For the **same occurrence and clock basis**, select `cli > automation-sync > hook > git`. Equivalent top-ranked observations coalesce; unequal semantic facts at that rank quarantine the occurrence without lower-rank fallback (§6.2). Different occurrences survive; scope/gate/receipt proxies never compete with observed clocks. Unbound equivalence is unknown, not guessed. |
| D7 | Cycle time = first observed build dispatch → first qualifying completion. Reopen preserves first completion/throughput; current state replays separately. First-open age uses first-cycle P85; reopened age uses only reopen-to-recompletion P85 (§6.9–6.10). Block duration is interval union (§6.9). |
| D8 | Missing dispatch gives `commit_to_done`, never cycle time. PR open→merge is `time_to_merge`, labelled “PR open to merge — not story lead time, not cycle time.” |
| D9 | Estimates are declared ranged inputs, with an accepted versioned actual/start/finish binding and separate proposer/human acceptance. Original = first accepted revision; latest = latest accepted before its bound measured start/cutoff, within the same metric version. Units `h` / `active_min` never mix; midpoint ratios and band hit rates are descriptive (§6.4). |
| D10 | UTC ms ledger timestamps, seconds internally, hours (2 dp) in reports. Nearest-rank median when n≥5, P85 when n≥7, P90 when n≥10; always min–max and n. Never a mean duration headline. |
| D11 | UTC ISO weeks; zero-filled through effective end, partials flagged. Velocity = median whole-week throughput, minimum 3 whole weeks, else null with derived caveat. |
| D12 | No blanket short-duration exclusion. Validate each metric; retain real sub-minute work and confirmed zero blocked time. Only proven same-commit retrospective lead-time proxies are excluded (§6.10). |
| D13 | Segment by level, class, role, model, factory and mission; no `byPerson` or per-agent leaderboard. User attribution is storage mechanics. |
| D14 | Every speed/volume stratum includes quality evidence and its reviewed/eligible/done denominators, or explicit unknown; missing review cannot imply success. |
| D15 | Hooks opt-in through owned `_delivery` installer, `--remove`, `--doctor`, `--local`, `--host claude`. Semantic owned-entry removal preserves later user edits. Installing the skill never enables capture. |
| D16 | Hook admission requires open plan, role membership in its participating factory roster union, and session/plan binding. Legacy missing type relaxes only the role test. P-1 records the scoped cross-factory rule. |
| D17 | One async Claude `SubagentStop` reads correlated child transcript start/end. Missing evidence stays unknown. Copilot capture and live start markers parked (§18); CLI/git remain cross-host. No SessionStart injection or Stop gate. |
| D18 | Resolve within bound generation: metadata description, full-first-message stage label, bound branch alias; ambiguous ids → unattributed. Cluster dispatch starts a task, not automatically each case (§6.6). |
| D19 | Canonical fenced `json delivery-plan`; markdown importer requires dry-run review. Stable run/item identities, explicit version migration and recoverable transactional registration (§6.3). |
| D20 | Publish generation-qualified `catalogue[]` in plan views; task-cost consumption is future work. Current cost adapter quotes existing batch/case exports only (§6.12). |
| D21 | CLI exits: 0 success, 1 internal error, 2 invalid input/identity/conflict, 3 not measurable with explanation. Hook failures always exit 0 and appear in doctor diagnostics. |
| D22 | Calibration = immutable measured reference snapshot, never an estimate writer. Plan views and calibration index are rebuildable from committed transactions. |
| D23 | Tests beside scripts, installed; fixtures under `fixtures/`. Verbatim copied formats get duplicate checks; transformations record their provenance (§12). |

## 4. Placement and roles

| Where | What |
|---|---|
| `skills/delivery-metrics/` | SKILL.md, README.md, scripts/lib, hooks, templates, references, fixtures (§10) |
| `skills.json` | `{id: "delivery-metrics", monorepo: "sdlc-skills", name: "delivery-metrics", description: …}` |
| Both factory `skills[]` | Add `delivery-metrics` |
| `skills-on-demand:` | feature-development PM, tech-lead, scout; test-automation lead and scout; never standing `skills:` |
| Instructions/playbook | Explicit registration, bindings, transitions and reporting moments (§9) |
| Scout | Ask once whether to enable delivery capture; yes runs installer, seed report records choice |

Frontmatter: `name: delivery-metrics`, trigger-oriented `description` ≤1024 chars, `license: Apache-2.0`, quoted `compatibility` ≤500 chars, `metadata.authors`, `metadata.version: "0.1.0"`. No `tools:` key or extra keys. Installing through any host supplies CLI capability; only Claude automatic capture is specified here.

## 5. Vocabulary and work-item hierarchy

| Level | feature-development | test-automation | manual-qa (unwired) |
|---|---|---|---|
| campaign | spec/backlog under stable campaign run | campaign card’s approved plan | — |
| mission | `Gn` group or `Mn` milestone, declared by plan | wave or flat batch | run |
| task | `TASK-NNN`, dispatch/review/integration unit | cluster or solo build unit | — |
| case | — (acceptance criteria are not items) | TMS id, opaque | TC |
| story tag | `US-NNN` | — | — |

**Identity.** Explicit stable `campaign_id` and `run_id` allocated once; rerun gets a new run. `plan_id = <campaign_id>/<run_id>/<version>`. Card State/Log edits never mint identities; hash only canonical plan JSON (sorted object keys, original array order) for change detection. Each item has immutable `item_id`, display `ref`, `level`, `parent_item_id`, generation and validity interval. Full ref = `plan_id:ref`; case ref = `<mission>/<task>/<caseId>`, with TMS `case_id` separately preserved. Bare ids require uniqueness within a bound plan/mission, not merely one open plan.

Version registration declares `supersedes` and an injective old→new item mapping. Unchanged work keeps stable ids/history; removed work remains tombstones. Splits/merges create new identities with lineage, never copied completions. A recut claiming existing work without mapping fails `MIGRATION-REQUIRED`. Reports across versions union stable ids once; independent reruns are distinct. Git/scope/sizing/cost joins require explicit generation and epoch binding. Concurrent `TASK-001` plans or reused `TC-1` alone cannot be joined.

**Parentage.** Exactly one parent per version; no cycles. Campaign→mission→task→case; feature tasks may be leaves. Automation clusters are tasks containing their cases; solo cases get one-case tasks, never cases directly under waves. Membership, role/class and parent changes are effective-dated; historical metrics use the version at their endpoint.

**Rollups.** Container start = earliest eligible descendant build start, labelled `derived-child-start`. A cluster task dispatch is observed task start, not per-case start. Container completion requires every required child terminal, at least one delivered child, and the container’s integration boundary evidenced. Completion time = latest child terminal/integration time, not earliest child done. Cancelled children produce `partial-cancelled` with counts; all-cancelled container is cancelled, never delivered. Missing/unknown child keeps parent open. Missions need landing to bound base; campaign requires all missions terminal. Explicit parent done cannot hide unfinished children (`PARENT-INCOMPLETE`). Feature task done is task integration; automation task done is unit integration plus terminal case dispositions, distinct from mission landing.

Child reopen or scope addition reopens ancestors at its effective time; preserve their first completion, retain later episodes for state/schedule reporting. Mission ordering uses explicit `sequence` and optional `predecessor`, never inferred array adjacency for concurrent missions. Turnaround = successor start − predecessor last completion before that start. If predecessor remains open or overlaps, emit null gap plus overlap duration when measurable, never a negative turnaround.

Example: W has cluster K(A,B) and solo S(C). K starts 09:00, S 10:00; A/B accepted and K integrated at 11:00; C blocked. W/campaign remain open, mission throughput 0. C accepted and S integrated 12:00, W lands 13:00: W completes 13:00, child-derived elapsed 4 h. Case cycles stay unknown without individual starts. If C instead explicitly cancels and W lands, W is partial-cancelled, 2 delivered/3 registered. A second unfinished wave keeps campaign schedule variance null.

Tokenomics export vocabulary alignment remains planned: `work_item_level` should use campaign/mission/task/case; `batch → mission`, `feature → task` (§13). “Batch”, “group” and “board” are not additional levels; cadence names only the metric group in §6.10.

## 6. Contracts

### 6.1 Records and paths

Proposed paths under `.agents/telemetry/delivery/`:

| Path | Contract |
|---|---|
| `events-<user>.jsonl` | append-only observations with transaction id |
| `transactions/<uuid>.json` | immutable committed manifest: parent heads, full plan/profile changes, observation ids/revisions/hashes and replayable record locators (byte ranges at publication) |
| `plans/<encoded-plan-id>.json` | atomic rebuildable catalogue/version view |
| `profile.json` | team-owned configuration updated transactionally |
| `calibration/<date>-<uuid>.json`, `calibration-log.md` | immutable snapshot plus rebuildable index |
| `imports/<sha256>.json` | immutable source snapshots for adapter evidence |
| `reports/`, `.pending-*`, `.lock/`, `.txn/` | transients; never staged |

Encode path segments reversibly, percent-encoding `/` and `%`; do not replace slash with ambiguous underscores. `<user>` matches `TOK/hooks/telemetry-capture.mjs:75-94`: git `user.name`, else `os.userInfo().username`, else email local-part, else `unknown`; lowercase, replace runs of non-`[a-z0-9]` with `-`, trim edge hyphens, empty→`unknown`. Read all user files; identity changes do not duplicate observations. Slug collisions are possible attribution collisions, not observation-identity collisions.

Install owned `# >>> delivery-metrics` / `# <<< delivery-metrics` blocks in the **telemetry root** `.gitignore`: `/delivery/.pending-*`, `/delivery/.lock/`, `/delivery/.txn/`, `/delivery/reports/`; main-checkout equivalents use `.agents/telemetry/` prefix. Upgrade existing tokenomics installations without replacing their rules. Main-root rules do not protect submodule content; current inner globs cover only live/scopes (`TOK/scripts/install-hooks.mjs:305-311`). Doctor must use `git check-ignore` in the actual owning repo and a disposable index staging check. Remove transient tracked entries from the index only through a surfaced repair, never assume ignores untrack them.

**Transaction protocol.** All participating writers, snapshot readers and shared sync acquire one telemetry-root lock in its canonical git metadata directory; plain-dir fallback uses delivery `.lock/`. Resolve linked worktrees to the same telemetry owner. Owner = machine id, boot id, pid/process-start identity, nonce, acquisition time and heartbeat. Never reclaim merely because 60 s elapsed: caller death alone is insufficient. A dead same-machine owner permits exclusive recovery only after the subprocess obligations below are discharged; live/foreign/indeterminate ownership yields `LOCK-BUSY`. PID reuse never establishes death or authority. Acquire before read/dedup/diff/revision allocation; release after durable publication and view rebuild (snapshot computation may use the explicit release/revalidate phases below). Retry token + input digest identifies registration; different input under the same token fails `ID-CONFLICT`.

1. Recover first. Write `.txn/<uuid>/` intent containing parent heads, full snapshots, retry digest, ordered exact UTF-8 record bytes including LF, ids/revisions/hashes, target paths, original file lengths/prefix hashes and expected offsets. Fsync intent/files and its directory **before** any append. Serialize transactions; no later writer runs until recovery completes.
2. Append records, fsync each target. Only LF-terminated, strictly valid UTF-8/JSON, schema-valid records count. Inspect from the last complete LF, preserving all earlier bytes. A complete expected JSON record missing only LF gets LF and fsync. A partial UTF-8/JSON tail must match the intent's expected prefix: durably record its byte range/hash in the intent's recovery log, append LF to delimit it, fsync, then append the full missing record. The malformed fragment stays counted as `torn-tail`, never becomes an observation. Recovery is idempotent at every byte boundary, including interruption while delimiting or reappending; complete matching records are reused. Unknown tails or mismatched committed bytes halt with `CONFLICT`, never truncate, concatenate replacement JSON onto a prefix, or silently skip damage.
3. Reread records and verify strict parsing, schema, txn/id/revision, payload hashes and prior committed ranges. Manifest references only verified complete record ranges, never substring/hash presence. Fsync the temporary manifest, atomically rename it into `transactions/`, fsync that directory, then atomically rebuild views. Readers ignore records without a valid committed manifest. A committed manifest with missing/damaged records is `CONFLICT`; it is not an incomplete transaction to repair silently. Before commit, retry resumes the intent; after commit, retry rebuilds views. Carry fragment hashes/ranges in the committed manifest for diagnostics; keep local recovery evidence until manifest verification succeeds. Byte offsets are local publication locators, not identity: after git union, locate complete lines by txn/id/revision/hash and reindex without rewriting manifests; missing or changed records still conflict.

**Shared critical section (`telemetry-lock-v1`, proposed M-1 compatibility contract).** The following existing surfaces must migrate together; merely upgrading sync is insufficient. Each public entry acquires the lock; nested helpers receive and validate the owner's nonce/context, never reacquire or release it. A top-level snapshot operation may release for computation/reacquire for publication; a nested call retains the caller's lock throughout. Release before requesting sync; sync takes a fresh lock across recovery, staging, commit, checkout/merge/abort and publication. No network work invokes a nested writer.

| Participant / verified existing surface | Required acquisition boundary |
|---|---|
| `TOK/hooks/telemetry-capture.mjs:120-123,450-452,530-532,632-652,1403-1419` — usage/live appends, scope claim, live removal and capture→sync | Before reading known sessions/scopes/live; through dedup, all appends/claims/removals; sweep and both hosts use the same context. |
| `TOK/scripts/work-scope.mjs:54-102` — open/outcomes/close read-modify-write | Before scope read through atomic replacement; close orchestration passes context to cost/fold/export helpers. |
| `TAW/scripts/gate/gate-case.mjs:191-221`; `TOK/scripts/batch-cost.mjs:161-171` — both gate destinations and fold/removal | Before destination selection/read through append; fold fsyncs destination before source removal, all under one lock. Gate execution itself stays outside the lock. |
| `TOK/scripts/batch-cost.mjs:724-745`; `TOK/hooks/telemetry-capture.mjs:1432-1454` — cost input reads/output and live report | Before enumerating inputs through coherent snapshot capture; compute only from snapshots; lock again for drift check and atomic output/manifest publication (§6.12). Live report publication also locks. |
| `TOK/scripts/build-tokenomics-export.mjs:165-180` — shared `runs.json` upsert | Before existing export read through atomic replacement; caller passes context. |
| Tokenomics/delivery sync; delivery registration/hooks/import/report/calibration; both hook installers | Sync spans the whole shared git mutation; delivery readers snapshot under lock; installation/config/ignore/bootstrap changes use exclusive maintenance with capture quiesced, then publish capabilities. |

**Subprocess lifetime and interrupted Git.** Existing sync and installer pull launch Git via `execFileSync` (`TOK/hooks/telemetry-capture.mjs:1470-1488`; `TOK/scripts/install-hooks.mjs:474-487`; research `R01:298-303`). M-1 routes every participating Git mutation, including recovery commands and installer/bootstrap children, through the following protocol; a JavaScript nonce does not fence an already spawned process.

- Before spawn, fsync a per-operation journal in the owning git metadata (plain-dir: ignored `.txn/`) with owner nonce, machine/boot identity, operation id, exact argv/cwd, pre-operation HEAD/refs, index and dirty-file snapshot hashes/bytes, intended transition and `state: may-run`. Keep it outside checkout/merge targets. Register the child process-start identity when available, but **the durable pre-spawn intent owns the exclusion even if registration never happens**. A `may-run` journal survives caller death, timeout and lock-directory damage; entrypoints check journals before granting a new owner. No spawn before durable intent; no next command before prior completion is durable. Missing/corrupt journal state is indeterminate, never evidence of closure.
- Normal completion requires the runner to establish that the command and every descendant capable of mutation have exited, then fsync outcome and `state: stopped`; only then may it release exclusion or start recovery. A successful Git exit, killed caller, missing child PID, timeout, heartbeat age or empty process listing alone is not a process-tree closure proof. Runner capabilities must be fixture-tested on each supported platform; disallow detached mutators. Without proven descendant closure, retain `may-run` and report `LOCK-BUSY(subprocess-indeterminate)`; do not infer safety from a helper's exit.
- Recovery is serialized by an atomic recovery claim under the retained owner/journal, never by deleting the old lock first. For an unfinished journal, a surviving supervisor may provide durable closure evidence from its tested lifetime containment mechanism. Otherwise the conservative recovery path requires a verified **different boot id on the same machine** (all prior local processes stopped); boot identity must come from an authoritative OS boot identifier, never uptime/clock estimates; unknown boot identity or foreign ownership remains blocked. A crashed recoverer follows the same ownership/journal rules, including its own spawned recovery commands. This deliberately sacrifices automatic same-boot crash recovery. A manual force-unlock or `doctor --fix` cannot bypass the proof. Doctor reports operation/owner identities, last phase and the required quiescence evidence, including an unregistered spawn; operator termination without closure proof remains indeterminate.
- Once all previous mutators are proven stopped, retain exclusive recovery ownership and inspect HEAD/refs, index, worktree, Git lockfiles and merge state against the journal. Record/preserve local and fetched heads and pre-existing dirty bytes. A completed transition is verified and marked recovered; a recognized unfinished merge is aborted under the same subprocess protocol and its pre-merge state verified. Remove a stale Git lockfile only with stopped-mutator proof and matching journal evidence. Unexpected changes, an incomplete checkout/staging operation without provable restoration, or failed abort yield `CONFLICT` with saved evidence; never reset/clean away data or admit writers. Explicit surfaced repair must establish a verified state under recovery ownership before release. Recover delivery byte intents only after Git is coherent; fsync the recovery result before closing journals and admitting the next participant.

Capability registry in the owning git metadata (plain-dir: ignored `.txn/`) records protocol version, installed entrypoint hashes and enabled participants. Doctor/each entry validates all enabled capture/sweep/live/scope/gate/fold/cost/export/sync/install participants against that registry, including invoked CLI producers; a changed or unknown participant is incompatible. Upgrade/quiesce existing writers before enabling the contract; no claim to constrain arbitrary external file edits. Incompatibility pauses automatic writes, shared sync and fresh export/import with `SYNC-INCOMPATIBLE`; read-only archived reports and isolated delivery-only CLI/git remain available. Dormant tokenomics does not suppress delivery sync, but an invoked dormant producer must pass compatibility before writing. Snapshot inputs outside participating writers require immutable publication (§6.12).

Every delivery mutation requests sync after releasing its transaction lock. `DELIVERY_NO_SYNC=1` suppresses remote sync only; offline keeps local committed observations for retry. Bootstrap reuses the shared `.agents/telemetry` submodule and `telemetry` branch, never a second one. Migration from plain directory to submodule requires exclusive maintenance; no lock-path switch with active owners. Existing whole-submodule staging/merge is verified at `TOK/hooks/telemetry-capture.mjs:1464-1488`.

Remote concurrent transactions form a parent-linked DAG. Union identical observations/manifests and rebuild views. Divergent changes to the same plan/profile head are `CONFLICT`, not last-writer-wins. Failed git merge is aborted while retaining local commits and fetched head; doctor lists both. `plan reconcile --heads <ids> --from <f>` / `profile set --heads <ids> --from <f>` creates an explicit resolution transaction with both parents. Reports exclude unresolved affected plans with coverage reason, other plans remain usable; calibration index rebuilds from immutable snapshots. No per-user merge-conflict-free claim for shared mutable files.

### 6.2 Event line

```json
{"v":2,"at":"2026-09-16T11:00:00.000Z","recorded_at":"2026-09-16T13:00:00.000Z",
 "user":"daniel-sallai","host":"cli","plan":"security-testing-bundle/run-1/v2",
 "item_id":"task-023-generation-1","ref":"TASK-023","level":"task","event":"done",
 "transition_id":"task-023-generation-1/done/episode-1","source":"cli",
 "source_record_id":"correction-17","observation_id":"cli:correction-17:done:task-023-generation-1",
 "revision":0,"status":"active","txn_id":"txn-17","basis":"observed","session":null,"agentId":null,
 "raw":"merged","meta":{"git_sha":"<full-sha>"}}
```

| Field | Rule |
|---|---|
| `v`, `at`, `recorded_at` | schema 2; UTC ISO ms, occurrence versus capture time; reject invalid dates |
| `plan`, `item_id`, `ref`, `level` | generation-bound catalogue; null item/ref only for admitted-but-unattributed dispatch |
| `event` | `created`, `estimated`, `dispatched`, `dispatch_ended`, `first_commit`, `review_requested`, `review_returned`, `review_approved`, `review_history`, `done`, `cancelled`, `blocked`, `unblocked`, `reopened`, `scope_declared`, `gate_observed`, `outcome_observed`, `rework_observed` |
| `transition_id` | stable item + event + occurrence token; lifecycle episode, review id or blocked interval as appropriate; no singleton done/reopened |
| `source` | `cli`, `automation-sync`, `hook`, `git`; D6 within equivalent occurrence/basis |
| `source_record_id`, `observation_id`, `revision` | durable upstream id or CLI retry token; observation tuple includes source, source record, item and event; integer revision ≥0 |
| `status`, `meta.supersedes` | `active` (default for v2 records lacking status) or `retracted`; revisions >0 reference exact prior `{observation_id, revision, sha256}` (fork repair uses `meta.resolves[]`) |
| `basis` | `observed`, `derived-child`, `scope-proxy`, `gate-proxy`, `receipt-proxy`, `plan-commit`; never silently mix populations |
| `session`, `agentId`, `role`, `label` | nullable, host-qualified handles; persist ids only by default (`capturePrompts: false`) |
| `raw`, `estimate`, `meta` | raw factory vocabulary; estimate per §6.4; evidence path/hash, generation/episode/interval/review binding, and optional supersedes pointer |

Identities encode tuples without delimiter collisions; example strings above illustrate meaning. Compare semantic payload before allocating capture envelope: retry ignores newly generated recorded_at/txn_id and reuses the stored envelope. Same observation/revision with identical semantic payload is `SKIP`; different payload is `ID-CONFLICT`. Conflicting persisted bytes under one identity/revision remain a reader error. Corrections append the next revision and `meta.supersedes` pointing to the exact prior revision, and may move `at` earlier. Revision chains must be contiguous; stale/concurrent successor forks quarantine the observation. An `event --batch` reconciliation supplies `meta.resolves` with every conflicting current `{observation_id, revision, sha256}`, `revision = max(target revisions)+1`, reason/evidence and a complete active or retracted payload; this replaces `meta.supersedes` only for fork repair. Incomplete target sets fail `ID-CONFLICT`. Another source’s observation must never prevent an append.

**Retraction/reinstatement.** Append a next revision with `status: retracted`, unchanged observation/source/item/event/transition identity, and `meta.change = {action: "retract", actor, reason, evidence: {path, sha256}}`; `meta.supersedes` targets the exact current revision. Retraction withdraws **only this source observation**, not the occurrence and not a lifecycle transition. Lower-priority surviving evidence is reconsidered normally. Retracting a mistaken CLI done for A and adding done for B is an atomic batch; wrong-item adapter facts are repaired likewise. A duplicate adapter import must reuse its original identity and cannot reactivate a tombstone. Reinstatement appends an explicitly requested `active` successor with `action: "reinstate"`, reason/evidence and complete payload; it does not mutate prior records. Retry token/digest and revision checks apply to controls exactly as to assertions. Missing/stale targets fail `ID-CONFLICT`.

Reader: validate committed manifests → parse/version-check (corruption/unknown versions counted) → collapse exact duplicates across files → highest valid nonforked revision per observation → remove retracted observations → group equivalent transitions → D6 source selection → deterministic effective-time replay. Same-revision conflicts are excluded as `CONFLICT`; filename/line ordering never decides. Adapter evidence binds fallback and authoritative occurrence through merge SHA, PR/review id, dispatch identity or explicit `--transition`; without equivalence, quarantine as `AMBIGUOUS-TRANSITION`, never infer distinct completions or nearest-time matches.

**Equal-priority conflict.** Within `(plan run, item_id, transition_id, basis)`, compare the highest surviving source rank. Equivalence means equal `at`, event, episode/causal/interval/review bindings and event-specific semantic payload (result/completeness, estimate digest, gate proof, disposition); ignore capture envelope, source locator, raw label and supporting evidence locators, which are retained as a union. Equal clocks alone do not erase conflicting outcomes. Equivalent records yield one occurrence with all provenance. Unequal records at that rank yield `CONFLICT` for this occurrence; do not fall back to lower ranks or lexical/arrival order. Same-identity revision forks also block selection at their rank. Resolve by correcting disagreeing observations to equivalent facts or retracting the erroneous exact observations; lower ranks become usable only when higher-rank assertions are explicitly withdrawn. Local merge and mapped PR git observations obey this same rule.

Sort selected occurrences by `at`, then explicit episode/causal order, then observation id. Same-time predecessor pairs require causal references (created before start, blocked before its unblock, done before its reopen); unresolved incompatible ties are invalid, not arbitrary state changes. Corrections, retractions and reinstatements apply before cutoff filtering: this is corrected effective-time history at the pinned input snapshot, not knowledge-as-of capture time. A newly pinned snapshot may therefore change an old effective-time report; the archived snapshot retains its original result. After selection rerun causal validation: retracting done quarantines its dependent reopen and subsequent episode until an atomic repair supplies a valid chain; never reinterpret a recompletion as an original done. Recompute derived parent state and all cohorts, retaining unaffected items and explicit quarantine counts. Orphan-plan events are listed as unregistered and excluded from metrics.

### 6.3 Plan registration

Canonical planner block (field defaults inherited by contained estimates):

````markdown
```json delivery-plan
{
  "plan":"security-testing-bundle/run-1/v2",
  "campaign_id":"security-testing-bundle","run_id":"run-1",
  "factory":"feature-development","observation_start":"2026-09-16T08:00:00Z",
  "source_epoch":{"from":"2026-09-16T08:00:00Z","until":null,"integration_ref":"main"},
  "campaign":{"id":"security-testing-bundle","title":"security-testing bundle",
              "estimate":{"actual_metric":"parent_elapsed.v1","unit":"h","low":120,"high":200,"tier":"budgetary"}},
  "mission_kind":"group",
  "missions":[{"id":"G12","sequence":12,"estimate":{"actual_metric":"parent_elapsed.v1","unit":"h","low":2,"high":5,"tier":"budgetary"},
    "tasks":[{"id":"TASK-023","story":"US-021","class":"M","role":"js-dev",
              "estimate":{"actual_metric":"cycle_time.v1","unit":"h","low":1,"high":3,"tier":"budgetary"}}]}],
  "proposed_by":{"kind":"agent","id":"tech-lead"},
  "proposed_at":"2026-09-16T08:00:00Z","acceptance":null
}
```
````

`plan register --from <file.md|file.json> --id <retry-token>`:

1. Validate schema, epoch, explicit observation start, unique tree, migration and estimate provenance (`lib/schema.mjs`, hand-rolled); errors exit 2. Allocate stable item ids once where absent and return the completed block. Subsequent imports match only within that run.
2. Under §6.1 transaction lock, diff last committed plan, allocate revisions and stage full next version/catalogue. Catalogue rows: `{item_id, ref, level, parent_item_id, story, class, role, generation, valid_from, valid_until}`. Retain source-file path/hash, tombstones, immutable version snapshots, participating roster snapshots and branch/PR/session/scope/sizing/cost bindings. Effective time = `--at`, else now; historical migration requires explicit effective time.
3. Append created for new items (`--created-at`, else first source-plan commit containing that item, else now; basis explicit), estimated for changed proposal/acceptance, cancelled for removed active items unless `--keep-missing`. Removing already delivered work changes scope only, never cancels its past completion. Re-addition reuses item id and explicitly reopens; scope additions reopen ancestors (§5).
4. Publish committed manifest then atomic views. Print `PLAN <id> items=<n> created=<a> estimated=<b> cancelled=<c>` with accepted/proposed/unestimated per level. Retry recovers the same transaction, never loses created after a catalogue-only crash.

`plan close` transactionally ends capture eligibility, not delivery state. `plan list/show` expose versions, scope and bindings. Markdown importer reads `#### TASK-NNN`, Story/Complexity/Assigned-to and execution `Gn` group lines; produces no estimates, `basis: markdown-import`, prints block and requires `--yes` after dry-run. Automation uses its campaign plan JSON or flat-batch registration (§6.8). Explicit `observation_start`/epoch is required before registering imported history; no earliest-new-item inference.

`plan bind --from <bindings.json>` stores validated effective-dated associations: session/host→plan/mission, branch→item/integration ref, item→PR/repository, scope/scoring/cost snapshot→generation and exact item map. Overlapping ambiguous bindings fail; outside epoch is unattributed. Binding changes preserve old versions for cutoff replay.

### 6.4 Estimates

```json
{"actual_metric":"cycle_time.v1","unit":"h","low":1,"high":3,"tier":"budgetary","class":"M",
 "proposed_by":{"kind":"agent","id":"tech-lead"},"proposed_at":"2026-09-16T08:00:00Z",
 "acceptance":{"human":"Daniel Sallai","at":"2026-09-16T08:30:00Z",
   "evidence":"<reviewed-plan-locator>","estimate_digest":"<sha256>","authenticated":false},
 "basis":{"kind":"delivery-plan","source":"<path>","digest":"<sha256>"}}
```

Unit `h` = elapsed calendar hours; `active_min` = tokenomics direct active minutes; reject ambiguous working-day `d`. Finite nonnegative bounds, low≤high; equal bounds flag `point: true`. Tier `ROM|budgetary|calibrated|unknown`; calibrated requires pinned snapshot path/hash/reference population. Optional probability strictly 0<p<1, never inferred from prose. Class remains ordinal, never points.

**Actual binding.** `actual_metric` is required, versioned and included in the accepted digest together with the metric's resolved start/finish/basis definition below. No implicit default or unit-only match. This applies the named-actual/denominator requirements in `R05:234,244`.

| `actual_metric` | Unit / population | Start → finish / accepted actual |
|---|---|---|
| `cycle_time.v1` | `h`, observed task/case | First observed build dispatch → first qualifying observed completion. |
| `lead_time.v1` | `h`, task/case | First registered created → first qualifying observed completion; exclude proven retrospective plan proxies (§6.10). |
| `parent_elapsed.v1` | `h`, mission/campaign | Earliest eligible descendant observed build start → first §5 qualifying container completion; basis `derived-child`, never observed-cycle calibration. |
| `direct_active_min.v1` | `active_min`, automation case/mission | Sum quoted case direct.activeMin / mission totals.activeMin from a fresh final bound export; accounting window begins at bound scope declaration and ends at first qualifying case completion / mission landing. Wrapper must prove every accounting contribution belongs to this window/generation, including parent remainders and shared allocations (§6.12), else `boundary-unknown`. No loaded allocation in accuracy. |

`direct_active_min.v1` additionally requires `actual_window: {scope_binding_id, generation, start: "scope_declared", finish: "first_case_done"|"first_mission_landing", item_id}` in the estimate digest. Bind the stable scope identity before declaration; future endpoints are named selectors, not fabricated timestamps. Every included contribution must have a complete source interval starting at/after declaration and ending at/before the selected finish. This includes the full parent interval for a parent remainder and the unsplit source interval for a shared allocation; allocation weights do not narrow clocks. Cross-boundary or missing contribution bounds exclude that actual as `boundary-unknown`, even when final/fresh/nondrift; never clip, subtract or prorate quoted minutes. Case eligibility uses its own direct contributors; a parent-only failure excludes mission accuracy without invalidating an independently proven case actual. Window ids/endpoints are not inferred from unit or receipt mtime. Timely acceptance is strictly before the named start (and cutoff), for original and latest policies. Missing start/finish/binding, commit/gate/scope completion proxies or unknown accounting window exclude accuracy with reasons; never substitute commit_to_done for cycle_time. Parents without descendant observed starts are missing-actual. A different `actual_metric`, window or definition requires renewed acceptance. Unbound legacy estimates remain visible as `unbound-actual`; group comparisons by metric version, unit, level and basis. No pooling lead/cycle/parent/active ratios.

Proposal and human acceptance are distinct immutable revisions. Acceptance names a human and evidence, binds the exact estimate digest; role name alone is not human ownership. It is recorded attribution, not authenticated identity. Original commitment = first accepted revision (retained as original even if ineligible, never silently replaced); changed range/unit/tier/actual binding needs renewed acceptance. Unaccepted proposals stay visible and excluded as `unaccepted`. Acceptance at or after measured start is `late-accepted`, excluded from predictive accuracy; latest policy selects latest accepted **before start and cutoff** within the same actual metric/window. Changing metric creates a separate comparison series, never a replacement actual for the original range. This applies the human-ownership requirement in `R05:234` without pretending agent plans are human commitments.

**`automation-scoping-v1` import.** Preserve exact `estMin`, `lowMin`, `highMin`, `confidence`, source path/hash and time basis plus scorer/taxonomy/calibration hashes when available. Bounds→active_min with explicit `direct_active_min.v1` window binding, size→class; absent binding remains `unbound-actual`. Do not parse confidence into tier: explicit reviewed-plan tier else unknown, even if confidence text says calibrated without a snapshot. Source labels are descriptive bands and may carry reasons (`AS/scripts/score-cases.mjs:381-388,466-472`; `R03:120-140`). Commit/mtime is proposal-record time, not acceptance. Sizing joins require generation/case bindings.

`work_ratio = actual / midpoint`; zero midpoint→null/count. `MRE = abs(actual-midpoint)/actual`; MdMRE = median MRE, PRED(25) = share MRE≤.25; zero actual excluded from MRE/PRED with count, retained for MAE. `hit_rate` = range inclusion, excluding point estimates. Unknown probability permits descriptive hit rate only, no interval-coverage calibration claim. Proxies, missing actuals, mismatched units, unaccepted/late estimates, provisional/drift/stale costs have distinct exclusions. Parent schedule comparisons require `parent_elapsed.v1` and use its declared start/finish and label derived-child timing separately; they do not enter measured cycle calibration.

### 6.5 CLI — `scripts/delivery.mjs`

| Command | Effect | Exit |
|---|---|---|
| `plan register --from <f> --id <token> [--plan <id>] [--at <iso>] [--created-at <iso>] [--keep-missing] [--dry-run] [--yes]` | §6.3 | 0/2 |
| `plan close\|list\|show [--plan <id>]` | capture status/views | 0/2/3 |
| `plan bind --plan <id> --from <bindings.json> --id <token>` | effective-dated associations | 0/2 |
| `plan reconcile --heads <ids> --from <f> --id <token>` / `profile set --from <f> --id <token> [--heads <ids>]` | transactional shared-state updates | 0/2 |
| `event <ref> <event> --id <token> --transition <occurrence> [--plan <id>] [--at <iso>] [--sha <sha>] [--pr <n>] [--revision <n> --supersedes <observation>] [--interval <id>] [--raw <s>] [--note <s>]` | CLI observation; identity/revision mandatory for retry/correction | 0/2/3 |
| `event retract\|reinstate --observation <id> --revision <current> --hash <sha256> --id <token> --reason <text> --evidence <snapshot>` | append source-specific control revision (§6.2); actor recorded | 0/2 |
| `event --batch <jsonl> --id <token>` | atomic batch; identities on every row | 0/2 |
| `status [--plan <id>]` | current states, WIP/age, unknown coverage and capture diagnostics | 0/3 |
| `backfill --git --plan <id> --head <sha> [--since <iso>] [--cutoff <iso>] [--pr] [--dry-run]` | pinned history (§6.7) | 0/2/3 |
| `sync --automation [--plan <id>] [--dry-run]` | adapter snapshots/observations | 0/2/3 |
| `report [--plan <id>…] [--since <iso>] [--until <iso>] [--cutoff <iso>] [--level …] [--class …] [--json\|--html] [--out <f>] [--from-json <f>] [--latest-estimate] [--calibrate]` | §6.9–6.11 | 0/2/3 |
| `doctor` | installer/capture/sync health | 0 |

`--sha` uses committer timestamp and records full SHA; supplying differing `--at` requires explicit correction, never silently picks one. Bare ref resolves only through unique bound plan context. Event-specific payloads such as review completeness, gate proof and acceptance use schema-validated `event --batch` / `plan bind`, not invented extra flags.

stdout tokens: `PLAN …`, `EVENT <observation_id> <at>`, `SKIP <observation_id> (exists)`, `BACKFILL events=<n> skipped=<m>`, `SYNC …`, `REPORT <path>`, `STATUS …`. stderr one `<CODE>(<detail>)`: `USAGE`, `SCHEMA-INVALID`, `ID-CONFLICT`, `INVALID-TRANSITION`, `AMBIGUOUS-PLAN`, `AMBIGUOUS-TRANSITION`, `MIGRATION-REQUIRED`, `LOCK-BUSY`, `CONFLICT`, `SYNC-INCOMPATIBLE` exit 2; `NO-PLAN`, `NO-EVENTS` exit 3 with explanatory output. Internal failures exit 1. `--round <n>` remains an optional human-readable review-round label, not an occurrence/idempotency key. Report zero counts remain measurable; no events in the window does not mean failure if carried-in state/covered zero-throughput weeks exist. `--from-json` prohibits recomputation flags and preserves the archive.

### 6.6 Hooks

`install-hooks.mjs [--host claude] [--local] [--remove] [--doctor [--fix]]`: one `_delivery` Claude `SubagentStop` group, matcher `*`, async, timeout 30, `node hooks/dispatch-hook.mjs --stop`. Unsupported host exits 2 `UNSUPPORTED-HOST`. No Copilot hooks/live markers in this release (F6, §18).

Read stdin bounded to 64 KiB, no stdout, failures exit 0. Resolve checkout through git worktree metadata, not path truncation; SPIKE-1 must pin main/worktree behavior before M2. This is a new adapter; tokenomics simply selects argument/env/cwd (`TOK/hooks/telemetry-capture.mjs:1339`). Admission requires open bound plan and role in the union of **that plan’s participating** factory rosters. `plan bind` stores `{host, session, plan, mission?, scope?, branches[], roles[]}`. Known foreign role exits without unattributed delivery events; legacy missing type passes role check only and counts `unknown-role`, binding still required (`bundles/SPEC.md:291-297`). Unbound dispatch is a capture diagnostic, outside delivery denominators.

Claude correlation key = `(host, session_id, agent_id)`, never role/time. Existing keys are checked at `TOK/hooks/telemetry-capture.mjs:1359-1367`. Prefer supplied validated `agent_transcript_path` **only after SPIKE-1 pins host fixtures**; legacy fallback resolves matching child beneath parent `transcript_path`’s `subagents/` with its `.meta.json`. Validate session/path association; two same-role children must stay separate. Parse first/last valid timestamps; absent/partial transcript yields unknown-start/incomplete-end diagnostics, no synthetic duration. Later capture can revise a partial observation; no complete-end claim without completion evidence.

Resolve metadata description, else tokenomics-style stage label from **full first user message**, slicing at `STAGE_MARKER` (`TOK/hooks/telemetry-capture.mjs:608-620`), else bound branch aliases. Resolve before persistence truncation. Explicit qualified member lists can attribute several refs; ambiguous ids yield one unattributed dispatch pair. Cluster dispatch observes task start; per-case starts need individual evidence, otherwise record scope-proxy activity only. Stage classifier: implement/build→build, review→review, fix round/address review→fix, gate/mini-gate→gate, merge→merge, else other. All stages count dispatch activity; only observed build starts enter cycle time.

Emit start/end with source identity containing host/session/agent/event/item. Review-stage request is a request **proxy**, not proof of complete review history. Fix stage emits `rework_observed`, never `review_returned`; independent review outcome supplies return/approval. Same reread SKIP; corrected/grown transcript appends revision. After transaction, request §6.1 sync even with dormant tokenomics installed.

Remove only owned hook groups/blocks, preserve unrelated entries and edits made after install; formatting may change. Delete owned files only if no user content remains. Never remove ledger/submodule data; retain ignore protection while transients remain, report owned remnants. Doctor checks compatibility, rosters/bindings, transcript capability and actual ignores. Byte-for-byte pre-install restoration is not promised.

### 6.7 Git backfill

Require registered generation, source epoch `[from,until)`, integration ref and immutable `--head` on that ref. Persist selected heads/refs/cutoff and imported PR hashes. Do not scan `--all`. `--since` limits new observations, not report replay. Canonical refs case-sensitive; normalize only bound aliases including `task/task-023 → TASK-023`; resolve merge alias **before** ref filtering.

| Event | Evidence |
|---|---|
| created | first pinned source-plan commit containing item in this generation; shared stamp labelled plan-commit |
| first_commit | earliest nonmerge `<ref>:` commit in bound unit history/epoch, reachable from pinned integration head or explicit pinned unit ref |
| rework_observed | `<ref>: address review N`, source id SHA; not a review outcome |
| local done | first-parent merge on bound integration ref, registered branch alias, second-parent evidence from that generation; no arbitrary ancestor-containing fallback |
| PR done | persisted `{plan,item_id,repository,pr,head_ref,base_ref,episode}` mapping; paginated retrieval verifies merge into bound base within epoch/cutoff |
| PR reviews | stable upstream review ids/results with complete pagination and review-history bounds; PR creation supplies time_to_merge, not a review request |

PM binds PR when opening it; legacy branch-based discovery may propose a unique head/base match for confirmation. Never require task text in title/body. Missing `gh`, auth, pagination or binding → unavailable/partial, not complete history. First merge maps to episode 1; later merge needs explicit reopen/episode binding or quarantine. Repository+full SHA/review id form source identity. D6 retains lower-priority evidence. Repeat backfill SKIPs same observation/revision only. Squash/deleted branches must work through PR mapping (`bundles/feature-development/agents/project-manager/AGENT.md:95`).

Golden uses a self-contained generated temp git repository with fixed dates, refs/head in fixture manifest; it models the research snapshot, never current moving branch totals. Later merges/reused ids cannot change pinned output.

### 6.8 test-automation sync adapter

Read existing records, snapshot bytes into delivery imports, emit automation-sync observations. Only delivery artifacts are written; shared git sync separately owns repository metadata. Campaign/run identity is explicit; hash canonical approved Plan JSON only, not card State/Log (`TAW/references/campaign-planning.md:254-280`). Flat batches need run identity too. Clusters→tasks→cases, solo→one-case task; ambiguous membership is invalid.

| Input | Observation |
|---|---|
| Campaign plan or flat batch run/receipt | stable bound tree registration |
| Bound `.agents/estimation/<scope>-scored.json` | proposal via automation-scoping-v1, acceptance separate |
| `.agents/telemetry/automation/scopes/*.json` | scope_declared at declaredAt as scope-proxy; outcomes[id].at as raw outcome_observed with generation/session |
| Both `.agents/telemetry/automation/gate-runs/<slug>.jsonl` and `.agents/automation/<slug>/gate-runs.jsonl` | canonical-row-hash dedup copied records, gate_observed; never first-green→done |
| Bound report.json cases[].outcome | outcome snapshot; mtime receipt-proxy, never delivery timestamp |
| Bound unit/trunk merge or mapped PR | task integration / mission landing evidence, requiring child/gate rules below |

Existing gate fields: `{at, branch, base, baseRef?, spec?, n, verdict, consecutiveGreen, seconds[], coverage?}` (`TAW/scripts/gate/gate-case.mjs:191-221`; `R03:425`). Workflow runs separate `--n 1` calls, then lands trunk separately (`TAW/references/orchestration-playbook.md:200-210`). These logs lack tested SHA/sequence id. **New delivery binding**, supplied by lead, is `{run_id, mission, tested_sha, base_sha, required_n, ordered_gate_row_hashes[], covered_case_ids[], evidence}`; it is declared provenance, not a claimed existing payload. Without it gate completeness is unknown.

Within one bound sequence require distinct run hashes, tested revision/base and coverage set; positive required_n explicitly declared. Count consecutive successful runs: one-run row contributes one; multi-run row requires n/consecutiveGreen/seconds length consistency. Red/incomplete/invalid coverage resets streak; changed code/base resets sequence. Later red invalidates earlier qualifying streak. `gated_at` = final qualifying green of latest valid sequence. Pending merge is gated, not done. Landing must name tested revision or explicitly verified equivalent squash tree/base; content changes require another gate.

Case done requires delivered disposition (`delivered`, `defect-found`, legacy `automated`, `merged-sanctioned-red`), bound generation membership, individual accepted outcome evidence and task integration. Scope timestamp qualifies only if evidence confirms acceptance at that boundary; otherwise retain outcome_observed. `blocked`, `not-started`, `infra-stalled` remain unresolved; `un-automatable` cancels only with explicit removal decision. Gate green never delivers all cases. Covered delivered receipt plus final gate may provide a **gate-proxy completion observation**, excluded from measured cycles, accuracy and observed throughput; proxy counts remain visible. Receipt mtime never supplies done.

Equivalent observed acceptance precedence: CLI > bound automation scope > hook > git, with §6.2 corrections. Gate/receipt proxies remain separate. `done_clock` reports cli, scope-observed, integration, derived-child, gate-proxy, receipt-proxy, unknown as distinct populations. `scope_to_done` is mission declaration→observed landing proxy, never per-case cycle/calibration. Sync-before-hook and hook-before-sync must produce identical populations. Scope outcomes are mutable latest values (`TOK/scripts/work-scope.mjs:74-90`); missing past outcomes remain unknown, not reconstructed from current state.

### 6.9 Timeline derivation

`end = min(until,cutoff)`, cutoff defaults generated-at, until defaults cutoff, since defaults earliest explicit selected-plan observation_start. Validate since<end. Intervals UTC half-open `[since,end)`; envelope records requested/effective bounds. Replay **all** corrected committed history with effective at<end, including earlier plan versions, before filtering cohorts. Future events cannot change cutoff state. Later recorded corrections affect historical output only through a changed pinned input snapshot (§6.2).

| Transition | Validation/effect |
|---|---|
| created | planned once per stable item |
| observed build dispatched / first_commit | planned→in_progress; first_commit gives separately labelled WIP proxy, never cycle start |
| observed review_requested | in_review; proxy request stays activity only |
| review_returned / review_approved | explicit review id/result required; returned→in_progress, approval alone not done |
| done / cancelled | closes current episode; duplicate occurrence must be retry or correction |
| reopened | done/cancelled→in_progress, new episode id; repeat cycles allowed |
| blocked / unblocked | pair interval token in open episode; unmatched unblocked invalid; union overlapping valid intervals without double count |

CLI rejects invalid transitions; imported invalid/ambiguous histories are quarantined and counted. Open block closes at terminal event or end, flagged right-censored. No captured blocks is not confirmed zero: block completeness must be explicitly declared with history bounds/evidence in metadata; complete empty history→0, otherwise unknown. Parent state follows §5.

Derived first start/completion, latest completion, current episode/state, reopen count, dispatches, intervals and coverage. Throughput counts each stable item’s **first** qualifying completion once; recompletions separate. `work_item_age` applies only to never-terminal open items: first observed build start→end. An open episode after any terminal state has `reopened_age` = latest valid reopen→end; `history_age` = first observed build start→end remains visible, includes closed gaps and has no SLE comparison. Closed items have no open age. `reopen_cycle_time` = observed reopen→qualifying recompletion for each delivered later episode; cancelled episodes do not enter that distribution. Unknown starts stay null. Reopen/scope additions preserve first parent completion. Negative duration excludes affected metric only (`clock-skew`), never erases throughput.

**Review observability.** `review_history` carries `{episode, from, through, complete, evidence_ids[]}` from fully retrieved history or explicit reviewer/PM evidence. First-pass requires complete history from first review request through first completion, at least one final approval, and all outcomes. No request→unknown unless explicit history evidence identifies its start. Partial/missing histories yield review_rounds null, observed failures shown only as lower bound. Fix dispatch/commit counts are rework_proxy. `first_pass_rate = complete approved histories with zero returns / complete approved histories`. Print reviewed (at least one result), eligible (complete approved), done and unknown/partial counts. Disabling capture never turns unknown into success.

**Cohorts/windows.** First-delivery duration/quality/accuracy completion cohort = first completions in `[since,end)`, full earlier lifecycle. WIP/age = state immediately before end; creation cohort supplies cancelled_share (currently cancelled among items created in window / that cohort). Parent-derived and observed leaf strata never mix. Every intersecting UTC ISO week appears, zero-filled; whole iff Monday 00:00≥since and next Monday≤end, with declared observation coverage for the full week. For aggregated plans use their common covered interval for velocity, or emit per-plan velocities rather than silently zero-fill uncovered time. Carried-in starts/blocks supply opening WIP and later completions even when no new items are created. Sum partial+whole completion bins = cohort size. Source coverage remains explicit; declared observation start does not prove complete capture (`R05:220-247`).

### 6.10 Metrics

Durations seconds internally, hours 2 dp in output; compute before rounding. Median/P85/P90 floors per D10; below floor show sorted samples, min–max and n. Per level/plan/class/factory/mission, across versions by stable identity; optional role/model segmentation only when known, no allocation invented for mixed-role parents.

| Group | Metric | Definition / denominator | Caveat |
|---|---|---|---|
| Flow Time | cycle_time | first observed build start→first qualifying completion | measured task/case; child-derived parents separate |
| | commit_to_done | first_commit→first completion, only without observed dispatch | never blended into cycle |
| | lead_time | first created→first completion | plan-tracked, not idea-to-done |
| | time_to_merge | PR createdAt→mergedAt | PR open to merge — not story lead time/cycle |
| | time_in_review | first observed review request→first completion | incomplete/proxy request → unknown |
| | time_blocked | union block intervals clipped to window | complete history or censored observed lower bound |
| | work_item_age | never-terminal first observed build start→end | first-cycle P85 only; unknown start null |
| | reopened_age / reopen_cycle_time | current reopen→end / completed reopen→recompletion | separate episode population; no first-cycle P85 fallback |
| | history_age | first observed build start→end for reopened open item | includes closed gaps; no SLE comparison |
| | scope_to_done | mission scope declaration→observed landing | supplementary scope proxy only |
| Throughput | throughput | stable items first completed per UTC ISO week | zero-fill/coverage/partials §6.9 |
| | velocity | median whole-week throughput, minimum 3 weeks | null with derived caveat otherwise; mean may be secondary |
| | wip | current in_progress/in_review, including blocked overlay, at boundaries/end | observed versus first-commit-proxy split; no Little’s Law line |
| | mission_turnaround | explicit successor start minus predecessor completion | overlap/unknown null and counted (§5) |
| | cadence | throughput + velocity + mission_turnaround | grouping, not another metric |
| Quality | review_rounds / first_pass_rate | complete history failure count / zero-return share of eligible histories | reviewed/eligible/done plus unknown denominators |
| | rework_proxy | distinct fix dispatches and address-review commits | separate counts, no claim they are identical rounds |
| | cancelled_share | current cancellations in creation cohort / cohort size | empty denominator null |
| | reopen_count | valid reopen occurrences in window | does not add throughput |
| | unattributed_share | admitted bound dispatches with no resolved item / admitted bound dispatches | dedup host/session/agent, not per-item fanout |
| | coverage | done items with each event/basis; review/block completeness | proxies, quarantines, unknown and source shares explicit |
| Estimates | work_ratio, MdMRE, PRED(25), MAE | accepted estimate versus comparable actual (§6.4) | class/tier denominators, unestimated/unaccepted/excluded counts |
| | hit_rate | share low≤actual≤high | ranged only; descriptive without probability |
| | schedule_variance | accepted `parent_elapsed.v1` mission/campaign range vs its first-completion elapsed; actual−high / actual−low band | derived-child basis named; scope added/removed since registration; current episode elapsed separately |
| | calibration | observed-cycle `{n,p50_h,p85_h,min,max,sample_window}` by factory/level/class and metric version/episode kind | separate first-cycle and reopen-cycle snapshots; no proxy/parent population |
| Cost | active_min, cost_usd | quoted bound export direct/loaded/totals (§6.12) | allocation, freshness, provisional/drift visible |

**D12 validity.** Missing cycle time does not exclude valid commit_to_done. Genuine 30-second cycles, short reviews and confirmed zero blocked time remain. For lead_time only, same source commit for created/completion **plus** elapsed≤profile.zeroDurationSec marks `retrospective-plan-proxy`, excluded with evidence/count. Short duration alone cannot prove retrospective authorship. Zero actual/estimate handling per §6.4; zero-denominator rates null. Gate/receipt completion proxy counts never enter observed throughput. Calibration obeys percentile floors and contains only observed, valid cycles, with event references and window. First-cycle snapshots contain first completions only; `reopen_cycle_time.v1` snapshots contain completed reopen episodes with episode ids and distinct-item count. Reopen samples use recompletions in `[since,end)` with earlier reopen history, not the first-completion cohort; keep prior terminal kind (done/cancelled) as a separate stratum. A first-cycle comparator includes only uninterrupted first episodes, excluding any pre-first-done cancellation/reopen. Derived ancestor reopen clocks cannot enter observed reopen calibration. Age warnings require a matching version/start/finish basis, factory/level/class and n≥7 (D10); no compatible reopen reference means `not-comparable`, never first-cycle P85. Repeated reopen resets only reopened_age; history_age/reopen count remain visible. This keeps starts/finishes aligned as required by `R06:288-291`.

### 6.11 Report envelope and formats

```json
{"generated_at":"…","cutoff":"…","window":{"since":"…","until":"…","effective_end":"…"},
 "git_sha":"…","is_working_tree":true,"plans":["…"],
 "sources":{"transactions":["…"],"files":[{"path":"…","sha256":"…"}],"tokenomics":"present|absent","gh":"present|absent"},
 "policy":{"weeks":"UTC ISO","percentile":"nearest-rank","minWholeWeeks":3,
   "zeroDurationSec":60,"estimate_base":"original|latest-before-start","history":"corrected-effective-time"},
 "coverage":{},"caveats":[],"baselines":{"cycle_time_task_h":null,"throughput_task_per_week":null}}
```

Also pin binding versions, adapter/schema versions, observation start, whole-week keys, requested/effective bounds and input SHA/ref set. Every metric has numerator/denominator, eligible/unknown/excluded counts, actual metric version/start/finish and episode population where applicable, basis and evidence locators (ledger path:line; imported snapshot path/hash). Dynamic caveats derive from counts/week keys/coverage, not static pasted claims. Unknown is explicit, never blank. Review completeness and block observability are distinct coverage fields. Baselines team-owned null by default, shown as “no baseline”, never invented.

Markdown default, JSON assessor export, self-contained HTML (own CSS; no tokenomics imports). Ordered sections: Flow Time · Throughput · Quality · Estimates · Cost if present · Coverage & caveats · Open items. `--from-json` re-renders archived metadata/data without recomputation or JSON rewrite. `--calibrate` writes immutable snapshot and transactionally rebuilds calibration-log; newest compatible snapshot selected by manifest, never glob-order guess.

Profile template: `{capturePrompts:false, zeroDurationSec:60, minWholeWeeks:3, baselines:{cycle_time_task_h:null, cycle_time_mission_h:null, throughput_task_per_week:null, first_pass_rate:null, hit_rate:null}, tokenomics:"auto"}`. Explicit tokenomics path may override discovery. Profile updates are transactions; archived reports pin the version. UTC week computation deliberately differs from tokenomics’ local-calendar `isoWeek` (`TOK/scripts/team-report.mjs:106-114`); print the divergence when quoting neighbouring reports. No `byPerson` anywhere.

### 6.12 Join to tokenomics

**Resolved by narrowing (F13):** self-contained reader quotes **existing batch/case cost.json only**; raw usage/live folding, task cost allocation and catalogue-driven task attribution parked (§18). Tokenomics session dedup is host:id, latest endedAt then capturedAt (`TOK/scripts/team-report.mjs:62-73`); future dispatch joins must be `(host,session,agentId)` plus generation.

`plan bind` associates receipt snapshot with `{run_id, mission_item_id, source_path, sha256, generated_at, case_map, source_manifest}`. Case map exact/injective within generation. Source manifest pins batch receipt/scopes/gates/relevant usage/live/sizing input hashes **at export generation**; M3 adds this provenance wrapper to tokenomics export. Under §6.1 lock, capture the complete input inventory (including all receipts used for cross-batch exclusion), exact bytes and absent-file markers into immutable content-addressed snapshots. Compute cost and hashes from those same buffers, never reread live paths for either. Uncoordinated receipt/sizing/profile sources must be explicitly published as immutable hash-qualified versions with bindings; mutable paths alone cannot qualify a fresh export. Reacquire the lock before publication, compare inventory/hashes/binding heads to captured versions, and retry the entire capture on drift. Atomically publish an immutable cost-plus-manifest bundle with a commit marker last; `cost.json` is a rebuildable view. Delivery imports only verified bundles under lock, with declared snapshot versions/window; incomplete publication stays unknown. This is a proposed snapshot API amendment to `updateBatchCosts`, whose existing live reads/write are at `TOK/scripts/batch-cost.mjs:724-745`. Existing receipts lacking wrapper may be quoted as historical snapshots (`freshness: unknown`) but excluded from accuracy. Delivery compares hashes only; changed/missing inputs→stale/unknown and suggests regeneration by tokenomics, never recomputes. It does not sum raw live/final/resumed records.

Quote totals.activeMin/costUsd, cases[].direct.activeMin/costUsd and cases[].loaded.activeMin/costUsd (`TOK/scripts/batch-cost.mjs:583-586,617-625,645-660`). Direct/loaded side by side, loaded labelled allocation; never sum both or redistribute overhead. Direct itself can include an even share of multi-case dispatches (`:565-568`), so no invented “individually measured” claim. Accuracy uses case direct.activeMin or mission totals.activeMin only under the accepted `direct_active_min.v1` window; fresh attributable nonprovisional/nondrift exports only. Mission totals are separately labelled batch active minutes, never summed with their cases. Carry sources.liveNote, cost sources, coverage, records.gateDrift/outcomeDrift, stats.note (`:645-707`) with snapshot hash. Missing dollars null/tokens-only, not zero; provisional/drift visible, excluded from accuracy.

**Complete accounting-window manifest (proposed M3).** Session active time includes parent active time plus child active time at `TOK/hooks/telemetry-capture.mjs:752-754`; the parent remainder enters mission totals at `TOK/scripts/batch-cost.mjs:530-545`. Shared parent/neutral contributions use batch shares (`:511-527`), while case direct uses dispatch shares (`:549-568`). This matches `R01:411-415,560-565`; a dispatch-only clock inventory cannot prove a mission total's window.

The same tokenomics computation that emits the immutable cost bundle must emit `accounting: {version: 1, producer_sha256, outputs: [...], contributions: [...]}` in `source_manifest`. Each output carries `{output_pointer, quoted_active_min, contribution_ids, complete}` for `/totals/activeMin` and each case direct active-minute field. Contribution ids are unique per output/allocation, so a dispatch shared by mission and case outputs retains distinct weights. Each referenced contribution carries `{id, kind, host, session, agent_id, generation, scope_binding_id, source_sha256, source_locator, source_active_min, weight, allocated_active_min, started_at, ended_at, clock_basis, clock_evidence}`; `kind` is `dispatch|parent_remainder`, `agent_id` is null for a parent, and locators identify exact snapshotted records. `clock_evidence` pins hash/locator and adapter version for both bounds, independent of receipt timestamps. Shared contributions also pin all matched batch generations, share denominator and the receipt inventory used to derive it; multi-case shares pin the matched case set. Parent rows pin the session and **all** child operands used in the remainder, including excluded foreign children. Enumerate every contribution, including zero-valued rows; absent bounds never become valid zeros.

Tokenomics attests a closed contribution inventory for each output and reconciles allocations to the quoted value using its pinned arithmetic/rounding version before setting `complete: true`. Delivery validates manifest schema, identities, snapshot hashes, output/value binding, completeness and interval containment; it does not fold source records or recalculate totals. Missing/inconsistent manifests cannot qualify accuracy. A parent remainder requires the entire source parent interval, not first/last child clocks; a host adapter without evidence covering all its parent accounting operands yields unknown bounds. Every shared source interval must fit the selected target window independently, regardless of its fractional weight. A missing/crossing parent or neutral interval gives mission `boundary-unknown`; freshness/finality, scope membership and hashes alone cannot override it. Preserve the unchanged historical quoted total and allocation labels, with exclusion counts and evidence in reports/calibration. No clipping, subtracting parent time, loaded-to-direct conversion or delivery-side recomputation repairs eligibility.

One active bound snapshot per mission at cutoff; supersession references old digest, never adds snapshots. Snapshot generated after cutoff excluded unless explicitly bound as later correction and labelled corrected history. Missing aggregate→no cost columns plus coverage reason. No tokenomics code import, per-person slice or scalar honesty label guessed from a dispatch row.

## 7. Entry points and dependencies

| Ask | Command family | Needs |
|---|---|---|
| Register plan/estimates | plan register (identity flags §6.5) | skill |
| Record task merged/cancelled/block/reopen | event with retry + occurrence ids | skill, recorded evidence |
| Bind dispatch/PR/gate/cost | plan bind | source artifact |
| Status/report/calibration | status / report | skill; optional cost export |
| Fill history | backfill --git --plan --head; optional --pr | git; gh optional |
| Sync automation | sync --automation | local automation records |
| Enable automatic capture | install-hooks.mjs --host claude | Claude, compatible shared sync |
| Health/removal | install-hooks.mjs --doctor / --remove | skill |

## 8. Guarantees and Not guaranteed

Every figure traces to committed observations or pinned imported snapshots; commitment estimates carry named human acceptance, proposals remain separate. No invented durations/default estimates/baselines/cost, proxies remain named. Data stays in the repository except the expressly opted-in repository telemetry git sync and optional PR reads. No completeness guarantee on unsupported/unbound capture; coverage is printed. No cross-team ranking/comparability claim, DORA, idea-to-done lead time, forecasting, or authenticated-human assertion.

## 9. Hand-offs

### 9.1 feature-development

- Tech-lead task decomposition keeps Complexity and adds canonical plan block with proposed task/mission/campaign ranges; human accepts exact digests before commitment metrics. Handoff runs plan register with retry token. Existing task template fields are at `bundles/feature-development/agents/tech-lead/AGENT.md:181-201`.
- PM binds plan/session/roster, branch and task↔PR when opening work. Dispatch stage labels name qualified ids; no first-line assumption. Merge/cancel/block/unblock/reopen calls supply occurrence/retry/interval ids. Record explicit review outcomes/history, never count fix dispatch as review result. Status Report gains `### Delivery` from status.
- Instructions name registration→transition capture→mission-close report, explicit human ownership and bindings; work board uses this ledger as transition record.
- Scout records the opt-in choice and runs installer only when requested.

### 9.2 test-automation

- Intake sync registers stable campaign/run/tree; bind scope/scoring generations and sessions before capture. Both automation and feature Workflow prompts retain full-message stage labels with qualified ids.
- Before scope close, bind gate required-N sequence/tested/base revision and individual case dispositions, then sync to retain evidence. After observed trunk landing, sync again for mission done. Manual/pending merge remains open; closing a scope does not complete a mission.
- Automation-scoping Mode 4 may consult latest compatible delivery calibration snapshot via calibration-log beside its minute calibration; elapsed hours and active minutes stay separate. Preserve scorer confidence; explicit tier/acceptance/provenance per §6.4. Lead/scout gain on-demand skill.

### 9.3 manual-qa

No native wiring; a team may register a run as a mission through the markdown importer by adding the canonical delivery-plan block to its RUN document. Native run-field inference and host wiring remain parked (§18); unrelated manual-QA dispatches cannot pollute delivery capture.

### 9.4 AI-maturity assessor

JSON groups Flow Time/Throughput/Quality with n, source, denominators, baselines and named proxy labels. Team authors its dated review entry; the tracker supplies immutable reference snapshots, never claims governance from missing reviews or authors the assessment itself (`R05:228-247`).

## 10. Files and manifests

```
skills/delivery-metrics/
  SKILL.md  README.md
  scripts/delivery.mjs                      + delivery.test.mjs
  scripts/install-hooks.mjs                 + install-hooks.test.mjs
  scripts/lib/paths.mjs                     + test
  scripts/lib/schema.mjs                    + test
  scripts/lib/transactions.mjs              + test (byte recovery, reconcile, participant lock/sync, subprocess journals/recovery)
  scripts/lib/events.mjs                    + test (revision/retraction, equal-rank conflicts)
  scripts/lib/plan.mjs                      + test (identity, versions, bindings, delta)
  scripts/lib/plan-markdown.mjs             + test
  scripts/lib/resolve.mjs                   + test (full-message, roster/generation)
  scripts/lib/timeline.mjs                  + test
  scripts/lib/metrics.mjs                   + test (bound actuals, first/reopen populations)
  scripts/lib/report.mjs                    + test
  scripts/lib/git-backfill.mjs              + test (fixed temp repository)
  scripts/lib/automation-sync.mjs           + test
  scripts/lib/tokenomics-join.mjs           + test (export-only, complete contribution windows)
  hooks/dispatch-hook.mjs                   + test (Claude payloads/child transcripts)
  templates/delivery-plan.template.json  templates/profile.template.json
  templates/plan-block.template.md  templates/bindings.template.json
  references/event-model.md  references/metrics.md
  references/plan-block.md  references/calibration.md  references/host-capabilities.md
  fixtures/security-testing-v2/             (59 registered, 33 done; fixed-date git builder + manifest + golden)
  fixtures/automation/                      (scorer, scopes, receipts, both gate paths + bound sequences)
  fixtures/hosts/                           (Claude Agent/Workflow, concurrent children, main/worktree)
  fixtures/tokenomics/                      (exports/provenance/accounting; parent/shared boundary and live/final/resumed/stale variants)
```

Compatibility files (M-1/M3): `TOK/hooks/telemetry-capture.mjs`, `TOK/scripts/work-scope.mjs`, `TOK/scripts/batch-cost.mjs`, `TOK/scripts/build-tokenomics-export.mjs`, `TOK/scripts/install-hooks.mjs`, `TAW/scripts/gate/gate-case.mjs` and their tests; boundaries/citations in §6.1. Delivery owns its lock implementation; tokenomics/gate compatibility implements the same protocol without delivery importing tokenomics code. Templates/schema include retraction controls, actual bindings and §6.12 accounting manifests; fixtures add byte-interruption, participant-concurrency, orphaned Git/spawn-registration and interrupted-Git recovery cases. All compatibility subprocess runners implement §6.1 durable journals and closure checks; tokenomics export owns contribution enumeration, clocks and reconciliation.

Manifest work: skills.json orphan entry, both factories’ skills[], generated marketplaces via `npm run gen:marketplaces`, hand-curated Claude entry decision at M1, duplicate GROUPS for verbatim fixtures and any copied label/identity rules. Adapted fixtures list source revision/hash and transformation, not falsely byte-equal GROUPS. Existing catalog count documentation is refreshed from actual registry at implementation, not frozen counts from v1.

## 11. Report structure

Title/envelope (generated-at, cutoff, SHA, window, plans); Flow Time observed/derived/proxy tables with n and floors; Throughput series/partials/velocity/mission gaps; Quality complete review distribution, first-pass reviewed/eligible/done, unknowns and rework proxies; Estimates accepted/unaccepted/unestimated, accuracy, scope variance and reference ranges; optional quoted Cost; Coverage/caveats and conflicts; Open items with WIP basis, first-open/reopened/history ages and comparator population or `not-comparable`. Unknown/not measured allowed, blank forbidden. Status is the PM’s one-screen subset. Exports never silently drop proxy/unknown populations to improve headline quality.

## 12. Tests

Deterministic offline stdlib ESM `node --test`, temp directories; fixtures pin source path, revision/hash and compatibility version. Verbatim copies use duplicate checks; transformed inputs declare transformations.

| Group | Required counterexamples / expected behavior |
|---|---|
| events/timeline (F1,F11) | Git done 12:00 then CLI correction 11:00, both orders → CLI selected, git retained; cross-file order invariant; same id/revision changed bytes fails; unknown schema/corruption counted; two reopens/three completions→throughput 1, reopen count 2; repeated block pairs, causal ties and retries |
| retractions (v2 F1) | A mistaken done retracted + B done added atomically→A throughput 0/B 1; wrong-item adapter retry cannot resurrect A; surviving git done becomes selected; retract sole done quarantines dependent reopen/recompletion; reinstate restores chain. Old archive unchanged; new corrected snapshot changes historical-cutoff result. Retry SKIP, stale target/fork conflict, reason/evidence required. |
| equal rank (v2 F2) | Two CLI tokens at 11:00/12:00 for one transition/basis→CONFLICT, no git fallback; local merge vs mapped PR git disagreement same result in both file/arrival orders. Equal facts coalesce once with union provenance; equal clocks/unequal outcomes conflict; exact retraction or matching corrections resolves. |
| torn append (v2 F3) | Kill at every byte offset (including multi-byte UTF-8, partial JSON, complete JSON without LF), during recovery delimiter/reappend, and manifest rename/fsync. Retry yields one parseable committed observation, preserves all prior committed bytes, counts delimited fragments; missing/corrupt committed range blocks publication. Unknown tail never truncated. |
| shared participants (v2 F4) | Concurrent session/live capture, scope claim/outcome/close, gate append/fold and export upsert versus sync/import/export; barriers prove no participant writes during merge. No nested-lock deadlock; snapshot bytes equal published hashes/actual computation inputs; inventory addition/removal/drift retries. Partial bundles never import; obsolete enabled producer fails capability check even with current sync; immutable external input required. |
| actual boundaries (v2 F5) | Created Mon 09:00, first commit Wed 08:00, dispatch Wed 09:00, done Wed 11:00: lead 50 h, cycle 2 h, commit span 3 h (not emitted as commit_to_done while dispatch exists). Range 1–3 h accepted Tue 09:00: cycle ratio 1/hit 1/MRE 0 eligible; lead late/excluded, no proxy substitution. Acceptance before Mon creation makes lead ratio 25/hit 0; metric change needs new digest/acceptance. Removing dispatch yields commit_to_done 3 h but cycle accuracy unknown; parent_elapsed 4 h with accepted 2–6 h→ratio 1/hit 1 in derived stratum; active-window mismatch and legacy missing binding excluded. |
| complete active window (v3 F1) | Scope 09:00, child 09:10–10:00/direct 50 min, mission landing 10:15; accepted range 50–60 active_min before 09:00. Fresh final nondrift export with parent interval 09:00–10:10/5 min→mission 55, ratio 1/hit 1; parent continues to 11:00/50 min→quoted mission 100 retained, mission accuracy null/`boundary-unknown`, case direct 50 unchanged and independently eligible. Parent starts before declaration, missing parent bounds and shared neutral contribution crossing either endpoint all exclude mission accuracy. A 1/2 share never clips the interval; both target generations tested separately. Fully contained shared intervals qualify with allocation labels. Missing contribution, clock evidence, denominator or failed producer reconciliation prevents complete proof; zero rows without clocks remain unknown. |
| subprocess ownership (v3 F2) | Barrier pauses a real mutating Git child; SIGKILL its Node caller, then competing append/sync remain `LOCK-BUSY` until closure proof and Git recovery. Repeat kills before spawn, after spawn/before registration, after Git exits/before stopped journal, during abort/recovery and before owner release. Unknown descendants and same-boot unfinished intent never auto-reclaim; test verified reboot closure with injected boot identity, foreign owner, PID reuse, missing boot id and simultaneous recoverers. Complete or terminate contained child tree, then verify completed merge or abort restores recorded pre-merge state before any append. Dirty baseline/local/fetched heads retained; stale index lock requires proof; unexpected checkout/index state→CONFLICT, no reset/data loss. Platform runner capability tests include descendant outliving direct child; unsupported closure stays blocked. |
| episode age (v2 F6) | Never-terminal age uses first-cycle P85; ten-day original cycle then reopen one hour ago→reopened_age 1 h/history_age retained, no first-cycle warning. Six completed reopen episodes→no P85; seven compatible episodes→own P85. Repeated reopen preserves original throughput 1, visible history/reopen count and distinct first/reopen calibration cohorts; cancellation terminal excluded from reopen duration samples. |
| identity/plan (F4,F12) | concurrent TASK-001 plans/reused TC-1 never cross-join; card Log-only edit same identity; v1→v2 migration conserves totals; §5 mixed cluster/solo fixture, partial/all cancellation/missing child, scope addition, overlap |
| transactions (F14) | concurrent registration; crash before/mid append, after commit/before view rename recovers once; no lost created; live lock not stolen by timeout; remote plan/profile divergence preserved, explicit reconcile; delivery-only sync with dormant tokenomics; incompatible enabled participant refuses capture/sync/fresh imports |
| automation (F2,F3,F15) | hook/sync both orders same populations; cluster no invented case start; both gate locations dedup; green/red/green with required 3 incomplete; three greens pending merge gated only; telemetry-only logs before close; changed tested SHA resets; receipt mtime never done; unknown tier preserves real scorer confidence |
| review (F5) | no evidence→unknown, partial→lower bound, confirmed complete first-pass→zero rounds with eligible=1; fix dispatch/commit changes proxy only; incomplete PR pagination never complete |
| host/resolve (F6,F8,F9) | actual pinned Agent/Workflow payloads, two same-role children; boilerplate then stage ids, no description/useful branch resolves bound plan; missing transcript unknown; foreign manual-QA with open plan writes no delivery events; missing type still needs binding; malformed/no plan exits 0; Copilot install unsupported |
| window/metrics (F10,F17,F18) | no-creation window with old completions, carried-in blocks, exact Monday cutoff, future events excluded, common-coverage aggregation, whole/partial conservation and percentile floors; all-git retains commit_to_done with cycle unknown; genuine 30 s cycle/confirmed zero block retained; same-commit evidence excludes only retrospective lead proxy; no Little’s Law line |
| estimates (F15–F17) | proposal→acceptance→revision, each exact digest; missing human/late acceptance excluded; calibrated pinned basis, no probability from confidence; zero midpoint/actual and unit mismatch; hand-computed midpoint ratio/range hit-rate |
| git (F19) | fixed-date graph, lowercase merge alias before filtering, unrelated ancestor merge rejected, epoch-bound joins, mapped squash PR no id in title/body, pagination; later branch growth leaves golden unchanged; second backfill all SKIP |
| cost (F13) | raw live/final/resumed inputs never add to receipt; stale/missing manifest excluded from accuracy; reused ids/run mismatch refused; direct/loaded/overhead not double-counted; provisional/drift/token-only preserved; no fabricated feature-task aggregate |
| installer/identity (F7,F20,F21) | existing telemetry inner block upgraded; git check-ignore + disposable-index add -A protect every transient but retain plans/events; unusual formatting, repeated install/remove, intervening user edits, tokenomics groups preserved; whoAmI name/email/OS/punctuation/rename fixtures |
| report | every metric hand-computed on 12-item data, archive re-render without recompute, dynamic caveats, source locators/binding versions and effective windows, baseline null, no byPerson or proxy contamination |

Golden fixed fixture: 59 registered tasks, 30 Gn missions, 33 first-completed tasks, 11 with address-review **rework proxies**; observed review-round/first-pass histories unknown, no observed cycle. Per-class commit_to_done values derive from hand-checked fixed fixture timestamps. Never assert these totals for the moving implementation branch.

Implementation gates: `npm test && npm run validate` including marketplace/dupe checks; `skills-ref validate skills/delivery-metrics`; installer smokes `node bin/init.mjs init --factory feature-development --target claude --yes` and `--factory test-automation --target copilot --yes` place orphan skill without capture. This spec-only revision checks text/diff consistency; delivery implementation tests do not yet exist.

## 13. Plan

| # | Milestone | Capability |
|---|---|---|
| M-1 | Compatibility amendments | P-0/P-1; all §6.1 producer/reader/installer lock/capability amendments (usage/live/scope/gate/fold/cost/export/sync), subprocess lifetime/journal/Git recovery and platform closure fixtures, immutable input publication; preserve v1 amendments to estMin lookup, startedAt emission and work_item_level alignment; refresh catalog docs; SPIKE-1 real Claude Agent/Workflow child-path, concurrent and main/worktree fixtures |
| M1 | Core | schemas, transactions/recovery, identity/migration/bindings, observations/timeline/metrics/report, CLI/git backfill; fixtures/manifests; feature handoffs/human acceptance and scout opt-in |
| M2 | Claude hooks | SPIKE-1 capability fixtures prerequisite; guard/binding/full-message resolution, installer/doctor/semantic remove, bootstrap/ignore upgrades/shared sync; no Copilot/live markers |
| M3 | Automation | bound plan/scoring/outcomes, required-N gate proof/landing, snapshot-only batch/case cost computation and atomic provenance/accounting bundle with complete parent/shared window proof, drift retry, calibration/reference log and playbook; no raw/task-cost reader |
| M4 | Presentation + PR history | self-contained HTML, archived JSON, mapped paginated gh backfill; no forecasting |

Each milestone includes its tests and §12 gates; M1 CLI/git usable on any host without hooks or tokenomics. M-1’s retained compatibility changes require source checks at implementation (§16); this spec edit does not modify those files.

## 14. Open questions

1. SPIKE-1 must pin Claude direct-child path availability and legacy fallback in linked worktrees. Unsupported shapes stay unknown; M2 cannot promise coverage before concurrent-dispatch fixtures pass.
2. Hand-curated Claude marketplace entry remains a maintainer decision at M1 review.
3. Copilot needs a separate store adapter spec: `TOK/hooks/telemetry-capture.mjs:502-527` reads session events.jsonl, correlates data.toolCallId and completed-event durationMs. Those are **not hook payload fields**; no speculative stop/start fallback ships (§18).

## 15. Consistency check against §2

| Promise / changed decisions | Contracts → implementation → checks |
|---|---|
| Lossless observation/occurrence/revision D4–D7 | §6.1–6.3/6.9 → transactions/events/timeline M1 → v2 F1–F3 retraction/conflict/byte-recovery tests, AC-4/11/17 |
| Claude only, roster/session binding D15–D18 | §6.6/9 → hosts/installer M2 → F6/F8/F9/F21 tests, AC-2/4/5 |
| Honest gate/scope/parent clocks D2/D6/D7 | §5/6.8–6.10 → automation/timeline M3 → F2/F3/F12 tests, AC-8/12 |
| Accepted ranged inputs, valid zeros D9/D12/D22 | §6.3–6.4/6.10/9 → schema/templates/metrics/calibration → v2 F5 actual-boundary + v3 F1 complete contribution tests, AC-10/13/14 |
| Separate episode age D7/D22 | §6.9–6.11 → timeline/metrics/report/calibration M1 → v2 F6 tests, AC-18 |
| Shared participant compatibility | §6.1/6.12 → §10 amendments M-1/M3 → v2 F4 concurrency/provenance + v3 F2 subprocess/recovery tests, AC-14/16 |
| Existing batch/case cost only D1/D20 | §6.12 → tokenomics-join/export provenance M3 → F13 + v3 F1 parent/shared window tests, AC-10/14 |
| Cutoff/cohorts/bounded history | §6.7/6.9–6.11 → git/report M1/M4 → F10/F19 tests, AC-3/7/15 |
| Facts-only, no forecast/Little’s Law | §2/8/11/13/18 → F18/F22 tests, AC-6 |

Round 3 strengthens §6.1/§6.4/§6.12 contracts without changing §2 or §3; §19.3 records both findings. §2 and §3 changed in round 2; each affected finding is marked in §19.2 (round 1 remains §19.1). Orphan placement, hierarchy, ledger location, source ordering, opt-in hooks, git backfill, declared ranges, no ranking and no DORA remain. Source ordering is within equivalent observations, never proxy versus measured clocks. Removed capabilities are explicitly parked (§18); no milestone silently restores them.

## 16. Repo facts relied on that the reviewer should re-verify

- `bundles/SPEC.md:291-297` roster/legacy policy, `:298-304` shared folder wording (P-0/P-1).
- `TOK/hooks/telemetry-capture.mjs:75-94` identity; `:187,440-447` start exists but live line writes end only; `:328-333,608-620` metadata/full-message; `:1339` direct repo selection; `:502-527` Copilot store adapter.
- `TOK/scripts/install-hooks.mjs:145-158` Copilot registrations; `:305-311` inner ignores; `:517-532` ignore rewriting not byte-preserving.
- `TAW/scripts/gate/gate-case.mjs:191-221` both log paths/fields; `TAW/references/orchestration-playbook.md:200-210` separate N calls then landing.
- `TAW/references/campaign-planning.md:254-280` mutable State/Log versus approved Plan.
- Shared writer/reader anchors: `TOK/hooks/telemetry-capture.mjs:120-123,450-452,530-532,632-652,1403-1419,1432-1454`; `TOK/scripts/work-scope.mjs:54-102`; `TOK/scripts/batch-cost.mjs:161-171,724-745`; `TOK/scripts/build-tokenomics-export.mjs:165-180`. These existing functions lack the proposed §6.1 participation contract; M-1/M3 amend them.
- `TOK/scripts/batch-cost.mjs:439-459,565-586,617-625,645-707` generation guard, allocation/export/provenance; `TOK/scripts/team-report.mjs:62-73` host-qualified dedup.
- Round 3 accounting/lifetime anchors: `TOK/scripts/batch-cost.mjs:511-568` parent/dispatch allocations; `TOK/hooks/telemetry-capture.mjs:752-754` parent clocks/session total; `:1470-1488` and `TOK/scripts/install-hooks.mjs:474-487` child Git operations. `R01:411-415,560-565,298-303` grounds these contracts; accounting manifests and process journals are proposed amendments, not existing fields.
- Retained M-1 amendments: `TOK/scripts/batch-cost.mjs:344` reads estimated_active_minutes/est_min, not scorer estMin; `TOK/templates/factory-profile.template.json:8` says batch while `TOK/scripts/build-tokenomics-export.mjs:66,105` defaults feature; `TOK/hooks/telemetry-capture.mjs:187,440-447` supplies startTs for the proposed startedAt field.
- `AS/scripts/score-cases.mjs:381-388,466-472` confidence/bounds; `TOK/scripts/work-scope.mjs:59-101` declaration and mutable outcomes.
- `bundles/feature-development/agents/tech-lead/AGENT.md:181-201` task template; `bundles/feature-development/agents/project-manager/AGENT.md:95` squash/delete branch.
- Research: `R05:220-247` measured start/windows/human ownership/honesty; `R03:120-140,425-429` confidence/clock granularity; `R06:293,321` stability requirement/forecast separate feature. Critic inferences fix-dispatch→failed-review and first-green→done are corrected contracts, not facts to copy.

## 17. Acceptance criteria

- **AC-1** Implementation passes npm test/validate, marketplace/dupe and skills-ref gates; frontmatter §4, no tools key.
- **AC-2** Both factory installer smokes place skill without hooks. Claude install/remove preserves unrelated/later edits semantically; inner ignores protect every transient under shared staging.
- **AC-3** Fixed-date temp-git golden: 59 tasks, 30 missions, 33 first completions, 11 rework-proxy items; review completeness/cycle unknown, valid commit_to_done retained; later branch growth unchanged.
- **AC-4** Bound concurrent Claude Agent/Workflow fixtures correlate host/session/agent independently; retries SKIP. Earlier CLI correction wins both arrival orders with git retained.
- **AC-5** No open plan, foreign role, unbound session, malformed payload or unreadable child cannot generate attributed delivery; hooks exit 0. Legacy missing type relaxes role only; Copilot installer exits unsupported.
- **AC-6** No byPerson, mean duration headline, below-floor percentile, invented baseline, forecast or Little’s Law comparison; every volume/speed stratum includes quality or explicit unknown denominators.
- **AC-7** Archived JSON re-renders same content/metadata without recomputation or rewrite.
- **AC-8** Automation writes delivery artifacts only; two gate paths dedup, bound required-N proof and landing for mission done; proxies never enter observed case cycles/throughput; hook/sync order invariant.
- **AC-9** Every metric hand-computed and CLI error path code/exit asserted.
- **AC-10** Accuracy requires timely human acceptance of the exact actual metric/version/start/finish/window digest (§6.4). §12 50 h lead/2 h cycle fixture has unique eligibility, ratio and hit rate; no commit proxy substitution. Parent and complete-contribution active-window examples pass, including contained children with post-landing/pre-declaration or unknown parent work: quote unchanged cost, exclude mission accuracy as `boundary-unknown`, retain independently eligible case accuracy; missing binding/start, zero denominators, points, unknown tiers/probabilities, late/unaccepted/unit mismatch counted.
- **AC-11** Every §12 byte-interruption/recovery fixture preserves prior committed bytes and exactly one parseable created observation; partial tails are durably delimited/counted, never truncated. Manifest publication requires replayable record verification. Remote conflicts retain both heads.
- **AC-12** §5 mixed hierarchy, partial/all cancellation, missing child, scope reopen and overlap rules tested; parent/proxy samples separate.
- **AC-13** No review evidence yields null first-pass. Sub-minute cycles/confirmed zero block survive; retrospective lead exclusion requires evidence. Calibration excludes proxies.
- **AC-14** Generation-bound immutable cost bundle uses exactly the snapshotted input bytes named by its manifest; concurrent drift retries and incomplete publication is excluded. Preserve direct/loaded/freshness/provisional/drift; stale/missing wrapper, incomplete contribution inventory or unmatched active window (including parent remainders/shared allocations) cannot enter accuracy; producer reconciles outputs and pins every contribution/clock/share, delivery validates without recomputing or clipping; no raw live/final/resumed addition.
- **AC-15** Historical replay carries prior starts/blocks, excludes future state, supports no-creation windows and whole/partial conservation; migration counts each stable delivery once.
- **AC-16** Every enabled §6.1 writer/reader/installer participates in `telemetry-lock-v1`; obsolete producer detection, nested contexts, concurrent gate/scope/session/fold/export versus sync/import/export fixtures pass. Caller death never admits a participant while an old Git mutator may survive; §12 pre-spawn/registration/descendant/reboot fixtures retain exclusion, one recoverer proves closure and recovers Git before delivery byte intents or new writes. Indeterminate descendants→LOCK-BUSY, unverified Git state→CONFLICT, neither bypassable by timeout/doctor. No participant dirties an in-progress merge; dormant tokenomics does not suppress delivery sync, offline retry retained. Exact whoAmI compatibility fixtures pass.
- **AC-17** Retraction/reinstatement, wrong-item atomic repair, surviving lower-rank evidence and causal quarantine pass corrected-cutoff/archive fixtures; equal-rank semantic disagreement blocks the occurrence deterministically until explicit repair, equivalent facts coalesce once.
- **AC-18** First-open and reopened ages use separate compatible distributions/floors; repeated reopen keeps history_age and reopen count visible, first throughput remains 1. Reopen calibration uses its own completed-episode cohort, never first-cycle fallback.

## 18. Not in scope / parking lot

- DORA, flow efficiency, benefit ROI, per-person/per-agent productivity, dashboards/uploads/OTel export, story-point velocity and time-in-status heatmaps.
- Native manual-qa wiring and automatic run-field inference; RUN markdown with a canonical block remains registerable (§9.3). Cursor/Kiro/Codex hooks remain out; CLI/git support them. Stop gate for undeclared plans remains future work. Automatic merge webhook capture remains out.
- **F6, resolved by narrowing:** Copilot automatic hook/store capture and live pending start-marker WIP/age on either host. Requires documented host fields, durable correlation/race handling and concurrent fixtures before restoration; CLI/git remain.
- **F13, resolved by narrowing:** raw tokenomics usage/live folding and feature-task/cross-catalogue cost attribution. Existing pinned batch/case exports stay in scope; future adapter needs host-qualified supersession/generation/allocation contracts.
- **F18, resolved by narrowing:** Little’s Law diagnostic. Future work requires time-average WIP, mean residence time, compatible population/units, stability and coverage (`R06:293`).
- **F22, resolved by narrowing:** Monte Carlo campaign completion forecast including P50/P85/P95. Requires labelled API/schema, assumptions, reference population, sampling/termination, seed, scope-change and reproducibility tests (`R06:321`).

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

## 20. Planning amendments

| # | Amendment | Where |
|---|---|---|
| P-0 | Amend `bundles/SPEC.md:298-304` “one subfolder per factory” to include cross-factory concerns (`delivery/`), preserving shared telemetry D3. | M-1 |
| P-1 | Amend `bundles/SPEC.md:291-297` to allow participating-factory roster union for cross-factory hooks, retaining legacy missing-type rule and requiring plan/session binding; changes §3 D16, never substitutes plan-exists for admission. | M-1 |
