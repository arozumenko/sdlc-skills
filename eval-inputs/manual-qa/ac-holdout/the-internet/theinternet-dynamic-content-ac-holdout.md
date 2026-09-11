# Acceptance criteria — theinternet-dynamic-content-ac-holdout

## Feature: Dynamic Content (static mode)

As a user, I want a "static content" mode of the dynamic content page, so
that I can view the same set of content on repeat visits instead of it
changing every time.

Acceptance Criteria:
- Loading the dynamic content page in static mode shows 3 rows of text and
  avatar images.
- Known issue, already tracked, not something to re-test as new: static
  mode currently only keeps the first two rows consistent across reloads.
  The third row still changes on every reload even in static mode. Until
  that's fixed, only rows 1 and 2 should be treated as reliably static.
