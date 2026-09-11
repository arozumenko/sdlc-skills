# Acceptance criteria — demoqa-dragabble-widget-ac-holdout

## Feature: Freely Draggable and Axis-Restricted Boxes (Dragabble)

As a user, I want to drag a box freely around the page, and, on a separate
restricted variant, drag a box that only moves along one axis, so that I can
see both an unrestricted and a constrained dragging behavior.

Acceptance Criteria:
- Dragging the freely-draggable box to a new position moves it there in both
  the horizontal and vertical directions.
- Dragging the axis-restricted "Only X" box in any direction, including
  diagonally, moves it only left/right — its vertical position never
  changes, even when the drag itself includes vertical movement.
