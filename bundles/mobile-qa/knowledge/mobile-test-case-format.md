# Mobile Test Case Format Specification

## File Location & Naming

```
tasks/
  <suite-name>/
    TC-001_<slug>.md
    TC-002_<slug>.md
    ...
```

- **Suite name** = feature or test type: `smoke`, `regression`, `onboarding`, `checkout`
- **ID format** = `TC-` + 3-digit zero-padded number: `TC-001`, `TC-042`
- **Slug** = lowercase, hyphens: `login-valid-credentials`, `swipe-onboarding-flow`

---

## What Makes a Good Mobile Test Case

| ✅ Good | ❌ Bad |
|--------|--------|
| Tests exactly ONE behaviour | Multiple conditions bundled together |
| Preconditions include device state and permissions | "App is installed" (vague) |
| Each step = one verb + one object (tap, swipe, enter) | Steps that combine multiple gestures |
| Expected result is measurable ("Settings screen appears") | "Navigation works" |
| Self-contained — no dependency on other test cases | Assumes prior test left app in a specific state |
| Test data values are literal (`user@example.com`) | "Enter any valid email" |
| Platform tag present when behaviour differs by OS | Assumes identical iOS/Android behaviour |

---

## File Format (Full Template with Annotations)

```markdown
---
id: TC-001
title: Login with valid credentials          # short, verb+object
priority: critical                           # critical | high | medium | low
type: functional                             # functional | regression | smoke | integration | exploratory
module: authentication                       # feature area
platform: both                               # ios | android | both
app_type: native                             # native | pwa | hybrid
runner_mode: manual                          # playwright | manual (appium = future)
device_type: simulator                       # real | simulator | emulator
size: M                                      # S | M | L — assigned by mobile-test-sizer (optional)
orientation: portrait                        # portrait | landscape | both
requirements: [REQ-001]                      # traceability (omit if no req IDs)
tags: [smoke, login, happy-path]             # free-form, used for filtering
---

# TC-001: Login with Valid Credentials

**Module:** Authentication | **Priority:** Critical | **Platform:** Both | **Runner:** Manual

## Preconditions
- App is installed and launched (at the launch screen or home screen)
- Network connectivity is available
- Test user exists: email=`test@example.com`, password=`Test1234!`
- No active session (user is logged out)

## Test Data

| Field    | Value              |
|----------|--------------------|
| Email    | test@example.com   |
| Password | Test1234!          |

## Steps

| # | Action                                                      | Expected Result                                      |
|---|-------------------------------------------------------------|------------------------------------------------------|
| 1 | Tap "Sign In" on the welcome screen                         | Login screen appears with Email and Password fields  |
| 2 | Tap the Email field and enter `test@example.com`            | Email value is set in the field                      |
| 3 | Tap the Password field and enter `Test1234!`                | Password is masked with dots                         |
| 4 | Tap the "Log In" button                                     | Loading indicator appears briefly, then disappears   |
| 5 | Observe the current screen                                  | Home screen is displayed with user avatar visible    |

## Expected Final State
User is authenticated and the Home screen is visible. User avatar or display name is shown in the navigation bar. No error messages or alerts present.

## Teardown
- Tap profile icon → Settings → Log Out
- Confirm logout on the dialog

## Platform Notes
_(Add only when behaviour differs between iOS and Android)_
- **iOS**: "Log In" button label may read "Sign In" depending on OS version
- **Android**: Back button during loading cancels the request and returns to the login screen
```

---

