---
app_name: Mobitru Demo
bundle_id: com.epam.mobitru
platform: android
app_type: native
runner_mode: appium
build_path: already-installed
last_updated: 2026-06-10
---

# App Profile: Mobitru Demo

## Overview

The Mobitru Demo app (com.epam.mobitru) is an Android e-commerce demo app showing a product catalogue with add-to-cart and checkout flows. It includes a "Sign in with correct user" shortcut button that bypasses credential entry — used in all test flows.

## Platform & Build

| Field | Value |
|-------|-------|
| Platform | Android |
| App type | native |
| Runner mode | appium |
| Bundle ID / Package | com.epam.mobitru |
| Build path | already-installed (pre-installed on emulator-5554) |
| App version | 1.2.0 |

## Test Devices

| Device | OS | Type | Notes |
|--------|----|------|-------|
| Pixel 6 Emulator | Android 13 (API 33) | emulator | Appium device name: emulator-5554 |

## Authentication

| Field | Value |
|-------|-------|
| Auth method | tap_button |
| Login entry | Login screen |
| Test user (regular) | No credentials — tap "Sign in with correct user" button (`id: com.epam.mobitru:id/type_and_login`) |

## Session Capabilities (appium)

App is already installed — do NOT pass `app:` capability. Use package/activity launch:

```json
{
  "platformName": "Android",
  "appium:automationName": "UiAutomator2",
  "appium:deviceName": "emulator-5554",
  "appium:appPackage": "com.epam.mobitru",
  "appium:appActivity": "com.epam.mobitru.activity.MainActivity",
  "appium:noReset": false
}
```

If `appActivity` is wrong, try:
- `com.epam.mobitru.MainActivity`
- `.MainActivity`
- discover via `appium_get_page_source` after `appium_app_lifecycle launch`

For reset between TCs (inherit_state: false): use `appium_app_lifecycle terminate` → `appium_app_lifecycle launch` — no need to reinstall.

## Key Screens

| Screen | Navigation path | Description | Roles |
|--------|----------------|-------------|-------|
| Login | App launch | Single button "Sign in with correct user" | all |
| Product List | After login | 12 mobile phones in 2-column grid; heading "Mobile phones (12)"; Cart header button | all |
| Cart (My Cart) | Tap Cart header button | Shows cart items, quantity controls, "Continue to checkout" button | all |

## Reliable Locators

| Element | Strategy | Value | Screen | Notes |
|---------|----------|-------|--------|-------|
| Sign in with correct user | id | com.epam.mobitru:id/type_and_login | Login | |
| Cart header button | id | com.epam.mobitru:id/cart_title | Product List | Shows "Cart (0)" or "Cart (N)" |
| Product list (RecyclerView) | id | com.epam.mobitru:id/product_list | Product List | |
| Add to cart button | accessibility id | starts with "Add to cart" | Product List | Changes to "Added to cart" after tap |
| Lenovo Legion add-to-cart | accessibility id | Add to cart Lenovo Legion | Product List | First product in grid |
| Cart items list | id | com.epam.mobitru:id/cart_list | Cart | |
| Continue to checkout | id | com.epam.mobitru:id/continue_to_checkout | Cart | |
| Navigate up (back) | accessibility id | Navigate up | Cart | Returns to Product List |

## Gestures Map

| Gesture | Where | Purpose |
|---------|-------|---------|
| Scroll down | Product List | Reveal all 12 products |
| Tap | Anywhere | Navigation and button press |

## System Permissions Required

_(none for smoke suite)_

## Suggested Test Suites

| Suite | Folder | Priority | Description |
|-------|--------|----------|-------------|
| smoke-appium | tasks/smoke-appium/ | Every build | Critical happy paths — local Appium / emulator |
| smoke | tasks/smoke/ | Every build | Same flows — Mobitru device farm (real devices) |

## State Model

| Dimension | Legal values |
|-----------|-------------|
| auth | `logged_out`, `logged_in` |
| screen | `login`, `product_list`, `cart` |
| cart | `empty`, `has_items` |

### Boundary Rules

- State chaining (`inherit_state: true`) requires the same `runner_mode` across all TCs in a group.
- For `inherit_state: false` with appium mode: terminate app → relaunch (no reinstall needed since app is pre-installed).

## Fragile Areas
- App activity name not yet confirmed — may need one retry if `appActivity` is wrong on first session create
- Scroll position after TC-002 may leave list scrolled down — TC-003 accounts for this (scroll up first if no "Add to cart" visible)

## Out of Scope / Manual Setup Required
- Checkout flow (out of scope for smoke)
- Biometric / push notifications
