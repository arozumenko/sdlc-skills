import { test } from "node:test";
import assert from "node:assert/strict";
import { isDiscoverable } from "./gen-marketplaces.mjs";

test("excludes items marked discoverable: false", () => {
  assert.equal(isDiscoverable({ discoverable: false }), false);
  assert.equal(isDiscoverable({ discoverable: "false" }), false);
});

test("includes items without the field (default true)", () => {
  assert.equal(isDiscoverable({}), true);
  assert.equal(isDiscoverable({ discoverable: true }), true);
});
