# 03 — test-automation factory: the existing estimate → actual → calibration loop, and its work-item hierarchy

Research input for the "internal delivery performance tracker" spec. Reports what exists in
`/Users/Daniel_Sallai/dev/sdlc-skills/bundles/test-automation/` (and the manual-qa metrics
add-on) as of branch `feat/security-testing-bundle-spec`. All paths below are repo-relative
unless absolute. Where I infer rather than quote, I say so.

Short-hands used: `TAW` = `bundles/test-automation/skills/test-automation-workflow`,
`AS` = `bundles/test-automation/skills/automation-scoping`,
`TOK` = `bundles/test-automation/skills/tokenomics`,
`EA` = `bundles/test-automation/skills/efficiency-audit`,
`MQA` = `bundles/manual-qa`.

---

## 0. The work-item hierarchy that actually exists (vocabulary check first)

The task brief names "campaign / mission / task / case". **`mission` does not exist anywhere in
this repo** (`grep -rl mission` only hits the substring in "permission"). The test-automation
factory's hierarchy is:

| Level | Term in the factory | Where it is defined | Identity / key |
|---|---|---|---|
| Whole backlog | **campaign** | `TAW/references/campaign-planning.md:17-19` | `plan.campaign` slug; card at `.agents/automation/campaigns/<slug>.md` |
| Gate/merge unit | **wave** ("a normal batch (`M` cases, own integration branch, own gate, own report)") | `campaign-planning.md:20-21` | `plan.waves[].slug`; branch `tests/batch-<waveSlug>`; report at `.agents/automation/<batch>/<waveSlug>/report.json` (`TAW/scripts/workflows/batch-campaign.workflow.mjs:475`) |
| Flat batch (no campaign) | **batch** | `TAW/references/orchestration-playbook.md:27-34` | `args.slug`; report at `.agents/automation/<slug>/report.json`; trunk `tests/batch-<slug>` |
| Kind of work a wave does | **stage** — `bootstrap → foundation → facilitated build waves` | `campaign-planning.md:22-23, 25-61` | card `Stage:` enum |
| Dispatch unit | **unit** = a **cluster** (several similar cases, one branch/PR/review) or a solo case | `campaign-planning.md:63-130`; `TAW/references/workflow-accelerant.md:182-185` ("units are the wall clock") | `plan.waves[].clusters[][]` / `args.clusters`; unit branch `tests/<ID>-…` |
| Leaf | **case** (a TMS test case) | `orchestration-playbook.md:285-309` (outcomes) | `cases[].id` — opaque, tracker-shaped (`TC-101`, `ELITEA-2312`) |
| Non-case work | **technical unit** with a **tech-task brief**, tracker-shaped ids (`TD-123`) | `orchestration-playbook.md:269-283` | same `report.json` `cases[]` row shape |

Batch-level `work_item_ref` is the only tracker-level identity: `report.json.work_item_ref`
(optional, from `args.workItemRef`, `TAW/scripts/workflows/batch-build.workflow.mjs:1583-1588`),
which flows into the tokenomics dataset row's `work_item_ref` (`TOK/scripts/build-tokenomics-export.mjs:100`;
absent → `T-<batch slug>` telemetry-cohort ref).

The manual-qa side has a different, shallower hierarchy: **run** (`RUN-YYYY-MM-DD-NNN`) → **TC**
(`MQA/knowledge/metrics-format.md:97, 147-153`).

**Implication for naming:** the tracker should either adopt `campaign → wave → unit → case` for
this factory or define its own `mission`/`task` terms with an explicit mapping table; there is
no existing "mission" or "task" record to join to.

---

## 1. Exact estimate outputs of `automation-scoping`

### 1.1 The rule: never a bare point estimate

`AS/SKILL.md:28-32`:

> **The one number this skill will never produce is a bare point estimate.** Every output is a
> range with a named confidence tier (`references/scoping-report-format.md` § Confidence
> statement). A presales number without its band is the anti-pattern this whole skill exists to
> replace.

