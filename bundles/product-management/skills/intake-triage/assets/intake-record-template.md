---
type: intake
title: "Intake triage — <source or theme>, <YYYY-MM-DD>"
date: <YYYY-MM-DD>
status: filed
x_source: "<who the batch came from — a ROLE, never a personal name>"
x_items: <total count>
x_verdicts: {act_now: <n>, plan_next: <n>, collect_more_signal: <n>, decline_or_defer: <n>}
supersedes:
---

# Intake triage — <source or theme>, <YYYY-MM-DD>

One batch record per triage run. Episodic and immutable once filed — a correction is a NEW
record carrying `supersedes:` back to this one, never an in-place edit. People are named by
role; any name-bearing raw material lives only in `_inbox/`.

## Verdicts

| # | Ask (as a customer need, not a feature) | Requester (role) | Signal / frequency | Verdict | Rationale | Disposition |
|---|---|---|---|---|---|---|
| 1 | … | … | … | Act Now | … | `docs/discovery/problems/PRB-NNN-<slug>.md` |
| 2 | … | … | … | Collect More Signal | … | queued below |
| 3 | … | … | … | Decline-or-Defer | out of scope: "<the out_of_scope line, quoted verbatim>" | — |

## Minted Problems

- `docs/discovery/problems/PRB-NNN-<slug>.md` — `discovered_from:` this record.

## Collect More Signal queue

Swept by the next `stakeholder-interview` prep run. Nothing here is a commitment; each item is
an open question to gather evidence on.

- [ ] <ask> — what evidence would move it out of this tier (a named requester, a frequency count,
  a "why")?

## Declined

- <ask> — <reason: scope line quoted / duplicate of docs/discovery/problems/PRB-NNN-<slug>.md / low value>.
