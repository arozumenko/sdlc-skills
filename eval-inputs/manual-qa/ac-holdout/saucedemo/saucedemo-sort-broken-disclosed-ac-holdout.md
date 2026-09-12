# Acceptance criteria — saucedemo-sort-broken-disclosed-ac-holdout

## Feature: Sort the product list (known-broken case)

As a shopper, I want to sort the product list, so that I can browse items
in the order I prefer.

Acceptance Criteria:
- Known issue, already tracked: for the account `error_user` / `secret_sauce`,
  selecting any sort option (e.g. "Name (Z to A)") triggers a blocking
  browser alert with text along the lines of "Sorting is broken! This error
  has been reported to Backtrace." This is a known, tracked defect.
- After dismissing that alert, the product list should still be intact and
  the page should not have broken — it stays in the default "Name (A to Z)"
  order (first product "Sauce Labs Backpack") rather than actually applying
  the requested sort.
