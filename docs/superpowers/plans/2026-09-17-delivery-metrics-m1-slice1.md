# delivery-metrics M1 (Slice 1) Implementation Plan (v2)

**Plan version:** v2 — 2026-09-17; round 1 findings resolved below.

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. This version replaces the v1 implementation sketches and their interfaces; do not paste code from v1.

**Goal:** Ship the orphan `delivery-metrics` skill: cycle time, weekly throughput/velocity and declared estimate versus actual per task, mission and campaign, fed by CLI, local git backfill and an opt-in Claude child-completion hook.

**Architecture:** Stdlib modules separate read-byte evidence, observation resolution, effective plan history, timeline replay, metric selection and rendering. Append-only per-user JSONL and ordinary plan/session/profile JSON live in the single shared telemetry submodule. Registration and sync are best-effort; reports expose gaps and limitations.

**Tech Stack:** Node ≥18, ESM `.mjs`, Node built-ins, `git` via `execFileSync`/`spawnSync` without a shell, offline `node --test` fixtures.

**Spec:** `docs/superpowers/specs/2026-09-16-delivery-metrics-design.md` v5.1, §13 M1, with applicable contracts in §§5–6 and acceptance criteria §§12/17. Do not amend the approved spec to reduce M1.

## Global Constraints

1. Zero runtime dependencies; no import of tokenomics production code and no tokenomics writer changes. The three tokenomics amendments belong to M3.
2. Use the repository's physical `bundles/` paths below (the installer/catalog calls these factories). Resolve symlinks before changing a file; do not create duplicate `factories/` content.
3. Delivery writes only its own namespace `.agents/telemetry/delivery/`; the installer may manage the shared telemetry git checkout and its owned ignore blocks. Never write automation records.
4. One `appendFileSync(file, JSON.stringify(record) + '\n')` per observation. No rewrite, fsync, tail repair, transaction manifest, fenced writer, revision-fork control or cross-producer lock. Advisory mkdir lock: 60 s stale rule, no process-exclusion claim.
5. Normalize input timestamps to UTC ISO ms; stored clocks must already be canonical. Compute seconds/unrounded hours internally, round only displayed hours to two decimals. Cutoffs are half-open.
6. Nearest rank: `sorted[Math.ceil(q*n)-1]`; median n≥5, P85 n≥7, P90 n≥10. Always n/min/max; expose raw samples below floors. Velocity needs ≥3 fully covered UTC ISO weeks. No mean duration headline, person leaderboard, forecast or Little's Law line.
7. Scope: M1 state is created/planned → observed build dispatch or first-commit proxy → first done/cancelled. Review, blocked and reopened events are valid records but deferred, without state effects. Rework is a counted historical proxy solely for golden/coverage, not a quality rate. No PR adapter, automation/cost join, calibration writer, HTML, `--from-json`, age-P85 or reopen derivation.
8. Exit 0 success, 1 internal, 2 input/identity/transition/lock/conflict, 3 no measurable plan/events. One stderr line `CODE(detail)`. Hook always exits 0, never stdout. `doctor` always exits 0 and reports findings.
9. SKILL.md keys: `name`, `description` ≤1024 chars, `license`, quoted `compatibility` ≤500, `metadata` authors/version. Name matches directory; no `tools` key. Respect repository vocabulary checks.
10. Every changed script has a sibling test; temp repos, fixed clocks and local remotes only. No tests fetch network or regenerate goldens. Before each commit run the task gate and `npm test`, `npm run validate:factories`, `npm run validate:marketplaces`, `npm run validate:dupes`.
11. Every mutation requests sync in `finally`, including partially successful bulk/registration operations. Local data remains readable when sync fails; report `sync-pending`, never claim remote durability. `DELIVERY_NO_SYNC=1` explicitly disables sync.
12. Required unconditional report/doctor caveats: `writes: non-transactional`, `partial-update: possible`, `capture-loss: possible`, `shared-files: last-writer-wins`, `concurrency: best-effort`, `sync: best-effort`, `acceptance: unauthenticated`, `producer-compatibility: unverified`, `snapshot: non-atomic`, `provenance: unverified`, `association-history: unavailable`. Lost-record/overwritten-update totals are null (unknown), never fabricated zero.
13. Execute on `feat/delivery-metrics-spec` or a task branch off it. Commit only task files; force-add intended `docs/superpowers/` artifacts. This editing round changes only this plan.

## File structure

```text
skills/delivery-metrics/
  SKILL.md, README.md
  scripts/delivery.mjs                         Task 5, command extensions 8/9/12
  scripts/install-hooks.mjs                    Task 12
  scripts/lib/paths.mjs                        Task 1: paths, identity, advisory lock
  scripts/lib/schema.mjs                       Task 2: errors, clocks, record/estimate validators
  scripts/lib/storage.mjs                      Task 2: read buffers/locations/git exclusions
  scripts/lib/events.mjs                       Task 2: append/revisions/semantic facts
  scripts/lib/plan.mjs                         Task 3: IDs, recuts, catalogue, registration requests
  scripts/lib/plan-markdown.mjs                Task 4: bounded importer
  scripts/lib/sync.mjs                         Task 5: best-effort shared git sync
  scripts/lib/timeline.mjs                     Task 6: occurrence selection and M1 replay
  scripts/lib/metrics.mjs                      Task 7: comparisons, strata, coverage and statistics
  scripts/lib/report.mjs                       Task 8: one-read assembly, JSON/Markdown/status
  scripts/lib/git-backfill.mjs                 Task 9: pinned generation history
  hooks/dispatch-hook.mjs                      Task 11
  templates/{delivery-plan.template.json,profile.template.json,plan-block.template.md}
  references/{event-model.md,metrics.md,plan-block.md,host-capabilities.md}
  fixtures/hooks/{manifest.json,probe.md,...}  Task 0 real sanitized probe captures
  fixtures/security-testing/{extract-dataset.mjs,dataset.json,build-fixture-repo.mjs,golden.json}
  scripts/{golden.test.mjs,install-smoke.test.mjs}
  fixtures/offline-installer.mjs               Task 13 local git mirrors/cache helper
  [each production .mjs above has sibling .test.mjs]
skills.json; bundles/{feature-development,test-automation}/factory.json
bundles/feature-development/{instructions.md,agents/{tech-lead,project-manager,scout}/AGENT.md}
bundles/test-automation/agents/{scout,test-automation-lead}/AGENT.md
bundles/SPEC.md; CLAUDE.md; README.md; AGENTS.md
[marketplace files emitted by npm run gen:marketplaces]
```

Execution dependency order: **0 → 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9 → 10 → 11 → 12 → 13**. Task6 is the pure replay prerequisite for Task5 CLI validation; it does not import or edit the CLI. Task numbers retain the review's component mapping.

Shared types and conventions (all tasks use these exact names):

- `Evidence = {path,line,sha256}`; line is 1-based for JSONL, null for JSON. `FileRead = {path,sha256,bytes}`; hash the original Buffer once, before parsing.
- `Located = {record,evidence:Evidence[]}`. Records never gain storage-only fields on disk.
- `Ledger = {active:Located[], conflicts:Conflict[], files:FileRead[], diagnostics:Diagnostic[], counts}`. `Conflict = {code,variants:Located[]}` retains *every* current variant's occurrence, generation, basis and source rank.
- `Diagnostic = {code,path?,line?,detail,count?}`. Counts distinguish a checked integer from null/unavailable.
- `generation = JSON.stringify([campaign_id,run_id])`; `plan_id = campaign_id/run_id/version`, with campaign/run segments forbidden from containing `/` or NUL. Explicit local IDs in blocks are namespaced during catalogue construction: `item_id = JSON.stringify([campaign_id,run_id,local_id])`. Completed blocks retain **local** `item_id`; catalogue/events use qualified IDs. They are separate types, never requalify an event ID.
- `CatalogueRow = {item_id,local_id,ref,level,parent_item_id,story,class,role,model,factory,mission_id,generation,valid_from,valid_until,branch,estimate,integration_ref,sequence,predecessor}`; absent optional values are null. Validity and estimate history survive recuts.
- `PlanRecord = {plan_id,generation,block,items,source:{path,sha256,head},canonical_hash,effective_at,observation_start,source_epoch,participating_factories,roster,status,registration}`. Status is capture-only `open|closed`; earlier versions need not be rewritten to mark them superseded.
- `Registration = {token,request_hash,at,created_at,keep_missing,observations}`; observations are ordinary fully formed event values needed to repeat the request, not a transaction/recovery manifest. A retry appends these same values again through dedup.
- `GenerationView = {generation,plans,endpoint,items,history,aliases,coverage}`. Endpoint is highest effective version at `< end`; history contains effective-dated rows for all stable items, including removed scope. Aliases implement declared injective continuity mappings within a run, never across runs.
- `Item = {item_id,ref,level,parent_item_id,class,role,model,factory,mission_id,sequence,predecessor,state,created,dispatch,first_commit,terminal,estimates,integration,children,scope,flags,evidence,rework_count}`. Clock facts retain `{at,basis,source,meta,evidence}`. `terminal` includes `event`; estimates retain their observation clock and acceptance; absent facts are null.
- `Metrics = {strata,comparisons,scope,coverage,rework_proxy_items}`; `Stratum = {key,population,flow,throughput,accuracy,quality,coverage,evidence}`; keys include generation, level, class, role, model, factory, mission, unit, basis and tier as applicable. Never pool different unit/basis/class/tier in accuracy.

### Task 0: M-1 doc fixes, P-0/P-1 and real SPIKE-1 prerequisites

**Files:** Modify `CLAUDE.md`, `README.md`, `AGENTS.md`, `bundles/SPEC.md`; create `skills/delivery-metrics/fixtures/hooks/{probe.md,manifest.json}` and sanitized payload/parent/child JSONL fixtures.

**Interfaces:** Produces `manifest.json` entries `{name,host_version,source_path,source_revision,source_sha256,fixture_sha256,transformed:true,shape,supported,reason,files}` and the supported correlation/completion rules consumed by Task 11. No hook shape is admitted on the authority of a synthetic fixture.

- [ ] **Step 1: Check docs/catalog and update the orphan prose**

Run the following, enumerate the actual directory names plus `delivery-metrics`, and replace stale counts/lists in the three root docs with that post-change list (avoid freezing external counts into unrelated prose):

```bash
node --input-type=module -e 'import fs from "node:fs"; const r=JSON.parse(fs.readFileSync("skills.json")); console.log(fs.readdirSync("skills").sort()); console.log("externals",r.skills.filter(x=>x.repo).length)'
```

In `bundles/SPEC.md`, change “one subfolder per factory” to “one subfolder per factory or cross-factory concern (`automation/`, `delivery/`)”. Add to the roster guard: an open plan, explicit host/session→plan guard, and role in the union of participating factories' rosters are all required; missing type relaxes only the role check. Preserve existing tokenomics behavior.

