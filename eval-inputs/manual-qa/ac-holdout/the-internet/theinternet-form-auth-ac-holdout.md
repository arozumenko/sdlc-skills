# Acceptance criteria — theinternet-form-auth-ac-holdout

## Feature: Form-Based Login and Logout

As a user, I want to log into the site with a username and password through
a normal login form, and log back out again, so that I can access and leave
a secure area under my own account.

Acceptance Criteria:
- Entering the correct username and password on the login page and
  submitting logs the user in and redirects to the secure area, showing a
  confirmation message that login succeeded.
- From the secure area, logging out redirects the user back to the login
  page and shows a confirmation message that logout succeeded. Trying to
  return to the secure area afterward, without logging in again, sends the
  user back to the login page.
