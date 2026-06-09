---
id: TC-003
title: Add first visible product to cart
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

# TC-003: Add first visible product to cart

**Module:** Cart | **Priority:** Critical | **Platform:** Android | **Runner:** Appium

## Preconditions

- App is on the Product List screen (inherited from TC-002 via session grouping)
- User is logged in
- Cart is empty — Cart header shows "Cart (0)" or "Cart"

## Test Data

| Field | Value |
|-------|-------|
| Target product | First visible product with an active "Add to cart" button on the current screen |
| Expected cart count after add | 1 |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | *(skipped — app launch; covered by TC-001)* | — |
| 2 | *(skipped — login; covered by TC-001)* | — |
| 3 | Observe the product grid on the current screen | At least one product card with an active **"Add to cart"** button is visible (label starts with `"Add to cart"`) |
| 4 | Tap the **"Add to cart"** button on the first visible product card | The button is tapped |
| 5 | Observe the tapped product's action button | The button label changes to **"Added to cart"** and switches to an outline/inactive style |
| 6 | Observe the **Cart header button** (`id: com.epam.mobitru:id/cart_title`) | The cart counter updates to **"Cart (1)"** |

## Expected Final State

The Product List screen is still displayed. The tapped product's action button reads "Added to cart" (outline style, real-device label: `"Added to cart. Activate to remove {product name} from cart"`). The Cart header button reads "Cart (1)". No error dialogs or alerts are present.

## Teardown

- Session kept alive by runner (inherit_state chain continues to TC-004).

## Platform Notes

- **Any visible product is valid** — the test intentionally avoids targeting a specific product by name to stay resilient to sort order changes, price updates, and inherited scroll position from TC-002.
- **Locator strategy:** find first element whose accessibility label starts with `"Add to cart"` on the current screen. If none visible without scrolling, scroll up first (TC-002 may have left the list scrolled to the bottom).
- **"Added to cart" real-device label** differs from button text: `"Added to cart. Activate to remove {product name} from cart"` — use label presence for verification, not exact text match.
