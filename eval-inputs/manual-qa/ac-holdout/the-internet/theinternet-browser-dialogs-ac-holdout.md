# Acceptance criteria — theinternet-browser-dialogs-ac-holdout

## Feature: Browser Dialogs

As a user, I want the page's alert, confirm, and prompt actions to trigger
the corresponding native browser dialog, so that the page can get my
attention or ask me a quick question.

Acceptance Criteria:
- Triggering the alert action shows a native alert dialog, and after it is
  dismissed, the page confirms the alert was shown.
- Triggering the confirm action shows a native confirm dialog with an
  OK/Cancel choice, and the page reflects back which choice was made.
- Triggering the prompt action shows a native prompt dialog that accepts
  typed text, and the page reflects back what was entered (or that nothing
  was entered, if cancelled).