- [ ] **Step 2: Perform SPIKE-1 before implementing clock admission**

In a disposable git repo with a harmless one-file task, record `claude --version` and install a temporary SubagentStop capture command that writes stdin to a temp file and prints nothing. Run one Agent task, one Workflow task if supported by that installed version, and two concurrent Agent tasks with the same role but different IDs. Repeat in the main checkout, a Claude-created worktree and `git worktree add <temp>/outside-worktree`. Save hook stdin, parent transcript and each referenced child transcript. Record actual host/version, source path, original byte hashes and the correlation/completion fields in `probe.md`. Delete the temporary capture registration after collecting.

Sanitize content and filesystem/user names in memory, retaining message kinds, IDs, causal links, completion indicators and timestamp ordering. Commit sanitized fixtures and their hashes; original source hashes identify private input bytes, not public attestation. In `manifest.json`, mark missing Workflow support or unrecognized completion shapes `supported:false` with a concrete reason. No real capture available means the positive hook gate is unsatisfied: the implementation must not advertise that shape as measured. CLI/git remain usable; do not substitute invented positive fixtures. No network probe is part of the offline test suite.

- [ ] **Step 3: Pin the probe assertions and tool prerequisites**

Record, for each supported fixture, the exact `(host,session_id,agent_id)` association, normalized first clock, terminal completion clock and worktree owner. Require concurrent children to produce distinct identities. Record the local `skills-ref` executable/version (`command -v skills-ref` then `skills-ref --help`); if absent, install it as a development prerequisite before the final offline gate, not through an `npx` fallback during tests. Production remains stdlib-only.

- [ ] **Step 4: Validate and commit**

Run the four Global Constraint 10 gates; verify every committed fixture hash against manifest bytes with `node:crypto`. Commit the listed docs and sanitized fixtures as `docs(delivery-metrics): M1 prerequisites and pinned Claude probe`.

### Task 1: Skill scaffold, registration, paths and advisory lock

**Files:** Create `SKILL.md`, initial `README.md`, `scripts/lib/paths.mjs`, sibling test and profile template; modify `skills.json`, both factory manifests and generated marketplaces.

**Interfaces:** Export `deliveryDir(repo)`, `planPath(repo,planId)`, `eventsPath(repo,slug)`, `sessionPath(repo,host,session)`, `sha256(buffer)`, `whoAmI(repo) → {user,slug}`, `withLock(repo,fn,{now,staleMs=60000}) → fn result`. `withLock` throws structured `LOCK-BUSY` exit 2; callers must not nest locks.

- [ ] **Step 1: Write failing path/identity/lock tests**

Test `/`, `%`, literal `%2F`, Unicode and `..` path segments round-trip without traversal; host/session pairs cannot collide. Test git username → OS username → email identity precedence and normalization exactly against `bundles/test-automation/skills/tokenomics/hooks/telemetry-capture.mjs` identity function, including renamed user and slug collision (events are still deduped by observation ID). Busy lock exits 2; stale lock is removed once at 60 s; callback throw removes owned lock; missing delivery directory is created. Do not assert mutual exclusion against tokenomics or a live stale holder.

- [ ] **Step 2: Implement paths and scaffold**

Use segment encoding below for filenames; no user input can become a directory separator or dot path:

```js
export const encodeSegment = s => encodeURIComponent(String(s)).replace(/\./g, '%2E');
export const decodeSegment = decodeURIComponent;
export const sessionKey = (host, session) => JSON.stringify([host, session]);
// planPath: join(deliveryDir(repo), 'plans', encodeSegment(planId) + '.json')
// sessionPath: join(deliveryDir(repo), 'sessions', encodeSegment(sessionKey(host,session)) + '.json')
```

Create the lock directory with nonrecursive `mkdirSync` after creating its parent. On EEXIST compare injected now with lock mtime; below 60000 throw `{code:'LOCK-BUSY',exit:2}`, otherwise remove and retry mkdir once. Release only after acquisition in `finally`; explicitly document stale-holder races.

SKILL.md initial content:

```yaml
---
name: delivery-metrics
description: Track declared delivery plans, observed task cycle time, UTC weekly throughput and accepted estimate ranges. Use for registering work, recording completion, delivery status, reports and opt-in Claude capture.
license: MIT
compatibility: "Node >=18 and git; CLI on all installer hosts; automatic capture on supported Claude fixtures only."
metadata:
  authors: sdlc-skills
  version: "0.1.0"
---
```

Body names register → session set → event → backfill → report and the separate opt-in installer. README states local/best-effort storage and M1 exclusions. Profile template is `{capturePrompts:false,zeroDurationSec:60,minWholeWeeks:3,baselines:{cycle_time_task_h:null,throughput_task_per_week:null,first_pass_rate:null,hit_rate:null},tokenomics:"auto"}`; tokenomics remains unused in M1.

Append registry entry `{id:'delivery-metrics',monorepo:'sdlc-skills',name:'delivery-metrics',description:'Cycle time, velocity and declared estimate comparisons'}` and add to both factory `skills` arrays, not localSkills. Run `npm run gen:marketplaces`; preserve any hand-curated Claude catalog entry and add the orphan there if that catalog explicitly enumerates skills.

- [ ] **Step 3: Validate and commit**

Run `node --test skills/delivery-metrics/scripts/lib/paths.test.mjs`, then global gates. Commit only Task 1 files as `feat(delivery-metrics): scaffold, catalog and advisory paths`.

### Task 2: Validated observations, read-byte evidence and current revision resolution

**Files:** Create `scripts/lib/{schema,storage,events}.mjs` and their sibling tests.

**Interfaces:** `schema.mjs`: `fail(code,detail)`, `iso(value)`, `validateEstimate(value)`, `validateRecord(record)`. `storage.mjs`: `readInputs(repo) → {ledgerRows,plans,profile,files,diagnostics,counts}`; each plan/profile read retains Buffer/hash/value; `gitState(dir) → {unmerged,unfinished,locks,dirty,unpushed,available}`. `events.mjs`: `makeObservation(fields,{now})`, `semanticKey(record)`, `factKey(record)`, `resolveObservations(locatedRows) → {active,conflicts,duplicates}`, `appendObservation(repo,record,{slug}) → {result:'EVENT'|'SKIP',observation_id,revision,path}`. Readers use `readInputs` once; resolution never rereads disk.

- [ ] **Step 1: Write adversarial schema/read/revision tests**

Use two user files containing identical observations and differing capture clocks; expect one active and duplicate count 1 with both locators. For one ID: unequal rev0 records → current conflict, adding unique rev1 → active rev1/no current conflict, retracting rev2 → no active and lower source reconsidered later. Test both arrival orders. A conflicting current CLI revision must carry both occurrence candidates through resolution, not disappear. Reusing `TASK-001`, retry token `done-001`, and merge SHA in two runs must create distinct IDs; build/review facts must disagree. Different raw labels/paths alone coalesce while retaining evidence.

For each of negative revision, absent at, non-ms stored timestamp, illegal source/event/basis/status, invalid estimate, wrong computed ID, malformed generation and illegal null item/ref, append rejects exit 2 and read skips one row with its path/line. Write invalid UTF-8 bytes `[0xc3,0x28]`, torn JSON, unknown version 99 and a valid record at EOF without newline; expect malformed=2, unknown-schema=1, valid EOF readable. Append directly to a torn tail; the joined invalid line stays excluded and unmodified. Mark an event file unmerged in a local git fixture; exclude the whole file before JSON parsing and count one unresolved source.

- [ ] **Step 2: Implement common validation and semantic identity**

`fail` sets `.code` and `.exit` (2 except NO-PLAN/NO-EVENTS=3); flatten newlines in final CLI error rendering. `iso` validates that a date parses and returns `new Date(value).toISOString()`. `validateRecord` requires `iso(r.at)===r.at` and the same for recorded_at. `makeObservation` normalizes clocks before calling it. Require all §6.2 fields/types; v=2; revision integer ≥0; finite estimate bounds ≥0 and low≤high, unit h/active_min, tier ROM/budgetary/calibrated/unknown, proposer/time, optional probability strictly (0,1). A partial acceptance pair is retained as unaccepted; malformed supplied clock/name fails. Calibrated requires `{reference:{path,sha256,population}}` with nonempty path, 64 hex hash and explicit nonempty population. Cases are schema-valid but not created by M1 feature-plan import. Null item/ref/level is allowed only together for admitted unattributed hook dispatched/dispatch_ended with `meta.admitted===true`, host/session/agent correlation and generation.

Identity is injective and generation-qualified without altering the tuple contract:

```js
const enc = x => encodeURIComponent(String(x));
export const observationId = r => [r.source,r.source_record_id,r.item_id ?? 'unattributed',r.event].map(enc).join(':');
export const sourceToken = (generation, token) => JSON.stringify([generation, token]);
export const canonical = v => JSON.stringify(sort(v));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));
  return v;
}
export function facts(r) {
  const m = {...(r.meta ?? {})};
  for (const k of ['evidence','path','sha256','capture','diagnostic']) delete m[k];
  // Unknown semantic fields stay in m: uncertain equivalence cannot coalesce.
  return {at:r.at,event:r.event,stage:r.stage ?? null,estimate:r.estimate ?? null,
    role:r.role ?? null,model:r.model ?? null,meta:m};
}
export const factKey = r => canonical(facts(r));
export const semanticKey = r => canonical({plan:r.plan,generation:r.generation,
  item_id:r.item_id,ref:r.ref,level:r.level,transition_id:r.transition_id,
  source:r.source,source_record_id:r.source_record_id,revision:r.revision,
  status:r.status,basis:r.basis,facts:facts(r),session:r.session,agentId:r.agentId,host:r.host});
```

The record validator includes `stage`, generation, host/session/agent, optional role/model, and checks source_record_id against the generation-qualified adapter token convention. Stage is a semantic transition fact. `meta` includes episode, causal, interval, review, result, gate, disposition, integration and source commit facts; only explicit capture/provenance envelope keys above are ignored. CLI/git completion producers use the same `transition_id = JSON.stringify([item_id,'done','episode-1'])`; dispatch occurrences use host/session/agent tokens, not the done token.

- [ ] **Step 3: Implement byte reads and highest-revision selection**

`readInputs` lists delivery event/plan/profile paths once; for each, read Buffer once, hash Buffer, retain `FileRead`. Obtain unmerged paths via `git ls-files -u -z` and skip these paths even if their content looks parseable. Split JSONL Buffers on byte 0x0a; decode each nonempty slice with `new TextDecoder('utf-8',{fatal:true})`. Decode/JSON/schema failure produces malformed-lines with path/line; unknown v produces unknown-schema instead. Complete EOF JSON is accepted. JSON plan/profile decode/schema failures produce separate diagnostics; do not substitute a default profile while claiming its malformed bytes were valid. Missing profile uses explicit default with `profile_source:null`. Preserve files' hashes even when parsing fails.

