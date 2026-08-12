# Calibration log — bundled default taxonomy

Append-only history of revisions to the **shipped** `complexity-taxonomy.json`
prior (the cross-project starting point every new project's Mode 1/2
estimates use before it has its own calibration data). This is distinct from
a project's own `.agents/estimation/calibration-log.md`, which tracks that
one project's recalibrations via Mode 4 — see `calibration-methodology.md`.

Bundle maintainers: append a dated entry here whenever the shipped
`complexity-taxonomy.json` changes, following the same discipline Mode 4
asks of a project-local calibration — what changed, from what evidence, and
why the new numbers are trustworthy.

---

## 2026-08-05 — v0.1.0 — seed calibration

**Source**: `seed-project-1` (anonymized client engagement), 19 delivered
cases, `test-automation-lead` pipeline (Claude Code Workflow-tool batch),
Playwright/pytest UI suite. Full data: that project's own internal
efficiency-audit output (not disclosable — this bundle is public).

**What was set**: all initial values — `base_minutes_by_step_bucket`, the
five `interaction_tiers` + keyword sets + multipliers, `default_dollar_per_minute`
($0.27, claude-sonnet-5 pricing as of this date), `confidence_bands`.

**Basis for the numbers**:
- Step count vs. cost: r≈0.37 (weak) — set the base-minutes table as a floor,
  not a driver.
- Interaction tier (canvas/node-graph vs. CRUD/form) vs. cost: the single
  strongest signal found — ~55% cost gap, ~43% time gap, at near-identical
  average step counts (9.3 vs 8.7) between the two largest observed tiers.
- Novel-surface rework: one clean worked example (a case that cost +67% over
  its tier average, root-caused via session memory logs to "no prior page
  object for this surface," not case complexity) — enough to justify the
  factor's existence, not enough to trust its exact multiplier (1.45) with
  confidence. Revisit once ≥3 novel-surface cases have been observed across
  any project.

**Known limitations of this seed** (carry forward until addressed):
- n=1 project, one tech stack (Playwright/pytest, UI-only cases in the
  sample), one orchestration shape. No API/mobile/perf cases in the training
  data — those tiers' multipliers are structural guesses, not measured.
- `async-realtime` tier's 1.45 multiplier has **no direct case evidence** in
  the seed set (no chat/websocket case happened to run in the audited
  window) — it's set by analogy to `rich-widget`'s measured premium, pending
  real data.
- Rework tail-risk is qualitatively confirmed but not quantified (no
  rework-rate-per-tier statistic yet — needs a larger n to compute
  meaningfully).

**Next revision should**: pull in a second project's calibration data (ideally
a different stack/test-type) before adjusting any multiplier here, to start
separating "true cross-project signal" from "one project's quirk."

---

## 2026-08-05 — v0.2.0 — two-project cross-check, one real correction

**Sources**: ran `build-training-set.mjs` + `calibrate.mjs` (dry-run) against
two real projects:
- `seed-project-1` — the same engagement as v0.1.0's seed, but widened from
  its original n=19 to its **full history, n=80 cases** (pulled in an earlier
  ~60-case campaign that predated the v0.1.0 seed window).
