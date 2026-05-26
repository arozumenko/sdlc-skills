---
name: Project briefing
description: Stack overlay (team-ios) — iOS architecture defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Swift + SwiftUI, modern concurrency (async/await, actors). _(confirm pattern from AGENTS.md)_
- **Common architecture:** MVVM with SwiftUI views, observable view models, and a data layer (SwiftData / Core Data / networked). Confirm the project's actual choice — don't impose MVVM if it uses something else.
- **Dependencies:** SPM preferred; note CocoaPods/Carthage if present. Adding a dependency is an architectural decision, not a convenience.

## My Role Focus

Own the app's structure and the **concurrency model**. The highest-risk
areas in a SwiftUI codebase are actor isolation / `@MainActor` correctness
(data races), view-model boundaries (logic leaking into views), and
dependency sprawl. Decompose features into testable units with clear view ↔
view-model ↔ data seams. Review for race-freedom and modern API usage (the
swiftui / swift-concurrency / swiftdata skills are the reference). Keep an
eye on build/release config — scheme, signing, and deployment-target
changes are tech-lead concerns.
