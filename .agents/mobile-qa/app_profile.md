---
app_name: MobitruDemo
bundle_id: com.epam.mobitru
platform: android
app_type: native
runner_mode: device-farm
build_path: C:\MyDevelopment\sdlc-skills\bundles\mobile-qa\MobitruDemo.app.1.2.0.apk
last_updated: 2026-06-08
---

# App Profile — MobitruDemo

## Overview

MobitruDemo is a demo Android e-commerce app for mobile QA practice. It presents a catalogue of 12 smartphones, supports add-to-cart and quantity management, and includes a mock checkout flow. Authentication is simplified — a single "Sign in with correct user" button bypasses credentials.

## Platform & Build

| Field | Value |
|-------|-------|
| Platform | Android |
| App type | Native (APK) |
| Runner mode | `device-farm` |
| Bundle ID / Package | `com.epam.mobitru` |
| Build path | `C:\MyDevelopment\sdlc-skills\bundles\mobile-qa\MobitruDemo.app.1.2.0.apk` |
| App version | 1.2.0 |

## Test Devices

| Device | OS | Type | Notes |
|--------|----|------|-------|
| Cloud device (auto-allocated) | Android 14 | real | device-farm: allocated from Mobitru pool (serial `3B080DLJG0004E` observed 2026-06-08 — serials change per session) |
| Pixel 6 Emulator | Android 13 (API 33, x86_64) | emulator | Legacy appium mode only; device name: `emulator-5554` |

## Device Farm Preferences

| Platform | Preferred OS version | Notes |
|----------|---------------------|-------|
| android | 14 | Verified on OS 14 — UI and locators identical to emulator |

## Mobitru Artifact

| Field | Value |
|-------|-------|
| Artifact ID | `eb6ad288-4212-4c1c-8ad0-3d77406ed4a7` |
| Alias | `MobitruDemo-1.2.0` |
| Status | verified |
| Note | Re-upload only needed if APK changes; ID persists in Mobitru workspace |

## Authentication

| Field | Value |
|-------|-------|
| Auth method | One-tap mock login (no credentials required) |
| Login entry | Launch screen |
| Quick login | Tap "Sign in with correct user" → lands on Product List |
| Manual login | Login + Password fields present but not used in automated flows |
| Biometric | "Biometric authentication" button present — not automated |

## Key Flows

### Flow 1 — Login
1. App launches on Login screen
2. Tap `id:com.epam.mobitru:id/type_and_login` ("Sign in with correct user")
3. → Product List screen

### Flow 2 — Browse Product List
1. Product list shows 12 phones in 2-column grid
2. Scroll down to see all items
3. Tap product card (`label:"Phone image. {name}. Price: ${price}"`) to open detail

### Flow 3 — Add Product to Cart
1. On Product List, tap `label:"Add to cart {product name}"`
2. Button changes to "Added to cart" — label becomes `"Added to cart. Activate to remove {product name} from cart"`
3. Cart counter in header updates: `"Cart (N)"`

### Flow 4 — View Cart
1. Tap Cart header button (`label:"Cart (N)"`)
2. → Cart screen ("My Cart")
3. Items listed with Remove (trash) + Plus (+) quantity controls and price
4. Tap "Continue to checkout" to proceed

## Screens

### Login (`screenshots/df_01_login.png`)
- Mobitru logo, subtitle, Login + Password fields, Sign in button, Sign in with correct user button, Biometric button

### Product List (`screenshots/df_02_product_list.png`)
- Header: Mobitru logo + Cart counter (`"Cart (N)"`)
- "Mobile phones (12)" heading + Price sort toggle
- 2-column product grid with discount badges (-10%, -15%)
- Bottom nav: Home / Orders / Account

### After Add to Cart (`screenshots/df_03_after_add_to_cart.png`)
- Button state: "Added to cart" (outline, secondary style)
- Cart counter increments immediately
- **Real device label**: `"Added to cart. Activate to remove {product name} from cart"`

### Cart (`screenshots/df_04_cart.png`)
- "My Cart" title + back (Navigate up) button
- "Apply promo code" button at top
- Cart items: product image, name, Remove (trash icon) + quantity display + Plus (+) button + price
- "Continue to checkout" CTA fixed at bottom

## Reliable Locators

All locators verified on real Android 14 device — identical to emulator.

### Login Screen

| Element | Strategy | Selector |
|---------|----------|----------|
| Login field | xpath | `//android.widget.LinearLayout[@resource-id="com.epam.mobitru:id/login_email"]/android.widget.FrameLayout/android.widget.EditText` |
| Password field | xpath | `//android.widget.LinearLayout[@resource-id="com.epam.mobitru:id/login_password"]/android.widget.FrameLayout/android.widget.EditText` |
| Show password toggle | accessibility id | `Show password` |
| Sign in button | id | `com.epam.mobitru:id/login_signin` |
| Sign in with correct user | id | `com.epam.mobitru:id/type_and_login` |
| Biometric button | id | `com.epam.mobitru:id/login_bio` |

### Product List Screen

| Element | Strategy | Selector |
|---------|----------|----------|
| Cart header button | label (contains) | `Cart (` |
| Sort toggle | id | `com.epam.mobitru:id/sortBy` |
| Product list (RecyclerView) | id | `com.epam.mobitru:id/product_list` |
| Product card (no discount) | label | `Phone image. {name}. Price: ${price}` |
| Product card (discounted) | label | `Phone image. {name}. Discount: -{pct}%. Price: ${orig}. Price before: ${disc}` |
| Add to cart button | label | `Add to cart {product name}` |
| Added to cart button | label | `Added to cart. Activate to remove {product name} from cart` |
| Bottom nav — Home | label | `Home` |
| Bottom nav — Orders | label | `Orders` |
| Bottom nav — Account | label | `Account` |

