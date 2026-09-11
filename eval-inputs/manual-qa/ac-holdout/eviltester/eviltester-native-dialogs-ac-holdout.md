## Feature: Native Browser Dialogs

As a user, I want the page's alert, confirm, and prompt actions to trigger real browser dialogs and correctly reflect my response, so that I can trust the page's feedback matches what I actually clicked or typed.

Acceptance Criteria:
- Clicking the alert action shows a native browser alert; accepting it returns the page to a normal interactive state.
- Clicking the confirm action shows a native browser confirm dialog; accepting it produces a distinctly different, correctly reflected outcome than cancelling it.
- Clicking the prompt action shows a native browser prompt; entering text and accepting it reflects that exact entered text back on the page.
