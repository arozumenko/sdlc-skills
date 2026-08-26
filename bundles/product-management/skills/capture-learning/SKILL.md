---
name: capture-learning
description: Use when a hypothesis closes, an experiment concludes with a metric movement or a killed assumption, a vendor / data source / external service behaves differently than its docs implied, or a non-obvious product decision needs its rationale preserved — even if the user never says the word 'learning'. Captures a problem → outcome → lesson from product experiments and hypothesis outcomes (won or lost) into docs/discovery/evidence/learnings/ so the next similar discovery moves faster. Trigger phrases — 'capture learning', 'save what worked', 'document this lesson', 'what did we learn from X', 'we should remember that'. NOT for meeting minutes or transcripts, NOT for a durable forward-looking rule (record a decision via grill-decision), NOT for a retrospective, and NOT for a bare todo or a one-off observation.
license: MIT
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(git rm:*)
metadata:
  authors:
    - Peter Petroczy (PO-RnD, MIT)
    - Artem Rozumenko <artyom.rozumenko@gmail.com>
  version: "0.1.0"
---

# Capture Learning

The point is **compounding**: every non-trivial product discovery should make the next
similar one easier. A searchable store of problem -> outcome -> lesson triples in
`docs/discovery/evidence/learnings/` is the simplest way to make that real — but only if
it is *reconciled*, not accreted. The learning store is written ONLY through the
reconcile protocol below, **never blind-append**.

