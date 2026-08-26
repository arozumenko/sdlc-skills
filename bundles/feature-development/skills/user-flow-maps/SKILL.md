---
name: user-flow-maps
description: Use when a user flow, journey, or screen-to-screen behaviour needs to become a visual flow map — "draw the flow", "make a flow map", "user flow diagram", "map the screens", "turn these journeys into diagrams", or when acceptance criteria need a picture reviewers can sign off on. Renders a spec of screens, decisions and transitions into standalone HTML posters — numbered screen wireframes, decision diamonds, Start/End markers naming where a flow hands off, orthogonal connectors routed from the data, and an authoritative edge table. Layout, routing and label collision are handled by the bundled flowmap.js; you supply data, never coordinates. NOT for architecture or sequence diagrams, NOT for visual/UI design of the screens themselves (that is a design role's job), and NOT a mermaid replacement — the source diagram stays canonical.
---

# User-flow maps

Turn a flow — screens, decisions, branches, failure paths — into a reviewable
HTML poster. The output is one self-contained file per flow plus an index that
links them; it opens straight from disk, no server and no network.

## The one rule

**You supply data. The library supplies every coordinate.**

Hand-positioning a flow map is a trap: it looks fine until an edge is added,
then captions collide, arrows point into empty space, and each fix creates the
next one. `scripts/flowmap.js` owns layout, lane packing, orthogonal routing,
anchor selection and label de-collision. Never write pixel maths in a spec.

## Workflow

1. **Write a spec.** One JSON file describing the whole set. See
   `references/spec-schema.md` for the contract and a worked example.
2. **Build.**
   ```bash
   node scripts/build-flowmaps.mjs <spec.json> --out <dir>
   ```
   Add `--layout story [--screens <dir|file>]` to build into a shared
   **design-story site** instead of a standalone set: pages land in
   `<out>/flows/<slug>.html` (one directory deeper than the flat default) so
   they can sit next to screen-specs' `screens/` output without a filename
   collision. When `--screens` points at the matching `*.screens.json`
   spec(s), every flow node whose id matches a screen's `node` becomes a
   click-through to that screen's page
   (`../screens/<slug>.html#<screenId>`). Omitting `--screens` (or pointing
   it at nothing yet built) just renders the flow with no screen links —
   this build never depends on the other having run first.
3. **Verify before you claim it works.** Open the pages and check them — the
   library is deterministic but a spec can still describe a flow badly (a
   dangling target, a decision with no outcomes). `references/verifying.md`
   has a copy-paste browser audit that reports edge/caption collisions,
   overlapping labels and orphan nodes. Run it. A flow map that *looks* drawn
   but routes an arrow through a screen is worse than no diagram.

## How ids drive layout

Node ids are the layout instruction — there is no other positioning input:

- **Whole numbers** (`0`, `1`, `2`) form the main row, left to right in order.
- **Decimals** (`1.1`, `2.1`) are branches off the step they hang from, drawn
  on the row above, in their own column.
- Number them so reading the ids in order tells the story.

Everything else — which edge gets which lane, which side a connector enters,
where a label sits so it clears the artwork — is computed.

## What lands on the poster

- **Screen nodes** render as a wireframe skeleton chosen by `archetype`
  (`list`, `detail`, `form`, `dialog`, `confirmation`, `empty-state`,
  `error-state`, `loading-state`, `notice`, `split`, `handoff`). The
  `regions` array says what information is on the screen; it drives the
  skeleton, and it is *structural* — never visual design.
- **Decisions** render as diamonds, with the question inside and outcome
  labels on the edges.
- **Start** marks where the flow is entered.
- **End** marks every exit, and names where it leads. Give a node a `handoff`
  archetype, or point a transition at a target outside the flow, and it
  becomes an End marker resolved through the flow's `outs` / `names` maps.
- **The edge table** repeats every transition exactly. It is generated from
  the same data as the drawing, so the two cannot disagree — say so in review,
  because a poster always simplifies and the table is the authority.

## Conventions worth keeping

- **Behaviour, not design.** A flow map states what must happen and when.
  Layout, components and styling belong to whoever owns the design system.
  Keep that line; it is what makes the map reviewable by non-designers.
- **Tag every edge with the criterion it satisfies** (`ac`). That back-
  reference is what turns a picture into an acceptance artifact. The renderer
  chips real ids and keeps any trailing prose as a note.
- **Record what you could not draw.** If an acceptance criterion has no node —
  a metric, a cross-cutting copy rule, an option with no destination — that is
  a finding about the criterion. Put it in `findings`, don't invent a node.
- **Mark superseded paths rather than deleting them.** `[N/A UNDER <decision>]`
  in a label keeps the reasoning visible when scope changes.

## Styling

The look is Material Design 3 adapted for legibility: M3 colour roles, type
scale, shape and elevation, with full light/dark token sets. Override by
redefining the custom properties in `FlowMap.css` — every colour resolves
through a token, so a palette swap is a token edit, not a rewrite.

## Files

| Path | What it is |
|---|---|
| `scripts/flowmap.js` | The renderer. Browser (`window.FlowMap`) and Node (`require`). Inlined into every generated page, so output stays self-contained. |
| `scripts/build-flowmaps.mjs` | CLI: spec → a set of linked HTML pages. |
| `references/spec-schema.md` | The spec contract, field by field, with an example. |
| `references/verifying.md` | The audit to run before calling a map done. |
