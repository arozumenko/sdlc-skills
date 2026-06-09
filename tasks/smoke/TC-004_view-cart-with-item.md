---
id: TC-004
title: View cart with item
priority: critical
type: smoke
module: cart
platform: android
app_type: native
runner_mode: device-farm
device_type: real
orientation: portrait
tags: [smoke, cart, checkout, happy-path]
size: M
precondition_state:
  auth: logged_in
  screen: product_list
  cart: has_items
postcondition_state:
  auth: logged_in
  screen: cart
  cart: has_items
setup_steps: 3
---

# TC-004: View cart with item

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
| Expected cart screen title | My Cart |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Launch the app on `emulator-5554` via Appium session (capabilities: `platformName=Android`, `appium:app=<apk_path>`, `appium:deviceName=emulator-5554`, `appium:automationName=UiAutomator2`, `appium:noReset=false`) | Login screen is displayed |
| 2 | Tap the **"Sign in with correct user"** button (`id: com.epam.mobitru:id/type_and_login`) | Product List screen is displayed; Cart header shows "Cart (0)" or "Cart" (`id: com.epam.mobitru:id/cart_title`) |
| 3 | Tap the **"Add to cart"** button for Lenovo Legion (`accessibility id: "Add to cart Lenovo Legion"`) | Button changes to "Added to cart"; Cart header updates to **"Cart (1)"** (`id: com.epam.mobitru:id/cart_title`) |
| 4 | Tap the **Cart header button** (`id: com.epam.mobitru:id/cart_title`) in the top navigation bar | Navigation to Cart screen begins |
| 5 | Observe the current screen title | The **"My Cart"** screen is displayed |
| 6 | Observe the cart items list (`id: com.epam.mobitru:id/cart_list`) | At least one item is listed in the cart (Lenovo Legion); the item entry includes a product name, price, and quantity controls |
| 7 | Observe the bottom of the Cart screen | The **"Continue to checkout"** button is visible (`id: com.epam.mobitru:id/continue_to_checkout`) |

## Expected Final State

The "My Cart" screen is fully displayed. The cart items list (`id: com.epam.mobitru:id/cart_list`) contains the Lenovo Legion item added in step 3. The "Continue to checkout" button (`id: com.epam.mobitru:id/continue_to_checkout`) is present and visible at the bottom of the screen. No error dialogs or alerts are present.

## Teardown

- Session closed by runner.

## Platform Notes

- **Android only**: The Cart screen is navigated to via the header button (`id: com.epam.mobitru:id/cart_title`), not via a bottom nav tab. A back button (`accessibility id: Navigate up`) is present on the Cart screen to return to the Product List.
- This test intentionally stops before tapping "Continue to checkout" — checkout flow is out of scope for this smoke suite.
