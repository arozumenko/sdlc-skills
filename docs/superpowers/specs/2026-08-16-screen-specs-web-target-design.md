# screen-specs: responsive multi-style web target — design

**Date:** 2026-08-16
**Skill:** `bundles/feature-development/skills/screen-specs`
**Status:** approved design → implementation plan next

## Problem

`screen-specs` renders one fixed 390pt **phone** frame and reasons only about
**MD3-vs-iOS** platform calls. It cannot produce web screen designs, so the
`designer` agent's `screen-specs` skill serves only `ios-dev` / `android-dev`;
`js-dev`'s web features have no design skill. We are adding a **web target** that
renders **responsive** mocks (mobile-web / tablet / desktop) in one of **four
widely-adopted design styles** (Material UI, Neo-Flat, Minimal-Neutral, Fluent),
and giving mobile a small library of common device frames — all without
regressing the proven mobile path (guarded by a golden byte-identical test).

## Decisions (locked)

- **Target axis** lives on `design-system.json` (per-app), `target: "mobile" | "web"`,
  default `mobile`. Absent target ⇒ mobile ⇒ byte-identical to today.
- **Style** lives on `design-system.json`, `style` ∈ `material | neo-flat |
  minimal-neutral | fluent`, default `material`, consulted only when `target: web`.
- **Full responsive** web: three breakpoints (mobile-web ~400, tablet ~768,
  desktop ~1280), surfaced via a per-page breakpoint toggle defaulting to Desktop.
- **Mobile device frames**: a **fixed library of 4 common devices** (not a new
  frame invented per project), chosen via `device` on `design-system.json`.
  Default `iphone` = today's exact 390pt frame ⇒ golden test holds.
- **File split** (not one mega-file): `screenspec.js` (core + mobile),
  `screenspec.web.js` (web frame + web regions), `styles.js` (4 presets). Build
  concatenates them into the inlined `LIB`.
- Build in the sdlc-skills bundle copy; benchmark source synced later by the user.

## Architecture

### Modules (all browser+Node, self-contained after inlining)

| File | Owns | Notes |
|---|---|---|
| `scripts/styles.js` | `STYLES` preset table: per-style CSS-var defaults + structural flags (`shadow`, `borderWeight`, `radiusScale`, `surfaceAlpha`, `buttonFill`, `motion`). | Pure data + a `styleVars(style)` → CSS string. No DOM. |
| `scripts/screenspec.js` | Shared core: `tokens(ds)`, `applyState`, `annotations`, region role logic, region renderers `R`, **mobile** frame (`mock` mobile path), `spec`, `css`. | Existing file, minimally refactored: `mock()` gains a target dispatch; `tokens()` folds in `styleVars` when `target: web`. |
| `scripts/screenspec.web.js` | Web frame: browser chrome, breakpoint viewport, web nav kinds (`page/split/modal/drawer/panel`), web region variants (`topnav`, `sidebar`, `datatable`, `breadcrumb`), the breakpoint-toggle wiring. | Registers itself onto the shared `ScreenSpec` object (`ScreenSpec.mockWeb`, `ScreenSpec.webCss`). |
| `scripts/build-screens.mjs` | Reads all three as text → one `LIB`; `require`s an assembled module; page `<style>` = `tokens(ds) + CHROME + css + (web ? webCss : '')`; index + Call rendering become target-aware. | Concatenation order: `styles.js`, `screenspec.js`, `screenspec.web.js`. |

`mock(host, screen, ds, stateName, img)` stays the single entry point. Internally:
`if ((ds.target||'mobile')==='web') return mockWeb(...)` else the current phone path.

### tokens() and styles

`tokens(ds)` today emits `--m-*` color vars, `--r-*` radii, `--t-*` type, spacing.
Web adds, layered in this precedence (later wins):

1. **Style preset** (`styles.js`) — default palette + structural flag vars
   (`--shadow-1`, `--border-w`, `--radius-scale`, `--surface-alpha`, …).
2. **Project `design-system.json` tokens** — `color.roles`, `shape.scale`,
   `type.scale` still override the preset where present.

Region renderers read only tokens/flags, never a style name — so a card's shadow
is `box-shadow: var(--shadow-1)` and the four styles differ purely by variable
value (`fluent`/`material` set it, `neo-flat` sets it to `none`).

### Mobile device frames (fixed library)

Today the phone frame is hardcoded (390pt width, dynamic island, home indicator).
Parameterize it from a **fixed `DEVICES` table** — a small preset library, chosen
via `device` on the mobile `design-system.json`; unknown/absent ⇒ `iphone`:

| `device` | Size (pt) | Chrome |
|---|---|---|
| `iphone` *(default)* | 390 × 844 | Dynamic island, home indicator, ~52px corner |
| `iphone-max` | 430 × 932 | Dynamic island, home indicator |
| `android` | 412 × 915 | Punch-hole status bar, gesture pill, tighter corner |
| `iphone-se` | 375 × 667 | Top status bar, physical home button, smaller corner |

