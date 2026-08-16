# Screen spec contract

One JSON file per flow. Each describes the screens that flow's nodes realise,
in enough detail that a developer can build the screen without guessing and
without opening a design tool.

These are **agent reference specs**: precise, content-real, and traceable back
to an acceptance criterion. They are not mood boards.

```jsonc
{
  "flow": "HYP-002",
  "title": "Room detail & live availability",
  "system": "docs/design/design-system.json",   // shared tokens + components
  "screens": [ /* Screen */ ]
}
```

## Screen

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable id, `S-002-0`. Used as the anchor and filename fragment. |
| `node` | string \| string[] | The flow node id(s) this screen realises. **Required** — this is the trace back to the flow map. |
| `title` | string | Screen name. Match the flow node label so the two read as one system. |
| `purpose` | string | One sentence: what the person is doing here. |
| `ac` | string[] | Criterion ids this screen satisfies. **Required.** If empty, say why in `notes`. |
| `nav` | object | `{ kind, title, leading, trailing, a11yIds }` — `kind` is `push`, `root`, `sheet`, `dialog`, `fullscreen`. Nav-bar affordances are real controls a test must tap, so name them: `"a11yIds": { "favouriteButton": "roomDetail.favouriteButton", "shareButton": "roomDetail.shareButton" }`. Without this a nav-bar action is unreachable — it is described in prose and has nowhere to carry an identifier. |
| `regions` | Region[] | Ordered top to bottom. The structure of the screen. |
| `states` | State[] | Every state the criteria demand — loading, empty, error, disabled, success. |
| `platform` | Call[] | Where MD3 and iOS conflicted, and which won. Per DEC-018. |
| `content` | object | Real seeded values used in the mock. Never lorem. |
| `a11y` | object | `{ dynamicType, voiceOver, targets, contrast }`. |
| `swiftui` | object | `{ view, navigation, state, notes[] }` — implementation hints, not code. |
| `refs` | Ref[] | Grounding: `{ source, id, url, why }`. Refero screens, or the QloApps path the behaviour came from. |
| `notes` | string[] | Anything unresolved. An open question here is better than an invented answer. |

## Region

The building block. `type` drives both the rendered mock and the component
mapping.

| Field | Type | Notes |
|---|---|---|
| `type` | string | `appbar`, `searchfield`, `chips`, `segmented`, `hero`, `gallery`, `list`, `card`, `row`, `field`, `stepper`, `datefield`, `price`, `banner`, `notice`, `cta`, `secondary-cta`, `divider`, `text`, `empty`, `error`, `skeleton`, `sheet-handle`, `footnote`. |
| `label` | string | What it is, in the user's words. |
| `content` | string \| string[] | The real copy or data shown. |
| `image` | string | Asset name from the seed manifest, e.g. `roomtype_alpine_lodge_02`. |
| `m3` | object | `{ component, tokens: { color, type, shape, elevation } }` — the Material role, named exactly (`surfaceContainerHigh`, `titleMedium`, `cornerLarge`, `level1`). |
| `state` | string | Optional: only shown in this named state. |
| `ac` | string | Optional: the criterion this region exists to satisfy. |
| `interactive` | boolean | Whether it responds to touch. Drives focus/target checks. |
| `a11yIds` | object | For **controls nested inside** a region — a card with a favourite heart, a row with a delete button. `{ "favouriteButton": "searchResults.resultCard.favouriteButton" }`. A region has one `a11yId` for itself; anything independently tappable *within* it needs its own entry here, or a test can reach the container and not the control. |
| `a11yId` | string | **Required for anything interactive or asserted on.** The `.accessibilityIdentifier(...)` the implementation must set — `<screenSlug>.<elementSlug>`, lowerCamelCase (`roomDetail.bookNowButton`). Never derived from visible copy, never localized, and stable across states: a control keeps its id when disabled or re-labelled. Repeating rows share one id and are matched by index; append a stable data key only when a test must target a specific row. See DEC-032. |

## State

`{ name, trigger, changes[], ac }` — include the ugly ones: no availability,
price changed under the user, network failure, empty, disabled-until-valid.

**`changes` must be structured, not prose.** A change is an object targeting one
region; prose strings are ignored by the renderer, so a state written as prose
draws a mock identical to the default and the builder will refuse to draw it at
all. Four forms:

