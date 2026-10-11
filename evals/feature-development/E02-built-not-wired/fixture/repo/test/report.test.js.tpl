import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/report.js";

test("totals per customer, sorted", () => {
  const rows = summarize([
    { customer: "B", amount: 1 },
    { customer: "A", amount: 2.5 },
    { customer: "B", amount: 0.25 },
  ]);
  assert.deepEqual(rows, [
    { customer: "A", total: 2.5 },
    { customer: "B", total: 1.25 },
  ]);
});
