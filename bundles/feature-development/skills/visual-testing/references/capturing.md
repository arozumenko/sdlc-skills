# Capturing

Capture is **agent-driven**: you open each generated page in the browser tool you
have and save a PNG. No headless engine is installed — if you have no browser tool
in this environment, you cannot capture here; say so and hand the step to someone
who can, rather than reaching for a bundled Chromium.

## The loop

For each page the generator produced:

1. Open the page — `file://` path to the generated HTML (the pages are
   self-contained; no server needed).
2. Set the variant you're shooting (see below), let it settle (fonts, images).
3. Screenshot the **framed artifact**, not the whole browser chrome or the
   surrounding spec panel:
   - screen-specs: the device `.device` element (mobile) or the `.webframe`
     element (web) — the mock itself.
   - user-flow-maps: the poster/diagram region.
4. Save to `current/<name>.png` using the exact naming scheme in `SKILL.md`.

Capture into a **fresh** `current/` each run; the baseline is the committed set,
`current/` is disposable.

## Which variants to shoot

Follow the default-coverage rule in `SKILL.md` (default state, target
device/breakpoint set, one representative style) unless the design's risk justifies
more. Concretely:

- **Mobile screens** — one shot per `device` you target. A design built for a
  single device needs only `iphone`. Switch device by rebuilding with `device` set
  in `design-system.json`, or by capturing the frame the page rendered.
- **Web screens** — one shot per breakpoint you target. The generated page has a
  **breakpoint toggle** (`Mobile-web / Tablet / Desktop`); click it to the target,
  wait for the mocks to rebuild (the toggle re-renders them), then shoot. Capture
  the chosen `style` — add a second style only when its depth/border/radius
  treatment is something you specifically want held steady.
- **States** — shoot the default state by default. Add a named state only when its
  layout is fragile enough to regress silently (an inline error that shifts a form,
  an empty state that collapses a shelf).
- **Flow-maps** — one shot per poster page.

## Naming, in practice

The filename is the contract with the baseline. A shot of the Fluent checkout at
tablet is `screen-HYP-003-S-003-1-default-web-fluent-tablet.png`; the iPhone
mobile version of the same screen's error state is
`screen-HYP-003-S-003-1-error-iphone.png`. Keep the fields lowercase and stable —
if you rename a screen id, its baseline pairing breaks and reg-cli reports it as
one deleted + one new, which is the signal to re-approve, not a bug.

## Determinism

A diff is only meaningful if the same page shot twice is byte-stable. Before
trusting a baseline, capture the same page twice and diff the two `current/` shots
— they must match. Sources of fly-away pixels to control: web fonts still loading
(wait for load), lazy images, animations (the web frame already respects
`prefers-reduced-motion`; set it), and a viewport/zoom that isn't fixed. If two
captures of an unchanged page don't match, fix the capture setup before you commit
any baseline — a noisy baseline trains everyone to ignore the report.
