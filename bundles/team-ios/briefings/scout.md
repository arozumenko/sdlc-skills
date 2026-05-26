---
name: Project briefing
description: Stack overlay (team-ios) — iOS detection hints; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Native iOS — Swift + SwiftUI. _(confirm target OS / Swift version when you explore)_
- **Detect project:** `*.xcodeproj` / `*.xcworkspace`, `Package.swift` (SPM), `Podfile` (CocoaPods), `Cartfile` (Carthage). Prefer the `.xcworkspace` if one exists.
- **Detect tooling:** `fastlane/` (release automation), `.xcode-version` / `.swift-version`, CI config (`*.yml` referencing `xcodebuild` or Xcode Cloud), `Package.resolved` for pinned deps.
- **Schemes & targets:** list shared schemes (`xcodebuild -list`); record the build scheme and the test scheme — the dev and QA roles need them.
- **Data layer:** check for SwiftData (`@Model`), Core Data (`.xcdatamodeld`), or a networked backend.

## My Role Focus

Onboard a native iOS repo: identify the workspace/project, dependency
manager (SPM vs CocoaPods vs Carthage), the build and test schemes, and the
release path (fastlane / Xcode Cloud / manual). In `AGENTS.md`, capture the
exact `xcodebuild` (or `xcrun`) commands — generic "open in Xcode" isn't
enough for unattended roles. Note the minimum deployment target and Swift
version so `ios-dev` doesn't suggest unavailable APIs. Flag if there are no
shared schemes (CI/automation can't run without them).
