// TASK-018 — lib/ingest/_qa-markdown.mjs: the Markdown subset the manual-qa
// formats use (YAML-ish frontmatter, GFM pipe tables, ATX headings, fenced
// blocks). No YAML or Markdown parser exists in stdlib, so this is the one
// place the three text adapters (case, audit, qa-run) read structure from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MarkdownFormatError, fencedBlock, fencedBlocks, findTable, parseFrontmatter, sections, splitFrontmatter } from "./_qa-markdown.mjs";

test("splitFrontmatter: leading --- block → {frontmatter, body}; no block → frontmatter null and the whole text as body", () => {
  const { frontmatter, body } = splitFrontmatter("---\nid: TC-001\ntitle: Login\n---\n\n# Body\n");
  assert.deepEqual(frontmatter, { id: "TC-001", title: "Login" });
  assert.equal(body, "\n# Body\n");
  assert.deepEqual(splitFrontmatter("# No frontmatter\n"), { frontmatter: null, body: "# No frontmatter\n" });
  assert.deepEqual(splitFrontmatter("---\n---\nbody"), { frontmatter: {}, body: "body" });
  assert.deepEqual(splitFrontmatter("---\r\nid: X\r\n---\r\nbody"), { frontmatter: { id: "X" }, body: "body" }, "CRLF tolerated");
});

test("splitFrontmatter: an unterminated block is a format error, never a silent 'no frontmatter'", () => {
  assert.throws(() => splitFrontmatter("---\nid: TC-001\n# never closed\n"), MarkdownFormatError);
});

test("parseFrontmatter: scalars, quoted scalars, inline lists, empty values, trailing comments; duplicates and non-key lines are errors", () => {
  const fm = parseFrontmatter([
    "id: TC-001",
    "title: \"Login: with a colon\"",
    "priority: critical    # critical | high | medium | low",
    "size:                 # S | M | L",
    "requirements: [REQ-001, REQ-002]",
    "tags: []",
    "external_id: 'JIRA-4821'",
    "quoted_list: [\"a, b\", c]",
    "url: https://app.example.com/#frag",
  ].join("\n"));
  assert.deepEqual(fm, {
    id: "TC-001",
    title: "Login: with a colon",
    priority: "critical",
    size: null,
    requirements: ["REQ-001", "REQ-002"],
    tags: [],
    external_id: "JIRA-4821",
    quoted_list: ["a, b", "c"],
    url: "https://app.example.com/#frag",
  });
  assert.throws(() => parseFrontmatter("id: A\nid: B"), /duplicate/);
  assert.throws(() => parseFrontmatter("id: A\nnot a key value line"), MarkdownFormatError);
  assert.throws(() => parseFrontmatter("- a list item"), MarkdownFormatError);
});

test("findTable: the first pipe table after a heading; header cells, separator skipped, cells trimmed, outer pipes optional", () => {
  const body = [
    "## Summary",
    "",
    "| Metric | Count |",
    "|--------|-------|",
    "| Total  | 3     |",
    "",
    "## Results",
    "",
    "| ID      | Title        | Size | Status   | Steps | Wall Clock |",
    "|---------|--------------|------|----------|-------|------------|",
    "| TC-001  | Login        | S    | ✅ PASS  | 5/5   | 14s      |",
    "TC-002 | Reset | M | ❌ FAIL | 3/5 | 8s",
    "",
    "## Failed Tests",
  ].join("\n");
  const t = findTable(body, /^## Results\s*$/);
  assert.deepEqual(t.columns, ["ID", "Title", "Size", "Status", "Steps", "Wall Clock"]);
  assert.deepEqual(t.rows, [
    ["TC-001", "Login", "S", "✅ PASS", "5/5", "14s"],
    ["TC-002", "Reset", "M", "❌ FAIL", "3/5", "8s"],
  ]);
  assert.equal(findTable(body, /^## Missing/), null, "no heading ⇒ null");
  assert.equal(findTable("## Results\n\nno table here\n\n## Next\n| a |\n|---|\n", /^## Results/), null, "a table under the next heading does not count");
  assert.deepEqual(findTable("## T\n| a | b |\n|---|---|\n", /^## T/).rows, [], "a header-only table has zero rows");
  assert.deepEqual(
    findTable("## T\n| ID | Title | Status |\n|---|---|---|\n| TC-001 | Verify a \\| b | ✅ PASS |\n", /^## T/).rows,
    [["TC-001", "Verify a | b", "✅ PASS"]],
    "a GFM-escaped \\| is a literal pipe inside its cell, not a column break",
  );
});

test("sections: ATX headings of exactly the requested level, each with the text up to the next heading of that level or higher", () => {
  const body = "intro\n\n## A\n\na1\n\n### A.1\n\na11\n\n## B\n\nb1\n\n# Top\n\ntop\n";
  assert.deepEqual(sections(body, 2), [
    { title: "A", text: "\na1\n\n### A.1\n\na11\n" },
    { title: "B", text: "\nb1\n" },
  ]);
  assert.deepEqual(sections(body, 3), [{ title: "A.1", text: "\na11\n" }]);
  assert.deepEqual(sections("nothing", 2), []);
});

test("fencedBlock: the first ```<lang> block's content; absent ⇒ null; unterminated ⇒ format error; other langs skipped", () => {
  const body = "text\n```yaml\nnot: this\n```\n\n```json\n[1, 2]\n```\n\n```json\n[3]\n```\n";
  assert.equal(fencedBlock(body, "json"), "[1, 2]\n");
  assert.equal(fencedBlock(body, "toml"), null);
  assert.equal(fencedBlock("````json\n{\"a\": \"```\"}\n````\n", "json"), "{\"a\": \"```\"}\n", "a longer fence closes only on its own length");
  assert.throws(() => fencedBlock("```json\n[1", "json"), MarkdownFormatError);
  assert.deepEqual(fencedBlocks(body, "json"), ["[1, 2]\n", "[3]\n"], "fencedBlocks returns every matching fence in order");
  assert.deepEqual(fencedBlocks(body, "toml"), []);
});

test("the shipped manual-qa fixtures parse: TC frontmatter keys, RUN Results table, audit frontmatter lists", () => {
  const here = new URL("../../fixtures/qa/", import.meta.url);
  const tc = splitFrontmatter(readFileSync(new URL("TC-SEC-001.md", here), "utf8"));
  assert.deepEqual(Object.keys(tc.frontmatter), ["id", "title", "priority", "type", "module", "size", "requirements", "tags"]);
  const run = splitFrontmatter(readFileSync(new URL("RUN-2026-09-15-001.md", here), "utf8"));
  assert.deepEqual(run.frontmatter, { run_id: "RUN-2026-09-15-001", suite: "security-my-product-admitted", environment: "https://staging.example.com", date: "2026-09-15" });
  assert.equal(findTable(run.body, /^## Results\s*$/).rows.length, 3);
  const audit = splitFrontmatter(readFileSync(new URL("audit-report.md", here), "utf8"));
  assert.deepEqual(audit.frontmatter.pages_audited, ["https://staging.example.com/", "https://staging.example.com/login"]);
  assert.equal(JSON.parse(fencedBlock(audit.body, "json")).length, 3);
});

test("_qa-markdown is a leaf: no fs, no child process, no git, no network (G-6, G-14)", () => {
  const src = readFileSync(new URL("./_qa-markdown.mjs", import.meta.url), "utf8");
  for (const forbidden of ["node:fs", "node:child_process", "node:http", "node:https", "node:net", "node:dns", "git.mjs", "fetch("]) {
    assert.ok(!src.includes(forbidden), `must not import ${forbidden}`);
  }
});
