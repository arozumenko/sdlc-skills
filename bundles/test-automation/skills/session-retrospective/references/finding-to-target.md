# Finding → write-target mapping

| Finding kind | Target | How |
|---|---|---|
| Lesson specific to one role | `.agents/memory/<role>/project_briefing.md` or a new curated entry | `memory` skill (curated-entry write) |
| Team-wide process improvement | `.agents/workflow.md` | surgical edit |
| Coding-standard correction | `.agents/conventions.md` | surgical edit |
| Project tooling / build-script knowledge (no single role owns it) | `.agents/conventions.md` or `AGENTS.md` | surgical edit |
| Durable project fact / gotcha | curated entry in the most relevant role's memory | `memory` skill |
| **A correction memory has already failed to prevent** — same class, ≥3 sessions, and a prior retrospective already wrote it down | a deterministic guard: a hook, a validator, or a rule the pipeline enforces | see below |
| Every run | `.agents/retrospectives/YYYY-MM-DD.md` | new report: analyzed / applied / deferred |

## When prose stops being the answer

Most findings become words: a briefing line, a convention, a curated fact. Words
work because an agent reads them. But a retrospective that writes the same
lesson a third time is evidence about the *mechanism*, not the lesson — the note
is there, it is being read, and the mistake still happens. Writing it a fourth
time in firmer language is the cheapest thing to do and it does not work.

Escalate instead, and say plainly that you are escalating because prose failed:

| Recurrence | Response |
|---|---|
| First time | A curated entry or briefing line. Prose is right here — one occurrence does not prove a pattern. |
| Second time, note already present | Make it *reachable*: is it in the role's `MEMORY.md` index, or buried in an unindexed file? Promote it. Often the note was never in context. |
| Third time, note present and indexed | Prose has been given three chances. Propose a **guard**: a hook that refuses the action, a validator the pipeline runs, or a schema field that makes the mistake unrepresentable. |

A guard beats a rule for exactly one reason: it does not depend on the agent
having read anything. That is also its cost — a guard fires on cases nobody
anticipated, and an over-eager one gets disabled, which is worse than no guard
at all. So propose the narrowest one that covers the evidenced cases, name the
sessions it would have caught, and say what it would block that should be
allowed. If you cannot name that, the guard is too broad.

The evidence bar is higher here than for a memory write, not lower: a curated
entry that turns out wrong wastes a few tokens, and a hook that turns out wrong
blocks work for everyone until someone finds it. Guards need an ack of their
own — never fold one into a batch of memory diffs.

## Rules

- **Ack first.** Present diffs + per-item rationale with session-id evidence;
  write nothing until the user approves. Mirrors scout's "surface the delta,
  wait for ack" rule.
- **Evidence required.** Each durable fact cites the session id it came from.
- **Surgical edits.** For shared docs, change only the affected lines; don't
  reformat working prose.
- **Defer, don't drop.** Findings the user declines go in the report's
  "deferred" section with the reason.
- **Watermark last.** Advance `.agents/memory/scout/.last-retrospective` only
  after a successful write.
