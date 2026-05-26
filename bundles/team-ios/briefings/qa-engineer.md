---
name: Project briefing
description: Stack overlay (team-ios) — iOS QA defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Native iOS app — Swift + SwiftUI. _(confirm target/scheme from AGENTS.md)_
- **Test layers:** unit/logic via Swift Testing or XCTest; UI flows via XCUITest; manual verification in the iOS Simulator.
- **Run tests:** `xcodebuild test -scheme <scheme> -destination 'platform=iOS Simulator,name=<device>'` — get the exact scheme and a known-good simulator destination from AGENTS.md.
- **Accessibility identifiers** are the stable selector for XCUITest — note where the app sets them (or flag their absence; UI automation is brittle without them).

## My Role Focus

Verify behavior on a **running simulator build**, not by reading code.
Exercise the user-visible flow, confirm state and navigation, and check
accessibility (VoiceOver labels, Dynamic Type, contrast) on user-facing
changes. Capture accessibility identifiers and stable UI paths into an
Automation-Friendly Spec. Pin defects to a layer (view, view-model, data)
before filing. Flag missing accessibility identifiers early — they block
reliable UI automation.
