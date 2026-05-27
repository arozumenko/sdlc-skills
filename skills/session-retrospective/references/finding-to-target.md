# Finding → write-target mapping

| Finding kind | Target | How |
|---|---|---|
| Lesson specific to one role | `.agents/memory/<role>/project_briefing.md` or a new curated entry | `memory` skill (curated-entry write) |
| Team-wide process improvement | `.agents/workflow.md` | surgical edit |
| Coding-standard correction | `.agents/conventions.md` | surgical edit |
| Project tooling / build-script knowledge (no single role owns it) | `.agents/conventions.md` or `AGENTS.md` | surgical edit |
| Durable project fact / gotcha | curated entry in the most relevant role's memory | `memory` skill |
| Every run | `.agents/retrospectives/YYYY-MM-DD.md` | new report: analyzed / applied / deferred |

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