Group `Located` records by observation_id, select only max revision, then group those by semanticKey. One semantic group: concatenate evidence, return active unless retracted. More than one: return `{code:'CONFLICT',variants:[...all distinct current variants]}`; historical conflicts do not quarantine a corrected higher revision. Count semantic retries independently of current conflict count. Do not apply cutoff before revisions.

`appendObservation` validates, takes the advisory lock, reads all readable user rows for this ID/revision, returns SKIP on matching semantics, rejects differing semantics at the same revision as ID-CONFLICT, otherwise appends exactly once. A lower historical retry after retraction may SKIP or append if absent, but never changes the max-revision reader result. Do not discard lower-ranked source evidence on append.

- [ ] **Step 4: Validate and commit**

Run `node --test skills/delivery-metrics/scripts/lib/{schema,storage,events}.test.mjs`, global gates; commit `feat(delivery-metrics): validated ledger and revision evidence`.

### Task 3: Plan tree, migration, registration request and effective history

**Files:** Create `scripts/lib/plan.mjs`, sibling test and `templates/delivery-plan.template.json`.

**Interfaces:** `extractPlanBlock(text) → block`; `completePlan(block,previous,{at}) → completedBlock`; `toCatalogue(block,{at}) → CatalogueRow[]`; `validateRecut(previous,next) → aliases`; `planDelta(previous,next,{keepMissing,terminalById}) → {added,removed,changedEstimates}`; `registrationObservations({record,delta,creation,now}) → Record[]`; `savePlan(repo,record)`; `listPlans(repo) → PlanRecord[]`; `generationView(planRecords,{end}) → GenerationView[]`; `activeCapturePlan(planRecords,generation,{now}) → PlanRecord|null`. `creation` maps qualified item IDs to `{at,basis,sha:null|string}`. All Task 5/8/9 consumers use these signatures.

- [ ] **Step 1: Write tree/recut/estimate tests**

Register one campaign, two missions and three tasks. Reject duplicate refs within plan context, explicit duplicate local IDs across levels, invalid source epoch, multiple parents, ancestor-ID reuse and cycles after completion. Generated IDs must distinguish refs `A/B` and `A-B`. Test generated IDs retained across versions and run-qualified catalogue IDs distinct across two runs. Validate every local→qualified lookup, not only task refs.

Recut v1→v2 at Sep 16 12:00: unchanged task keeps pre-v2 created/dispatch/done/estimate; changed class/membership applies only after 12:00; v1 remains reportable before 12:00. Recut missing explicit at, unrelated supersedes.plan_id, missing claimed continuity, nonexistent old/new map endpoints, noninjective targets and a cycle all fail MIGRATION-REQUIRED/SCHEMA-INVALID. Split one task into two new IDs with `lineage` only: neither receives old done. Removing done preserves historical completion; removing active cancels it at recut unless keepMissing; keepMissing retains its row and ancestry in the completed block. Re-add cancelled item retains history but cannot start an M1 second episode (deferred limitation in Task 6).

Range 1–3 h accepted Sep 14 → range 1–5 with the same acceptance pair fails; same range with unchanged acceptance is valid. New range with cleared acceptance is unaccepted. New accepted pair at Sep 15 is valid. Calibrated without saved reference fails. Changing proposal must not overwrite original accepted history.

- [ ] **Step 2: Implement IDs, catalogue and migration**

Require explicit campaign/run/version/factory/observation_start/source_epoch with integration_ref; `from<until` if until supplied. Factory list is `participating_factories` or `[factory]`, deduped. Fill missing local IDs with the reversible tuple below, not a lossy slug. Preserve explicit IDs; validate uniqueness again after assignment. Require campaign→mission→task structure; optional case rows must respect task→case, but no M1 importer synthesizes them. Validate predecessor refs and acyclicity separately from containment.

```js
const generatedLocalId = (level, ref) => JSON.stringify([level,ref]);
const qualifiedId = (b, localId) => JSON.stringify([b.campaign_id,b.run_id,localId]);
const generationOf = b => JSON.stringify([b.campaign_id,b.run_id]);
const planIdOf = b => `${b.campaign_id}/${b.run_id}/${b.version}`;
```

Re-cut must name the actual immediately preceding version in this run and have later version/effective_at. Require `supersedes.item_id_map` for every explicitly claimed continuous item, including identity entries for unchanged IDs. Check source and target exist and targets injective. A stable ID retained without an explicit identity mapping is an error; new IDs without mappings mean new work. Store maps in local-ID form in block, qualify both ends for replay. Follow aliases only forward with cycle checks; map history onto the endpoint target once. Split/merge lineage is metadata, never an alias. Removed rows remain in `history` with closed membership validity, and retain historical ancestor context. No cross-run mappings.

Catalogue carries all shared-type fields, generation and validity. `generationView` groups by generation, ignores future-effective versions, applies aliases to history/events, selects endpoint membership/class/parent for currently present items, and keeps last-effective membership for removed historical items. Preserve raw evidence identity alongside resolved item_id. Independent runs return separate views. `activeCapturePlan` is the latest version effective at or before injected now in the run if its status is open; an explicitly closed latest version does not reactivate older open versions. Resolve session bindings to the active version in the same run or require rebinding after close, never capture against a superseded tree.

- [ ] **Step 3: Persist reproducible requests and estimate deltas**

Compute canonical_hash over completed block (sorted object keys, array order retained); source.sha256 is separately the source file's raw-byte hash. request_hash covers normalized submitted block, token, explicit at/created-at options and keepMissing, **not** generated current time; stored registration.at/created_at are reused on retry. Material estimate key is `[unit,low,high,tier]`; if it changes, reject identical complete prior acceptance pair or accept a new/cleared pair. Metadata-only edits do not fabricate a new accepted range.

Store `registration.observations` before appending any events. Each generated observation uses source cli, sourceToken(generation, `[token,local_id,event]`), created/done episode conventions and full stable clocks. `terminalById` is a Map from the prior version replay at registration.at (including equal-time existing terminal facts) to terminal event or null; unit tests pass this map explicitly. A conflicting/invalid prior terminal prevents a removal decision with CONFLICT rather than guessed cancellation. Generate created only for genuinely new items; estimated for proposals/acceptance changes; cancelled only for removed nonterminal scope. Do not re-emit a new created clock for unchanged items. Retry loops over the **stored** complete observation list, regardless of catalogue delta. This is ordinary request data; no pending-state machine or automatic gap recovery.

- [ ] **Step 4: Validate and commit**

Run `node --test skills/delivery-metrics/scripts/lib/plan.test.mjs`, global gates. Commit `feat(delivery-metrics): generation history and retryable registration`.

### Task 4: Bounded tasks Markdown importer

**Files:** Create `scripts/lib/plan-markdown.mjs` and sibling test.

**Interfaces:** `parseGroups(text) → [{ref,tasks:string[]}]`; `importTasksMarkdown(text,{campaign_id,run_id,version,factory,observation_start,source_epoch}) → block`. Export parseGroups for Task 10. No estimates inferred.

- [ ] **Step 1: Write the exact parser counterexamples**

```js
const md = `Outside: G99 099 not a declaration
## 1. Execution plan
\`\`\`
G0   001 docs (M-1)                                   055 hook probe (independent, any time)
G1   003 normalize · 004 redact
G2   002 canon (needs 004: writeArtifact → redactDeep)
     032 purge · 058 snapshot · 059 register
\`\`\`
## 5. Technical tasks
#### TASK-001: Docs
**Story:** US-001 · **Complexity:** S · **Assigned to:** js-dev
#### TASK-055: Probe
#### TASK-003: Normalize
#### TASK-004: Redact
#### TASK-002: Canon
#### TASK-032: Purge
#### TASK-058: Snapshot
#### TASK-059: Register
#### TASK-099: Unassigned
`;
assert.deepEqual(parseGroups(md), [
  {ref:'G0',tasks:['TASK-001','TASK-055']},
  {ref:'G1',tasks:['TASK-003','TASK-004']},
  {ref:'G2',tasks:['TASK-002','TASK-032','TASK-058','TASK-059']}
]);
```

Assert importer puts only TASK-099 in a synthetic `ungrouped` mission with a warning; no G99; no duplicate TASK-004. Add missing execution heading/fence and duplicate membership failures. Parenthetical numbers never count. Unknown task declaration fails rather than silently dropping it. Test CRLF and continuation indentation.

- [ ] **Step 2: Implement the bounded parser and heading fields**

```js
export function parseGroups(text) {
  text = text.replace(/\r\n/g, '\n');
  const section = /^##\s+1\.\s+Execution plan\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(text)?.[1];
  const block = section && /^```[^\n]*\n([\s\S]*?)^```\s*$/m.exec(section)?.[1];
  if (!block) fail('SCHEMA-INVALID','execution plan fence missing');
  const groups = []; let current = null;
  for (const line of block.split('\n')) {
    const m = /^(G\d+)\s+(.*)$/.exec(line);
    if (m) { current = {ref:m[1],tasks:[]}; groups.push(current); }
    else if (!/^\s+\d{3}\s/.test(line)) { current = null; continue; }
    if (!current) fail('SCHEMA-INVALID','orphan continuation');
    const body = (m ? m[2] : line).replace(/\([^)]*\)/g, '').split('←')[0];
    for (const t of body.matchAll(/(?:^|·|\s{2,})\s*(\d{3})(?=\s|$)/g)) current.tasks.push(`TASK-${t[1]}`);
  }
  const all = groups.flatMap(g=>g.tasks);
  if (new Set(groups.map(g=>g.ref)).size !== groups.length || new Set(all).size !== all.length)
    fail('SCHEMA-INVALID','duplicate group/member');
  return groups;
}
```

Import `fail` from schema. Bound each `#### TASK-NNN:` section by the next task/heading. Read Story, Complexity and Assigned-to/Assigned to fields only within that section; preserve exact ref, title, role and class, and declared branch aliases. Compare group members with the heading set. Add ungrouped only for headings absent from group members. Complete and validate the resulting tree through Task 3; source hash stays the original markdown bytes. CLI prints the complete proposed block on dry-run; a noncanonical import without `--yes` exits USAGE and prints no writes. No parser guessing outside this supported grammar.

- [ ] **Step 3: Validate and commit**

Run `node --test skills/delivery-metrics/scripts/lib/plan-markdown.test.mjs`, global gates; commit `feat(delivery-metrics): bounded execution-group import`.

### Task 5: CLI mutations, registration retry and bounded shared sync

