---
name: discovery-status
description: Use when starting a work session, when the PO is unsure what to do next, or when promotion, gates, blockers, what's-stuck, where-am-I, or am-I-ready-for-review come up — even without the word 'status'. Reports the whole discovery pipeline as one navigable dashboard — where every hypothesis stands against the promotion gate, what is blocked and on whom, the tracker board versus what docs/discovery/ says, and the exact next action (naming the exact skill) for each item; read-only, reading the docs/discovery/ tree and the product-owner's role memory directly and re-deriving gate state from the promotion checklist in prose (no vault, no validator script). NOT for code or CI status, PR-review state, deployment health, or git status — those are different tools.
license: MIT
allowed-tools: Read, Grep, Glob, Bash(gh issue list *), Bash(gh issue view *), Bash(glab issue list *), Bash(glab issue view *)
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# discovery-status

The pipeline has a skill for every stage, a promotion gate, and an optional tracker. This
skill is the **map**. It answers, in one screen: *what state is everything in, what is
blocked on whom, and what is the single next action?*

**Audience calibration:** the reader is a senior product professional who is new to this
agentic toolchain. Report the state of the *pipeline* — files, fields, checklist, board —
never lecture on product method. They know how to do discovery; they need to know what the
pipeline expects next and which skill does it.

## Retrieval — read the tree, re-derive the checklist, never fabricate

There is no committed dashboard file and no validator script in this bundle. This skill is
fast because it reads a small, well-known set of locations directly and re-derives gate
state by applying the promotion checklist (below) as prose — not by calling a script or
trusting a cached summary. Read in this order:

1. **`docs/discovery/hypotheses/`** — every hypothesis file, regardless of `status:`
   (`incubating | promoted | parked` is a frontmatter field, not a folder — read all of
   them). This is the primary worklist for the scorecard below.
2. **`docs/discovery/outcomes.md`** — the ratified-outcome register. Zero `status: active`
   rows is the single most important fact in the whole report if true (see Workspace-level,
   below).
3. **`docs/discovery/problems/`, `docs/discovery/personas/`, `docs/discovery/journeys/`** —
   for the unconverged-inventory pass (orphans with no child hypothesis).
4. **`docs/discovery/decisions.md`** — the append-only `DEC-NNN` log, to confirm a
   prioritization ranking or a feasibility call was actually recorded, not just claimed.
5. **`docs/discovery/evidence/{verifications,research,interviews,learnings}/`** — to confirm
   a hypothesis's "verified" claim has a real evidence file behind it, not just an assertion.
6. **The product owner's role memory** (`.agents/memory/product-owner/` — read via the
   `memory` skill if this project uses a different runtime layout for role memory) — for
   anything logged about an in-flight dispatch (e.g. "tech-lead dispatched on HYP-004,
   awaiting feasibility read") that has not yet landed as a file under `docs/discovery/`.
   This is a **supplement**, not a source of truth — a claim that only lives in memory and
   never lands in `decisions.md` or an evidence file is still open, say so.
7. **The tracker board (adapter), only if configured.** Read `.agents/profile.md` for a
   tracker note: none configured -> the Board-sync section is `n/a (no tracker configured)`;
   `github`/`gitlab` -> query the board via `gh`/`glab`. If the CLI fails (no auth), say so
   and continue with the docs/discovery/-only state — a partial dashboard beats none.

**No re-derivation shortcuts.** Because there is no machine gate scorecard to trust,
*this* skill is where the gate math actually happens, in prose, every run — see the
promotion checklist below. Do not skip a checklist item because a prior report said it
passed; the files are the source of truth, always re-read them.

## Checks

### Per hypothesis — the promotion checklist (re-derived, in prose)

For every hypothesis surfaced (default: all `status: incubating` and `status: promoted`
hypotheses; skip `status: parked` unless the user asks for the full set), walk the same
four-item checklist the product-owner narrates before a handoff to `ba`, and mark each
✅ / ❌ / ⚠️ from what is actually on disk — never assume a prior pass still holds:

1. **Outcome ratified** — the hypothesis's `outcome:` field resolves to a row in
   `docs/discovery/outcomes.md` with `status: active` and a `ratified:: <date> by <name>`
   stamp carrying a dated baseline and a target. Still pointing at the `#tbd` sentinel, or at
   a `draft`/`superseded` row, is a ❌: nothing can promote on it. This is the headline gate —
   lead with it if it's failing.
2. **Hypothesis verified** — a real evidence file exists in
   `docs/discovery/evidence/verifications/` (or `research/`, `interviews/`) that names this
   hypothesis's id and supports (or explicitly weighs and rejects) its central assumption.
   No file, or only an unlinked assertion in the body text, is a ❌. Disconfirming evidence
   that was weighed and led to a revision is a legitimate ✅ — the point is that it was
   weighed, not that it was favorable.
3. **Prioritized** — the hypothesis carries a `priority:` block (score, framework, and an
   `evidence_note` naming the confidence derivation) AND a matching `DEC-NNN` row in
   `docs/discovery/decisions.md` recording the ranking call. A score with no `DEC-NNN` row
   (or vice versa) is a ⚠️ — the two must agree.
4. **Feasibility acknowledged** — a record that the "is this buildable?" question was asked
   and answered on this hypothesis: look for a `DEC-NNN` row, an evidence file, or a note in
   `docs/discovery/decisions.md` naming the hypothesis id and either `tech-lead` or, where
   that agent isn't installed, the person who gave the read. Nothing on disk (even if role
   memory logged a dispatch) is a ❌ — a claim that never lands in a committed record is
   still open.

