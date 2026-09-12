# Acceptance criteria — demoqa-webtables-crud-ac-holdout

## Feature: Adding and Searching Records in Web Tables

As a user, I want to add a new person record to the table and search/filter
existing records, so that I can manage and quickly find people's data.

Acceptance Criteria:
- Filling in a new record's First Name, Last Name, Email, Age, Salary and
  Department and submitting adds exactly one new row to the table
  containing those values, without altering any existing row.
- Typing a search term that matches only one existing row's data filters the
  table down to just that row; every other row is hidden while the search
  term is active.
- Clearing the search field restores the full original set of rows.
