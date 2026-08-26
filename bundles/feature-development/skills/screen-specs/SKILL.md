---
name: screen-specs
description: Use when screens need designing or documenting as reference a developer or agent can build from — "design the screens", "screen specs", "what should this screen look like", "turn the flows into designs", "document the UI", or when a flow map's nodes need to become actual screens. Produces standalone HTML pages showing each screen as a device-framed mock beside its spec — regions with Material component and token names, every state the criteria demand, the MD3-vs-platform calls, accessibility notes, and traceability back to a flow node and acceptance criterion. Mock and spec are generated from one source so they cannot drift. NOT for flow/journey diagrams (use user-flow-maps), NOT a design tool replacement, and NOT for writing the screens' production code.
---

# Screen specs

Turn a flow's nodes into screens that can actually be built. Each screen is
documented twice from one source — a mock showing what it should look like, and
the spec a developer implements from — so the picture and the contract cannot
disagree.

## The two rules

1. **Every screen traces to a flow node and an acceptance criterion.** No orphan
   screens. If a criterion cannot become a screen or a state, that is a finding
   about the criterion — record it in `notes`, don't invent a screen for it.
2. **Real content only.** A mock reading "Hotel Name / $XXX" teaches nobody
   anything. Use values that exist in the project's seed data.

## Workflow

1. **Settle the design system first**, once, in `design-system.json`: colour
   roles (light and dark), the M3 type scale mapped to real platform text
   styles, shape, elevation, spacing, a component inventory covering every
   region type, and the **standing platform calls** — the conflicts decided
   app-wide so no screen re-litigates them. Choose the `target` (`mobile` or
   `web`), the `style` for web (`material` / `neo-flat` / `minimal-neutral` /
   `fluent`), and the `device` for mobile (`iphone` / `iphone-max` /
   `android` / `iphone-se`) here too.
2. **Author one flow's specs as the pattern**, then fan the rest out against it.
   Getting the system right on the hardest flow is what makes parallel work
   safe.
3. **Build.**
   ```bash
   node scripts/build-screens.mjs \
     --system <design-system.json> --specs <dir> --out <dir> [--img ../assets/img/]
   ```
   Every flow page carries a **journey filmstrip** above its screens — the
   flow's screens ordered by their `node` id (whole numbers ascending, then
   decimals under their parent; node-less screens sort last), each a small
   clickable card that jumps to its full section below. It renders in both
   layouts.

   Add `--layout story` to build into a shared **design-story site** instead
   of a standalone set: pages land in `<out>/screens/<slug>.html` (one
   directory deeper — a relative `--img` base gets an extra `../`
   automatically) so they sit next to user-flow-maps' `flows/` output. Under
   `story`, each screen's Flow node value links back to
   `../flows/<flowSlug>.html#node-<id>`, and its Criteria chips link to
   `../coverage.html#ac-<id>` — both resolve once the sibling builds
   (`build-flowmaps.mjs --layout story` and `build-story.mjs`) have run;
   until then they just 404, no build depends on the other running first.
4. **Verify.** See `references/verifying.md`. Check that no mock overflows its
   frame, no image is broken, and the page never scrolls sideways.
5. **Tie flows and screens into one site.** Once both builds have written
   into the same `<out>` with `--layout story`, run
   ```bash
   node scripts/build-story.mjs --flows <flowspec dir|file> --screens <dir> --out <dir>
   ```
   to generate `<out>/index.html` (the design-story hub) and
   `<out>/coverage.html` (the acceptance-criteria coverage matrix). See
   "Design-story site" below for the full recipe.

## What a spec carries

Per screen: purpose, flow node, criteria, presentation kind, ordered regions
(each with its Material component and exact token names), every state with its
trigger and what changes, the platform calls, seeded content, accessibility
notes, implementation hints, grounding references, and anything left open.

Full contract: `references/schema.md`.

## Presentation drives the chrome

How `nav.kind` and the surrounding chrome render depends on the `target`:

- **mobile** — device frame, tab bars, nav bars, sheets, and the
  MD3-vs-platform calls. See `references/targets/mobile.md` for the full
  `nav.kind` table and the device library.
- **web** — responsive breakpoints (mobile-web / tablet / desktop), the app
  shell (top bar, side nav, dialogs), and the four selectable styles
  (Material UI, Neo-Flat, Minimal-Neutral, Fluent). See
  `references/targets/web.md`.