### Cart Screen

| Element | Strategy | Selector |
|---------|----------|----------|
| Back (Navigate up) | label | `Navigate up` |
| Apply promo code | id | `com.epam.mobitru:id/apply_promo_code` |
| Cart items list (RecyclerView) | id | `com.epam.mobitru:id/cart_list` |
| Remove item (trash icon) | label | `Remove` |
| Increase quantity (+) | label | `Plus` |
| Continue to checkout | id | `com.epam.mobitru:id/continue_to_checkout` |

## Gestures Map

| Gesture | Where | Purpose |
|---------|-------|---------|
| Swipe up | Product list | Scroll to see more products (12 total, ~4 visible at once) |

## System Permissions Required

None observed during explored flows.

## State Model

Used by `mobile-suite-planner` to group TCs into sessions and determine which TCs can inherit state from the previous TC (skipping full setup).

### State Dimensions

| Dimension | Possible Values | Notes |
|-----------|----------------|-------|
| `auth` | `logged_out`, `logged_in` | `logged_out` = Login screen shown; `logged_in` = past login |
| `screen` | `login`, `product_list`, `cart`, `checkout` | Current foreground screen |
| `cart` | `empty`, `has_items` | Whether the cart contains ≥1 item |

### Boundary Rules

A TC can inherit state from the previous TC **only if** both conditions hold:
1. The previous TC's `postcondition_state` exactly matches this TC's `precondition_state` (all fields).
2. The previous TC PASSed — a FAIL invalidates state; the next TC must restart fresh.

If the previous TC FAILed → runner sets `inherit_state: false` regardless of plan; run-lead must start a fresh session for the next TC in the group.

### Reset Cost Reference

| Reset type | Typical overhead |
|-----------|-----------------|
| Full reset (terminate → launch → login) | ~40–60 s per TC |
| State-inherit (no reset) | ~0 s (continue on current screen) |
| Orientation-only reset | ~5 s |

## Suggested Test Suites

| Suite | Folder | Priority | Description |
|-------|--------|----------|-------------|
| smoke | tasks/smoke/ | Every build | 4 critical happy-path TCs (login → browse → add to cart → cart) |

## Fragile Areas

- **Device orientation** — farm devices may come in LANDSCAPE; app layout breaks in landscape. Call `mobile_set_orientation → portrait` both after `mobile_appium_init` AND after `mobile_launch_app` — some devices (confirmed on `4B071FDAP001H9`) reset orientation on app start.
- **Product card accessibility labels** include price — locators break if prices change between builds
- **"Added to cart" button label** is different from button text — use label `"Added to cart. Activate to remove {product name} from cart"` not text `"Added to cart"` when checking state on real devices
- **No quantity decrease (−) button** — only Remove and Plus (+) exist on Cart screen

## Out of Scope / Manual Setup Required

- Biometric flows (requires enrolled real device)
- Checkout flow beyond "Continue to checkout" (not implemented in demo app)
- Push notifications

## Setup for Runners

### Device Farm Mode (primary)

```
runner_mode: device-farm
artifact_id: eb6ad288-4212-4c1c-8ad0-3d77406ed4a7
package: com.epam.mobitru
platform: android
preferred_os_version: "14"
orientation: portrait
```

**Architecture: one device per suite, not per TC.**

`mobile-run-lead` books the device and installs the app **once** before the suite, passes the serial to each runner, and releases the device after all TCs complete. Runners do not book or release.

**Important notes:**

- **Device serial is dynamic.** Farm is shared — `find_device` returns a different device each time. Never hard-code the serial.
- **Install app once per suite.** `device_farm_install_app` called by the lead before TC-001. Runners reuse the same installation.
- **Enforce PORTRAIT per TC.** Call `mobile_set_orientation → portrait` both after `mobile_appium_init` AND after `mobile_launch_app` — some devices reset orientation on app start (confirmed on `4B071FDAP001H9`).

Suite flow (run-lead, once):
1. `check_device_farm_status`
2. `device_farm_find_device` → `{ platform: "android", osVersion: "14" }`
3. `device_farm_take_device_by_id` → store as `suite_serial`
4. `device_farm_install_app` → `{ artifactID: "eb6ad288-4212-4c1c-8ad0-3d77406ed4a7", serial: "..." }`
5. `mobile_appium_init` → `{ deviceSerial: "{suite_serial}", useDeviceFarm: true, sessionType: "native" }`
6. `mobile_set_orientation` → `portrait`
7. → dispatch each TC runner (session is alive in MCP server — runners inherit it)
8. `mobile_appium_close` → `device_farm_release_device` → after all TCs done

Per-TC flow (runner, session pre-initialized by lead):
1. `mobile_terminate_app` → `{ packageName: "com.epam.mobitru" }` (clean start; no-op if not running)
2. `mobile_launch_app` → `{ packageName: "com.epam.mobitru" }`
3. `mobile_set_orientation` → `portrait`  ← once, after launch
4. ... run test steps ...
5. `mobile_terminate_app` → end of TC; session stays alive for next runner

### Appium Mode (local emulator, legacy)

```
appium_capabilities:
  platformName: Android
  appium:app: C:\MyDevelopment\sdlc-skills\bundles\mobile-qa\MobitruDemo.app.1.2.0.apk
  appium:deviceName: emulator-5554
  appium:automationName: UiAutomator2
  appium:noReset: false
  remoteServerUrl: http://localhost:4723
```

`noReset: false` clears app data on each session — ensures clean login state.
Start Appium manually: `ANDROID_HOME="/c/Users/olexi/AppData/Local/Android/Sdk" appium`
