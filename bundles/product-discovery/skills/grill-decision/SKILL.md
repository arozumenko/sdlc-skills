---
name: grill-decision
description: >-
  Socratic, one-question-at-a-time interview that stress-tests an
  architectural or product decision, a plan, a new initiative, or a Discovery
  Hypothesis. Walks the decision tree branch by branch, taking a position on
  each question instead of asking open-ended ones, and reads (never asks for)
  what is already written down. Challenges every idea against the project's
  guardrails, its open pending decisions, and its established terminology, and
  captures outcomes INLINE the moment they crystallize — a sharpened term
  edited into the artifact that used it, a real decision into a DEC entry in
  decisions.md, a hypothesis edited in place. Use whenever you're trying to
  make a hard call, sharpen fuzzy language, interrogate a fresh Hypothesis
  before promotion, or pressure-test a plan — even if you don't say "grill".
  NOT for adversarial claim verification against external sources, NOT for
  feasibility sign-off, NOT for code / PR review or CI status.
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# grill-decision

<what-to-do>

Interview the user **one question at a time** until you reach a shared, sharp understanding.
For each question, propose your recommended answer with a short justification — don't ask
open-ended "what do you think?" questions when you can take a position the user can react to.

Walk down the decision tree branch by branch. Resolve dependencies between decisions one at a
time. Wait for feedback on each question before moving to the next.

Whenever a question can be answered by reading what already exists — `.agents/profile.md`, the
project's `docs/`, `docs/discovery/decisions.md`, the Hypotheses, prior evidence — **read
instead of asking.** The user has already invested in those documents; don't make them retell
what's written down.

Capture outcomes **inline** as they crystallize — never batch to the end of the session. A term
that just got sharpened is corrected now, in the artifact that used it; a decision that just got
made becomes a DEC entry in `docs/discovery/decisions.md` now; a Hypothesis that just got
sharpened gets edited now. Inline writes survive an interrupted session; a wall of edits at the
end does not. **Note progress via the `memory` skill's Log op after each inline capture, before
the next question.**

</what-to-do>

<supporting-info>

## What this skill reads (config, by name — never restated here)

Read these at the start of a session; they replace every hardcoded domain fact:

- **`.agents/profile.md`** — the project's guardrails and constraints (whatever form they take
  for this product — scope lines, non-negotiable rules, compliance requirements). These are the
  challenge lenses (below): every recommendation and every Hypothesis passes through all of
  them. A guardrail marked non-negotiable or a hard boundary is an emergency brake — a
  recommendation that trips it is not viable as written, surface it, don't paper over it.
- **`.agents/profile.md` and the project's `docs/`** — the product one-liner, phase framing, the
  surfaces this product owns, and any decision convention already in use for flagging work that
  depends on an unresolved call (generalize on the pattern `// PENDING_DECISION_DEC-NNN:
  assuming [option] because [reason]` if the project has none of its own).
- **`docs/discovery/decisions.md`** — the append-only DEC log (`id | date | decision |
  rationale | supersedes`). This file, not this skill, is the canonical home of decisions.

## Pending-decision awareness (do this first, every session)

Before grilling a topic, scan `docs/discovery/decisions.md` for entries with no `supersedes`
pointer pointing at them (i.e. still standing) that bear on the topic — it is a flat, append-only
table; read it directly, there is no separate index to derive it from. If the topic touches an
open call that was flagged but never actually decided (a `// PENDING_DECISION_DEC-NNN:` marker
still sitting in the project without a matching row), or a standing decision that the current
idea would contradict:

- **Surface it:** *"This depends on DEC-007 (recorded but not yet acted on — or: still marked
  pending in the code). Do we decide it conditionally on the current assumption, or resolve it
  first?"*
- **Don't pre-commit.** If an upstream decision is unresolved, either decide it first or scope
  the downstream conditionally, tagged with the project's pending-decision marker.
- A decision that blocks other work keeps that work from proceeding while it is open — respect
  the edge; don't quietly route around it.

## The challenge lenses — the guardrails, applied to everything

Whatever `.agents/profile.md` and the project's `docs/` establish as this product's guardrails
is the non-negotiable set of lenses for this session. Every architectural recommendation and
every Hypothesis passes through **all** of them. For each guardrail, ask the concrete question
it implies of the idea on the table, and ground the answer in something you read. A guardrail
that reads as a hard boundary (compliance, a contractual constraint, a stated non-negotiable) is
an emergency brake: if the idea trips it, the idea changes — you do not record a decision over
it.

## The Pocock patterns (apply continuously)

