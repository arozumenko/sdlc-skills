# Acceptance criteria — demoqa-webtables-pagination-ac-holdout

## Feature: Pagination Controls

As a user, I want the table's pagination controls (page navigation and
rows-per-page) to work reliably, so that I can browse a large set of
records.

Acceptance Criteria:
- Once the table has more rows than fit on one page, a pagination bar
  appears showing the current page and total pages, and the First,
  Previous, Next, and Last buttons correctly move between pages.
- Changing the rows-per-page setting while viewing a later page keeps
  showing the same record(s) that were visible before the change — a record
  that was visible on page 2 stays visible after switching to a larger page
  size.