Restated in `AS/references/scoping-report-format.md:190-192` ("Always a range, never a bare point
number") and in the anti-patterns list `AS/SKILL.md:559-560`.

### 1.2 Two currencies, never reconciled

`AS/SKILL.md:34-43`: **agent cost** (active-minutes → $, `base × tier × novelty`) and **work
size** (`XS/S/M/L/XL → Service Points, 1 SP = 1 hour of conventional engineer effort`). Points:
`XS=1, S=2, M=4, L=8, XL=16` (`AS/references/complexity-taxonomy.json` → `size_scale.points`;
`AS/references/sizing-rubric.md:47`). SP → money requires `--blended-rate <usd/hr>`, which is
**never defaulted** (`AS/SKILL.md:292-294`).

Unit of the agent-cost model: `complexity-taxonomy.json` → `"unit": "active_minutes"`. Formula:
`estimated_active_minutes = base_minutes(step_count) × interaction_tier_multiplier × novelty_multiplier`
(`AS/references/complexity-taxonomy.md:10`; `AS/scripts/score-cases.mjs:4`). Current base minutes
(v0.6.4): `13 / 25 / 41` for `≤5 / ≤10 / >10` steps — explicitly **pure case-build minutes**;
fully-loaded pipeline cost is `fully_loaded_multiplier: 1.79` with layer split `case_branch_pct: 56,
batch_trunk_pct: 28, orchestrator_pct: 16` (taxonomy JSON; `scoping-report-format.md:34-43`).

### 1.3 Per-case verdict (agent-read, schema-forced)

Prose contract `AS/SKILL.md:140-157`; enforced schema `AS/scripts/sizing.workflow.mjs:64-94`:

```
required: ['id', 'tier', 'steps', 'size', 'confidence']
id: string · tier: string · tier_rationale: string · steps: integer
surfaces: integer · new_abstractions: integer
size: enum ['XS','S','M','L','XL'] · size_rationale: string
modifiers: string[]      — complex-preconditions | rich-test-data | heavy-teardown | high-assertion-density  (SKILL.md:163-170)
quality_flags: string[]  — vague-steps | missing-expected | missing-data | likely-drift            (SKILL.md:170-174)
risk_flags: string[]     — nondeterministic-oracle | external-dependency                            (SKILL.md:198-209)
signals: string[]        — free-form cost drivers
split_recommended: boolean
confidence: enum ['high','medium','low']
```

`confidence: low` and `split_recommended: true` are **auto-promoted to risk flags**
`low-confidence-verdict` / `split-recommended` at scoring time (`score-cases.mjs:365-371`).

### 1.4 Files written

| File | Writer | Shape |
|---|---|---|
| `.agents/estimation/<scope-slug>-verdicts.json` | sizing workflow writer (`sizing.workflow.mjs:133,143`) or a hand-run reader pass | `{ "scope": "<slug>", "verdicts": [ …verdict rows… ] }` |
| `.agents/estimation/<scope-slug>-scored.json` | `score-cases.mjs --verdicts <v> --json --out <p>` (`sizing.workflow.mjs:134,144`) | `{ taxonomyPath, sampleOf, blendedRate, cases[], byTier[], bySize[], caseSp, foundation }` (`score-cases.mjs:830-835`) |
| `.agents/estimation/<scope-slug>-scoping-report.md` | the agent, per template | `scoping-report-format.md` |
| `.agents/estimation/surface_recon.md` | Mode 3 | per-surface reuse notes (`SKILL.md:498-502`) |
| `.agents/estimation/complexity-taxonomy.json` | `calibrate.mjs --apply` | project-local posterior (see §2) |
| `.agents/estimation/calibration-proposal-<date>.md`, `calibration-log.md` | `calibrate.mjs` | see §2 |

Per-case scored row (`score-cases.mjs:450-475`), exact keys:

```
id, tier, tierLabel, classification ('verdict'|'keyword'), steps, stepsEstimated, novelty,
qualityFlags[], riskFlags[], size, sp, sizeBasis ('derived'|'derived-partial'|…), sizePoints,
sizeBreakdown{steps,surfaces,new_abstractions,expensive_tier}, spCost,
modifiers[], splitRecommended, refineBySplitting, signals[],
estMin, lowMin, highMin, estCost, lowCost, highCost, confidence (band label string), rate
```

Scope-level rollups: `byTier[] {tier, n, avgMin, avgCost}` (`score-cases.mjs:485-496`),
`bySize[] {size, n, sp, …}`, `caseSp` (sum of SP), optional `foundation {catalogPath, included[],
excluded[], totalSp, totalAgentCost, agentCostLow, agentCostHigh, sharePct…}` (`score-cases.mjs:285-318`).

### 1.5 Confidence: two distinct things called "confidence"

1. **Per-verdict reader confidence** `high | medium | low` (§1.3).
2. **Per-case / report band label**, from `complexity-taxonomy.json → confidence_bands`:

| key | low_mult | high_mult | label |
|---|---|---|---|
| `cold_no_history` | 0.5 | 2.0 | `ROM (rough order of magnitude) — no project history` |
| `bucket_n_lt_5` | 0.65 | 1.6 | `budgetary — thin sample in this tier` |
| `bucket_n_ge_5` | 0.8 | 1.3 | `calibrated — adequate sample in this tier` |
| `skewed_high` (applies_to low-confidence-verdict, nondeterministic-oracle, external-dependency) | 0.8 | 3.0 | `skewed high — flagged as likely to overrun` |
| `skewed_low` (applies_to split-recommended) | 0.4 | 1.2 | `skewed low — splitting will probably reduce this` |
| `empirical` | — | — | `uses bucket_stats mean ± 1 stdev directly` |

Report headline (`scoping-report-format.md:15-16`):
`**{N} cases → {low}–{high} active-hours, ≈${low_usd}–${high_usd} agent cost** ({point estimate}, confidence: {ROM | budgetary | calibrated})`.
Confidence statement (`:180-185`): "ROM (±50-100%)" vs "calibrated (±20-30%) based on N delivered
cases in matching tiers".

3. **Foundation item confidence** is a third vocabulary: `measured | estimated | assumption`
(`AS/SKILL.md:288-291`; selection file `{ blended_rate_usd_per_hour, items:[{id,size?,include?,reason,confidence}] }` at `:267-273`).

### 1.6 `effort_days` — where it really lives

`automation-scoping` does **not** emit `effort_days`. It appears in two other places:

- `TOK/scripts/build-tokenomics-export.mjs:84-87`: `effortDays = round(caseSp / 8, 1)` — derived
  from the scoped SP ("1 SP = 1h conventional, so SP/8 ≈ person-days-no-AI"), and
  `size_tshirt = effortDaysToSize(effortDays)` with bands `<0.5 XS · ≤1.5 S · ≤3.5 M · ≤7.5 L · else XL`
  (`:53-56`). Missing sizing → `checklist()` flags `effort_days (run the intake sizing pass)`
  (`:149-150`).
- `MQA/knowledge/test-run-report-format.md:98`: `effort_days: 2  # person-days, no AI — a human estimate, never guessed`
  (hand-added frontmatter on `RUN-*.md`; `MQA/hooks/scripts/build-tokenomics-report.mjs:189-191`
  refuses to derive it).

So "effort" has **two provenances** across the two factories: derived-from-SP (test-automation)
vs human-declared (manual-qa). Both land in the same dataset column.

### 1.7 Scope-level assumptions every report must state (they move the total more than any per-case factor)

`AS/SKILL.md:528-537` and `scoping-report-format.md:70-77, 160-172`: **operating shape** (batch
size AND dispatch mechanism), **delivery rate** (blocked case ≈ `1.85×` a delivered one —
`taxonomy.batch_shape.blocked_case_premium`), **clustering shape** (estimate ran `1.30×` hot on
solo, `2.84×` hot on clustered — `taxonomy.clustering.measured_effect`).

### 1.8 Measured validity of the estimate (quote before designing any per-case comparison)

`AS/references/calibration-log.md:505-620` (v0.6.0 holdout, 89 blind-read cases):
per-case dollars **Spearman 0.015** against actuals; batch totals landed within **0.89–1.83×**;
`AS/SKILL.md:539-547`: "**Quote the batch total, not per-case dollars — and say which cost layer.**"
The `project_rate` note in the taxonomy JSON calls the $/active-min rate "THE SINGLE LARGEST SOURCE
OF ERROR IN THIS MODEL" (2.7× variance across four projects).

---

## 2. Mode 4 calibration — today's estimated-vs-actual, one factory

### 2.1 Trigger and posture

`AS/SKILL.md:504-520`: runs "after a project has delivered at least a handful of cases through the
batch pipeline and has `.agents/efficiency/` history", **never as a side effect** ("a deliberate
scout action … not something a batch triggers automatically on its own completion").

```
node {skill}/scripts/build-training-set.mjs --automation-dir .agents/automation \
  --ledger <rollup.json from efficiency-audit --json> --out training-set.json
node {skill}/scripts/calibrate.mjs --training-set training-set.json          # dry-run
node {skill}/scripts/calibrate.mjs --training-set training-set.json --apply  # writes .agents/estimation/*
```

### 2.2 What history it reads

`AS/references/calibration-methodology.md:8-27` and `AS/scripts/build-training-set.mjs:1-11`:

- **`.agents/automation/**/report.json`** (recursive walk, `findReportFiles` `:17-30`) — gives
  `cases[].id`, `.outcome`, `.branch`, batch `integration_branch`, `base`, `batch`.
- **A `usage-rollup.mjs --json` rollup** from `efficiency-audit` passed via `--ledger` —
  `loadLedger` accepts `raw.rollup.ledger || raw.ledger || raw[]` (`:32-39`); each unit carries
  `gitBranch`, `costUsd`, `durationMin`.
- The case snapshot `.agents/automation/<slug>/cases/<ID>.md` (walks up to the campaign root,
  `findCaseSnapshot` `:52-81`) for step count + tier keyword classification.
- `git log <base> --grep <id>` from `--repo-root` for outcome verification (`verifyOutcome` `:83-90`).

It does **not** read `.agents/efficiency/*.md` reports or `cost.json` — despite `SKILL.md:64-67`
saying "`.agents/efficiency/*`". The actual input is the rollup JSON's `ledger` array. (Note the
docs mention `.agents/efficiency/` as the *home* of audit outputs; the script takes whatever
`--ledger` file you hand it.)

