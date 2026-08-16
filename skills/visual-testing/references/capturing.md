# Capturing

Capture is **agent-driven**: you open the thing under test in whatever browser or
device tool you already have and save a PNG. No headless engine is installed — if
you have no browser/device tool in this environment, you cannot capture here; say so
and hand the visual step to a context that does, rather than reaching for a bundled
Chromium.

## Two sources

**A generated static page** (design mock, report, flow-map poster):
1. Build it, then open the HTML from disk (`file://` — self-contained, no server).
2. Set the variant (a web mock's breakpoint toggle, the device/style the page
   targets), let fonts and images settle.
3. Screenshot the framed artifact, not the whole browser chrome or a surrounding
   spec panel — the device/frame/poster element itself.

**A running app** (driven by your existing automation):
1. Drive the app to the exact screen and state — the same steps a functional check
   runs (Playwright for web, the device tooling for mobile).
2. Wait for network/loading, images, and any entrance animation to finish.
3. Screenshot the app view (full screen or a specific element).

Either way, save to `current/<name>.png` using the naming scheme in `SKILL.md`, and
capture into a **fresh** `current/` each run — the baseline is the committed set.

## Taming noise (do this before you trust any baseline)

A diff is only meaningful if the same screen shot twice is stable. Sources of
fly-away pixels to control:

- **Fonts** — wait for web fonts to load; a fallback-then-swap changes glyph metrics.
- **Animations, spinners, carousels, cursors, carets** — wait them out or disable
  them (`prefers-reduced-motion`, animation-off flags); blur focused inputs.
- **Viewport / zoom / scroll** — fix the size and scroll position; a 1px offset
  diffs the whole page.

Running apps add more, and these are where most false positives come from:

- **Clocks and dates** — status-bar time, "2 minutes ago", today's date. Freeze the
  clock, or cover the element via the automation, or exclude that region and assert
  it functionally instead.
- **Dynamic content** — feeds, recommendations, ads, randomized order, live counts.
  Use a seeded/fixture account or a stubbed backend so the screen renders the same
  data every run.
- **Notifications / toasts / cookie banners** — dismiss or suppress before the shot.

## Prove determinism

Capture the same screen twice into two `current/` dirs and diff them — they must
match. If two shots of an unchanged screen differ, you have not tamed the noise; fix
the capture setup before committing any baseline. A baseline that flickers trains
everyone to ignore the report, which is worse than having none.

## Naming, in practice

The filename is the contract with the baseline. A Fluent web mock at tablet is
`screen-HYP-003-S-003-1-default-web-fluent-tablet.png`; the same running web app's
checkout error at desktop is `web-checkout-error-desktop.png`. Keep the fields
lowercase and stable so the pairing holds across runs.
