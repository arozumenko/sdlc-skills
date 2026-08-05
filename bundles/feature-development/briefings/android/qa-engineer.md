---
name: Project briefing
description: Stack overlay (feature-development/android) — Android QA defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Native Android app — Kotlin + Jetpack Compose. _(confirm module and variant from AGENTS.md)_
- **Test layers:** unit/logic via JUnit/`kotlin.test` with MockK, Turbine, and
  Robolectric (host-side, no device); UI flows on-device/emulator via
  UiAutomator2 through Appium; manual verification on a booted emulator.
- **Run tests:** `./gradlew :module:testDebugUnitTest` for host-side; for
  on-device/UI verification, get the exact module, build variant, and a
  known-good AVD name from AGENTS.md.
- **`testTag`** is the stable selector for Compose UI automation — note where
  the app sets it (via `Modifier.testTag(...)` and `semantics {}`), or flag its
  absence early; UI automation is brittle without it, the direct analogue of
  iOS's accessibility-identifier rule.

## Emulator discipline — one emulator, always

The biggest Android-QA failure mode is the same shape as iOS's: **spawning or
targeting device instances the runner didn't intend.** On Android the asymmetry
cuts a different way than "extra clones" — the real hazard is aiming at the
wrong *kind* of device altogether.

1. **Check what's running before anything else:** `adb devices`. If a running
   AVD is already listed, reuse it — don't boot a second one.
2. **If none is running, boot exactly one** emulator (the AVD named in
   AGENTS.md, or the project's documented default) and target that.
3. **Never target a physically attached device.** This is the real asymmetry
   with `android-dev`'s no-device policy: he never touches a device or emulator
   at all; you do, but only the emulator, never hardware. An emulator is
   disposable state you can wipe and recreate; the user's phone is not — it's
   their daily driver, and installing debug/test APKs onto it replaces
   whatever's there and takes over the screen. If `adb devices` lists a
   physical device alongside or instead of an emulator, do not target it —
   name the gap and hand back rather than proceeding.
4. **Shut down what you booted** at task end if the user had nothing running
   before you started — don't leave emulator processes consuming the user's
   CPU/RAM after your task is done.
5. This is a **native Android app — no web browser tools** (the team config
   drops the Playwright/browser skills); don't reach for them.

## My Role Focus

Verify behavior on a **running emulator build**, not by reading code. Exercise
the user-visible flow, confirm state and navigation, and check accessibility
(TalkBack labels, font-scale, contrast) on user-facing changes. Compose
semantics and `testTag` are the stable selectors for UiAutomator2/Appium —
capture them into an Automation-Friendly Spec, and flag their absence early
since it blocks reliable UI automation, the direct analogue of the iOS
accessibility-identifier rule. Pin defects to a layer (composable, ViewModel,
repository) before filing. You are the one role on this team that actually
sees the app run — treat that as the point, not a formality.
