# Reconcile protocol — capture-learning

The authoritative procedure for the write discipline of the learning store
(`docs/discovery/evidence/learnings/`). The learning store is a **reconciled** store:
it is written ONLY through this protocol, **never blind-append**. Every capture runs it;
SKILL.md carries the operational summary and defers the full rules here.

This runs at a natural pause or on explicit invocation — never interleaved with an
in-flight pipeline step.

---

## Step A — build the candidate set

Before writing anything, find the lessons this one might already overlap:

1. `grep` the frontmatter of every file in `docs/discovery/evidence/learnings/` for
   **≥1 shared `tags:` value** OR a **title keyword match** against the new finding.
2. Exclude lessons with `status: superseded` or `status: stale` from *scoring*
   (they can still be a Replace/Update target if the new evidence directly revives
   or overturns them — note that explicitly).

If the candidate set is empty, the verdict is **Keep** (new file) — but still write
the Reconcile-log line recording "0 candidates".

---

## Step B — score each candidate (single-pass, 0–10)

Score every candidate on five dimensions, **0 / 1 / 2** each. One pass, done inline —
this is compound engineering's overlap-scoring idea collapsed from parallel analyzers
to one pass (the parallel version does not earn its place for a solo PO).

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| **Trigger context** (situation the lesson applies to) | disjoint | partial overlap | identical |
| **Subject** (artifact / vendor / source / persona / topic) | different | adjacent | same |
| **Claim direction** | orthogonal | related | same claim — **or a direct contradiction** (flag it) |
| **Lesson type** (knowledge vs problem track) | different | — | same |
| **Evidence base** (cited sources) | disjoint | some shared | overlapping / same |

Take the **highest-scoring candidate** as the reconcile target. Its total drives the
route:

- **≤ 3** → new territory → **Keep** (new file).
- **4–6** → genuinely distinct sibling → **Keep + cross-link** (new file; set
  `relates_to:` on BOTH files).
- **≥ 7** → same-lesson territory → one of **Update / Consolidate / Replace / Delete**
  (Step C decides which, using the Claim-direction reading).

A direct contradiction on the Claim-direction dimension is recorded even when the
total is < 7 — a contradicting sibling is cross-linked with a one-line note so the
two are never read in isolation.

---

## Step C — the five outcomes

| Outcome | When | Mechanical effect |
|---|---|---|
| **Keep** | ≤ 3 (new), or 4–6 (distinct sibling) | Write a new lesson from the right `assets/` template. For a 4–6 sibling, set `relates_to:` on the new AND the sibling file. |
| **Update** | ≥ 7, and the new evidence **refines or strengthens** the existing lesson (same claim direction, or a *conditional* contradiction — see below) | Edit the existing file **in place**: add the new source to `evidence:`, sharpen `## Guidance` / `## What worked`, bump `last_confirmed:` and `last_touched:`. Do **not** mint a new file — that is the blind-append this protocol exists to prevent. |
| **Consolidate** | ≥ 7, AND **≥ 2** existing entries are now all covered by the same lesson | Merge into the **strongest** file (union of `evidence:`, `tags:`, `relates_to:`). Delete the subsumed files **in the same commit** — git history is the tombstone. Record which ids were absorbed in the survivor's Reconcile log. |
| **Replace** | ≥ 7, and the new evidence proves the existing lesson **flatly wrong** (a reversal, not a conditional) | Write a **new** file with `supersedes: L-NNN`; set the old file's `status: superseded` + `superseded_by: L-MMM`. Invalidate-don't-delete — the old lesson stays greppable as history. |
| **Delete** (gated) | The existing lesson is **wrong AND actively harmful if followed** | Requires **explicit human confirmation in-session**. Without that confirmation, fall back to `status: stale` (excluded from Step-0 by-tag pulls, still greppable). Never delete a lesson autonomously. |

### Contradiction: conditional vs reversal (the never-discard rule)

A ≥ 7 overlap whose Claim-direction is a **contradiction** splits two ways — read the
evidence before routing:

- **Conditional contradiction** — both findings are true under *different* conditions
  (e.g. one persona/context vs another). Route to **Update**: record the boundary in
  the existing lesson's `## When to apply / when NOT` as a conditional —
  *"Under A, X; under B, the opposite."* **Neither finding is discarded, and the
  original is not blind-overwritten.** This is the default reading of a contradiction —
  most "contradictions" are unstated boundary conditions.
- **Reversal** — the new evidence shows the old lesson is simply wrong now (the
  world changed, or the original was mismeasured). Route to **Replace** (supersede).