### 2.3 What it compares — and the join

Join key is **`gitBranch`** (`calibration-methodology.md:21-27`): sum every ledger unit whose
`gitBranch === case.branch` (divided by `clusterSize` when several cases share a branch,
`build-training-set.mjs:113-132`) **plus** an even share of the batch's `integration_branch`
units. Cost requires branch-specific evidence (`hasReliableCost = branchCost.n > 0`, `:143`);
otherwise `costUsd: null` and a separate `trunkOnlyCostUsd` floor.

Training row (`build-training-set.mjs:163-178`) — exact keys:

```
id, batch, tier, steps, stepsEstimated, costUsd, activeMin, clusterSize, noBranchField,
trunkOnlyCostUsd, trunkOnlyActiveMin, reportedOutcome, outcomeVerified (true|false|null),
reworkSignal (regex /re-review|fix round|fix-only|stabilize|round 2|round 3/i on case note)
```

Summary (`:182-193`): `reportFilesFound, nCasesSeen, nPriced, nUnpriced, nMissingBranchField,
nOutcomeVerified, nOutcomeUnverifiedOrLagging, note`.

> Doc drift worth knowing: `calibration-methodology.md:44-47` shows the row as snake_case
> `{ "id", "tier", "steps", "cost_usd", "active_min", "outcome", "rework_signal" }`; the script emits
> camelCase (`costUsd`, `activeMin`, `reportedOutcome`, `reworkSignal`). `calibrate.mjs` reads the
> camelCase keys (`:25, :122`).

