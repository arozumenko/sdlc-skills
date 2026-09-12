# Acceptance criteria — saucedemo-add-to-cart-ac-holdout

## Feature: Add a product to the cart

As a shopper, I want to add a product to my cart from the product listing,
so that I can buy the items I've picked out.

Acceptance Criteria:
- After logging in and landing on the products page, clicking "Add to Cart"
  on a product changes that product's button to say "Remove" instead.
- The cart icon shows a badge with a count of how many items are in the
  cart — after adding one product, it should show 1.
- Opening the cart shows the product that was added, listed by name.

Example: logging in with the account `error_user` / `secret_sauce` and
adding the "Sauce Labs Bolt T-Shirt" to the cart should follow all three
criteria above.
