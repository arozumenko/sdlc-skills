---
id: L-NNN                       # scan docs/discovery/evidence/learnings/ for the highest existing L-NNN and use the next number — never hand-number (L- ids are unquoted)
type: learning                  # DO NOT change — keys the learning schema
track: knowledge                # knowledge | problem — selects the body structure below (this is the knowledge track)
title: One-line problem or question statement
created: YYYY-MM-DD
last_touched: YYYY-MM-DD          # any edit bumps this (core field)
last_confirmed: YYYY-MM-DD         # ONLY new evidence re-confirming the lesson bumps this; a periodic freshness sweep reads it
status: active                    # active | stale | superseded
confidence: 0.7                   # author's 0–1 estimate of transferability; a freshness sweep may lower it
tags: [keyword-1, keyword-2]      # ≥1 required — what makes the lesson findable: what overlap-scoring greps AND what readers' Step-0 by-tag pulls grep
discovered_from: docs/discovery/hypotheses/NNN-slug.md   # provenance edge — MUST resolve; null only if there is genuinely none
evidence:                         # supporting episodic records, by path (core typed edge) — each MUST resolve
  - docs/discovery/evidence/interviews/YYYY-MM-DD_slug.md
supersedes: null                  # L-NNN when this Replaces a contradicted lesson (invalidate-don't-delete)
superseded_by: null               # set on the OLD lesson when it is Replaced
relates_to: []                    # sibling lessons — the 4–6 overlap "Keep + cross-link" outcome sets this on BOTH files
---

# One-line problem or question statement

## Context

<!-- The situation in which this was learned. 2–4 sentences. Lead with the PROBLEM
     or question, not the answer — future search is by symptom, not by lesson. -->

## Guidance

<!-- The transferable rule, in imperative voice. This is the payload other skills'
     Step-0 by-tag pulls inject verbatim. One clear rule beats three hedged ones. -->

## Why

<!-- The mechanism that makes the guidance true. LOAD-BEARING: a lesson without a
     why is a superstition — an anecdote that will not transfer to the next
     discovery. With a why, it is a principle that does. -->

## When to apply / when NOT

<!-- Boundary conditions. Contradictory evidence is recorded HERE as a conditional
     ("Under A, X; under B, the opposite") — never discarded, never blind-overwritten.
     A lesson that holds only sometimes is more useful stated with its boundary than
     silently dropped. -->

## Examples

<!-- Pointers to the concrete artifacts, BY PATH. Never paste their contents — a
     pasted snapshot rots the moment the source moves or is superseded. -->

## Reconcile log

<!-- Every capture/reconcile writes one dated line here: the overlap score against the
     nearest candidate and the verdict (Keep / Update / Consolidate / Replace / Delete).
     This is the audit trail — see references/reconcile-protocol.md. -->
- YYYY-MM-DD — created (overlap scan: 0 candidates ≥4; verdict Keep)
