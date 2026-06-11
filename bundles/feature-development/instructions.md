# Feature Development — shared conventions

This is a **cross-platform delivery team**. Each project picks the developer
roles it needs — a JS/TS frontend, a Python backend, an iOS app, or any
combination. These are team-wide defaults; scout refines them per project in
`AGENTS.md`, which always wins over this file. Only the sections for the
stacks actually in play apply.

## Web stack (`js-dev`, `python-dev`, `test-automation-engineer`)

- **Frontend** (`js-dev`): JS/TS SPA or SSR app. Owns UI, client state, and
  calls to the backend API. Does not reach into the database.
- **Backend** (`python-dev`): **FastAPI** HTTP service, plus **FastMCP** for
  any MCP servers — modern async Python, Pydantic at the boundaries. (Not
  Django, not Flask — if scout finds those, flag the deviation.) Owns data,
  business logic, and the API contract the frontend consumes.
- **The contract is the seam.** Frontend and backend integrate through the API
  schema (FastAPI's OpenAPI / a typed client). Contract changes are a tech-lead
  concern and need both devs aligned before merge.
- **API changes are two-sided** — a backend change the frontend consumes isn't
  done until the frontend is updated (or explicitly versioned). Flag the
  counterpart role. Prefer generated/shared types at the boundary.
- `test-automation-engineer` covers the end-to-end path through the real stack
  (Playwright). Secrets never land in the frontend bundle.

## iOS stack (`ios-dev`)

- **App** (`ios-dev`): Swift + SwiftUI. Modern concurrency (async/await,
  actors). Data via SwiftData / Core Data or a networked backend.
- **Dependencies:** Swift Package Manager preferred; note CocoaPods (`Podfile`)
  or Carthage if the project uses them.
- **Pattern:** MVVM is the common SwiftUI default — confirm the project's actual
  pattern from `AGENTS.md` before assuming.
- **Build & test through Xcode tooling** (`xcodebuild` / the project's scheme);
  don't hand-wave "it compiles." Respect actor isolation / `@MainActor` — no
  data races. SwiftUI previews for iteration; Swift Testing / XCTest for
  regression coverage. Releases go through the project's signing/distribution
  flow (fastlane, Xcode Cloud, or manual archive) — note which in `AGENTS.md`.

## Definition of done (team-wide)

A change is done when it builds, its tests pass, and — for the web stack — the
affected side of the API contract is consistent and user-facing flows are green
e2e; for the iOS stack — UI changes are verified in a simulator or preview and
concurrency is race-free. "I wrote the code" is not done.