This skill captures *positive* knowledge — what was learned, including from losses. A
product anti-pattern lives here too, framed as a learning ("we tried X assuming Y,
learned Y was false, so future similar work should test Y first"). A durable *rule the
product will follow* belongs in a decision record instead (see "Learning vs decision
record").

This runs at a **natural pause or on explicit invocation** — never interleaved with an
in-flight pipeline step.

## When to capture

| Capture? | Example (domain-neutral) |
|---|---|
| Yes | A hypothesis shipped and its outcome metric moved — record what moved it. |
| Yes | A hypothesis was tested (interviews, a prototype, a trial) and killed — record *why* the assumption broke. |
| Yes | A vendor / data source / external service behaved differently than its docs implied. |
| Yes | A product decision was made non-obviously, for a real reason that would not reconstruct from the decision record alone. |
| Skip | "We renamed a field" — not a learning. |
| Skip | Anything already covered in a decision record or the hypothesis itself. |
| Skip | "We'd do it differently next time" with no specific reason — a retro complaint, not a learning. |

## Procedure

The full rules live in [`references/reconcile-protocol.md`](references/reconcile-protocol.md);
this is the operational summary. Do every step — the reconcile and the self-verification
are what separate a compounding store from a junk drawer.

### 1. Pick the track and mint the ID

- **Knowledge track** (the default) — a transferable rule learned from a discovery.
  Template: [`assets/learning-knowledge.md`](assets/learning-knowledge.md).
- **Problem track** — a concrete problem that was hit and resolved.
  Template: [`assets/learning-problem.md`](assets/learning-problem.md).

Mint the ID by scanning `docs/discovery/evidence/learnings/` for the highest existing
`L-NNN` and using the next number (never hand-number) — the same scan-then-recheck
convention used for `PRB-`, `HYP-`, and `DEC-` ids elsewhere in `docs/discovery/`. Do
this even if the reconcile below turns out to be an Update/Consolidate that mints no new
file — the scan is cheap and the id is discarded if unused. A new lesson file is written
to `docs/discovery/evidence/learnings/L-NNN-<slug>.md`.

### 2. Reconcile — the five outcomes (NEVER blind append)

Decide what to write by **single-pass overlap scoring** against the existing store:

1. **Candidate set** — grep `docs/discovery/evidence/learnings/` frontmatter for ≥1
   shared `tags:` value OR a title-keyword match.
2. **Score** each candidate 0/1/2 on five dimensions — **trigger context** (what
   situation the lesson applies to), **subject**, **claim direction**, **lesson type**,
   **evidence base** — for a total of 0–10. Take the highest-scoring candidate as the
   target.
3. **Route** by that total:

| Total | Territory | Outcome |
|---|---|---|
| **≤ 3** | new | **Keep** — write a new file |
| **4–6** | distinct sibling | **Keep + cross-link** — new file; set `relates_to:` on BOTH files |
| **≥ 7** | same lesson | **Update** / **Consolidate** / **Replace** / gated **Delete** (below) |

Within **≥ 7**:

- **Update** — new evidence refines/strengthens: edit the existing file **in place**
  (add to `evidence:`, sharpen the payload, bump `last_confirmed:`). No new file.
- **Consolidate** — ≥ 2 existing entries now all covered: merge into the strongest
  (union of `evidence:` and `tags:`), delete the subsumed files with `git rm` **in the
  same commit** (git history is the tombstone).
- **Replace** — new evidence proves the old lesson flatly wrong (a **reversal**): new
  file `supersedes:` the old; old gets `status: superseded` + `superseded_by:`.
  Invalidate-don't-delete.
- **Delete** (gated) — the lesson is wrong AND harmful to follow: requires **explicit
  human confirmation**; without it, fall back to `status: stale`.

**Contradiction is conditional by default.** A ≥ 7 overlap whose claim direction
contradicts an existing lesson is usually an unstated boundary condition, not a
reversal. Record it as a **conditional** in the existing lesson's
`## When to apply / when NOT` — *"Under A, X; under B, the opposite"* (an **Update**,
not a Replace). **Contradictory evidence is never discarded.** Only route to Replace
when the new evidence proves the old lesson simply wrong.

Write the verdict per the chosen template, referencing all sources **by path** (never
paste their contents — a snapshot rots the moment the source moves).

### 3. Validate links — refuse on a dead edge

Resolve every non-null path in `discovered_from:`, `evidence:`, `supersedes:`,
`relates_to:`, and the `## Examples` pointers. If any does not resolve, **refuse to
finalize** the lesson: report the unresolved reference and ask for a resolvable path (or
offer to capture with it removed / repointed). A codified lesson cannot cite a dead
artifact, and a lesson with no resolvable source at all is refused (an unsourced lesson
is an opinion). There is no automated gate for this in this bundle — do the manual
resolution every run; it is the only enforcement.

### 4. Write the Reconcile log

Append one dated line to the touched lesson's `## Reconcile log` recording the overlap
score against the target and the verdict — the audit trail. E.g.
`- 2026-07-19 — updated (overlap 8/10 vs L-005; verdict Update: added evidence, bumped last_confirmed)`.

### 5. Tag for findability

Set `tags:` (≥1, required) to the topic/subject vocabulary a reader would actually
search on — the outcome area, the persona, the vendor/data source, the request type.
There is no closed enum and no reader-routing table to satisfy: `define-outcomes`,
`stakeholder-interview`, `prioritize-bets`, and `intake-triage` each run their own
"Step 0 — consult relevant lessons (by tag)" that greps this store by topic tag before
proceeding, so tag choice — not a routing field — is what makes a lesson reachable.
Prefer the same tag vocabulary those skills' own artifacts already use (persona slugs,
outcome names, vendor names) over inventing new ones.

### 6. Self-verification (run last)

A lesson nobody can find is not a lesson. Verify before proposing the next action:

1. **Every link in step 3 resolves** — re-check, don't just trust the earlier pass.
2. **The lesson carries ≥1 tag that overlaps the vocabulary a reader would grep** — an
   untagged or oddly-tagged lesson is unreachable by the Step-0 pattern above.
3. **The Reconcile log line from step 4 is present** on every file touched this run
   (created, updated, consolidated-into, superseded).

### 7. Offer graduation (3+ Rule — never automatic)

Count independent confirmations of the lesson: 1 = observation, 2 = trend (note it in
the body), **3+ = candidate for promotion**. At 3+, *offer* the human a durable doctrine
page if the project keeps one, or, if it is a durable rule, a decision record via
**grill-decision**. Never graduate autonomously.

### 8. Note progress

Note progress via the `memory` skill's Log op before proposing the next action — this is
the interruption-resilience checkpoint: if the session is interrupted mid-capture, the
next run can pick up from what was already reconciled instead of re-deriving it.

## Rules

- **Lead with the problem or question, not the answer.** Future search is by symptom.
- **"Why" is the load-bearing section.** A finding without a mechanism is an anecdote;
  with a mechanism, it transfers to the next discovery.
- **No essays.** Each section in 1–5 sentences; link to a longer doc for depth.
- **Capture losses, not just wins.** A killed hypothesis with a recorded reason is worth
  more than ten that quietly died.
- **Never blind-append.** Every write goes through the reconcile in step 2.

## Anti-patterns

- Don't capture trivial findings — a noisy store is one people stop searching.
- Don't write a retrospective. "What we'd do differently" is a different artifact.
- Don't capture personal-attribution material ("X was wrong because…"). Keep the entry
  depersonalized and portable.
- Don't reference chat-only context. Quote the substance inline; ephemeral channels are
  not citations.
- Don't discard a contradiction. Record it as a conditional (step 2) — a lesson that
  holds only sometimes is more useful stated with its boundary than silently dropped.

## Learning vs decision record

- A **learning** is *backward-looking*: what we discovered from past work. It lives here.
- A **decision record** (DEC) is *forward-looking*: a durable rule the product/architecture
  will follow. It lives in `docs/discovery/decisions.md`. If the lesson crystallizes into
  a rule (hard-to-reverse + surprising + a real trade-off rejected), offer a DEC via
  **grill-decision** instead of (or in addition to) the learning — this is the step-7
  graduation for the doctrine case.

## Pairs well with

- **After** a hypothesis's `status:` moves to `parked` in `docs/discovery/hypotheses/`
  for any reason except staleness — capture *why* it lost before the context fades.
- **After** a spec lands with a measurable outcome — capture what moved the metric (or
  didn't).
- **Before** `define-outcomes`, `stakeholder-interview`, `prioritize-bets`, or
  `intake-triage` on a similar future problem — each of those runs its own "Step 0 —
  consult relevant lessons (by tag)" against `docs/discovery/evidence/learnings/`, so a
  well-tagged capture pays forward automatically. Any future skill that reads this store
  should adopt the same by-tag Step 0.

---

> Provenance: originated in PetroczyP/shokk-toolbox (private repo, © Peter Petroczy); no public upstream for the capture core; released under this product's MIT license. Five-outcome reconcile + single-pass overlap-scoring concept from EveryInc/compound-engineering-plugin (concept attribution, no code copied); the 3+ Rule for graduation, contradiction-as-conditional, and freshness demotion from shinpr/claude-code-discover (MIT). See NOTICE.md.
