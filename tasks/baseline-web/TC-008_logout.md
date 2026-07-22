---
id: TC-008
title: Logout returns to login page
priority: high
type: baseline
module: auth
platform: web
tags: [baseline, auth, logout]
size: S
---

# TC-008: Logout returns to login page

**Module:** Auth | **Priority:** High | **Platform:** Web

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
| 2 | Click the hamburger menu icon (top-left) | Side navigation menu opens showing menu items including "Logout" |
| 3 | Click **"Logout"** | User is redirected to the login page; URL is `https://www.saucedemo.com/` |
| 4 | Verify the login form is visible | Username and Password fields are empty and visible; "Login" button is present |

## Expected Final State

User is logged out. Login page is displayed. Username and Password fields are empty.

## Teardown

None.
