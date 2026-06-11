---
id: TC-NNN
title: <verb + subject, e.g. "Login with valid credentials">
priority: critical     # critical | high | medium | low
type: functional       # functional | regression | smoke | integration | exploratory
module: <feature area>
size:                  # S | M | L — set by test-sizer (optional)
requirements: []       # [REQ-001] or remove if no requirement IDs
tags: []               # [smoke, login, happy-path]
---

# TC-NNN: <Title>

**Module:** <Module> | **Priority:** <Priority> | **Type:** <Type>

## Preconditions
- App is accessible at `{{base_url}}`
- <List each prerequisite as a concrete, verifiable fact>

## Test Data

| Field | Value |
|-------|-------|
| <Field name> | <Literal value> |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | <One action — verb + object> | <Measurable expected outcome> |
| 2 | | |
| 3 | | |

## Expected Final State
<Single paragraph describing the overall end state after all steps complete successfully.>

## Teardown
- <Step to clean up, e.g. "Navigate to `{{base_url}}/logout`">
- _(Remove this section if test leaves no persistent state)_
