# Acceptance criteria — demoqa-webtables-record-identity-ac-holdout

## Feature: Record Identity Stays Correct After an Unrelated Change

As a user, I want editing a specific record to always open that same
person's details, even after other unrelated records have been deleted, so
that I never accidentally edit the wrong person's data.

Acceptance Criteria:
- Opening a record for editing, closing without saving, then deleting a
  different, unrelated record, and reopening the same record for editing
  again shows the exact same person's details as before the deletion.
