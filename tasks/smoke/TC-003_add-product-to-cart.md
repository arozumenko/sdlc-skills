---
id: TC-003
title: Add product to cart
priority: critical
type: smoke
module: cart
platform: android
app_type: native
runner_mode: device-farm
device_type: real
orientation: portrait
tags: [smoke, cart, add-to-cart, happy-path]
size: M
precondition_state:
  auth: logged_in
  screen: product_list
  cart: empty
postcondition_state:
  auth: logged_in
  screen: product_list
  cart: has_items
setup_steps: 2
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
| 3 | Locate the **"Add to cart"** button for the Lenovo Legion product (`accessibility id: "Add to cart Lenovo Legion Duel Dual-Sim 256GB ROM + 12GB RAM"`) in the product grid | The "Add to cart" button for Lenovo Legion is visible without scrolling (it is the first item in the grid) |
| 4 | Tap the **"Add to cart"** button for Lenovo Legion (`accessibility id: "Add to cart Lenovo Legion Duel Dual-Sim 256GB ROM + 12GB RAM"`) | The button is tapped |
| 5 | Observe the **"Add to cart"** button for Lenovo Legion | The button label changes to **"Added to cart"** and the button appearance switches to an outline/inactive style, indicating it is no longer interactive |
| 6 | Observe the **Cart header button** (`id: com.epam.mobitru:id/cart_title`) in the top navigation bar | The cart counter updates to **"Cart (1)"** |

## Expected Final State

The Product List screen is still displayed. The Lenovo Legion card's action button reads "Added to cart" (outline style). The Cart header button (`id: com.epam.mobitru:id/cart_title`) reads "Cart (1)". No error dialogs or alerts are present.

## Teardown

- Session closed by runner.

## Platform Notes

- **Android only**: The "Add to cart" button uses an `accessibility id` locator keyed on the full product name (`"Add to cart Lenovo Legion Duel Dual-Sim 256GB ROM + 12GB RAM"`). If the product name or its accessibility label differs in a future app version, update the locator accordingly.
- **Do NOT change the sort order.** The default sort is "Price ascending" — Lenovo Legion ($620) is the cheapest item and appears as the **first card** in the top-left of the grid. It is visible without scrolling or re-sorting. If you change sort to alphabetical or any other order, Lenovo will move and the step will take longer.
- The "Added to cart" button label on real devices: `"Added to cart. Activate to remove Lenovo Legion Duel Dual-Sim 256GB ROM + 12GB RAM from cart"` (more detailed than button text alone).
