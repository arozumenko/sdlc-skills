# Acceptance criteria — saucedemo-cart-multi-item-ac-holdout

## Feature: Manage multiple items in the cart

As a shopper, I want to manage several items in my cart reliably, so that
what I intend to buy is accurately reflected no matter how I navigate
around the site.

Acceptance Criteria:
- Adding 3 different products to the cart updates the cart badge to show
  3, and all 3 products appear listed on the cart page.
- Adding all 6 available products to the cart updates the badge to show 6,
  and all 6 appear listed on the cart page.
- Removing one item directly from the cart page takes it off the list and
  decrements the cart badge by one, leaving any other item(s) untouched.
- After adding items to the cart, visiting a product's detail page and
  coming back to the product list doesn't change the cart — the same
  items and the same badge count are still there.