**Files:** Create `scripts/delivery.mjs`, `scripts/lib/sync.mjs`, sibling tests. Task6 must already have passed its pure-module gate in the dependency order above. Import its selectOccurrences/buildTimelines/validateTransition functions; no transition-validation bypass or pending test is permitted.

**Interfaces:** `main(argv,{repo,now,stdout,stderr,env}) → Promise<number>`; `parseArgs(argv) → {command,args,flags}`; `resolvePlanId(records,flag,{now}) → plan_id`; `bestEffortSync(repo,{env}) → {status,diagnostics}`. Commands in this task: plan register/list/show/close, session set, profile set, event single/JSONL. `event --transition` optional only where episode-1 or host dispatch identity is unambiguous; otherwise AMBIGUOUS-TRANSITION. Revisions/retractions use full replacement records and ordinary higher revision, without a fork-control API.

- [ ] **Step 1: Write CLI/registration/error fixtures**

Register canonical v1 with fixed now, repeat identical token/block/options one hour later: exit0, same completed ID-bearing block, all SKIP and byte-identical event file. Different same token/body exits ID-CONFLICT. Inject failure immediately after savePlan and before first append via a test-only injected registration append callback; retry emits all saved observations once. Inject failure after first append; retry skips first and emits remaining. Different token/same already-registered version is rejected; stale version rejected only after identical request recognition. Recut v2 requires explicit --at and new accepted pair if range changes. Unqualified event resolves one active generation, never two historical versions; two independent open runs are AMBIGUOUS-PLAN.

Use an old committed plan file: TASK-001 present in commit A, TASK-002 added commit B. For default creation either resolve first containing commit individually or use observed registration time; this plan chooses **observed registration time** unless explicit --created-at is provided. Assert TASK-002 never gets A's file-addition clock. Git backfill later adds its independently labelled plan-commit proxy from B. Registration output states `creation-basis: observed` or `explicit`; it never claims a file-addition clock.

Invalid date, malformed bulk JSON, negative revision, unknown flag, invalid event and LOCK-BUSY each exit2 with a single CODE line. Bulk first valid row followed by invalid row leaves first row readable and still requests sync. `--sha` resolves full SHA/committer clock; differing --at without correction fails; with explicit revision>0 and an existing lower revision of that observation it records correction time while retaining git SHA and original committer time in meta. Missing earlier revision is not a correction. Test same semantic retry after correction.

- [ ] **Step 2: Implement dispatch and registration in this order**

Parser has explicit allowed flag sets; reject unknown/missing option values and unsupported M2+ commands, rather than ignoring them. Convert JSON parse and timestamp/schema exceptions to SCHEMA-INVALID/USAGE (2), preserving unexpected I/O/internal errors as 1. Normalization happens before identity comparison. Mutating command execution uses the following envelope:

```js
let result = 0;
try { result = await command(); }
catch (e) { stderr.write(`${e.code ?? 'INTERNAL'}(${String(e.message).replace(/[\r\n]+/g,' ')})\n`); result = e.exit ?? 1; }
finally {
  if (isMutation) {
    const sync = bestEffortSync(repo,{env});
    for (const d of sync.diagnostics) stderr.write(`${d.code}(${d.detail})\n`);
  }
}
return result;
```

`command`, `isMutation`, repo/env/stdout/stderr are local dispatcher values. Sync failure does not overwrite the mutation's exit code. The injected append callback is a function parameter on the internal register handler, never a production CLI crash flag.

Registration: read submitted bytes once → parse/import → normalize → lookup `(generation,version,token)` → compare request_hash **before** stale-version check → retry stored observations if equal → otherwise validate new version/mapping/acceptance → resolve participating factory rosters from installed factory metadata (or declared verified roster snapshot supplied in canonical plan) → replay prior generation at registration.at inclusive (pass end=at+1ms) and extract terminalById → complete block/catalogue/delta with that map → set observed creation clocks/explicit clocks → construct registration observations → save ordinary plan JSON → append list sequentially. Print `PLAN <plan_id> events=N skipped=N` and the completed fenced block. Dry-run returns this preview without saving/appending/sync. Factory roster names must be actual roles in those participating factories; do not fill roster from every installed agent.

`session set` writes `{host,session,plan}` after resolving active capture plan. Plan close only changes capture status. Profile set validates known keys, types and null baselines, then writes ordinary JSON. Event builds qualified IDs from plan context and uses sourceToken; never embeds wall clock in a retry token. Single event and each bulk row both call validateRecord then Task6 validateTransition before append, using fresh readable state after the preceding bulk row. Identical retry is checked before transition validation so an existing terminal retry remains SKIP. Candidate validation uses an end beyond the latest relevant existing/candidate occurrence, not current wall time, so backdated edits cannot silently invalidate later readable state. Add all Task6 invalid-chain counterexamples as CLI exit2/no-append tests here.

- [ ] **Step 3: Implement best-effort sync without resolving conflicts**

Use telemetry checkout only if it is an initialized git submodule. Plain-dir records remain local-only with `sync-pending: telemetry setup required`; do not claim committed data. On each invocation, before any staging or merge, inspect `ls-files -u`, MERGE_HEAD, rebase-merge/rebase-apply, CHERRY_PICK_HEAD, REVERT_HEAD and git lock files via `git rev-parse --git-path`. If any unresolved/interrupted state exists, return pending/manual-repair untouched. Otherwise:

```text
1. git add -A in telemetry; git diff --cached --quiet; commit only when nonempty.
2. git push origin HEAD:telemetry.
3. On push failure, recheck unresolved state. Fetch origin telemetry once.
4. If fetch succeeds and state remains clean, git merge --no-edit FETCH_HEAD.
5. If merge fails/conflicts, stop; leave conflict state and report manual repair.
6. If merge succeeds, push origin HEAD:telemetry once more. Failure => pending.
```

Use bounded subprocess timeouts; timeout means state unknown/pending, not proof the Git child stopped. No reset, conflict-marker cleanup, auto-`git add` after merge failure, or unbounded loop. `DELIVERY_NO_SYNC=1` returns disabled. Run sync after hook appends too. Persist best-effort diagnostic records under delivery; diagnostic write failure cannot recursively invoke sync. Do not infer zero lost records.

- [ ] **Step 4: Test offline and two-writer retry; commit**

In temp repos use a bare local origin and two telemetry clones. Writer A pushes an event file; B commits a different user file, its first push rejects, fetch/merge/retry succeeds and both records remain. Conflicting edits to one ordinary plan file leave unmerged entries, no resolving commit and pending diagnostics on two subsequent invocations. Set origin to an absent local path, append, assert local record survives; restore origin and next invocation pushes. Assert partial bulk failure still attempts sync. Run CLI/sync tests and global gates; commit `feat(delivery-metrics): CLI requests and bounded telemetry sync`.

### Task 6: Conflict-aware occurrence selection, M1 replay and parent boundaries

**Files:** Create `scripts/lib/timeline.mjs` and sibling test. Execute this pure task before Task5; Task5 owns CLI integration and CLI tests.

**Interfaces:** `selectOccurrences({active,conflicts},view) → {occurrences,conflicts}`; `buildTimelines({selection,view,end}) → {items:Map,diagnostics,deferred_events,invalid_chain}`; `validateTransition({ledger,view,record,end}) → void`. Items use the shared type; functions consume Located evidence without losing source facts.

- [ ] **Step 1: Write occurrence and M1 transition tests**

CLI done at 11:00 and git done at 12:00 for same episode: CLI wins both append orders; git remains stored. Current conflicting CLI rev0 blocks git fallback; unique CLI rev1 clears it. Conflicting CLI variants naming two different occurrences quarantine both at CLI rank. A conflict at git rank does not defeat an unrelated valid higher CLI winner. Same-source/equal-rank build-versus-review dispatch disagreement is CONFLICT. Retraction withdraws only its source; surviving git can win.

Only observed `stage:'build'` dispatched starts measured cycle. Review/fix/gate/other and proxy build dispatch do not; first_commit sets proxy WIP only. A terminal followed by later dispatch is invalid-chain and does not move start; cancelled→done, done→cancelled and a second done occurrence are invalid in M1 even with a deferred reopened event. Same-time done/cancelled without causal order invalidates both, never string-order winner. Explicit causal links topologically order compatible created/build/done ties; cycles/missing required predecessor quarantine dependants. History validator rejects the same chain for CLI before append; identical retries remain SKIP. Store deferred review/block/reopen records and increment deferred-events, with no state changes.

- [ ] **Step 2: Select occurrences with conflict rank blockers**

Map qualified history through view.aliases, retaining original plan/item IDs in evidence. Key occurrence by `[generation,resolved_item_id,transition_id,basis]`; adapters create transition IDs from stable local occurrence tokens so the same occurrence survives aliases (resolve embedded item component to resolved_item_id). Group active variants and each conflicting variant's blocker. Within each group, choose best numerical source rank (`cli=0,automation-sync=1,hook=2,git=3`); if a blocker exists at that rank, quarantine group. Otherwise compare factKey at the winning rank: one fact group coalesces all provenance; multiple groups CONFLICT. Lower evidence remains in selection provenance but cannot fill a quarantined occurrence. Different bases stay separate.

Replay corrected selected occurrences with at<end, first by effective time then explicit causal topological edges. Observation ID sorts only commuting events. Detect incompatible ties as a set before applying any of them; do not commit one terminal then ignore the other. Missing predecessor caused by conflict/retraction invalidates dependent event with its evidence. `validateTransition` resolves candidate plus full readable history, allowing a correction to replace its earlier revision; if candidate introduces conflict/invalid-chain, throw INVALID-TRANSITION or CONFLICT. Never delete previously readable observations.

- [ ] **Step 3: Implement Item state and parent reduction**

Leaf replay stores earliest valid created, first observed build dispatch before terminal, earliest first_commit, first done/cancelled, estimate history and rework proxy count. Deferred set is review_requested/review_returned/review_approved/review_history/blocked/unblocked/reopened/scope_declared/gate_observed/outcome_observed; dispatch_ended is activity evidence; rework_observed is a proxy count, not a state transition. A done clock earlier than its dispatch may be retained as contradictory metric evidence (`clock-skew`) rather than inventing a negative cycle; it still counts first completion, while a dispatch that *arrives later in effective history after terminal* is invalid. Distinguish this using explicit causal edge/episode association; unrelated later dispatch cannot retroactively create a skewed first cycle.

Bottom-up parent rules:

```text
start = earliest eligible observed build start among descendant tasks, never parent dispatch.
children = required endpoint children plus historical removed children with terminal facts.
unknown child or any nonterminal required child => parent open (explicit done gets PARENT-INCOMPLETE).
all children cancelled => parent cancelled at max child cancellation, delivered count 0.
some delivered, others cancelled => partial-cancelled count; cancellation clocks participate in max.
mission completion => all required children terminal AND observed integration evidence for declared base.
campaign completion => all required missions terminal; their verified landing boundaries are its evidence.
finish = max(all child terminal clocks, required integration clock).
```

