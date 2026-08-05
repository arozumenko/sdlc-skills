---
name: opportunity-tree
description: >-
  Maintain the opportunity–solution tree over existing Discovery artifacts — use when
  mapping opportunities under an outcome, asking where a hypothesis hangs, spotting
  solution-shaped "problems", or when a new Problem or Hypothesis has no parent. Adds
  only node_type:/parent: frontmatter to existing files and regenerates the derived
  docs/discovery/outcome-tree.md board — no new file silo. Applies the Torres gate (an
  opportunity that cannot spawn 3+ different solutions is a solution in disguise) and
  annotates opportunities with Olsen scores for prioritize-bets. Trigger phrases — "map
  the opportunity tree", "where does this hypothesis hang", "is this an opportunity or a
  solution", "regenerate the outcome tree". NOT for authoring outcome anchors (that is
  define-outcomes), NOT for ranking bets (prioritize-bets), and NOT for reconciling
  journeys against the backlog (journeys-to-hypotheses).
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# opportunity-tree

The **opportunity–solution tree (OST)** skill. It maintains Teresa Torres's four-space tree
without inventing a new file silo: the whole tree is an **overlay** of two frontmatter keys —
`node_type:` and `parent:` — on artifacts that already exist. The visible tree,
`docs/discovery/outcome-tree.md`, is **derived**: regenerated from that overlay, never
hand-edited.

**No new silo (load-bearing).** There is no `opportunities/` folder full of new files. An
opportunity IS a Problem; a solution IS a Hypothesis. The reserved `docs/discovery/opportunities.md`
is the PM-bridge's landing slot, not a place this skill authors into.

## The four spaces → two keys

| OST space | Which artifact holds it | `node_type:` | `parent:` points at |
|---|---|---|---|
| Outcome | a ratified (`status: active`) row in `docs/discovery/outcomes.md` | (the tree root) | — |
| Opportunity | a Problem in `docs/discovery/problems/` | `opportunity` | the outcome anchor (`docs/discovery/outcomes.md#<id>`) |
| Solution | a Hypothesis in `docs/discovery/hypotheses/` | `solution` | its Problem (must equal its `parent_problem:`) |
| Assumption test | an experiment / evidence file in `docs/discovery/evidence/<kind>/` | `assumption-test` | the Hypothesis it tests |

`node_type: problem` on a Problem is accepted as a synonym for the opportunity space
(back-compatible with the base artifact convention); the skill may **offer** to normalize it to
`opportunity`, but never rewrites it silently.

## What this skill reads (config, by name)

From `.agents/profile.md` and the project's `docs/` — read for:

- **What "this product" is** — the product referent, so the tree is read against what the
  product is actually trying to move.
- **The prune cadence** — how often to *offer* a prune pass (stale opportunities with no live
  solution). Pruning is offered, never forced.

And these `docs/discovery/` locations: `outcomes.md` (the **ratified** — `status: active` —
rows are the only legal tree roots; a `draft` or `superseded` row is not), `problems/`, and
`hypotheses/` (the lifecycle — `status: incubating|promoted|parked` — is a frontmatter field
here, not a folder).

## Process

### 1. Read the current overlay
Grep `docs/discovery/problems/` and `docs/discovery/hypotheses/` for `node_type:` and `parent:`;
read the ratified (`status: active`) rows from `docs/discovery/outcomes.md`. Build the tree in
memory: outcome → opportunities → solutions → assumption-tests. Note anything whose `parent:`
does not resolve to a node in the tree — those are **orphans** (rendered in their own section,
never dropped).

### 2. Classify a node — the Torres gate
Before writing `node_type: opportunity` on a Problem, run the **3+-solutions test** from
[`references/tree-method.md`](references/tree-method.md): *"if an opportunity cannot generate 3+
different solutions, it may be a solution in disguise."* Ask it out loud — can you name three
genuinely different ways to address this need?

- **Passes** (three-plus distinct approaches exist) → it is a real opportunity; classify it.
- **Fails** (it names one specific implementation) → flag it **solution-masquerade**, name the
  underlying opportunity it might serve, and **leave the call to the PO**. Do not silently write
  `node_type: opportunity` onto a solution-shaped ask.

