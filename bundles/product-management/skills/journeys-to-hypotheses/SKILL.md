---
name: journeys-to-hypotheses
description: Use when journeys and the backlog need reconciling — 'turn my journeys into hypotheses', 'map the journeys to the backlog', 'what do my journeys cover', 'convergence pass', 'where are the gaps in the backlog' — or proactively whenever new journey files exist that no hypothesis or epic references. Runs a convergence pass over every user journey (maps, list, BDD), every existing hypothesis, and (where one is configured) the project's issue tracker, classifying each journey COVERED / GAP / OUT-OF-SCOPE, regenerating the journey-coverage board, and on confirmation authoring the missing problem statements and hypothesis stubs with house frontmatter and collision-free IDs. NOT for authoring journeys themselves, NOT for promoting hypotheses, and NOT for breaking epics into stories.
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(gh *), Bash(glab *)
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# journeys-to-hypotheses

The PO thinks in journeys and BDD — those are native artifacts, and good ones. The pipeline speaks problems → hypotheses → specs → epics. This skill is the **translator between the two formats**, and the guard against the most expensive failure mode in a multi-person backlog: *re-deriving work that already exists on the board*.

**Audience calibration:** the product owner is a senior product professional. The journeys are their product judgment — don't second-guess the content. What this skill adds is the mechanical translation into pipeline artifacts and the cross-check against whatever tracker board they have no reason to have memorized.

## What this skill reads (config, by name)

From `.agents/profile.md` and the project's `docs/` — read for:

- **The issue tracker adapter** (optional) — if `.agents/profile.md` names one, use it for the
  cross-check in Step 1.3. If none is configured, skip the tracker entirely and say so; this is
  a degrade, not a failure.
- **The stakeholder/persona cast** — journeys should reference the canonical persona slugs that
  `define-personas` maintains under `docs/discovery/personas/`.

And these `docs/discovery/` locations: `journeys/` (source), `hypotheses/` (source + mint target),
`problems/` (mint target), and `journey-coverage.md` (the derived board this skill regenerates).

## Step 1 — Inventory (read everything before classifying anything)

1. **Journeys:** every journey map, the journey list, and the BDD scenarios (if present) in
   `docs/discovery/journeys/`. Note per journey: persona, surface, and whether it has step-level
   detail or is only a map node.
2. **Hypotheses:** every file in `docs/discovery/hypotheses/` — id, title, scope, persona. The
   lifecycle (`status: incubating|promoted|parked`) is a frontmatter field here, not a folder —
   read all of them regardless of status.
3. **The tracker (optional — degrade gracefully):** if `.agents/profile.md` names an issue
   tracker, read its epic issues via the matching adapter:
   - GitHub → `gh issue list -R <repo> --limit 100 --state all --json number,title,body`.
   - GitLab → the equivalent `glab issue list` call.
   - No tracker configured, or the adapter call fails → **skip the tracker cross-check**, mark
     every board column **n/a**, and mark every verdict **provisional** (there is no committed
     skeleton to cross-check against). Say so plainly in the report; do not fail the run.
   Also read any committed epic specs the project's `docs/` points at, if any.
4. **Personas:** `docs/discovery/personas/` — journeys should reference canonical persona slugs
   (`define-personas` maintains them).

## Step 2 — Classify each journey (or coherent step-cluster)

| Verdict | Meaning | What happens |
|---|---|---|
| **COVERED** | An existing epic issue or hypothesis already owns this scope | Record the mapping. If the journey adds user-level detail the epic lacks, note it as *input to* that epic, not a new bet. |
| **GAP** | Real product value, no artifact owns it | Candidate for a new problem + hypothesis (Step 4). |
| **OUT-OF-SCOPE** | Different surface, different persona, or beyond the current phase | Park it *visibly* in the coverage board with where it belongs. Never delete a journey — scope changes. |

Judge coverage by **scope ownership, not keyword overlap** — a journey about pre-work setup is
*input* to the setup epic, not a duplicate of it and not a gap.

## Step 3 — Regenerate the coverage board

