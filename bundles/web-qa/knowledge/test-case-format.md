# Test Case Format Specification

## File Location & Naming

```
tasks/
  <suite-name>/
    TC-001_<slug>.md
    TC-002_<slug>.md
    ...
```

- **Suite name** = feature or test type: `smoke`, `regression`, `authentication`, `checkout`
- **ID format** = `TC-` + 3-digit zero-padded number: `TC-001`, `TC-042`
- **Slug** = lowercase, hyphens: `login-valid-credentials`, `forgot-password-flow`

---

## What Makes a Good Test Case

| ✅ Good | ❌ Bad |
|--------|--------|
| Tests exactly ONE behaviour | Multiple conditions bundled together |
| Preconditions are explicit and literal | "System is ready" (vague) |
| Each step = one verb + one object | Steps that contain multiple actions |
| Expected result is measurable (`redirects to /dashboard`) | "Login works" |
| Self-contained — no dependency on other test cases | Assumes prior test ran and set up state |
| Test data values are literal (`test@example.com`) | "Enter any valid email" |
| Failure is easy to pinpoint | 20-step monolith — impossible to isolate |

---

## File Format (Full Template with Annotations)

```markdown
---
id: TC-001
title: Login with valid credentials          # short, verb+object
priority: critical                           # critical | high | medium | low
type: functional                             # functional | regression | smoke | integration | exploratory
module: authentication                       # feature area
requirements: [REQ-001, REQ-002]             # traceability (omit if no req IDs)
tags: [smoke, login, happy-path]             # free-form, used for filtering
---

# TC-001: Login with Valid Credentials

**Module:** Authentication | **Priority:** Critical | **Type:** Functional / Smoke

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

| # | Action                                             | Expected Result                              |
|---|----------------------------------------------------|----------------------------------------------|
| 1 | Navigate to `{{base_url}}/login`                   | Login page loads, Email and Password visible |
| 2 | Fill Email field with `test@example.com`           | Email value is set                           |
| 3 | Fill Password field with `Test1234!`               | Password input is masked                     |
| 4 | Click "Sign In" button                             | Page redirects to `/dashboard`               |
| 5 | Check page header for text "Welcome, Test User"    | Welcome message is visible                   |

## Expected Final State
User is authenticated and on the dashboard. No error messages visible. URL is `{{base_url}}/dashboard`.

## Teardown
- Navigate to `{{base_url}}/logout`
```

---

## Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier. Never reuse or reassign. |
| `title` | Yes | Concise name. Start with a verb: "Login with...", "Submit form when...", "Verify that..." |
| `priority` | Yes | `critical` = blocks release if fails; `high` = major feature; `medium` = secondary; `low` = cosmetic |
| `type` | Yes | `smoke` = quick sanity; `functional` = feature logic; `regression` = verifying no breakage; `integration` = cross-system; `exploratory` = freeform |
| `module` | Yes | The feature/component under test |
| `requirements` | No | Link to requirement IDs for traceability |
| `tags` | No | Arbitrary labels for filtering runs (e.g. `smoke`, `slow`, `needs-2fa`) |
| Preconditions | Yes | Exact system state before test starts. Each bullet is a verifiable fact. |
| Test Data | If applicable | All literal values used in steps. Makes test data easy to change in one place. |
| Steps table | Yes | # / Action / Expected Result — one row per action |
| Expected Final State | Yes | Single paragraph describing the overall end state |
| Teardown | No | Steps to clean up after test. Required if test creates data or modifies persistent state. |

---

## The `{{base_url}}` Placeholder

All URLs in the test case use `{{base_url}}` as a prefix. The test-run-lead substitutes the real URL at run time, making test cases environment-agnostic (works against dev, staging, production).

**Example:** `{{base_url}}/login` → `https://staging.app.com/login`

---

## Priority Definitions

| Priority | Meaning | Typical examples |
|----------|---------|-----------------|
| `critical` | Core user journey — failure blocks release | Login, checkout, data save |
| `high` | Important feature — failure warrants urgent fix | Search, filters, notifications |
| `medium` | Secondary feature — fix in next cycle | Sorting, pagination, tooltips |
| `low` | Cosmetic or edge case — low urgency | UI spacing, copy typos |
