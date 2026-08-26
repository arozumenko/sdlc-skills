---
id: L-NNN                       # scan docs/discovery/evidence/learnings/ for the highest existing L-NNN and use the next number — never hand-number (L- ids are unquoted)
type: learning                  # DO NOT change — keys the learning schema
track: problem                  # knowledge | problem — selects the body structure below (this is the problem track)
title: One-line problem or symptom statement
created: YYYY-MM-DD
last_touched: YYYY-MM-DD          # any edit bumps this (core field)
last_confirmed: YYYY-MM-DD         # ONLY new evidence re-confirming the lesson bumps this; a periodic freshness sweep reads it
status: active                    # active | stale | superseded
confidence: 0.7                   # author's 0–1 estimate of transferability; a freshness sweep may lower it
tags: [keyword-1, keyword-2]      # ≥1 required — what makes the lesson findable: what overlap-scoring greps AND what readers' Step-0 by-tag pulls grep
discovered_from: docs/discovery/hypotheses/HYP-NNN-slug.md   # provenance edge — MUST resolve; null only if there is genuinely none
evidence:                         # supporting episodic records, by path (core typed edge) — each MUST resolve
  - docs/discovery/evidence/verifications/YYYY-MM-DD_slug.md
supersedes: null                  # L-NNN when this Replaces a contradicted lesson (invalidate-don't-delete)
superseded_by: null               # set on the OLD lesson when it is Replaced
relates_to: []                    # sibling lessons — the 4–6 overlap "Keep + cross-link" outcome sets this on BOTH files
---

# One-line problem or symptom statement

## Symptoms

<!-- What was observed — the failure as it presented. Lead with the SYMPTOM; future
     search is by symptom, not by the fix that was eventually found. -->

## What we tried that didn't work

<!-- Each attempt in one line: expected Y, got Z. The dead ends are worth recording —
     they stop the next person walking the same ones. -->

## What worked

<!-- The approach that actually resolved it. Be specific — numbers, rates, latencies,
     behaviours. -->

## Why it worked

<!-- The mechanism. LOAD-BEARING — without it this is a war story, not a reusable
     lesson. The why is what lets a different-looking future problem match this one. -->

## Prevention

<!-- How future work avoids the problem entirely. Link forward to any decision record
     (docs/discovery/decisions.md) that now encodes the fix, by path. -->

## Examples

<!-- Pointers to the concrete artifacts, BY PATH. Never paste their contents. -->

## Reconcile log

<!-- Every capture/reconcile writes one dated line here: the overlap score against the
     nearest candidate and the verdict (Keep / Update / Consolidate / Replace / Delete).
     This is the audit trail — see references/reconcile-protocol.md. -->
- YYYY-MM-DD — created (overlap scan: 0 candidates ≥4; verdict Keep)