- `seed-project-2` — a genuinely **different client engagement, different
  stack** (TypeScript/Playwright vs. seed-project-1's Python/pytest), n=38
  priced cases. The first real independent cross-check this taxonomy has had.

Both projects' `report.json`→ledger joins came back 95-100% priced
(seed-project-1: 80/80, seed-project-2: 38/40) — the branch-based join
mechanism in `build-training-set.mjs` § Step 1 held up on two differently-shaped
real pipelines, which is itself worth recording (it was designed against
seed-project-1's data; seed-project-2 validated it generalizes).

**What changed**:

- **`async-realtime`: 1.45 → 1.05 (real correction, not a refinement).**
  v0.1.0 set this by analogy to `rich-widget` — explicitly flagged at the time
  as having "no direct case evidence." Now it has evidence from two
  independent projects, and **both disconfirm the premium**:
  seed-project-1 (n=14) implied 0.92x, seed-project-2 (n=31, its
  largest-n tier) implied 1.18x. Neither is anywhere near 1.45. This is the
  calibration loop doing exactly its job — catching a plausible-sounding
  guess ("realtime/async feels like it should cost more") that real data
  says is wrong, at least for chat/websocket-flavored UI test cases in these
  two pipelines.
- **`rich-widget`: 1.55 → 1.75 (strengthened, same-project data only).**
  seed-project-1's larger sample (n=11, up from the original n=6) implies
  1.79x — confirms and sharpens the original finding. seed-project-2 has only
  n=1 in this tier — too thin to use, and honestly flagged in
  `complexity-taxonomy.json`'s `revision_note` as **unconfirmed on a second
  stack**. Don't over-read "two projects calibrated this" for this
  particular tier — it's really "one project, more data."
- **`static-display`: left at 0.85, NOT applied despite a flagged delta.**
  seed-project-2 (n=3) implied 1.23x — a >40% delta that
  `calibrate.mjs`'s own proposal correctly flagged for inspection. Declined
  to apply it: n=3 is thin, contradicts the qualitative expectation (a pure
  read-only page-load case being *more* expensive than a CRUD form is
  surprising enough to want more evidence before moving on it), and
  seed-project-1 has zero cases in this tier to cross-check against. Logged
  as an open question, not silently applied — see
  `complexity-taxonomy.json`'s `revision_note` on this tier.
- **`multi-step-flow`: left at 1.15, still zero evidence** in either project.
  Still a structural guess.
- **`default_dollar_per_minute`: 0.27 → 0.248**, refined from seed-project-1's
  larger n=80 sample. Also recorded seed-project-2's measured rate ($0.160/min,
  same week, different stack) directly in the caveat text — the 35% gap
  between two real, contemporaneous measurements is itself the best evidence
  for why this value must never be trusted as a universal constant.

**What this revision demonstrates methodologically**: the calibration loop's
value isn't just "sharpens numbers" — it's **catching a wrong assumption**
(async-realtime) that would have quietly overstated every chat/notification/
websocket case's estimate indefinitely if nothing had ever checked it against
real delivery data. The `rich-widget` case shows the flip side: same-project
refinement looks like agreement but isn't yet cross-project validation, and
the taxonomy says so explicitly rather than implying more confidence than
two data points (one thin) earn.

**Known limitations carried forward**:
- `multi-step-flow` and (now) `static-display` both need real data before
  their next move — flagging both as the priority gaps for whoever runs the
  next calibration pass.
- Both calibration inputs are UI test-automation pipelines. No API/mobile/perf
  project has calibrated this taxonomy yet — those tiers, if added, would
  start from zero evidence exactly as `async-realtime` did in v0.1.0.
- Novelty multiplier (1.45 for a novel surface) still rests on the single
  v0.1.0 worked example — `build-training-set.mjs`'s `reworkSignal` heuristic
  is a start toward measuring this directly but wasn't cross-tabulated against
  novelty in this revision.

**Next revision should**: get `multi-step-flow` and `static-display` real
data (any project with wizard/tour cases or a cleaner read-only-page sample);
recompute the step-count-vs-cost correlation against the widened n=80/n=38
sets (still only measured on the original n=19); consider whether novelty
should be cross-tabulated with `reworkSignal` now that the tooling exists.

---

## 2026-08-05 — v0.3.0 — third project, async-realtime correction confirmed further, a methodology fix logged

**Source**: `seed-project-3` (anonymized — a third client engagement, same
stack as seed-project-2, different codebase/repo history), n=5 delivered
cases, all in the `async-realtime` tier (chat/conversation flows).

**How this data was recovered — worth recording on its own.**
`build-training-set.mjs`'s automated branch-join initially found cost data
for only 1 of the batch's 7 cases: the on-disk `report.json` predated the
batch's real merges (it was snapshotted mid-run, before 4 of the cases had a
`branch` field at all — see `calibration-methodology.md`'s new § "When the
automated join comes up mostly empty"). The 5 delivered cases' real
cost/time existed in a separate, already-run efficiency audit that had
cross-checked the ledger against `gh pr list --state merged` by hand for
exactly this reason. Rebuilt a training-set file from that audit's own
per-case table + live tier classification against the real case files, fed
it to `calibrate.mjs --training-set` same as an automated one. **This is now
documented as the sanctioned fallback** — the join failing isn't a dead end,
it's a signal to check whether a *different* efficiency-audit pass already
did the reconciliation by hand.

**What changed**:

- **`async-realtime`: 1.05 → 0.85.** This is the third consecutive downward
  correction for this tier (1.45 → 1.05 → 0.85) and now the best-evidenced
  number in the whole taxonomy: three independent codebases (two different
  stacks) all land at or below baseline cost for chat/realtime cases —
  seed-project-1 (n=14) 0.92x, seed-project-2 (n=31) 1.18x, seed-project-3
  (n=5, 100% of its sample) fits the same pattern. Pooled n=50, implied
  0.84x. The original 1.45 guess ("realtime feels expensive") was not just
  imprecise, it was directionally wrong, and it took three passes of real
  delivery data to fully unwind that intuition. This is the clearest
  evidence yet for why this taxonomy exists — the calibration loop earns its
  keep by catching exactly this kind of confident-but-wrong guess.
- **`rich-widget` and `static-display`: left unchanged**, but both notes
  updated — `rich-widget`'s pooled delta is now -1.1% (confirmed, though
  still 11/12 cases from one project); `static-display`'s pooled delta
  dropped from the earlier +44.7% (measured against one project's thin n=3
  crud-form baseline) to +4.7% (measured against the full n=58 pooled
  baseline) — the earlier decision NOT to apply that thin, contradictory
  signal turned out to be the right call, and the taxonomy's own notes now
  say so explicitly rather than just claiming it in hindsight.

**Methodological lesson worth generalizing**: a tier's implied multiplier is
only as trustworthy as the **anchor sample** (`crud-form`) it's measured
against. `static-display`'s apparent +44.7% outlier in v0.2.0 was measured
against seed-project-2's own thin n=3 `crud-form` baseline; against the
pooled n=58 baseline the same 3 cases barely move the needle. When a single
project's calibration proposal flags a big delta, check whether the anchor
tier itself has enough same-project data before trusting the ratio — pooling
across projects can resolve an apparent contradiction that project-local data
alone can't.

**Known limitations carried forward**: `multi-step-flow` still has zero
evidence across all three projects — now the clear single highest-priority
gap. `rich-widget`'s premium is still effectively one-project-confirmed.

---

## 2026-08-05 — v0.3.1 — tool fix (cluster cost double-counting) + acceleration hypothesis tested, NOT confirmed

