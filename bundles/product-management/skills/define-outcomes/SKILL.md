---
name: define-outcomes
description: Draft, stress-test, and record ratification of outcome anchors in docs/discovery/outcomes.md — measurable customer-behavior metrics with a dated baseline, a target, and a quarterly timeframe — use whenever a hypothesis names no ratified outcome (and so cannot be promoted), a quarterly bet is being set, or someone asks what number a bet is actually trying to move. The skill drafts candidates and runs each through a definition-quality checklist; only the product owner's explicit in-chat act ratifies one, and never without a dated baseline. Trigger phrases — "define the outcomes", "our hypotheses have no ratified outcome", "what metric is this bet moving", "set the quarterly targets", "ratify the anchor". NOT for business / traction metrics as anchors (revenue, signups, ARR — those may appear only as lagging confirmation), NOT for team OKRs or engineering SLOs, and NOT a metrics-dashboard builder.
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# define-outcomes

The **outcome** skill. It turns "what are we actually trying to move?" into a ratified,
measurable anchor that the promotion gate can point at. A hypothesis is born naming no
outcome; while a promotion-candidate hypothesis still names none, the pipeline is telling
you to run this skill — **a hypothesis naming no ratified outcome cannot be promoted.**

**What an outcome anchor is (narrow, on purpose):** a measurable change in **customer
behavior** — never a business or traction number. Traction (revenue, signups, ARR) is a
*consequence* of customers being better off; it is recorded as `lagging_confirmation` on a
real behavior anchor, never as the anchor itself.

**The status column IS the gate.** In `docs/discovery/outcomes.md`:

- a row with `status: active` (and a `ratified` stamp in its detail block) = promotable-against.
- a row with `status: draft` = drafted only; the gate never accepts it.
- a row with `status: superseded` = historical; kept, never deleted, never promotable-against.

This skill assists — it drafts, challenges, and prepares an anchor — but **only the product
owner's explicit in-chat act moves a row from `draft` to `active`.** No agent ratifies on the
PO's behalf, ever.

## What this skill reads

From `.agents/profile.md` and the project's `docs/` — read for:

- **The product owner's name** — copied **verbatim** into the `ratified:: <date> by <name>`
  stamp. The name lives here and **only** here — never hardcoded in this skill.
- **The product one-liner and stakeholder cast** — so a candidate metric names a real
  customer whose behavior it measures rather than an invented actor.
- **The bet cadence** — the timeframe grain for the quarterly bet (`timeframe::` uses this
  cadence), and the staleness cadence for revisiting anchors.
- **Guardrail constraints** — if measuring a candidate requires **identity-joined personal
  data**, attach the matching guardrail warning to the anchor so a downstream feasibility
  review sees the exposure (a hard-stop guardrail means the measurement plan itself is a
  blocker).

And these `docs/discovery/` locations: `outcomes.md` (the target — its ratification-gate
design is authoritative; do not soften the rules stated in its header), `problems/` (the pain
a candidate serves), and `evidence/learnings/` (Step 0, below).

## Step 0 — consult relevant lessons (by tag)

When drafting a candidate, grep `docs/discovery/evidence/learnings/` by **topic tag** for any
recorded lesson about this outcome area — a past metric that gamed badly, a baseline that was
hard to measure, a counter-metric that mattered — and let it inform the `why::` and the
`counter_metric::`. This is background evidence-gathering, not a hard requirement — skip it if
no learnings exist yet.

## Process

### 1. Identify the target
Resolve what needs an anchor: a named hypothesis that names no outcome, a Problem with no
outcome, or a draft row the PO wants to ratify. Read `docs/discovery/outcomes.md` in full —
its table (every existing row and status) and its `## North star` section — and the relevant
`docs/discovery/problems/` file. If the north star is empty, offer to set it first (it is a PO
act too — see step 9).

### 2. Draft or refine the candidate
Add (or sharpen) a `status: draft` row to the table in
[`assets/anchor-block.md`](assets/anchor-block.md)'s shape, and its matching detail block
underneath, populating every field known so far. The `outcome` cell must be one unambiguous
sentence naming **who** and **what behavior**, e.g. *"% of new users who complete their first
core action within 7 days"* — not *"activation"* and not *"grow usage"*. A draft row may carry
`baseline: unmeasured` until it is measured.

### 3. Product-outcome rule (gate 1 — non-negotiable)
Test the metric: is it a measurable change in **customer behavior**? If it is a business or
traction metric — revenue, ARR, MRR, bookings, GMV, signups, seats, headcount, cost — **refuse
it as the anchor.** Offer instead to record it as the `lagging_confirmation::` on a genuine
customer-behavior anchor (the behavior that, if it moves, should later show up as that
traction number). Do not ratify a traction metric into an active row no matter who asks.

### 4. Run the definition-quality checklist
Put every candidate through the 7-criteria checklist, the NOT-list, and the Three Business
Games heuristic in [`references/definition-quality.md`](references/definition-quality.md).
Report which criteria pass and which are weak in one line each — this is the definition-quality
test the anchor must clear before it is worth ratifying. Then attach a **`counter_metric::`**:
the number that would move the *wrong* way if the team games the anchor (a metric that will not
change how anyone behaves is a bad metric). Every anchor names exactly one.

