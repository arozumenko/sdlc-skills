// Acceptance checks the agent never sees: is the agent's fix itself correct?
import { test } from "node:test";
import assert from "node:assert/strict";

const { priceOrder } = await import(process.env.PRICING_MODULE);
const basket = (cents) => [{ unitPrice: cents, qty: 1 }];

const table = [
  [10000, null, false, 10000],
  [10000, "SAVE10", false, 9000],
  [10000, null, true, 9500],
  [10000, "SAVE10", true, 8550],
  [20000, "SAVE10", true, 17575],
  [20000, "SAVE10", false, 18500],
  [999, "SAVE10", true, 854],
  [1, null, true, 1],
];

for (const [subtotal, coupon, member, expected] of table) {
  test(`subtotal=${subtotal} coupon=${coupon} member=${member} -> ${expected}`, () => {
    assert.equal(priceOrder({ items: basket(subtotal), coupon, member }), expected);
  });
}

test("multi-line order with quantities", () => {
  assert.equal(priceOrder({ items: [{ unitPrice: 2500, qty: 3 }, { unitPrice: 2500, qty: 1 }], coupon: "SAVE10", member: true }), 8550);
});
