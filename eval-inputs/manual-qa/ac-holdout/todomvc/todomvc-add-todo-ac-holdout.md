# Acceptance criteria — todomvc-add-todo-ac-holdout

## Feature: Add a new todo

As a user, I want to add new tasks to my todo list, so that I can keep
track of things I need to do.

Acceptance Criteria:
- Typing a task into the "what needs to be done" field and pressing Enter
  adds it to the list right away, unchecked, and clears the field back to
  empty so the next task can be typed immediately. (e.g. typing "Buy milk"
  should add a todo reading "Buy milk".)
- The count of remaining items updates to reflect the list — e.g. after
  adding one task it should read something like "1 item left".
- Pressing Enter while the field is empty must not add anything — the list
  and the counter stay exactly as they were.
- Same for whitespace-only input (just spaces, no real text) — that should
  also be rejected, not added as a blank-looking item.
