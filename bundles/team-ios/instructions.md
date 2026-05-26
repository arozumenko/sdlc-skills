# iOS Team — shared conventions

This is an **iOS app team** building a native Swift/SwiftUI application.
These are team-wide defaults — scout refines them per project in
`AGENTS.md`, which always wins over this file.

## Architecture shape

- **App** (`ios-dev`): Swift + SwiftUI. Modern concurrency (async/await,
  actors). Data via SwiftData / Core Data or a networked backend.
- **Dependencies:** Swift Package Manager preferred; note if the project
  uses CocoaPods (`Podfile`) or Carthage instead.
- **Pattern:** MVVM is the common default for SwiftUI — confirm the
  project's actual pattern from `AGENTS.md` before assuming.

## Working agreements

- **Build & test through Xcode tooling.** Use `xcodebuild` / the project's
  scheme for builds and tests; don't hand-wave "it compiles."
- **Concurrency correctness matters.** Respect actor isolation and
  `@MainActor`; don't introduce data races. (See the swift-concurrency
  skill `ios-dev` carries.)
- **Previews and tests, not just the simulator.** SwiftUI previews for fast
  iteration; Swift Testing / XCTest for regression coverage.
- **Releases** go through the project's signing + distribution flow
  (fastlane, Xcode Cloud, or manual archive). Note which one in `AGENTS.md`.

## Definition of done (team-wide)

A change is done when it builds for the target scheme, its tests pass, UI
changes are verified in the simulator or a preview, and concurrency is
race-free. "I wrote the code" is not done.
