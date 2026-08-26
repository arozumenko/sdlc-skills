# Mobile target

`target: "mobile"` (or absent — this is the default). Renders a phone-framed
mock: a device shell around scrolling content, MD3-vs-iOS platform calls, a
bottom tab bar. This is the original renderer; nothing here changed shape when
the web target was added, and a spec with no `target` field renders
byte-for-byte what it always did.

## Device library

The frame is chosen from a small fixed library via `device` on
`design-system.json` — not a new frame invented per project. Unknown or absent
`device` ⇒ `iphone`, which reproduces today's exact geometry.

| `device` | Width × height (pt) | Corner radius | Chrome |
|---|---|---|---|
| `iphone` *(default)* | 390 × 788 | 52px | Dynamic island, home indicator |
| `iphone-max` | 430 × 868 | 56px | Dynamic island, home indicator |
| `android` | 412 × 824 | 40px | Punch-hole status bar, gesture pill |
| `iphone-se` | 375 × 667 | 34px | Top status bar, physical home button |

Only frame geometry and status/home chrome vary by device. Region rendering,
states, and the tab bar are identical across all four — `device` is frame
*geometry*, a different axis from web's `style`, which is visual identity and
does not apply to mobile.

## `nav.kind`

`push` (default) · `root` · `sheet` · `dialog` · `fullscreen`.

- **`push`** — standard nav bar with a back chevron, screen title, optional
  trailing icons.
- **`root`** — top of a tab's stack: large title, no back affordance. Rendering
  both a nav bar and a large title showed the same word twice, so root screens
  get only the large title (plus trailing icons if `nav.trailing` is set).
- **`sheet`** — a bottom sheet over a dimmed, visibly-real screen behind it
  (not a blank scrim) — a drag handle, then content, with any `cta`/
  `secondary-cta` regions pinned to a bottom action bar rather than scrolling
  with the rest.
- **`dialog`** (or `fullscreen` presented as an alert) — a centered dialog over
  the dimmed screen: title, one message, up to three actions — two side by
  side, three or more stacked (iOS's own alert behaviour). A region describing
  the dimmed layer itself ("Account (dimmed behind the dialog)") is scenery,
  not the dialog's message, and is filtered out rather than quoted.
- **`fullscreen`** — full-screen presentation, otherwise chromed like `push`.

## MD3-vs-iOS calls

The mobile `platform` Calls (`schema.md`'s Call section) render under the
heading "Where MD3 and iOS disagreed," with `a`/`chose:'a'` labelled **MD3**
and `b`/`chose:'b'` labelled **iOS**. Per DEC-018: behaviour follows the
platform, surface and styling follow Material. State the call whenever the two
would visibly diverge — a Material date-range picker in a modal vs. a native
`.datePicker` in a sheet, a Material bottom sheet vs. an iOS action sheet, MD3
ripple feedback vs. iOS's dimmed-press state. An unstated blend is what
produces visible seams: a screen that is Material everywhere except one iOS
gesture nobody decided to keep.

## SF Symbols

A nav bar or tab bar is described in prose in the spec — `"share, favorite (SF
Symbols, not text buttons)"` — because that is how a designer would actually
write it. The renderer:

- Strips parentheticals (`(SF Symbols, not text buttons)`) before printing a
  title or trailing label; printing them verbatim is how a mock stops looking
  like an app.
- Splits trailing text on `,` / `/` / `and`, matches each token against a small
  named-glyph table (`share`, `favorite`/`heart`, `close`, `filter`, `map`,
  `search`), and draws the matched icons instead of the words. A token that
  matches nothing falls back to a short text action, the way `Cancel`/`Done`
  read.

Name real, recognisable affordances in `nav.trailing` — the renderer can only
draw what it recognises; an invented icon name prints as text.

## Tab bar

Three fixed tabs — Explore (search glyph), Bookings, Account — the shared
bottom navigation for root-level screens. The glyph key (`search`) is the SF
Symbol identity and does not change if the tab's visible label is renamed
(DEC-031 renamed the first tab from "Search" to "Explore" without touching the
glyph). `active` selects which tab is highlighted; it does not add or remove
tabs.
