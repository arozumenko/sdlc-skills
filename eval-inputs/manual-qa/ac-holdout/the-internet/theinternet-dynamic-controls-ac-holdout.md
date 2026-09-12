# Acceptance criteria — theinternet-dynamic-controls-ac-holdout

## Feature: Dynamic Controls

As a user, I want to add/remove and enable/disable controls on the page to
take effect reliably, even when they take a few seconds to process, so that
I can trust the page's state once it settles.

Acceptance Criteria:
- Clicking "Remove" on the checkbox control shows a brief loading state,
  then removes the checkbox and shows confirmation text along with an "Add"
  button to bring it back.
- The textbox on the same page starts out disabled. Clicking "Enable" shows
  a brief loading state, then the textbox becomes enabled and accepts typed
  input.
