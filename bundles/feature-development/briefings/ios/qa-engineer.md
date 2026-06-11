---
name: Project briefing
description: Stack overlay (feature-development/ios) — iOS QA defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Native iOS app — Swift + SwiftUI. _(confirm target/scheme from AGENTS.md)_
- **Test layers:** unit/logic via Swift Testing or XCTest; UI flows via XCUITest; manual verification in the iOS Simulator.
- **Run tests:** `xcodebuild test -scheme <scheme> -destination 'platform=iOS Simulator,name=<device>'` — get the exact scheme and a known-good simulator destination from AGENTS.md.
- **Accessibility identifiers** are the stable selector for XCUITest — note where the app sets them (or flag their absence; UI automation is brittle without them).

## Simulator discipline — one simulator, always

The biggest iOS-QA failure mode is **spawning extra simulator instances**.
Each `xcodebuild` without a `-destination` that matches an already-booted
device clones a new one; clones stack up, confuse the runner, and frustrate
the user.

1. **Check what's booted before running anything:** `xcrun simctl list devices booted`.
   If a device is booted, target its **exact UDID**:
   `-destination 'platform=iOS Simulator,id=<UDID>'`. If none, boot exactly one
   (`xcrun simctl boot "<device from AGENTS.md>"`).
2. **Never** use a bare `-destination 'platform=iOS Simulator,name=<device>'`
   without first confirming that device is booted — that boots a clone.
3. **One `xcodebuild` run per task** — build once, test once; re-run a subset
   with `-only-testing` rather than the whole suite.
4. **Shut down any simulator you booted** (`xcrun simctl shutdown <UDID>`) at
   task end if the user didn't have one running before you started.
5. This is a **native iOS app — no web browser tools** (the team config drops
   the Playwright/browser skills); don't reach for them.

## My Role Focus

Verify behavior on a **running simulator build**, not by reading code.
Exercise the user-visible flow, confirm state and navigation, and check
accessibility (VoiceOver labels, Dynamic Type, contrast) on user-facing
changes. Capture accessibility identifiers and stable UI paths into an
Automation-Friendly Spec. Pin defects to a layer (view, view-model, data)
before filing. Flag missing accessibility identifiers early — they block
reliable UI automation.