Only the frame geometry + status/home chrome vary; all region rendering, states,
and the tab bar are unchanged. The `iphone` preset reproduces today's frame
byte-for-byte (this is what keeps the golden test green). This is device
*geometry*, distinct from visual *style* (which stays web-only per the locked
decision). Lives in `screenspec.js` (mobile path); `mock()` reads
`DEVICES[ds.device || 'iphone']`.

### Responsive frame (web)

- Browser chrome: a slim bar (three dots + a URL pill showing the flow/screen),
  wrapping a viewport whose width = the active breakpoint.
- **Breakpoint toggle**: a segmented control (`Mobile-web / Tablet / Desktop`) per
  page, default Desktop. On change, the web glue **rebuilds each mock** at the
  selected breakpoint (calls `mockWeb` again with the new width) — deterministic
  chrome swap (sidebar ⇄ hamburger) rather than a CSS reflow, which discrete
  chrome changes don't express cleanly. One listener drives the whole page; the
  authoritative spec/tables below the mocks are breakpoint-independent and are not
  rebuilt.
- Chrome per breakpoint:
  - **desktop / tablet**: `nav.kind: page` → top-nav bar + centered max-width
    column; `nav.kind: split` → left sidebar + fluid content.
  - **mobile-web**: nav collapses to a hamburger top bar, single column, no device
    notch/home-indicator (it is a browser, not a phone).
- `nav.kind` mapping: unknown/absent ⇒ `page`. `modal` ⇒ dimmed page + centered
  card; `drawer` ⇒ right/left side panel over dimmed page; `panel` ⇒ inline.

### Web regions

Existing region types render unchanged (they are structural). Web adds four
renderers in `screenspec.web.js`, each also added to the component inventory:
`topnav`, `sidebar`, `datatable`, `breadcrumb`. Existing `cta`/`row`/`card`/etc.
reused as-is.

### Platform Call generalization

Schema Call becomes `{ topic, a, b, chose, why }`. Backward compat:
- Reader resolves `a` ← `a || md3`, `b` ← `b || ios`.
- `chose` accepts `a|b` and legacy `md3|ios` (mapped to `a|b`).
- Label text is target-aware: mobile prints "MD3 / iOS", web prints
  "<style> / native".

The index and flow Call renderers in `build-screens.mjs` switch label text on
`ds.target`; the underlying data path is unified.

## References split

- `references/schema.md` — SHARED contract. Generalize the Call section; add
  `target` and `style` to the top-level object; move iOS/MD3 prose out.
- `references/targets/mobile.md` (new) — phone frame, the 4-device `DEVICES`
  library + `device` field, mobile `nav.kind` (`push/root/sheet/dialog/fullscreen`),
  MD3-vs-iOS calls, SF Symbols, tab bar.
- `references/targets/web.md` (new) — browser frame + three breakpoints, web
  `nav.kind`, the four styles (what each looks like, when to pick), style-vs-native
  calls, hover/focus/keyboard states, web regions, a **"Working with
  frontend-design"** subsection (presets are structural bases; get the identity
  from the plugin; the `type.fonts` seam; copy-as-design-material).
- `references/verifying.md` — add: no sideways scroll **at each breakpoint**,
  `:focus-visible` present on interactive regions, `prefers-reduced-motion`
  respected, style spot-check (shadow/border/radius match the chosen preset),
  correct nav chrome per kind.
- `SKILL.md` — workflow names `target`/`style` in `design-system.json`; drop the
  "mobile-only" caveat; point to the two target references. Update the designer
  agent (feature-development) to drop the mobile-only warning once shipped.

## Data flow (unchanged shape)

`design-system.json` (+ `target`/`style`) + `*.screens.json`
→ `build-screens.mjs` → per-flow HTML + index. Each page inlines
`styles.js + screenspec.js + screenspec.web.js`; browser glue renders mocks via
`ScreenSpec.mock`, dispatching to mobile or web by `ds.target`.

## Error handling / edge cases

- Unknown `style` ⇒ fall back to `material` + a `console.warn` in the page and a
  build-time stderr notice (never silently mis-style).
- Unknown `target` ⇒ treat as `mobile` (safe default), build-time notice.
- `target: web` with mobile-only `nav.kind` (`sheet`, `push`) ⇒ map to nearest
  web kind (`sheet`→`drawer`, `push`→`page`) and note it.
- Existing mobile specs: no `target` ⇒ mobile path, output unchanged (golden test).

## Verification

This is skill development, not test-first application code — most of the
deliverable is reference prose and a DOM-building renderer. No red-green-refactor
ceremony on `mock()` or the `.md` files. Two kinds of automated check earn their
place as **regression insurance**, and the visual result is confirmed by looking:

**Regression guards** — Node `--test` (repo harness), pure/string layer only
(DOM `mock()` is browser-only):

1. **Golden mobile test** — an existing mobile fixture renders byte-identical
   before/after. This is the guard that lets the mobile refactor proceed safely;
   it is the single most important check.
2. `styleVars(style)` emits the expected flag vars for each of the four styles;
   unknown style falls back to `material`.
3. `tokens(ds)` with `target: web` includes style vars; project `color.roles`
   override preset defaults.
4. `applyState` regression-locked against a fixture (unchanged from today).
5. Call reader: `{md3, ios, chose:'ios'}` and `{a, b, chose:'b'}` resolve
   identically; label text differs by target.
6. Target dispatch seam: `frameKind(ds)` returns `'web' | 'mobile'`.
7. `DEVICES` library: each of the 4 device presets resolves to its size/chrome;
   absent/unknown `device` ⇒ `iphone` = today's geometry (covered by the golden
   test).

**Build smoke tests** — run `build-screens.mjs` on fixtures, grep output for the
browser frame, breakpoint toggle, the chosen style's signature var, and the
absence of iOS-only strings (`SF Symbol`, tab-bar class) in web pages.

Fixtures live under `scripts/__fixtures__/` (tiny hand-written design systems +
one screen each). No dependency on benchmark's real specs.

**Visual confirmation (manual, this build)** — render the generated pages in a
browser and look: chrome, all three breakpoints, each of the four styles, focus
rings, reduced-motion. This is human/agent inspection, not an automated harness.
Automated screenshot pixel-diff is deliberately NOT built here — see follow-ups.

## frontend-design integration

`screen-specs` (web) and Anthropic's `frontend-design` plugin are complementary,
and they meet at `design-system.json`:

- **`frontend-design` decides the look** — a distinctive, non-templated token
  system (4–6 hex palette, a display+body+utility type pairing, a signature
  element, a layout concept). **`screen-specs` renders and traces it** — structure,
  states, a11y ids, criterion coverage.
- **The four style presets are STRUCTURAL bases, never final identities.** A preset
  supplies depth character (shadow / border / radius / surface-alpha) and the a11y
  floor; the project's palette and type come from `frontend-design` and override
  the preset via `color.roles` / `type`. This is what keeps output off
  `frontend-design`'s three generic-default clusters — the preset is a starting
  chassis, the identity is chosen per brief.
- **Designer web workflow** (feature-development `designer`): when the
  `frontend-design` plugin is available, invoke it FIRST for aesthetic direction,
  express its token system in `design-system.json` (pick the nearest style preset
  as the structural base, then override palette + type), then author screens and
  build. Named in the agent body as a recommended companion — not a hard
  `skills-on-demand` dependency, since it is a separately-installed Anthropic
  plugin, not a skills.json repo skill.
- **Renderer honors a real type system**: web `tokens()` reads
  `ds.type.fonts = { display, body, mono }` → CSS font-family vars, so a
  `frontend-design` type pairing renders. Custom web-font *loading* (a `@font-face`
  or link) is the design system's own concern; the renderer honors the family
  names and falls back to system stacks offline.
- **Quality floor (shared with `frontend-design`)**: web output is responsive to
  mobile-web (already), shows visible `:focus-visible` rings on interactive
  regions, and respects `prefers-reduced-motion` (the breakpoint toggle and any
  micro-motion). `references/verifying.md` and the smoke tests check these.
- **Copy is design material**: the web reference reiterates `frontend-design`'s
  writing guidance (active-voice CTAs consistent through the flow; error/empty
  states give direction) — consistent with `screen-specs`' existing "real content"
  and "design the ugly states" rules.

## Out of scope (this build) / queued follow-ups

- **`visual-testing` designer skill (queued)** — a separate skill for the
  `designer` role that does automated screenshot-based visual verification of the
  generated pages. Needs real instruments (headless browser + screenshot capture),
  so it is its own skill with its own tooling, not part of this build.
- **Migrating benchmark's real `HYP-*.screens.json` to web** — different repo
  (`~/Development/benchmark`), and it can't start until this skill ships here and
  is synced back. The user's follow-up.
- **Applying the four styles to the mobile frame** — mobile's look is currently
  hardcoded in the static `CSS` array (not fully flag-driven); retrofitting it
  risks the proven phone path. Web is built style-driven now; mobile migration is a
  later, separate effort. (Decision: web-only styles for now.)
- **Per-screen `target`/`style` override** — per-app only for v1.

## Rollout

1. Land modules + tests + references in the sdlc-skills bundle copy.
2. Update the feature-development `designer` AGENT.md: drop the mobile-only
   caveat; note web target + styles, the mobile device library, and the
   `frontend-design` companion step for web aesthetic direction.
3. `npm test` + `npm run validate` green; regenerate marketplaces if descriptions
   change.
4. User syncs the finished skill back to benchmark and migrates real specs.