**What "actual" means here: metered active agent-minutes and dollars per case, bucketed by
interaction tier.** It is *not* calendar time. `calibrate.mjs:22-40`:

```js
stats[tier] = { n, mean_min: mean(activeMin), stdev_min, mean_cost: mean(costUsd) }
```

and `impliedMultipliers()` divides each tier's `mean_min` by the `crud-form` anchor (`:42-50`).
The comparison is **observed tier mean vs. the taxonomy's current `multiplier`** — i.e. it
recalibrates the *model*, it does not produce a per-case "estimate vs actual" table.

### 2.4 What it outputs

Dry-run proposal `.agents/estimation/calibration-proposal-<YYYY-MM-DD>.md` (`calibrate.mjs:52-88`):

```
# Calibration proposal — <date>
**Training set(s)**: …   **Rows**: N seen, M priced (used for statistics), K unpriced (excluded, not zeroed …)
## Tier comparison — current taxonomy vs. what this data implies
| Tier | n | mean_min | stdev_min | current mult. | implied mult. | delta |
**⚠ >40% delta, worth inspecting before applying**: <tiers>      (or "_No tier moved more than 40%…_")
## This is a DRY RUN. Nothing has changed.
```

`--apply` (`:142-164`): writes `.agents/estimation/complexity-taxonomy.json` (copy of the current
taxonomy on first run) with `bucket_stats[tier] = {n, mean_min, stdev_min, mean_cost}` merged in
and `calibrated_from[] += { date, n_cases, training_sets }`; appends to
`.agents/estimation/calibration-log.md`:

```
# Calibration log — this project
Append-only. Each entry is one `calibrate.mjs --apply` run.
---
## <date>
**Training set(s)**: …
**Rows**: N seen, M priced
**Tiers updated**: …
**Proposal**: <proposal path>
```

Once `bucket_stats[tier].n >= 2` exists, `score-cases.mjs:377-382` prices that tier at
`mean_min ± stdev_min` instead of the formula (`calibration-methodology.md:126-134`).

The **bundled** `AS/references/calibration-log.md` is the factory-level analogue: dated headings
`## YYYY-MM-DD — vX.Y.Z — <title>` with `**Source**`, `**What changed**`, `**Basis for the
numbers**`, `**Known limitations**`, `**Next revision should**` (e.g. `:22-60`, `:64-142`).

### 2.5 The other est-vs-actual that exists: the tokenomics close-time sizing join

This is the closest thing to a per-item "estimate vs actual" record today, and it runs
automatically at batch close. `TOK/scripts/batch-cost.mjs:318-435`:

- `loadSizings(repo)` reads every `.agents/estimation/*.json` with a `cases[]` array and maps
  `id → { size, sp, estMin, src }` (later files win).
- `applySizing()` stamps each `cost.json` case with:
  `cases[].sizing = { size, sp, estMin, src, baseline{n, medianTok, p90Tok, medianMin, p90Min},
  tokPercentile, minPercentile, flag: 'above-p90' | 'below-p10', note }` — the deviation is
  against the **size class's cross-batch history** (other batches' `cost.json`, `sizeBaselines`
  `:356-382`, `MIN_CLASS_N = 5`), on tokens and active minutes, never dollars.
- Batch rollup `cost.json.sizing = { note, sized, bySize{<size>:{cases, sp, estMin, actualMin,
  actualTok}}, estVsActualMin{ est, actual, ratio }, flagged[{id, size, flag, detail}] }` (`:426-434`).
  The `note` string: "pre-run predicted size (automation-scoping) joined to actuals. Deviations
  … are analysis pointers, never per-case dollar verdicts … Flags feed Mode 4 calibration."

**Key mismatch (inferred from code, not documented anywhere):** `loadSizings` reads
`estMin: num(r.estimated_active_minutes ?? r.est_min)` (`batch-cost.mjs:344`), but
`score-cases.mjs --json` emits the key **`estMin`** (`score-cases.mjs:466`). On a real scored file
`estMin` therefore resolves to `null`, `bySize[].estMin` sums to 0, and `estVsActualMin` is
omitted (`:431` guards on `estTotal && actTotal`). The unit test that exercises the join writes
`estimated_active_minutes` by hand (`TOK/scripts/batch-cost.test.mjs:571-572`), so the test passes
while the production join silently drops the minute estimate. Size/SP still join correctly.
`orchestration-playbook.md:101` nonetheless advertises "est-vs-actual at batch grain" from this
file.

### 2.6 Where a batch is told to run the intake sizing pass (the "estimate" side of every batch)

`TAW/references/orchestration-playbook.md:60`: the pass is "**mandatory before the batch opens, on
every host**"; on Claude Code the build workflow's triage **attests** the verdicts file exists
(`TAW/scripts/workflows/batch-build.workflow.mjs:490,521,738-759`, `sizing_present: boolean`) and
lands a `quality_flags` entry when it doesn't (`:1566-1573`):
`intake sizing/screening pass not run — no .agents/estimation/<slug>-verdicts.json …`.

---

## 3. The campaign card and the `report.json` receipt

### 3.1 Campaign card — `.agents/automation/campaigns/<slug>.md`

`TAW/references/campaign-planning.md:243-298`. "lead-written, and writing it is mandatory … the one
hand-written artifact in the pipeline … **nothing derives it**". Template (`:259-281`, verbatim):