Write `docs/discovery/journey-coverage.md` from
[`assets/coverage-board-template.md`](assets/coverage-board-template.md) — a plain markdown
board, no query-plugin or vault tool required to read it. Regenerate the whole file each run (it
is derived, not hand-maintained). This board is also the honest "what has NO journey yet" list —
the inverse gaps (epics/value with no journey) belong in it just as much.

## Step 4 — Author the missing artifacts (confirmation required)

Present the GAP list and let the PO pick which to pursue — not every gap deserves a bet. For each
confirmed gap:

1. **Problem first.** If no parent problem exists, write
   `docs/discovery/problems/PRB-NNN-<slug>.md` from
   [`assets/problem-template.md`](assets/problem-template.md) — a problem statement in the house
   shape (what triggers it, who feels it, evidence links to the journey/BDD/interview). No orphan
   solutions: the promotion gate expects `parent_problem:` on every hypothesis, so wiring it now
   is free; retrofitting it later is not.
2. **Hypothesis stub** in `docs/discovery/hypotheses/<id>-<slug>.md` from
   [`assets/hypothesis-template.md`](assets/hypothesis-template.md), with the full house
   frontmatter contract. At birth set: `status: incubating`, `parent_problem:` → the Step-4.1
   problem, `outcome: "docs/discovery/outcomes.md#tbd"` (the sentinel — `define-outcomes` ratifies
   a real anchor later), `evidence:` populated with the journey files and BDD anchors that
   motivated it, `discovered_from:` → the journey, and the opportunity-tree overlay keys
   `node_type: solution` + `parent:` → the parent problem path (so the opportunity–solution tree
   is wired at birth — see `opportunity-tree`). Leave `confidence:` (the four Cagan dimensions),
   `appetite:` and `priority: {}` **present but empty** — a stub has not been grilled yet, so it has
   no evidence class to declare; `grill-decision` earns the first two and `prioritize-bets` fills the
   third. Do not guess them here. The body must carry **both** criteria — "We'll know we're right
   when…" AND "We'll know we're wrong when…" — plus `## Assumptions` (empty until grilled) and
   `## Acceptance criteria`.
3. **ID discipline.** Mint each id by scanning the target folder for the highest existing
   `PRB-NNN` (in `docs/discovery/problems/`) or `HYP-NNN` (in `docs/discovery/hypotheses/`) and
   using the next number, zero-padded. Before minting, **re-check for a collision** — grep the
   target folder for the number you are about to use; if it already exists (a concurrent session
   minted it first), **stop and report it** before writing anything new. Do not allocate by hand
   without this scan-and-recheck.
4. One hypothesis per **outcome-sized bet** — not one per journey step (too fine — that is story
   territory, after promotion) and not one per surface (too coarse to test).

Right after each minted file — a write worth not losing to a mid-batch interruption — invoke the
`memory` skill's **Log** op noting which Problem/Hypothesis was just filed, so work resumes
cleanly if the session breaks here.

## Rules

- **The tracker is load-bearing when it exists.** Running this skill against a configured tracker
  without reading its epics produces exactly the duplication it exists to prevent. When no
  tracker is configured, say so and mark every verdict provisional — that is a legitimate mode,
  not an error state.
- **Journeys are evidence, not requirements.** The hypothesis stub cites the journey; it doesn't
  transcribe it.
- **Out-of-scope ≠ worthless.** Other-surface and future-phase journeys are real future scope —
  parked visibly with a named owner surface, they cost nothing and preserve the thinking.
- **Never create files without confirmation.** The classification report is always produced;
  problems and hypotheses only on the PO's go.
- **IDs never collide.** Scan-then-recheck before every mint; a detected collision stops the run
  before anything is written.

## Pairs well with

- **Run after** journeys or BDD change, or after `stakeholder-interview` synthesis adds evidence.
- **Before** brainstorming a confirmed GAP with a fuzzy solution space, and before sharpening the
  new stubs with a grill-style review.
- **`opportunity-tree`** picks up the `node_type: solution` + `parent:` this skill wires at birth.
- **`define-outcomes`** ratifies the real anchor a new hypothesis's `outcome:` sentinel is waiting
  on.

---

> Provenance: house-authored for this product (© Peter Petroczy). See NOTICE.md.
