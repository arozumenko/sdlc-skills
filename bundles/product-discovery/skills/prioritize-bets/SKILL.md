---
name: prioritize-bets
description: >-
  Rank the incubating and promotion-ready bets against the active
  prioritization framework — use when deciding what to build next, when
  validated hypotheses outnumber the team's appetite, when a ranking feels
  stale, or when someone asks which bet comes first. Applies RICE by default
  (WSJF and ICE are config options); the confidence factor is DERIVED from
  each hypothesis's evidence-banded confidence block, never free-guessed;
  persists scores into hypothesis frontmatter so the ranking survives the
  session; warns — never blocks — when a bet is ranked on gut-band evidence;
  and rewrites the derived priority board at docs/discovery/priority.md.
  Trigger phrases — "what should we build next", "rank the backlog",
  "prioritize the hypotheses", "which bet comes first", "the backlog is
  stale". NOT for promotion-gate scoring, NOT for triaging raw incoming asks
  (intake-triage), and NOT for attacking the assumptions inside one
  hypothesis.
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# prioritize-bets

The **ranking** skill. It answers "which of these validated bets comes first?" — the question
the promotion gate never asks. A promotion gate tells you a hypothesis *may* proceed; it never
tells you *in what order*. When more bets clear the gate than the team's appetite can build,
this skill turns the backlog into a defensible ordered list and writes the ranks where they
survive the session.

**The load-bearing rule: a score cannot exist without its evidence class.** RICE's (and ICE's)
*confidence* factor is not a number the PO types in — it is **derived** from the hypothesis's
own evidence-banded `confidence:` block. Prioritization therefore consumes the validation
pipeline instead of vibes: a bet nobody has validated cannot borrow a high confidence to jump
the queue. Every persisted score carries an `evidence_note` naming the dimensions and band it
came from, so the ranking is auditable.

## What this skill reads (config, by name)

From `.agents/profile.md`, if it carries a `prioritization:` note:

- **the active `framework:`** (RICE | WSJF | ICE) and its scales: the RICE `impact_scale`
  (`massive:3 high:2 medium:1 low:0.5 minimal:0.25`), `reach_unit`, `effort_unit`; the WSJF
  cost-of-delay components and job-size unit; the ICE scales. **The framework and its numbers
  live in the profile note, never hardcoded in this skill** — change the note and the math
  changes. If `.agents/profile.md` carries no `prioritization:` note (or the note doesn't
  exist), default to **RICE** with the default scales documented in
  [`references/frameworks.md`](references/frameworks.md), and say plainly that the default is
  in effect.
- **a `staleness_days` value**, if the note carries one: a persisted `scored_on` older than this
  is what a later status/review pass would flag as stale. This skill writes the stamp that such
  a check would read; it does not itself audit staleness.

From `.agents/profile.md` and the project's `docs/`, more broadly: the product one-liner and
stakeholder cast, so a `reach` estimate names a real customer count rather than an invented one.

And these `docs/discovery/` files, per candidate hypothesis:

- its **`confidence:` block** (`value` / `usability` / `feasibility` / `viability`, each 0–10) —
  the *only* input to the derived confidence factor (see the derivation below);
- its **`appetite:`** (`2-weeks` | `4-weeks` | `8-weeks`) — the effort / job-size input, in weeks;
- its **`outcome:`** anchor — a bet still pointing at an unset/`#tbd` outcome is unvalidated on
  the most important axis; rank it, but flag it (it belongs in `define-outcomes` first);
- its **`priority:`** block — the durable home of the score this skill writes.

## Step 0 — consult relevant lessons (by tag, background only)

Grep `docs/discovery/evidence/learnings/` by **topic tag** for any recorded lesson about scoring
this kind of bet — a reach estimate that proved wildly off, an "effort" that hid a dependency, a
framework that misled here before — and let it inform your reach/impact/effort estimates. This
is background evidence-gathering, not a hard requirement — skip it if no learnings exist yet.

## The confidence derivation (RICE and ICE)

Never hand-type confidence. Compute it from the hypothesis's `confidence:` block:

1. **Aggregate** — take the **mean** of the dimensions that are set (`value`, `usability`,
   `feasibility`, `viability`). A missing dimension is excluded. If none is set, the bet is
   **unscoreable** — say so, and route it to a verification/challenge pass on that hypothesis
   rather than inventing a confidence.
