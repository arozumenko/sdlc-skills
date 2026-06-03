---
id: TC-003
title: Add product to cart
priority: critical
type: smoke
module: cart
platform: android
app_type: native
runner_mode: appium
device_type: emulator
orientation: portrait
tags: [smoke, cart, add-to-cart, happy-path]
size: M
---

# TC-003: Add product to cart

**Module:** Cart | **Priority:** Critical | **Platform:** Android | **Runner:** Appium

## Preconditions

- Emulator `emulator-5554` (Pixel 6, API 33) is running
- Appium server is running at `http://localhost:4723`
- App `com.epam.mobitru` is installed (APK: `MobitruDemo.app.1.2.0.apk`)
- App is freshly launched — Login screen is visible
- No active session (user is not logged in)
- Cart is empty — guaranteed by `appium:noReset: false` in session capabilities (app data is cleared on each session start)

## Test Data

| Field | Value |
|-------|-------|
| Target product | Lenovo Legion (first product in the grid) |
| Expected cart count after add | 1 |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Launch the app on `emulator-5554` via Appium session (capabilities: `platformName=Android`, `appium:app=<apk_path>`, `appium:deviceName=emulator-5554`, `appium:automationName=UiAutomator2`, `appium:noReset=false`) | Login screen is displayed |
| 2 | Tap the **"Sign in with correct user"** button (`id: com.epam.mobitru:id/type_and_login`) | Product List screen is displayed; Cart header shows "Cart (0)" or "Cart" (`id: com.epam.mobitru:id/cart_title`) |
| 3 | Locate the **"Add to cart"** button for the Lenovo Legion product (`accessibility id: "Add to cart Lenovo Legion"`) in the product grid | The "Add to cart" button for Lenovo Legion is visible without scrolling (it is the first item in the grid) |
| 4 | Tap the **"Add to cart"** button for Lenovo Legion (`accessibility id: "Add to cart Lenovo Legion"`) | The button is tapped |
| 5 | Observe the **"Add to cart"** button for Lenovo Legion | The button label changes to **"Added to cart"** and the button appearance switches to an outline/inactive style, indicating it is no longer interactive |
| 6 | Observe the **Cart header button** (`id: com.epam.mobitru:id/cart_title`) in the top navigation bar | The cart counter updates to **"Cart (1)"** |

## Expected Final State

The Product List screen is still displayed. The Lenovo Legion card's action button reads "Added to cart" (outline style). The Cart header button (`id: com.epam.mobitru:id/cart_title`) reads "Cart (1)". No error dialogs or alerts are present.

## Teardown

- Session closed by runner.

## Platform Notes

- **Android only**: The "Add to cart" button uses an `accessibility id` locator keyed on the product name. If the Lenovo Legion product name or its accessibility label differs in a future app version, update the locator accordingly.
- The exact accessibility id pattern for the "Added to cart" state is not confirmed in the profile; the visual/label change is the primary assertion. If runner supports text assertion, assert `getText()` on the button equals `"Added to cart"`.
