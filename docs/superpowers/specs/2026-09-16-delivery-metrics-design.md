# delivery-metrics — design spec (v1)

**Date:** 2026-09-16
**Skill:** `skills/delivery-metrics/` (new, orphan top-level; installed by any factory via `factory.json` `skills[]`)
**Branch:** feat/security-testing-bundle-spec (spec only; implementation branches off `main`)
**Status:** v1 — design approved section by section in brainstorming (§1 placement/hierarchy, §2 data model/capture, §3 metrics/report/plan); awaiting adversarial review rounds (codex `gpt-6-astra`), recorded in §19+
**Inputs:** research notes [`docs/superpowers/notes/2026-09-16-delivery-metrics-research-01…08`](../notes/): tokenomics internals, feature-development harness lifecycle, test-automation estimates/receipts, repo standards, dm-kb AI-maturity Performance Tracking rubric + `wpse-maturity` instrument, industry delivery metrics (DORA 2024/2025, Kanban Guide 2025, Flow Framework, SPACE, Jørgensen / Shepperd–MacDonell estimation accuracy), vendor data models (Jira/ADO/Linear/LinearB/Swarmia/Faros/four-keys/OTel CI-CD), and the critic's contradiction list (C1–C23) and gap list (G1–G30).

**Sources of truth for repo claims.** `bundles/SPEC.md:291-304` (roster-guard rule for shared-event hooks; one shared telemetry submodule, "one subfolder per factory"); `skills.json:246-257` (orphan `monorepo` entry shape); `bundles/feature-development/factory.json:166-169` and `bundles/test-automation/factory.json:11-14` (`skills: ["memory","knowledge-curation"]` — the orphan-attachment precedent); `bundles/test-automation/skills/tokenomics/scripts/install-hooks.mjs:33,79-110,145-155` (marker `_tokenomics`, Claude `SessionEnd/SessionStart/PreToolUse/Stop/SubagentStop` splices, Copilot `.github/hooks/tokenomics.json` with `sessionStart/sessionEnd/subagentStart/agentStop`); `hooks/telemetry-capture.mjs:187,316,440-447,613,1359-1367` (`startTs` parsed per transcript but not written to the dispatch line; `.meta.json` `description` → `deriveLabel`; `STAGE_MARKER`; hook payload keys `session_id`, `agent_id`, `transcript_path` = PARENT transcript); `scripts/batch-cost.mjs:344,382,431,583-586` (`estMin: num(r.estimated_active_minutes ?? r.est_min)`, `MIN_CLASS_N = 5`, `estVsActualMin`, `cases[].direct.activeMin`); `automation-scoping/scripts/score-cases.mjs:466` (emits `estMin` — the key `batch-cost.mjs:344` does not read); `tokenomics/templates/factory-profile.template.json:8` (`work_item_level: "batch"`) vs `scripts/build-tokenomics-export.mjs:66,105` (`?? 'feature'`); `scripts/team-report.mjs:106-114` (`isoWeek` in **local** time); `bundles/feature-development/agents/tech-lead/AGENT.md:181-201` (task template: `**Story:** · **Assigned to:** · **Depends on:** · **Complexity:** S / M / L`); `agents/project-manager/AGENT.md:95,229-243` (merge = `gh pr merge --squash --delete-branch`, strategy from `.agents/profile.md § Automation PR policy`, default squash); `agents/js-dev/AGENT.md:185` ("Don't give time estimates."); `bundles/feature-development/instructions.md:95` ("Mission state belongs on the work board, not in either memory layer" — the only use of "mission", undefined); `bundles/test-automation/agents/scout/AGENT.md:11,105` (`skills-on-demand: [… tokenomics …]`, the onboarding opt-in question); `.gitignore:34` (`docs/superpowers/` ignored; 19 files force-tracked on this branch — specs are committed with `git add -f`). Known doc drift: `CLAUDE.md`/`README.md`/`AGENTS.md` say eight orphan skills and 28 externals; the tree has eleven and 30 — M-1 fixes them.

## 1. Purpose

A **delivery performance tracker for the harness** — the cadence-and-cycle-time
sibling of `tokenomics`. Where tokenomics answers *what did this cost* from a
git-committed usage ledger, `delivery-metrics` answers *how fast did we deliver
it, and how did that compare with what we said* from a git-committed **event
ledger** keyed to the harness's own work items — campaign → mission → task →
case — across the feature-development and test-automation factories. It records
declared estimates as history, derives flow-time / throughput / quality /
estimate-accuracy figures **only from system-sourced events** (hooks, CLI calls
made at the moment a state changes, git history), labels every proxy as a proxy,
and never estimates a duration, a count, or a dollar itself. Output is a
report a project manager reads and a JSON an AI-maturity assessor can consume
under the "Performance Tracking" dimension (L2 tracked → L3 governed).

## 2. What the skill can and cannot promise

