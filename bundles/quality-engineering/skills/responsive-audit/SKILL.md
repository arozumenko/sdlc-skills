---
name: responsive-audit
description: Use when auditing responsive and mobile-web behavior — touch-target size, viewport configuration, horizontal overflow, breakpoints, mobile navigation — via device emulation.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Mobile & Responsive Analysis

**Mobile 📱** specialist pass. This skill is agent-orchestrated — `quality-architect` loads it as one specialist lane in a broader quality audit, then folds its findings into the consolidated report. It also runs standalone when the request is scoped to responsive / mobile-web behaviour alone.

The specialty here is **device-emulated layout**: how the page behaves at a phone viewport with touch input — touch-target ergonomics, viewport meta configuration, horizontal overflow, breakpoint integrity, and the presence of a usable mobile navigation pattern. You assert against what the emulated device actually renders, not against what the desktop layout implies.

## Context to read first

Before auditing, load the project's shape so findings land in the right vocabulary and the right surfaces get covered:

- `.agents/profile.md` (§ Project systems) — the application under test, its base URL, sample users.
- `.agents/testing.md` — quality conventions, supported breakpoints / device matrix if documented.
- The role's injected `memory/<role>/project_briefing.md` — accumulated project gotchas (known responsive debt, intentional desktop-only surfaces).
- `.agents/quality.md` *if present* — per-product quality profile (seeding writes it; optional). It may pin the target device set or a stricter touch-target threshold than the WCAG default.

Missing files are tolerated — note the gap and proceed with WCAG defaults; don't fabricate a device matrix the project never declared.

## Data collection

Browser automation runs through this repo's **browser-verify** skill (Chrome DevTools Protocol). **Read `skills/browser-verify/SKILL.md` first** — it owns Chrome lifecycle and the command surface. Resolve `$SCRIPTS` and start Chrome per that skill (`bash "$SCRIPTS/chrome-launcher.sh" start`), then:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"

node "$SCRIPTS/cdp.mjs" navigate "<page-url>"
node "$SCRIPTS/cdp.mjs" emulate mobile
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-mobile-emulated.png
node "$SCRIPTS/cdp.mjs" evaluate "JSON.stringify({
  viewport: { w: window.innerWidth, h: window.innerHeight },
  docWidth: document.documentElement.scrollWidth,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  isMobileBreakpoint: window.matchMedia('(max-width: 768px)').matches,
  touchTargets: [...document.querySelectorAll('a, button, [role=button], input, select')]
    .map(el => { const r = el.getBoundingClientRect();
      return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), tooSmall: r.width < 44 || r.height < 44 }; })
    .filter(t => t.tooSmall && t.w > 0 && t.h > 0).slice(0, 15)
})"
node "$SCRIPTS/cdp.mjs" emulate desktop   # always restore emulation after the pass
```

Pull the viewport meta separately — `get-meta` already parses it:

```bash
node "$SCRIPTS/cdp.mjs" get-meta            # inspect the viewport meta tag + its content
```

Useful follow-ups when a finding needs proof:

- `node "$SCRIPTS/cdp.mjs" viewport 375 812` then `screenshot` — pin an exact phone viewport instead of a named device.
- `node "$SCRIPTS/cdp.mjs" emulate tablet` / `emulate ipad` — check an intermediate breakpoint where layouts often break.
- `node "$SCRIPTS/cdp.mjs" get-styles "<sel>" --props "font-size,overflow-x,position"` — confirm a computed value (text size, fixed-width container, sticky element) rather than guessing from source.
- `node "$SCRIPTS/cdp.mjs" query-all "<sel>"` — enumerate matches when one offending element repeats.

All evidence goes to **ephemeral `/tmp`** (e.g. `/tmp/audit-mobile-<page>-<step>.png`). Never write screenshots or reports into a project-root `reports/` or `tests/` directory.

## Focus areas

| Issue | Default priority |
|---|---|
| Touch targets < 44×44px (WCAG 2.5.5) | p1 |
| Horizontal scrolling at mobile width | p1 |
| Missing / misconfigured viewport meta | p1 |
| Fixed-width layout breaking on small screens | p1 |
| Hover-only interactions (no touch equivalent) | p1 |
| Pinch-zoom disabled (`user-scalable=no` / `maximum-scale=1`) | p1 |
| Content cut off or overlapping at mobile width | p1 |
| Unusable modal / dialog on small screens | p1 |
| Body text < 16px on mobile | p2 |
| Wrong mobile keyboard type (`<input type>` mismatch) | p2 |
| No mobile navigation pattern (hamburger / drawer / bottom bar) | p2 |
| Non-responsive images (fixed px width, no `srcset`) | p2 |

If `.agents/quality.md` pins a stricter touch-target threshold or a specific device matrix, defer to it over these defaults.

## Finding schema

Emit each finding as a structured object. `quality-architect` collates these across specialists, so the shape must be exact:

```json
{
  "specialist": { "icon": "📱", "specialty": "Mobile & Responsive" },
  "title": "Primary nav links are 32×28px — below the 44×44 touch minimum",
  "priority": "p1",
  "confidence": 8,
  "evidence": "/tmp/audit-mobile-home-nav.png — emulate mobile, 375×812. evaluate output lists 4 touch targets < 44px: 'Products' (w:71,h:28), 'About' (w:54,h:28), 'Contact' (w:62,h:28), menu toggle (w:32,h:32).",
  "suggested_fix": "Increase tap area to ≥44×44px via padding (not font-size) on .nav-link and the menu toggle; keep the visible glyph size if design requires it.",
  "fix_prompt": "In the mobile breakpoint (max-width:768px), give .nav-link and .menu-toggle a min-height/min-width of 44px with vertical padding so the hit area meets WCAG 2.5.5 without enlarging the visible text."
}
```

- **priority** — `p0`–`p3`. p0 = blocks core mobile usage (e.g. primary CTA unreachable, page horizontally unscrollable past content); down to p3 = cosmetic.
- **confidence** — 1–10. See evidence discipline below.
- **suggested_fix** — what to change, in the project's terms.
- **fix_prompt** — a ready-to-paste instruction a developer (or coding agent) can act on directly.
- **specialist** — fixed `icon: 📱`, `specialty: "Mobile & Responsive"` for every finding from this lane.

## Evidence discipline

- Every touch-target finding cites element text/label and measured `w×h` from the `evaluate` output, plus the emulated viewport.
- Every layout finding (overflow, cutoff, breakpoint break) ships the mobile **screenshot** from `/tmp` as evidence.
- Viewport-meta findings quote the actual `content` string from `get-meta`.
- **If you can't prove it, lower the confidence; never fabricate.** A suspected hover-only interaction you couldn't confirm without a real touch device is confidence ≤ 4 with the limitation stated — not an 8 dressed up as certainty. Restore `emulate desktop` after the pass so a later specialist doesn't inherit a phone viewport.

## Related specialist lanes

This is one lane in the quality-audit constellation. Adjacent passes, by repo skill name:

- `accessibility-audit` — WCAG via axe-core (touch-target overlaps both; coordinate on 2.5.5).
- `ux-audit` — interaction and flow quality, including mobile flows.
- `performance-audit` — mobile performance is its own concern (load on throttled connections).
- `content-seo-audit` — viewport meta also matters for SEO; report the responsive angle here, the SEO angle there.
- `reproducing-issues` — when a responsive defect needs a deterministic repro before filing.

The orchestration of these lanes belongs to `quality-architect`; this skill executes the mobile/responsive pass and returns its findings.
