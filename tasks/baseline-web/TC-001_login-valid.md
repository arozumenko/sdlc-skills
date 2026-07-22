---
id: TC-001
title: Login with standard_user
priority: critical
type: baseline
module: auth
platform: web
tags: [baseline, auth, happy-path]
size: S
---

# TC-001: Login with standard_user

**Module:** Auth | **Priority:** Critical | **Platform:** Web

## Preconditions

- Browser is open
- User is NOT logged in

## Test Data

| Field    | Value          |
|----------|----------------|
| username | standard_user  |
| password | secret_sauce   |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to `https://www.saucedemo.com` | Login page is displayed with Username and Password fields visible |
| 2 | Enter `standard_user` in the Username field | Username field contains `standard_user` |
| 3 | Enter `secret_sauce` in the Password field | Password field is filled |
| 4 | Click the **Login** button | User is redirected to the Products page; URL contains `/inventory.html`; page title shows "Products" |

## Expected Final State

User is authenticated. Products page is fully rendered showing inventory items. No error messages visible.

## Teardown

None — leave browser on Products page.