- **Challenge against established terminology.** When the user uses a term that conflicts with
  how the project already uses it elsewhere (a Problem, a Hypothesis, a Persona, `.agents/profile.md`,
  the project's `docs/`), call it out immediately and ask which meaning is intended.
- **Sharpen fuzzy language.** When a term is vague or overloaded, propose a precise canonical
  term and, once it resolves, **correct it now** in the artifact where it appeared — a Problem
  title, a Hypothesis field, an outcome name — rather than parking the correction for later. See
  *Sharpening a term* below for when the correction is itself decision-grade.
- **Discuss concrete scenarios.** Stress-test with specific edge-case scenarios — they force
  precision in a way abstract debate does not.
- **Cross-reference the record.** When the user states how something works, verify it against
  `docs/discovery/decisions.md`, prior evidence, or `.agents/profile.md`, and surface any
  contradiction explicitly rather than resolving it silently.

## The kill-assumption contract (the shape of every adversarial capture)

When grilling surfaces a load-bearing assumption, don't leave it as a vague worry — pin it in
five fields (this beats loose "challenge notes"):

| Field | What it captures |
|---|---|
| **Claim** | the assumption stated as a falsifiable proposition |
| **Fails if** | the concrete condition under which it is false |
| **Evidence to get this week** | the cheapest signal that moves belief |
| **Kill criterion** | what result would make you abandon the idea |
| **Cheapest test** | the smallest experiment that produces that signal |

Name the **Elephant** too: the unspoken concern nobody is validating. Grilling circles these;
your job is to name them out loud and, if they matter, turn them into a kill-assumption row or
an open question on the Hypothesis.

## Two artifacts this skill produces

| Artifact | Location | When to write |
|---|---|---|
| Sharpened term | wherever the term already lives (a Problem, Hypothesis, Persona, Journey, `.agents/profile.md`) | a term was resolved, sharpened, or a fuzzy/overloaded usage was caught — edited in place, not appended to a separate glossary. See *Sharpening a term* below. |
| Decision entry (DEC) | `docs/discovery/decisions.md` | a decision passed the 3-criteria gate **or** resolved a standing decision. See [`references/decision-record-format.md`](references/decision-record-format.md). |

A sharpened Hypothesis (problem, assumptions, or acceptance criteria edited in place) is a
byproduct of *Grilling a Hypothesis* below, not a separate artifact type of its own.

Lazy creation: never create files or directories speculatively. Mint a DEC id only when an
entry is actually written — scan `docs/discovery/decisions.md` for the highest existing
`DEC-NNN` and use the next number, zero-padded to three digits; never hand-number without this
scan, and re-check for a collision before writing.

**Scoping a large chunk of work is not a grill artifact here.** When a session scopes an
initiative, name its shape and hand off: a raw need becomes a Problem (via `intake-triage`); a
vetted, promoted Hypothesis becomes a spec + its tracker issue (via the promotion pipeline).
Grill sharpens and decides; it does not create a work-tracking file.

## Offering a decision entry (DEC)

Offer a DEC when **all three** of the PDR gate hold — or when it resolves a standing decision:

1. **Hard to reverse** — meaningful cost to change later (lock-in, data migration, contracts).
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — genuine alternatives existed and one was chosen for
   specific reasons.

A decision with no downside is not a real decision — correct it as a sharpened term or note it
as a learning instead. When you write a DEC, append one row to `docs/discovery/decisions.md`
using the shape in `references/decision-record-format.md`. If the DEC supersedes an earlier row,
fill that row's `id` into the new row's `supersedes` cell — don't delete or edit the earlier row,
the log is append-only.

## Sharpening a term

Most sharpened terms are **not** decisions — they are corrections to how the project already
says something, and the fix belongs wherever the term lives:

- If the term appears in a Problem, Hypothesis, Persona, or Journey file, **edit it there,
  now** — the canonical spelling lives with the artifact that uses it, there is no separate
  glossary file in this bundle.
- If the term is genuinely product-wide (it would confuse every future artifact if left
  unresolved), note the resolved spelling in the project's `docs/` where such conventions are
  already tracked, if the project has a place for that; otherwise let each artifact's own
  correction be the record.
- **Renames supersede.** When a term is renamed, note the old spelling was retired at the point
  of correction (a one-line aside in the edited artifact) so a reader hitting the old spelling
  elsewhere knows it moved.
- If sharpening a term actually settles a hard-to-reverse, surprising, real-trade-off choice, it
  is a **decision**, not just a term — write a DEC entry instead and let the correction reference
  it.

## Grilling a Hypothesis

When the target is a Hypothesis file (rather than a bare decision), the walk is the same
engine, pointed at the bet:

- Read the house Hypothesis contract (schema home: the Hypothesis template other discovery
  skills mint from), then read the bet itself in `docs/discovery/hypotheses/`.
- Walk each branch: the problem, each assumption (force the riskiest through the
  kill-assumption contract and a concrete scenario), the acceptance criteria (are they
  testable "what is true for the user after this ships" bullets, not implementation tasks?),
  and the typed edges (`parent_problem`, `outcome` — do they resolve; is the outcome still the
  `#tbd` sentinel?). Require **both** criteria: "We'll know we're right when…" AND "We'll know
  we're wrong when…".
- Sharpen terms against established usage as you go (correct them inline, in the Hypothesis, as
  you go).
- **Edit the Hypothesis in place** when a question forces a change; bump `last_touched`. If the
  round was a genuine adversarial pass, you may set `last_challenged: <today>` — but a dedicated
  pre-promotion challenge pass belongs to whatever verification skill the project runs before
  promotion; prefer that for the formal pass.

## Anti-patterns (don't do these)

- **Don't ask what's already written.** Read `.agents/profile.md`, the project's `docs/`,
  `docs/discovery/decisions.md`, prior evidence, and the Hypothesis first.
- **Don't batch.** Capture inline, note progress after each capture.
- **Don't write boilerplate decision entries.** If a decision fails the 3-criteria gate and
  doesn't resolve a standing one, skip it.
- **Don't propose to commit or push** anything — commit is a human-confirmed action.
- **Don't quietly resolve a conflict** with a prior record. Surface it and let the user reconcile.

</supporting-info>

---

> Provenance: adapted from mattpocock/skills/grill-with-docs@b843cb5ea74b1fe5e58a0fc23cddef9e66076fb8 (MIT, © 2026 Matt Pocock), pre-rename snapshot (sibling skills renamed to to-spec / to-tickets); kill-assumption contract + "Elephant" pre-mortem craft from phuryn/pm-skills (MIT, © Pawel Huryn). See NOTICE.md.
