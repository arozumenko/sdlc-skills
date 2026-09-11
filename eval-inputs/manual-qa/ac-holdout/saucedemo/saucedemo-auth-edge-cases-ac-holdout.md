# Acceptance criteria — saucedemo-auth-edge-cases-ac-holdout

## Feature: Login edge cases

As a shopper, I want clear feedback when my login attempt doesn't go
through the normal way, so that I understand why I can't get into my
account (or, if it's just slow, that I still can).

Acceptance Criteria:
- Logging in with an account that's been locked out shows an error message
  saying the account has been locked, and keeps the shopper on the login
  page — no access is granted.
- Submitting the login form with both the username and password left blank
  shows an error saying the username is required.
- Submitting the login form with a valid username but no password shows an
  error saying the password is required.
- Logging in with a known "slow" test account eventually succeeds and lands
  on the Products page, even though it takes noticeably longer than a
  normal login — the delay itself is not an error, and once it completes
  there should be no error message on the page.
