# Acceptance criteria — theinternet-dynamic-loading-ac-holdout

## Feature: Dynamic Loading

As a user, I want content that takes a moment to become available to load
in reliably after I start it, so that I know the page isn't broken while I
wait.

Acceptance Criteria:
- On the first dynamic-loading example, starting the load shows a loading
  indicator, and after it finishes, previously hidden text becomes visible
  on the page.
- On the second dynamic-loading example, starting the load shows a loading
  indicator, and after it finishes, the target text is added to the page
  and visible (it isn't present at all beforehand, not just hidden).
