# Web target

`target: "web"` on `design-system.json`. Renders a browser-framed, responsive
mock — a slim browser bar (three dots + a URL pill) around a viewport sized to
one of three breakpoints — instead of a phone. Region rendering, states, and
the `changes` mechanic are unchanged from mobile; what differs is the frame,
the nav chrome, four extra region types, and a chosen visual **style**.

## Breakpoints and the toggle

| Breakpoint | Width |
|---|---|
| `mobile-web` | 400px |
| `tablet` | 768px |
| `desktop` | 1280px *(default)* |

Every page with `target: web` gets a segmented toggle (Mobile-web / Tablet /
Desktop) that **rebuilds** every mock on the page at the chosen width — a
deterministic chrome swap (sidebar ⇄ hamburger), not a CSS reflow, because the
chrome differences are discrete, not fluid. One toggle drives the whole page;
the spec/state tables below the mocks are breakpoint-independent and are not
rebuilt.

At the `mobile-web` breakpoint, non-`split` nav kinds collapse their top nav to
a hamburger strip (burger icon + brand, no nav items) and render single-column.
**`split` does not collapse** — a `nav.kind: split` screen keeps its sidebar at
every breakpoint including `mobile-web`; the renderer does not currently
special-case split at narrow widths, so a split screen that should read as
mobile-first needs a different `nav.kind` for that use, not an assumption the
toggle will fix it.

## `nav.kind`

`page` (default) · `split` · `modal` · `drawer` · `panel`. Mobile kinds map
onto these when a design system reuses mobile vocabulary under `target: web`:

| Mobile kind | Maps to |
|---|---|
| `push` | `page` |
| `root` | `page` |
| `fullscreen` | `page` |
| `sheet` | `drawer` |
| `dialog` | `modal` |

Unknown/absent ⇒ `page`. Only `split` currently changes the frame's own
layout — sidebar (with the screen's nav title + trailing items as a vertical
nav list) beside a fluid content column, versus every other kind's top-nav bar
above a centered, max-width (960px) content column. `modal`, `drawer`, and
`panel` are recorded on the mock (`data-nav="…"`) for a spec to build against,
but render with the same top-nav chrome as `page` today — treat the kind as
the documented intent for the built screen, not yet a distinct rendered
overlay.

## The four styles

`style` on `design-system.json`, consulted only under `target: web`. Default
`material`. Every style is a **structural base to override** — it supplies
depth character (shadow, border weight, corner radius, surface opacity,
motion) and an a11y floor, not a finished brand. A project's real palette and
type come from elsewhere (see *Working with frontend-design* below) and
override the preset's placeholder colors via `color.roles` / `type`. Picking a
style and stopping there is how output lands in a generic-default look;
picking it and then overriding palette + type is the intended path.

- **`material`** — MD3's own depth language: soft two-tier elevation shadows,
  no border, full corner radius, solid-fill buttons, full motion. The safe
  default when the product already speaks Material elsewhere, or when there's
  no reason yet to depart from it.
- **`neo-flat`** — no shadow at all; a 1px border carries every boundary
  instead; tight, near-square corners (`.35` of the base radius scale);
  reduced motion. Reads flat and boxy, high-contrast-friendly, and is the
  right pick when depth cues should come from layout and color, not elevation.
- **`minimal-neutral`** — very quiet shadows (barely-there, low-alpha), a 1px
  border, moderate rounding (`.6`), and a near-monochrome palette shift (a
  near-black primary, off-white surfaces, light neutral outlines). Reads
  restrained and content-first — pick it for dense, information-heavy screens
  (tables, dashboards) where color should not compete with the data.
- **`fluent`** — medium-depth shadows, a 1px border, the roundest corners of
  the four (`.75`), and translucent surfaces (`surface-alpha: .86`, an
  acrylic-like effect). Reads layered and Microsoft-adjacent; pick it for
  productivity surfaces where panels are expected to feel like they're
  floating over one another.

An unrecognised `style` falls back to `material` rather than silently
mis-styling the build.

## Style-vs-native calls

Web `platform` Calls (`schema.md`'s Call section) render under the heading
"Where `<style>` and native differed," with `a`/`chose:'a'` labelled by the
style name (e.g. **Fluent**) and `b`/`chose:'b'` labelled **Native**. Per
DEC-018: structure and interaction follow native browser behaviour (a `select`
behaves like a select, `Enter` submits a form), surface and styling follow the
chosen style. State the call wherever a styled component would otherwise fight
the browser's own behaviour — a custom-styled date field vs. the native
`<input type=date>` picker, a Fluent-styled dropdown vs. the OS's native
`<select>` menu.

## Hover, focus, and keyboard states

There is no separate state mechanism for interaction states — author them the
same way as any other `State` (`schema.md`): a state named `cta-hover` or
`row-keyboard-focus` with a `changes` array that edits the affected region
(e.g. `interactive: true`, or a `content`/`label` change that shows the hover
copy). The renderer does not synthesize hover/focus mocks on its own.

Two things the built page *does* apply globally, not per authored state:

- **`:focus-visible`** — every interactive region in a web build gets a
  visible 3px outline on real keyboard focus (`.webframe :focus-visible{
  outline:3px solid var(--m-primary) }`). This is the a11y floor, always on;
  it doesn't need a spec state to appear when you actually tab through the
  built page.
- **`prefers-reduced-motion`** — the build disables all transitions and
  animations under the OS/browser reduced-motion setting. Check it in the
  browser, not in the spec.

## Web regions

Four region types exist only under `target: web`, in addition to every
existing region type (`cta`, `card`, `row`, … all render unchanged):

| `type` | Renders |
|---|---|
| `breadcrumb` | The region's `content` array joined with `" / "` as a trail. |
| `topnav` | `content` array as a horizontal list of nav-item labels. |
| `sidebar` | `content` array as a vertical list of nav-item labels. |
| `datatable` | `content` array as column headers; up to two data rows are read from the **screen's** `content` (an array of row-arrays, or an array of objects keyed by header) — a missing cell prints `—`. |

`topnav`/`sidebar` **regions** are body content (e.g. a secondary in-page nav)
— distinct from the frame's own top-nav/sidebar chrome, which is drawn from
`screen.nav` (title, trailing items) regardless of whether the spec lists a
`topnav`/`sidebar` region at all.

## Working with `frontend-design`

`screen-specs` (web) and Anthropic's `frontend-design` plugin are
complementary, and they meet at `design-system.json`:

1. **Run `frontend-design` first**, for the aesthetic direction — a
   distinctive, non-templated token system: a 4–6 hex palette, a display+body
   type pairing, a signature element, a layout concept.
2. **Express its tokens in `design-system.json`**: pick the nearest style
   preset above as the structural base (`style`), then override `color.roles`
   with the real palette and `type.fonts = { display, body, mono }` with the
   real type pairing. The renderer honors real font-family names in
   `--font-*` vars and falls back to system stacks when a face isn't loaded —
   loading the web font itself (`@font-face`/link) is the design system's own
   concern, not the renderer's.
3. **Treat copy as design material**, consistent with this skill's existing
   "real content" and "design the ugly states" rules: active-voice CTAs held
   consistent through a whole flow (not "Submit" here and "Continue" there for
   the same action), and error/empty states that give direction rather than
   just naming the problem ("No rooms match these dates — try widening the
   range" beats "No results").

The four style presets exist so `screen-specs` never has to invent a look from
nothing; they are chassis, not identity. Stopping at the preset's placeholder
palette is the failure mode this section exists to prevent.
