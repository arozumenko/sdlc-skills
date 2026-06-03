---
name: mobile-testing
description: Mobile app test execution patterns for QA agents. Covers three modes: Playwright MCP with mobile viewport (PWA/hybrid), Appium MCP for native iOS/Android automation, and manual guide generation (fallback when Appium is not available). Use when running mobile test cases, choosing locator strategies for mobile, or handling mobile-specific interactions (gestures, permissions, deep links, APK/IPA install).
license: Apache-2.0
compatibility: "Playwright mode: Node.js 18+, @playwright/mcp. Appium mode: Node.js 22+, JDK 8+, appium-mcp, Android SDK (Android) or macOS+Xcode (iOS). Manual mode: no additional tooling."
metadata:
  authors:
    - Olha Stetsenko1 <Olha_Stetsenko1@epam.com>
  version: "0.2.0"
---

# Mobile Testing

Mobile app test execution for QA agents. Three modes depending on `app_type` and available tooling.

## Mode Selection

| `app_type` in profile | `runner_mode` | Execution method |
|-----------------------|---------------|-----------------|
| `pwa` | `playwright` | Playwright MCP — mobile viewport + touch emulation |
| `hybrid` | `playwright` | Playwright MCP for web views |
| `native` (Appium available) | `appium` | Appium MCP — real native automation via XCUITest / UiAutomator2 |
| `native` (no Appium) | `manual` | mobile-guide-writer generates a step-by-step guide; human executes on device |

Always read `runner_mode` from the test case frontmatter. If missing, read `app_type` from `.agents/mobile-qa/app_profile.md`.

---

## Playwright Mode (PWA / Hybrid)

Drive the browser through the Playwright MCP with mobile viewport and touch emulation.

### Core Loop

1. Navigate to the URL (substitute `{{base_url}}`).
2. **Snapshot the page** — accessibility tree + element refs before acting.
3. Interact: tap (click), swipe (drag), fill form.
4. Wait for expected condition (element appears, navigation settles).
5. Re-snapshot → collect evidence: screenshot + console messages.

### Mobile Viewport

Instruct the Playwright MCP to emulate a mobile device before any navigation:

| Device preset | Viewport | Touch |
|--------------|----------|-------|
| iPhone 15 | 393×852 | enabled |
| Pixel 8 | 412×915 | enabled |
| iPad Pro | 1024×1366 | enabled |

### Touch Action Mapping (Playwright)

| TC step verb | Playwright MCP action |
|-------------|-----------------------|
| Tap | `click` |
| Double-tap | `dblclick` |
| Long-press | `hover` + wait 1000ms |
| Swipe | `drag` with start/end coordinates |
| Scroll | `wheel` or drag |
| Accept dialog | `handle_dialog` → accept |
| Dismiss dialog | `handle_dialog` → dismiss |

See `references/gestures.md` for coordinate-based swipe patterns.

---

## Appium Mode (Native iOS / Android)

Drive the native app via Appium MCP. Tool names follow the `mcp__appium-mcp__*` prefix convention.

### Session Lifecycle

```
# 1. Select device
select_device → list available simulators/emulators/real devices → pick target

# 2. Install and launch app (APK or IPA)
appium_app_lifecycle → { action: "install", app: "/path/to/app.apk" }
appium_session_management → { action: "create", capabilities: { ... } }

# 3. Execute test steps
# 4. Teardown
appium_app_lifecycle → { action: "terminate" }
appium_session_management → { action: "delete" }
```

### Appium Capabilities (from app_profile.md)

```json
{
  "platformName": "Android",
  "appium:automationName": "UiAutomator2",
  "appium:deviceName": "emulator-5554",
  "appium:app": "/path/to/app.apk",
  "appium:noReset": false
}
```

For iOS:
```json
{
  "platformName": "iOS",
  "appium:automationName": "XCUITest",
  "appium:deviceName": "iPhone 15 Pro",
  "appium:platformVersion": "17.4",
  "appium:app": "/path/to/app.ipa",
  "appium:noReset": false
}
```

### Core Interaction Loop (Appium)

1. **Get page source** — `appium_get_page_source` — XML UI tree (equivalent of Playwright snapshot).
2. **Find element** — `appium_find_element` with locator strategy (see `references/locators.md`).
3. **Interact** — `appium_gesture`, `appium_set_value`, `appium_alert`.
4. **Screenshot** — `appium_screenshot` after each significant step.
5. **Verify** — `appium_get_text` or `appium_get_page_source` to confirm expected state.

### Appium Tool Reference

| Tool | When to use |
|------|------------|
| `select_device` | Session start — pick simulator/emulator/real device |
| `appium_session_management` | Create, switch, delete sessions |
| `appium_app_lifecycle` | Install APK/IPA, launch, terminate, clear app data |
| `appium_get_page_source` | **Primary verification** — get full UI XML tree |
| `appium_find_element` | Locate an element by Accessibility ID, XPath, etc. |
| `appium_gesture` | Tap, swipe, scroll, long-press, pinch |
| `appium_drag_and_drop` | Drag one element onto another |
| `appium_set_value` | Enter text into a focused field |
| `appium_get_text` | Read text content of an element |
| `appium_alert` | Accept or dismiss system alert / permission dialog |
| `appium_mobile_permissions` | Grant or revoke app permissions (Android) |
| `appium_screenshot` | Capture screen as PNG evidence |
| `appium_orientation` | Get or set portrait/landscape |
| `appium_mobile_device_control` | Lock/unlock screen, open notifications shade |
| `appium_mobile_device_info` | Device metadata, battery, OS version |
| `generate_locators` | Auto-generate reliable locators for current screen |

See `references/gestures.md` for gesture parameters and `references/locators.md` for locator strategy.

### Appium Failure Protocol

When a step fails:
1. `appium_screenshot` + `appium_get_page_source` — capture evidence
2. State actual vs expected in one sentence
3. Try next locator strategy (Accessibility ID → XPath → class chain)
4. If still failing → FAIL and stop; include page source excerpt in failure_reason

---

## Manual Mode (Fallback — no Appium)

For native apps when Appium MCP is not installed. Handled by `mobile-guide-writer` agent (not the runner).

The guide-writer reads the TC file and generates `reports/manual-guides/{TC_ID}-guide.md` — a human-executable checklist. The runner returns `result: "BLOCKED"` with `manual_guide` path.

To enable Appium and eliminate manual mode for Android:
```bash
claude mcp add appium-mcp -- npx -y appium-mcp@latest
# Set ANDROID_HOME in your environment
# Then re-run mobile-app-profiler to update runner_mode: manual → appium
```

For iOS on macOS:
```bash
# macOS only — requires Xcode
xcode-select --install
claude mcp add appium-mcp -- npx -y appium-mcp@latest
```

---

## Evidence Collection

After every significant step (all modes):
1. **Screenshot** — `appium_screenshot` (native) or Playwright screenshot — save to `reports/screenshots/{TC_ID}_{YYYY-MM-DD}_step{N}.png`
2. **Page source / snapshot** — `appium_get_page_source` (native) or Playwright snapshot (web)
3. **Notes** — any observation not captured visually

See `references/gestures.md` and `references/locators.md` for deeper reference.