```markdown
# Campaign: <slug>

## State
- Stage: propose | plan-approved | foundation | mini-gate | waves | mirror | closed
- Conductor run: wf_<id>            ← latest Workflow runId; one Log line per invocation
- Foundation merged: no | yes @ <sha>
- Foundation surfaces CLAIMED: agents, pipelines
- Waves: <w1> merged · <w2> running · <w3> pending   ← one word each; the wave REPORT has the detail

## Goal
- Metric: <plan.goal.metric> · measured by `<plan.goal.command>`
- Baseline: <plan.goal.baseline>
- After w1: <number> (<delta>)      ← one line per wave gate, no exceptions

## Plan
<the operator-approved plan JSON, verbatim>

## Log
- <ts> propose — conductor wf_abc launched
- <ts> plan approved by operator (AskUserQuestion checkpoint)
- <ts> foundation mini-gate 3/3 green — merged @ <sha>
```

The `## Log` `<ts>` lines are the **only timestamps in the campaign layer**, and they are
hand-written prose. Per-wave state words: `merged · running · pending`. Plan JSON
(`:153-175`): `campaign, batch, base, goal{metric, command, baseline}, heads[],
foundation{surfaces[], evidence}|null, waves[{slug, caseIds[], clusters[][]}],
policy{reviewerModel, mirror: 'per-wave'|'campaign-end', landing: 'per-batch'|'campaign-end'}`.

Flat batches "need no card: write the runId next to the batch's snapshots and the report covers
the rest" (`:296-298`).

### 3.2 `report.json` — the receipt (per batch, per wave)

Assembled in `TAW/scripts/workflows/batch-build.workflow.mjs:1583-1600`; example
`TAW/references/examples/report.json`:

```
batch, base, work_item_ref?, execution_provider?, integration_branch|null,
gate: { verdict, runs, seconds[], failures[] } | null,
cases: [ { id, outcome, note, findings[{kind: defect|clarification|question|note, note, ref?}],
           branch?, pr?, coverage{full, excluded[{step, category, referent, note}]}?,
           gate{runs, seconds[]}? } ],
totals: { <outcome>: count },
quality_flags: string[], quota_halted: boolean,
expected_red: [{spec, test_id, ticket, why, case_ids[]}], parked: [{ids[], branch, why}]
```

Notes are clipped at 400 chars (`:614-621`). The only required contract downstream is
`cases[]` with `id` + `outcome` (`orchestration-playbook.md:323-327`; `EA/SKILL.md:297-301`).

**Outcome vocabulary** (`orchestration-playbook.md:285-309`), seven terminal values:

| outcome | meaning |
|---|---|
| `delivered` | built, statically reviewed, proven by the gate's N consecutive greens |
| `defect-found` | live execution hit a product defect that blocks the case (spec still merged; ticket-driven re-entry) |
| `blocked` | something about THIS case stopped it (data, access, env, conflict, red gate, R2 cap) |
| `un-automatable` | screening verdicts rule it out (complexity taxonomy) |
| `needs-execution` | policy says manual-qa executes and no evidence exists |
| `not-started` | the run never got to it for a reason not about the case (budget, ceiling, breaker, harness death) |
| `infra-stalled` | harness killed the slot mid-flight |

Plus in-flight markers `built`, `reviewed`, `merged-ungated` (`batch-build.workflow.mjs:600-604`),
and rebuilt-report-only `analysed`/`built` (`EA/SKILL.md:305-309`). Legacy: `automated`,
`merged-sanctioned-red`. The **delivered denominator** is fixed in one place:
`EA/scripts/run-reports.mjs:50`: `DELIVERED_OUTCOMES = ['delivered', 'defect-found', 'automated', 'merged-sanctioned-red']`.
Re-entered cases fold latest-outcome-wins in mtime order (`run-reports.mjs:82-115`; `EA/SKILL.md:287-292`).

