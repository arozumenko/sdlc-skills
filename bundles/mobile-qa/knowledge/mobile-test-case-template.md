---
id: TC-NNN
title: <verb + subject, e.g. "Login with valid credentials">
priority: critical      # critical | high | medium | low
type: functional        # functional | regression | smoke | integration | exploratory
module: <feature area>
platform: both          # ios | android | both
app_type: native        # native | pwa | hybrid
runner_mode: manual     # playwright | appium | device-farm | manual
device_type: simulator  # real | simulator | emulator
size:                   # S | M | L — set by mobile-test-sizer (optional)
orientation: portrait   # portrait | landscape | both
requirements: []        # [REQ-001] or remove if no requirement IDs
tags: []                # [smoke, login, happy-path]
---

# TC-NNN: <Title>

**Module:** <Module> | **Priority:** <Priority> | **Platform:** <Platform> | **Runner:** <runner_mode>

## Preconditions
- App is installed and at <launch screen or specific starting screen>
- <List each prerequisite as a concrete, verifiable fact>
- <Include device state: logged out, location enabled, notifications allowed, etc.>

## Test Data

| Field | Value |
|-------|-------|
| <Field name> | <Literal value> |

## Steps

| # | Action | Expected Result |
|---|--------|----------------|
| 1 | <One action — verb + object, e.g. "Tap Sign In button"> | <Measurable expected outcome> |
| 2 | | |
| 3 | | |

## Expected Final State
<Single paragraph describing the overall end state after all steps complete successfully.>

## Teardown
- <Step to clean up, e.g. "Tap profile icon → Settings → Log Out">
- _(Remove this section if test leaves no persistent state)_

## Platform Notes
_(Remove this section if behaviour is identical on iOS and Android)_
- **iOS**: <iOS-specific behaviour or label difference>
- **Android**: <Android-specific behaviour or Back button handling>