| Can promise (script, on the records it owns or reads) | Cannot promise |
|---|---|
| One append-only event per state transition of a registered work item, with `at`, `source`, and the raw word the factory used | That every transition is captured on hosts without hooks — there the CLI and the git backfill are the capture, and coverage is printed |
| Durable per-item **dispatch start** on Claude Code and Copilot CLI (from the sub-agent transcript's first stamp / `subagentStop` event), which git cannot give | Dispatch start for history that predates the hooks — reported as `commit_to_done`, never as cycle time |
| `cycle_time`, `lead_time`, `commit_to_done`, `time_blocked`, `work_item_age`, `throughput`, `velocity`, `wip`, `mission_turnaround`, `review_rounds`, `first_pass_rate`, `cancelled_share`, `unattributed_share`, `work_ratio`, `hit_rate`, `schedule_variance`, a per-class `calibration` table — each with start/stop event, unit, `n`, source, denominator, baseline slot | Any DORA metric (no deploy signal), flow efficiency (no defined active signal in feature-development), benefit-based ROI, per-person or per-agent productivity scores |
| Estimates as **recorded declared inputs** with provenance (who/when/scale/tier), revisions kept as history, originals used by default | An estimate of its own; a default where none was declared (absent = "not estimated", never 0 or 1) |
| A join to tokenomics records on `session` + `agentId` + `label` + the plan's id catalogue, quoting tokenomics' `activeMin` / `costUsd` with tokenomics' own honesty labels | Recomputing dollars or active minutes; running without tokenomics is fully supported, the cost columns are simply absent |
| A git backfill for `created`, `first_commit`, `review_returned`, `done` in both the local-branch mode (`merge task/task-NNN` subjects) and the PR mode (`gh pr view --json`), stamped `source: git` | Deriving `dispatched`, `cancelled`, `blocked` from git (they leave no trace) |
| Reports that are reproducible from an archived JSON (`--from-json`) with `generated_at`, `cutoff`, `git_sha`, `is_working_tree` | Uploads, dashboards, or any network call (`gh` is the one optional external, honest `null` without it) |

## 3. Decisions (locked)

| # | Decision |
|---|---|
| D1 | **Orphan top-level skill** `skills/delivery-metrics/`, registered in `skills.json` (`monorepo: sdlc-skills`), added to `feature-development/factory.json` and `test-automation/factory.json` `skills[]`. Self-contained: it may **read** tokenomics records but never `import` tokenomics code (a feature-development install has none). (§4) |
| D2 | Four canonical levels `campaign → mission → task → case`; `story` (`US-NNN`) is a tag on tasks. "mission" is defined here as *the gated/merged delivery increment* and maps to feature-development dependency group `Gn` (or milestone `Mn`, planner's choice), test-automation wave/flat batch, manual-qa run. (§5) |
| D3 | Records live only under `.agents/telemetry/delivery/` on the shared self-referential `telemetry` submodule/branch (SPEC.md:297-304 — the "one subfolder per factory" wording is amended by this spec to "one subfolder per factory **or cross-factory concern**", P-0 in §20). Never inside `automation/`. Working transients under `.agents/telemetry/delivery/` with names the inner `.gitignore` globs already cover. (§6.1) |
| D4 | **Store events, derive timestamps.** The ledger is `events-<user>.jsonl`, one line per transition, append-only, per-user file; `startedAt`/`doneAt`-style columns exist only in reports. (§6.2) |
| D5 | Closed `event` vocabulary of twelve words; the factory's own word travels in `raw`. Idempotency `key = plan|ref|event|disc`; readers dedup by key (greatest `at`, then last in file order). (§6.2) |
| D6 | **Source precedence, not union**: for each `(ref, event)` the timeline takes events from the highest-precedence source that has any — `cli` > `automation-sync` > `hook` > `git`. Prevents double-counted review rounds and competing `done` clocks. Coverage per source is printed. (§6.9) |
| D7 | Cycle time = first `dispatched` → first `done` (first-entry rule; re-entry via `reopened` does not reset, it increments `reopen_count`). `time_blocked` = Σ intervals (sum rule). No ADO-style clear-on-backward. (§6.9, §6.10) |
| D8 | When `dispatched` is absent the interval `first_commit → done` is reported **as `commit_to_done`**, never as cycle time. PR open→merge, when available, is `time_to_merge` with the label "PR open to merge — not lead time, not cycle time". (§6.10) |
| D9 | Estimates are **declared inputs**: `{unit, low, high, tier, class?, by, at, basis?}`; first `estimated` event is the original; later ones are revisions; reports use the original unless `--latest-estimate`. Units: `h` (elapsed calendar hours) for tasks/missions/campaigns in feature-development; `active_min` for test-automation cases (compared with tokenomics' `activeMin`, never with calendar time). A ranged estimate is compared at its midpoint for ratio statistics and at its band for `hit_rate`; the report says so. (§6.4) |
| D10 | Durations: ledger `at` in UTC ISO-8601 with milliseconds; computed in seconds; reported in hours (2 dp). Headline aggregation median + P85 (nearest-rank), P90 also emitted for the assessor; P85 only when `n ≥ 7`, median only when `n ≥ 5`, always min–max + `n`. Never a mean headline. (§6.10) |
| D11 | Weeks are **UTC ISO weeks** (`YYYY-Www`); `throughput` is zero-filled from observation start to cutoff with the partial week flagged; `velocity` = median of whole weeks, `MIN_WHOLE_WEEKS = 3` else `null` with a derived caveat. tokenomics' local-time `isoWeek` is a known divergence, noted in the report. (§6.10) |
| D12 | Zero-duration rule: items with `cycle_time ≤ profile.zeroDurationSec` (default 60) are excluded from duration statistics, kept in throughput, and the count/% is printed; 100 % excluded → "not observable — authored retrospectively". (§6.10) |
| D13 | **No ranking.** Segmentation by level, size class, role, model, factory is emitted; `byPerson` / per-agent leaderboards are not. The `user` field on every line is attribution mechanics for the merge-conflict-free file layout, not a report dimension. (§6.11) |
| D14 | Every speed or volume figure is printed beside its quality pair (`review_rounds`, `first_pass_rate`, `cancelled_share`, tokenomics gate/outcome drift when present). (§6.11) |
| D15 | Hooks are **opt-in** via the skill's own `scripts/install-hooks.mjs` (marker `_delivery`, own `.github/hooks/delivery.json`, own managed `.gitignore` block, `--remove`, `--doctor`, `--local`, `--host claude\|copilot`, idempotent). Installing the skill never starts capture. (§6.6) |
| D16 | Shared-event guard: every hook exits 0 within its first statements unless the repo has at least one plan with `status: open` under `.agents/telemetry/delivery/plans/`. This is the cross-factory equivalent of the roster guard; fail-open on any read error. (§6.6) |
| D17 | Hook capture is **one async `SubagentStop`/`subagentStop` hook** emitting both `dispatched` (at = the sub-agent transcript's first stamp) and `dispatch_ended`; an optional async `PreToolUse Agent\|Workflow` (`subagentStart` on Copilot) marker gives live WIP/age. No `SessionStart` injection, no `Stop` gate in v1 (the git backfill and `status` cover missed CLI calls). (§6.6) |
| D18 | Item resolution from a dispatch: (1) description / prompt first line matched against the open plans' **id catalogue**; (2) the dispatch cwd's branch (`task/task-NNN`, `tests/<ID>-…`, `tests/batch-<wave>`); (3) `ref: null`, `unattributed: true`. One event per resolved ref (a cluster dispatch yields one `dispatched` per case). (§6.6) |
| D19 | Plan registration input is a fenced ```` ```json delivery-plan ```` block (canonical) that the tech-lead's plan file and the campaign card carry verbatim; a markdown importer over `#### TASK-NNN` / `**Complexity:**` / §1 groups exists as a `--dry-run`-first convenience and is labelled `basis: markdown-import`. Re-registration appends delta events (`created`, `estimated`, `cancelled`); it never rewrites history. (§6.3) |
| D20 | The plan's id catalogue is also published for tokenomics: `plans/<plan_id>.json` `catalogue[]` — tokenomics may read it at M3 to attribute cost to `TASK-NNN` (today its `matchIds` knows only receipt ids). This spec does not modify tokenomics beyond the M-1 amendments in §13. (§6.12) |
| D21 | Exit codes: `0` ok · `1` internal error (uncaught) · `2` usage / bad input / unknown command · `3` not measurable (no open plan, no events in window — output still explains what is missing). No exit `4/5` (nothing to verify or hash). (§6.5) |
| D22 | The calibration snapshot (`calibration/<date>.json` + append-only `calibration-log.md`) is a **reference table the planner reads**; the tracker never writes an estimate into a plan. (§6.11) |
| D23 | Test files sit beside scripts (`*.test.mjs`, tokenomics precedent) and are installed; fixtures under `fixtures/`. Copies of other bundles' formats are pinned in `bin/check-skill-dupes.mjs` `GROUPS`. (§12) |

## 4. Placement and roles

| Where | What |
|---|---|
| `skills/delivery-metrics/` | `SKILL.md`, `README.md`, `scripts/` (`delivery.mjs`, `install-hooks.mjs`, `lib/*.mjs`), `hooks/` (`dispatch-hook.mjs`), `templates/` (`delivery-plan.template.json`, `profile.template.json`, `plan-block.template.md`), `references/` (`metrics.md`, `event-model.md`, `plan-block.md`, `calibration.md`), `fixtures/` |
| `skills.json` | `{ "id": "delivery-metrics", "monorepo": "sdlc-skills", "name": "delivery-metrics", "description": … }` |
| `bundles/feature-development/factory.json` `skills[]` | add `"delivery-metrics"` |
| `bundles/test-automation/factory.json` `skills[]` | add `"delivery-metrics"` |
| `skills-on-demand:` | `project-manager`, `tech-lead` (feature-development); `test-automation-lead`, `scout` (test-automation); `scout` (feature-development). Never `skills:` — nothing enters standing context. |
| Briefings / instructions | `bundles/feature-development/instructions.md` gains a "Delivery tracking" paragraph naming the three CLI moments (§9.1); `bundles/test-automation/skills/test-automation-workflow/references/orchestration-playbook.md` § Intake/§ Close name `delivery.mjs sync --automation` beside `work-scope.mjs close` (§9.2). |
| Scout | Onboarding asks once whether the team wants delivery tracking (exactly the tokenomics question at `scout/AGENT.md:105`); yes → `install-hooks.mjs`; the seed report records the decision. |

`SKILL.md` frontmatter: `name: delivery-metrics`, `description` (≤ 1024 chars, trigger-phrase style; names `tokenomics` as the cost neighbour and `automation-scoping` as the estimate neighbour), `license: Apache-2.0`, `compatibility` (≤ 500, quoted), `metadata.authors`, `metadata.version: "0.1.0"`. No other keys.

## 5. Vocabulary and work-item hierarchy

| Level | Definition | feature-development | test-automation | manual-qa |
|---|---|---|---|---|
| `campaign` | the backlog under one plan; one `plan_id` per plan version | epic / spec + plan file (`docs/superpowers/plans/<date>-<slug>-tasks*.md`) | campaign (`plan.campaign`, card `.agents/automation/campaigns/<slug>.md`) | — |
| `mission` | a gated/merged delivery increment inside a campaign | dependency group `Gn` (observed merge unit) or milestone `Mn` — the plan block says which | wave (`plan.waves[].slug`, branch `tests/batch-<wave>`) or flat batch | run `RUN-YYYY-MM-DD-NNN` |
| `task` | the dispatch-and-review unit | `TASK-NNN` (branch `task/task-NNN`, commit prefix, merge subject) | unit: cluster or solo build (branch `tests/<ID>-…`) | — |
| `case` | the verified leaf | — (acceptance criteria are not work items) | case (TMS id, opaque) | TC |
| `story` (tag) | value slice for roll-ups | `US-NNN` | — | — |

**Identity.** `plan_id = <campaign-slug>/<plan-version>` (e.g. `security-testing-bundle/v2`). Item `ref` is unique **within a plan**: task `TASK-023`; mission `G12`; case `<mission>/<caseId>` (case ids repeat across generations, so the mission prefix is mandatory); campaign ref = the plan's `campaign.id`. The fully qualified form `plan_id:ref` is what reports print. `parent` chains live in the plan record, not on events.

**Words this spec does not use as levels:** "batch" (means "flat wave" in test-automation and "merge batch" in feature-development — the report says `mission`), "group" (feature-development plan text — `mission`), "board", "cadence" as a metric name (§6.10 defines it as a group of three metrics). Forbidden vocabulary (CLAUDE.md): octobots, dual-mode, markers/taskbox/relay.

**Mapping to tokenomics' export.** `work_item_level` ∈ `campaign|mission|task|case` — the existing template says `"batch"` and the code defaults to `'feature'`; M-1 aligns both to this list (`batch → mission`, `feature → task`).

## 6. Contracts

### 6.1 Records and paths

```
.agents/telemetry/delivery/                 # on the shared `telemetry` submodule/branch
  plans/<plan_id>.json                      # registered work-item tree + catalogue (D19, D20)
  events-<user>.jsonl                       # the ledger — one line per transition (D4)
  profile.json                              # team-owned settings + baseline slots (§6.11)
  calibration/<YYYY-MM-DD>.json             # snapshots written by `report --calibrate` (D22)
  calibration-log.md                        # append-only, one entry per snapshot
  reports/<plan_id>.html                    # last rendered page (overwritten; optional)
  .pending-<session>-<n>.json               # PreToolUse marker (transient; gitignored)
  .lock/                                    # append lock dir (transient; gitignored)
```

`<plan_id>` in file names has `/` replaced by `__`. `<user>` is tokenomics' `whoAmI` rule re-implemented (git `user.email` local-part, else `$USER`), so both ledgers agree on the same person. Plain-dir fallback (no submodule yet): the same paths under a plain `.agents/telemetry/` directory, with the skill's managed root `.gitignore` block:

```gitignore
# >>> delivery-metrics (managed) — transients only; plans/events/calibration stay COMMITTED
.agents/telemetry/delivery/.pending-*
.agents/telemetry/delivery/.lock/
.agents/telemetry/delivery/reports/
# <<< delivery-metrics
```

Every writer appends under `.lock/` (mkdir-lock, `staleMs` 60 s, same shape as the security-testing `fsx` lock) and writes with `O_APPEND` — one line, one `write()` — so two hooks racing on one file cannot interleave. Sync to the `telemetry` branch is tokenomics' concern when it is installed (its `syncTelemetry` runs `git add -A` on the submodule root, which covers `delivery/`); when tokenomics is **not** installed, `delivery.mjs` performs the same best-effort commit-and-push of `.agents/telemetry` at the end of `event`, `plan register`, `sync`, `backfill` (`DELIVERY_NO_SYNC=1` disables; offline just waits for the next call). `install-hooks.mjs` installs the submodule exactly as tokenomics does when it is absent (same `.gitmodules` entry, same branch — never a second one; the two installers detect each other's work by the `.gitmodules` path and do nothing twice).

### 6.2 Event line

```json
{"v":1,"at":"2026-09-16T15:05:38.412Z","user":"daniel_sallai","host":"claude",
 "plan":"security-testing-bundle/v2","ref":"TASK-023","level":"task",
 "event":"done","disc":"0","key":"security-testing-bundle/v2|TASK-023|done|0",
 "source":"git","session":null,"agentId":null,"label":null,"role":null,
 "raw":"merge task/task-023 (Rio: PASS)",
 "meta":{"git_sha":"cd2dce7","is_working_tree":false,"verdict":"PASS","story":"US-021","mission":"G12"}}
```

| Field | Type | Rule |
|---|---|---|
| `v` | 1 | schema version; a reader refusing an unknown `v` prints the line's key and skips it (never aborts a report) |
| `at` | ISO-8601 UTC, ms | when the transition happened — **not** when the line was written (`meta.recorded_at` carries that when they differ, e.g. `event done --sha`) |
| `user`, `host` | string | attribution; `host ∈ claude \| copilot \| copilot-vscode \| cli \| git` |
| `plan`, `ref`, `level` | string | §5; `ref: null` allowed only with `meta.unattributed: true` (hook could not resolve — counted, never joined) |
| `event` | enum | `created · estimated · dispatched · dispatch_ended · first_commit · review_requested · review_returned · done · cancelled · blocked · unblocked · reopened` |
| `disc` | string | discriminator: `"0"` for singletons; revision ordinal for `estimated`/`created` re-registration; `agentId` for hook-emitted `dispatched`/`dispatch_ended`; round number `N` for git-derived `review_returned`; interval ordinal for `blocked`/`unblocked` |
| `key` | string | `plan\|ref\|event\|disc` — idempotency (D5) |
| `source` | enum | `cli · hook · git · automation-sync` (D6) |
| `session`, `agentId`, `label`, `role` | string/null | join handles to tokenomics (§6.12); `label` = dispatch description truncated to 120 chars, ids only when `profile.capturePrompts` is false (default) |
| `raw` | string/null | the factory's own word: `delivered`, `defect-found`, `Rio: PASS`, `CHANGES_REQUESTED`, `address review 2` |
| `estimate` | object | only on `estimated` (§6.4) |
| `meta` | object | open; conventional keys `git_sha`, `is_working_tree`, `recorded_at`, `verdict`, `story`, `mission`, `stage`, `unattributed`, `pr`, `round` |

Reader rules: parse every `events-*.jsonl` under `delivery/`; drop unparsable lines with a count; dedup by `key` keeping the greatest `at` (ties: last in file order); sort by `at`. A `plan` with no `plans/<plan_id>.json` is reported as `orphan-events` and excluded from metrics (its events are listed under "unregistered").

### 6.3 Plan registration

The canonical input is a fenced block the planner writes into the plan artefact (tech-lead's tasks file; the campaign card's plan section) so the estimate is reviewed where the plan is reviewed:

````markdown
```json delivery-plan
{
  "plan": "security-testing-bundle/v2",
  "factory": "feature-development",
  "campaign": { "id": "security-testing-bundle", "title": "security-testing bundle v1",
                "estimate": { "unit": "h", "low": 120, "high": 200, "tier": "budgetary" } },
  "mission_kind": "group",
  "missions": [
    { "id": "G12", "title": "build-report + secure-code-review",
      "estimate": { "unit": "h", "low": 2, "high": 5, "tier": "budgetary" },
      "tasks": [
        { "id": "TASK-023", "story": "US-021", "class": "M", "role": "js-dev",
          "estimate": { "unit": "h", "low": 1, "high": 3, "tier": "budgetary" } },
        { "id": "TASK-034", "story": "US-030", "class": "L", "role": "js-dev",
          "estimate": { "unit": "h", "low": 2, "high": 4, "tier": "ROM" } }
      ] }
  ],
  "estimated_by": "tech-lead", "estimated_at": "2026-09-16T08:00:00Z"
}
```
````

`delivery.mjs plan register --from <file.md|file.json> [--plan <id>]`:

1. Reads the block (or a bare JSON file). Schema-validates (`lib/schema.mjs`, hand-rolled subset as in the security-testing scripts: required keys, enums, types) → exit `2 SCHEMA-INVALID(<path>)`.
2. Writes/updates `plans/<plan_id>.json`: `{ plan, factory, status: "open", registered_at, campaign, mission_kind, missions[], catalogue: [every ref with its level, parent, story, class, role], versions: [{ at, git_sha, digest }] }`.
3. Appends events: `created` for every item not previously in the catalogue (`at` = `--created-at` if given, else the plan file's first git commit time when `--from` is a tracked file, else now — `meta.basis` says which); `estimated` for every item whose `estimate` differs from its last recorded estimate (`disc` = revision ordinal); `cancelled` (`raw: "removed-from-plan"`) for catalogue items missing from the new block unless `--keep-missing`.
4. Prints `PLAN <plan_id> items=<n> created=<a> estimated=<b> cancelled=<c>` and, per level, how many items carry an estimate — the "unestimated count named rather than imputed" rule.

`plan close --plan <id>` sets `status: closed` (hooks stop guarding it as open; reports still include it). `plan list` / `plan show`.

**Markdown importer** (`--from <tasks.md>` without a block): parses `#### TASK-NNN:` headings, `**Story:**`, `**Complexity:**`, `**Assigned to:**`, and the `§1 Execution plan` `G<n>` lines; produces the same JSON with `mission_kind: "group"`, no `estimate` objects, `meta.basis: "markdown-import"`; always prints the derived block first and requires `--yes` to register (D19). Test-automation plans register from the campaign card's plan JSON (`campaign`, `waves[].slug`, `waves[].caseIds`, `clusters`) via `sync --automation` (§6.8), never by hand.

### 6.4 Estimates

```json
{ "unit": "h", "low": 1, "high": 3, "tier": "budgetary", "class": "M",
  "by": "tech-lead", "at": "2026-09-16T08:00:00Z", "basis": "delivery-plan block" }
```

| Field | Rule |
|---|---|
| `unit` | `h` (elapsed calendar hours — the unit of `cycle_time`) or `active_min` (agent active minutes — compared only with tokenomics' `activeMin`); `d` is rejected (working-day ambiguity) |
| `low`, `high` | numbers, `low ≤ high`; a single number is written as `low = high` and flagged `point: true` in reports (the repo doctrine is ranges — `automation-scoping/SKILL.md:28`) |
| `tier` | `ROM · budgetary · calibrated` (automation-scoping's vocabulary); `calibrated` requires `basis` naming the calibration snapshot |
| `class` | the size class the factory already uses (`S/M/L` feature-development, `XS…XL` test-automation) — the reference class for the calibration table; kept ordinal, never mapped to points |
| `by`, `at` | who declared it and when (event `at` = this `at`) |

Statistics (§6.10) use the **midpoint** `(low+high)/2` for `work_ratio`, the band for `hit_rate`, and print both facts. Revisions: a new `estimated` event with `disc = n+1`; `original` = `disc 0`; `--latest-estimate` switches the ratio base and says so in the envelope. Absent estimate → the item is excluded from estimate metrics and counted in `unestimated` per level.

### 6.5 CLI — `scripts/delivery.mjs`

| Command | Effect | Exit |
|---|---|---|
| `plan register --from <f> [--plan <id>] [--created-at <iso>] [--keep-missing] [--dry-run] [--yes]` | §6.3 | 0 / 2 |
| `plan close\|list\|show [--plan <id>]` | plan status | 0 / 3 |
| `event <ref> <event> [--plan <id>] [--at <iso>] [--sha <sha>] [--raw <s>] [--round <n>] [--note <s>]` | append one line, `source: cli`; `--sha` sets `at` = committer date and `meta.git_sha`; `--plan` may be omitted when exactly one plan is open; `<ref>` may be `TASK-023` or `plan:ref` | 0 / 2 / 3 |
| `event --batch <jsonl>` | many lines at once (the PM closing a mission) | 0 / 2 |
| `status [--plan <id>]` | per open plan: items by state, WIP, open ages vs P85 line, unattributed dispatches, missing events the git backfill could fill; the PM's "Delivery" status line (§11) | 0 / 3 |
| `backfill --git [--plan <id>] [--since <iso>] [--pr] [--dry-run]` | §6.7 | 0 / 2 / 3 |
| `sync --automation [--plan <id>] [--dry-run]` | §6.8 | 0 / 2 / 3 |
| `report [--plan <id>…] [--since --until --cutoff <iso>] [--level …] [--class …] [--json\|--html] [--out <f>] [--from-json <f>] [--latest-estimate] [--calibrate]` | §6.10–6.11 | 0 / 3 |
| `doctor` | same checks as `install-hooks.mjs --doctor` | 0 |

Output tokens on stdout (one per line, greppable): `PLAN …`, `EVENT <key> <at>`, `SKIP <key> (exists)`, `BACKFILL events=<n> skipped=<m> source=git`, `SYNC events=<n> …`, `REPORT <path>`, `STATUS …`. Errors on stderr as `<CODE>(<detail>)`: `USAGE(...)`, `SCHEMA-INVALID(...)`, `NO-PLAN`, `NO-EVENTS(window)`, `AMBIGUOUS-PLAN(<a>,<b>)`.

### 6.6 Hooks

`scripts/install-hooks.mjs [--host claude|copilot] [--local] [--remove] [--doctor [--fix]]` — tokenomics' installer shape with marker `_delivery` on every spliced group:

| Host | Event | Command | Flags |
|---|---|---|---|
| Claude Code | `SubagentStop` (matcher `*`) | `node hooks/dispatch-hook.mjs --stop` | `async: true`, `timeout: 30` |
| Claude Code | `PreToolUse` (matcher `Agent\|Workflow`) | `node hooks/dispatch-hook.mjs --mark` | `async: true`, `timeout: 5` |
| Copilot CLI | `subagentStop` | `node hooks/dispatch-hook.mjs --stop` | in `.github/hooks/delivery.json` |
| Copilot CLI | `subagentStart` | `node hooks/dispatch-hook.mjs --mark` | idem |

`dispatch-hook.mjs` rules (all hosts): read stdin bounded (64 KiB); **first** check the guard (D16) — `plans/*.json` with `status: open` in the repo resolved from `CLAUDE_PROJECT_DIR` / `cwd` (walk up to the `.git` of the main checkout when inside `.claude/worktrees/…`, the same resolution tokenomics uses; the M1 spike below pins the actual `cwd` seen from a Workflow dispatch); no open plan → exit 0 silently; never print to stdout; never exit non-zero; every failure path is a `try/catch` that exits 0.

`--stop` (Claude): payload `session_id`, `agent_id`, `transcript_path` (parent). Locate the sub-agent transcript by `agent_id` under the parent's `subagents/` dir and its `.meta.json` (`agentType`, `description`); parse the first and last timestamps (~1 s, the transcript is alive at this moment — tokenomics field lesson); resolve refs (D18) from `description`, then the first user message's first line, then the branch of the dispatch cwd when `meta` carries one; classify `meta.stage` with a copy of tokenomics' `STAGE_MARKER` regex (`implement|build → build`, `review → review`, `fix round|address review → fix`, `gate|mini-gate → gate`, `merge → merge`, else `other`); emit per resolved ref `dispatched {at: firstTs, disc: agent_id, role: agentType, label, session}` and `dispatch_ended {at: lastTs, disc: agent_id, …}`; `stage: review` additionally emits `review_requested {disc: agent_id}`; `stage: fix` additionally emits `review_returned {disc: agent_id}`; no ref → one `dispatched` + `dispatch_ended` with `ref: null, meta.unattributed: true`. Delete any `.pending-<session>-*.json` marker for this agent.
`--stop` (Copilot): `subagentStop` payload carries the agent name and timestamps (`subagent.completed` fields as tokenomics reads them at `telemetry-capture.mjs:520-527`); same emission, `host: copilot`.

`--mark`: write `.pending-<session>-<n>.json` `{at, session, label, refs[]}` (Claude payload `tool_input.description`/`prompt` first line; Copilot `subagentStart` agent name + prompt). `status` reads pending markers as in-flight WIP; `--stop` consumes them; a marker older than 24 h is swept by the next `status`/`report` and counted as `dispatch-without-stop` (never converted into an event).

Workflow-tool dispatches (`.meta.json` has no `description`): resolution falls to the first user message's first line — the orchestration prompts of both factories already start with the case/task ids (`telemetry-capture.mjs:609-612`); the M1 wiring (§9) makes this an explicit rule in the feature-development PM/tech-lead prose ("the first line of every dispatch prompt names the `TASK-NNN`").

### 6.7 Git backfill

`backfill --git` derives events the hooks and CLI missed, for history and for hostless hosts. Reads `plans/<plan_id>.json` for the catalogue and the plan's source file path (recorded at registration). For each ref, from `git log --format=%H%x1f%ct%x1f%s%x1f%P --all` filtered by the id (word-bounded; case-sensitive):

| Event | Derivation | `disc` / `raw` |
|---|---|---|
| `created` | committer date of the first commit touching the plan file that contains the ref (one stamp for all items of that plan version — printed as a caveat: "plan-tracked creation") | `0` / `plan-commit` |
| `first_commit` | earliest non-merge commit whose subject starts with `<ref>:` or whose branch (`refs/heads/task/task-NNN`, `tests/<ID>-…`, `tests/batch-<wave>`, when the ref still exists) contains it | `0` / subject |
| `review_returned` | each commit with subject `<ref>: address review <N>` | `N` / subject |
| `done` (local mode) | merge commit whose subject matches `merge <branch> (…PASS…)` where `<branch>` resolves to the ref, or whose second parent's first-parent chain contains the ref's commits | `0` / subject |
| `done` (PR mode, `--pr`) | `gh pr list --state merged --search "<ref>" --json number,title,body,headRefName,createdAt,mergedAt,reviews`; a PR whose `headRefName` or title/body names the ref → `done {at: mergedAt, meta.pr}`, `review_requested {at: createdAt}`, `review_returned` per `CHANGES_REQUESTED` review (`disc` = review ordinal); `gh` missing or unauthenticated → `null` with `BACKFILL pr=unavailable` printed, never a failure | `0` / `pr#<n>` |

Never derived: `dispatched`, `cancelled`, `blocked` (D6 makes the absence explicit in coverage). Each line: `source: git`, `meta.git_sha`, `meta.is_working_tree` (true when the sha is only in the working clone's local branches). Idempotent: an existing key is `SKIP`ped. `--since` bounds the log walk; `--dry-run` prints the lines without appending.

### 6.8 test-automation sync adapter

`sync --automation` reads the factory's existing records and emits events (`source: automation-sync`, `host: cli`); it never writes into `.agents/automation/` or `automation/`:

| Input | Events |
|---|---|
| `.agents/automation/campaigns/<slug>.md` plan JSON, or `.agents/automation/<batch>/run.json` / `report.json` `batch` for flat batches | plan registration (`plan_id = <campaign>/<card-digest-short>`, `mission_kind: "wave"`, tasks = units from `clusters` + solo cases, cases under their wave) |
| `.agents/estimation/<scope>-scored.json` `cases[] {id, size, sp, estMin, lowMin, highMin, confidence}` | `estimated {unit: active_min, low: lowMin, high: highMin, tier: <confidence→tier map, printed>, class: size, by: "automation-scoping", at: file's first git commit time else mtime with meta.basis: "mtime"}` |
| telemetry `automation/scopes/*.json` (`declaredAt`, `batch`, `cases[]`, `outcomes[id].at`) | `dispatched` per case at `declaredAt` **only when no hook `dispatched` exists** (precedence D6 handles it) with `raw: "scope-declared"` — labelled a proxy for the wave, not per case; `done`/`cancelled` per case at `outcomes[id].at` with `raw` = the outcome word |
| `.agents/automation/<batch>/gate-runs.jsonl` `{at, branch, verdict}` | wave `done` at the first `green` for `tests/batch-<wave>`; wave `review_returned` per non-green run (`disc` = run ordinal) |
| `report.json` `cases[].outcome` (closed vocabulary) | `done` for `delivered\|defect-found\|automated\|merged-sanctioned-red` and `cancelled` for `blocked\|un-automatable\|not-started\|infra-stalled` **at receipt mtime with `meta.basis: "receipt-mtime"`** — the lowest-confidence clock, used only when neither scope outcomes nor gate runs exist for the case, and flagged (`meta.clock: "receipt"`) |
| git | `done` for a unit at the merge of `tests/<ID>-…` into `tests/batch-<wave>` (local) — through `backfill --git`, not here |

The `done` clock precedence per case is therefore: CLI > `outcomes[id].at` > gate green (wave-level) > receipt mtime; the report prints the distribution of which clock won (`done_clock: {scope: n, gate: n, receipt: n}`).

### 6.9 Timeline derivation

Per item, from the deduped, source-selected (D6) events:

```
planned ──dispatched|first_commit──▶ in_progress ──review_requested──▶ in_review
   │                                     ▲                                │
   │                                     └────────review_returned─────────┘
   │                                     │
   ├──cancelled──▶ cancelled             ├──done──▶ done ──reopened──▶ in_progress (reopen_count++)
   └──done (no start)──▶ done            └──cancelled──▶ cancelled
blocked / unblocked: overlay intervals on any state (unclosed interval closes at done|cancelled|cutoff and is flagged)
```

Derived per item: `created_at` (first `created`), `estimate` (original / latest), `started_at` (first `dispatched`; else `null`), `first_commit_at`, `in_review_at` (first `review_requested`), `review_rounds` (count of `review_returned`, source-selected), `done_at` (first `done`), `cancelled_at`, `blocked_intervals[]`, `reopen_count`, `dispatch_count`, `dispatches[] {agentId, role, stage, from, to}`, `unattributed: false`. Items with `done` but no `created` are `done-unplanned` (counted). A `done` earlier than `started_at` is a data defect printed as `clock-skew` and the item is excluded from duration statistics.

### 6.10 Metrics

All durations in hours (2 dp) from ms-resolution stamps; `n` beside every figure; median needs `n ≥ 5`, P85 `n ≥ 7` (nearest-rank: `sorted[ceil(q·n) − 1]`), otherwise the report prints the sorted values and min–max. Per level, per plan, and across plans in the window; segmented by `class`, `role`, `factory`, `mission`.

| Group | Metric | Start → stop | Unit / aggregation | Notes |
|---|---|---|---|---|
| Flow Time | `cycle_time` | first `dispatched` → first `done` | h; median, P85, P90, min–max, n | the headline; per level and per class |
| | `commit_to_done` | `first_commit` → first `done` | h; same | only for items without `dispatched`; **never merged** into `cycle_time` (D8) |
| | `lead_time` | first `created` → first `done` | h; same | label "plan-tracked, not idea-to-done"; caveat when `created` is a plan-commit stamp shared by all items |
| | `time_to_merge` | PR `createdAt` → `mergedAt` | h; same | PR mode only; label "PR open to merge — not lead time, not cycle time" |
| | `time_in_review` | first `review_requested` → `done` | h | with `review_rounds` beside it |
| | `time_blocked` | Σ (`unblocked` − `blocked`) | h | sum rule; not subtracted from `cycle_time` |
| | `work_item_age` | first `dispatched` → cutoff, for items not done/cancelled | h per item | listed against the P85 `cycle_time` line of the same level/class |
| Throughput | `throughput` | count of `done` per UTC ISO week per level | items/week series | zero-filled from observation start (earliest `created` in window) to cutoff; partial week flagged |
| | `velocity` | median of `throughput` over whole weeks | items/week | `MIN_WHOLE_WEEKS = 3` else `null` + caveat; mean also emitted, never headlined |
| | `wip` | items in `in_progress`/`in_review` at each week boundary | count series | Little's-law sanity line: `wip ÷ throughput` vs `cycle_time` median |
| | `mission_turnaround` | last `done` of mission *n* → first `dispatched` of mission *n+1* | h; median, min–max, n | the "between increments" gap |
| | **cadence** | = {`throughput`, `velocity`, `mission_turnaround`} | — | the word is only ever this group |
| Quality | `review_rounds` | count of `review_returned` before `done` | distribution; `first_pass_rate` = share with 0 | source-selected (D6) |
| | `cancelled_share` | `cancelled` ÷ `created` | % with n | |
| | `reopen_count` | Σ `reopened` | count | |
| | `unattributed_share` | dispatches with `ref: null` ÷ all hook dispatches | % with n | coverage honesty |
| | `coverage` | per event kind: share of done items having it, by source | table | e.g. `dispatched: hook 61 %, none 39 %` |
| Estimates | `work_ratio` | actual ÷ estimate midpoint, same unit (h vs h; `active_min` vs tokenomics `activeMin`) | per item; MdMRE, PRED(25), MAE, ratio distribution per class and tier | never MMRE alone; `unestimated` count printed |
| | `hit_rate` | share of items with `low ≤ actual ≤ high` | % per tier, n | only where a range exists; `point: true` items excluded and counted |
| | `schedule_variance` | mission/campaign: estimated `[low, high]` vs actual elapsed (`first dispatched → last done`), plus `scope_added`/`scope_removed` counts since original registration | h, count | |
| | `calibration` | per (factory, level, class): `{n, p50_h, p85_h, min, max, sample_window}` | table | written to `calibration/<date>.json` with `--calibrate` (D22) |
| Cost (join) | `active_min`, `cost_usd` | tokenomics' figures per item | quoted | only when records exist; tokenomics' labels (`measured`, `allocation`, `tokens-only`, `PROVISIONAL`, `DRIFT`) reproduced verbatim (§6.12) |

Zero-duration rule (D12) applies to every Flow Time metric. Items with `clock-skew` are excluded and counted.

### 6.11 Report envelope and formats

Every output — markdown (default), `--json`, `--html` — carries:

```json
{ "generated_at": "…", "cutoff": "…", "window": {"since": "…", "until": "…"},
  "git_sha": "…", "is_working_tree": true, "plans": ["…"],
  "sources": {"events_files": [...], "plans": [...], "tokenomics": "present|absent", "gh": "present|absent"},
  "policy": {"weeks": "UTC ISO", "percentile": "nearest-rank", "zeroDurationSec": 60, "minWholeWeeks": 3, "estimate_base": "original|latest"},
  "coverage": {...}, "caveats": ["velocity: 2 whole weeks < 3 — null", "created: plan-commit stamp shared by 59 items", "..."],
  "baselines": {"cycle_time_task_h": null, "throughput_task_per_week": null, "...": null} }
```

`caveats[]` are generated from the numbers (n, week keys, coverage shares) — never static text. `baselines` come from `profile.json` `baselines` (team-owned; `null` by default and shown as "no baseline", never a number the tracker invented). Sections in order: **Flow Time · Throughput · Quality · Estimates · Cost (if present) · Coverage & caveats · Open items (WIP, ages)**. `--json` is the assessor-facing export and the input of `--from-json` (re-render without recomputation; "JSON not rewritten"). `--html` is a self-contained page with the same chrome conventions as tokenomics' (own CSS; no imports). No `byPerson` anywhere (D13).

`profile.json` (template shipped):

```json
{ "capturePrompts": false, "zeroDurationSec": 60, "minWholeWeeks": 3,
  "baselines": { "cycle_time_task_h": null, "cycle_time_mission_h": null, "throughput_task_per_week": null,
                 "first_pass_rate": null, "hit_rate": null },
  "tokenomics": "auto" }
```

### 6.12 Join to tokenomics

When `.agents/telemetry/automation/` exists (or `profile.tokenomics: "path"`): read `usage-*.jsonl`, `live/*.jsonl`, and `.agents/automation/**/cost.json` **with the tracker's own reader** (no import); join dispatches by `session` + `agentId`, then by `label`/`cases[]` containing a catalogue ref; quote per item `activeMin` and `costUsd` (`direct` and `loaded`, with tokenomics' labels) and per plan the batch totals. Never recompute. Publish the catalogue (D20) so tokenomics' `matchIds` can, at M3, attribute feature-development cost to `TASK-NNN` — that change is an amendment to tokenomics, listed in §13 as M-1/M3 work, not silently assumed.

## 7. Entry points and dependencies

| Ask | Command(s) | Needs installed |
|---|---|---|
| "register the plan / record our estimates" | `delivery.mjs plan register --from <tasks.md>` | the skill |
| "task merged / mission closed / task cancelled" | `delivery.mjs event <ref> done --sha <sha>` · `event <ref> cancelled --raw …` | the skill |
| "how are we doing" | `delivery.mjs status` | the skill |
| "fill in history" | `delivery.mjs backfill --git [--pr]` | git; `gh` optional |
| "sync the automation campaign" | `delivery.mjs sync --automation` | test-automation records on disk |
| "delivery report / assessor export / calibration table" | `delivery.mjs report [--json] [--html] [--calibrate]` | the skill; tokenomics optional |
| "enable automatic capture" | `install-hooks.mjs [--host …]` | Claude Code or Copilot CLI |
| "is capture healthy" | `install-hooks.mjs --doctor` | — |

## 8. Guarantees and Not guaranteed

README wording. **Guaranteed:** every number in a report traces to event lines in git with a `source`; estimates are what a named person declared at a named time; no figure is estimated, defaulted, or averaged into a headline; proxies are named as proxies; nothing leaves the repo. **Not guaranteed:** completeness of capture on hosts without hooks (coverage is printed instead); comparability across teams (segment, never rank); anything DORA (there is no deploy event); an "idea-to-done" lead time (creation is plan-tracked).

## 9. Hand-offs

### 9.1 feature-development

- `tech-lead/AGENT.md` § 3 "Create Technical Tasks": the task template keeps `**Complexity:**` and the decomposition document gains the ```` ```json delivery-plan ```` block (template in `references/plan-block.md`) with a ranged elapsed-hours estimate per task and per group/milestone, `tier` named; § 5 "Handoff to PM" adds `delivery.mjs plan register --from <plan file>`. The estimate stays the tech-lead's number — devs are still told not to estimate (`js-dev/AGENT.md:185` unchanged).
- `project-manager/AGENT.md`: § Merging approved PRs step 5 adds `delivery.mjs event <ref> done --sha <merge sha>` (PR mode: `--pr <n>`); § Handling Blockers adds `event <ref> blocked|unblocked`; a task dropped from scope → `event <ref> cancelled --raw <why>`; § Status Report Format gains a `### Delivery` line = `delivery.mjs status` output; "the first line of every dispatch prompt names the `TASK-NNN`" is added to § Execution mode.
- `instructions.md`: a "Delivery tracking" paragraph naming the three moments (plan registered → merges/cancellations recorded → report at mission close); "Mission state belongs on the work board" is reworded to name the tracker as the board's record of transitions.
- `scout`: the opt-in question (§4).

### 9.2 test-automation

- `orchestration-playbook.md` § Intake: `delivery.mjs sync --automation` after the intake sweep registers the campaign plan; § Close: `sync --automation` before `work-scope.mjs close` so the wave's `done` is on disk; `test-automation-lead` `skills-on-demand` gains `delivery-metrics`.
- `automation-scoping` § Mode 4: consult `delivery/calibration/<latest>.json` `cycle_time` p50/p85 per class as the elapsed-time reference beside its own minute calibration (a pointer; Mode 4's minute recalibration is unchanged).

### 9.3 manual-qa

Not wired at v1: its runs (`RUN-*.md`) can be registered as missions through the markdown importer if a team wants it; parked in §18.

### 9.4 AI-maturity assessor (dm-kb `wpse-maturity`)

`report --json` is the instrument input: metric names grouped Flow Time / Throughput / Quality, each with `n`, `source`, denominator, baseline slot, and the labels the vault's validator expects ("PR open to merge — not story lead time"; "plan-tracked duration, not idea-to-done"). A dated review entry is the team's to write; the tracker's per-period snapshot is what the entry cites.

## 10. Files and manifests

```
skills/delivery-metrics/
  SKILL.md  README.md
  scripts/delivery.mjs            + delivery.test.mjs
  scripts/install-hooks.mjs       + install-hooks.test.mjs
  scripts/lib/paths.mjs           (delivery dir, user id, lock)            + test
  scripts/lib/events.mjs          (append, read, dedup, key)               + test
  scripts/lib/plan.mjs            (block parse, schema, catalogue, delta)  + test
  scripts/lib/plan-markdown.mjs   (importer)                               + test
  scripts/lib/resolve.mjs         (ref resolution, stage classifier)       + test
  scripts/lib/timeline.mjs        (state machine, source precedence)       + test
  scripts/lib/metrics.mjs         (every metric; pure)                     + test
  scripts/lib/report.mjs          (envelope, markdown, json, html)         + test
  scripts/lib/git-backfill.mjs                                             + test (temp repo)
  scripts/lib/automation-sync.mjs                                          + test (fixtures pinned in check-skill-dupes GROUPS)
  scripts/lib/tokenomics-join.mjs                                          + test
  hooks/dispatch-hook.mjs                                                  + test (stdin payloads, fake transcript dirs)
  templates/delivery-plan.template.json  templates/profile.template.json  templates/plan-block.template.md
  references/event-model.md  references/metrics.md  references/plan-block.md  references/calibration.md
  fixtures/security-testing-v2/   (anonymised 33-task dataset: plan block + events; the golden report)
  fixtures/automation/            (verbatim report.json / scopes / gate-runs examples from test-automation)
```

Manifests: `skills.json` entry; both `factory.json` `skills[]`; `npm run gen:marketplaces`; `.claude-plugin/marketplace.json` hand-curated entry (decide at M1 review); `bin/check-skill-dupes.mjs` GROUPS for `fixtures/automation/*` ↔ their test-automation sources.

## 11. Report structure

Markdown: title + envelope line (`generated_at · cutoff · sha · window · plans`); **Flow Time** table (level × {n, median, P85, P90, min–max}) with `commit_to_done` and `lead_time` rows labelled; **Throughput** (weekly series with partial flag, `velocity` or its caveat, `mission_turnaround`); **Quality** (`review_rounds` distribution, `first_pass_rate`, `cancelled_share`, `reopen_count`, `unattributed_share`); **Estimates** (per class: n, `MdMRE`, `PRED(25)`, `hit_rate` per tier, unestimated count; mission/campaign `schedule_variance`; calibration table); **Cost** (only with tokenomics); **Coverage & caveats**; **Open items** (WIP by state, ages vs P85). `unknown / not measured` allowed, blank forbidden. `status` prints the one-screen subset a PM pastes into `### Delivery`.

## 12. Tests

Deterministic `node --test`, offline, temp dirs:

- `events.test.mjs`: append under lock from two processes → no interleaving; dedup by key keeps greatest `at`; unknown `v` skipped with count; unparsable line counted.
- `plan.test.mjs`: block extraction from markdown; schema errors → `SCHEMA-INVALID(path)`; delta registration emits exactly the changed items; `--keep-missing`; catalogue content.
- `plan-markdown.test.mjs`: the security-testing tasks-v2 fixture → 59 tasks, groups G0–G29, stories mapped, no estimates, `basis: markdown-import`.
- `resolve.test.mjs`: description / first-line / branch resolution; cluster label → n refs; Workflow dispatch (no description); nothing → `null`; stage classifier table.
- `timeline.test.mjs`: state machine; source precedence (cli beats git `review_returned` counts; hook `dispatched` beats scope `declaredAt`); reopen; blocked overlay with unclosed interval; clock-skew exclusion.
- `metrics.test.mjs`: every metric against hand-computed values on a 12-item fixture; percentile floors; zero-duration exclusion; UTC ISO weeks across a year boundary; whole-week rule; `velocity` null below 3 weeks; `work_ratio` midpoint + `hit_rate`; `schedule_variance` scope delta.
- `report.test.mjs`: envelope fields; caveats derived (change n → caveat changes); `--from-json` byte-equal render; no `byPerson` key anywhere; baseline null rendered as "no baseline".
- `git-backfill.test.mjs`: temp repo replaying the local-branch pattern (`TASK-NNN:` commits, `address review N`, `merge task/task-NNN (Rio: PASS)`), then a squash-merge repo with a stubbed `gh` on `PATH` returning fixture JSON; idempotent second run → all `SKIP`.
- `automation-sync.test.mjs`: fixtures → events; `done` clock precedence and `done_clock` distribution; `estMin/lowMin/highMin` mapping; never writes outside `delivery/`.
- `dispatch-hook.test.mjs`: guard (no open plan → exit 0, no write); Claude payload with a fake `subagents/` dir → `dispatched` + `dispatch_ended` with `at` from the transcript; review/fix stage extra events; unattributed path; malformed stdin → exit 0; Copilot payload.
- `install-hooks.test.mjs`: splice/remove idempotent on `settings.json` and `.github/hooks/delivery.json`; `_delivery` marker; gitignore block replaced in place; `--doctor` output; coexistence with an existing `_tokenomics` splice (neither touches the other).
- Golden: `fixtures/security-testing-v2` → `report --json` byte-equal to the committed golden (the pinned numbers: 33 done tasks, 11 with `review_rounds ≥ 1`, `commit_to_done` medians per class, 59 registered tasks, 30 `Gn` missions).
- Repo gates: `npm test && npm run validate` (incl. `validate:marketplaces`, `validate:dupes`); `skills-ref validate skills/delivery-metrics`; install smoke `node bin/init.mjs init --factory feature-development --target claude --yes` and `--target copilot` place the skill and nothing else changes.

## 13. Plan

| # | Milestone | Capability |
|---|---|---|
| M-1 | Docs + tokenomics amendments (one PR) | fix "eight orphan skills / 28 externals" in `CLAUDE.md`/`README.md`/`AGENTS.md`; amend `bundles/SPEC.md:297-304` wording (P-0); tokenomics: `batch-cost.mjs:344` also reads `estMin`; `captureDispatches` writes `startedAt` from `startTs` on the live dispatch line (one line, makes dispatch start available to tokenomics' own reports too); `work_item_level` template/code aligned to `campaign\|mission\|task\|case`; `SPIKE-1` hook-input probe: record what `cwd`/`CLAUDE_PROJECT_DIR`/`.meta.json` a Workflow-tool dispatch and an Agent-tool dispatch present to `SubagentStop`, inside and outside `.claude/worktrees/` |
| M1 | Core | `lib/paths, events, plan, plan-markdown, resolve, timeline, metrics, report` + `delivery.mjs plan/event/status/report/backfill --git`; SKILL.md/README; manifests; golden fixture; feature-development wiring (§9.1); scout opt-in |
| M2 | Hooks | `dispatch-hook.mjs`, `install-hooks.mjs` (Claude + Copilot, `--doctor/--remove/--local`), submodule bootstrap when tokenomics is absent, best-effort sync |
| M3 | test-automation | `automation-sync.mjs`, `sync --automation`, `hit_rate`/`work_ratio` on `active_min`, `--calibrate` snapshot + `calibration-log.md`, playbook wiring (§9.2); tokenomics reads the catalogue (amendment PR to tokenomics `matchIds`) |
| M4 | Presentation + forecast | `--html` page; `--from-json`; `--pr` backfill via `gh`; Monte Carlo "when will this campaign finish" at P50/P85/P95 from weekly `throughput`, only when ≥ 11 whole-week samples, else "not enough data" |

Each milestone ships with its tests and passes the §12 repo gates; M1 is usable alone (CLI + git backfill on any host).

## 14. Open questions

1. `SPIKE-1` result may force the guard/resolution path in §6.6 to read the main checkout from inside a worktree differently than tokenomics does — the spec pins the *behaviour* (guard, resolution order), not the path arithmetic.
2. Whether `.claude-plugin/marketplace.json` (hand-curated) should list the skill — maintainer's call at M1 review.
3. Copilot CLI `subagentStop` payload timestamps — verify against the current hooks reference at M2; if absent, `dispatched.at` on Copilot falls back to the `subagentStart` marker time (`meta.basis: "start-marker"`).

## 15. Consistency check against §2

Each §2 left-column row names its command in §6.5–6.8 and its metric in §6.10; each right-column row appears verbatim in §8 or §18. Any later sentence that exceeds §2 is a defect. D6 (source precedence) and D8 (`commit_to_done` naming) are the two rules the reviewer should test every metric against.

## 16. Repo facts relied on that the reviewer should re-verify

- `bundles/SPEC.md:297-304` wording "one subfolder per factory" (P-0 amends it).
- `telemetry-capture.mjs:187,440-447` — `startTs` exists per sub-agent transcript and is dropped at the live line.
- `.meta.json` carries `description` for Agent-tool dispatches only (`telemetry-capture.mjs:328-333`; Workflow dispatches: `agentType` only).
- `project-manager/AGENT.md:95` squash + delete-branch → no merge commit, no branch: PR-mode backfill is the only git path there.
- `.gitignore:34` ignores `docs/superpowers/`; this spec is force-added like the security-testing files.
- `skills.json` orphan entries have exactly `{id, monorepo, name, description}`.

## 17. Acceptance criteria

- **AC-1** `npm test && npm run validate` green on the implementation branch, including `validate:marketplaces` and `validate:dupes`; `skills-ref validate` passes on `skills/delivery-metrics/SKILL.md`; no `tools:` key anywhere; `name` equals the directory.
- **AC-2** `node bin/init.mjs init --factory feature-development --target claude --yes` and `--factory test-automation --target copilot --yes` install `delivery-metrics` next to `memory`; no hook is wired until `install-hooks.mjs` runs; `--remove` restores the pre-install state byte-for-byte (settings, hooks json, gitignore block).
- **AC-3** Registering the security-testing v2 plan from its markdown, running `backfill --git` on this branch, and `report --json` reproduce the committed golden: 33 `done` tasks, per-class `commit_to_done` medians, review-round distribution, 59 registered tasks, 30 missions; `cycle_time` is **absent** (no `dispatched` events) and the report says so in `coverage`.
- **AC-4** With hooks installed on Claude Code, one Agent-tool dispatch whose description names `TASK-023` yields exactly one `dispatched` and one `dispatch_ended` line with `at` from the transcript, `disc` = agent id, and re-firing the hook appends nothing (`SKIP`).
- **AC-5** A repo with no open plan: every hook exits 0 without writing; a malformed payload exits 0.
- **AC-6** No report output contains `byPerson`, a mean as the first duration figure, a percentile whose `n` is below its floor, or a numeric baseline the profile did not declare.
- **AC-7** `report --from-json <f>` renders byte-identically to the run that produced `<f>`.
- **AC-8** `sync --automation` on the pinned fixtures writes only under `delivery/`, and the `done_clock` distribution in the report matches the fixture's known clocks.
- **AC-9** Every metric in §6.10 has a unit test with hand-computed expected values; every CLI error path prints one `<CODE>(<detail>)` line and the exit code in §6.5.
- **AC-10** `work_ratio` and `hit_rate` are computed only when estimate and actual share a unit; a mismatched pair is counted under `unit-mismatch` and printed.

## 18. Not in scope / parking lot

- DORA four keys; flow efficiency; benefit-based ROI; per-person or per-agent productivity; dashboards, uploads, OTel export (the JSONL is sink-agnostic by design — same stance as tokenomics).
- manual-qa wiring; Cursor/Kiro/Codex hooks (CLI + git backfill cover them); story-point velocity; time-in-status heatmaps.
- A `Stop` gate nagging for undeclared plans (tokenomics has one for scope; revisit after M2 field use).
- Automatic PR-mode `done` from a merge webhook — no runtime in this repo.

## 19. Review rounds

Recorded per round as `vN findings → vN+1` tables (`F<n> | Resolution | Where`) with the verdicts **resolved / resolved by contract / resolved by narrowing / removed**; the review artefacts are filed under `docs/superpowers/notes/2026-09-16-delivery-metrics-spec-vN-adversarial-review-codex.md`.

## 20. Planning amendments

| # | Amendment | Where |
|---|---|---|
| P-0 | `bundles/SPEC.md` "One shared telemetry submodule … one subfolder per factory" → "one subfolder per factory **or per cross-factory concern** (`delivery/` is the first)". Does not change §2 or §3. | M-1 |
