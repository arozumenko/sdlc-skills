# Acceptance criteria — saucedemo-checkout-flow-ac-holdout

## Feature: Checkout validation and totals

As a shopper, I want the checkout process to validate my information and
calculate totals correctly, so that I can trust my order before I finish
it.

Acceptance Criteria:
- Submitting the checkout information form without First Name, Last Name,
  or Postal Code filled in shows the right "required" error for whichever
  field is still missing, one at a time as each gets filled in.
- Cancelling out of the checkout information step returns the shopper to
  the cart page, with their item(s) still in the cart.
- Cancelling out of the order review (overview) step also returns the
  shopper to the cart page, with their item(s) still in the cart and no
  order placed.
- The order review step shows the correct item total, tax, and grand total
  for what's in the cart — e.g. a single $29.99 item should show an item
  total of $29.99, tax of $2.40, and a total of $32.39.