**Prompted by**: a direct question — once a surface/module is "known"
(page objects, testids already exist for it), do later cases on it cost
less? Worth documenting fully because the investigation caught a real bug
before it could answer the question wrong.

**Bug found and fixed in `build-training-set.mjs`**: when several cases in
one `report.json` share the same `branch` (the pipeline's own "cluster
dispatch" mechanic — one analyst session, one implementer branch/PR,
separate specs per case), `sumByBranch()` returned that branch's FULL cost
for every case sharing it, rather than dividing it. A real 3-case cluster
in seed-project-1 reported **$13.83 for all three** identically — the
branch's total, silently triple-counted if anyone summed the rows. Fixed:
`clusterSize` is now computed per report.json (how many of its cases share
each branch) and branch cost is divided by it; a new `clusterSize` field is
written per row so this is visible, not silently corrected out of sight.
3 new tests cover this directly (`build-training-set.test.mjs`). **This
affects every prior calibration pass** — re-ran the full seed-project-1
join after the fix; none of v0.1.0–v0.3.0's tier multipliers moved enough
to matter (clustered cases are spread across tiers, not concentrated in
one), but the raw per-case numbers anyone reads directly (e.g. in a
per-case cost report) were wrong before this fix wherever clustering
occurred — 34 of 60 branched cases in seed-project-1 (57%) were clustered.

**The actual question — tested three ways, on the corrected data:**

1. **Solo vs. clustered, pooled (n=46 solo, n=34 clustered)**: avg cost
   $8.33 vs. $8.32 — indistinguishable. Same result restricted to
   `crud-form` tier only (n=29 solo, n=26 clustered): $6.13 vs. $7.26 —
   clustered was *more* expensive, the opposite of the hypothesis.
2. **`corr(clusterSize, cost)` across all 80 priced cases: -0.065** —
   effectively zero.
3. **One single-module anecdote did look suggestive**: the `pipelines`
   module's first 4 solo-dispatched cases declined monotonically
   ($29.40 → $22.80 → $17.44 → $9.60), consistent with a real
   "canvas/pipeline-testing pattern gets more familiar" story — but the
   5th case (`CASE-2042`, a structurally different widget — a state
   panel, not a node-config dialog) broke the trend back up to $23.51, and
   this pattern did **not replicate** in any of the other 5 modules with
   n≥3 checked (`agents`, `settings-personal-tokens`,
   `settings-users-and-roles`, `settings-analytics`, `toolkits-credentials`)
   — all of those were dominated by scenario-specific cost (a create/mutate
   action vs. a read-only check; a rework or extra-review-round event),
   not sequence position.

**Conclusion: no general "known surface → cheaper" effect found, and this
is a real result, not a data gap.** n=80 with real variance in both
directions is enough to say a broad discount isn't there, not just "not
proven yet." **Do not apply a repetition/sequence/clustering discount when
estimating a scope of cases** — cost each case at its full tier-estimated
cost regardless of how many other cases touch the same surface, until
better-controlled evidence says otherwise (ideally a project that runs many
genuinely-near-duplicate cases deliberately, isolating this from the
scenario-complexity confound that dominated every check here).

**What this means for the taxonomy as shipped**: `novelty_multiplier`
(1.45 for a first-touch on a brand-new surface) is UNCHANGED by this — it
rests on its own single worked example (a novel-surface case's rework, not
a sequence-position effect) and is a distinct claim from "does cost keep
declining as more cases touch an already-established surface," which is
what was tested and not found here. The taxonomy's model (base × tier ×
novelty) stays a 3-factor model, not 4 — a repetition/sequence term was
considered and rejected on evidence, not omitted for lack of trying.

---

## 2026-08-05 — a specific routing hypothesis, checked and NOT confirmed (TC-012)

**Question asked**: were cases on an already-known surface routed straight
to the implementer, skipping the analyst/AFS step — and if so, any cost
effect? Checked directly with a fresh audit of a fourth real project (the
fork repo used only as read-only calibration input, per its own project
briefing) rather than assumed.

**What the ledger seemed to show at first**: one case, `TC-012` (edit
existing agent), had exactly one ledger unit on its own branch and it was
`test-automation-engineer` only — no `qa-engineer` anywhere on that branch.
Looked exactly like the hypothesis: surface skip, straight to build.

