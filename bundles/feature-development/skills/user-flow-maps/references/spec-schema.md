# Flow spec contract

One JSON file describes a whole set of flow maps.

```jsonc
{
  "title": "HotelBooking flow maps",       // set title, shown on the index
  "lede":  "One page per promoted hypothesis…",
  "flows": [ /* Flow */ ],
  "composition":      { "flows": [ /* CompositionEntry */ ] },   // optional
  "composition_note": "Two tabs, no more — …",                   // optional
  "findings": [ /* Finding */ ]                                  // optional
}
```

## Flow

| Field | Type | Notes |
|---|---|---|
| `key` | string | Short id (`HYP-001`). Becomes the filename and nav label. |
| `title` | string | Full title. A leading `Flow map — ` is stripped. |
| `page_title` | string | Optional `<title>` override. |
| `trigger` | string | **What the user is trying to do.** Becomes the page description. Without it the page falls back to boilerplate — supply it. |
| `persona` | string | Comma-separated; rendered as chips. |
| `bet` | string | The hypothesis this flow serves, shown in the scope card. |
| `tab`, `stack` | string | Where the flow sits in the app. |
| `entered_from` | string[] | Inbound routes, listed on the page. |
| `hands_off_to` | string[] | Outbound routes. Also resolves End markers. |
| `outs` | `{flow,note}[]` | Parsed handoffs, used to name End markers. |
| `names` | `{key: label}` | Flow key → readable name for End markers. |
| `keys` | `{word: flowKey}` | Keyword → flow, used to resolve `exit-*` targets. |
| `notes` | string[] | Authoring notes; folded into a collapsed `<details>`. |
| `file` | string | Source path, shown in the footer. |
| `nodes` | Node[] | **Required.** |

## Node

| Field | Type | Notes |
|---|---|---|
| `id` | string | **Layout instruction.** Whole numbers = main row in order; decimals = branches above their parent step. |
| `label` | string | Caption above (main row) or below (branch row) the shape. |
| `archetype` | string | Skeleton to draw — `list`, `detail`, `form`, `dialog`, `confirmation`, `empty-state`, `error-state`, `loading-state`, `notice`, `split`, `handoff`. Omit for decisions. |
| `regions` | string[] | 3–6 ordered content blocks, top to bottom. Structural only — what information is present, never how it looks. |
| `decision` | `{question, outcomes:[{label,target}]}` | Renders a diamond. Outcome labels are drawn on their edges. |
| `transitions` | Transition[] | Outgoing edges. |

A node with `archetype: "handoff"` (or a label starting `[Handoff]`) is treated
as the end of the flow and gets an End marker naming its destination.

## Transition

| Field | Type | Notes |
|---|---|---|
| `target` | string \| null | Another node's `id`, or an out-of-flow token (`exit-search`, `exit-bookings`). `null` or unknown ⇒ End marker. |
| `trigger` | string | What causes the move. Shown in the edge table. |
| `kind` | `"primary"` \| `"conditional"` | Solid vs dashed. |
| `nav` | string | `push`, `pop`, `sheet`, `tab-switch`, `same-screen`… |
| `ac` | string | Criterion id(s) — `AC-2.4`, `AC-1.1/1.2`. Trailing prose is kept as a note rather than chipped. |

## CompositionEntry

`{ id, label, tab, stack_position, entry_points[], exit_points[] }`

## Finding

`{ group, title, body, tone }` — `tone` is `""` (problem), `warn`, or `ok`.
Grouped into cards on the index. Use these for anything the drawing exposed
that has no node.

## Worked example

```json
{
  "title": "Checkout flow",
  "flows": [{
    "key": "CHK",
    "title": "Checkout & payment",
    "trigger": "A shopper with a full basket wants to pay and be done.",
    "persona": "returning-buyer",
    "names": { "CHK": "Checkout", "ORD": "Orders" },
    "keys":  { "orders": "ORD" },
    "outs":  [{ "flow": "ORD", "note": "after confirmation" }],
    "nodes": [
      { "id": "0", "label": "Basket", "archetype": "list",
        "regions": ["line items ×3", "subtotal", "Checkout button"],
        "transitions": [
          { "target": "1", "trigger": "taps Checkout", "kind": "primary", "nav": "push", "ac": "AC-1.1" }
        ] },
      { "id": "1", "label": "Basket still valid?",
        "decision": { "question": "Is every line still purchasable?",
                      "outcomes": [{ "label": "Yes", "target": "2" },
                                   { "label": "No",  "target": "1.1" }] },
        "transitions": [
          { "target": "2",   "trigger": "all lines valid",   "kind": "primary",     "nav": "same-screen", "ac": "AC-1.2" },
          { "target": "1.1", "trigger": "a line went away",  "kind": "conditional", "nav": "same-screen", "ac": "AC-1.3" }
        ] },
      { "id": "1.1", "label": "Line Unavailable", "archetype": "notice",
        "regions": ["what changed", "updated total", "Continue / Remove"],
        "transitions": [{ "target": "0", "trigger": "taps Remove", "kind": "primary", "nav": "pop", "ac": "AC-1.3" }] },
      { "id": "2", "label": "Confirmation", "archetype": "confirmation",
        "regions": ["order number", "summary", "View Orders"],
        "transitions": [{ "target": "exit-orders", "trigger": "taps View Orders", "kind": "primary", "nav": "tab-switch", "ac": "AC-1.4" }] }
    ]
  }]
}
```

Four nodes, one branch, one exit — the renderer places all of it, draws the
Start marker before node `0`, and resolves `exit-orders` to an End marker
reading “→ ORD Orders”.
