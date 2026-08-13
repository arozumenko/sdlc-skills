# Product Management — shared conventions

This is a **Product Owner discovery team**. It takes a raw ask — a feature
request, complaint, or idea — and runs it through a discovery loop until it
comes out the other side as a verified, prioritized hypothesis anchored to a
ratified outcome, ready to hand off as groomed backlog work.

## The team

- **`product-owner`** (Priya) — owns the loop end to end: triages intake,
  frames problems, drafts outcomes and hypotheses, maps the opportunity tree,
  runs prioritization, and guards the promotion gate. Dispatches
  `discovery-researcher` whenever a claim needs evidence rather than her own
  judgment.
- **`discovery-researcher`** (Sam) — gathers and stress-tests evidence:
  stakeholder interviews, desk/market research, and adversarial verification
  of a hypothesis's assumptions. Never decides what gets built; hands
  evidence back to `product-owner`.

## `docs/discovery/` layout

```
problems/PRB-NNN-*.md            problem records
personas/                        persona sketches, referenced by role
journeys/                        user/customer journey maps
hypotheses/HYP-NNN-*.md          testable bets, status: incubating|promoted|parked
outcomes.md                      ratification-gated outcome register
decisions.md                     append-only DEC log
evidence/intake/                 raw, unprocessed asks
evidence/interviews/             interview notes and summaries
evidence/research/               desk research, market/competitive material
evidence/verifications/          evidence gathered to test a hypothesis
evidence/learnings/              distilled takeaways from verification
outcome-tree.md, journey-coverage.md, priority.md   generated boards — never hand-edit
```

See `docs/discovery/README.md` (seeded at install) for the full ID
conventions and hypothesis lifecycle.

## Pipeline order

1. **Intake** — a raw ask lands in `evidence/intake/`; `intake-triage` verdicts
   it and mints in-scope items as Problems.
2. **Frame** — `define-personas` and journeys capture who and what a problem
   touches.
3. **Hypothesize** — `journeys-to-hypotheses` converts covered journeys into
   hypothesis stubs, each pointing at the `outcomes.md#tbd` sentinel until an
   anchor exists.
4. **Anchor** — `define-outcomes` drafts and ratifies the outcome anchor a
   hypothesis is promoted against, and repoints the bets waiting on the
   sentinel.
5. **Map** — `opportunity-tree` hangs the problem under that ratified outcome
   (or flags it as a solution in disguise). It runs after ratification because
   the tree's roots *are* the ratified anchors.
6. **Sharpen** — `grill-decision` stress-tests the bet and earns its evidence
   class, writing the `confidence:` dimensions and `appetite:` that scoring
   needs.
7. **Verify** — `stakeholder-interview` and `discovery-researcher`'s research
   ground assumptions in evidence.
8. **Prioritize** — `prioritize-bets` ranks incubating/promotable hypotheses
   against the active framework (RICE by default). It runs after verification
   because its confidence factor is derived from banded evidence — rank a bet
   before it has any and it is unscoreable.
9. **Learn** — `capture-learning` distills what happened when a bet concludes,
   win or lose.
10. **Check status** — `discovery-status` gives a read-only dashboard of where
    everything in the pipeline stands, at any point.

Two orderings in that list are load-bearing rather than stylistic: **anchor
before map**, because `opportunity-tree` hangs problems under an already-ratified
outcome; and **verify before prioritize**, because a bet with no evidence class
cannot be scored at all.

## Handoff to `ba`

Only a hypothesis with `status: promoted` and a ratified (`status: active`)
outcome anchor is ready to leave this team. At that point it hands off to the
`ba` role to become groomed backlog work — this team does not write backlog
items itself.

## Agent memory — two layers

**`.agents/knowledge/`** — distilled, cross-role, **verified** facts about this project. Committed
and reviewed. Read its `README.md` before starting, plus the folder covering what you are touching.

**`.agents/memory/<role>/`** — your own working notes and daily log. **Local only** (gitignored,
never shared between machines), so anything another role needs is invisible there.

When you learn something, choose the layer deliberately. Promote it to `.agents/knowledge/` only if
**all four** hold — otherwise keep it in your role directory:

1. **Cross-role** — useful to two or more roles, or architecture-level.
2. **Verified** — you confirmed it against the running system, and the note says how, with a date.
3. **Durable** — still true once this mission ends.
4. **Costly to rediscover** — anything obvious from reading the code belongs in the code.

Correct or delete a shared note the moment it stops being true: a stale one misleads every role at
once. Never commit an unverified claim — it is worse than silence, because it is trusted. Mission
state belongs on the work board, not in either memory layer.

Use the `memory` skill for the per-role layer and `knowledge-curation` for the shared one.
