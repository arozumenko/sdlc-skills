import { test } from "node:test";
import assert from "node:assert/strict";
import { priceOrder } from "../src/pricing.js";

const basket = (cents) => [{ unitPrice: cents, qty: 1 }];

test("no discounts", () => {
  assert.equal(priceOrder({ items: basket(10000) }), 10000);
});

test("SAVE10 takes 10% off", () => {
  assert.equal(priceOrder({ items: basket(10000), coupon: "SAVE10" }), 9000);
});

test("SAVE10 is capped at 1500", () => {
  assert.equal(priceOrder({ items: basket(20000), coupon: "SAVE10" }), 18500);
});

test("members get 5% off", () => {
  assert.equal(priceOrder({ items: basket(10000), member: true }), 9500);
});

test("subtotal sums quantity", () => {
  assert.equal(priceOrder({ items: [{ unitPrice: 250, qty: 4 }, { unitPrice: 100, qty: 1 }] }), 1100);
});
