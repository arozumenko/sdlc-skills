---
name: mobile-testing
description: Mobile app test execution patterns for QA agents. Covers two modes: Playwright MCP with mobile viewport emulation (PWA/hybrid apps) and guided manual execution (native iOS/Android apps). Use when running mobile test cases, choosing locator strategies for mobile, or handling mobile-specific interactions (gestures, permissions, deep links).
license: Apache-2.0
compatibility: Playwright mode requires Node.js 18+ and @playwright/mcp. Manual mode requires no additional tooling.
metadata:
  authors:
    - Olha Stetsenko1 <Olha_Stetsenko1@epam.com>
  version: "0.1.0"
---

# Mobile Testing

Mobile app test execution for QA agents. Two modes depending on `app_type` in the app profile.

## Mode Selection

| `app_type` in profile | `runner_mode` | Execution method |
|-----------------------|---------------|-----------------|
| `pwa` | `playwright` | Playwright MCP — mobile viewport + touch emulation |
| `hybrid` | `playwright` | Playwright MCP for web views; manual for native screens |
| `native` | `manual` | Generate step-by-step guide; human executes on device |

Always read `runner_mode` from the test case frontmatter. If missing, read `app_type` from `.agents/mobile-qa/app_profile.md`.

---

## Playwright Mode (PWA / Hybrid)

Drive the browser through the Playwright MCP with mobile viewport and touch emulation.

### Core Loop

1. Navigate to the URL (substitute `{{base_url}}` with the real URL).
2. **Snapshot the page** — get the accessibility tree + element refs before acting.
3. Interact using touch-aware actions: tap (click), swipe (drag), fill form.
4. Wait for expected condition (element appears, navigation settles).
5. Re-snapshot → collect evidence: screenshot + console messages.

### Mobile Viewport Configuration

Instruct Playwright MCP to emulate a mobile device. Prefer named device presets:

| Device | Viewport | Touch | User-Agent |
|--------|----------|-------|------------|
| iPhone 15 | 393×852 | enabled | Safari/iOS |
| Pixel 8 | 412×915 | enabled | Chrome/Android |
| iPad Pro | 1024×1366 | enabled | Safari/iPadOS |

Set viewport at session start, before any navigation. Use the `evaluate` tool if the MCP doesn't expose a direct device preset option:

```js
// Set mobile viewport via evaluate (fallback)
Object.defineProperty(navigator, 'userAgent', { value: '<mobile UA>' });
```

### Locator Strategy (PWA/Hybrid)

Prefer in order: `data-testid` → ARIA role → visible text → `name` attribute → CSS class → XPath.

Mobile web apps often use different selectors than desktop — check for `data-mobile-*` test IDs and aria-labels on touch targets.

### Touch Action Mapping

| TC step verb | Playwright MCP action |
|-------------|-----------------------|
| Tap | `click` (Playwright handles touch when touch is enabled) |
| Double-tap | `dblclick` |
| Long-press | `hover` + wait 1000ms (approximate) |
| Swipe down to refresh | `drag` from top of element downward |
| Swipe to dismiss | `drag` element off-screen |
| Scroll | `wheel` or drag on scrollable container |
| Accept system dialog | `handle_dialog` → accept |
| Dismiss system dialog | `handle_dialog` → dismiss |

See `references/gestures.md` for complete gesture coverage.

---

## Manual Mode (Native iOS / Android)

For native apps, the `mobile-test-runner` generates a human-executable guide and returns BLOCKED.

### Guide Format

```markdown
# Manual Execution Guide: TC-NNN — {Title}

**Device:** {device from app_profile.md}
**Platform:** {ios | android}
**App Version:** {app_version from app_profile.md}

## Setup
- [ ] Launch {App Name} on the device
- [ ] Ensure starting state: {preconditions from TC}

## Steps

### Step 1 — {Action from TC}
**Do:** {Expanded human-readable instruction}
**Expected:** {Expected result from TC}
- [ ] PASS — result matches expected
- [ ] FAIL — describe what you actually saw: _______________

### Step 2 — ...

## Final State
{Expected Final State from TC}
- [ ] PASS — state matches
- [ ] FAIL — describe actual state: _______________

## Screenshots
Upload screenshots to `reports/screenshots/TC-NNN_{YYYY-MM-DD}.png`

## Teardown
{Teardown steps from TC}
```

Save guide to `reports/manual-guides/TC-NNN-guide.md`.

### Result JSON for Manual Cases

```json
{
  "tc_id": "TC-001",
  "result": "BLOCKED",
  "failure_reason": "Manual execution required — native app. Guide: reports/manual-guides/TC-001-guide.md",
  "manual_guide": "reports/manual-guides/TC-001-guide.md",
  ...
}
```

---

## Appium Mode (Future)

Not yet available in this bundle. When an Appium MCP server is wired:

- Use `environment-setup-xcuitest` skill for iOS setup
- Use `appium-troubleshooting` skill for debugging
- Locator strategy: see `references/locators.md`
- Gesture commands: see `references/gestures.md`

Change `runner_mode` in test case frontmatter from `manual` to `appium` when Appium MCP is available.

---

## Evidence Collection

After every significant interaction (both modes):
1. **Screenshot** — visual proof saved to `reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png`
2. **Console messages** (Playwright mode) — catch JS errors the UI hides
3. **Notes** — any observation not captured by the screenshot

See `references/gestures.md` and `references/locators.md` for deeper reference.
