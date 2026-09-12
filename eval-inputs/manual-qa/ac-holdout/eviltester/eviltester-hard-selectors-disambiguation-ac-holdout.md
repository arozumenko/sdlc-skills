## Feature: Hard Selectors Challenge

As a QA engineer, I want to verify that automation can reliably pick out one specific control even on a page that deliberately uses confusing, similar-looking button labels, so that I know our locating strategy is robust.

Acceptance Criteria:
- Known challenge: this page intentionally includes several buttons with very similar or duplicated labels, by design, to test locator robustness — this is not a defect.
- Clicking a specific, uniquely-labelled button among them correctly activates only that button, confirmed by the resulting status text naming that specific button.
