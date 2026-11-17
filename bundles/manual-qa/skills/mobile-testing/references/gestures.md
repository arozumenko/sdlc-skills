# Mobile Gestures Reference

## Adb Mode — `adb shell input`

Coordinates are device pixels, taken from the centre of a node's bounds in the latest UI read. Always `adb -s <serial> shell ...`.

| TC verb | Command | Notes |
|---------|---------|-------|
| Tap | `input tap X Y` | synthetic event |
| Real-length press | `input swipe X Y X Y 150` | same start and end point |
| Double-tap | two `input tap X Y` in one shell call | `input tap X Y; input tap X Y` |
| Long-press | `input swipe X Y X Y 1000` | |
| Swipe left / right / up / down | `input swipe X1 Y1 X2 Y2 300` | 80% → 20% of the scrollable node's bounds |
| Drag (scrub, slider) | `input swipe X1 Y1 X2 Y2 600` | a longer duration holds the drag |
| Type text | `input text 'word%sword'` | `%s` is a space; focus the field first |
| Hide keyboard | `input keyevent 111` | ESCAPE |
| Back | `input keyevent 4` | can close a sheet or leave the screen |
| Home | `input keyevent 3` | |

Synthetic input cannot prove that a real finger gesture survives (a build that drops real presses can still pass `input tap`). Use the project toolkit's real-event command for gesture-survival checks, or report BLOCKED.

## Appium Mode — Appium MCP Tool Parameters

All gestures go through `appium_gesture`. Pass the action and parameters as shown.

### Tap
```json
{ "action": "tap", "elementId": "<element_id_from_find_element>" }
// or by coordinate:
{ "action": "tap", "x": 200, "y": 400 }
```

### Double-tap
```json
{ "action": "doubleTap", "elementId": "<element_id>" }
```

### Long-press
```json
{ "action": "longPress", "elementId": "<element_id>", "duration": 1500 }
```

### Swipe
```json
{ "action": "swipe", "direction": "left" }
{ "action": "swipe", "direction": "right" }
{ "action": "swipe", "direction": "up" }
{ "action": "swipe", "direction": "down" }
// Precise coordinate swipe:
{ "action": "swipe", "startX": 800, "startY": 400, "endX": 100, "endY": 400, "duration": 300 }
```

### Scroll
```json
{ "action": "scroll", "direction": "down", "distance": 0.5 }
// distance: 0.0–1.0 (fraction of screen height)
```

### Pinch / Zoom (via appium_perform_actions)
```json
[
  { "type": "pointer", "id": "finger1", "actions": [
    { "type": "pointerDown", "x": 200, "y": 400 },
    { "type": "pointerMove", "x": 100, "y": 400, "duration": 500 },
    { "type": "pointerUp" }
  ]},
  { "type": "pointer", "id": "finger2", "actions": [
    { "type": "pointerDown", "x": 300, "y": 400 },
    { "type": "pointerMove", "x": 400, "y": 400, "duration": 500 },
    { "type": "pointerUp" }
  ]}
]
```

### Drag and Drop
```json
// via appium_drag_and_drop:
{ "sourceElementId": "<id>", "targetElementId": "<id>" }
```

### System Buttons
```json
// via appium_mobile_device_control:
{ "action": "pressButton", "name": "home" }    // iOS: Home
{ "action": "pressButton", "name": "back" }    // Android: Back
{ "action": "open_notifications" }             // Android only: notification shade
```

### Permission Dialogs
```json
// via appium_alert (when system dialog appears):
{ "action": "accept" }    // "Allow" / "OK"
{ "action": "dismiss" }   // "Don't Allow" / "Deny"

// or via appium_mobile_permissions (Android, pre-grant):
{ "action": "grant", "appPackage": "com.example.app", "permissions": ["android.permission.CAMERA"] }
```

### Device Orientation
```json
// via appium_orientation:
{ "orientation": "LANDSCAPE" }
{ "orientation": "PORTRAIT" }
```