**What actually happened, once checked against `report.json`, the AFS file,
and the project's own daily memory logs**: TC-012 had a real AFS
(`test-specs/agents/l2_edit_existing_agent_TC-012.md`) — it was fully
analysed, same as its 13 siblings in a single 14-case wave. The wave's
automated `batch-campaign.workflow.mjs` run **crashed mid-way** ("Connection
closed mid-response") and its own end-of-run summary was a false negative
(`status: nothing-landed, blocked: 14`). The lead didn't trust it — read
git/gh/journal.jsonl directly instead and found 13/14 cases had actually
built, been reviewed (APPROVED), and merged; **only TC-012's review dispatch
had silently dropped** — a pipeline-stage failure with no error trail.
Recovered with a manually-dispatched fresh review + merge-back, both tagged
to the wave's trunk branch (`tests/batch-smoke-agents-w1`), not TC-012's own
branch — which is exactly why the first-pass ledger check missed them.

**Checked whether this generalizes** — grepped for the same "only
`test-automation-engineer`, no `qa-engineer`" signature across all
calibration projects: found 4 more instances in seed-project-1 and 10 more
in seed-project-2. Spot-checked one from each project directly
(`CASE-2162` and, above, `TC-012`) by searching the ledger's
`description`/`dispatched` text for the case id regardless of branch. **Both
turned out to be the same artifact**: a real review existed, dispatched
against a trunk/batch branch instead of the case's own branch. Did not
spot-check all 14 — treat the other 12 as *likely* the same pattern, not
confirmed one-by-one.

**Answer to the actual question**: no evidence of a deliberate
known-surface → skip-analyst routing found. What was found instead — and
is arguably more useful — is (a) a real pipeline reliability gap (a crashed
workflow's own summary can be a false negative; the fix was reading raw
git/gh state instead of trusting it, the same discipline already codified
for `report.json`'s `outcome` field, now shown to apply to a workflow run's
own final report too), and (b) a real tool gap in `build-training-set.mjs`
(now documented in `calibration-methodology.md` § Known limitation) — cost
attributed to a trunk branch instead of a case branch is invisible to the
per-case join, and can be **entirely missing**, not just misattributed, when
the report.json snapshot predates `integration_branch` being set (exactly
TC-012's situation — that report.json shows `integration_branch: null`).
TC-012's true total cost is at least $6.84+$1.04+$0.77 = **$8.65** (build +
recovery review + recovery merge), not the $6.84 a naive branch-join alone
would report — recovering from the crash cost *more*, not less, than a
clean single pass would have.

---

## 2026-08-05 — v0.4.0 — three compounding tool bugs found via a single cross-check, most of v0.2.0–v0.3.0's specific numbers superseded

**How this started**: a user pointed at one already-published hand-verified
report (`CASE-2168` documented at $34.48/141min in an earlier, independent
per-case audit) and asked whether it had already been accounted for. Cross-
checking it against `build-training-set.mjs`'s own output for the same case
found **$3.09/17.7min — an 11x undercount**. Chasing that one discrepancy
uncovered three separate, compounding bugs, all now fixed with regression
tests (`build-training-set.test.mjs`, 24 tests total across the skill).

**Bug 1 — cost attributed to a case with NO branch recorded at all.**
`CASE-2168`'s `report.json` entry had no `branch` field (a "solo" case
whose branch was apparently never captured). The old code's `hasCost =
branchCost.n > 0 || trunkPool.n > 0` treated a nonzero *trunk* pool as
sufficient evidence the case was "priced" — so it silently reported the
case's per-case *share of shared batch overhead* ($3.09) as if it were the
case's full cost, when the dedicated implement+review work (~$31 of the real
$34.48) was never counted at all. **Scope: 20 of 83 real-outcome cases in
seed-project-1 (24%) had no `branch` field** — this wasn't a one-off.
**Fix**: `costUsd` now requires real branch-specific ledger evidence
(`branchCost.n > 0`); a case with no branch gets `costUsd: null` (excluded
from statistics, not silently zeroed) plus a new `trunkOnlyCostUsd` field —
a labelled, known-incomplete floor, never fed into `bucket_stats`.

**Bug 2 — case snapshots invisible in a nested campaign folder, corrupting
step counts.** A 50-case campaign kept ONE shared `cases/` snapshot
directory at the *campaign* root while nesting its two `report.json` files
in per-wave subfolders (the exact same nesting shape that already made
`--resolved-from`'s shallow glob miss files, documented back in the very
first per-case efficiency report this bundle drew on). `findCaseSnapshot`
only ever checked the report's own directory, never a parent — so roughly
half of seed-project-1's rows fell back to scoring the report's often
one-line `note` field via the word-count heuristic instead of the real case
text. Observed effect: campaign-wide step counts falling to an implausible
2.5 avg (vs. ~9 for correctly-found cases), and knock-on tier
misclassification for anything scored off that short fallback text. **Fix**:
`findCaseSnapshot` now walks from the report's directory up toward (and
including) `automationDir`, checking `<dir>/cases/<id>.md` at each level —
nearest match wins.

**Bug 3 — cluster cost triple-counted** (fixed and logged separately above,
2026-08-05 v0.3.1 entry) — included here because bugs 1 and 3 partially
CANCELLED each other in the original async-realtime calibration: bug 3
inflated some rows (full branch cost double/triple-counted per clustered
case), bug 1 deflated others (missing-branch cases silently near-zeroed).
The tier's mean landed close to today's corrected value **by accident**, not
because the pipeline was sound — a genuinely dangerous kind of "looks
right." This is why every prior async-realtime revision_note in
`complexity-taxonomy.json` now carries a pointer back to this entry instead
of standing alone.

**What changed, after fixing all three and re-running seed-project-1 (n=60
priced, up in reliability though down in raw count from 80 — the missing-
branch cases are correctly excluded now, not badly-included) and
seed-project-2 (barely affected, 1 case) through the corrected pipeline:**

| Tier | v0.3.0 (buggy data) | v0.4.0 (corrected) | Reading |
|---|---|---|---|
| `async-realtime` | 0.85 | **0.87** | Net unchanged (+2.4%) — the earlier value turns out to have been approximately right, but for the wrong reason (bug cancellation, not real signal). Treat the v0.4.0 number as the first one actually earned by clean data. |
| `rich-widget` | 1.75 | **1.42** | Real correction (-18.9%) — this tier's true n grew 12→17 as previously-invisible cases (bug 2) were found; the premium is real but smaller than v0.2.0/v0.3.0 claimed. |
| `static-display` | 0.85 | **0.87** | Trivial (+2.4%) — the n=3/one-project limitation is unchanged, only the number nudged. |
| `crud-form` | 1.0 (anchor) | 1.0 (anchor) | n dropped 55→23 (many "crud-form" rows were bug-2 fallback-misclassifications, not real crud-form cases) — the anchor itself is now a smaller but more honest sample. |

**A new finding surfaced by the same corrected data, directly contradicting
the v0.3.1 "no repetition/acceleration discount" conclusion**: with all
three bugs fixed, solo-vs-clustered cost is no longer indistinguishable.
Controlling for tier (checked in `crud-form`, `async-realtime`, and
`rich-widget` individually — the discount holds in all three) and for step
count (solo avg 9.0 steps vs. clustered avg 8.2 — not a meaningful
difference, so this isn't just "clustered cases are shorter"):
`corr(clusterSize, cost) = -0.402` (moderate). Solo cases average
**$12.36**, clustered cases average **$8.32** — clustering is associated
with roughly 30–50% lower per-case cost, consistently across tiers.

**This does NOT mean v0.3.1's methodology was wrong — it means v0.3.1's
DATA was wrong**, from the same bugs documented above (specifically bug 1:
every one of the 20 missing-branch cases defaulted to `clusterSize: 1`,
silently dragging the "solo" bucket's average down to look artificially
cheap and erasing a real gap). The three-way check (solo-vs-clustered pooled,
`corr`, and tier-controlled) is the right methodology; it just needs to be
re-run on clean data, which this entry now provides.

**Still NOT applying a clustering discount to the cost formula.** Two
reasons, both from `SKILL.md`'s existing discipline, not new caveats: (1) a
real, uncorrected confound remains — cases that get clustered are *chosen*
by the lead because they look similar/related; this could be a genuine
shared-exploration cost saving, or it could be that the kinds of cases
selected for clustering were already going to be cheaper regardless of
whether they were clustered (a selection effect, not a causal one) — this
dataset can't distinguish the two. (2) n=60 priced cases is enough to see a
real correlation, not yet enough to trust a specific discount magnitude
across projects. **Recommendation, revised**: this is now a real, open lead
worth testing on a fourth project rather than a closed question — not yet a
taxonomy factor.

**Housekeeping**: `SKILL.md`'s anti-patterns entry and
`complexity-taxonomy.md`'s "why there's no repetition/acceleration
discount" section both stated the v0.3.1 conclusion as settled fact — both
corrected in the same pass as this entry to reflect the above, rather than
left standing as a now-known-wrong claim.

---

## 2026-08-12 — v0.5.0 — the work-size axis and the foundation catalog

**What changed**: two ADDITIONS, no revisions. `complexity-taxonomy.json`
gains `size_scale` (XS/S/M/L/XL → Service Points, 1 SP = 1 hour of
conventional engineer effort) and `size_rubric` (the driver → points →
size derivation). A new `foundation-catalog.json` prices the one-time,
non-per-case work. **No existing multiplier, band, tier or rate moved** —
`base × tier × novelty` produces exactly the numbers it produced at v0.4.0,
and the existing tests still pass unchanged.

**Source**: two client POC trackers from the same programme, supplied as
xlsx and read directly:

- A **UI test-automation engagement** (qavajs/Playwright, 3 weeks part-time,
  2 portals, 32 tests / 16 E2E scenarios, framework + CI/CD + report-portal
  integration). 35 logged activities, 159 SP, $439.41 AI token cost, 29.7
  human hours, $45/hr blended. Its "SP Reference" sheet is the origin of the
  XS=1/S=2/M=4/L=8/XL=16 scale and its worked anchors; its Activity Log is
  the only per-activity size-and-cost data behind the numbers below.
- A **pre-AI manual baseline** of a separate 2-month Playwright engagement
  (10 TCs, 211 tracked hours) from the same programme — used only for the
  independent foundation-share cross-check.

**What the data actually supports**:

- **Foundation share of total SP: 21% (manual engagement) and 26% (AI
  engagement)** — two independent sources, close agreement. Shipped as a
  sanity *band*, explicitly not a rule.
- **Foundation is SP-heavy and agent-cheap**: 25.8% of delivered SP against
  5.9% of token cost ($26.13 of $439.41) — ~$0.64/SP against ~$3.07/SP for
  test development, a ~4.8× gap (n=7 foundation activities). This is the
  finding that justifies the second currency existing at all, and the reason
  foundation's agent cost is left unpriced rather than derived from the
  per-case rate.
- **`new_abstractions` as the dominant size driver**: 15 of the engagement's
  19 new page objects sat in L-sized rows. This is the countable form of the
  existing binary `novelty_multiplier`, which is why it was cheap to add —
  the verdict pass already had to answer the question.
- **Orchestration overhead, noted but not folded in**: unattributable parent
  sessions were 16.8% of token cost for 2.5% of SP — the per-batch
  orchestration tax `complexity-taxonomy.md` § Batch shape already prices.
  Deliberately kept out of the foundation catalog.

**What the data does NOT support, stated because it constrains use**:

- **Size predicts agent cost only coarsely.** Median AI cost by logged size
  (n=16 test-development rows, one $145.53 documented-failure row excluded):
  S $6.12, M $5.55, L $15.00, XL $17.22. **S and M do not separate.** This is
  why the size axis is reported beside the agent-cost model and never
  derived from it or into it.
- **The rubric is validated against noisy labels.** Replaying it against the
  engagement's hand-assigned sizes reproduces most and misses some — and at
  least one row was re-sized M→XL between two versions of the same tracker,
  so the ground truth is a human judgement that changed its mind. n≈16, one
  engagement. A derived size is a defensible default a reader overrides
  (`verdict.size`), not a measurement.
- **Several catalog items are sized by analogy, not measurement** —
  `auth-bootstrap` and `ci-advanced` in particular had no directly
  corresponding logged activity. Each item's `evidence` field says which are
  measured and which are inferred; `ci-advanced` is the least-evidenced item
  shipped.
- **One programme, one stack family.** Both trackers come from the same
  organisation and a Playwright-shaped world. The scale and the catalog
  shape should generalize; the specific item list is a UI-web starting
  point, same caveat as the interaction tiers.

**Blended rate deliberately not defaulted.** Observed $45/hr (automation)
and $35/hr (manual) in the two trackers. SP → money is commercial and
per-engagement; a baked-in default would silently misquote, so the reports
quote SP alone unless `--blended-rate` is passed.

---

## 2026-08-12 — v0.6.0 — first blind-holdout validation, and the corrections it forced

**This is the first entry driven by an out-of-sample test rather than by
re-reading the calibration data.** It is also the least flattering. Read the
"what failed" section before trusting any per-case number this skill emits.

### Method

Six sub-agents blind-read **89 pre-automation case snapshots** from
`seed-project-1`'s own `.agents/automation/<batch>/cases/` directories, under an
enforced fence: no finished specs, no test code, no efficiency audits, no
`report.json`, no memory, no git history, no live app. All six confirmed
compliance; the snapshots were independently verified to contain no testids,
selectors or environment details. Their verdicts were priced by
`score-cases.mjs` at the project's **measured** rate ($0.266/active-min, from 19
single-case runs) and compared against five metered efficiency audits.

**Holdout discipline**: the taxonomy's calibration is dated 2026-08-05. Three of
the four batches (11 + 13 + 55 = 79 of the 89 cases) post-date it and are
genuine holdouts; the fourth (10 cases) is in-sample and was reported separately.
26 cases had individual branch-attributed actuals; 7 waves and 4 batches had
aggregate actuals.

### What failed

- **Per-case dollars carry no signal.** Spearman rank correlation between
  estimate and actual per-case cost: **0.015**. Pearson +0.166. The model was
  presenting per-case point estimates that do not rank.
- **Systematic over-estimate of 1.66×** (median 2.30×) against branch-attributed
  actuals — traced to `base_minutes` measuring an ambiguous layer.
- **Wave-level anti-correlation, Spearman −0.214.** A 55-case campaign's cost
  was dominated by *position in the delivery sequence* (wave-01 built the
  surface, waves 3–7 spent it); a blind per-case estimate cannot see that and
  ranked the two cheapest waves as the most expensive.
- **The formula discarded the readers' best judgements.** On both holdout
  batches the readers' prose correctly named the priciest case; the arithmetic
  then priced those cases *below baseline*, because both wait on a model and
  `async-realtime` carries 0.87. A 30-step case the reader called "a cheap
  parametrized loop" was estimated at 5.4× its actual cost.

### What changed as a result

1. **`base_minutes` 22/42/68 → 13/25/41**, and the layer is now stated
   explicitly: these are **pure case-build** minutes. The middle bucket is set
   from the measured 22.5 min/case-examined / 25.0 min/case-delivered figure
   (n=60). New `fully_loaded_multiplier: 1.79` carries build → pipeline cost,
   with the measured 56/28/16% layer split. **Result: per-case total ratio
   1.66× → 0.99×, median 2.30× → 1.37×, MAE $7.16 → $4.50.** The holdout batch
   lands at 0.95× fully-loaded.
2. **Size-rubric weights inverted.** `surfaces` → heaviest (3 pts, r=+0.522, the
   strongest estimate-time predictor found anywhere in this model);
   `new_abstractions` demoted to a refinement (2 pts, r=+0.169);  `steps` to a
   floor (2 pts, r=+0.051). v0.5.0 had weighted `new_abstractions` hardest on the
   strength of the source tracker's *hand-assigned sizes* — circular reasoning
   that validated the rubric against other size labels, never against money.
   Portability pointed the same way: "page object" doesn't exist on API/mobile
   scopes; "distinct endpoint or screen" does.
3. **New `risk_flags` vocabulary** — `nondeterministic-oracle`,
   `external-dependency`, plus `low-confidence-verdict` and `split-recommended`
   promoted automatically from the reader's own fields. Band-wideners, not
   multipliers (n=2, and inventing a coefficient from two anecdotes is the
   failure mode this file exists to prevent). Documented residual: even the
   widest band does not cover the worst such case, so the correct treatment is
   to report it **unquotable** rather than to quote it wide.
4. **Clustering promoted to a required stated scope assumption.** Measured on
   the holdout: 1.30× hot on solo cases, **2.84× hot on clustered** — a ~2.2×
   error swing, the largest single source of per-case error. Still not a
   multiplier (the selection-effect confound is unresolved), but no longer
   silent.
5. **§ Batch shape rewritten.** Four audits now show **dispatch mechanism
   matters at least as much as size**, and that bigger is not better: cheapest
   was a 13-case *sequential* batch ($7.03); a 39-case batch ($13.36) and a
   55-case Workflow campaign ($11.44) both cost more per case than batches of
   10–13. The prior text implied a monotonic batch-size benefit.
6. **Novelty guidance corrected.** The wave data implies ~2× for a first wave on
   a new surface, and raising `novelty_multiplier` toward 2.0 **was tested and
   made every batch worse** (2.07× / 3.02× / 4.58× over). Resolving novelty by
   first-touch-per-abstraction also failed — it flagged 39 of 55 campaign cases
   novel when the cost concentrated in wave-01's 8. The effect is
   per-surface-per-wave and belongs in the foundation line, not in per-case
   novelty. `novelty_multiplier` is **unchanged at 1.45**.
7. **Reporting discipline**: the report now leads with a cost-layer table, tells
   the reader to quote batch totals rather than per-case dollars, and carries a
   risk-flag section and a clustering assumption. `--match` was added because a
   bare directory scan had silently scored `README.md` files as cases.

### What held up

- **Step count is weak** — claimed r≈0.37–0.41, measured **+0.051** on the
  holdout. The claim was directionally right and generous.
- **Interaction tier is real and slightly conservative** — audits measure
  canvas/node-graph at +55% cost / +43% time against form cases at near-identical
  step counts (9.3 vs 8.7); shipped `rich-widget` is 1.42 (+42%). **Unchanged.**
- **Rework stays out of the mean.** Sub-agent count (its proxy) is the strongest
  correlate found (+0.373) and is only knowable after the fact. Unchanged.
- **The double denominator earned its keep.** Against branch-attributed the old
  model ran 1.45–3.16× hot; against fully-loaded, 0.89–1.83×. Quoting one number
  would have hidden a ~2× swing — which is exactly what happened, and is
  finding #1 above.

### Caveats on this validation

n=26 cases with individual actuals, 11 of them cluster-averaged. Per-case
actuals are branch-attributed *groupings* of exact metering, not per-case
metering — 29% of window spend sits on trunk and can never be case-matched. One
project, one stack. Readers were Claude sub-agents, not human estimators, so this
measures *this pipeline's* blind-estimate quality, not estimation in general. The
campaign's delivery order was known to the scoring step, which slightly flatters
it. Rank correlation is **not** improved by any change in this revision —
rescaling fixes magnitude, not ordering, and the ordering problem is structural.

---

## 2026-08-12 — v0.6.1 — two directional corrections from the same holdout

Follow-up to v0.6.0, from the same 26-case blind holdout, prompted by a fair
challenge: *why don't any of these flags move the price?*

The v0.6.0 answer was procedural — "no measured premium exists yet." Measuring
it produced a better answer, and two changes.

### The measurement

Median **actual ÷ estimate** by signal (below 1.0 = estimate already too high):

| Signal | Flagged | Unflagged |
|---|---|---|
| `split_recommended` | **0.46×** (n=8) | 0.79× |
| `heavy-teardown` | 0.45× (n=4) | 0.79× |
| `complex-preconditions` | 0.70× (n=11) | 0.83× |
| any modifier | 0.70× (n=17) | 0.83× |
| **`confidence: low`** | **1.59×** (n=4) | 0.73× |

**Three of the four "looks like more work" signals predict the case coming in
cheaper.** That is a stronger reason to leave modifiers unpriced than the
absence of evidence was: pricing them would have pushed every flagged case the
wrong way, permanently. Recorded here so a future calibration doesn't
"discover" the intuition and re-add them.

### Change 1 — `split_recommended` no longer forces XL

It used to stamp the case at the top of the scale. Measured, split-flagged
cases came in at 0.46× — forcing XL made an already-high estimate roughly twice
as wrong. *"Too big to estimate"* describes **messiness**, not magnitude: a case
bundling three unrelated checks splits into three small cases.

Now: the size derives from the drivers like any other case; the flag marks the
row **unquotable** and excludes it from the quotable total, with the case listed
for splitting. Same treatment an unspecified oracle gets — report it, don't
quote it.

### Change 2 — `confidence: low` gets an asymmetric band

New `confidence_bands.low_confidence_verdict` = **0.8×–3.0×** against the
symmetric cold 0.5×–2.0×. It is the only signal measured pointing *up*
(1.59× vs 0.73×). The point estimate is untouched; the band is the union of all
applicable bands, so on a cold estimate the low end still comes from
`cold_no_history` (with no history a case genuinely can come in cheaper) and
what low confidence adds is **upside reach**. On a calibrated project, where the
base band is narrow, the skew is much more visible.

### The shape this exposes, still unfixed

Median case runs **1.37× hot**; the total across 26 lands at **0.99×**. The
model **over-estimates the typical case and under-estimates the tail**. Neither
change here fixes that — they make the uncertainty honest about direction. The
tail problem is structural (the formula cannot consume what readers actually
observe) and is why unspecified-oracle cases are reported unquotable rather than
banded.

### Caveats

Subgroups as small as n=4; 11 of the 26 cases are cluster-averaged; one project.
**Directional corrections, not a calibration.** Neither change moves any point
estimate, so the blast radius if they are wrong is confined to band width and to
which rows are excluded from a quotable total.

---

## 2026-08-12 — v0.6.2 — reverting the "unquotable" idea from v0.6.1

**v0.6.1 was wrong and this entry undoes half of it.** It kept split-flagged
cases out of the "quotable total". The objection that killed it: **the work is
real, so excluding it produces a systematic under-quote** — and a presales
reader who needs a number will either drop those cases (under-selling the
engagement) or invent their own figure (worse than ours). **Zero is the only
value we know is wrong.**

### What replaces it

Nothing is withheld. Every case stays in the total. Instead, the two measured
directions get **asymmetric bands**, and the report says which way each line is
likely to move:

| Band | Multipliers | Applied by | Measured |
|---|---|---|---|
| `skewed_high` | 0.8×–3.0× | `low-confidence-verdict`, `nondeterministic-oracle`, `external-dependency` | median 1.59× actual/est (n=4) |
| `skewed_low` | 0.4×–1.2× | `split-recommended` | median 0.46× actual/est (n=8) |
| `cold_no_history` | 0.5×–2.0× | any flag with no measured direction | — |

The report now carries a **"where the total is most likely to move"** table:
how many cases and how many dollars sit on each direction, with the case ids.
That gives a presales reader the thing withholding a number never could — a
total they can quote *and* a stated direction of travel.

### One implementation note worth recording

Directional bands **replace** the base band rather than widening it. The
original union-with-min/max could only ever widen, which silently erased the
downward skew entirely (a split candidate's high end stayed pinned at the cold
band's 2.0×). If a band is going to express direction, it has to be able to pull
the far end *in*.

### Standing

v0.6.1's other change survives unaltered: `split_recommended` no longer forces
XL. That was the part supported by the measurement. The exclusion-from-total was
an inference layered on top of it, and it did not hold up.

n=8 and n=4 subgroups, one project, 11 of 26 cases cluster-averaged. Directional,
not a calibration. No point estimate moves under any of this — only band shape
and report framing.

---

## 2026-08-12 — v0.6.4 — second holdout: the rate was doing the damage

A second, cleaner validation than v0.6.0's. The 15 cases this skill had already
estimated (a smoke suite + an agents suite) were subsequently automated and
ccusage-metered by their own pipeline, giving a **direct estimate-vs-actual on
the identical case set**, not a proxy.

### Result

| | Estimate | Actual | Ratio |
|---|---|---|---|
| At the bundled $0.248/min default | $277.04 | $137.89 | **2.01×** |
| At the project's own **$0.097/min** | $108.76 | $137.89 | **0.79×** |

**The model was roughly right; the rate was wrong.** That project runs 2.5×
cheaper per active-minute than the seed the default was calibrated on. The
`default_dollar_per_minute` caveat has always said "CROSS-PROJECT FALLBACK ONLY
… always prefer a live rate" — this is the first measurement of what ignoring it
costs.

### What this changed

1. **New `project_rate` block**, naming the rate as the largest single error
   source in the model: four measured projects spanning **$0.097–$0.266/min, a
   2.7× spread**. Documents the mechanism (cache read is 97–98% of billed
   tokens, so cost tracks context size × turn count — the expensive project is
   the one whose `CLAUDE.md` injects eight `.agents/*` files into every session
   *and* every sub-agent dispatch), how to measure it, and what to do when you
   can't: **quote active-minutes, not dollars.**
2. **The report now prints a loud warning** whenever the bundled default is
   used, with the 2.01×→0.79× number attached.
3. **`candidate_project_factors`** — project complexity, framework layering,
   test approach and suite maturity recorded as *hypotheses with named tests*,
   explicitly NOT multipliers. One carries a warning: **app complexity is
   already priced per case by `interaction_tier`**, so a project-level version
   would double-count it.

### Two shipped claims this holdout contradicted

- **Orchestration tax.** The 14-case wave measured **21.7%**, above the 11–16%
  earlier revisions implied for batched work. Corrected to "11.1–27.9%
  observed; near-11% is the best case, not the expectation."
- **The single-case premium is not universal.** A genuine batch-of-one delivered
  at **$5.41 — cheaper than that same project's 14-case wave at $9.46/case** —
  against a shipped claim that single-case runs cost $19–22 (2.8×). The premium
  scales with how much context a fresh session must re-read, so on a lean repo
  batching buys little. "+87%" and "2.8×" are no longer stated as general laws.

### What held up

- **Foundation pricing, the best result in the exercise.** Their measured
  "foundation setup" bucket (page objects + shared auth/data helpers) was
  **$9.54**; the comparable catalog items estimated **$6.88** — **0.72×**, well
  inside the band. The activity-type split added in v0.6.3 works.
- **Batch shape.** A 14-case wave at $9.46/case landed squarely inside the
  predicted 10–13-case cluster ($7.03–$10.76).

### What did not — again

**Rank correlation −0.079** (fully-loaded) / **+0.154** (direct), consistent
with v0.6.0's 0.015. Rescaling and re-rating fix totals; ordering has never
improved and remains structural. **Clustering remains the largest per-case
error**: solo cases 2.76× over, clustered 4.85× — the three grouped PRs landed
at $1.78–$2.50/case.

### Caveats

15 cases, one project, one wave; 7 of the 15 are cluster-split figures rather
than individually metered. The rate was derived from summed agent-minutes across
direct and shared buckets, which is the report's own accounting, not an
independent measurement. Directional.
