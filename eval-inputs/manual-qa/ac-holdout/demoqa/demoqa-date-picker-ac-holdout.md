# Acceptance criteria — demoqa-date-picker-ac-holdout

## Feature: Setting a Date via the Date Picker

As a user, I want to set a date either by typing it directly into the field
or by picking it from the calendar popup, so that I can quickly and
accurately fill in a date.

Acceptance Criteria:
- Typing a date directly into the date field and confirming it sets the
  field to exactly that value; a separate date-and-time field accepts a
  typed date and time the same way.
- Opening the calendar popup and clicking the day "1" in the grid sets the
  field to the 1st day of whichever month the calendar was currently
  displaying — not the previous or next month.