---

## Device Farm Mode — Mobitru MCP Tool Mapping

| TC Verb | Mobitru Tool | Notes |
|---------|-------------|-------|
| `Tap X` | `mobile_click_web_element` or `mobile_click_on_screen_at_coordinates` | Prefer element-based |
| `Double-tap` | `mobile_click_on_screen_at_coordinates` twice | |
| `Long-press X` | `continuous_swipe_on_screen` with minimal movement at target | Approximation |
| `Swipe left/right/up/down` | `swipe_on_screen` → direction param | |
| `Enter {value}` | `mobile_click_web_element` → `mobile_type_keys` | |
| `Press Home` | `mobile_press_button` → `HOME` | |
| `Press Back` | `mobile_press_button` → `BACK` | Android only |
| `Accept permission` | `mobile_click_web_element` → "Allow" | |
| `Deny permission` | `mobile_click_web_element` → "Deny" / "Don't Allow" | |
| `Biometric: success` | `device_farm_inject_touch` → `{ touchValid: true }` | Never BLOCKED |
| `Biometric: failure` | `device_farm_inject_touch` → `{ touchValid: false }` | Never BLOCKED |
| `Camera: inject image` | `device_farm_inject_image` → `{ filePath: "..." }` | Never BLOCKED |
| `Change orientation` | `mobile_set_orientation` | |

---

## Playwright Mode — Touch Action Mapping (PWA / Hybrid)

| TC Verb | Playwright MCP action | Parameters |
|---------|----------------------|-----------|
| Tap | `click` | element selector |
| Double-tap | `dblclick` | element selector |
| Long-press | `hover` (1000ms) | element selector |
| Swipe left | `drag` | startX: 80% width → endX: 20% width |
| Swipe right | `drag` | startX: 20% width → endX: 80% width |
| Swipe up | `drag` | startY: 80% height → endY: 20% height |
| Swipe down | `drag` | startY: 20% height → endY: 80% height |
| Scroll | `wheel` or drag | deltaY for direction |
| Accept dialog | `handle_dialog` | accept |
| Dismiss dialog | `handle_dialog` | dismiss |

### Playwright Swipe Pattern

```js
// Swipe left on a carousel (coordinates via evaluate):
// Start at 80% of element width, end at 20%
drag(
  startX: elementBounds.x + elementBounds.width * 0.8,
  startY: elementBounds.y + elementBounds.height * 0.5,
  endX:   elementBounds.x + elementBounds.width * 0.2,
  endY:   elementBounds.y + elementBounds.height * 0.5
)
```

---

## Manual Mode — Human-Readable Guide Descriptions

When writing step guides (Part 7), describe gestures unambiguously:

| TC Verb | Guide wording |
|---------|--------------|
| Tap | "Tap **[element label]** with one finger" |
| Double-tap | "Quickly double-tap **[element]**" |
| Long-press | "Press and hold **[element]** for 1–2 seconds until the context menu appears" |
| Swipe left | "Swipe left across **[element]** — start at the right edge, end at the left" |
| Swipe right | "Swipe right across **[element]**" |
| Pull-to-refresh | "Pull the list down past the loading indicator, then release" |
| Pinch in | "Place two fingers on **[element]** and pinch together to zoom out" |
| Pinch out | "Spread two fingers apart on **[element]** to zoom in" |
| Rotate | "Rotate the device to **landscape / portrait** orientation" |
| Press Home | "iOS: swipe up from the bottom edge. Android: press ⊙ Home button" |
| Press Back | "Android: press ← Back. iOS: swipe right from the left screen edge" |
| Accept permission | "Tap **Allow** (or **OK**) on the system permission dialog" |
| Deny permission | "Tap **Don't Allow** (or **Deny**) on the system permission dialog" |
| Open deep link | "Open the browser and navigate to `{scheme}://path`" |
