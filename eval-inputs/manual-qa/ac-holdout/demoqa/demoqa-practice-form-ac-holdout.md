# Acceptance criteria — demoqa-practice-form-ac-holdout

## Feature: Submit the Practice Form

As a user, I want to fill in and submit the practice registration form with
my personal details, so that the site confirms my information was received
correctly.

Acceptance Criteria:
- Filling in First Name, Last Name, Email, Gender, Mobile Number, Date of
  Birth, Subjects, Hobbies, a profile picture, Current Address, State and
  City, then submitting, opens a confirmation dialog that summarizes exactly
  what was entered — the name, email, gender, mobile number, date of birth,
  subjects, hobbies, and address should all match what was typed in.
- The Mobile Number field is required and must be exactly 10 digits. If a
  shorter number is entered, submitting should NOT open the confirmation
  dialog — the form should not go through until a valid 10-digit number is
  provided.
- Known issue, already tracked, not something to re-test as new: closing the
  confirmation dialog with its Close button currently fails with a script
  error and the dialog stays open. Until that's fixed, reloading the page is
  the only reliable way to get rid of it.
