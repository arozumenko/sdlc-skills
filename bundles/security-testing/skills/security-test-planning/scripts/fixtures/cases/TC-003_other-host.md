---
id: TC-003
title: Third-party login redirect stays on the allowed host
priority: medium
type: functional
module: authentication
tags: [security, redirect]
---

# TC-003: Third-party login redirect stays on the allowed host

**Module:** Authentication | **Priority:** Medium | **Type:** Functional

## Preconditions
- App is accessible at `{{base_url}}`

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to https://evil.example.net/login?next=https://staging.example.com/dashboard | The page is not the product |
| 2 | Navigate to `{{base_url}}/login?next=https://staging.example.com/dashboard` | Login page loads |
| 3 | Observe the address bar after the redirect | Host is the product host |

## Expected Final State
No state changed.