2. **Band** the mean on the evidence scale (shinpr's bands, adopted product-wide):

   | mean confidence | band | RICE factor | ICE confidence |
   |---|---|---|---|
   | 0 – <3 | **gut** (0–2) | 0.2 | round(mean), min 1 |
   | 3 – <5 | **structured** (3–4) | 0.5 | round(mean) |
   | 5 – <8 | **data-backed** (5–7) | 0.8 | round(mean) |
   | 8 – 10 | **tested** (8–10) | 1.0 | round(mean) |

3. **Record** the derivation in `evidence_note`, e.g. `confidence derived from value:6
   usability:5 feasibility:7 viability:6 → mean 6.0 (data-backed band) → 0.8`.

The full formulas for all three frameworks — RICE, WSJF, ICE — and worked examples are in
[`references/frameworks.md`](references/frameworks.md). WSJF is shipped deliberately: it is the
one framework here that surfaces *time-criticality* the others hide — say so plainly if the PO
is choosing a framework.

## Process

### 1. Assemble the candidate set
Default scope = every hypothesis in `docs/discovery/hypotheses/` whose `status:` frontmatter
field is `incubating`, plus any `promoted` bet not yet built, excluding `status: parked`. If the
PO names a narrower set ("rank these three"), use it. Read each candidate's frontmatter only —
do not open the full bodies unless a reach/impact estimate needs the detail.

### 2. Confirm the framework
Read `.agents/profile.md`'s `prioritization:` note, if present. RICE is the default when it is
absent. State which framework is active in one line; if the PO asks for a different one this
run, use it but **do not edit `.agents/profile.md`** (the framework is a config decision, made
by the person who owns the profile, not by this skill).

### 3. Score each candidate
For every candidate, gather the framework's inputs, deriving confidence per the table above:

- **RICE** — `reach` (a number per the `reach_unit`; ask the PO or estimate from evidence, and
  say which), `impact` (map the PO's judgement onto the `impact_scale`), `confidence` (**derived**),
  `effort` (appetite in weeks). `score = round((reach × impact × confidence) / effort)`.
- **WSJF** — cost-of-delay components (per the config scale), `job_size` (appetite in weeks).
  `score = cost_of_delay / job_size`.
- **ICE** — `impact` (1–10), `confidence` (**derived**, 1–10), `ease` (1–10). `score = impact ×
  confidence × ease`.

Show the arithmetic for each bet — a score with no visible working is not reviewable.

### 4. Rank and present the table (checkpoint — nothing written yet)
Sort by `score` descending (rank 1 = build first; ties broken by smaller appetite, then id).
Present a table: **rank | id | title | framework inputs | score | evidence band | note**. Then
**stop and ask the PO to confirm** before persisting. Completeness is not consent — no
`priority:` block and no board is written until the PO says so.

### 5. The gut-band warning (warn, never block)
Attach a ⚠️ to every row whose derived band is **gut (0–2)**: *"ranking on gut feel — this score
rests on unvalidated confidence; collect evidence (verify/challenge the hypothesis, or gather
supporting documentation) or proceed knowingly."* If **all** candidates are gut-band, lead with
the warning: the ordering is honest about being a guess. Never refuse to rank — the PO may
proceed knowingly.

### 6. Persist — only on the PO's explicit confirm
On an explicit go-ahead ("write them", "persist the ranking", "confirmed"):

- **On each scored hypothesis's frontmatter**, write the `priority:` block from
  [`assets/priority-block.md`](assets/priority-block.md) — `framework`, the inputs, the derived
  `confidence`, `score`, `scored_on: <today>`, `rank`, and the `evidence_note`. This replaces the
  born-empty `priority: {}`. Bump `last_touched`.
- **Regenerate `docs/discovery/priority.md`** wholesale from
  [`assets/priority-board.md`](assets/priority-board.md) — the derived rank board. It is
  generated, never hand-edited.
- **Note progress via the `memory` skill's Log op** — what was ranked, and that the write
  happened — before proposing the next step; the writes are on disk first (assume interruption).

### 7. Report and hand back
Print the ordered list, where the ranks were written, and the single next step: the top-ranked
gate-ready bet → move it toward drafting a spec/PRD; a fresh ordering that changes what "now" vs
"next" means → update whatever roadmap view the team keeps; any bet still on an unratified
outcome → `define-outcomes` before it can be trusted in the order. **Never `git commit` or `git
push`** — committing is a human-confirmed action.

## Rules

- **Confidence is derived, never typed.** A `priority:` block whose `confidence` did not come
  from the hypothesis's `confidence:` block is a bug. No evidence class ⇒ unscoreable, not a
  free guess.
- **`.agents/profile.md`'s `prioritization:` note owns the framework and the scales, when
  present.** This skill reads it; it never hardcodes a weight and never edits the profile.
  Absent a note, RICE with the documented defaults applies.
- **Persist only on an explicit confirm.** Present the table first; write `priority:` frontmatter
  and the board only when the PO says to.
- **Warn on gut, never block.** A gut-band bet is ranked *and* flagged; the PO decides whether to
  proceed.
- **Every persisted score carries its `evidence_note`.** The derivation travels with the number.
- **The board is derived.** `docs/discovery/priority.md` is regenerated wholesale; hand edits are
  lost on the next run.

## Pairs well with

- **After** a verification/challenge or feasibility-review pass on a hypothesis: those raise a
  bet's confidence band, which *changes* its derived score — re-rank after evidence moves.
- **`define-outcomes`** first for any bet still on an unratified outcome; **`opportunity-tree`**
  supplies opportunity scores that inform a bet's impact; **`intake-triage`** is where raw asks
  enter the pipeline, upstream of this skill; a later status/review pass can flag a `scored_on`
  that has gone stale, and a grooming pass can park the bets that keep ranking last.

---

> Provenance: house-authored for this product (© Peter Petroczy); released under this product's MIT license. The prioritization-framework craft (RICE/WSJF/ICE selection, the shipped WSJF cost-of-delay model, the four-tier scale discipline) is adapted from phuryn/pm-skills@18468a95b427e70e258b51389796367c6f684e7d (MIT, © Pawel Huryn); the evidence-banded confidence system that the derived confidence factor consumes is adapted from shinpr/claude-code-discover (MIT). See NOTICE.md.
