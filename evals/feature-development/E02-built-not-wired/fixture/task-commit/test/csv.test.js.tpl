import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/export/csv.js";

const sample = [
  { id: "INV-1", customer: "Northwind", amount: 10, issued: "2026-09-01" },
  { id: "INV-2", customer: "Fabrikam, Ltd", amount: 2.5, issued: "2026-09-02" },
];

test("header row comes first", () => {
  assert.equal(toCsv(sample).split("\n")[0], "id,customer,amount,issued");
});

test("one row per invoice, in order", () => {
  const lines = toCsv(sample).trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith("INV-1,"));
  assert.ok(lines[2].startsWith("INV-2,"));
});

test("values with a comma are quoted", () => {
  assert.ok(toCsv(sample).includes('"Fabrikam, Ltd"'));
});

test("embedded quotes are doubled", () => {
  const csv = toCsv([{ id: "X", customer: 'The "Best" Co', amount: 1, issued: "2026-09-03" }]);
  assert.ok(csv.includes('"The ""Best"" Co"'));
});

test("empty ledger is just the header", () => {
  assert.equal(toCsv([]), "id,customer,amount,issued\n");
});

test("ends with a newline", () => {
  assert.ok(toCsv(sample).endsWith("\n"));
});
