// Order pricing. See docs/pricing.md for the rules.

const COUPON_RATE = 0.1;
const COUPON_CAP = 1500;
const MEMBER_RATE = 0.05;

export function priceOrder({ items, coupon = null, member = false }) {
  const subtotal = items.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  let total = subtotal;
  if (member) total *= 1 - MEMBER_RATE;
  if (coupon === "SAVE10") {
    total -= Math.min(subtotal * COUPON_RATE, COUPON_CAP);
    // members keep their rate on the discounted amount
    if (member) total *= 1 - MEMBER_RATE;
  }
  return Math.round(total);
}