Describe nav affordances plainly — `"share, favorite"` — and they render as
icons. Prose asides in parentheses are stripped, because a mock that prints
"(SF Symbols, not text buttons)" in its nav bar is documenting itself instead of
showing the screen.

## Region types

`appbar` `searchfield` `chips` `segmented` `hero` `gallery` `list` `card` `row`
`field` `datefield` `stepper` `price` `banner` `notice` `error` `cta`
`secondary-cta` `divider` `text` `footnote` `empty` `skeleton` `sheet-handle`
`map`

Each renders in the mock and maps to a component in the inventory. Adding a type
means adding a renderer in `screenspec.js` *and* an inventory row — a type with
no inventory entry is a spec that can't be built.

## Conventions that keep specs honest

- **Name tokens exactly.** `surfaceContainerHigh`, not "light grey". A developer
  maps tokens to a palette; adjectives map to nothing.
- **State the platform call** wherever the design system and the platform
  disagree, with which won and why. An unstated blend is what produces visible
  seams.
- **Design the ugly states.** Empty, error, loading, disabled, and the
  domain-specific ones the criteria demand. A spec with only a happy path will
  be built with only a happy path.
- **A state that renders nothing is still a state.** If the correct behaviour is
  "discard silently, change nothing on screen", write that down — otherwise
  someone will add a spinner.
- **Mark known gaps as gaps.** A control whose destination doesn't exist gets
  specced as the gap it is, never filled with an invented screen.
- **Structure, not pixels.** No coordinates, no px widths. Say what is present
  and in what order; the renderer lays it out.

## Styling

Everything resolves through `design-system.json`'s tokens — colour roles become
CSS custom properties, the shape scale becomes radii. Swap the palette there and
every mock in the set follows. Light and dark are both generated.

## Design-story site

The end-to-end recipe that turns the two skills' separate outputs into one
navigable site a reviewer walks top to bottom — Problem → Journey → Screens →
Coverage, everything cross-linked:

```bash
node <user-flow-maps>/scripts/build-flowmaps.mjs <flowspec.json> \
  --out <dir> --layout story --screens <screens dir>

node scripts/build-screens.mjs \
  --system <design-system.json> --specs <screens dir> --out <dir> --layout story

node scripts/build-story.mjs \
  --flows <flowspec.json|dir> --screens <screens dir> --out <dir> [--system <design-system.json>]
```

All three point `--out` at the **same directory**. Order doesn't matter for
correctness (each build degrades to a dead link, never a failure, if a
sibling hasn't run yet), but running `build-story.mjs` last means its hub and
coverage page reflect what's actually on disk. The result:

```
<dir>/
  index.html      # the hub: Problem, Journey, Screens, Coverage
  coverage.html   # every AC id x which node(s)/screen(s)/state(s) realize it
  flows/<slug>.html
  screens/<slug>.html
```

Open `<dir>/index.html`. It links to each `flows/<slug>.html` (the journey),
groups screen links by flow in journey order, and summarizes coverage with a
link to the full matrix — it never re-renders a mock or a poster, only links
to the pages the other two builds produced.

## Files

| Path | What it is |
|---|---|
| `scripts/screenspec.js` | Mobile renderer: tokens, region renderers, device mock, state resolution. Browser and Node. |
| `scripts/screenspec.web.js` | Web renderer: responsive breakpoints, app shell, region renderers for the web target. Browser and Node. |
| `scripts/styles.js` | The four selectable web styles (Material UI, Neo-Flat, Minimal-Neutral, Fluent) — palette and token overrides per style. |
| `scripts/build-screens.mjs` | CLI: design system + specs → linked HTML pages, one per flow (with a journey filmstrip), plus a design-system index. `--layout story` cross-links into a shared design-story site. |
| `scripts/journey.mjs` | `journeyOrder(screens)` — sorts a flow's screens into journey order by `node` id; backs the filmstrip and the hub's per-flow screen groups. |
| `scripts/build-story.mjs` | CLI: flow spec(s) + screen spec(s) → `index.html` (design-story hub) and `coverage.html` (AC coverage matrix). Reads both builds' inputs, renders neither's mocks — only links. |
| `references/schema.md` | The spec contract, field by field. |
| `references/verifying.md` | What to check before calling the set done. |
| `references/coverage-both-ways.md` | Node→screen *and* screen→node coverage. Run after any flow-map edit — a retired node leaves an orphaned screen that a one-directional check cannot see. |
