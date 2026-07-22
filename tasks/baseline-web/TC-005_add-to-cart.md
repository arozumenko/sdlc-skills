---
id: TC-005
title: Add product to cart via list
priority: critical
type: baseline
module: cart
platform: web
tags: [baseline, cart, happy-path]
size: S
---

# TC-005: Add product to cart via list

**Module:** Cart | **Priority:** Critical | **Platform:** Web

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
| 3 | Locate the "Sauce Labs Backpack" product card | Product card is visible with "Add to cart" button |
| 4 | Click **"Add to cart"** on the Sauce Labs Backpack | Button label changes to "Remove" |
| 5 | Observe the cart icon in the top-right corner | Cart icon badge shows `1` |
| 6 | Click the cart icon | Cart page is displayed showing "Sauce Labs Backpack" as the only item |

## Expected Final State

Cart contains exactly 1 item: Sauce Labs Backpack. Cart badge shows `1`.

## Teardown

Open hamburger menu → click **"Reset App State"** → cart returns to empty, all buttons reset to "Add to cart".
