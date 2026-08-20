import { test } from "node:test";
import assert from "node:assert/strict";
import { isDiscoverable, parseFrontmatterField, parseMetaField } from "./gen-marketplaces.mjs";

test("excludes items marked discoverable: false", () => {
  assert.equal(isDiscoverable({ discoverable: false }), false);
  assert.equal(isDiscoverable({ discoverable: "false" }), false);
});

test("includes items without the field (default true)", () => {
  assert.equal(isDiscoverable({}), true);
  assert.equal(isDiscoverable({ discoverable: true }), true);
});

test("parseFrontmatterField: inline value, unquoted and quoted", () => {
  assert.equal(parseFrontmatterField("name: foo\ndescription: A one-line desc", "description"), "A one-line desc");
  assert.equal(parseFrontmatterField('description: "Quoted: with colon"', "description"), "Quoted: with colon");
  assert.equal(parseFrontmatterField("description: 'single quoted'", "description"), "single quoted");
});

test("parseFrontmatterField: folded block scalar (>) joins with spaces", () => {
  const fm = "name: foo\ndescription: >\n  First line\n  second line\nother: x";
  assert.equal(parseFrontmatterField(fm, "description"), "First line second line");
});

test("parseFrontmatterField: folded scalar does NOT return the '>' indicator", () => {
  const fm = "description: >\n  Real text here";
  assert.notEqual(parseFrontmatterField(fm, "description"), ">");
  assert.equal(parseFrontmatterField(fm, "description"), "Real text here");
});

test("parseFrontmatterField: literal block scalar (|) joins with newlines", () => {
  const fm = "description: |\n  line one\n  line two";
  assert.equal(parseFrontmatterField(fm, "description"), "line one\nline two");
});

test("parseFrontmatterField: chomping indicators (>-, |+) are accepted", () => {
  assert.equal(parseFrontmatterField("description: >-\n  a\n  b", "description"), "a b");
  assert.equal(parseFrontmatterField("description: |-\n  a\n  b", "description"), "a\nb");
});

test("parseFrontmatterField: block scalar stops at a less-indented key", () => {
  const fm = "description: >\n  wrapped desc\nname: after";
  assert.equal(parseFrontmatterField(fm, "description"), "wrapped desc");
  assert.equal(parseFrontmatterField(fm, "name"), "after");
});

test("parseFrontmatterField: missing field returns null", () => {
  assert.equal(parseFrontmatterField("name: foo", "description"), null);
});

test("parseFrontmatterField: only matches a top-level key, not one nested under metadata:", () => {
  const fm = "name: foo\nmetadata:\n  description: nested one\n";
  assert.equal(parseFrontmatterField(fm, "description"), null);
});

test("parseMetaField: reads a field nested one level under metadata:", () => {
  const fm = "name: foo\nmetadata:\n  user-invocable: false\n  discoverable: false\n";
  assert.equal(parseMetaField(fm, "discoverable"), "false");
  assert.equal(parseMetaField(fm, "user-invocable"), "false");
});

test("parseMetaField: returns null when there is no metadata block or the field is absent", () => {
  assert.equal(parseMetaField("name: foo\n", "discoverable"), null);
  assert.equal(parseMetaField("metadata:\n  version: 1\n", "discoverable"), null);
});

test("parseMetaField: does not read a top-level field of the same name", () => {
  assert.equal(parseMetaField("discoverable: false\nname: foo\n", "discoverable"), null);
});

test("isDiscoverable + parseMetaField: metadata.discoverable:false excludes an item", () => {
  const fm = "name: sec\nmetadata:\n  discoverable: false\n";
  assert.equal(isDiscoverable({ discoverable: parseFrontmatterField(fm, "discoverable") ?? parseMetaField(fm, "discoverable") }), false);
  const fm2 = "name: keep\nmetadata:\n  user-invocable: false\n";
  assert.equal(isDiscoverable({ discoverable: parseFrontmatterField(fm2, "discoverable") ?? parseMetaField(fm2, "discoverable") }), true);
});
