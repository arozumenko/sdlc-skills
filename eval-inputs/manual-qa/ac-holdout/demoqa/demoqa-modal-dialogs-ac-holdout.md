# Acceptance criteria — demoqa-modal-dialogs-ac-holdout

## Feature: Modal Dialogs — Small and Large

As a user, I want to open and close both the small and large demo modals
through their close controls, so that I can dismiss on-screen dialogs
cleanly.

Acceptance Criteria:
- Opening the small modal and closing it via its labeled "Close" button
  dismisses the modal completely, with no leftover content and no console
  error.
- Opening the small modal again and closing it via the X icon in its corner
  (instead of the labeled button) works the same way — the modal dismisses
  completely with no leftover content or error.
- Opening the large modal and closing it via its labeled "Close" button
  dismisses the modal completely, with no leftover content and no console
  error.