```jsonc
// edit a region
{ "region": "Price summary", "content": ["€612", "3 nights · €204/night"] }

// swap its image
{ "region": "Room gallery", "image": "roomtype_city_view_01" }

// hide it
{ "region": "Saved Hotels — inline empty inset", "hidden": true }

// insert a new one, optionally positioned
{ "type": "card", "after": "Saved Hotels — section header",
  "label": "Saved hotel card",
  "content": ["Birchwood Alpine Lodge", "Chamonix, France", "from €175/night"],
  "image": "roomtype_alpine_lodge_01" }
```

| Key | Meaning |
|---|---|
| `region` | Which region to target — its `label`. Matched exactly, then by stem prefix, then by `type`. |
| `hidden` / `remove` | Drop the region in this state. |
| `after` | For an inserted region: place it after the named one. Appended if omitted. |
| `describe` | Optional prose kept for the reader; ignored by the renderer. |
| `focus` | On the **State** (not a change): the label of the region the mock should scroll into view. See below. |
| anything else | Merged onto the region — `content`, `image`, `label`, `m3`, `interactive`… |

**`focus` — for a change that sits below the fold.** A mock always renders from
the top of the screen. When the region a state alters sits further down — an
inline validation error beside the stepper that triggered it — the mock comes
out looking identical to the default, and the state silently fails to
demonstrate itself. Name the region to bring into view:

```jsonc
{ "name": "occupancy-limit-exceeded",
  "trigger": "guest raises adults above the room's cap",
  "focus": "Occupancy per room",
  "changes": [ /* … */ ] }
```

The mock then opens scrolled to that region, with a fade at the top edge showing
there is content above — which is where the guest would already be, since they
had to reach that control to trigger the state at all.

Match is by leading token, so `"Occupancy per room"` finds
`"Occupancy per room (adults / children)"`. Use `focus` when the change is
genuinely below the fold; do **not** reorder a screen's regions just to avoid
needing it, and do not use it to paper over a message that should have been near
the top in the first place — see `verifying.md` on buried messages for that
distinction.

**Region-local defaults.** A region may name the variant it depicts in its own
`state` field, marking its baseline inline — `"not-favourited (default)"`,
`"zero-saved-hotels (default at first launch)"`. Those survive every view unless
an *adjacent* region matching the active state replaces them, so sibling regions
in one shelf ("card 1 of 4", "card 2 of 4") are never mistaken for alternatives
to each other.

**Commentary does not belong in a region.** Notes for the reader — "2 more cards
scroll off-screen", "capped at ~10 rows (AC-7.8)", "unchanged from S-001-0" —
go in the screen's `notes`, never in a `text` or `footnote` region. A region is
something the user sees. The renderer detects and relocates the obvious cases,
but that is a safety net, not a licence: a mock that prints its own authoring
notes has stopped showing the screen.

## Call (platform decision)

`{ topic, md3, ios, chose, why }` — e.g.

```json
{ "topic": "Date range entry",
  "md3": "Material date-range picker in a modal",
  "ios": "Native .datePicker in a sheet with the system range UI",
  "chose": "ios",
  "why": "DEC-018: behaviour follows the platform. A Material picker on iOS breaks the drag-to-extend gesture people already know." }
```

Every non-obvious conflict gets one. An unstated blend is what produces
visible seams.

## Content

Real values, drawn from the seed data:

```json
{ "hotel": "Alpine Lodge", "roomType": "Deluxe Twin", "nights": 3,
  "price": "€612", "perNight": "€204", "dates": "12–15 Mar",
  "occupancy": "2 adults, 1 child (7)" }
```

If a value would come from the seed set, use one that exists in
`docs/assets/seed-image-manifest.md`. A mock showing "Hotel Name" teaches
nobody anything.

## Rules

1. **Every screen traces to a node and a criterion.** No orphan screens.
2. **Real content only.** The seed set exists so mocks can be honest.
3. **State the platform call** wherever MD3 and iOS disagree.
4. **Name Material tokens exactly** — `surfaceContainerHigh`, not "light grey".
   The developer maps tokens to a palette; adjectives don't map.
5. **Structure, not pixels.** No coordinates, no widths in px. The renderer
   lays it out; you say what is present and in what order.
6. **Give everything testable an `a11yId`.** Interactive elements and anything a
   test asserts on — a price, a banner, an empty state. Test cases are being
   authored against these specs before the app exists, so the identifier agreed
   here is the selector the test will use on arrival. An element without one can
   only be found by visible text or position, which is how a suite becomes flaky
   and then abandoned.
