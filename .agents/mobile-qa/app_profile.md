# App Profile — Mobitru

## Identity

| Field | Value |
|-------|-------|
| App name | Mobitru |
| Package | `com.epam.mobitru` |
| Platform | Android |
| App type | Native (APK) |
| APK path | `C:\MyDevelopment\sdlc-skills\bundles\mobile-qa\MobitruDemo.app.1.2.0.apk` |
| runner_mode | `appium` |
| Appium server | `http://localhost:4723` (start with ANDROID_HOME set) |
| Device | emulator-5554 (Pixel 6, API 33, x86_64) |
| automationName | UiAutomator2 |

## Authentication

| Field | Value |
|-------|-------|
| Login method | Tap "Sign in with correct user" — no credentials required |
| Manual login | Login + Password fields available but not needed for testing |
| Biometric | "Biometric authentication" button present — not tested |
| Post-login landing | Product List screen |

## Key Flows

### Flow 1 — Login
1. App launches on Login screen
2. Tap `id:com.epam.mobitru:id/type_and_login` ("Sign in with correct user")
3. → Product List screen

### Flow 2 — Browse Product List
1. Product list (`id:com.epam.mobitru:id/product_list`) shows 12 phones in 2-column grid
2. Scroll down to see all items
3. Tap any product card (`accessibility id:"Phone image. {name}. Price: ${price}"`) to open detail

### Flow 3 — Add Product to Cart
1. On Product List, tap `accessibility id:"Add to cart {product name}"`
2. Button changes to "Added to cart" (outline style) — visual confirmation
3. Cart counter in header updates: `id:com.epam.mobitru:id/cart_title` shows "Cart (N)"

### Flow 4 — View Cart
1. Tap `id:com.epam.mobitru:id/cart_title` from any screen
2. → Cart screen ("My Cart")
3. Items listed with quantity controls and price
4. Tap `id:com.epam.mobitru:id/continue_to_checkout` to proceed

## Screens

### Login (`screenshots/01_login.png`)
- Subtitle: "Use your unique login & password or simply use biometric authentication."

### Product List (`screenshots/02_product_list.png`)
- Header: Mobitru logo + Cart counter
- "Mobile phones (12)" heading + sort toggle
- 2-column product grid with discount badges (-10%, -15%)
- Bottom nav: Home / Orders / Account

### After Add to Cart (`screenshots/03_after_add_to_cart.png`)
- Button state: "Added to cart" (outline, non-interactive)
- Cart counter increments immediately

### Cart (`screenshots/04_cart.png`)
- "My Cart" title + back button
- Promo code input button
- Cart items list with quantity controls
- "Continue to checkout" CTA at bottom

## Reliable Locators

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
| Cart header button | id | `com.epam.mobitru:id/cart_title` |
| Sort toggle | id | `com.epam.mobitru:id/sortBy` |
| Product list (RecyclerView) | id | `com.epam.mobitru:id/product_list` |
| Product card (by name+price) | accessibility id | `Phone image. {name}. Price: ${price}` |
| Product card (discounted) | accessibility id | `Phone image. {name}. Discount: -{pct}%. Price: ${orig}. Price before: ${disc}` |
| Add to cart (per product) | accessibility id | `Add to cart {product name}` |
| Bottom nav — Home | accessibility id | `Home` |
| Bottom nav — Orders | accessibility id | `Orders` |
| Bottom nav — Account | accessibility id | `Account` |

### Cart Screen

| Element | Strategy | Selector |
|---------|----------|----------|
| Back (Navigate up) | accessibility id | `Navigate up` |
| Apply promo code | id | `com.epam.mobitru:id/apply_promo_code` |
| Cart items list (RecyclerView) | id | `com.epam.mobitru:id/cart_list` |
| Remove item | id | `com.epam.mobitru:id/remove` |
| Increase quantity (+) | id | `com.epam.mobitru:id/plus` |
| Continue to checkout | id | `com.epam.mobitru:id/continue_to_checkout` |

## Observations & Notes

- **No quantity decrease (−) button observed** on cart screen — only Remove and Plus (+) were found by generate_locators. Needs follow-up.
- **Product prices are dynamic** in accessibility descriptions — locators using accessibility id for product cards will be price-sensitive if prices change.
- **Login fields lack direct resource-id** on the EditText level; parent LinearLayout ids (`login_email`, `login_password`) must be used in xpath.
- **Appium server startup requirement**: must be launched with `ANDROID_HOME` and `ANDROID_SDK_ROOT` set to `C:\Users\olexi\AppData\Local\Android\Sdk`. The MCP embedded mode does not currently inherit these vars from `.mcp.json` without a Claude Code restart.
- **System permissions**: none observed during explored flows.
- **External services**: none observed.
- **Catalogue size**: 12 products total (observed from "Mobile phones (12)" label).

## Setup for Runners

```
appium_capabilities:
  platformName: Android
  appium:app: C:\MyDevelopment\sdlc-skills\bundles\mobile-qa\MobitruDemo.app.1.2.0.apk
  appium:deviceName: emulator-5554
  appium:automationName: UiAutomator2
  appium:noReset: false
  remoteServerUrl: http://localhost:4723
```

`noReset: false` clears app data on each session start — ensures clean login state without manual logout workaround.
Use `appium:fullReset: true` only if you need a full reinstall (slower, needed after permission changes).

Start Appium before running:
```powershell
$env:ANDROID_HOME = "C:\Users\olexi\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT = "C:\Users\olexi\AppData\Local\Android\Sdk"
appium
```