Mission integration evidence is an explicit observed done with `meta.integration={ref,sha}` matching declared base, or an independently qualified git landing observation; merely all child done is insufficient. An early parent explicit done supplies integration clock but cannot shorten finish below latest child terminal. A parent done is not a leaf done; retain its fact while deriving the boundary. Removed delivered child remains in historical scope and is never cancelled by removal. Recut adds required work: preserve first qualified completion and throughput=1, report `scope_changed`/current pending scope separately; M1 does not invent reopened episodes or their metrics. Re-added cancelled items and deferred reopens print `episode derivation: deferred (M2)`; first-cycle figures remain labelled as such.

- [ ] **Step 4: Test parent cases and commit the pure replay prerequisite**

Fixtures: children done 11:00/12:00 with landing absent → parent open; landing 13:00 → parent done13:00; landing10:00 → parent done12:00; descendant starts09:00/10:00 and explicit parent dispatch08:00 → parent start09:00. One cancelled12:30 plus one delivered12:00 and landing13:00 → partial-cancelled=1, finish13:00. All cancelled → cancelled/no throughput. Removed delivered child retains done. Unknown child blocks parent. Campaign with an unfinished mission stays open. Exercise validateTransition directly for every Step1 invalid chain and same-ID retry. Task5 repeats these through the CLI. Run timeline tests and global gates; commit `feat(delivery-metrics): M1 replay and evidenced parent completion`.

### Task 7: Precise metrics, per-item comparisons, strata and declared coverage

**Files:** Create `scripts/lib/metrics.mjs` and sibling test.

**Interfaces:** `secondsBetween(a,b)`, `stats(values)`, `weekKeys({since,end,coverage})`, `compareEstimate(item,{end,estimateBase}) → Comparison`, `computeMetrics({items,view,since,end,profile,estimateBase='original',filters={}}) → Metrics`. `Comparison = {item_id,estimateBase,estimate,unit,basis,actual,range,inside,work_ratio,mre,absolute_error,schedule_variance,exclusions,flags,evidence}`; every absent result is null with reason.

- [ ] **Step 1: Write the hand-computed metric fixture and arithmetic**

Use 12 items: campaign C; missions M1/M2; seven tasks t1–t7 under M1; one open task t8 under M2; one cancelled task t9 under M2. Completed tasks: t1 cycle2h estimate[1,3], t2 cycle4h estimate[2,6], t3 cycle0h estimate[0,0], t4 commit_to_done3h with no observed dispatch/no estimate, t5 contradictory cycle−1h with valid lead5h/no estimate (explicit causal evidence), t6 cycle15s estimate[0.004,0.0042], t7 cycle1h/no estimate. t8 starts Sep10 09:00; end Sep21 00:00; t9 cancels in window. t1 created Mon09:00, commit Wed08:00, dispatch Wed09:00, done Wed11:00 gives lead `(48+2)=50h`, cycle2h, ratio `2/((1+3)/2)=1`, hit true. t4 has only commit Wed08:00/done11:00 →3h proxy and missing-start/missing-actual for accuracy.

Assertions: done task count7; unestimated count3 = t4+t5+t7, including skewed t5; cycle samples5 = t1,t2,t3,t6,t7; t5 is excluded only from cycle, not lead/throughput. Unestimated is an overlapping completeness count, not the mutually exclusive metric eligibility reason. No exact percentages are derived from rounded inputs. t3 point=true, zero-midpoint ratio exclusion1, zero-actual MRE/PRED exclusion1; its MAE is0. t6 actual=`15/3600=0.004166666666666667h`, hit true; display may be0.00h but actual is nonzero. Parent first elapsed56h versus[40,60] gives ratio `56/50=1.12`, band `[56-60,56-40]=[-4,+16]`, in range. Construct M1 start Sep14 09:00, latest required terminal/landing Sep16 17:00 to establish56h independently. M2 pending makes C variance unknown.

- [ ] **Step 2: Implement independent metric eligibility and estimate comparison**

```js
export const secondsBetween = (a,b) => (Date.parse(b)-Date.parse(a))/1000;
const hours = seconds => seconds/3600;
const nearest = (xs,q) => xs[Math.ceil(q*xs.length)-1];
export function stats(values) {
  const xs=[...values].sort((a,b)=>a-b), n=xs.length;
  return {n,min:n?xs[0]:null,max:n?xs[n-1]:null,
    median:n>=5?nearest(xs,.5):null,p85:n>=7?nearest(xs,.85):null,
    p90:n>=10?nearest(xs,.9):null,samples:n<10?xs:null};
}
```

Each duration checks its own required clocks, basis, nonnegative delta and cohort, and returns value/reason/evidence. Never skip a whole item due to cycle skew. Lead retrospective exclusion applies only when creation.basis=plan-commit, creation.meta.git_sha equals terminal.meta.git_sha, and duration below profile.zeroDurationSec. Missing SHA is not same-commit proof. Genuine observed zero/subminute remains valid. Test cycle invalid/lead valid, cycle valid/lead negative, commit_to_done negative and short different-commit lead valid. Throughput does not depend on duration validity.

Original estimate is first accepted, retained even if late; absent estimates → unestimated, proposals only → unaccepted. For latest, use the original estimate's unit and choose last accepted with acceptance `< start` and `< end`; recorded history is limited to observation at<end, not capture time. If no timely candidate but accepted records exist, reason late-accepted (or missing-start), never unaccepted. Fixed actual: task/case observed cycle, parent derived-child elapsed; active_min returns null `active-actual: deferred (M3)`. No proxy/lead substitution. Missing start/actual and late acceptance exclude accuracy. Changed units form separate history populations, never compare h to active_min.

For eligible comparisons compute full precision actual, midpoint, inside inclusive bounds, ratio unless midpoint0, absolute_error always, MRE/PRED only actual>0. Points have inside per-item but are excluded from ranged hit-rate; count points. Count absent probability and never infer probability/calibration from confidence. `exclusions` is an array so overlapping reasons remain visible; aggregate each statistic from its own eligibility mask and publish numerator/denominator/exclusion counts. Zero actual remains in MAE; MAE is an error statistic, not a mean duration headline. Parent band is `[actual-high,actual-low]`. Scope added/removed counts come from view.history; never modify first actual for later scope.

- [ ] **Step 3: Implement covered UTC weeks and strata**

Intersect request `[since,end)` with each generation's declared observation_start and source_epoch.until (if declared); no invented coverage before observation_start. Return all weeks touched by this intersection with `{key,start,end,count,whole}` where whole requires the complete UTC Monday→Monday week contained in declared coverage **and** request. Empty fully covered weeks get0; uncovered weeks are absent; partials flagged. Completions belong only to `[since,end)` and coverage. Assert sum whole+partial counts equals covered completion count. Velocity uses the median of ≥3 whole-week counts; use nearest-rank independent of the duration n≥5 floor. Return null with `whole-weeks<3` otherwise. Keep per-generation intervals; no pooled velocity over differently covered plans.

Test since Aug31, declared start Sep8, end Sep21: no W36, W37 partial, W38 whole, velocity null. End exact Monday excludes next week; Jan1 2027 is W53 of2026. Add three whole zero-filled weeks with counts[0,2,4] → velocity2. Record window/coverage outside-counts so conservation has an explicit denominator.

Create separate known strata for generation/level/class/role/model/factory/mission and applicable basis/unit/tier, explicit null for unknown dimensions. Implement `--class`/`--level` via filters before building the reporting population; parent derivation still uses full tree before filtering. Base throughput/speed populations remain distinct from estimate-tier subpopulations. In every stratum, quality is `{reviewed:null,eligible:null,done:N,unknown:N,first_pass_rate:null,reason:'review derivation deferred (M2)'}` with named cohort. Coverage for each dispatched/first_commit/done reports `{eligible,observed,unknown,by_source:{cli,hook,git,'automation-sync'},basis}`; separate winning-source counts from retained lower-source evidence, never double-count. Review/fix dispatch does not inflate observed build-start share. Rework_proxy_items counts distinct completed task IDs with rework_count>0, labelled proxy only.

- [ ] **Step 4: Validate edge arithmetic and commit**

Add ratio/MRE near .25 threshold, point/zero/unknown-probability, only-late-latest and missing-start cases. Run metrics tests, global gates; commit `feat(delivery-metrics): precise stratified Slice 1 comparisons`.

### Task 8: One-read report envelope, status, caveats and window exits

**Files:** Create `scripts/lib/report.mjs`, sibling test; modify `scripts/delivery.mjs` and test.

**Interfaces:** `assemble(repo,{plans=null,since=null,until=null,cutoff=null,now,estimateBase='original',filters={}}) → Report`; `renderMarkdown(report) → string`; `renderStatus(report) → string`. `Report = {envelope,plans:[{generation,plan_id,items,metrics}],diagnostics}`; envelope contains requested/effective windows, read-byte hashes, policy and counts. CLI report supports `--json`, `--out`, plan/since/until/cutoff/class/level/latest-estimate; status supports plan. No archived input renderer.

- [ ] **Step 1: Test windows, version carry-in and one-read provenance**

Default since is the earliest explicit observation_start among selected generations, normalized through iso; default until=cutoff and default cutoff=injected now. Default observation_start `2026-09-07T00:00:00Z` outputs `2026-09-07T00:00:00.000Z`. Sep10 09:00→Sep21 00:00 open age = `10*24+15=255h`; assert255, not254. End=min(until,cutoff) with both normalized; since≥end fails USAGE. Future-only ledger (all at≥end) exits NO-EVENTS3; prior created/start with no in-window completion is measurable zero, exit0. No selected catalogue exits NO-PLAN3. v1 dispatch/completion/estimate carried into v2 reports once; cutoff before v2 uses v1 class/membership. Selecting both v1/v2 same generation does not duplicate items; two runs remain separate.

Inject a test read callback that appends after initial event bytes are read; metrics and exported hash match the original buffer, not appended bytes. Preserve active/conflict locators. Saved plan byte hash differs from canonical identity hash and is labelled separately. Profile bytes/hash included. Malformed/conflicted files count with locators; orphan-plan events counted before filtering. Simulate saved plan with missing registration observations: registration-gaps>0. Verify every unconditional caveat appears in both JSON and Markdown; lost updates/capture total are null/unknown even when detectable gaps=0.

- [ ] **Step 2: Assemble without rereads or lost conflict metadata**

Call readInputs exactly once. Validate/read plans/profile from those same returned buffers; resolve all ledger revisions; collect current ledger conflicts **before** selecting requested plans. Count orphan plan IDs against all readable plan records, separately from valid but unselected plan records. Derive generationView for selected generations at normalized end; replay all applicable-version observations at<end, including starts before since. A plan selector selects its generation's effective history; report labels endpoint version and requested selectors. Do not filter events by endpoint plan_id alone.

