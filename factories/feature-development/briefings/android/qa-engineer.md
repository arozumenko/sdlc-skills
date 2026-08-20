---
name: Project briefing
description: Stack overlay (feature-development/android) — Android QA defaults; scout refines per project
type: project
---

## Project Knowledge

- **Stack:** Native Android app — Kotlin + Jetpack Compose. _(confirm module and variant from AGENTS.md)_
- **Test layers:** unit/logic via JUnit/`kotlin.test` with MockK, Turbine, and
  Robolectric (host-side, no device); UI flows instrumented (emulator) via
  UiAutomator2 through Appium; manual verification on a booted emulator.
- **Run tests:** `./gradlew :module:testDebugUnitTest` for host-side. For
  instrumented (emulator) work there is no single Xcode-style command that
  builds, installs, and runs — assemble it yourself, and **every one of these
  commands is pinned to the emulator's serial, always, no exceptions:**
  confirm the target with `adb devices`, then deploy with
  `ANDROID_SERIAL=emulator-5554 ./gradlew :app:installDebug` (or
  `adb -s emulator-5554 install <path-to-apk>`), and run the instrumented
  suite with `ANDROID_SERIAL=emulator-5554 ./gradlew :module:connectedDebugAndroidTest`
  — get the exact module, build variant, and a known-good AVD name/serial from
  AGENTS.md. **The pin on `connected*AndroidTest` is not optional the way it
  might look:** AGP's `connected*AndroidTest` tasks fan out to *every*
  connected device by default — unrelated to installs, which just refuse
  ambiguity — so with the user's phone attached alongside the emulator, a bare
  invocation silently pushes both APKs onto the phone and runs the suite
  there, in direct violation of rule 3 below. **These commands are yours, not
  `android-dev`'s** — he is forbidden every one of them (`installDebug`,
  `connectedAndroidTest`, any `adb` subcommand but `devices`); the difference
  is the whole point of having two roles.
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
2. **If none is running, check `emulator -list-avds` before booting.** If the
   AVD named in AGENTS.md (scout's recorded default) is listed, boot exactly
   one and target that — but disclose the cost first if this is its first
   boot on this machine: a multi-GB system-image download plus a
   hardware-acceleration dependency (KVM on Linux, Hypervisor.framework on
   macOS) that some corporate laptops don't have. Report that cost rather
   than silently starting the download — the same courtesy `android-dev`
   extends for Robolectric's first-run download. **If zero AVDs exist on this
   machine at all**, stop and report that instead of creating one —
   `avdmanager create avd` is not authorised for you any more than it is for
   `android-dev`.
3. **Never target a physically attached device.** This is the real asymmetry
   with `android-dev`'s no-device policy: he never touches a device or emulator
   at all; you do, but only the emulator, never hardware. An emulator is
   disposable state you can wipe and recreate; the user's phone is not — it's
   their daily driver, and installing debug/test APKs onto it replaces
   whatever's there and takes over the screen. If `adb devices` lists a
   physical device alongside or instead of an emulator, do not target it —
   name the gap and hand back **to the user**, the only party who can supply
   a real device, rather than proceeding.
4. **Shut down what you booted** at task end if the user had nothing running
   before you started — don't leave emulator processes consuming the user's
   CPU/RAM after your task is done.
5. This is a **native Android app — no web browser tools** (the team config
   drops the Playwright/browser skills); don't reach for them.
6. **Accepted gap: jank and frame-timing regressions don't reproduce
   meaningfully on an emulator**, and no role on this team touches physical
   hardware. `android-dev`'s Compose performance rules (stable list keys,
   `derivedStateOf`, no sorting in a composable body) can regress in ways
   this team cannot observe pre-launch. That's an accepted trade for a
   pre-launch greenfield app — flag it explicitly if the project nears a
   performance-sensitive release rather than letting it be discovered there.

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