### 3. Solution coherence — parent must equal parent_problem
A Hypothesis is a `solution`; its `parent:` **must equal its `parent_problem:`**. Never write a
solution's `parent:` to point straight at an outcome anchor or at a different Problem than
`parent_problem:`.

If asked to move a solution somewhere that would break this, **surface the discrepancy and stop**
— explain that a solution hangs under its Problem, and that genuinely re-homing it means changing
`parent_problem:` too (or reconsidering whether it is really a solution). Do not overwrite
`parent:` into disagreement with `parent_problem:`.

### 4. Olsen score annotation (opportunities only)
For each opportunity, annotate the persistence fields `prioritize-bets` will consume, using the
Olsen formula in [`references/tree-method.md`](references/tree-method.md):

- `x_importance:` (0–10) and `x_satisfaction:` (0–10) — sourced from interview/evidence, not
  invented. Missing either ⇒ the score is **n/a** until evidence exists (say so; do not guess).
- `x_olsen_score:` = `importance × (1 − satisfaction/10)`, rounded to one decimal — high when a
  need matters a lot and is served badly. These are `x_`-prefixed extension fields; write them
  only on the Problem (opportunity) node.

### 5. Regenerate the derived tree — idempotently
Rewrite `docs/discovery/outcome-tree.md` in full from the overlay, following the exact format in
[`references/tree-method.md`](references/tree-method.md): the generated-do-not-hand-edit header;
one section per ratified outcome; opportunities sorted by `x_olsen_score` (desc, `n/a` last) then
slug; solutions sorted by id; the orphan section last. **The body carries no volatile
timestamp** — so regenerating over unchanged frontmatter produces a **byte-identical** file. Run
it twice and diff if in doubt; a diff means a non-deterministic element leaked in.

### 6. Checkpoint progress
After writing overlay frontmatter and/or the regenerated tree (irreversible steps), invoke the
`memory` skill's **Log** op noting which nodes were classified or re-parented and that
`docs/discovery/outcome-tree.md` was regenerated, so work resumes cleanly if the session breaks
here, before proposing the next step. The tree file is derived — regenerating it changes no
pipeline count — but the Log entry records that the overlay moved.

### 7. Report and hand back
Print what changed: which nodes were classified, any solution-masquerade flags left for the PO,
any coherence discrepancies surfaced, the Olsen annotations, and that the tree was regenerated.
Next step: high-Olsen opportunities with promotable solutions are ready for `prioritize-bets`; an
opportunity with no outcome to hang under needs `define-outcomes` first. **Never `git commit`
or `git push`.**

## Rules

- **Overlay only — no new silo.** The tree is `node_type:` / `parent:` on existing files plus the
  derived `docs/discovery/outcome-tree.md`. This skill authors no new artifact type.
- **Roots are ratified outcomes only.** A draft or superseded row is not a legal tree root.
- **The Torres gate is a flag, not a veto.** Solution-masquerades are surfaced for the PO to
  decide; the skill never silently classifies one as an opportunity.
- **`parent` == `parent_problem` on every solution.** Discrepancies are surfaced, never
  overwritten into agreement.
- **The derived tree is regenerated, never hand-edited**, and must be byte-identical on a re-run
  over unchanged frontmatter.
- **Olsen scores come from evidence.** No importance/satisfaction data ⇒ score is `n/a`, not a
  guess.

## Pairs well with

- **After** `define-outcomes` ratifies an anchor (the tree's roots) and after
  `intake-triage` mints Problems (the opportunity nodes needing a parent).
- **Before** `prioritize-bets` — the Olsen annotations feed the ranking.
- **`journeys-to-hypotheses`** mints solution stubs with `node_type: solution` + `parent:` at
  birth, so they land in the tree already wired.

---

> Provenance: house-authored for this product (© Peter Petroczy). The Olsen Opportunity Score (Importance × (1 − Satisfaction)) and the opportunity-solution-tree framing are adapted from phuryn/pm-skills@18468a95b427e70e258b51389796367c6f684e7d (MIT, © Pawel Huryn); the "3+ different solutions or it is a solution in disguise" Torres-gate test is adapted from shinpr/claude-code-discover@1cde7db8e638fe22a805191b50638151b66cd431 (MIT). The frontmatter-overlay persistence (no new file silo) is house-authored. See NOTICE.md.