## Frontmatter Field Reference

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| `id` | Yes | `TC-NNN` | Unique identifier. Never reuse or reassign. |
| `title` | Yes | string | Concise name. Start with a verb. |
| `priority` | Yes | `critical` `high` `medium` `low` | `critical` = blocks release if fails |
| `type` | Yes | `smoke` `functional` `regression` `integration` `exploratory` | Test category |
| `module` | Yes | string | Feature area under test |
| `platform` | Yes | `ios` `android` `both` | Target platform(s) |
| `app_type` | Yes | `native` `pwa` `hybrid` | App technology — drives runner selection |
| `runner_mode` | Yes | `playwright` `manual` | How mobile-test-runner executes this case |
| `device_type` | Yes | `real` `simulator` `emulator` | Execution environment |
| `size` | No | `S` `M` `L` | Execution-size rating, assigned by `mobile-test-sizer` |
| `orientation` | No | `portrait` `landscape` `both` | Required device orientation |
| `requirements` | No | `[REQ-001]` | Traceability links |
| `tags` | No | array | Arbitrary labels for filtering |

---

## Runner Mode Selection

| `app_type` | `runner_mode` | How it runs |
|------------|---------------|-------------|
| `pwa` | `playwright` | Playwright MCP with mobile viewport + touch emulation |
| `hybrid` | `playwright` | Playwright MCP for web views |
| `native` (Appium available) | `appium` | Appium MCP — real native automation via XCUITest / UiAutomator2 |
| `native` (no Appium) | `manual` | mobile-guide-writer generates a step checklist; human executes on device |

`runner_mode` is derived from `app_type` and Appium availability in `mobile_app_profile.md`. The `mobile-test-author` sets it automatically. To switch from `manual` to `appium`: install Appium MCP, then re-run `mobile-app-profiler`.

---

## Mobile-Specific Step Vocabulary

Use these verbs consistently so `mobile-test-runner` can map them to actions:

| Verb | Meaning | Playwright equivalent | Manual equivalent |
|------|---------|-----------------------|-------------------|
| `Tap` | Single finger tap | `click` | Tap with finger |
| `Double-tap` | Two rapid taps | `dblclick` | Double tap with finger |
| `Long-press` | Press and hold (1s+) | `hover` (approximation) | Press and hold |
| `Swipe left/right/up/down` | One-finger directional swipe | `drag` approximation | Swipe with finger |
| `Pinch in/out` | Two-finger zoom gesture | Not automatable (manual only) | Pinch with two fingers |
| `Scroll down/up` | Scroll content | `wheel` or drag | Scroll |
| `Enter` | Type text into focused field | `fill` / `type` | Type on keyboard |
| `Tap [system button]` | Hardware button (Home, Back, Volume) | Not via Playwright | Press hardware button |
| `Accept permission` | Tap "Allow" on system dialog | `handle_dialog` | Tap "Allow" |
| `Deny permission` | Tap "Don't Allow" / "Deny" | `handle_dialog` | Tap "Deny" |
| `Open deep link` | Launch via URL scheme or universal link | `navigate` | Open URL in browser/share sheet |

---

## `{{base_url}}` Placeholder (PWA / Hybrid only)

For `runner_mode: playwright` cases only. Use `{{base_url}}` as a prefix for all URLs:

```
{{base_url}}/login  →  https://app.example.com/login
```

Native cases do not use `{{base_url}}` — steps reference screen names, not URLs.

---

## Priority Definitions

| Priority | Meaning | Typical examples |
|----------|---------|-----------------|
| `critical` | Core user journey — failure blocks release | Login, checkout, data save |
| `high` | Important feature — failure warrants urgent fix | Search, push notifications |
| `medium` | Secondary feature — fix in next cycle | Settings, sorting, filters |
| `low` | Cosmetic or edge case — low urgency | UI spacing, copy typos |

---

## Size Definitions (Mobile-Calibrated)

| Size | Steps | Complexity | Examples |
|------|-------|------------|---------|
| `S` | 1–5 | Simple taps, no system interactions, no auth | View a screen, tap a button, read a label |
| `M` | 6–12 | Form entry, single permission, swipe navigation, standard auth | Login flow, fill and submit a form, accept location permission |
| `L` | 13+ | Biometrics, push notifications, background/foreground, multi-app, camera | Face ID login, receive and act on push notification, photo upload |