### 5. Personal-data / guardrail check
If measuring the anchor requires **identity-joined personal data**, name the matching
guardrail and attach it to the anchor's detail block as a note (and flag it plainly to the PO).
When that guardrail is a hard stop, say so: the measurement plan is itself a feasibility
blocker, not a footnote.

### 6. Baseline gate (gate 3 — no dated baseline, no ratification)
An anchor cannot be ratified without a **dated baseline** — a measured starting value and the
date it was measured (`baseline: 22% (2026-07-01)`). If the baseline is unknown or undated:

- **Leave the row `status: draft`** — never promote it to `active`.
- **Flag the measurement gap plainly** in the row's detail block (`baseline: unmeasured —
  needs measurement`) and tell the PO the anchor is waiting on it; offer to dispatch a
  research/evidence-gathering pass (e.g. via `discovery-researcher`) to get it measured. Then
  stop — the anchor waits for its baseline.

### 7. Ratify — only on the PO's explicit act (gate 2)
Present the fully-drafted anchor and **ask the product owner to confirm ratification in their
own words** ("ratify it", "yes, I ratify this anchor"). This must be an unambiguous in-turn act
by the PO — never inferred from "looks good", never relayed on someone's behalf, never assumed
because the fields are complete. On no explicit act, the row **stays `status: draft`** and
nothing is stamped.

On an explicit ratification act (and only if gates 1 and 3 are clear):

- Set the row's `status` to `active`, filling **all** table and detail-block fields.
- Set `parent_north_star:: [[#north-star]]` (or the named north-star anchor) in the detail
  block.
- Stamp `ratified:: <today> by <product owner name>` (copied verbatim from `.agents/profile.md`)
  in the detail block.
- **Checkpoint the write:** this write is irreversible — invoke the `memory` skill's **Log**
  op noting which anchor was just ratified, so work resumes cleanly if the session breaks here,
  before proposing the next step.

### 8. Supersede — never overwrite a ratified anchor
A ratified anchor's metric or target is **never edited in place.** To change either (also a PO
act):

- Add a **new** row (a fresh id, e.g. `-v2`) with the changed field, its own `ratified::
  <today> by <product owner name>`, `status: active`, and `supersedes:: <old-id>` in its detail
  block.
- On the **old** row, set `status: superseded` and add `superseded:: <today> by <new-id>` in
  its detail block — and **leave everything else on it intact.** The old row stays in the file
  as history; hypotheses that cite it keep resolving.

Never delete the superseded row; git history plus the in-file chain is the audit trail.

### 9. North star
The `## North star` section holds the one customer-value metric every anchor's
`parent_north_star::` nests under. Setting or changing it is a PO act (same
explicit-confirmation rule as ratification); run each north-star candidate through the same
7-criteria checklist. Every ratified anchor must point at it.

### 10. Report and hand back
Print what changed (the anchor id, its status, the stamp) and the next step: ratified and the
hypothesis's other gates are green → the hypothesis is ready to move toward promotion; held as
draft → the missing baseline and who should chase it; refused traction metric → the anchor it
should hang under as lagging confirmation. **Never `git commit` or `git push`** — committing is
a human-confirmed action.

## Rules

- **The PO owns ratification.** Never write a `ratified::` stamp or set a row to `status:
  active` without the PO's explicit in-turn act. No inferred, relayed, or on-behalf-of
  ratification.
- **Anchors are customer behavior, never traction.** Business/traction metrics are
  `lagging_confirmation::`, full stop.
- **No dated baseline, no ratification.** Missing baseline ⇒ `status: draft` plus a flagged
  measurement gap.
- **Supersede, never overwrite.** A target change is a new row plus a superseded old one, both
  kept.
- **Every anchor names a counter-metric.** A gaming guard is not optional.
- **A hypothesis naming no ratified outcome cannot be promoted.** This is the promotion gate
  this skill exists to unblock.
- **The register's header rules win.** If this skill and `docs/discovery/outcomes.md`'s stated
  rules ever disagree, the register wins and this skill has a bug.

## Pairs well with

- **Before promotion:** the gate reads a ratified (`status: active`) anchor; a hypothesis
  naming no ratified outcome blocks promotion.
- **After** `define-personas` / stakeholder interviews: the evidence that a behavior change
  matters feeds the anchor's `why::`.
- **`opportunity-tree`** hangs opportunities under a ratified outcome; `discovery-status`
  flags hypotheses still naming no outcome.
- A later increment review measures a shipped increment against the anchor's target.

---

> Provenance: house-authored for this product (© Peter Petroczy); the ratification-gated outcomes-register design is carried from the originating discovery vault. The 7-criteria definition-quality checklist, the NOT-list, the Three Business Games selection heuristic, and the counter-metric gaming guard are adapted from phuryn/pm-skills@18468a95b427e70e258b51389796367c6f684e7d (MIT, © Pawel Huryn). See NOTICE.md.
