---
name: Project briefing
description: Stack overlay (feature-development/android) — Android detection hints; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Native Android — Kotlin + Jetpack Compose. _(confirm AGP, Kotlin, compileSdk, targetSdk when you explore)_
- **Detect project:** `settings.gradle.kts` (or `.gradle`), `gradle/libs.versions.toml`
  (the version catalog — the authority for every version fact), `AndroidManifest.xml`
  per module, `gradle/wrapper/` (wrapper version and distribution URL).
- **Detect tooling:** `gradle/libs.versions.toml` for AGP/Kotlin/Compose/Room
  versions; `build.gradle.kts` (root and per-module) for applied plugins; CI
  config (`*.yml` referencing `./gradlew` or `bundleRelease`) — note if none
  exists, since that changes what dev/QA roles can rely on.
- **Module graph:** list every module declared in `settings.gradle.kts`
  (`include(...)`) — `:app`, feature modules, `:core:*`, etc. Record which
  modules are `com.android.application` vs `com.android.library` vs pure
  Kotlin/JVM.
- **KSP vs KAPT:** check which annotation-processing plugin is applied
  (`com.google.devtools.ksp` vs `org.jetbrains.kotlin.kapt`) — this changes
  which DAO/Hilt code generation strategy is available.
- **Compose vs XML:** check for `buildFeatures { compose = true }` and the
  presence/absence of `res/layout/*.xml` — flag a project that mixes both, or
  one that's still XML/Views-only (out of scope for this bundle's `android-dev`).
- **KMP detection:** check root `build.gradle.kts` / module `build.gradle.kts`
  for `kotlin("multiplatform")` (or `org.jetbrains.kotlin.multiplatform`) and
  for a `commonMain/` source set under any module. **Record the finding either
  way** — a Kotlin Multiplatform project changes ownership questions between
  `android-dev` and `ios-dev` that this bundle deliberately leaves unresolved;
  the seam can't be addressed if nobody records whether it applies.
- **Data layer:** check for Room (`@Database`/`@Entity`), DataStore, or a
  networked backend (Retrofit/Ktor).

## My Role Focus

Onboard a native Android repo: identify the module graph, the version catalog
(AGP/Kotlin/compileSdk/targetSdk), the KSP-vs-KAPT choice, and whether the UI
layer is Compose, XML, or mixed. In `AGENTS.md`, capture the exact `./gradlew`
commands for compile, test, and lint — "open in Android Studio" is not enough
for unattended roles, and Android has no single "scheme" the way Xcode does,
so the commands must be assembled per module. Record whether the project is
Kotlin Multiplatform (`kotlin("multiplatform")` or a `commonMain/` source set)
so any cross-platform work has a documented starting point instead of a silent
gap. Note whether CI runs instrumented tests — `android-dev` treats their
absence as a real constraint, not a formality.
