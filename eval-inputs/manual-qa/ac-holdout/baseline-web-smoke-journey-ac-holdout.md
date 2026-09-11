# Acceptance criteria — baseline-web-smoke-journey-ac-holdout

## Feature: Core purchase journey (smoke coverage)

As a shopper, I want to complete the full core purchase journey — log in,
browse products, sort them, add to cart, remove from cart, check out, and
log out — so that I can buy what I want and manage my session reliably.

Acceptance Criteria:
- Logging in with a valid account takes the shopper to the Products page,
  with the inventory grid visible.
- Logging in with the right username but the wrong password shows an error
  message and keeps the shopper on the login page.
- Once logged in, the Products page shows exactly 6 products, each with a
  name, a price, and an "Add to cart" button.
- Sorting products by price from low to high reorders the list so the
  cheapest product is first and the most expensive is last.
- Adding a product to the cart changes its button to "Remove" and updates
  the cart icon to show a count of 1; opening the cart shows that product
  listed there.
- Removing a product from the cart page takes it off the list and clears
  the cart count back to nothing; the shopper can continue shopping back to
  the Products page.
- The shopper can complete a full checkout: provide their name and zip
  code, review an order summary showing the item, tax, and total, finish
  the order, and see a "Thank you for your order!" confirmation — after
  which the cart is empty and they're back on the Products page.
- Logging out returns the shopper to the login page, with the username and
  password fields empty and ready for the next login.