**Known unreliability of `outcome`:** it can lag a real merge (`AS/SKILL.md:579-584`;
`orchestration-playbook.md:220-224`: measured "38 of 69 delivered cases (55%) were misrecorded or
had no receipt"). Two script-authored records exist to detect drift: `gate-runs.jsonl` and
work-scope declared outcomes (§4).

### 3.3 The conductor's per-wave return (not persisted by the script)

`batch-campaign.workflow.mjs:480-493`: `waves[] = { wave, status: 'gated-green'|'partial'|'ungated'|
'nothing-landed'|'failed'|'skipped', integration_branch, gate, totals, report_path, report_written,
quality_flags }` plus `landed_waves[]`, `remaining_waves[]`. Nothing writes this to disk — the
lead is told to write the runId to the card.

### 3.4 `cost.json` — the close-time receipt-plus-ledger join

`TOK/scripts/batch-cost.mjs:640-712`, per batch/wave at `.agents/automation/<slug>/cost.json`:
`v, batch, generatedAt, sources{sessions, hosts, users, costSources, models, liveSessions?…},
totals{costUsd, tokens, tokensSplit, tokensByModel, activeMin, dispatches, sessions, turns,
toolCalls, toolErrors, skills}, byRole, overhead{lead, stages, byStage, sharePct}, rework?,
outcomes, delivered, gate, records{gateRuns{count, latest{verdict, at, consecutiveGreen}},
declaredOutcomes, gateDrift?, outcomeDrift?}, cases[{…direct{costUsd,tokens,tok,activeMin,
dispatches,toolCalls,toolErrors,fixRounds}, loaded{costUsd,tokens,activeMin}, sizing?}],
workItemRef?, sizing?, stats, averages{totalPerDelivered, directPerCase}, coverage`.
`generatedAt` is a real ISO timestamp (the script runs in Node, not the workflow sandbox).

---

## 4. Which timestamps exist today per case / batch / wave — and which are missing

### 4.1 What exists

| Record | Path | Timestamp fields | Grain | Source |
|---|---|---|---|---|
| Gate verdict record | `.agents/telemetry/automation/gate-runs/<slug>.jsonl` (when telemetry root exists) else `.agents/automation/<slug>/gate-runs.jsonl` | `at` (ISO, script clock) + `seconds[]` per run | per gate run on a trunk (`tests/batch-<slug>`), or per case branch with `--batch` | `TAW/scripts/gate/gate-case.mjs:191-224` — record: `{at, branch, base, baseRef?, spec?, n, verdict, consecutiveGreen, seconds[], conflictFiles?, coverage?, carriedDirt?}` |
| Live dispatch line | `.agents/telemetry/automation/live/<session>.jsonl` | `endedAt` (transcript end), `at` (capture time); **no `startedAt`** | per sub-agent dispatch; carries `cases[]`, `label`, `role`, `activeMin` | `TOK/hooks/telemetry-capture.mjs:439-449` (Claude), `:520-527` (Copilot: `endedAt = ev.timestamp`) |
| Session ledger line | `.agents/telemetry/automation/usage-*.jsonl` | `startedAt`, `endedAt`, `wallMin`, `activeMin`, `capturedAt` | per session; `subagents[]` entries carry `activeMin` only, no timestamps | `telemetry-capture.mjs:747-793`; documented `TOK/SKILL.md:269-282` |
| Work-scope declaration | `.agents/telemetry/automation/scopes/<session>.json` | `declaredAt`, `updatedAt`, `closedAt`, **`outcomes[<id>].at`** | per session; per-case outcome moment | `TOK/scripts/work-scope.mjs:59-101` — `{v, session, intent, batch?, cases[], source?, declaredAt, updatedAt, outcomes{id:{outcome, at}}, closedAt?}` |
| Batch cost receipt | `.agents/automation/<slug>/cost.json` | `generatedAt`; `records.gateRuns.latest.at` | per batch/wave | `batch-cost.mjs:641, 681` |
| Efficiency-audit ledger unit | `usage-rollup.mjs --json` → `ledger[]` | `startedAt`, `endedAt`, `durationMin`; rollup `agentMinutes`, `wallClockMin` | per transcript/unit | `EA/scripts/usage-rollup.mjs:333-335, 753-754, 797-798` |
| Session-retrospective digest | markdown | `~<min> min` per session (`durationMin` = last − first transcript timestamp) | per session | `session-retrospective/scripts/distill-sessions.mjs:373-380`; `references/digest-format.md:6` |
| Batch time window (as used today) | derived | `report.json` **file mtime** — `window.source: 'report file mtime'` | per batch | `EA/scripts/run-reports.mjs:135-143`: "the report carries no timestamp of its own (the workflow that builds it cannot call a clock)" |
| Batch declaration window | derived | earliest `scopes[].declaredAt` for the batch = `windowStart` guard | per batch | `batch-cost.mjs:437-458` |
| Git | repo | branch creation, commit dates, PR merge time (`gh pr list --state merged`) | per unit / per trunk | `orchestration-playbook.md:311-331` "Git wins over any journal or receipt" |
| Workflow journal | `journal.jsonl` in the run's transcript dir | runtime events (`started`, cached results) | per `agent()` call | `workflow-accelerant.md:76, 525-527`; transient, workflow runs only |
| Campaign card | `.agents/automation/campaigns/<slug>.md` | hand-written `- <ts> …` Log lines | per stage transition / conductor invocation | `campaign-planning.md:277-281` |

Time-to-deliver is defined, but only as an **agentic analysis step**, not a stored field:
`EA/SKILL.md:349-353`: "for **time to deliver**, take the wall-clock span = latest `endedAt` −
earliest `startedAt` across the case's units (active-minutes sums per-unit work; wall-clock is
elapsed and reflects parallelism)".

`manual-qa` test-sizer's "Est. wall clock" per size (`S 1–3 min · M 3–8 min · L 8+ min`,
`MQA/agents/test-sizer/AGENT.md:89-93`) is an execution-time estimate for a single TC run, not a
delivery-cycle estimate.

### 4.2 What is missing (facts, then inference)

