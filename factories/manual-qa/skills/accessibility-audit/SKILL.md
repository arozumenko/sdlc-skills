---
name: accessibility-audit
description: >
  Accessibility and WCAG compliance analysis, from the accessibility
  snapshot and visual review — flags issues automated axe-style scans miss.
license: Apache-2.0
metadata:
  user-invocable: false
---

# Accessibility & WCAG Analysis

Two analysis passes:
- **Accessibility ♿** — General a11y, user experience impact
- **WCAG Compliance 📋** — Technical WCAG 2.1 AA/AAA criteria

## Data Sources

**Primary — `browser_snapshot()`:** the accessibility tree gives roles, accessible
names, and structure for every element. Use it to check for missing accessible
names, wrong roles, and reading-order-vs-visual-order mismatches.

**`browser_take_screenshot()`** — visual review for contrast, focus visibility,
layout/reading order, and issues no accessibility tree can show.

**Limitation:** the factory's Playwright MCP toolset has no `browser_evaluate`
(and therefore no way to inject axe-core), so there are **no axe violation IDs,
impact levels, or `helpUrl`/`failureSummary` evidence** in this environment.
Every finding must instead cite a `browser_snapshot` node or a screenshot region
as evidence, and confidence must be scored against that weaker evidence (per the
evidence rule in `audit-methodology.md`) — never claim an axe-core finding or
impact level that wasn't actually gathered.

## Accessibility ♿ — Focus Areas

Look for: missing alt text, unlabeled form controls, poor color contrast, keyboard
navigation issues, missing ARIA roles, focus order problems, skip navigation,
screen reader compatibility, interactive elements without accessible names,
missing form error announcements.

## WCAG 📋 — Criteria

See `references/wcag-checklist.md` for full criteria:
- Contrast ratios below 4.5:1 (AA) or 7:1 (AAA)
- Missing text alternatives (1.1.1)
- Keyboard traps (2.1.2)
- Time limits without controls (2.2.1)
- No bypass blocks (2.4.1)
- Focus not visible (2.4.7)
- Language not specified (3.1.1)
- Error identification missing (3.3.1)
- Name/role/value violations (4.1.2)

## Output

Produce findings in the shared schema — see the qa-auditor `audit-methodology.md`.
Each finding must reference specific evidence: a `browser_snapshot` node (role +
accessible name) or a screenshot region — never an axe violation ID (unavailable
in this environment; see Limitation above).

## Reference Files

- `references/wcag-checklist.md` — WCAG 2.1 success criteria with priority mapping
