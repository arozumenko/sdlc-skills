---
name: responsive-audit
description: >
  Responsive-layout analysis on a real browser — viewport configuration,
  touch-target sizing, and mobile-layout issues via a resized Playwright viewport.
license: Apache-2.0
metadata:
  user-invocable: false
---

# Responsive Layout Analysis

**Responsive 📱** specialist pass — mobile viewport / touch-target / responsive-layout
checks against the real page in a resized browser (not a native app; PWA/hybrid or
plain responsive web only — native iOS/Android is the `mobile-testing` skill's job).

## Data Sources

```
browser_resize(width: 390, height: 844)   # mobile viewport (e.g. iPhone 12/13)
browser_navigate(url)                     # or re-navigate if already on the page
browser_snapshot()                        # structure at the mobile viewport
browser_take_screenshot(type:"png", fullPage:true)   # visual evidence
browser_resize(width: 1280, height: 800)  # always restore a desktop viewport after
```

**Limitation:** the factory's Playwright MCP toolset has no `browser_evaluate`,
so exact touch-target pixel dimensions (`getBoundingClientRect`) and
`window.innerWidth`/`matchMedia` reads are not available. Judge touch-target
size, text legibility, and overlap **visually from the mobile screenshot and
snapshot bounding info**, and score confidence accordingly (per the evidence
rule in `audit-methodology.md`) — treat a visually-small target as a lower-
confidence finding than a directly-measured one, and say so.

## Focus Areas

- Touch targets that look smaller than ~44x44px (WCAG 2.5.5 — p1)
- Horizontal scrolling (p1)
- Text that looks smaller than ~16px (p2)
- Missing/misconfigured viewport meta (visible as unscaled/zoomed layout — p1)
- Fixed-width layouts breaking at the mobile viewport (p1)
- Hover-only interactions with no visible tap equivalent (p1)
- Wrong mobile keyboard types for input fields (p2)
- Content cut off or overlapping (p1)
- No mobile navigation pattern (hamburger/bottom nav) (p2)
- Non-responsive images (p2)
- Unusable modals on small screens (p1)

## Output

Reference element text/role and the screenshot region for touch-target and
layout violations. Always include the mobile screenshot as evidence. Produce
findings in the shared schema — see the qa-auditor `audit-methodology.md`.
