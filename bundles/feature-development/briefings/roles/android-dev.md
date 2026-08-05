---
name: Project briefing
description: Role overlay (feature-development/android-dev) — Android toolchain and environment defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Native Android — Kotlin + Jetpack Compose, greenfield. _(confirm AGP/Kotlin/compileSdk/targetSdk from AGENTS.md and `gradle/libs.versions.toml`)_
- **JDK:** record the JDK version the project targets and `JAVA_HOME` in the
  shell you run Gradle from — a mismatch with Android Studio's embedded JDK is
  the single most common "works in the IDE, fails on the CLI" report.
- **Android SDK:** `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) and `local.properties`
  (`sdk.dir=...`) — machine-specific, correctly gitignored, and not something
  to hand-write by guessing a path. If missing, report it rather than invent it.
- **Gradle wrapper:** the exact wrapper version pinned in
  `gradle/wrapper/gradle-wrapper.properties` — always invoke `./gradlew`, never
  a bare `gradle` on `PATH`.
- **KSP vs KAPT:** check `gradle/libs.versions.toml` and the module
  `build.gradle.kts` for which annotation-processing backend is wired (Room 3.0
  is KSP-only) — don't assume KSP just because it's the modern default.
- **Compose vs XML:** this project is Compose-first, greenfield. If any module
  still carries XML/Views, that's a deviation worth flagging, not silently
  working around.
- **Module graph & product flavors:** record the module list (`:app`, feature
  modules, `:core:*`, etc.) and any product flavors/build types beyond
  debug/release — they change which Gradle task name is correct.

## My Role Focus

Android environments are heterogeneous in a way iOS's aren't — JDK, SDK
location, wrapper version, KSP/KAPT, flavors, and module graph all vary
project to project, and none of it is discoverable from a scheme name the way
Xcode's is. Read `AGENTS.md` and `gradle/libs.versions.toml` before emitting
any Gradle command or build config; when this briefing's guidance conflicts
with what scout recorded for this project, the project wins. Always invoke
Gradle through the project's own `./gradlew` — never a global `gradle`, never
a hand-rolled version. This is a greenfield Compose project: no XML/Views
legacy to interoperate with, no Java-migration path to reason about.
