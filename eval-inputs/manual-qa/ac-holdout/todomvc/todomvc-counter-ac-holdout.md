# Acceptance criteria — todomvc-counter-ac-holdout

## Feature: Items-left counter

As a user, I want an accurate, correctly-worded count of how many todos are
still left to do, so that I can tell my progress at a glance.

Acceptance Criteria:
- With exactly one incomplete todo, the counter reads "1 item left"
  (singular wording).
- With more than one incomplete todo, the counter reads the correct number
  followed by "items left" (plural wording) — e.g. 3 incomplete todos shows
  "3 items left".
- The counter updates immediately, in both directions, as todos are
  completed and un-completed one at a time.
- When every todo that exists has been completed, the counter reads "0
  items left" (plural wording, even at zero), and the rest of the bottom
  area (filters, Clear completed) stays visible — this is a different
  situation from having no todos at all, where that whole area disappears.
