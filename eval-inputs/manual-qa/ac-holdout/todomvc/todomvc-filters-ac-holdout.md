# Acceptance criteria — todomvc-filters-ac-holdout

## Feature: Filter todos by status

As a user, I want to filter my todo list by completion status, so that I
can focus on what's left to do or review what I've already finished.

Acceptance Criteria:
- The "All" filter shows every todo, whether it's complete or not.
- The "Active" filter shows only incomplete todos — completed ones are
  hidden.
- The "Completed" filter shows only completed todos — incomplete ones are
  hidden.
- Switching between filters updates instantly (the URL reflects which
  filter is active) without a full page reload — todos already in the list
  are never lost just from switching filters back and forth.
