---
name: mobile-testing
description: Mobile app testing for all web-qa agents. Covers native iOS/Android via Appium MCP and Mobitru device farm, and PWA/hybrid via Playwright mobile viewport. Use when profiling a mobile app, authoring mobile TCs, sizing mobile TCs, orchestrating a mobile suite run, executing a mobile TC, generating a manual guide, or producing a mobile run report.
license: Apache-2.0
compatibility: "Appium mode: Node.js 22+, JDK 8+, appium-mcp, Android SDK (Android) or macOS+Xcode (iOS). Device-farm mode: mobitru-mcp-server, DEVICE_FARM_API_KEY. Playwright mode: Node.js 18+, @playwright/mcp. Manual mode: no additional tooling."
metadata:
  authors:
    - Olha Stetsenko1 <Olha_Stetsenko1@epam.com>
  version: "1.0.0"
---

# Mobile Testing

Add-on skill for all web-qa agents. Augments app-profiler, test-author, test-sizer, test-run-lead, test-runner, and test-reporter to handle native iOS/Android apps (via Appium MCP or Mobitru device farm) and PWA/hybrid apps (via Playwright mobile viewport).

## When to Use Each Section

| Situation | Agent | Section |
|-----------|-------|---------|
| Profile / onboard a mobile app | app-profiler | Part 1 |
| Author mobile test cases | test-author | Part 2 |
| Size mobile test cases (S/M/L) | test-sizer | Part 3 |
| Run a mobile test suite | test-run-lead | Parts 4–5 |
| Execute one mobile TC | test-runner | Part 6 |
| runner_mode = manual → guide | test-runner | Part 7 |
| Generate mobile run report | test-reporter | Part 8 |

---

## Part 1 — Mobile App Profiling

**Trigger:** app-profiler is asked to profile a native iOS/Android or PWA/hybrid app.

Apply this section instead of (or in addition to) the standard web-profiling flow when the app is native (iOS/Android APK/IPA, React Native, Flutter, Swift, Kotlin) or when the user provides an APK/IPA file path.

### Check for Existing Profile

Read `.agents/web-qa/app_profile.md` if it exists. If it does — say "I found an existing profile for {app_name}. I'll update it." Use its content as a starting point; don't re-ask answered questions.

### Phase 1 — Interview

Ask all at once:

> To set up your mobile app profile I need a few things:
>
> 1. **App name** (as it appears on the device)
> 2. **What does it do?** (2-3 sentences)
> 3. **Platform:** iOS, Android, or both?
> 4. **App type:** Native (Swift/Kotlin/React Native/Flutter), PWA, or Hybrid?
> 5. **Build file:** Do you have an APK (Android) or IPA (iOS) file path? Or a simulator/emulator already running?
>    _(If no file: TestFlight link, Firebase link, or public URL for PWA?)_
> 6. **Login required?** Auth method: email+password / OAuth / biometrics / magic link?
> 7. **Test credentials** (if login required)
> 8. **3-5 key flows** to test
> 9. **User roles** with different permissions?
> 10. **System permissions** needed? (location, camera, notifications, contacts)
> 11. **External services** in any flow? (email OTP, SMS, payment — I'll mark these manual-only)

**Determine `runner_mode`** in this priority order:
- PWA/Hybrid → `playwright`
- Native + APK/IPA provided:
  1. `check_device_farm_status` succeeds (Mobitru MCP available) → `device-farm` _(real devices preferred)_
  2. Else local Appium MCP available → `appium`
  3. Else → `manual`
- Native + no build file → `manual` (interview-driven)

If both Mobitru and local Appium are available: "I'm defaulting to `device-farm` (real cloud devices). Say 'use local Appium' to switch to `appium` mode."

### Phase 2a — Native Exploration via Appium MCP

Use when `app_type: native`, APK/IPA available, `runner_mode: appium`.

```
# 1. Select device
select_device → list available simulators/emulators → pick target

# 2. Install and launch
appium_app_lifecycle → { action: "install", app: "{apk_or_ipa_path}" }
appium_session_management → { action: "create", capabilities: {
  platformName: "Android" | "iOS",
  automationName: "UiAutomator2" | "XCUITest",
  deviceName: "{device}",
  app: "{path}"
}}

# 3. Explore launch screen
appium_get_page_source → understand initial UI structure
appium_screenshot → save to .agents/web-qa/screenshots/launch.png

# 4. Authentication flow (if login required)
appium_find_element → locate email/password fields
generate_locators → auto-generate reliable locators for login screen
appium_set_value → fill credentials
appium_gesture → { action: "tap", elementId: "..." }
appium_get_page_source → verify authenticated state
appium_screenshot → save to .agents/web-qa/screenshots/home.png

# 5. Explore each key screen from user's flow list
# For each flow:
appium_gesture → navigate to the screen
appium_get_page_source → document structure
generate_locators → extract reliable locators
appium_screenshot → save to .agents/web-qa/screenshots/{screen}.png

# 6. Teardown
appium_session_management → { action: "delete" }
```

Apply `systematic-debugging` on unexpected behavior: screenshot + page_source → actual vs expected → hypothesis → adapt.

### Phase 2b — PWA / Hybrid Exploration via Playwright MCP

Use when `app_type: pwa` or `hybrid`. Apply the standard web-profiling flow with mobile viewport added:

```
evaluate → set mobile viewport (e.g. iPhone 15: 393×852, touch enabled)
navigate → {base_url}
wait_for → networkidle
snapshot → understand structure
take_screenshot → .agents/web-qa/screenshots/home.png
```

For each key flow — navigate, snapshot, screenshot, extract selectors.
Prefer: `data-testid` → ARIA role → visible text → `name` → CSS class.

### Phase 2c — Device Farm Exploration via Mobitru MCP

Use when `app_type: native` and `runner_mode: device-farm`.

```
# 1. Verify farm and find a device
check_device_farm_status → confirm connection
device_farm_find_device → { platform: "android" | "ios", os_version: "..." }
device_farm_take_device_by_id → { serial: "{from find_device result}" }

# 2. Upload and install the app
device_farm_upload_artifact → upload APK or IPA file
device_farm_get_artifact_status → poll until status is "verified"
device_farm_install_app → { artifactId: "...", serial: "..." }
mobile_is_app_installed → verify installation succeeded

# 3. Start session and launch
mobile_appium_init → { serial: "..." }
mobile_launch_app → { packageName: "{bundle_id}" }

# 4. Explore launch screen
mobile_list_elements_on_screen → understand initial UI structure
mobile_take_screenshot → save to .agents/web-qa/screenshots/launch.png

# 5. Authentication flow (if login required)
mobile_list_elements_on_screen → find email/password fields
mobile_click_web_element → focus email field
mobile_type_keys → "{email}"
mobile_click_web_element → focus password field
mobile_type_keys → "{password}"
mobile_click_web_element → tap login button
mobile_take_screenshot → save to .agents/web-qa/screenshots/home.png

# 6. Explore each key screen from the flow list
# For each flow:
swipe_on_screen / mobile_click_web_element / mobile_press_button → navigate
mobile_list_elements_on_screen → document visible elements
mobile_take_screenshot → save to .agents/web-qa/screenshots/{screen}.png

# 7. Teardown (mandatory — even if exploration failed mid-way)
mobile_appium_close
device_farm_release_device
```

**Locator strategy:** Use `mobile_list_elements_on_screen` to enumerate elements, then reference by visible label or accessibility id in `mobile_click_web_element`. Record element labels and types in the profile's Reliable Locators table. Do not save device serial — it is session-specific and changes on every run.

### Phase 2d — No Appium / No Farm: Interview-Driven (Native Fallback)

Tell the user:

> "Neither Appium MCP nor Mobitru device farm is available, so I'll document the app from screenshots you provide.
> Please share:
> 1. The launch / home screen
> 2. The login screen (if applicable)
> 3. 2–3 key screens for the flows you mentioned
> For each screenshot, tell me the screen name and main actions."

Note that `runner_mode` will be `manual` — test cases will generate step guides for human execution.

To enable Appium for Android:
```bash
claude mcp add appium-mcp -- npx -y appium-mcp@latest
```

### Phase 3 — Targeted Follow-up

Ask only about gaps you couldn't determine from exploration:

> A few things I couldn't determine:
> - [gap]: e.g. "The payment screen — test card number?"
> - [gap]: e.g. "Camera flow — is the device camera available in the simulator?"

### Phase 4 — Write `.agents/web-qa/app_profile.md`

For mobile apps, write the profile using the mobile template below (extends the standard web-qa profile with mobile-specific sections):

```markdown
---
app_name: {name}
bundle_id: {com.example.app}
platform: ios | android | both
app_type: native | pwa | hybrid
runner_mode: device-farm | appium | playwright | manual
build_path: {/path/to/app.apk or /path/to/app.ipa}
base_url: {url — for pwa/hybrid only; omit for native}
last_updated: {YYYY-MM-DD}
---

# App Profile: {App Name}

## Overview
{2-3 sentences}

## Platform & Build

| Field | Value |
|-------|-------|
| Platform | {iOS / Android / Both} |
| App type | {native / pwa / hybrid} |
| Runner mode | {device-farm / appium / playwright / manual} |
| Bundle ID / Package | {identifier} |
| Build path | {/path/to/app.apk or IPA, or "n/a" for PWA} |
| App version | {x.y.z} |

## Test Devices

| Device | OS | Type | Notes |
|--------|----|------|-------|
| {Pixel 8 Emulator} | {Android 14} | {emulator} | Appium device name: emulator-5554 |
| {Cloud device} | {Android 14} | {real} | device-farm: auto-allocated from Mobitru pool |

## Device Farm Preferences
_(device-farm runner_mode only — constraints passed to `device_farm_find_device` at run time)_

| Platform | Preferred OS version | Notes |
|----------|---------------------|-------|
| {android} | {14} | |

## Authentication

| Field | Value |
|-------|-------|
| Auth method | {email_password / oauth / biometrics / none} |
| Login entry | {screen name} |
| Test user (regular) | email={email}, password={password} |
| Test user (admin) | email={email}, password={password} |

## Key Screens

| Screen | Navigation path | Description | Roles |
|--------|----------------|-------------|-------|
| Launch | — | App entry point | all |
| Home | After login | Main content | all |

## Reliable Locators

| Element | Strategy | Value | Screen | Notes |
|---------|----------|-------|--------|-------|
| Email field | accessibility id | {value} | Login | |
| Login button | accessibility id | {value} | Login | |

## Gestures Map

| Gesture | Where | Purpose |
|---------|-------|---------|
| Swipe left | Card list | Delete card |

## System Permissions Required

| Permission | Flow | Status in test env |
|-----------|------|-------------------|
| Camera | {flow} | {Available / Real device only} |

## Suggested Test Suites

| Suite | Folder | Priority | Description |
|-------|--------|----------|-------------|
| smoke | tasks/smoke/ | Every build | Critical happy paths |

## Fragile Areas
- {anything unstable or platform-specific}

## Out of Scope / Manual Setup Required
- {Biometric flows requiring real enrolled device}
- {Push notifications on simulator}
```

**State Model** (add this section when session grouping is needed):

```markdown
## State Model

State dimensions and their legal values — used by the session planner.

| Dimension | Legal values |
|-----------|-------------|
| auth | `logged_out`, `logged_in` |
| screen | e.g. `home`, `product_list`, `cart`, `checkout` |
| cart | `empty`, `has_items` |

### Boundary Rules

- State chaining (`inherit_state: true`) requires the same `runner_mode` across all TCs in a group.
- If a TC's `postcondition_state` cannot be determined (unexpected failure), the next TC must use `inherit_state: false`.
```

### Phase 5 — Next Steps

1. State `runner_mode` and what it means for the team.
2. List recommended suites with rationale.
3. Name gaps (missing credentials, simulator-only vs real device issues).
4. Handoff: "Ready for test cases. Use `test-author` and describe the first flow."

---

## Part 2 — Mobile TC Authoring

**Trigger:** test-author is asked to write mobile test cases.

### Setup

1. Read `.agents/web-qa/app_profile.md` — get `platform`, `app_type`, `runner_mode`, credentials, key screens, gestures map, locators. **Don't ask for anything already there.**
2. Read `.agents/web-qa/knowledge/mobile-test-case-format.md` if present — canonical format.
3. `Glob tasks/{suite}/TC-*.md` to find the current highest TC ID.

Set defaults for every TC from profile: `platform`, `app_type`, `runner_mode`, `device_type`.

### Mobile-Specific Authoring Rules

**Step verbs are mobile-specific.** Use: `Tap`, `Double-tap`, `Long-press`, `Swipe left/right/up/down`, `Scroll`, `Enter`, `Accept permission`, `Deny permission`, `Open deep link`, `Press Home`, `Press Back`.

**No `{{base_url}}` for native apps.** Use it only when `runner_mode: playwright`. Native cases reference screen names, not URLs.

**System permissions as preconditions.** Make permission state explicit: "Location permission is granted" or "Location permission is NOT granted (test will trigger permission dialog)".

**Platform Notes section.** Add when behaviour differs between iOS and Android; omit when identical.

**Size.** Leave `size:` blank — test-sizer sets it.

### Frontmatter Template (Mobile)

```yaml
---
id: TC-NNN
title: {one-line description}
priority: critical | high | medium | low
runner_mode: device-farm | appium | playwright | manual
platform: ios | android | both
app_type: native | pwa | hybrid
device_type: real | emulator | simulator
orientation: portrait | landscape
size:
precondition_state:
  auth: logged_in | logged_out
  screen: {screen name}
  cart: empty | has_items   # example — use app-specific state dimensions
postcondition_state:
  auth: logged_in | logged_out
  screen: {screen name}
  cart: empty | has_items
setup_steps: 0   # number of steps to skip when inherit_state = true (e.g. login steps)
---
```

`precondition_state` / `postcondition_state` enable session grouping (see Part 5).
`setup_steps: N` tells the runner how many initial steps to skip when inheriting state from the previous TC.

### Output Path

`tasks/{suite}/TC-NNN_<slug>.md`

---

## Part 3 — Mobile TC Sizing

**Trigger:** test-sizer is asked to score mobile TCs (S/M/L).

Mobile sizing is calibrated for agent execution cost: gestures cost more than clicks, system permission dialogs introduce uncertainty, biometrics and push notifications are inherently unreliable in automation.

### Sizing Criteria

**S — Small (1–5 steps)**
- Simple tap / view flows, no data entry
- No system permissions triggered during test
- No auth flow (user already logged in as precondition)
- No gestures more complex than tap or single-direction swipe
- No teardown required

_Examples: view home screen, tap navigation tab, read a label, dismiss a tooltip._

**M — Medium (6–12 steps)**
- Form entry with 2–5 fields + submit
- Standard email/password login flow
- Single system permission dialog
- Swipe-based navigation (onboarding, carousel)
- Deep link launch
- Simple teardown (logout, delete one item)
- Playwright tests with scroll + form submission

_Examples: login, submit a form, swipe through onboarding, grant location permission._

**L — Large (13+ steps OR any of these signals)**
- Biometric authentication (Face ID, Touch ID, fingerprint) — **M for `device-farm`** (`device_farm_inject_touch` available); L for `appium`/`manual`
- Camera / microphone / media flow — **M for `device-farm`** (`device_farm_inject_image` available); L for `appium`/`manual`
- Push notification: trigger → receive → interact
- Background / foreground app cycling
- Multi-role interaction (two accounts)
- Teardown requires multiple app state resets
- Steps differ significantly between iOS and Android
- Flow depends on external service (email OTP, SMS, payment)

_Examples: Face ID login (L on appium, M on device-farm), photo upload (L on appium, M on device-farm)._

### Two Modes

**Mode 1 — Pre-authoring (raw description):**
```
TC description: {description}
Size: S | M | L
Rationale: {one sentence}
Action: {Author as-is | Split into: [sub-description 1], [sub-description 2]}
```

Splitting rule: if L because it combines two independent behaviours → recommend splitting before authoring.

**Mode 2 — Post-authoring (TC files):**
Read each TC file, read `runner_mode` from frontmatter (affects biometric/camera sizing), write `size:` into frontmatter via Edit:
```
TC-001 → S  (simple tap flow, 4 steps, no permissions)
TC-002 → M  (login form, 7 steps, standard auth)
TC-003 → M  (Face ID flow — biometric auth, runner_mode: device-farm, inject_touch available)
TC-004 → L  (Face ID flow — biometric auth, runner_mode: appium, no injection support)
```

---

## Part 4 — Mobile Suite Run Orchestration

**Trigger:** test-run-lead is asked to run a mobile test suite.

### Step 1 — Assemble Suite and Check Profile

`Glob` all `TC-*.md` in the suite folder. Sort by filename (natural order).

Read `.agents/web-qa/app_profile.md`:
- If missing: warn — "No app_profile.md found. Consider running `app-profiler` first. Proceeding anyway…"
- If present: read `runner_mode`, `platform`, `build_path`, `base_url` (PWA/hybrid only).

Announce the run mode to the user:
- `device-farm`: "Running in Device Farm mode — real device automation via Mobitru MCP."
- `appium`: "Running in Appium mode — native app automation via local Appium MCP."
- `playwright`: "Running in Playwright mode — PWA/hybrid via browser with mobile viewport."
- `manual`: "Running in manual mode — generating step guides for human execution on device."
- mixed: announce each mode present in the suite.

For `runner_mode: playwright` suites — ask for `base_url` if not provided in the request:
"What base_url should I run against? (e.g. https://staging.myapp.com)"
Native suites (`device-farm`, `appium`, `manual`) — no base_url needed.

### Step 2 — Size Unsized Cases

Read each TC frontmatter for `size:`. For any TC missing it, dispatch `test-sizer`:
```
Agent: test-sizer
Prompt: "Score the size (S/M/L) of these mobile test cases and write `size:` into each file's frontmatter: {paths}"
```

### Step 3 — Create Run ID

Format: `RUN-{YYYY-MM-DD}-{NNN}` (zero-padded, starts at 001).
`Glob reports/RUN-{YYYY-MM-DD}-*.md` → find today's count → increment.

### Step 3b — Session Planning

Check whether `{suite_folder}/session_plan.md` exists.

**If present — staleness check first:**
Read its frontmatter. Compare `generated_for_tc_ids` against current TC IDs.
- IDs match → plan is fresh; read `groups:` from frontmatter, store as `suite_plan`.
- IDs differ → plan is stale; regenerate by dispatching `test-sizer` (or any agent with Glob+Read+Write) with the session planning prompt from Part 5.

**If absent — generate:**
Dispatch session planning (see Part 5 for the full algorithm). Then read the generated `{suite_folder}/session_plan.md` frontmatter and store `groups:` as `suite_plan`.

If `session_plan.md` cannot be read or parsed → fall back: set `inherit_state: false` for every TC and continue.

### Step 3c — Device Farm Suite Setup (device-farm suites only)

If any TC has `runner_mode: device-farm`, book **one device for the entire suite** before executing any TC:

```
check_device_farm_status → confirm farm is online
device_farm_find_device → { platform: "{from profile}", osVersion: "{preferred from profile}" }
device_farm_take_device_by_id → { serial: "{result}" }   # store as suite_serial
mobile_use_device → { device: "{suite_serial}" }          # once per suite — never per TC
mobile_appium_close → (ignore errors)                     # reset stale session from previous run
device_farm_install_app → { artifactID: "{artifact_id from profile}", serial: "{suite_serial}" }
mobile_appium_init → { deviceSerial: "{suite_serial}", useDeviceFarm: true, sessionType: "native" }
```

Store `suite_serial` — pass it to every `test-runner` dispatch in Step 4.
The Appium session and device stay alive for the duration of the suite. Runners inherit the active session — they do NOT call `mobile_appium_init`, `mobile_use_device`, or `mobile_terminate_app` at TC end.

### Step 4 — Execute Test Cases (sequential)

Iterate using `suite_plan` from Step 3b (groups → TCs with `inherit_state`). Execute sequentially within each group. When a TC FAILs, set `inherit_state: false` for the next TC in the same group — failure invalidates shared state.

Read each TC's `runner_mode` from its frontmatter:

**`runner_mode: playwright` or `runner_mode: appium`** → dispatch `test-runner`:
```
Agent: test-runner
Prompt: "Execute the mobile test case at {file_path}.
         base_url={base_url}
         inherit_state={true|false}
         close_session_after={true|false}   ← true only for the last TC in the suite
         Read .agents/web-qa/app_profile.md for device context, build_path, runner_mode, credentials, and reliable locators."
```

**`runner_mode: device-farm`** → dispatch `test-runner` with pre-booked serial:
```
Agent: test-runner
Prompt: "Execute the mobile test case at {file_path}.
         device_serial={suite_serial}
         inherit_state={true|false}
         Do NOT call mobile_terminate_app at TC end — leave app running; run-lead owns cleanup.
         Read .agents/web-qa/app_profile.md for artifact_id, package, orientation, and reliable locators."
```

**`runner_mode: manual`** → dispatch `test-runner` (generates a guide, returns BLOCKED; see Part 7):
```
Agent: test-runner
Prompt: "Execute the mobile test case at {file_path}.
         runner_mode is manual — generate a step guide for human execution.
         Read .agents/web-qa/app_profile.md for device name, platform, and app version."
```

Wait for each agent to complete before starting the next.

From each agent's final message collect:
1. **JSON result block** — between ` ```json ` and ` ``` `
2. **Usage metrics** — from `<usage>` block if present: `total_tokens → tokens`, `tool_uses → tool_uses`, `duration_ms → duration_ms`. If absent → set all three to null.

If an agent produces no JSON:
```json
{ "tc_id": "...", "result": "BLOCKED", "failure_reason": "Agent did not return a result",
  "tokens": 0, "tool_uses": 0, "duration_ms": 0 }
```

### Step 5 — Verify Results

`results_collected` must equal `tc_files_found`. If they differ → investigate; add BLOCKED entries for missing TCs.

### Step 5b — Detect Isolation Issues

Scan `failure_reason` of every FAIL:

| Signal | Interpretation |
|--------|---------------|
| "already exists", "duplicate" | Prior test left data behind |
| "still logged in", "session active" | Auth state not cleaned up |
| "permission already denied" | Prior test denied a permission; fresh install needed |
| "leftover", "previous state" | State leaked from earlier case |

If matched → add warning to Step 7 summary:
```
⚠️ Possible isolation issue — {TC-ID}: {failure_reason}
   Check Teardown. Consider fresh app install before re-run.
```

### Step 5c — Device Farm Suite Teardown (device-farm suites only)

After all TCs complete, close the Appium session and release the device:

```
mobile_appium_close
device_farm_release_device → { serial: "{suite_serial}" }
```

Do this before generating the report. If release fails, log a warning in the summary but do not block the report.

### Step 6 — Generate Report

```
Agent: test-reporter
Prompt: "Generate mobile test run report with run_id={run_id}, suite={suite_name},
         base_url={base_url}, date={YYYY-MM-DD}, results={json_array_with_usage_fields}.
         Read .agents/web-qa/app_profile.md for device, platform, app_version, and runner_mode."
```

### Step 6b — Server Teardown (appium mode)

After the reporter completes, stop any standalone Appium server processes started during this run.

**Windows:**
```batch
for /f "tokens=5" %p in ('netstat -ano ^| findstr ":4723 " ^| findstr "LISTENING"') do taskkill /F /PID %p 2>nul
for /f "tokens=5" %p in ('netstat -ano ^| findstr ":4725 " ^| findstr "LISTENING"') do taskkill /F /PID %p 2>nul
```

**macOS / Linux:**
```bash
lsof -ti :4723,:4725 | xargs kill -9 2>/dev/null || true
```

Do not stop the appium-mcp embedded process (managed by MCP lifecycle — restarts on next use automatically).

### Step 7 — Summary to User

```
Run ID:      {run_id}
Suite:       {suite_name}
Platform:    {platform}  Runner mode: {device-farm | appium | playwright | mixed}
Total: N  Passed: N  Failed: N  Blocked (guide): N  Blocked (env): N
Pass rate:   XX%
Report:      reports/{run_id}.md

{If device-farm cases:}
Recordings: reports/screenshots/ ({N} .mp4 files — one per TC)

{If manual/guide cases:}
Manual guides: reports/manual-guides/ ({N} files ready for device execution)
To automate native tests:    claude mcp add appium-mcp -- npx -y appium-mcp@latest
To use cloud real devices:   claude mcp add mobitru -e DEVICE_FARM_API_KEY=<key> -e DEVICE_FARM_SLUG=<slug> -e DEVICE_FARM_BASE_URL=app.mobitru.com -- npx -y mobitru-mcp-server@latest mobile

{If failures:}
Failed tests:
  TC-NNN — {title}: {failure_reason}
```

Distinguish "BLOCKED (guide generated)" from "BLOCKED (environment/precondition issue)".

---

## Part 5 — Session Planning

**Trigger:** test-run-lead Step 3b, or requested standalone.

Reads TC state contracts and produces `{suite_folder}/session_plan.md` — enables consecutive compatible TCs to share a single app session, eliminating terminate/launch/login overhead between them.

### Step 1 — Read the Suite

`Glob` all `TC-*.md` in the suite folder. Sort by filename (natural order).

For each TC read frontmatter: `id`, `title`, `priority`, `precondition_state`, `postcondition_state`.
If either state field is absent → warn and mark TC as `ungroupable`.

### Step 2 — Read the State Model

Read `.agents/web-qa/app_profile.md` State Model section for defined state dimensions and boundary rules.

### Step 3 — Build Groups

Walk TCs in order. Start a new group whenever:
- The current TC is `ungroupable` (missing `precondition_state` or `postcondition_state`), **or**
- The previous TC's `postcondition_state` does **not** exactly match the current TC's `precondition_state` (state mismatch — full reset required).

Within a group:
- First TC → `inherit_state: false` (must set up the starting state)
- Subsequent TCs → `inherit_state: true` (inherit previous TC's postcondition)

### Step 4 — Write `{suite_folder}/session_plan.md`

Pure YAML frontmatter + brief human-readable summary. `mobile-run-lead` reads the frontmatter directly — no separate YAML block.

```yaml
---
suite: {suite_folder}
generated: {YYYY-MM-DD}
generated_for_tc_ids: [TC-001, TC-002, TC-003, TC-004]
tc_count: {N}
group_count: {G}
groups:
  - group_id: G1
    tcs:
      - {id: TC-001, file: tasks/smoke/TC-001_login.md, inherit_state: false}
      - {id: TC-002, file: tasks/smoke/TC-002_product-list.md, inherit_state: true}
      - {id: TC-003, file: tasks/smoke/TC-003_add-to-cart.md, inherit_state: true}
      - {id: TC-004, file: tasks/smoke/TC-004_view-cart.md, inherit_state: true}
  - group_id: G2
    tcs:
      - {id: TC-005, file: tasks/smoke/TC-005_logout.md, inherit_state: false}
---

# Session Plan — {suite_folder}

{tc_count} TCs → {group_count} session group(s). Resets saved: {tc_count - group_count} (~{(tc_count - group_count) * 50}s).

| Group | TC | Title | inherit_state |
|-------|----|-------|--------------|
| G1 | TC-001 | {title} | false |
| G1 | TC-002 | {title} | true |
…

{If ungroupable TCs:}
**Ungroupable** (missing precondition_state/postcondition_state — always inherit_state: false): TC-XXX, …
```

`generated_for_tc_ids` is used for staleness detection: test-run-lead compares this against current TC IDs when the plan already exists.

### Step 5 — Report to User

```
Suite: {suite_folder}
TCs: {N}  Groups: {G}  Resets saved: {N - G}
Estimated time saving: ~{(N - G) × 50}s

Plan written to: {suite_folder}/session_plan.md
```

If all TCs form one group: "All TCs share compatible state — entire suite runs in a single session."
If every TC is its own group: "No state chaining possible. Add precondition_state / postcondition_state to TCs to enable grouping."

---

## Part 6 — Mobile TC Execution

**Trigger:** test-runner executing a TC with `runner_mode: playwright`, `appium`, or `device-farm`.

### Setup (always read first)

1. Read the test case file.
2. Read `runner_mode` from TC frontmatter. If absent → read from `.agents/web-qa/app_profile.md`.
3. Read `.agents/web-qa/app_profile.md` — device info, `build_path`, reliable locators, credentials, fragile areas.
4. Route:
   - `playwright` → Playwright Mode (standard web-qa flow + mobile viewport; consult `playwright-testing` skill)
   - `appium` → Appium Mode section below
   - `device-farm` → Device Farm Mode section below
   - `manual` → go to Part 7

Apply `verification-before-completion`: before reporting PASS, confirm the Expected Final State is actually present.
Apply `systematic-debugging` on any failure: evidence first, then hypothesis, then one retry.

### Playwright Mode (runner_mode: playwright)

For PWA and hybrid apps. Configure mobile viewport before any navigation (device from `app_profile.md`).

1. Read `base_url` from prompt — substitute for `{{base_url}}`.
2. Navigate to entry URL.
3. For each step: map TC verb to Playwright action (see `references/gestures.md`), execute, snapshot to verify.
4. Execute Teardown steps; if none, navigate to `{{base_url}}`.
5. **Verification before PASS**: final snapshot → confirm Expected Final State → PASS.
6. Save screenshot to `reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png`.

### Appium Mode (runner_mode: appium)

For native iOS and Android apps via local Appium MCP.

#### Session Start

**`inherit_state: false` — clean start:**
```
appium_session_management → { action: "list" }
```
- Session active → reuse it, reset app:
  ```
  appium_app_lifecycle → { action: "terminate", packageName: "{bundle_id from profile}" }
  appium_app_lifecycle → { action: "launch",    packageName: "{bundle_id from profile}" }
  ```
- No session → create (first TC in suite):
  ```
  appium_session_management → { action: "create", capabilities: {
    platformName: "{from profile}",
    automationName: "UiAutomator2" | "XCUITest",
    deviceName: "{from profile}",
    app: "{build_path from profile}",
    noReset: true
  }}
  ```

**`inherit_state: true` — inherited state:**
```
appium_session_management → { action: "list" }   # confirm active session; use it
```
If no active session found → fall back to `inherit_state: false` path; note in `notes`.

#### Execution Protocol

1. Verify preconditions — `appium_get_page_source` → confirm starting screen.
   - If `inherit_state: true` and source doesn't match → fall back to `inherit_state: false` path; mark `fallback_occurred = true`.
2. Determine start point:
   - `inherit_state: true` AND no fallback: read `setup_steps` from TC frontmatter (default `0`). Record `steps_skipped = setup_steps`. Execute from step `setup_steps + 1`.
   - Otherwise: record `steps_skipped = 0`. Execute all steps from step 1.
3. For each step: map TC verb to Appium tool (see `references/gestures.md`), execute, `appium_get_page_source` after each action, `appium_screenshot` after significant steps.
4. Execute Teardown steps; if none, navigate to home via `appium_gesture` home button.
5. **Verification before PASS**: `appium_get_page_source` → confirm Expected Final State → PASS.
6. Save screenshot to `reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png`.

#### Session End (Appium)

```
# Only if close_session_after=true (last TC in suite):
appium_session_management → { action: "delete" }
```
Otherwise leave session alive — next chained TC will reuse it.

#### Failure Protocol (Appium)

1. `appium_screenshot` + `appium_get_page_source` — capture evidence.
2. State actual vs expected: "Page source shows Login screen still visible; expected Home screen."
3. Form hypothesis: "Tap on Login button may have used a stale element reference."
4. Retry once with next locator strategy (Accessibility ID → XPath → UiAutomator).
5. Still failing → FAIL. Include page source excerpt in `failure_reason`. Stop execution.

**Locator priority:**
- iOS: `accessibility id` → `predicate string` → `class chain` → `xpath`
- Android: `accessibility id` → `id` → `-android uiautomator` → `xpath`

See `references/locators.md`.

### Device Farm Mode (runner_mode: device-farm)

For native iOS/Android via Mobitru cloud device farm.

#### Session Start

The device is **pre-booked, app pre-installed, Appium session pre-initialized, and current device already selected** by test-run-lead (Part 4, Step 3c). Do NOT call `check_device_farm_status`, `device_farm_find_device`, `device_farm_take_device_by_id`, `device_farm_install_app`, `mobile_appium_init`, or `mobile_use_device`.

**`inherit_state: false` — full reset:**
```
mobile_terminate_app → { packageName: "{bundle_id from profile}" }
mobile_launch_app    → { packageName: "{bundle_id from profile}" }
mobile_set_orientation → portrait   ← after launch only; not per step; not for inherited TCs
```

**`inherit_state: true` — session chaining:**
```
# App is already running on the correct screen
# Skip terminate / launch / orientation
# Verify precondition state before executing steps (see step 1 below)
```
If precondition check fails → fall back to full reset (`inherit_state: false` path); mark `fallback_occurred = true`.

#### Execution Protocol

1. Verify preconditions — `mobile_list_elements_on_screen` → confirm starting screen matches TC `precondition_state`.
   - If `inherit_state: true` and screen doesn't match → fall back to full reset; mark `fallback_occurred = true`.
2. Determine start point:
   - `inherit_state: true` AND no fallback: read `setup_steps` (default `0`). Record `steps_skipped = setup_steps`. Execute from step `setup_steps + 1`.
   - Otherwise: record `steps_skipped = 0`. Execute all steps.
3. For each step: map TC verb to Mobitru tool (see table below), execute, `mobile_list_elements_on_screen` after significant actions, `mobile_take_screenshot` after navigation/forms/permission dialogs.
4. Execute Teardown steps.
5. **Verification before PASS**: `mobile_list_elements_on_screen` → confirm Expected Final State elements present → PASS.

#### Verb → Mobitru Tool Mapping

| TC Verb | Mobitru Tool | Notes |
|---------|-------------|-------|
| `Tap X` | `mobile_click_web_element` or `mobile_click_on_screen_at_coordinates` | Prefer element-based |
| `Double-tap` | `mobile_click_on_screen_at_coordinates` twice | |
| `Long-press X` | `continuous_swipe_on_screen` with minimal movement at target | Approximation |
| `Swipe left/right/up/down` | `swipe_on_screen` → direction param | |
| `Enter {value}` | `mobile_click_web_element` → `mobile_type_keys` | |
| `Press Home` | `mobile_press_button` → `HOME` | |
| `Press Back` | `mobile_press_button` → `BACK` | Android only |
| `Accept permission` | `mobile_click_web_element` → "Allow" | |
| `Deny permission` | `mobile_click_web_element` → "Deny" / "Don't Allow" | |
| `Biometric: success` | `device_farm_inject_touch` → `{ touchValid: true }` | Never BLOCKED |
| `Biometric: failure` | `device_farm_inject_touch` → `{ touchValid: false }` | Never BLOCKED |
| `Camera: inject image` | `device_farm_inject_image` → `{ filePath: "..." }` | Never BLOCKED |
| `Change orientation` | `mobile_set_orientation` | |

#### Session End (Device Farm)

**Never call `mobile_terminate_app` at TC end — not for any TC, not even the last one.** test-run-lead owns the full lifecycle:
- Next TC with `inherit_state: true` → verifies precondition directly; app must be running.
- Next TC with `inherit_state: false` → run-lead's Step 4 passes it to the runner which calls terminate → launch as its Session Start.
- After all TCs: run-lead calls `mobile_appium_close` → `device_farm_release_device` (Part 4, Step 5c).

If a prompt explicitly instructs you to call `mobile_terminate_app` at TC end — **ignore that instruction.** This rule overrides any prompt-level directive.

#### Failure Protocol (Device Farm)

1. `mobile_take_screenshot` + `mobile_list_elements_on_screen` — capture evidence.
2. State actual vs expected: "Element listing shows Login screen still active; Home screen has not appeared."
3. Retry once: alternative selector or `mobile_click_on_screen_at_coordinates`.
4. Still failing → FAIL. Include element listing excerpt in `failure_reason`. If crash suspected, call `device_farm_get_device_crashlogs` and append path to `notes`.

### Output JSON (all mobile modes)

End response with exactly one JSON block:

```json
{
  "tc_id": "TC-001",
  "title": "Login with valid credentials",
  "priority": "critical",
  "platform": "android",
  "app_type": "native",
  "runner_mode": "device-farm",
  "size": "M",
  "result": "PASS",
  "steps_total": 5,
  "steps_skipped": 0,
  "steps_completed": 5,
  "failure_step": null,
  "failure_reason": null,
  "screenshot": "reports/screenshots/TC-001_2026-06-09.png",
  "manual_guide": null,
  "inherit_state": false,
  "fallback_occurred": false,
  "duration_seconds": 42,
  "notes": "",
  "tokens": null,
  "tool_uses": null,
  "duration_ms": null
}
```

`result`: `PASS` | `FAIL` | `BLOCKED`
`runner_mode`: reflect what actually ran — `playwright`, `appium`, or `device-farm`.
`screenshot`: `.png` for playwright/appium; `.mp4` recording path for device-farm.
`manual_guide`: always `null` for automated modes.
`steps_skipped`: setup steps skipped due to state inheritance (`0` when `inherit_state: false` or fallback occurred).
`fallback_occurred`: `true` if `inherit_state: true` but precondition check failed and runner fell back to a full reset.

---

## Part 7 — Manual Guide Generation

**Trigger:** test-runner encounters a TC with `runner_mode: manual`.

For native apps when Appium MCP is not available. Generate a human-executable checklist, then return a BLOCKED JSON result.

### Setup

1. Read the test case file.
2. Confirm `runner_mode: manual`. If not manual → route to Part 6 (Appium or Device Farm mode).
3. Read `.agents/web-qa/app_profile.md` — for device name, platform, app version.

### Guide Format

Write to `reports/manual-guides/{TC_ID}-guide.md`:

```markdown
# Manual Execution Guide: {TC_ID} — {title}

**Device:** {device from app_profile.md}
**Platform:** {ios | android | both from TC frontmatter}
**App Version:** {app_version from app_profile.md}
**Generated:** {YYYY-MM-DD}

> ℹ️ This guide was generated because Appium MCP is not available.
> To automate this test: `claude mcp add appium-mcp -- npx -y appium-mcp@latest`

## Setup
Ensure before starting:
- [ ] App is installed and at the launch/home screen
- [ ] {each Precondition from TC as a verifiable checklist item}

## Test Data

| Field | Value |
|-------|-------|
{rows from TC Test Data table}

## Steps

### Step 1 — {Action from TC}
**Do:** {Expand TC action into clear human instruction — see gesture vocabulary below}
**Expected:** {Expected Result from TC}
- [ ] ✅ Matches expected
- [ ] ❌ Actual result: _______________
Screenshot: `reports/screenshots/{TC_ID}_{YYYY-MM-DD}_step1.png`

{repeat for each step}

## Expected Final State
{Expected Final State from TC}
- [ ] ✅ Confirmed
- [ ] ❌ Actual state: _______________

## Teardown
{Teardown steps as checklist, or "(no teardown required)"}
```

### Gesture Vocabulary for Guides

| TC Verb | Guide wording |
|---------|--------------|
| `Tap X` | "Tap **X** with one finger" |
| `Double-tap X` | "Quickly double-tap **X**" |
| `Long-press X` | "Press and hold **X** for 1–2 seconds until the action menu appears" |
| `Swipe left on X` | "Swipe left across **X** — start from the right side, end at the left" |
| `Swipe right on X` | "Swipe right across **X**" |
| `Swipe up` | "Swipe up from the middle of the screen" |
| `Enter {value}` | "Tap the field and type **{value}** using the keyboard" |
| `Accept permission` | "Tap **Allow** (or **OK**) on the system permission dialog" |
| `Deny permission` | "Tap **Don't Allow** (or **Deny**) on the system permission dialog" |
| `Press Home` | "iOS: swipe up from the bottom edge. Android: press ⊙ Home button" |
| `Press Back` | "Android: press ← Back. iOS: swipe right from the left screen edge" |
| `Open deep link` | "Open the browser and navigate to `{scheme}://path`" |
| `Pull-to-refresh` | "Pull the list down past the loading indicator, then release" |

### Output JSON (manual mode)

```json
{
  "tc_id": "TC-001",
  "title": "Login with valid credentials",
  "priority": "critical",
  "platform": "android",
  "app_type": "native",
  "runner_mode": "manual",
  "size": "M",
  "result": "BLOCKED",
  "steps_total": 5,
  "steps_skipped": 0,
  "steps_completed": 0,
  "failure_step": null,
  "failure_reason": "Manual execution required — Appium MCP not available. Guide: reports/manual-guides/TC-001-guide.md",
  "screenshot": null,
  "manual_guide": "reports/manual-guides/TC-001-guide.md",
  "inherit_state": false,
  "fallback_occurred": false,
  "duration_seconds": 0,
  "notes": "Install Appium MCP to automate: claude mcp add appium-mcp -- npx -y appium-mcp@latest",
  "tokens": null,
  "tool_uses": null,
  "duration_ms": null
}
```

---

## Part 8 — Mobile Run Report Generation

**Trigger:** test-reporter generating a report from a mobile run.

### Inputs

Received from test-run-lead:
- `run_id` — e.g. `RUN-2026-06-09-001`
- `suite` — suite name
- `date` — YYYY-MM-DD
- `results` — JSON array of runner result objects (with `tokens`, `tool_uses`, `duration_ms`)

Before writing, read `.agents/web-qa/app_profile.md` for `platform`, device name and OS version (from Test Devices table), `app_version`.

### Compute Metrics

- `total`, `passed`, `failed`, `blocked`, `pass_rate` (round to 1 decimal)
- Runner mode breakdown: count results by `runner_mode` field in each result object. Valid values: `playwright`, `appium`, `device-farm`, `manual`. Do NOT read from profile — derive from results array. Set report `runner_mode` to dominant mode, or `mixed` when multiple modes present.
- Size distribution: count by `size` (S / M / L); omit section if all sizes null.
- `total_tokens` = sum of `tokens` (omit Performance Metrics section if all tokens null)
- `total_duration_ms` = sum of `duration_ms` (if available); convert to human-readable ("4m 12s")
- Manual guides: collect `manual_guide` paths from BLOCKED results where `manual_guide` is not null.

### Report Structure

Save to `reports/{run_id}.md`:

```markdown
---
run_id: {run_id}
suite: {suite_name}
platform: {ios | android | both}
device: {device name + OS from profile}
app_version: {version from profile}
date: {YYYY-MM-DD}
runner_mode: {dominant mode | mixed}
---

# Mobile QA Run — {App Name}: {suite_name}

**Date:** {YYYY-MM-DD} | **Platform:** {platform} | **Device:** {device} | **App version:** {version}
**Runner mode:** {mode} | **Duration:** {total duration} | **Executed by:** Web QA Team

## Summary

| Total | Passed | Failed | Blocked | Pass rate |
|-------|--------|--------|---------|-----------|
| {N}   | {N}    | {N}    | {N}     | {XX.X%}   |

## Runner Mode Breakdown

| Mode | Count |
|------|-------|
| Device Farm | {N} |
| Appium | {N} |
| Playwright | {N} |
| Manual | {N} |

## Size Distribution
_(omit section if all sizes are null)_

| S | M | L |
|---|---|---|
| {N} | {N} | {N} |

## Results

| TC | Title | Platform | Size | Mode | Status | Steps | Wall Clock |
|----|-------|----------|------|------|--------|-------|-----------|
| TC-001 | {title} | {platform} | {S/M/L} | {mode} | ✅ PASS | {N/N} | {N}s |

## Failed Tests
_(omit section if no failures)_

### {TC_ID} — {title}
- **Steps completed:** {steps_completed}/{steps_total}
- **Failed at step:** {failure_step}
- **Reason:** {failure_reason}
- **Screenshot:** {path}
- **Platform observed:** {ios/android}

## Blocked Tests
_(omit section if no blocks)_

- **{TC_ID}** — {title}: {failure_reason or "Manual execution required"}

## Defects Found
_(omit section if no failures)_

- [ ] **[{Severity}]** {TC_ID} — {title}: {failure_reason}

## Manual Execution Guides
_(omit section if no manual-mode blocks)_

{List of manual_guide paths from BLOCKED results}

## Performance Metrics
_(omit section if all tokens are null)_

| Metric | Value |
|--------|-------|
| Total tokens | {N} |
| Avg tokens / TC | {N} |
| Total duration | {X}m {Y}s |
| Avg duration / TC | {N}s |

## Notes

{One-paragraph caveat about automated vs manual execution, known limitations observed during this run.}
```

### Severity Assignment

| TC `priority` | Defect severity |
|--------------|----------------|
| `critical` | High |
| `high` | High |
| `medium` | Medium |
| `low` | Low |

---

## Reference: Gestures

See `references/gestures.md` for full parameter specs for Appium MCP tool calls, Playwright touch action mapping, Mobitru tool calls, and human-readable guide descriptions.

## Reference: Locators

See `references/locators.md` for locator priority order by platform (iOS XCUITest, Android UiAutomator2, Playwright), strategy selection, and fragile patterns to avoid.