- **`report.json` has no timestamp at all** — not at batch level, not per case. The Workflow
  sandbox has "no `Date`/`Math.random`" (`workflow-accelerant.md:446-450`: "the script carries no
  timestamps at all — the report writer and git supply them"). The report *writer* agent is
  instructed to write the JSON "byte for byte" (`batch-build.workflow.mjs:1614`), so it adds none.
- **No per-case start time** anywhere structured. Live dispatch lines carry `endedAt` only; the
  first dispatch naming a case id is recoverable (inference) from the live log + ledger `subagents[]`
  order but is not stored.
- **No per-case "delivered at"** field. The nearest are `scopes/<session>.json.outcomes[id].at`
  (when the lead runs `work-scope.mjs outcome`) and the git merge commit / PR merge time.
- **No wave start/end** in any machine-written record; the wave's trunk gate `at` in
  `gate-runs.jsonl` is the closest to "wave finished".
- **No campaign start/end** except hand-written card Log lines; the conductor's `runId` is written
  by the lead, not by a script.
- **No intake / estimate timestamp**: `<scope>-verdicts.json` and `<scope>-scored.json` carry no
  date; the scoping report has a date only in its heading (`scoping-report-format.md:11`);
  `calibration-proposal-<date>.md` dates its filename.
- **No "planned vs actual wave count/order"** record — `plan.waves` is on the card; wave outcomes
  are in separate `report.json` files; nothing correlates them except the shared `plan.batch`
  directory nesting.
- Case ids repeat across "batch generations" (`batch-cost.mjs:437-448`), so an id alone is not a
  unique work item over time — the receipt dir path (`slug = automation-root-relative path`,
  `batch-cost.mjs:52-58`) is.

---

## 5. manual-qa `metrics-format` — what it measures and how it is shaped

`MQA/knowledge/metrics-format.md` documents the **optional benchmark add-on**: one JSON per run at
`reports/metrics/RUN-YYYY-MM-DD-NNN.json`, built by `MQA/hooks/scripts/build-run-metrics.mjs`
from a pre/post `ccusage` snapshot delta plus a per-TC trace (`:14-49`). Hook chain:
`benchmark-session-start` (SessionStart; writes `.claude/benchmark-session-started-at.txt`) →
`benchmark-preflight` (PreToolUse on first `Agent` dispatch) → `benchmark-tc` (PostToolUse per
`Agent` dispatch, one JSONL line per TC with `agent_type`) → `benchmark-stop` (SubagentStop on
`test-reporter`, fallback SessionEnd).

Shape (`:95-165`), top-level: `run_id, agent_system, model, suite, environment, date` (ISO).

`session{}`: `tokens_coverage: 'full_session'|'full_session_unscoped'|'subagents_only'`,
token quad + `total_tokens`, **`duration_ms`** (first dispatch → end), **`pre_flight_duration_ms`**,
**`total_session_duration_ms`**, `total_tool_uses`, `turns`, `support_agent_*`, `subagent_dispatches`,
`orchestrator_tokens`, `orchestrator_cost_pct`, **`tc_total_duration_ms`** (sum of runners),
**`orchestrator_duration_ms`** (remainder), `total_effective_tokens`,
`tokens_by_agent{<agent>:{dispatches, tokens, …, tool_uses, duration_ms}}`, `tokens_by_model`,
`cache_read_share_pct`, `models_used`, `cost_usd`, `ccusage{pre, post, delta, cost_usd_*}`.

`tcs[]`: `{ tc_id, result: PASS|FAIL|BLOCKED, duration_ms, tokens, input_tokens, output_tokens, tool_uses }`.

`summary{}`: `total, passed, failed, blocked, pass_rate, avg_tokens_per_tc, avg_tool_uses_per_tc, avg_duration_per_tc_s`.

Timing arithmetic (`build-run-metrics.mjs:305-311, 366-370`):
`duration_ms = end − firstDispatch`, `pre_flight = firstDispatch − sessionStart`,
`total_session = end − sessionStart`, `orchestrator_duration = duration − Σtc − Σsupport`. A
`## Timing Breakdown` table is appended to `RUN-*.md` (`:773-778`: Pre-flight / TC execution /
Orchestrator / Reporter / Tracked total / Full session total).

Estimate side in manual-qa: `test-sizer` writes `size: S|M|L` into TC frontmatter
(`MQA/agents/test-sizer/AGENT.md:112-114`), which `test-runner` reads back into the run report's
Size Distribution and by-size token analytics (`MQA/knowledge/test-run-report-format.md:172`);
`effort_days`/`work_item_ref`/`maturity`/`env_setup` are hand-added frontmatter for the tokenomics
export (`:85-105`).

**Alignment facts:** manual-qa measures *wall-clock per run and per TC* (ms), attributes duration
per agent persona, and treats the orchestrator as a computed remainder. Test-automation measures
*active minutes and dollars per case/batch* and has no per-item wall clock. Both feed the same
cross-factory tokenomics dataset row (`work_item_ref`, `effort_days`, `size_tshirt`,
`scenarios_authored/automated/executed`, `turns`, `subagent_dispatches`, `orchestrator_cost_pct`,
`tokens_by_model`, `cache_read_share_pct`).

---

## 6. Implications for the spec

### 6.1 What "estimate" already means

- **Unit:** `active_minutes` per case (`estMin`, band `lowMin`–`highMin`), priced at a per-project
  `$/active-min` rate; plus **work size** `XS|S|M|L|XL` → SP (1 SP = 1 conventional hour). Neither
  is calendar/cycle time. There is **no existing estimate of wall-clock delivery time** for a
  case, wave or campaign — the closest are `scoping-report-format.md`'s "active-hours" headline
  (agent minutes, not elapsed) and test-sizer's per-TC execution wall clock.
- **Always a range with a named tier** (`ROM | budgetary | calibrated`, plus `skewed high/low`).
  A cycle-time estimate that ships a single number would contradict the factory's stated doctrine
  (`AS/SKILL.md:28-32`).
- **Provenance is tracked per row** (`classification: verdict|keyword`, `sizeBasis:
  derived|derived-partial`, foundation `measured|estimated|assumption`). The tracker should carry
  provenance for any time estimate the same way.
- **Per-case dollars rank-correlate ~zero with actuals** (Spearman 0.015); the doctrine is quote
  batch (wave) totals. Any per-case cycle-time-vs-estimate view should expect the same: present at
  wave/campaign grain, keep per-case rows for sequencing/analysis, and label per-case ratios as
  "analysis pointers" exactly as `cost.json.sizing.note` does.
- Scope-level assumptions that dominate error — **operating shape** (batch size + dispatch
  mechanism), **delivery rate**, **clustering shape** — must be recorded with the estimate to be
  comparable later. Cadence is directly a function of them ("units are the wall clock").

### 6.2 What "actual" already means

- **Actual = metered active minutes + dollars + tokens**, attributed to a case by (a) `gitBranch`
  equality (Mode 4) or (b) receipt case ids matched in dispatch labels/transcripts (tokenomics),
  with batch overhead shown once and optionally allocated evenly (`loaded`). Cluster members split
  a branch's cost evenly. Trunk/overhead is ~28–44% and can never be case-attributed.
- **Outcome** is the receipt's `cases[].outcome` in the closed vocabulary (§3.2), with
  `DELIVERED_OUTCOMES = ['delivered','defect-found','automated','merged-sanctioned-red']`. Two
  denominators, always: per **delivered** and per **examined** (`EA/SKILL.md:280-286`).
- **The receipt is known to lag reality**; script-authored records (`gate-runs.jsonl.at`,
  `scopes/*.json.outcomes[id].at`) and git (merge time) are the trustworthy signals. A delivery
  tracker should read those before `report.json`, and surface `gateDrift`/`outcomeDrift` rather
  than hide them (`cost.json.records`).

### 6.3 Where a cross-factory delivery ledger would join

| Tracker need | Existing record and key | Notes |
|---|---|---|
| Work-item identity | `report.json.batch` (+ receipt dir path for waves), `work_item_ref`, `cases[].id`, `plan.campaign`, `plan.waves[].slug` | ids repeat across generations; use the receipt dir path (`<batch>/<wave>`) as the unique key |
| Estimate per case | `.agents/estimation/<scope>-scored.json.cases[]` (`estMin/lowMin/highMin`, `size`, `sp`, `confidence`) — loaded already by `batch-cost.loadSizings` | fix or accommodate the `estMin` vs `estimated_active_minutes` key mismatch (§2.5) |
| Estimate per wave/campaign | sum of the above; plan JSON on the campaign card (`waves[]`, `clusters[]`, `foundation`) | no stored estimate date — add one |
| Actual minutes/$ per case | `cost.json.cases[].direct/loaded`; Mode 4 `training-set.json` rows | both already reconcile to the ledger |
| Actual outcome per case + moment | `report.json.cases[].outcome` (lagging) · `scopes/<session>.json.outcomes[id].at` (moment) · git merge | outcome vocabulary is fixed; reuse it |
| Wave finished | `gate-runs.jsonl` `{at, branch: tests/batch-<slug>, verdict: green}` | script-authored, most reliable "done" clock today |
| Wave/batch started | earliest `scopes[].declaredAt` with that `batch` (`batch-cost.mjs:437-458`) or earliest ledger `startedAt` of a session whose `scope.batch` matches | inference: `declaredAt` is the intended "work began" moment |
| Session wall clock | ledger `startedAt/endedAt/wallMin` | only wall-clock fields that exist |
| Campaign stage transitions | card `## Log` `<ts>` lines (hand-written) | not machine-parseable today; the card template would need a structured Log or a sibling JSON |
| Calibration history | `.agents/estimation/calibration-log.md`, `complexity-taxonomy.json.calibrated_from[]` | the tracker's "estimate quality over time" view has a precedent here |
| manual-qa run timing | `reports/metrics/RUN-*.json` (`session.duration_ms`, `tcs[].duration_ms`) | different unit (ms, wall) and hierarchy (run → TC) |

### 6.4 Gaps the spec will have to close (facts from §4.2, stated as implications)

1. No machine-written **start** or **end** timestamp exists for a case, wave or campaign; the
   workflow sandbox cannot call a clock, so any new timestamp must come from a Node script or hook
   (`gate-case.mjs`, `work-scope.mjs`, `telemetry-capture.mjs` are the precedents) or from git.
2. `report.json` file mtime is currently used as the batch window and is documented as fragile
   ("destroyed by a fresh clone", `run-reports.mjs:136-140`).
3. The campaign card is the only place plan-vs-actual wave composition lives, and it is prose.
4. Estimates carry no date; a cycle-time tracker comparing "estimated at" vs "delivered at" needs
   one.
5. Mode 4 recalibrates *minutes per tier*; nothing recalibrates *elapsed time per unit/wave*. The
   `cost.json.sizing` join is the natural place to add elapsed-time deviation, since it already
   has size-class baselines and flags (`above-p90`/`below-p10`).
6. Vocabulary: adopt `campaign → wave → unit → case` (and `batch` = flat wave) or publish a mapping;
   `mission`/`task` have no referent here.
