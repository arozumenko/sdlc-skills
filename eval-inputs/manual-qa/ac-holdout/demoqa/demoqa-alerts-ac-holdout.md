# Acceptance criteria — demoqa-alerts-ac-holdout

## Feature: Native Browser Dialogs on the Alerts Page

As a user, I want to trigger the site's alert, confirm, and prompt dialogs and
respond to them, so that I can confirm actions and provide input through
standard browser dialogs.

Acceptance Criteria:
- Clicking the button that shows a plain alert displays a native alert dialog
  with a message; accepting it dismisses the dialog and returns control to
  the page immediately.
- Clicking the button that shows a delayed alert displays a native alert
  roughly 5 seconds after the click, not immediately.
- Clicking the button that shows a confirm dialog displays a native confirm
  dialog; if the user accepts it, the page shows a message indicating "Ok"
  was chosen (not "Cancel").
- Clicking the button that shows a prompt dialog displays a native prompt
  dialog; if the user types their name and accepts it, the page shows a
  message containing exactly the text that was typed in.
