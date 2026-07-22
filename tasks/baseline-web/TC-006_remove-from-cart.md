---
id: TC-006
title: Remove product from cart
priority: high
type: baseline
module: cart
platform: web
tags: [baseline, cart]
size: S
---

# TC-006: Remove product from cart

**Module:** Cart | **Priority:** High | **Platform:** Web

## Preconditions

- Browser is open
- User is NOT logged in

## Test Data

| Field    | Value         |
|----------|---------------|
| username | standard_user |
| password | secret_sauce  |
| product  | Sauce Labs Backpack |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to `https://www.saucedemo.com` and log in with `standard_user` / `secret_sauce` | Products page is displayed at `/inventory.html` |
| 2 | Click the hamburger menu icon (top-left), then click **"Reset App State"**, then close the menu | Cart badge is absent; all product buttons show "Add to cart" |
| 3 | Click **"Add to cart"** on the Sauce Labs Backpack | Button changes to "Remove"; cart badge shows `1` |
| 4 | Click the cart icon | Cart page is displayed with Sauce Labs Backpack listed |
| 5 | Click the **"Remove"** button next to Sauce Labs Backpack | Item is removed from the cart list; cart appears empty |
| 6 | Observe the cart icon | Cart badge is gone (no number shown) |
| 7 | Click **"Continue Shopping"** | User is returned to the Products page |

## Expected Final State

Cart is empty. Products page is displayed. Cart icon shows no badge.

## Teardown

None.