For each view pass active **and conflicts** to selectOccurrences, then buildTimelines and computeMetrics. NO-EVENTS considers valid corrected history before end relevant to selected generation (including carried state); future observations and unresolved-only data are not measurable. Diagnostics from skipped rows/conflicts still print with exit3 when no timeline exists. Detect registration gaps by comparing each saved registration.observations identity/revision/semanticKey to readable ledger rows, counting missing expected observations; a valid later correction/retraction counts as present history, not missing emission. A missing/unreadable plan creates orphan/unregistered rather than a guessed recovery plan.

Envelope fields: generated_at, cutoff, requested/effective windows, observation_start per generation, whole_week_keys, git head/ref/is_working_tree, event/plan/profile FileRead hashes (omit raw bytes in JSON), plan canonical_hash separately, schema_version2, tool_version0.1.0, adapter versions `{git:'m1-1',claude:'spike-1'}`, filters, estimateBase, profile/default policy, null baselines, caveats, detected counts and unknown totals. Include no transaction inventory or coherence assertion. Metric comparisons and strata carry path:line evidence; unresolved files retain path/hash diagnostic. Sync/capture/lock diagnostics are read and counted if readable; absent diagnostic history means unknown incident total, not zero loss.

- [ ] **Step 3: Render per-item comparisons and quality next to speed/volume**

Markdown sections: window/provenance; flow/throughput by stratum with unit/basis/n/floors and adjacent quality reviewed/eligible/done/unknown; per-item estimate table; scope/parent variance; coverage/caveats; open items. Estimate columns: ref/level/class/tier/base/unit/basis, range, fixed actual, inside/outside, ratio, ordered variance band and exclusion reason(s). Missing values display `unknown (reason)`; no blank cells suggesting success. Numeric presentation formats hours with2 decimals; JSON retains full precision computation values and separately optional formatted labels. Status is a short subset with open first-episode ages, done/coverage counts, pending sync and M1-deferred labels; no P85/reopen comparison.

Wire `--class` and `--level` to filters. Reject `--html`, `--from-json`, `--calibrate` as USAGE with milestone explanation. `--out` writes only the requested report under reports/ by default; it is ignored/transient, not a delivery mutation needing sync. Report prints `REPORT` summary to stderr when stdout is JSON so JSON stays parseable; human output may include the summary header.

- [ ] **Step 4: Validate and commit**

Run report/CLI tests and global gates; commit `feat(delivery-metrics): evidenced M1 reports and honest coverage`.

### Task 9: Generation-bound local git backfill

**Files:** Create `scripts/lib/git-backfill.mjs`, sibling test; modify CLI and test.

**Interfaces:** `deriveGitObservations({repo,plan,head,since=null,cutoff,now}) → {observations,notes,pins}`. plan is PlanRecord; returns validated records using Task2 sourceToken/facts and generation-qualified catalogue IDs. `pins={head,integration_ref,integration_sha,source_path,adapter_version}`. CLI `backfill --git --plan --head [--since --cutoff --dry-run]`; reject --pr as deferred M2.

- [ ] **Step 1: Build independent positive/negative git fixtures**

Positive temp repo: main has plan commit, task/task-001 branch with TASK-001 commit and merge, then later second qualifying merge for same task. Expect earliest causal first completion only. Another branch task/task-002 completes, preserving that branch. **Negative fixture is a separate fresh temp repo** with declared alias task/task-003, unrelated branch commit and merge message naming task/task-003 but no TASK-003 evidence in second-parent exclusive history. Invoke adapter; assert no done for003 and `missing-second-parent-evidence` note. Never recreate an existing branch under the same name.

Add prior-run TASK-001 commit before source_epoch.from and current-run TASK-001 after from; first_commit selects current-run. Reject pinned feature-branch head not on first-parent integration chain. Later main growth does not change output with same pinned head. Lowercase alias matching precedes canonical-ref lookup. Creation for task added in second plan commit uses that second containing commit, with source SHA. Retry emits SKIP. Assert creation/done source SHAs are available to retrospective-lead eligibility.

- [ ] **Step 2: Implement pinned ancestry and chronological selection**

Resolve head and source_epoch.integration_ref to full SHAs once; verify head is on `git rev-list --first-parent <integration_sha>` (ancestor containment alone is too broad). Ref growth after pinning is irrelevant. Scan only head, never --all. Read first-parent merge history in causal order `git rev-list --first-parent --reverse <head>`, inspect parents/subject/committer timestamp per commit. Normalize all clocks; apply `[epoch.from,min(epoch.until,cutoff))` before choosing current-run first_commit/done. For same task, first qualifying merge in this causal order wins; later merges get `later-completion-deferred` notes and no episode-1 replacement. `--since` filters emissions **after** identifying the genuine first completion, so a narrow import cannot reinterpret a later merge as first.

A qualifying local completion needs declared exact branch alias in merge subject and a ref-prefixed task commit in `git rev-list <second-parent> ^<first-parent>` within generation. A merge subject without that exclusive evidence emits a note, no done. Earliest nonmerge `<TASK-ref>:` commit among pinned reachable generation history gives first_commit; filter epoch first, then chronological clock/ancestry tie-breaking. Rework pattern is `^TASK-\d{3}: address review(?: (\d+))?$`; preserve absent round as null; these are proxies only.

For each item, traverse pinned plan-file commits oldest-first and parse that revision's canonical block/task headings to find **first containing item**, not first file addition. Retain full git SHA in created meta and `basis:'plan-commit'`. Creation may predate epoch when it is explicitly the generation's pinned plan declaration; require source association from plan.source.path and generation context, not ref alone across unrelated plan files. Later-run source declarations must be identified in their epoch, never use prior-run same ref. Emit source token including generation, kind and SHA; done occurrence is the same episode-1 token as CLI. Missing path/history/evidence emits unavailable notes, no invented clocks.

- [ ] **Step 3: Wire append/sync and commit**

CLI prints pins and `BACKFILL events=N skipped=N conflicts=N` plus notes. Dry-run validates and prints observations with no writes. Normal path appends sequentially and syncs in finally. Run git-backfill/CLI tests and global gates; commit `feat(delivery-metrics): pinned local integration backfill`.

### Task 10: Pinned, validated security-testing golden

**Files:** Create `fixtures/security-testing/{extract-dataset.mjs,dataset.json,build-fixture-repo.mjs,golden.json}`, sibling helper tests and `scripts/golden.test.mjs`.

**Interfaces:** `buildFixtureRepo(dataset) → {repo,head,planFile}`. Dataset has `{source:{revision,path,sha256,transformed:true},plan_commit_at,groups,tasks:[{ref,class,story,first_commit_at,rework:[{round,at,sha}],merged_at}]}`. Extractor imports Task4 parseGroups; tests consume committed dataset only.

- [ ] **Step 1: Extract the verified pinned source without an author-specific checkout**

Pinned source is available via this repo's git object database:

```text
revision: b1f70d2bb2f681496f9f9c7c1b177e87511b4eeb
path: docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md
sha256 of exact git-show bytes: 457787ff3b7ba23e193d213db98247042cbdb5c5e9f56c7f922de4cf23a5af4f
```

Extractor reads `git show <revision>:<path>` as Buffer, verifies the hash before decoding, imports bounded parseGroups and task heading fields, and scans nonmerge commits with `--reverse` and first-parent merges with `--reverse` at that head. Rework recognizes **numbered and unnumbered** `address review` subjects; store null round for unnumbered, not invented1. Source evidence for proxy items is exactly TASK-004,005,006,007,009,010,012,018,029,032,059 (11 distinct). Missing either unnumbered004/005 would produce9 and must fail. Include source commit SHAs for every extracted clock.

```bash
node skills/delivery-metrics/fixtures/security-testing/extract-dataset.mjs . b1f70d2bb2f681496f9f9c7c1b177e87511b4eeb docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md > skills/delivery-metrics/fixtures/security-testing/dataset.json
```

Assert before writing output:59 headings;30 groups;59 memberships;59 unique memberships; group IDs G0…G29; membership equals heading set;33 merged;11 distinct rework-proxy items; toCatalogue/completePlan accepts resulting plan. G0=[001,055], G2=[002], G6=[008,013,015,030,032,058,059]. No dependency004 in G2. Extractor fails on mismatch rather than adjusting expected counts or ignoring missing members. Record extraction as transformed source in dataset; do not copy private commit messages into fixtures. Plan editor verified the group cardinalities/hash and eleven proxy IDs against this pinned object during v2.

- [ ] **Step 2: Build a deterministic synthetic git repository**

Create temp main repo with fixed fixture identity and GIT_AUTHOR_DATE/GIT_COMMITTER_DATE for every commit. Write canonical plan with all dataset groups/tasks and epoch from plan_commit_at, commit it at that time. Set explicit creation at plan_commit_at when registering so replay is independent of test wall clock. For each task create declared branch once at its first_commit_at, write a task-specific file, commit `<ref>: implement`. Replay rework commits by time with unique content per SHA/index, so two unnumbered reviews cannot produce empty commits. Merge branches using `--no-ff` and `merge task/task-NNN` messages at merged_at. Never reuse a branch name or mutate one task's file on another branch. Sort equal-time operations by causal first→rework→merge then ref; validate each rework/merge has an existing first commit. Return pinned main head.

Unmerged task branches are not scanned by adapter's pinned main head. Dataset metadata can retain them, but golden only claims33 completed tasks/11 completed proxy items. No synthetic dispatch/review approval/integration-parent events; mission cycle/completion may remain unknown without explicit landing evidence.

- [ ] **Step 3: Commit a reviewed golden; normal tests never rewrite it**

Run CLI register with `--created-at <dataset.plan_commit_at>`, backfill pinned head/cutoff `2026-09-17T00:00:00.000Z`, report JSON. A separate explicit generator command `node .../build-fixture-repo.mjs --write-golden` writes golden.json once for review; its CLI path must be guarded by `import.meta.url`/argv comparison so imports have no side effects. Golden projection contains fixed counts, full-precision commit_to_done stats, lead eligibility, UTC week series and proxy counts; omit volatile generated_at/temp paths/user IDs. Assert33 completed tasks,59 task rows,30 mission rows, task observed cycle n0/null, commit_to_done n33, review rate null,11 proxy items and no estimates fabricated. Independently recompute each completed task's `(merged_at-first_commit_at)/3600000` from dataset to check golden stats, not merely report output against itself.

Second backfill is all SKIP. Grow main after pinned head; re-run backfill at same head and compare projection unchanged. Delete golden.json in a test copy: test fails with missing fixture, never creates it. Normal suite reads committed expected values only.

- [ ] **Step 4: Validate and commit**

