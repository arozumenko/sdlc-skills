---
id: TC-SEC-001
title: Verify security headers on the login page
priority: high
type: regression
module: authentication
size: S
requirements: [SEC-REQ-004, SEC-REQ-011]
tags: [security, passive, headers]
---

# TC-SEC-001: Verify Security Headers on the Login Page

**Module:** Authentication | **Priority:** High | **Type:** Regression

## Preconditions
- App is accessible at `{{base_url}}`
- Test user exists: email=`test@example.com`, password=`Test1234!`
- Browser cache and cookies are cleared

## Test Data

| Field    | Value              |
|----------|--------------------|
| Email    | test@example.com   |
| Password | Test1234!          |

## Steps

| # | Action                                                        | Expected Result                                                    |
|---|---------------------------------------------------------------|--------------------------------------------------------------------|
| 1 | Navigate to `{{base_url}}/login`                              | Login page loads, Email and Password visible                       |
| 2 | Open the browser network panel and reload the page            | The document response for `/login` is listed                       |
| 3 | Inspect the response headers of the `/login` document         | `Content-Security-Policy` is present and does not contain `unsafe-inline` |
| 4 | Inspect the response headers of the `/login` document         | `Strict-Transport-Security` is present with `max-age` of at least 31536000 |
| 5 | Inspect the `Set-Cookie` headers of the `/login` document     | Every cookie carries `Secure` and `HttpOnly`                       |

## Expected Final State
User is still on the login page, unauthenticated. No request other than the page load and its assets was made. URL is `{{base_url}}/login`.

## Teardown
- _(No persistent state is created; nothing to clean up)_
