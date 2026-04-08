---
name: playwright-testing
description: UI/E2E test automation with Playwright MCP. Use when the user asks to "test the UI", "automate browser tests", "check the page", "take a screenshot", "run Playwright", "write E2E tests", or anything about browser-based testing.
license: Apache-2.0
compatibility: Requires Node.js 18+. MCP server installed via setup.yaml.
metadata:
  author: octobots
  version: "0.1.0"
---

# Playwright Testing

Browser-based UI and E2E testing using Playwright MCP tools.

## Core Workflow

```
browser_navigate → browser_snapshot → interact → browser_wait_for →
browser_snapshot → evidence collection
```

**Always snapshot before interacting** — you need element refs to click/type.

## Quick Reference

### Navigate & Inspect
```
browser_navigate(url)               → load page
browser_snapshot()                   → get DOM tree + element refs
browser_take_screenshot()            → visual evidence
browser_console_messages()           → JS errors, warnings
browser_network_requests()           → API calls, status codes
```

### Interact
```
browser_click(element="ref")         → click element
browser_type(element="ref", text)    → type into input
browser_fill_form(values)            → fill multiple fields
browser_select_option(element, value)→ select dropdown option
browser_press_key(key)               → keyboard action
browser_hover(element="ref")         → hover for tooltips
```

### Wait & Verify
```
browser_wait_for(selector, timeout)  → wait for element
browser_wait_for(url_pattern)        → wait for navigation
```

## Testing Patterns

### 1. Verify Page Loads
```
navigate → snapshot → verify key elements exist → screenshot
```

### 2. Form Submission
```
navigate → snapshot → fill_form → click submit →
wait_for(networkidle) → snapshot → verify success state → screenshot
```

### 3. Interactive Feature
```
navigate → snapshot → click element → wait_for change →
snapshot → verify new state → console_messages → screenshot
```

### 4. API + UI Verification
```
curl API to create data → navigate to page → snapshot →
verify data appears in UI → screenshot
```

## Evidence Collection

After every significant interaction, collect:
1. **Screenshot** — visual proof
2. **Console messages** — catch JS errors the UI hides
3. **Network requests** — verify API calls succeeded

**Check console even when the UI looks fine.** Silent errors are the worst bugs.

## Wait Strategies

| Situation | Strategy |
|-----------|----------|
| Page load | `wait_for(networkidle)` |
| Dynamic content | `wait_for(selector)` |
| Navigation | `wait_for(url_pattern)` |
| Animation | `wait_for(timeout: 1000)` — last resort |

**Never use fixed waits when a condition-based wait works.**

## Bug Report Format

When you find an issue:

```
## [SEVERITY] Title

Steps: 1. Navigate to... 2. Click... 3. Observe...
Expected: What should happen
Actual: What happens
Evidence: screenshot, console error, network response
Frequency: Always / Intermittent / Once
```

## Details

See `references/patterns.md` for Page Object Model, fixture strategies, and framework-specific selectors.
