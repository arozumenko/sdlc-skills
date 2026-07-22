---
id: TC-004
title: Sort products by price low-to-high
priority: high
type: baseline
module: product-list
platform: web
tags: [baseline, product-list, sort]
size: S
---

# TC-004: Sort products by price low-to-high

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
| 2 | Locate the sort dropdown (currently shows "Name (A to Z)") | Sort dropdown is visible in the top-right area |
| 3 | Select **"Price (low to high)"** from the sort dropdown | Dropdown updates to show "Price (low to high)" |
| 4 | Read the prices of the first and last product cards | First product has the lowest price; last product has the highest price |
| 5 | Verify prices are in ascending order across all 6 cards | All product prices are sorted ascending (e.g. $7.99 … $49.99) |

## Expected Final State

Products are sorted by price ascending. The cheapest item appears first, the most expensive last.

## Teardown

None.
