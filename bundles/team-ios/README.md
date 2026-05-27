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

## Quick start

The team runs in **three phases**. You launch only two agents yourself —
`scout`, then `project-manager`; the hooks and the orchestrator handle the
rest.

**Install (once)** — `npx github:arozumenko/sdlc-skills init --bundle team-ios`.
Drops the agents into `.claude/`, pulls their skills (including the SwiftUI /
SwiftData / Swift Testing / Swift Concurrency skills), wires the
memory/context hooks, and splices `instructions.md` into `AGENTS.md`.

**Phase 1 — Inception (`scout`, once per repo).** Launch scout: _"Use the
scout agent to onboard this repo."_ It asks you what it can't infer, finds
the workspace, dependency manager, build/test schemes, and release path
(sampling PR history to learn how the team actually works), then generates
the project config — `CLAUDE.md`, `AGENTS.md`, and the `.agents/` set
(`profile.md`, `workflow.md`, `team-comms.md`, `conventions.md`,
`testing.md`) plus a per-role briefing under `.agents/memory/<role>/`.
**Why it's first:** every other agent boots from these files; without them
the team has no shared context. Re-run after big structural changes.

**Phase 2 — Usage (`project-manager` + the team).** Hand Max a feature or
ticket: _"Use the project-manager agent to implement …"_. Max sequences the
work and dispatches `ba` → `tech-lead` → `ios-dev` → `qa-engineer`, then
owns the merge gate. **The logic:** each subagent starts in a *fresh*
context, but at dispatch the `agent-start` hook injects the shared
`.agents/*` docs **and** that role's own memory — so a subagent already
knows the stack, concurrency model, and routing without you re-explaining.
You talk only to Max.

**Phase 3 — Reinforcement (assisted; owned by `scout`, not the PM).** Two
moving parts, and only one is automatic:
- **Replay is automatic.** The hooks re-inject each role's memory snapshot
  and the shared `.agents/*` docs at every dispatch (survives `/clear`,
  compaction, resume). This only replays what's already been written.
- **Capture is assisted.** Agents jot durable facts to
  `.agents/memory/<role>/` when they hit something worth keeping (or when
  you say "remember this"), and you periodically **re-run `scout`** to
  refresh the shared config and per-role briefings — scout re-reads the
  **code, PR history, and (via the `session-retrospective` skill) past agent
  sessions**, proposes the delta, and **waits for your ack**
  before writing. The PM only routes work; scout owns the durable project
  lens, so reinforcement is a scout job.

**Note:** mining past sessions is **on-demand, not automatic** — it happens
only when you run scout's `session-retrospective`, which proposes deltas you
must ack. The automatic half of reinforcement is just the hooks replaying
already-written `.agents/memory/` content at dispatch.

### How it flows

```mermaid
flowchart TD
    install(["npx … init --bundle team-ios"]) --> scout

    subgraph p1["Phase 1 — Inception · you launch scout (once per repo)"]
        scout["scout (kit) — interview + explore,<br/>sample PR history"]
        brief[/"project config:<br/>CLAUDE.md + AGENTS.md +<br/>.agents/ (profile, workflow, team-comms,<br/>conventions, per-role briefings)"/]
        scout --> brief
    end

    subgraph p2["Phase 2 — Usage · you launch project-manager"]
        pm["project-manager (max) —<br/>orchestrate + merge gate"]
        ba["ba — requirements"]
        tl["tech-lead — app architecture +<br/>concurrency model"]
        ios["ios-dev — Swift / SwiftUI"]
        qa["qa-engineer — simulator + XCUITest"]
        pm --> ba --> tl --> ios --> qa
    end

    brief -->|"agents boot from this"| pm

    subgraph p3["Phase 3 — Reinforcement · assisted (you re-run scout)"]
        mem[(".agents/memory/&lt;role&gt;/<br/>briefings · curated entries · daily log")]
    end

    pm -. "jot learnings (assisted)" .-> mem
    qa -. "jot learnings (assisted)" .-> mem
    scout -. "re-run scout to refresh —<br/>proposes delta, waits for ack" .-> mem
    mem == "auto-replayed at every dispatch<br/>(survives /clear · compact · resume)" ==> pm
```

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
- **Skill overlays** — per-role capability tuning (fetched from `skills.json`): `tech-lead` gains the SwiftUI / SwiftData / Swift Testing / Swift Concurrency skills; `qa-engineer` gains `swift-testing-pro` plus the Appium/XCUITest skills and drops the web `playwright-testing` / `playwright-cli` / `browser-verify`.
- **Hooks** — _(none yet)_.

See [`bundle.json`](bundle.json) for the exact manifest and the top-level
[`../SPEC.md`](../SPEC.md) for how bundles are defined and installed.
