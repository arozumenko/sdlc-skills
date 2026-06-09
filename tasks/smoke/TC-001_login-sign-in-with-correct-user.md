---
id: TC-001
title: Login via "Sign in with correct user"
priority: critical
type: smoke
module: authentication
platform: android
app_type: native
runner_mode: device-farm
device_type: real
orientation: portrait
tags: [smoke, login, happy-path]
size: S
precondition_state:
  auth: logged_out
  screen: login
  cart: empty
postcondition_state:
  auth: logged_in
  screen: product_list
  cart: empty
---

# TC-001: Login via "Sign in with correct user"

**Module:** Authentication | **Priority:** Critical | **Platform:** Android | **Runner:** Appium

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
| 1 | Launch the app on `emulator-5554` via Appium session (capabilities: `platformName=Android`, `appium:app=<apk_path>`, `appium:deviceName=emulator-5554`, `appium:automationName=UiAutomator2`, `appium:noReset=false`) | Login screen is displayed with the "Sign in with correct user" button visible (`id: com.epam.mobitru:id/type_and_login`) |
| 2 | Tap the **"Sign in with correct user"** button (`id: com.epam.mobitru:id/type_and_login`) | Button is tapped; brief loading transition occurs |
| 3 | Observe the current screen | Product List screen is displayed; header contains the Mobitru logo and the Cart counter button (`id: com.epam.mobitru:id/cart_title`); "Mobile phones (12)" heading is visible |

## Expected Final State

User is authenticated and the Product List screen is fully rendered. The cart counter header button (`id: com.epam.mobitru:id/cart_title`) shows "Cart (0)" or "Cart". No error dialogs or alerts are present. The bottom navigation bar shows Home, Orders, and Account tabs.

## Teardown

- Session closed by runner.

## Platform Notes

- **Android only**: "Sign in with correct user" bypasses credential entry entirely — no email/password is entered. This is a test-shortcut mechanism provided by the app.