Run `node --test skills/delivery-metrics/scripts/golden.test.mjs` and helper tests, global gates; commit `test(delivery-metrics): validated 59-30-33-11 pinned golden`.

### Task 11: Supported correlated Claude SubagentStop capture

**Files:** Create `hooks/dispatch-hook.mjs`, sibling test; consume Task0 fixtures/manifest; create host-capabilities reference.

**Interfaces:** `ownerRepo(cwd) → repo|null`; `sessionPlan(repo,host,session,now) → PlanRecord|null`; `parseTranscript({payload,parentBytes,childBytes,manifestShape}) → {complete,association,start,end,firstUserText,description,agentType,reason,evidence}`; `handleStop(payload,{repo,now}) → {events,skipped,diagnostics}`. Unavailable/unsupported clocks are null; parseTranscript never trusts a supplied path by existence alone.

- [ ] **Step 1: Test admission against real fixture transformations**

Positive tests use only manifest supported real Agent/Workflow fixtures, including same-role concurrent children and all three worktree forms. Negative mutations: swap child files between agent IDs; foreign session; child path pointing outside correlated session; user-only JSONL; truncated final line; absent terminal completion marker; missing child; malformed payload; unbound session; closed latest plan. None may emit measured dispatch/end. Foreign **installed** role outside participating factories emits no attributed events. Multi-factory union admits each participating role; missing type relaxes role only and counts unknown-role. Missing role plus unbound session still fails. Full first message ID beyond250 chars remains resolvable. Ambiguous refs yield one admitted unattributed dispatch pair with null item/ref/level, not multiple guesses.

- [ ] **Step 2: Resolve telemetry owner and validate transcript association**

Use git metadata, not a `.claude/worktrees` string regex. Run `git -C cwd rev-parse --path-format=absolute --git-common-dir` and `git worktree list --porcelain`; match the common git directory and choose the main owning checkout for delivery/session records. Test arbitrary-path linked worktree against same owner. If ownership is ambiguous/unavailable, diagnose and emit nothing. Never pick by newest transcript or nearest role/time.

Read bound host/session→plan, resolve active capture version in same generation, require open. Get roster from PlanRecord.participating_factories/roster union recorded at registration; verify against installed participating factory role metadata; missing roster is diagnostic/unavailable. Check supplied agent_type membership if present. Before reading candidate child clocks, validate canonical path/session association and agent ID against the supported Task0 parent/child metadata fields. A direct agent_transcript_path is only a candidate; fallback scans matching session/subagents identity, not all transcripts. Unsupported host/version shape remains unknown.

Parse child rows with fatal UTF-8/JSON validation. Require supported correlated child structure and explicit completion evidence pinned by probe. A single timestamp/user message is insufficient. Use first and last valid clocks only after completed child proof; end≥start. Partial/truncated child emits diagnostic `capture-incomplete`, no measured pair. Retain hashes of buffers actually read and manifest host version/shape. Completion corrections/growth use same observation ID and next revision when semantic facts change, preserving start identity; unchanged retry SKIP.

- [ ] **Step 3: Attribute stage/items and append**

Stage precedence: build/implement; review; fix/address-review; gate; merge; other, using supported metadata description then full first user message. Stage ambiguity is other/activity, not build. Resolve qualified item references in description, then full first user stage label, then declared branch alias in bound generation. Multiple contradictory candidates → unattributed; explicit qualified member lists may name several tasks but never synthesize case starts. Record two observations dispatched/dispatch_ended with sourceToken(generation, `[host,session,agent,event]`), observed clocks and stage; fix also records rework_observed proxy. Review is activity only in M1. Prompt content omitted unless capturePrompts:true; IDs/evidence hashes default.

Bound stdin to64KiB and2s; malformed/oversize/deadline diagnostic, exit0. Wrap runtime in try/catch/finally: no stdout, diagnostic failure swallowed, sync requested after any partial append, exit0. Do not add SessionStart/Stop/live markers or Copilot hook.

- [ ] **Step 4: Validate and commit**

Run hook tests and global gates; verify supported fixtures' exact hash/clock assertions. Document unsupported shapes as `capture: unknown` rather than claiming measured coverage. Commit `feat(delivery-metrics): probed correlated Claude capture`.

### Task 12: Independent telemetry bootstrap, owned ignores, installer and doctor

**Files:** Create `scripts/install-hooks.mjs`, sibling test; modify CLI doctor route. Storage/gitState and sync interfaces stay unchanged.

**Interfaces:** `ensureTelemetry(repo) → {status,diagnostics}`; `installClaude(repo,skillRelativePath,{local=false,remove=false}) → settingsPath`; `installIgnoreBlocks(repo,{remove=false}) → {root,inner}`; `doctorReport(repo) → {lines,diagnostics}`. Installer supports `--host claude`, `--local`, `--remove`, `--doctor`; unsupported host exit2 before mutation. No tokenomics installation needed.

- [ ] **Step 1: Test actual submodule setup and settings preservation**

Use temp main repo/bare local origin. With no tokenomics, ensureTelemetry creates/reuses `.agents/telemetry` self-referential `telemetry` branch/submodule; rerun idempotent. Existing initialized telemetry/automation files remain byte-identical. Existing registered-but-empty checkout initializes. A nonempty unregistered plain directory created by earlier CLI use converts to the submodule while preserving all bytes; colliding different content is retained in the backup with manual-repair diagnostics, never silently overwritten. Bootstrap offline failure keeps local records and honest pending status. Existing malformed Claude settings fails SCHEMA-INVALID without overwrite. Install twice → one `_delivery` entry; unrelated/tokenomics/later-added entries survive remove. Remove never deletes ledger/submodule.

- [ ] **Step 2: Implement shared-submodule setup independently**

Inspect `.gitmodules` and git state before setup; if unresolved state, report pending/manual repair. For an existing telemetry gitlink, `git -c protocol.file.allow=always submodule update --init -- .agents/telemetry`, then reuse its branch/remote and upgrade ignores. For new clean installation: resolve main origin or local main repo path, create an empty telemetry root commit with `git hash-object -w -t tree --stdin` (empty stdin) / `git commit-tree` and `git update-ref refs/heads/telemetry` only if branch absent; prefer existing remote telemetry if advertised by local/remote `ls-remote`. Never overwrite an existing telemetry branch.

Seed a temporary local checkout of that branch with owned delivery ignore block and telemetry README (shared factory/concern namespaces); commit it; establish local telemetry branch and best-effort push origin telemetry. Add submodule from the local main repo path with `-c protocol.file.allow=always submodule add -b telemetry`, then set `.gitmodules` URL to `./`, branch telemetry, ignore all, and submodule origin to the actual upstream if available. Update gitlink to the seeded commit, print exact main-tree `.gitmodules`/gitlink commit instructions. Local origin fallback prints `remote sharing: unavailable`; no remote durability claim. Handle branch-already-exists using existing branch; never orphan-checkout or reset the main working tree. For a preexisting nonempty plain telemetry directory, rename it to a unique sibling temp backup before submodule add; if its paths are tracked in main, remove only `.agents/telemetry` entries with `git rm -r --cached` (never working-tree deletion). After materializing the submodule, restore each backed-up path if absent or byte-identical; for differing collisions stop and retain both copies with manual-repair diagnostics. On setup failure restore backup files to their former location wherever no conflicting path exists; leave the backup location printed if any restoration is incomplete. Preserve all namespaces including automation byte-for-byte. Stage the new gitlink and `.gitmodules`, then run normal best-effort telemetry sync; do not commit unrelated main-tree changes. The final main-tree migration commit remains the user's explicit review step. Cleanup only empty backups and the installer's temp checkout; interrupted setup is reported by doctor, not automatically recovered. These are the same ordinary move/restore limitations as tokenomics, not transactional guarantees. Add tests for failure before submodule add, failure after add, byte-identical/differing collisions and preexisting tracked plain files. No independent telemetry namespace/branch per factory.

- [ ] **Step 3: Splice hook and both ignore blocks**

Read settings strictly, preserve all nonowned entries, append exactly one owned Claude SubagentStop matcher `*`, command `node "${CLAUDE_PROJECT_DIR}/<skill-relative>/hooks/dispatch-hook.mjs" --stop`, async:true, timeout30. Reject unsupported host before ensureTelemetry. --remove only removes owned entries/blocks; --doctor read-only; default install explicitly opts into capture/setup. Skill installation alone never calls this script.

Owned root block includes `.agents/telemetry/delivery/reports/`, `.agents/telemetry/delivery/.lock/`, `.agents/telemetry/delivery/.pending-*`; inner includes `/delivery/reports/`, `/delivery/.lock/`, `/delivery/.pending-*`. Create inner `.gitignore` whenever telemetry directory exists, even if file absent. Replace only text between exact owned delimiters, preserving other owners. Never ignore plans/events/profile/calibration or telemetry root. Unmatched owned delimiter fails visibly, not clobbering user rules.

- [ ] **Step 4: Implement doctor checks in owning repositories**

Report hook wiring/path, participating roster availability, open active generations, session guards, supported probe shape coverage, capture/lock/sync diagnostics and registration gaps from Task8 read/resolve logic. For both main and telemetry repositories, check every transient pattern with `git check-ignore --no-index`; main submodule boundary errors are reported as `delegated to telemetry owner`, not a false missing-ignore. Use temp `GIT_INDEX_FILE`, `git read-tree HEAD` (or empty index for unborn repo), then `git add -A` and `git ls-files --stage` against disposable index to verify **actual staging**. Never change real index. Seed temporary ignored sample paths in tests; production doctor examines existing candidates and ignore rules without writing real files. Report already tracked transient paths from real index as manual repair; ignored files can remain tracked. Verify real gitlink excludes nested files in main and inner patterns exclude reports/locks/pending in telemetry while plans/events are staged.

Print leftover setup backup paths, dirty/unpushed state, unavailable upstream, unmerged paths, unfinished merge/rebase/cherry-pick/revert and git locks from gitState. No reset/abort/lock deletion. Include unconditional limitations and unknown loss totals; CLI doctor exits0. Add real submodule test with missing inner ignore, tracked report, merge conflict and index.lock, asserting read-only doctor preserves index/conflict bytes.

- [ ] **Step 5: Validate and commit**

Run installer/CLI/storage tests and global gates; commit `feat(delivery-metrics): independent shared telemetry setup and doctor`.

### Task 13: Factory wiring, references and complete offline gates

**Files:** Modify feature-development tech-lead/project-manager/scout and instructions; test-automation scout/test-automation-lead; finish skill README/references/templates. Create `fixtures/offline-installer.mjs`, sibling test and `scripts/install-smoke.test.mjs`. **Do not modify the design spec.**

**Interfaces:** Prose uses implemented CLI signatures only. Offline helper `prepareInstallerFixture({sourceRepo,tmp}) → {env,installer,projects}` builds local external mirrors/cache and six disposable installs. It changes no production installer behavior.