Also check, from the hypothesis body itself: **testability** — both "We'll know we're right
when…" and "We'll know we're wrong when…" are filled in, not placeholder text, plus at least
one acceptance-criterion bullet. Missing either falsifiability direction is a ❌ regardless
of the four-item checklist — an untestable bet cannot be verified in the first place.

Only when all four checklist items hold (plus testability) is a hypothesis actually
promotable; `status: promoted` on a hypothesis that fails one of them on re-read is a live
inconsistency — flag it explicitly, don't silently trust the frontmatter.

### Workspace-level

- **No ratified outcomes?** If `docs/discovery/outcomes.md` has zero `status: active` rows,
  every hypothesis is unpromotable no matter how good it is. This is the headline — say it
  first, and name whose move it is: **the PO ratifies outcomes** via **define-outcomes** (no
  agent ratifies on the PO's behalf).
- **Orphans (unconverged inventory, not errors):** journeys no hypothesis references;
  problems with no child hypothesis — point at **journeys-to-hypotheses**.
- **Untested Hypothesis assumptions:** a hypothesis whose riskiest assumption has never been
  through an adversarial pass — point at **grill-decision**.

### ID collisions

While reading `docs/discovery/{problems,hypotheses}/` and `decisions.md`, note if two files
claim the same `PRB-NNN` / `HYP-NNN` / `DEC-NNN`. This is a live risk (the next skill to mint
an id will collide) — always report it, and say which skill's next write should pick the
higher-numbered id.

### Board-level (only when a tracker is configured)

Every promoted hypothesis with an open engineering handoff should have a matching, open
Epic. A promoted hypothesis with no matching issue, or an issue with no promoted origin, is a
broken bridge. Do not invent board state — if the adapter output is unavailable, mark the
section "not checked".

## Output format

Use this shape, most-blocking first. Every *Next action* names a skill (e.g. "run
`define-outcomes`") or a concrete edit — never "consider" or "think about".

```markdown
# Pipeline status — <date>

**Headline:** <the single most important fact, e.g. "0 ratified outcomes — nothing can
promote until the PO ratifies one via define-outcomes.">

## Blocked on you (the PO)
| Item | Failing checklist item(s) | Next action |

## Blocked on others
| Item | Waiting for | Who | Next action |

## Ready to advance
| Item | Passed | Next action |

## Unconverged inventory (journeys / problems without hypotheses)
| Artifact | Suggestion |

## Hygiene (cheap fixes)
| File | Issue | Fix |

## Board sync
<one short paragraph: docs/discovery/ vs tracker state, overlaps, drift — or
"n/a (no tracker configured)">
```

## Rules

- **Read-only.** Never edit a hypothesis, problem, outcome row, or decision entry from this
  skill.
- **Re-derive, don't trust.** There is no cached dashboard and no validator verdict to defer
  to — every run re-reads `docs/discovery/` and re-applies the checklist above.
- **Exact next actions.** "Run `define-outcomes` on HYP-004" is a next action; "the outcome
  needs ratifying" is not. Always name the exact skill.
- **Don't bury the blocker.** If one fact dominates (no ratified outcomes, no feasibility
  record), lead with it.
- **Never guess board state.** If the tracker adapter is unavailable, say "not checked" — do
  not infer.
- **One screen.** Link to files, do not quote them.
- **Role memory is a supplement, not a source of truth.** A dispatch or a claim that only
  exists in `.agents/memory/product-owner/` and never lands as a file under `docs/discovery/`
  is still open — report it as in-flight, not as done.

## Pairs well with

- **Run first** in any session — it tells you which skill to reach for next.
- **After** **journeys-to-hypotheses**, **prioritize-bets**, or **grill-decision** — to
  confirm the state actually advanced.

---

> Provenance: house-authored for this product (Peter Petroczy). The pointer-first read order
> and expiring-time-budget framing are adapted from shinpr/claude-code-discover (MIT). See
> NOTICE.md.
