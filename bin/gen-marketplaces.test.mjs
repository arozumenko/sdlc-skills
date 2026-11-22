import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDiscoverable, parseFrontmatterField, parseMetaField, checkLocalSources, missingSourcesReport } from "./gen-marketplaces.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

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

// A marketplace entry whose local `./…` source is not in the repository cannot
// be installed. The generator once listed the 30 external (repo:) skills that
// way, and nothing failed.
test("checkLocalSources: reports a local source that does not exist, and only that", () => {
  const root = mkdtempSync(join(tmpdir(), "mkt-sources-"));
  mkdirSync(join(root, "skills/here"), { recursive: true });
  mkdirSync(join(root, ".codex-plugin"));
  const plugins = [
    { name: "toolkit", source: "./" },
    { name: "here", source: "./skills/here" },
    { name: "gone", source: "./skills/gone" },
    { name: "not-a-local-path", source: "owner/repo" },
  ];
  writeFileSync(join(root, ".codex-plugin/marketplace.json"), JSON.stringify({ name: "fixture", plugins }));
  const { checked, missing } = checkLocalSources(root);
  assert.equal(checked, 3, "the three ./ sources are checked; other manifests are absent from the fixture");
  assert.deepEqual(missing, [{ file: ".codex-plugin/marketplace.json", name: "gone", source: "./skills/gone" }]);
  const report = missingSourcesReport(missing);
  assert.match(report, /\.codex-plugin\/marketplace\.json/);
  assert.match(report, /gone/);
  assert.match(report, /\.\/skills\/gone/);
});

test("checkLocalSources: every local source in the four real manifests exists", () => {
  const { checked, missing } = checkLocalSources(REPO);
  assert.ok(checked > 0, "expected local sources in the real manifests");
  assert.deepEqual(missing, [], missingSourcesReport(missing));
});

test("--check runs the local-source check on the real manifests and passes", () => {
  const r = spawnSync(process.execPath, [join(REPO, "bin/gen-marketplaces.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /local sources: \d+ checked in 4 manifests, all exist/);
});

test("--check still runs when the script is started through a symlink in a directory with a space", () => {
  // The old entry-point guard compared an encoded file URL with the raw
  // argv path. Through a link, or from a path with a space, main() was
  // skipped and the check passed (exit 0) without checking anything.
  const dir = mkdtempSync(join(tmpdir(), "gen mkt link-"));
  const link = join(dir, "gen-marketplaces.mjs");
  symlinkSync(join(REPO, "bin/gen-marketplaces.mjs"), link);
  const r = spawnSync(process.execPath, [link, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /local sources: \d+ checked in 4 manifests, all exist/);
});
