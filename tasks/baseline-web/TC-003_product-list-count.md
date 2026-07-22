---
id: TC-003
title: Product list shows 6 items
priority: high
type: baseline
module: product-list
platform: web
tags: [baseline, product-list]
size: S
---

# TC-003: Product list shows 6 items

**Module:** Product List | **Priority:** High | **Platform:** Web

## Preconditions

- Browser is open
- User is NOT logged in

## Test Data

| Field    | Value         |
|----------|---------------|
| username | standard_user |
| password | secret_sauce  |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to `https://www.saucedemo.com` and log in with `standard_user` / `secret_sauce` | Products page is displayed |
| 2 | Count the product cards displayed on the page | Exactly 6 product cards are visible |
| 3 | Verify each card has a name, price, and Add to cart button | All 6 cards have name, price (`$X.XX` format), and "Add to cart" button |
| 4 | Verify the page header shows "Products" | Page header text is "Products" |

## Expected Final State

Products page shows exactly 6 items. Each item has a name, price, description, and "Add to cart" button.

## Teardown

None — leave browser on Products page.
