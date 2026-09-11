# Acceptance criteria — todomvc-edit-todo-ac-holdout

## Feature: Edit an existing todo inline

As a user, I want to edit the text of a todo I already added, so that I can
fix a typo or change what it says without deleting it and starting over.

Acceptance Criteria:
- Double-clicking a todo's text puts it into edit mode: the text turns into
  an editable field, pre-filled with the current wording and ready to type
  into immediately.
- Typing new text and pressing Enter saves it — the todo now shows the new
  wording and edit mode closes. Whether the todo was checked/unchecked
  doesn't change just because its text was edited.
- If the user opens edit mode, types something different, but presses
  Escape instead of Enter, none of the typed change should be kept — the
  todo goes back to showing exactly what it said before editing started.
- If the user clears the text completely while editing and presses Enter
  (saving a blank value), the todo should not be left behind as an
  empty-looking item — it should be removed from the list entirely. If that
  was the only todo, the list should end up empty (and the counter/footer
  area should disappear along with it, same as when the list is empty any
  other way).
