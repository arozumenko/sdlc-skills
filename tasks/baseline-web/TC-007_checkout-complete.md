---
id: TC-007
title: Complete checkout flow
priority: critical
type: baseline
module: checkout
platform: web
tags: [baseline, checkout, happy-path]
size: M
---

# TC-007: Complete checkout flow

**Module:** Checkout | **Priority:** Critical | **Platform:** Web

## Preconditions

- Browser is open
- User is NOT logged in

## Test Data

| Field      | Value         |
|------------|---------------|
| username   | standard_user |
| password   | secret_sauce  |
| first_name | Test          |
| last_name  | User          |
| zip        | 12345         |
| product    | Sauce Labs Backpack |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to `https://www.saucedemo.com` and log in with `standard_user` / `secret_sauce` | Products page is displayed |
| 2 | Click **"Add to cart"** on the Sauce Labs Backpack | Cart badge shows `1` |
| 3 | Click the cart icon | Cart page shows Sauce Labs Backpack |
| 4 | Click **"Checkout"** | Checkout Step One page is displayed with First Name, Last Name, and Zip Code fields |
| 5 | Fill in First Name: `Test`, Last Name: `User`, Zip: `12345`, then click **"Continue"** | Checkout Step Two (Overview) is displayed showing the order summary with item, subtotal, tax, and total |
| 6 | Verify the item total and tax are shown, then click **"Finish"** | Order Complete page is displayed with "Thank you for your order!" message |
| 7 | Verify the success message and click **"Back Home"** | User is redirected to the Products page |

## Expected Final State

Order completed successfully. User is back on the Products page. Cart is empty (no badge on cart icon).

## Teardown

None.
