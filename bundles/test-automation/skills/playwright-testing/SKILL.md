---
name: playwright-testing
description: Use when the user asks to 'test the UI', 'automate browser tests', 'check the page', 'take a screenshot', 'run Playwright', 'write E2E tests', or anything about browser-based testing. UI/E2E test automation with Playwright MCP.
license: Apache-2.0
compatibility: Requires Node.js 18+. MCP server installed via setup.yaml.
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Playwright Testing

Browser-based UI and E2E testing using Playwright MCP tools.

## Core Workflow

Use the **Playwright MCP**. The loop for any check:

1. Navigate to the URL.
2. **Snapshot the page first** (accessibility tree + element refs) — you need the refs before you can act, and the role/name pairs are what you assert on.
3. Interact: click, type, fill a form, select an option, press a key, hover.
4. Wait for the expected condition (an element appears, navigation completes).
5. Re-snapshot, then collect evidence: screenshot, console messages, network requests.

Call these through the MCP — exact tool names track your installed `@playwright/mcp` version, so discover them from the MCP rather than hard-coding signatures here.

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

## Synthetic Input Hygiene

Some interactions can't be driven natively (OS-level file drag, clipboard
writes) and need synthesized events (`dispatchEvent` with a constructed
`DataTransfer`, force-clicks, JS-evaluated state). These are not real user
input — sloppy sequences create app states no user can reach:

- **One continuous gesture per `DataTransfer`** — `dragenter → dragover →
  drop` with the same handle. Never start a second gesture (a second
  `dragenter` with no `dragleave`/`drop` ending the first); apps that
  count enter/leave pairs are left permanently desynced.
- **Fresh context per experiment.** While debugging, earlier synthetic
  input in the same page may have poisoned the app's internal state —
  re-verify anything suspicious in a new, isolated context before
  trusting it.
- **A "bug" seen only after synthetic input isn't a bug yet.** Before
  filing it, reproduce it in a pristine context with a single correct
  gesture. If it doesn't reproduce clean, it was self-inflicted session
  state — document what you ruled out instead of filing.

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
