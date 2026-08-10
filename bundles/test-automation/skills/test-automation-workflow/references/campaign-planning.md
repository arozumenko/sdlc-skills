# Campaign planning — composing batches for scale (Claude Code)

> **The objective function:** maximum automation speed at minimum cost,
> without giving up an inch of correctness — every case executed live before
> automation (for a cluster of flow-variants: ONE live session covers the
> group, each case's distinct steps/rows observed within it — execution is
> amortized, never skipped), covered the way the case demands, reviewed
> statically, proven N× green at the gate, inside the project's own framework
> conventions. Every mechanism below exists to remove *duplication and
> ceremony*, never proof.

A **batch** conflates three units that scale differently: the intake/mirror
unit (TMS sweeps), the gate unit (what's proven together), and the merge
unit. For a backlog bigger than ~2× your wave size — or any new coverage
area — decouple them:

- **Campaign** — the whole backlog you intend to cover. ONE intake sweep
  (case-gate probe + case snapshots for everything), one mirror policy, one
  plan.
- **Wave** — the gate/merge unit: a normal batch (`M` cases, own integration
  branch, own gate, own report). Several per campaign.
- **Stage** — what kind of work a wave does: bootstrap → foundation →
  facilitated build waves.

## The stages

**0. Bootstrap** *(greenfield only)* — existing path:
[`framework-architecture.md`](framework-architecture.md).

**1. Foundation pass** — build the shared grounding deliberately instead of
letting "case 1 of each surface" pay for it implicitly: page objects,
auth/fixtures, data helpers for the campaign's surfaces, on branch
`tests/foundation-<campaign>`. Two hard rules keep it honest:

- **Scope = the union of handles the analysts' AFS files demand.** Nothing
  speculative. This requires the **breadth-first analyst ordering** below.
- **Review to APPROVED, then mini-gate, then base merge.** The foundation
  ships with ONE smoke spec exercising the new page objects end-to-end (tag it
  as the surface's standing smoke — it stays, it's an asset, not scaffolding).
  The stage runs a static review and **the same fix loop a case build gets**
  (§ The loop, per unit in [`orchestration-playbook.md`](orchestration-playbook.md)):
  rounds continue while any blocker is `unaddressed`, and stop only when what
  is left is `persists` or `external`. Then the **mini-gate**: the smoke
  **N× consecutive green** (§ Merge gate N) plus the existing suite green once.
  Only then does the lead merge to base — that decision stays human, the loop
  and the gate only remove the manual round-trip.

  The foundation earns this *more* than a case does, not less. Every wave is
  built on top of it, so a half-reviewed foundation propagates into every case
  that follows, and an ungated one turns a single flaky helper into a red in
  every wave — where the wave gate will blame the case. Foundation code has no
  assertions of its own, so nothing downstream re-proves it in isolation: the
  mini-gate is the only place it is ever proven alone.

**2. Facilitated waves** — with foundations on base, cases become thin specs
against existing page objects: implementers rarely touch shared files, so
integration conflicts approach zero, each build inherits a clean tree, and a
cheaper implementer tier is justified
(`plan.policy` below; the gate is unchanged and catches what a cheaper
model misses).

## Clustering similar cases — one session, every case executed

**Clustering is the throughput lever, not a nicety** — and it applies to every
batch, campaign or not. Builds run **one at a time** in the shared tree
(accelerant § Who may run at once) — nothing in a batch overlaps — so the number of UNITS is the wall clock:
a cluster of 5 is one unit on that chain, not five.

A **cluster** is one analyst, ONE live session, a pack of genuinely similar
cases — same surface, same flow family (field-validation variants,
CRUD-on-one-entity permutations) — becoming one branch, one PR, one review.

Measured per-dispatch cost: implementer **$7.19**, analyst **$4.76**, fix round
**$4.38**, reviewer **$1.77**. So a 5-case cluster runs ≈ **$14** against ≈ **$69**
for the same five solo — and the saving is largest on the implementer, which is
also the slot on the critical path. (An earlier revision of this section called
the analyst "the single biggest per-case cost". The measurement says otherwise.) The
invariant that keeps the philosophy intact: **every case's steps still run
and get observed individually inside that session** — per-case evidence in
the AFS is mandatory, and "executed case 1 thoroughly, assumed the rest are
similar" is the banned failure mode. A case that diverges mid-exploration is
**ejected** from the cluster (returned with its own status) and goes solo.

**A cluster is a shared SESSION, not automatically a shared spec.** What
clustering buys is one login, one discovery pass, one navigation to the area —
that is where the money goes. Whether the OUTPUT merges is a second, separate
judgement, and the analyst makes it at the end of the session:

- **True variants of one flow** → a **family AFS → one parameterized spec**: a
  data table with one row per TMS case, each row carrying its own expected
  values and case-ID tag. One branch, one PR, one review. The reviewer's rule
  shifts to per-ROW triangulation: every case ID maps to a row whose distinct
  expected result is actually asserted (no flattening into a shared assertion),
  and the Coverage Map keeps one Axis-1 set per case.
- **Same surface, different flows** → **one AFS and one spec per case**,
  exactly as if each had arrived alone. They still ride one branch and one PR,
  because they were analysed together — but that is a dispatch economy, not a
  reason to merge test code. Shared page objects and fixtures are reused either
  way; that reuse is the point, and it needs no merging of specs.

Getting this backwards is the expensive direction: two cases forced into one
parameterized spec share assertions that were never meant to be shared, and a
case stops being tested without anything turning red. Merging is for cases that
differ only in DATA; anything that differs in STEPS stays separate.
("Stabilize all at once" is the wave gate you already have either way — a
family spec just makes that gate cheaper to run.)

Cluster rules: same `surface_key` only; the cap is **surface-cost-weighted**
— the binding constraint is that case N gets case 1's rigor in one session, so
UI-heavy exploration (30–80 browser ops/case) caps at **3–5**, cheap surfaces
(API and similar) may go to **~8**; when in doubt, don't cluster — the gate
can't tell you a case was under-observed at analysis time. **That cap is an
ANALYST limit**: a family spec of 8 rows is no harder to implement or review
than one of 5, so don't read it as a limit on the unit.

**Who proposes them.** In a campaign, the planner does it per wave
(`waves[].clusters`). In a flat batch, do it at Intake — dispatch one pass over
the `.agents/automation/<slug>/cases/<ID>.md` snapshots to group them and pass
the result as `args.clusters`. The lead never reads case bodies (Critical rule 7);
it is the same job as the planner's, minus waves and foundation. Unlisted
cases run solo. Two guards travel with clustering: the
**merged-target rule** (extend/covered may target only base-merged specs —
in-batch similarity IS the cluster, never an extend chain) and the
**extend-rate quality flag** (the build workflow flags a batch whose
extend+covered share crosses `extendRateThreshold`, default 0.5 — the lead
blind-audits a sample before trusting coverage). Concurrent analysts also
run one at a time, so the shared Playwright MCP browser is simply available
to whichever analyst holds the tree — no lanes, no isolated instances
(browser-tools.md).

## Breadth-first analyst ordering

Analysts still execute every case live — ordering is the only change. Feed
the front **one representative case per surface first** (the wave-1 heads),
depth later: the foundation's handle inventory exists after ~one case per
surface instead of after the whole backlog. The streaming build workflow
accepts cases in any order; the plan just lists heads first.

## Plan-as-data — proposed by a DISPATCHED planner, never by the lead reading cases

Clustering and wave composition require reading case bodies — so the lead
never does it. The conductor's **Plan stage** dispatches a planner agent that
reads the intake snapshots from disk (no TMS round-trips), groups by surface
and flow similarity, and returns the machine-readable plan plus a
one-paragraph rationale. The lead shows the operator the PLAN — waves,
clusters, foundation, rationale — at one AskUserQuestion checkpoint; the
approved plan lands verbatim on the **campaign card**
(`.agents/automation/campaigns/<slug>.md` — § The campaign card
below). The plan shape (the conductor's `args.plan`):

```json
{
  "campaign": "q3-agents",
  "batch": "q3-agents",
  "base": "origin/main",
  "goal": { "metric": "line + branch coverage ≥60%",
            "command": "COVERAGE=1 pytest … && node coverage/report.mjs",
            "baseline": "51.31% lines / 32.73% branches @ 2026-07-22" },
  "heads": ["TC-010", "TC-030"],
  "foundation": { "surfaces": ["agents", "pipelines"],
                  "evidence": "ls automation/pages/ → no agents_*.py, no pipelines_*.py; tests/ui/ has no agents/ or pipelines/ dir" },
  "waves": [
    { "slug": "q3-w1", "caseIds": ["TC-010", "TC-011"],
      "clusters": [["TC-014", "TC-015", "TC-018"]] },
    { "slug": "q3-w2", "caseIds": ["TC-020", "TC-021"] }
  ],
  "policy": {
    "reviewerModel": "sonnet",
    "extendImplementerModel": "sonnet",
    "mirror": "campaign-end",
    "landing": "per-batch"
  },
  "extendCandidates": ["TC-015"]
}
```

`extendCandidates` is the planner's independent pre-mark of cases whose
snapshots suggest existing merged coverage — never shown to the analysts.
Per wave the conductor reports `extend_divergence` (analyst-only vs
planner-only conclusions): divergence either way is a *signal to sample*,
not a verdict — two independent judgments beat one, nearly free.

**One snapshot directory per campaign** (`plan.batch` — the intake sweep
writes `.agents/automation/<batch>/cases/` once, and every wave's workers read
from it). Waves are plan subsets, each integrated onto its own
`tests/batch-<waveSlug>` branch, each gated by its own build child, each
returning its own report. `foundation: null` skips the stage. `policy` passes
through to the build children; `mirror` is `"per-wave"` or `"campaign-end"` —
the sweeps stay the lead's either way.

**`policy.landing` comes from the seed, not from the planner's judgement.**
Read `.agents/profile.md § Automation PR policy → Landing granularity` and put
it on the plan: `"per-batch"` (the default — each gated wave lands to base
before the next starts, so the next cuts its trunk from an updated base) or
`"campaign-end"` (gated wave branches accumulate and land together, right when
base is a protected release line). The conductor reports it back and shapes its
closing instruction around it; it never decides it.

### Foundation claims are evidenced, never asserted

`foundation.evidence` is **required whenever `foundation` is non-null, and
required in the rationale whenever it is `null`** — the planner states what it
actually listed (`ls` of the page-object dir and the test dirs, per surface),
not its impression. A planner that says "foundation-rich, `foundation: null`"
without a directory listing is guessing, and the lead's job at the checkpoint
is to reject that plan, not to go check by hand.

Why it's a schema field and not advice: two planners on the same campaign, same
week. One self-checked against `automation/pages/` and got it right. The other
returned `foundation: null` for four surfaces that had **zero** page objects and
**zero** test directories — caught only because the lead happened to run `ls`
before approving. An unevidenced `null` sends every implementer in the wave to
build the same missing foundation independently.

### One foundation owner per surface, per repo

Before proposing a foundation, the planner **reads the other campaign cards**
(`.agents/automation/campaigns/*.md`) and must not claim a
surface another live campaign is already building. Concurrent campaigns are
normal at scale; two of them building page objects for the same surface is two
incompatible foundations racing to merge.

Field case: waves 2 and 3 of one campaign independently planned foundation for
settings, analytics and the hubs. The lead caught it at the checkpoint and
hand-split the plan — resubmitting wave 3 with only the two surfaces wave 2
didn't touch, and **holding back 41 cases** until wave 2's foundation merged.
That recovery worked, but it was manual, and it only happened because a human
compared two plans. Declare the claim on the card and the next planner can see
it.

### Goal metric — declared once, re-measured every wave gate

A campaign with a numeric goal declares it in `plan.goal`: the metric, the
**command that measures it**, and the starting baseline. Then re-run that
command at **every wave gate** and log the number on the campaign card next to
the wave. Not at campaign end — at every gate.

This is the cheapest guardrail in the whole document and it was skipped: one
13-hour coverage campaign with an explicit ≥60% line / ≥60% branch target
merged 12 cases and **never re-measured coverage once** against its 51.31% /
32.73% baseline. Every decision after hour one — which waves to prioritise,
whether to keep going, what to tell the operator — was made without knowing
whether any of it was moving the number it existed to move.

## The campaign card — plan + checkpoints on disk (compaction anchor)

`.agents/automation/campaigns/<slug>.md` is the campaign's durable state —
**lead-written, and writing it is mandatory, not optional**. It is the one
hand-written artifact in the pipeline, and it earns that because **nothing
derives it**: the approved plan, the operator's decisions, the runIds and the
goal measurements exist nowhere else. Everything a machine can derive — what
landed, what a case's outcome was, why one stopped — is *not* on this card;
that is the wave reports, git, and the run journal (playbook § Where state
lives). Keep it that way, or you have rebuilt the board.

A campaign spans hours and several conductor invocations; context compaction
mid-run is a WHEN, not an IF — the card is what makes it a non-event. Create
it at the plan checkpoint; update it at every stage transition and every
conductor invocation **the moment the state changes**, never "later":

```markdown
# Campaign: <slug>

## State
- Stage: propose | plan-approved | foundation | mini-gate | waves | mirror | closed
- Conductor run: wf_<id>            ← latest Workflow runId; one Log line per invocation
- Foundation merged: no | yes @ <sha>
- Foundation surfaces CLAIMED: agents, pipelines   ← other planners must not claim these
- Heads analyzed: TC-010, TC-030
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

Two sections earn their keep only if you actually write them as you go.
**Foundation surfaces CLAIMED** is what a later planner reads to avoid building
a second foundation for the same surface. **Goal** is the line that stops a
campaign from running for hours without knowing whether it is working — if a
wave gate passes and no number goes in, the campaign is flying blind from that
point on.

**Recovery protocol.** After a compaction, a `/clear`, or a fresh session:
the card + the wave reports + `/workflows` reconstruct everything — current
stage, the approved plan, the exact `resumeFromRunId` and re-invocation args
(`plan`, `foundationMerged`, `headsAnalyzed`). Re-orient from disk *before*
the next dispatch; the conversation summary is a hint, disk is the truth. If
a wave died before writing its report, rebuild it from receipts + journal + git (playbook § Interruption)
(playbook § Interruption) — never by reading the transcript. Flat
(non-campaign) batches need no card: write the runId next to the batch's
snapshots and the report covers the rest.

## Execution — the conductor

[`../scripts/workflows/batch-campaign.workflow.mjs`](../scripts/workflows/batch-campaign.workflow.mjs)
runs the campaign as one deterministic workflow with THREE lead checkpoints,
all compact:

1. **Lead, before:** campaign intake — one TMS sweep, snapshots to
   `.agents/automation/<batch>/cases/`, dedup.
2. **Conductor (propose):** `{ propose: { campaign, batch, base, cases } }` →
   planner reads snapshots → **early-returns the plan proposal**.
3. **Lead:** operator checkpoint on the plan (not the cases) → re-invoke
   with `{ plan }`.
4. **Conductor:** analyzes the breadth-first **heads** (`analyzeOnly` build
   child — their AFS files become the foundation inventory), builds +
   statically reviews the **foundation** branch and smoke spec, then
   **early-returns** for the mini-gate.
5. **Conductor:** mini-gates the smoke (N× green + the existing suite once),
   then early-returns. **Lead:** merge foundation to base and re-invoke with
   `{ plan, foundationMerged: true, headsAnalyzed }`.
6. **Conductor:** loops the **waves**. A wave is ONE build child (heads
   passed as `preAnalyzed`, never re-analyzed) which integrates and gates
   itself and returns ONE report; the conductor collects it and rolls on. It
   never gates, never merges, never mirrors.
7. **Lead, at the end of each wave:** read that wave's report — merge the
   `automated` cases, route the findings, classify a red gate (playbook
   § Handling blockers; a flake or test-code bug goes to `batch-stabilize` on
   the wave's integration branch). Mirror per `plan.policy.mirror`. At
   campaign close: `cleanup.mjs --report <the last wave's report.json> --also
   tests/batch-<w1>,tests/batch-<w2>,…` (dry-run, review, `--apply`) sweeps
   delivered branches and wave integration branches **by merged-PR proof**,
   plus any worktree left over from hand-run work.

The mini-gate at step 5 stays the lead's because there is nothing to hand it
to: the foundation is one smoke spec with no case coverage, and it merges to
base — the one merge in the campaign that isn't behind a wave gate.

A failed wave (child throws) is recorded whole and the conductor continues
with the next — a campaign never dies to one wave. Its cases simply appear as
the remainder to replan.

At every conductor invocation, write the returned `runId` to the campaign
card **before doing anything else** — resume depends on it (accelerant
§ Resume), and a runId that lives only in conversation does not survive
compaction.

## Orchestrator context budget

The campaign design exists so the lead's context stays **stretched, not
stuffed** — long-lived enough to make good calls, never carrying payloads:

- **The lead reads:** plan proposals + rationale, one wave report per wave
  (outcomes, findings, gate verdict), the conductor's compact returns. All
  decision-shaped.
- **The lead never reads:** case bodies (planner + workers read snapshots
  from disk), AFS contents (slots read them), diffs (reviewers read them),
  merge/conflict output (the integrator agent eats it), test logs (the gate
  reads the runner's structured report), analysis payloads.
- **Turn math for a ~40-case campaign:** intake (~3 turns) + plan checkpoint
  (1) + mini-gate (~3) + per-wave gate (~2–3 × waves) + mirror (~2) ≈ **20–30
  small lead turns total** — against ~841 turns and 221M cache-read tokens
  observed for ~10 cases when orchestration, merging, and digests all ran
  through the lead conversationally.
- If a campaign spans days, start a fresh lead session per stage — the card
  plus the wave reports make sessions disposable, and a lean context beats a
  long-lived one.

## When NOT to run a campaign

Backlog ≤ ~2×M (one flat batch is simpler); unseeded project; surfaces
already foundation-rich with no new grounding to build (skip stage 1, plain
waves are fine); any host without the Workflow tool — the same staging works
lead-conducted with sequential dispatches, it's just more of your turns.
