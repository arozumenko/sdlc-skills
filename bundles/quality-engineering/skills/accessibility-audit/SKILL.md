---
name: accessibility-audit
description: Use when auditing a rendered web page for accessibility and WCAG 2.1 AA/AAA conformance — contrast, ARIA, keyboard navigation, focus order, screen-reader semantics — from axe-core results plus visual review.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
allowed-tools: Bash(node:*) Bash(bash:*)
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Accessibility & WCAG Analysis

This skill is **agent-orchestrated** — the `quality-architect` (or whatever
agent owns a quality audit on the project) loads it as one specialist pass of a
larger page audit. It is not a standalone user command; it consumes the shared
Step-0 capture that the orchestrator collected once and reused across specialist
skills, then emits findings in the common schema.

Two analysis passes:

- **Accessibility ♿** — General a11y, user experience impact
- **WCAG Compliance 📋** — Technical WCAG 2.1 AA/AAA criteria

## Context to read first

Before analyzing, ground yourself in the project:

- `.agents/profile.md` (§ Project systems) — what the product is, base URL, auth.
- `.agents/testing.md` — quality conventions, what "done" means on this project.
- the role's injected `memory/<role>/project_briefing.md` — accumulated gotchas.
- `.agents/quality.md` *if present* — a per-product quality profile (seeding
  writes it when applicable; it is optional, so tolerate its absence).

These tell you the product's audience, regulatory posture (e.g. is AAA in
scope?), and any known-and-accepted a11y debt so you don't re-report it.

## Data Sources

**Primary — axe-core results** from `inject-axe` (collected in Step 0 via the
[`browser-verify`](../browser-verify/SKILL.md) skill — see § Step 0 below):

```
violations[].impact → priority mapping:
  critical → p0,  serious → p1,  moderate → p1,  minor → p3
```

Each violation has `id`, `description`, `helpUrl`, `nodes[].html`,
`nodes[].failureSummary`.

Attribute each violation to **Accessibility ♿** (UX-focused: cognitive load,
navigation clarity) or **WCAG 📋** (technical: contrast ratios, ARIA roles).

**Visual analysis** — for issues axe cannot catch. Take a screenshot to ephemeral
`/tmp` (e.g. `/tmp/audit-a11y-focus.png`) and review:

- Cognitive load and layout clarity
- Focus visibility (is the focus ring visible after `focus`?)
- Reading order vs visual order
- Motion/animation triggering vestibular issues
- Empty interactive elements with no accessible name

## Step 0 — capture once with browser-verify

Read [`skills/browser-verify/SKILL.md`](../browser-verify/SKILL.md) first for the
real command set; it drives Chrome over CDP with zero npm install. The
orchestrator typically captures Step 0 once and shares it; if you are running
the page cold, capture it yourself:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless

