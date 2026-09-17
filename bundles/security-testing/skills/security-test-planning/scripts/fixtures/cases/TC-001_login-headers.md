---
id: TC-001
title: Login page sends security headers
priority: high
type: functional
module: authentication
tags: [security, headers, passive]
---

# TC-001: Login page sends security headers

**Module:** Authentication | **Priority:** High | **Type:** Functional

## Preconditions
- App is accessible at `{{base_url}}`
- Browser developer tools are open on the Network tab

## Test Data

| Field | Value |
|-------|-------|
| Path  | /login |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | Navigate to `{{base_url}}/login` | Login page loads with status 200 |
| 2 | Inspect the response headers of the document request | Headers panel is visible |
| 3 | Verify the `Strict-Transport-Security` header is present | Header value includes `max-age` |
| 4 | Check the `Content-Security-Policy` header | Header is present and non-empty |
| 5 | Take a screenshot of the headers panel | Screenshot is attached to the run |

## Expected Final State
No state changed. The login page was loaded once and its response headers were read.
