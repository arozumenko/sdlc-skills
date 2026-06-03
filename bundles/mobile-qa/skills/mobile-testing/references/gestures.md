# Mobile Gestures Reference

## Playwright Mode (PWA / Hybrid)

Playwright MCP handles touch automatically when mobile viewport is enabled. Map TC verbs to Playwright actions:

| TC Verb | Playwright MCP action | Notes |
|---------|----------------------|-------|
| Tap | `click` | Touch events fire automatically in mobile viewport |
| Double-tap | `dblclick` | |
| Long-press | `hover` (1000ms timeout) | Approximate — use evaluate for `pointerdown` if needed |
| Swipe left | Drag from right side of element to left | Use `drag` with start/end coordinates |
| Swipe right | Drag from left to right | |
| Swipe up (scroll) | `wheel` with negative deltaY, or drag upward | |
| Swipe down (scroll) | `wheel` with positive deltaY, or drag downward | |
| Pull-to-refresh | Drag from top of page downward 150px+ | Requires networkidle wait after |
| Pinch in (zoom out) | Not directly supported — document as manual step | |
| Pinch out (zoom in) | Not directly supported — document as manual step | |
| Scroll to element | `scroll_into_view` / evaluate `scrollIntoView()` | |
| Accept dialog | `handle_dialog` → accept | Works for both permission dialogs and browser alerts |
| Dismiss dialog | `handle_dialog` → dismiss | |

### Swipe Implementation Pattern

```
// Swipe left on a carousel element
drag(
  startX: element.x + element.width * 0.8,
  startY: element.y + element.height * 0.5,
  endX:   element.x + element.width * 0.2,
  endY:   element.y + element.height * 0.5
)
```

---

## Manual Mode (Native iOS / Android)

Describe gestures in human-readable terms in the execution guide:

| TC Verb | Guide description |
|---------|-----------------|
| Tap | "Tap [element] with your finger" |
| Double-tap | "Quickly double-tap [element]" |
| Long-press | "Press and hold [element] for 1–2 seconds until the context menu / action appears" |
| Swipe left | "Swipe left across [element] — start from the right third and end at the left edge" |
| Swipe right | "Swipe right across [element]" |
| Swipe up | "Scroll up by swiping upward from the bottom of [element]" |
| Swipe down | "Pull down from the top of the list to trigger refresh" |
| Pinch in | "Place two fingers on [element] and pinch them together to zoom out" |
| Pinch out | "Place two fingers on [element] and spread them apart to zoom in" |
| Rotate device | "Rotate the device to landscape/portrait orientation" |
| Press Home | "Press the Home button (iOS: swipe up from bottom; Android: press ⊙)" |
| Press Back | "Tap the system Back button (Android) / swipe right from left edge (iOS)" |
| Accept permission | "Tap 'Allow' on the system permission dialog" |
| Deny permission | "Tap 'Don't Allow' / 'Deny' on the system permission dialog" |
| Open deep link | "Open Safari/Chrome and navigate to `{scheme}://path`" |

---

## Appium Mode (Future Reference)

When Appium MCP is available, use these W3C Actions:

```json
// Tap at coordinate
{ "action": "pointer", "type": "pointerDown", "x": 200, "y": 400 }
{ "action": "pause", "duration": 50 }
{ "action": "pointer", "type": "pointerUp" }

// Swipe left
{ "action": "pointer", "type": "pointerDown", "x": 800, "y": 400 }
{ "action": "pause", "duration": 300 }
{ "action": "pointer", "type": "pointerMove", "x": 100, "y": 400, "duration": 300 }
{ "action": "pointer", "type": "pointerUp" }
```

iOS scroll via `mobile: scroll`:
```json
{ "script": "mobile: scroll", "args": [{ "direction": "down" }] }
```
