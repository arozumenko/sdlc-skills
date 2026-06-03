---
id: TC-002
title: Product List shows 12 items
priority: high
type: smoke
module: product-list
platform: android
app_type: native
runner_mode: appium
device_type: emulator
orientation: portrait
tags: [smoke, product-list, catalogue]
size: M
---

# TC-002: Product List shows 12 items

**Module:** Product List | **Priority:** High | **Platform:** Android | **Runner:** Appium

## Preconditions

- Emulator `emulator-5554` (Pixel 6, API 33) is running
- Appium server is running at `http://localhost:4723`
- App `com.epam.mobitru` is installed (APK: `MobitruDemo.app.1.2.0.apk`)
- App is freshly launched — Login screen is visible
- No active session (user is not logged in)

## Test Data

_No credentials required — authentication is performed via the "Sign in with correct user" button._

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Launch the app on `emulator-5554` via Appium session (capabilities: `platformName=Android`, `appium:app=<apk_path>`, `appium:deviceName=emulator-5554`, `appium:automationName=UiAutomator2`, `appium:noReset=false`) | Login screen is displayed |
| 2 | Tap the **"Sign in with correct user"** button (`id: com.epam.mobitru:id/type_and_login`) | Product List screen is displayed |
| 3 | Observe the heading area below the Mobitru logo | The label **"Mobile phones (12)"** is visible on screen, confirming 12 products in the catalogue |
| 4 | Observe the product grid (`id: com.epam.mobitru:id/product_list`) | A 2-column product grid is displayed with at least 2 product cards visible without scrolling |
| 5 | Scroll down within the product list (`id: com.epam.mobitru:id/product_list`) | More product cards appear below the fold; the grid continues to populate as the list scrolls |
| 6 | Scroll to the bottom of the product list | The last product card is reached; no "Load more" or pagination indicator is present; total visible items equal 12 |

## Expected Final State

The Product List screen shows all 12 mobile phone items across a 2-column grid. The "Mobile phones (12)" heading remains visible (or was verified in step 3). No loading spinners or error states are present.

## Teardown

- Session closed by runner.

## Platform Notes

- **Android only**: The product list is a `RecyclerView` (`id: com.epam.mobitru:id/product_list`); item count can be asserted via the child count of this view if the runner supports it.
