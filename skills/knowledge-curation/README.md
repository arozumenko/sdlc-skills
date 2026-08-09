# knowledge-curation

Promotes hard-won facts out of per-role memory into a shared, committed
`.agents/knowledge/` layer — and keeps that layer honest.

**The problem it solves.** `.agents/memory/<role>/` is local and role-scoped, so a fact one role
paid for is invisible to every other role, and to the same role on another machine. Teams
rediscover, expensively, things a teammate diagnosed correctly weeks earlier.

**What it does**

- **promote** — apply four admission tests (cross-role · verified · durable · costly to
  rediscover), file the note in the folder whose README describes it, index it
- **sweep** — at the end of a session or mission, ask per candidate *"would another role have
  needed this today?"*
- **audit** — unindexed notes, dead links, notes overdue re-verification
- **retire** — correct or delete when a fact stops being true; never leave a half-true note

Admission is deliberately narrow: an unverified claim in a committed layer is worse than silence,
because it is trusted.

Pairs with the `memory` skill, which owns the per-role layer below it.
