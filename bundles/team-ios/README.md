# iOS Team

A native iOS delivery team building a **Swift / SwiftUI** app, with QA and
core coordination roles.

## Install

```bash
npx github:arozumenko/sdlc-skills init --bundle team-ios
```

Installs the agents below into your IDE (`.claude/`, `.cursor/`, …), pulls
each agent's skills (including Paul Hudson's SwiftUI / SwiftData / Swift
Testing / Swift Concurrency skills via `ios-dev`), seeds per-role stack
briefings into `.agents/memory/<role>/`, and splices the team conventions
into `AGENTS.md` / `CLAUDE.md`.

## Roster

| Role | Alias | Group | Does |
|---|---|---|---|
| `scout` | kit | core | Onboards the repo — finds the workspace, dependency manager, build/test schemes, release path |
| `ba` | alex | core | Turns requests into clear requirements and acceptance criteria |
| `tech-lead` | rio | core | Owns app architecture and the concurrency model |
| `project-manager` | max | core | Sequences work, tracks issues, coordinates the team |
| `ios-dev` | io | dev | **App** — Swift + SwiftUI, async/await + actors, SwiftData / Core Data |
| `qa-engineer` | sage | qa | Verifies on a running simulator build; XCUITest paths + accessibility |

## How this team works

Modern Swift on **SwiftUI**, built and tested through Xcode tooling
(`xcodebuild` + the project scheme). The highest-risk area is
**concurrency correctness** — actor isolation and `@MainActor` — which the
tech-lead guards. SPM is the preferred dependency manager. See
[`instructions.md`](instructions.md) for the full working agreements
(installed into your project's `AGENTS.md`).

## What this bundle adds

- **Agents + skills** — the 6 roles above and their declared skills.
- **Instructions** — [`instructions.md`](instructions.md) → spliced into `AGENTS.md` / `CLAUDE.md`.
- **Briefings** — stack overlays in [`briefings/`](briefings/) → seeded into `.agents/memory/<role>/project_briefing.md` for `scout`, `tech-lead`, `qa-engineer` (scout refines them per project).
- **Hooks** — _(none yet)_.

See [`bundle.json`](bundle.json) for the exact manifest and the top-level
[`../SPEC.md`](../SPEC.md) for how bundles are defined and installed.
