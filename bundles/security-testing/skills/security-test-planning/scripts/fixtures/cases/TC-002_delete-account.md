---
id: TC-002
title: Account deletion requires re-authentication
priority: high
type: functional
module: account
tags: [security, account]
---

# TC-002: Account deletion requires re-authentication

**Module:** Account | **Priority:** High | **Type:** Functional

## Preconditions
- App is accessible at `{{base_url}}`
- A test account is signed in

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to `{{base_url}}/account/danger-zone` | Danger zone page loads |
| 2 | Delete the account using the "Delete account" button | A re-authentication prompt appears |
| 3 | Observe the confirmation dialog | Dialog names the account email |

## Expected Final State
The account is deleted only after re-authentication.