If you cannot tell which, prefer the **conditional** (Update) reading and say so in the
Reconcile log — superseding a lesson that was actually context-dependent throws away a
true finding.

---

## Step D — link validation (refuse on a miss)

A codified lesson **cannot cite a dead artifact**. Before finalizing, resolve every
non-null path in `discovered_from:`, `evidence:`, `supersedes:`, `relates_to:` and the
`## Examples` pointers. If any does not resolve:

- **Refuse to finalize the lesson.** Report the unresolved reference and ask for a
  resolvable path, or offer to capture with that citation removed / repointed at a real
  artifact. Do not write a lesson with a broken edge — "a check you can't perform is a
  FAIL, not pass-by-default."
- A lesson with **no resolvable source at all** (empty `discovered_from:` and
  `evidence:`) is likewise refused — an unsourced lesson is an opinion, not a learning.

There is no automated commit-time gate for this in this bundle; this manual resolution
is the mechanism, so do it every run.

---

## Step E — write the Reconcile log

Every touched lesson (created, updated, consolidated-into, superseded) gets one dated
line appended to its `## Reconcile log`, recording the overlap score against the target
and the verdict. This is the audit trail — the decision must be reconstructable later.

Line grammar (examples, domain-neutral):

```
- 2026-07-19 — created (overlap scan: 0 candidates ≥4; verdict Keep)
- 2026-07-19 — updated (overlap 8/10 vs L-005; verdict Update: added evidence, bumped last_confirmed)
- 2026-07-19 — sibling cross-link (overlap 5/10 vs L-011; verdict Keep + cross-link)
- 2026-07-19 — conditional recorded (overlap 8/10 vs L-009; contradiction is context-dependent; verdict Update, not Replace)
- 2026-07-19 — consolidated L-007 + L-012 into this file (overlap 9/10; verdict Consolidate)
- 2026-07-19 — superseded by L-031 (overlap 8/10; reversal; verdict Replace)
```

---

## Step F — tag for findability

The lesson tags itself with `tags:` (≥1, required) drawn from the topic/subject
vocabulary its future readers actually search on — an outcome area, a persona slug, a
vendor/data-source name, a request type. There is no closed enum and no per-skill
routing table to satisfy in this bundle: `define-outcomes`, `stakeholder-interview`,
`prioritize-bets`, and `intake-triage` each run their own "Step 0 — consult relevant
lessons (by tag)" that greps this store by topic tag before proceeding. A lesson tagged
with vocabulary no reader would think to search is unreachable in practice even though
nothing enforces it mechanically — so prefer the same tag vocabulary those skills'
own artifacts already use over inventing new terms.

---

## Step G — self-verification (run last)

A lesson nobody can find is not a lesson. The final step verifies its own findability —
if any check fails, the run is **incomplete** and must be finished before proposing the
next action:

1. **Every link from Step D resolves.** Re-check, don't just trust the earlier pass.
2. **The lesson carries ≥1 tag overlapping the vocabulary a reader would grep** (Step F).
   An untagged or oddly-tagged lesson will never surface in a Step-0 by-tag pull.
3. **The Reconcile-log line from Step E is present** on every file touched this run.

---

## Step H — 3+ Rule graduation (offer, never automatic)

A recurring lesson may deserve promotion into standing doctrine. Follow shinpr's 3+
Rule:

- **1 occurrence** = observation (just the lesson).
- **2 occurrences** = trend (note it in the lesson's body).
- **3+ independent confirmations** = candidate for promotion.

At 3+, **offer** the human the graduation — a durable doctrine page if the project
keeps one, or, if it is a durable rule the product will follow, a decision record via
**grill-decision**. Never graduate autonomously; the human decides what becomes
doctrine.

---

## Step I — periodic freshness sweep (fallback demotion)

A separate, periodic sweep — **not** part of a normal capture — marks any active lesson
whose `last_confirmed:` is older than 12 months as `status: stale` (excluded from
Step-0 by-tag pulls, still greppable). No skill in this bundle currently owns running
that sweep on a schedule; until one does, treat a lesson older than 12 months as a
signal to re-confirm it the next time it surfaces in a candidate set, rather than
trusting it blind.

---

*Provenance: five-outcome vocabulary + single-pass overlap-scoring concept from
EveryInc/compound-engineering-plugin (concept attribution, no code copied); 3+ Rule,
contradiction-as-conditional, and freshness demotion from shinpr/claude-code-discover
(MIT). See NOTICE.md.*
