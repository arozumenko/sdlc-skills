# Acceptance criteria — todomvc-delete-todo-ac-holdout

## Feature: Delete a todo

As a user, I want to delete a todo I no longer need, so that my list only
shows tasks that still matter.

Acceptance Criteria:
- Each todo has a delete control that only becomes visible/interactive when
  its row is hovered over or focused — it's not just sitting there all the
  time.
- Clicking a todo's delete control removes only that todo. Other todos in
  the list are left exactly as they were.
- After deleting, the remaining list and the items-left counter both
  reflect the removal accurately (e.g. deleting one of two todos leaves one
  behind, and the counter drops by one).
