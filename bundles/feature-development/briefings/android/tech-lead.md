---
name: Project briefing
description: Stack overlay (feature-development/android) — Android architecture defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Kotlin + Jetpack Compose, structured concurrency (coroutines +
  Flow). _(confirm AGP/Kotlin generation and Compose-vs-XML from AGENTS.md)_
- **Common architecture:** MVVM with Compose UI, `ViewModel`s exposing
  `StateFlow`/`SharedFlow`, and a repository layer over Room/DataStore/network.
  Confirm the project's actual choice — don't impose this if it uses something
  else (e.g. a different state-holder pattern).
- **Dependencies:** version catalog (`gradle/libs.versions.toml`) is the single
  source of truth for versions — never a hardcoded version string in a build
  file. Adding a third-party dependency is an architectural decision, not a
  convenience.

## My Role Focus

Own the module graph and the **state/concurrency model**. The highest-risk
areas in a Compose codebase are state ownership (state hoisted to the wrong
level, or a `ViewModel` leaking into a leaf composable), effect correctness
(`LaunchedEffect`/`DisposableEffect` keys, coroutine scope lifecycle,
main-safety of suspend functions), and dependency/build sprawl (AGP-version
drift, KSP vs KAPT inconsistency across modules, an unjustified new
dependency). Decompose features into testable units with clear
composable ↔ ViewModel ↔ repository seams. Review for structured-concurrency
violations and correct Flow-primitive choice (the
`kotlin-coroutines-structured-concurrency` and `kotlin-flow-state-event-modeling`
skills are the reference, `compose-state-hoisting` for state placement). Keep
an eye on build/release config — AGP version, minification, and Play
`targetSdk` compliance are tech-lead concerns.
