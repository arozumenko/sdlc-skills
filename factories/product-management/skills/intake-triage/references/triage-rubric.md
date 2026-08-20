# The four-tier triage rubric

Every raw ask gets exactly one verdict. The four tiers are a deliberate replacement for
binary accept/reject: **Collect More Signal** is the honest middle state that keeps an
under-evidenced but plausible ask alive without pretending it is decided. Adapted from
phuryn/pm-skills (MIT, © Pawel Huryn).

Score in two passes: a **scope gate** first (a hard filter), then a **value/evidence** read for
everything that survives it.

## Pass 1 — the scope gate (a hard filter, run first)

An ask is **Decline-or-Defer** immediately, before any value judgement, if any of these is true:

- It breaches the project's out-of-scope line (from `.agents/profile.md` / project `docs/`) —
  quote that line verbatim in the decline.
- It targets a surface this product does not own.
- It duplicates an existing Problem or Hypothesis (link the existing artifact).

Scope is not a matter of opinion — it is the project's line, not yours to invent. Do not argue
value for an ask the scope gate already rejected.

## Pass 2 — value and evidence (for asks that clear the gate)

| Verdict | Value | Evidence today | Sequencing | What the skill does |
|---|---|---|---|---|
| **Act Now** | Clear, in scope | Already exists (a real requester + a "why", or a recurring theme) | Worth starting now | Mint a Problem |
| **Plan Next** | Clear, in scope | Exists or is easy to get | Behind current work | Mint a Problem; do not act yet |
| **Collect More Signal** | Plausible | Thin — one anecdote, no named requester, no "why", or an unquantified "it'd be nice" | Cannot sequence yet | Queue for `stakeholder-interview` prep; mint no Problem |
| **Decline-or-Defer** | Low, or killed by the scope gate | n/a | n/a | Decline plainly, with the reason (scope line / duplicate / low value) |

### Reading the evidence signal

- **Named requester + a "why"** — a role who wants it and the outcome they are chasing. Strong.
- **Frequency** — how many independent asks say the same thing. Recurrence is signal; a single
  loud voice is not.
- **"It would be nice"** with no requester and no why is the canonical **Collect More Signal** —
  not a no, but not evidence either.

### The honest-middle discipline

Do not inflate a Collect-More-Signal ask into Plan Next to look decisive, and do not bury it in
Decline-or-Defer to clear the queue. Route it to evidence-gathering and let the next interview
settle it. Under-evidenced asks that get force-verdicted are exactly how a backlog fills with
bets no one can defend.

## Rationale, always

Every verdict carries a one-line rationale in the batch record. A verdict with no rationale is
un-auditable — the next reader (or the same PO in a month) cannot tell whether the boundary held
or a good ask was dropped by accident.