- [ ] **Step 1: Add on-demand role loading and concrete workflow prose**

Add `delivery-metrics` to skills-on-demand in the five role files, never skills. Tech-lead: canonical ranged plan block alongside Complexity, human accepted_by/accepted_at pair, consult available calibration reference without generating estimates; register with `plan register --from <file> --id <token>`, recuts with --at and supersedes mapping. Return/store completed ID-bearing block. PM: `event TASK-NNN done --id done-NNN --sha <merge-sha> --plan <id>`; explicit correction requires --revision and existing observation. Cancellation records reason; blocked/reopened/review records are deferred M1. First line of dispatch includes qualified task ref and build/review/fix stage. Bind session with `session set --host claude --session <id> --plan <id>`. PM status embeds `delivery.mjs status` output. Both scouts ask once for opt-in and run installer only after yes. instructions.md says mission state is in delivery ledger, and lists register/record/report moments. Test-automation role text limits M1 to declared plan/CLI/git; automation adapter is M3.

- [ ] **Step 2: Finish references, template and capability limitations**

`event-model.md`: full §6.2 event/field table, current-max-revision resolution, conflict rank blockers, evidence locator examples and M1 deferred list. `metrics.md`: each shipped metric's exact start/finish/unit/basis/cohort, floors and exclusion masks; per-item comparison fields, ordered parent band, strata and unknown quality denominator example. `plan-block.md`: stable local versus qualified IDs, recut mapping/validity, retry request, importer grammar/dry-run/yes, acceptance change rule, source hash versus canonical hash. `host-capabilities.md`: actual probe supported/unsupported shapes with manifest reference; CLI/git on Claude/Copilot/Codex, Claude-only automatic capture. README repeats spec §2/§8 limitations and shared bootstrap, local-only fallback, manual repair and M2–M4 scope.

Template has two missions and three tasks, explicit generation/epoch/integration base, local IDs, estimates[1,3]h budgetary with accepted_by/accepted_at null, and no invented acceptance. JSON template has no comments; Markdown explains how to fill/accept and how first recut supplies identity mappings. M1 does not write calibration snapshots or render archived JSON.

- [ ] **Step 3: Build exact offline external-cache fixture and six installer smokes**

The current installer always fetches even when a cache exists. Merely seeding directories is insufficient. Helper uses `skills.json` entries to create one local bare git mirror per unique upstream repo, with each required ref and each entry.subdir/SKILL.md declaring its registry id (synthetic test fixture, not upstream content). For upstream root entries place SKILL.md at root; multiple subdirs share one committed tree. Create temporary work repo per mirror, commit fixed fixture metadata, push branches/tags named by all required registry refs. Seed `tmp/cache/sdlc-skills/registry/<owner>__<repo>` clones. Set `SDLC_SKILLS_CACHE_DIR=tmp/cache`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<tmp>/gitconfig`; write URL `insteadOf` mappings from each exact `https://github.com/<owner>/<repo>` to its local bare path with `git config --file`, plus protocol.file.allow=always. Set `GIT_ALLOW_PROTOCOL=file` in child env to reject any missed network dependency. Never reassign HOME or modify global user git config.

For each factory feature-development/test-automation and target claude/copilot/codex, use a fresh temp cwd and:

```js
execFileSync(process.execPath, [installer,'init','--factory',factory,'--target',target,'--yes'], {cwd:project,env,stdio:'pipe'});
const dir = {claude:'.claude',copilot:'.github',codex:'.codex'}[target];
const cli = join(project,dir,'skills','delivery-metrics','scripts','delivery.mjs');
assert.ok(existsSync(cli));
// Register the fixed two-task canonical fixture, record observed build+done with fixed
// clocks and explicit plan/token, then report JSON via this installed cli.
// Assert one completed task with cycle2h/ratio1 and one open task, and no _delivery
// settings entry before explicit installer invocation. Core SDLC hooks may exist.
```

Use `execFileSync` args for each register/event/report call: register `['plan','register','--from',planFile,'--id','reg','--at','2026-09-14T00:00:00.000Z']`; build `['event','TASK-001','dispatched','--stage','build','--id','build-1','--at','2026-09-16T09:00:00.000Z']`; done `['event','TASK-001','done','--id','done-1','--at','2026-09-16T11:00:00.000Z']`; report `['report','--json','--cutoff','2026-09-17T00:00:00.000Z']`. Set DELIVERY_NO_SYNC=1 for these CLI smokes; actual sync/submodule gates are Tasks5/12. Synthetic external fixture validates resolution and offline installation, not real upstream content. Run default local validators; network `validate:externals` remains a separate online registry maintenance check, not silently represented as passed.

- [ ] **Step 4: Run all final gates and commit**

```bash
node --test skills/delivery-metrics
npm test
npm run validate:factories
npm run validate:marketplaces
npm run validate:dupes
skills-ref validate skills/delivery-metrics
```

Expected: all pass, six offline installed CLI smokes included, real fixture hashes verified, no network attempted. If prerequisites absent, report the specific unmet gate; do not fetch through npx or call a skipped gate passed. Inspect generated catalog diff and duplicate scanner; add GROUPS only for actual verbatim copies, not transformed probe/dataset artifacts. Commit listed factory/skill/test files as `feat(delivery-metrics): M1 workflow wiring and offline installation gates`.

## Self-review (run by the plan author before hand-off)

- [x] **Spec coverage:** §13 M-1 docs/probe → Task0; M1 plan/estimates →3–5; storage/sync →1–2/5/12; CLI/git/hook actuals →5/6/9/11; cycle/velocity/per-item comparisons →7; JSON/Markdown/status/caveats →8; golden →10; distribution/gates →1/13. Shared bootstrap remains M1; no spec rewrite. Real host probes are an explicit prerequisite, not synthetic evidence.
- [x] **Type consistency:** Located→Ledger active/conflicts→selectOccurrences→buildTimelines→computeMetrics→assemble preserves generation and locators. Registration local IDs are qualified once; view aliases apply to item and occurrence identities. All readers use initial FileRead buffers. Every public signature is declared at its producing task; CLI extensions consume them without a second competing definition.
- [x] **Arithmetic:** unestimated3=t4+t5+t7 independently of skew; age255h=240+15; 15s/3600 remains nonzero; parent ratio56/50=1.12 and band[-4,+16]. Source parser checked59 distinct memberships/30 groups and eleven proxy IDs against pinned bytes. No whole-week zeros before declared coverage.
- [x] **Scope/guarantees:** no archived renderer, HTML, PR/automation/cost adapter, review/reopen state or transactional repair. M1 unknown quality denominators, deferred episode effects and unsupported capture shapes are explicit. Advisory locks, append-only JSONL, ordinary request data, latest-wins and one bounded sync retry remain the guarantee ceiling.
- [x] **Verification honesty:** this is a plan edit, not a claim the future implementation suite passed. Each task has concrete counterexamples, implementation steps and a gate; golden generation is separate from tests. Plan editor checked source objects/arithmetic and plan consistency only.

## Review rounds

### v1 findings → v2

33 findings addressed: 19 blockers, 14 majors; 33 resolved, 0 rejected. Resolution labels below are exact dispositions; “Where” identifies implementation and test changes.

| F | Resolution | Where |
|---|---|---|
| F1 | resolved | Task4 bounded execution fence, columns/continuations/dependency counterexamples |
| F2 | resolved | Tasks3/5 saved ordinary request, identical retry before stale check, interrupted append tests |
| F3 | resolved by contract | Task7 overlapping completeness versus per-metric eligibility; 3=t4+t5+t7 |
| F4 | resolved | Task8 normalized default endpoints and 255h age arithmetic |
| F5 | resolved | Task9 separate negative repo/unused003 branch, adapter invoked and absence asserted |
| F6 | resolved | Tasks4/10 pinned source hash, complete unique membership, unnumbered004/005 proxies |
| F7 | resolved | Tasks2/6/8 current max revision, rank blockers, recovery and report conflict evidence |
| F8 | resolved | Tasks2/3/6 generation-qualified identities, semantic stage/all transition facts |
| F9 | resolved | Tasks3/5/8 effective generation history, active capture endpoint, carried v1 evidence |
| F10 | resolved | Task3 completed-ID validation, injective endpoint mapping, lineage without copied completion |
| F11 | resolved | Task6 evidenced landing, derived descendant start/max finish, retained cancelled history |
| F12 | resolved by narrowing | Tasks5/6 M1 CLI/replay validation; deferred reopen/review/block state |
| F13 | resolved | Task7 unrounded computations, subminute/near-threshold tests; Task8 display-only rounding |
| F14 | resolved | Tasks7/9 independent metric clocks and same-commit retrospective proof |
| F15 | resolved | Task7 per-generation covered intervals, partial weeks/conservation and velocity floor |
| F16 | resolved | Tasks2/3/5 new acceptance pair after material change, calibrated reference validation |
| F17 | resolved | Tasks0/11 correlated supported real child completion shapes, swapped/partial fixtures |
| F18 | resolved | Task9 pinned first-parent integration head, epoch-first filtering, earliest causal merge |
| F19 | resolved | Tasks2/5/8/12 pre-stage unresolved-state checks and whole-source report exclusion |
| F20 | resolved | Task2 shared strict validator, fatal UTF-8 and path/line diagnostics |
| F21 | resolved by contract | Task5 observed registration creation unless explicit; Task9 item-specific pinned commit proxy |
| F22 | resolved | Tasks7/8 per-item actual/range/base/basis/ratio/hit/exclusion in both formats |
| F23 | resolved | Tasks7/8 explicit strata/filters/source shares and adjacent unknown quality denominators |
| F24 | resolved | Tasks2/8 retained initial byte hashes, profile/version metadata and ledger evidence |
| F25 | resolved by limitation | Global12; Tasks5/8/12 unconditional caveats, detectable gaps versus unknown losses |
| F26 | resolved | Tasks3/5/11 participating factory roster union, foreign-installed/multi-factory tests |
| F27 | resolved | Tasks0/11 real SPIKE-1 gate, manifest provenance and git-metadata worktree ownership |
| F28 | resolved | Task12 independent M1 submodule bootstrap; Task13 prohibits spec rewrite |
| F29 | resolved | Task5 fetch/merge/one-push-retry, partial mutation finally, two-writer/offline tests |
| F30 | resolved | Task12 create inner ignores, actual owner/disposable-index checks, git-state doctor |
| F31 | resolved | Tasks2/5/8 structured errors, effective-end NO-EVENTS and explicit SHA correction clock |
| F32 | resolved | Task7 ordered band[-4,+16], zero/point/probability/start/late denominators and reasons |
| F33 | resolved by narrowing | Tasks8/13 archived renderer deferred M4; six offline cached/mirrored host/factory smokes |
