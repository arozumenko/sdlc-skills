# Design-story presentation uplift — spec + plan

**Date:** 2026-08-17
**Skills:** `bundles/feature-development/skills/{user-flow-maps,screen-specs}`
**Branch:** feat/designer-impeccable-and-polish
**Goal:** Turn the two skills' separate outputs (a flow-map poster + an unordered list of screen mocks) into one navigable **design story** that walks a reviewer through the journey.

## Scope (user-approved 2026-08-17)

Build **A + B + C + E**; D (guided walkthrough) deferred. Density knob + per-screen
override deferred behind the token-driven-spacing refactor (see designer-skill-candidates.md).

- **A. Cross-link flow ↔ screens** — a flow-map node links to its screen's spec page; a screen
  links back to its flow node + the criterion it satisfies.
- **B. Journey filmstrip** — screen-specs arranges a flow's screens in journey order (by node id)
  as a horizontal filmstrip with arrows, at the top of the flow page.
- **C. Design-story hub** — one landing page: Problem/trigger → Journey (flow map) → Screens →
  Coverage, walked top to bottom.
- **E. Coverage view** — a matrix of acceptance criteria × (flow nodes / screens / states), green
  where realized, red where a gap.

## Shared data (already present)

- Flow-maps: flow `key` (HYP-001), nodes with `id` (whole=main row, decimal=branch), edges with `ac`,
  `trigger`, `findings`. Output `build-flowmaps.mjs` → `<slug(key)>.html` + `index.html`.
- Screen-specs: screens with `id` (S-…), `node` (flow node id[s]), `ac`, `states`. Output
  `build-screens.mjs` → `<slug(flow)>.html` + design-system `index.html`.
- **Join keys:** flow `key` ↔ screen-specs `flow`; flow node `id` ↔ screen `node`; `ac` on both.

## Architecture — a "design-story site" layout

Today both builds slug from the same id → **filename collision** if emitted to one dir, and neither
knows the other's URLs. Introduce a shared layout both builds can target:

```
<out>/
  index.html          # C — the design-story hub (new, build-story.mjs)
  coverage.html       # E — the coverage matrix (new, build-story.mjs)
  flows/<slug>.html    # build-flowmaps.mjs --layout story
  screens/<slug>.html  # build-screens.mjs --layout story
```

- Both build CLIs gain an optional `--layout story` (default keeps today's flat output, so existing
  callers are unaffected). Under `story`, they write into `flows/` / `screens/` and emit cross-links
  to the sibling namespace (A). A flow node → `../screens/<slug>.html#<screenId>`; a screen → its
  flow node `../flows/<slug>.html#node-<id>` and its `ac` → `../coverage.html#ac-<id>`.
- Links are emitted **unconditionally under `story` layout** (relative to the sibling dir); a missing
  counterpart just 404s. No build needs the other to run first.
- `build-story.mjs` (new, in screen-specs — the richer data owner) reads BOTH the flow spec(s) and the
  screen spec(s), and generates `index.html` (hub) + `coverage.html`. It does not re-render mocks; it
  links to the pages the two builds produced.

## Feature detail

### B — journey filmstrip (build-screens.mjs, `story` and flat)
Sort a flow's screens by `node` id using the flow-map ordering (whole numbers ascending, then decimals
under their parent). Render a top strip: each screen a small clickable thumbnail (its default mock at a
reduced scale, or a labelled card) with an arrow to the next, anchored to the full screen section below.
Screens with no `node` sort last. This is self-contained in build-screens.mjs (no cross-skill dep) and
works in both layouts.

### A — cross-links (both builds, `story` layout)
- flow node (flowmap.js render + build-flowmaps glue): if a node id matches a screen's `node`, wrap the
  node in a link to `../screens/<screenSlug>.html#<screenId>`.
- screen (build-screens glue): the screen's "Flow node" traceability value links to
  `../flows/<flowSlug>.html#node-<id>`; each `ac` chip links to `../coverage.html#ac-<id>`.
- flowSlug/screenSlug derive from the shared key so both sides compute the same path.

### C — design-story hub (build-story.mjs → index.html)
Sections, top to bottom: **Problem** (flow `trigger`/`bet`), **Journey** (link + thumbnail to each
`flows/<slug>.html`), **Screens** (link to each `screens/<slug>.html`, grouped by flow, in journey
order), **Coverage** (summary counts + link to coverage.html). A real narrative landing, not a nav bar.

### E — coverage matrix (build-story.mjs → coverage.html)
Collect every `ac` id from: flow edges, screen `ac`, region `ac`, state `ac`. For each criterion, list
which flow node(s), screen(s), and state(s) realize it. A criterion present in a flow/spec `findings`
entry but with no screen = a **gap** (red row). Anchor each row `#ac-<id>` (cross-link target from A).
Pure data transform over the specs — unit-testable without a browser.

## Verification (stdlib node --test + build smoke)

1. **Coverage computation** (`build-story.mjs` pure fn): given fixture flow+screen specs, `computeCoverage()`
   returns the right criteria→{nodes,screens,states} map and flags gaps. Unit test, no DOM.
2. **Journey order** (`build-screens.mjs` pure fn): `journeyOrder(screens)` sorts by node id
   (whole then decimal-under-parent); node-less last. Unit test.
3. **Build smoke:** `--layout story` on fixtures → `flows/`, `screens/`, `index.html`, `coverage.html`
   exist; a screen page contains a `../flows/…#node-` link; a flow page contains a `../screens/…#` link;
   the filmstrip markup is present; coverage.html has an `#ac-` anchor.
4. **No regression:** default (flat) layout output unchanged — existing screen-specs golden/build tests
   still pass; flat flow-map build still writes `<slug>.html` at root.

## Plan (bite-sized, subagent-driven)

- **T1 — journey order + filmstrip (build-screens.mjs).** TDD `journeyOrder()`; render the filmstrip
  strip + anchors in both layouts. Golden/existing screen-specs tests stay green.
- **T2 — `--layout story` + cross-links (both build CLIs).** Add the `story` layout (flows/ + screens/
  subdirs) and the sibling cross-links to both `build-flowmaps.mjs` and `build-screens.mjs`; default flat
  layout unchanged. Build-smoke tests for the links + subdir output.
- **T3 — build-story.mjs: coverage + hub.** TDD `computeCoverage()`; generate `coverage.html` (E) and
  `index.html` hub (C) from both spec sets; anchors match A's link targets.
- **T4 — docs + wiring.** Update both SKILL.md workflows (the `story` layout + `build-story.mjs`); note
  the linked-site output; `npm test` + `npm run validate` green; regenerate marketplaces if descriptions change.
- **Final review** — whole-branch.

## Out of scope
- D guided walkthrough; density/per-screen override; re-rendering mocks in the hub (it links, not renders).