node "$SCRIPTS/cdp.mjs" navigate "<page-url>"
node "$SCRIPTS/cdp.mjs" inject-axe                       # axe-core WCAG violations — primary source
node "$SCRIPTS/cdp.mjs" inject-axe --selector "main"     # scope axe to a subtree if the page is large
node "$SCRIPTS/cdp.mjs" get-meta                          # lang attr, page title, document metadata
node "$SCRIPTS/cdp.mjs" get-console                       # ARIA / framework warnings surface here
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-a11y-overview.png
```

For keyboard / focus checks, drive real CDP input events and screenshot the
result to `/tmp`:

```bash
node "$SCRIPTS/cdp.mjs" press Tab                          # walk focus order
node "$SCRIPTS/cdp.mjs" evaluate "document.activeElement.outerHTML"   # what got focus
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-a11y-focus-1.png
node "$SCRIPTS/cdp.mjs" get-styles ":focus" --props "outline,boxShadow,border"  # focus indicator
```

Use `get-html` / `get-text` / `get-attribute` to confirm ARIA attributes,
accessible names, and heading structure. Use `emulate mobile` + `screenshot` if
you need to confirm target-size or zoom behavior. Stop Chrome when done:
`bash "$SCRIPTS/chrome-launcher.sh" stop`.

All evidence goes to **ephemeral `/tmp`** (e.g. `/tmp/audit-a11y-<step>.png`) —
never a project-root `reports/` or `tests/` directory. The audit produces
findings, not committed artifacts.

## Accessibility ♿ — Focus Areas

Look for: missing alt text, unlabeled form controls, poor color contrast,
keyboard navigation issues, missing ARIA roles, focus order problems, missing
skip navigation, screen reader compatibility, interactive elements without
accessible names, missing form error announcements.

## WCAG 📋 — Criteria

See [`references/wcag-checklist.md`](references/wcag-checklist.md) for the full
criteria with priority mapping. The high-frequency offenders:

- Contrast ratios below 4.5:1 (AA) or 7:1 (AAA) — 1.4.3 / 1.4.6
- Missing text alternatives — 1.1.1
- Keyboard traps — 2.1.2
- Time limits without controls — 2.2.1
- No bypass blocks — 2.4.1
- Focus not visible — 2.4.7
- Language not specified — 3.1.1
- Error identification missing — 3.3.1
- Name/role/value violations — 4.1.2

## Output — finding schema

Produce findings using the standard finding schema shared across the quality
specialists. Each finding is one object:

```yaml
- title: "Submit button has no accessible name"
  specialist: "Accessibility ♿"        # or "WCAG Compliance 📋"
  priority: p0                          # p0 (critical) | p1 (high) | p2 (medium) | p3 (low)
  confidence: 9                         # 1–10 — how sure you are this is a real defect
  wcag: "4.1.2 Name, Role, Value (A)"   # the criterion, when WCAG-attributable
  evidence: |
    axe id `button-name`, impact=critical.
    node: <button class="icon-btn"><svg ...></button>
    failureSummary: "Element does not have inner text that is visible to screen readers"
    Screenshot: /tmp/audit-a11y-overview.png
  suggested_fix: "Add an aria-label or visually-hidden text to the icon button."
  fix_prompt: "In the submit button, add aria-label=\"Submit form\" (or visually-hidden span) so the icon-only control exposes an accessible name."
```

Specialist tag carries the icon + specialty: **Accessibility ♿** or
**WCAG Compliance 📋**.

### Priority mapping

| Source | Priority |
|---|---|
| axe `critical` / WCAG Level A | p0 |
| axe `serious` / `moderate` / WCAG Level AA | p1 |
| Notable UX a11y friction (no hard WCAG break) | p2 |
| axe `minor` / WCAG Level AAA | p3 |

## Evidence discipline

Every finding must reference specific, reproducible evidence: an axe violation
`id`, a `/tmp` screenshot path, the ARIA-tree element, or the computed style you
read. **If you can't prove it, lower the confidence; never fabricate.** A
contrast claim needs the measured ratio; a focus claim needs the screenshot
showing (or not showing) the ring; an ARIA claim needs the `outerHTML`. A
confidence below ~5 should be framed as "worth a manual check," not asserted as
a defect.

## Related specialists

This skill is one pass of a larger page audit. Sibling specialists, when also
dispatched, cover adjacent concerns:

- [`responsive-audit`](../responsive-audit/SKILL.md) — viewport / target-size / mobile layout
- [`ux-audit`](../ux-audit/SKILL.md) — broader usability and interaction quality
- [`performance-audit`](../performance-audit/SKILL.md) — load and runtime cost
- [`security-audit`](../security-audit/SKILL.md) / [`privacy-audit`](../privacy-audit/SKILL.md) — headers, cookies, data exposure
- [`content-seo-audit`](../content-seo-audit/SKILL.md) — metadata, headings, copy

Deduplicate against them: a missing `<h1>` is a 1.3.1 finding here and a
heading-structure finding for SEO — report it once under the owning specialist.

## Reference Files

- [`references/wcag-checklist.md`](references/wcag-checklist.md) — WCAG 2.1 success criteria with priority mapping.
