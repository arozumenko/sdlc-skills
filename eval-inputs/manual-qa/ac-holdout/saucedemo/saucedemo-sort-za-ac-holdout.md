# Acceptance criteria — saucedemo-sort-za-ac-holdout

## Feature: Sort products by name, descending

As a shopper, I want to sort products by name from Z to A, so that I can
browse the catalog in reverse alphabetical order.

Acceptance Criteria:
- Selecting the "Name (Z to A)" sort option reorders the product list into
  strict descending alphabetical order by product name — e.g.
  "Test.allTheThings() T-Shirt (Red)" should end up first in the list and
  "Sauce Labs Backpack" should end up last.

Example: logging in with the account `error_user` / `secret_sauce` and
selecting "Name (Z to A)" should follow the criterion above.
