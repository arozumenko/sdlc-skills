# Acceptance criteria — todomvc-bulk-actions-ac-holdout

## Feature: Manage todos in bulk

As a user, I want to complete and clean up my todos in bulk as well as one
at a time, so that I don't have to click through a long list individually
every time.

Acceptance Criteria:
- Checking an individual todo's own checkbox marks just that todo complete;
  unchecking it reverts it back to incomplete. The items-left counter
  updates each time, and other todos are unaffected.
- A single "Mark all as complete" control, when clicked, marks every todo
  in the list complete at once — same end result as checking each one
  individually: every todo shows completed styling, the items-left counter
  drops to 0, and every todo shows up under the Completed filter.
- A "Clear completed" action removes every completed todo from the list in
  one click, leaving incomplete todos untouched. This control should only
  show up when at least one todo is currently completed.
