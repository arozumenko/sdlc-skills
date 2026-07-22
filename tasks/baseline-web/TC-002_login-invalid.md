---
id: TC-002
title: Login fails with wrong password
priority: critical
type: baseline
module: auth
platform: web
tags: [baseline, auth, negative]
size: S
---

# TC-002: Login fails with wrong password

**Module:** Auth | **Priority:** Critical | **Platform:** Web

## Preconditions

- Browser is open
- User is NOT logged in

## Test Data

| Field    | Value         |
|----------|---------------|
| username | standard_user |
| password | wrong_password |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to `https://www.saucedemo.com` | Login page is displayed |
| 2 | Enter `standard_user` in the Username field | Username field contains `standard_user` |
| 3 | Enter `wrong_password` in the Password field and click **Login** | Error message is displayed: "Epic sadface: Username and password do not match any user in this service"; user remains on the login page |

## Expected Final State

User is NOT authenticated. Login page remains visible. Error banner contains the expected message.

## Teardown

None.
