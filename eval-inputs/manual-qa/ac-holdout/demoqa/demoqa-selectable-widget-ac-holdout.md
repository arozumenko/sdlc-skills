# Acceptance criteria — demoqa-selectable-widget-ac-holdout

## Feature: Selecting Items From a List (Selectable)

As a user, I want to click list items to select or deselect them, so that I
can mark multiple items as chosen at once.

Acceptance Criteria:
- Clicking an unselected item highlights it as selected.
- Clicking a second, different item highlights it as selected too, without
  removing the first item's selected highlight — more than one item can be
  selected at the same time.
- Clicking an already-selected item removes its selected highlight, leaving
  any other selected items unaffected.
