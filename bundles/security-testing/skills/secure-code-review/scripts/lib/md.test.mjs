import { test } from "node:test";
import assert from "node:assert/strict";

import { coverageTable, elementsTable, findingsTable, mitigationsTable, table, tablesSha256, threatsTable } from "./md.mjs";

const OID = "0123456789abcdef0123456789abcdef01234567";
const ID = "f".repeat(64);
const cit = (extra = {}) => ({ path: "src/app.js", lines: [3, 5], oid: OID, state: "VERIFIED", snippet: "x", snippet_redacted: "const password = \"<REDACTED:key-value>\";", ...extra });
const findings = (extra = {}) => ({
  findings: [{ id: ID, title: "Hard-coded credential", class: "hardcoded-secret", priority: "p1", citations: [cit()] }],
  coverage: { examined: 1, partial: 1, unexamined: 1, rows: [{ path: "src/a.js", status: "examined", ranges: [[1, 10]] }, { path: "src/b.js", status: "partial", ranges: [[1, 4], [7, 8]], unexamined: [[5, 6], [9, 10]] }, { path: "src/c.js", status: "unexamined", ranges: [[1, 10]] }, { path: "src/empty.js", status: "unexamined", ranges: [] }] },
  ...extra,
});

test("table escapes pipes and flattens newlines; every row has the header's width", () => {
  const t = table(["a", "b"], [["x|y", "one\ntwo"], ["only"]]);
  assert.equal(t, "| a | b |\n| --- | --- |\n| x\\|y | one two |\n| only |  |\n");
  assert.equal(table(["h"], []), "| h |\n| --- |\n");
  assert.throws(() => table([], []), /headers/);
});

test("findingsTable: id7, citations as path:s-e @oid7 state, the snippet column and the second opinion", () => {
  const t = findingsTable(findings());
  const lines = t.split("\n");
  assert.equal(lines[0], "| id | priority | class | title | citations | snippet | second opinion |");
  assert.equal(lines[2], `| ${ID.slice(0, 7)} | p1 | hardcoded-secret | Hard-coded credential | src/app.js:3-5 @${OID.slice(0, 7)} VERIFIED | const password = "<REDACTED:key-value>"; | not independently reviewed |`);
  const withSecond = findingsTable(findings(), { seconds: new Map([[ID, { assertion: "confirmed", by: "s1" }]]) });
  assert.match(withSecond, /\| confirmed by s1 \|$/m);
  const noSnippets = findingsTable(findings(), { noSnippets: true });
  assert.equal(noSnippets.split("\n")[0], "| id | priority | class | title | citations | second opinion |");
  assert.ok(!noSnippets.includes("<REDACTED"), "no snippet column, no snippet text");
});

test("findingsTable: a pipe in a title is escaped; a FAILED citation shows its state; no id ⇒ a dash", () => {
  const t = findingsTable(findings({ findings: [{ title: "a | b", class: "c", priority: "p2", citations: [cit({ state: "FAILED(snippet-not-found)", snippet_redacted: undefined })] }] }));
  assert.match(t, /\| - \| p2 \| c \| a \\\| b \| src\/app\.js:3-5 @[0-9a-f]{7} FAILED\(snippet-not-found\) \|  \| not independently reviewed \|/);
});

test("coverageTable renders by status: examined ranges only on examined/partial rows, holes on unexamined/partial rows", () => {
  const lines = coverageTable(findings()).split("\n");
  assert.equal(lines[0], "| path | status | examined ranges | unexamined ranges |");
  assert.equal(lines[2], "| src/a.js | examined | 1-10 |  |");
  assert.equal(lines[3], "| src/b.js | partial | 1-4, 7-8 | 5-6, 9-10 |");
  assert.equal(lines[4], "| src/c.js | unexamined |  | 1-10 |");
  assert.equal(lines[5], "| src/empty.js | unexamined |  |  |");
  assert.equal(coverageTable({}).split("\n")[2], "", "no coverage ⇒ header only");
});

test("elements, threats and mitigations tables", () => {
  const model = {
    elements: [{ id: "E-001", name: "HTTP | handler", kind: "process", citations: [cit()] }],
    threats: [{ id: "T-001", element_id: "E-001", stride: "T", title: "Traversal", disposition: "mitigated(M-001)", mitigations: [{ id: "M-001", claim: "normalised\nfirst", citations: [cit(), cit({ lines: [7, 9], state: "FAILED(not-in-tree)" })] }] }, { id: "T-002", element_id: "E-001", stride: "D", title: "Flood", disposition: "open", mitigations: [] }],
  };
  assert.equal(elementsTable(model), `| id | kind | name | citations |\n| --- | --- | --- | --- |\n| E-001 | process | HTTP \\| handler | src/app.js:3-5 @${OID.slice(0, 7)} VERIFIED |\n`);
  assert.equal(threatsTable(model), "| id | element | stride | title | disposition |\n| --- | --- | --- | --- | --- |\n| T-001 | E-001 | T | Traversal | mitigated(M-001) |\n| T-002 | E-001 | D | Flood | open |\n");
  assert.equal(mitigationsTable(model), `| threat | id | claim | citations |\n| --- | --- | --- | --- |\n| T-001 | M-001 | normalised first | src/app.js:3-5 @${OID.slice(0, 7)} VERIFIED; src/app.js:7-9 @${OID.slice(0, 7)} FAILED(not-in-tree) |\n`);
  assert.equal(elementsTable({}), "| id | kind | name | citations |\n| --- | --- | --- | --- |\n");
});

test("tablesSha256 is stable for the same doc and changes with a title", () => {
  const a = findingsTable(findings());
  const b = findingsTable(findings());
  assert.match(tablesSha256(a), /^[0-9a-f]{64}$/);
  assert.equal(tablesSha256(a), tablesSha256(b));
  const c = findingsTable(findings({ findings: [{ ...findings().findings[0], title: "Other" }] }));
  assert.notEqual(tablesSha256(a), tablesSha256(c));
});
