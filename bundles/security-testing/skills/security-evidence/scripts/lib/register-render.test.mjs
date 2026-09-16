// TASK-059 — renderRegister(projection): the lead's Markdown view of the
// register (spec §6.8 / P5, D14, plan §4.3 `render`). Pure (G-9): the same
// projection renders to the same bytes; approvals are one unauthenticated
// bucket and never reduce open exposure (D15, G-8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyRow } from "./register-transitions.mjs";
import { anchor, summarize } from "./register-fold.mjs";
import { COLUMNS, UNAUTHENTICATED_SENTENCE, renderRegister } from "./register-render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = readFileSync(join(HERE, "register-render.mjs"), "utf8");

const SHA = (c) => c.repeat(64);
const APPROVAL = { recorded_by: "lead", approved_by: "cto", approval_ref: "RISK-12", authenticated: false };

function row(id, fields) {
  return { ...emptyRow(id), id, subject: SHA("f"), title: `title ${id}`, first_seen_run: "0123456789ab-0001", ...fields };
}

/** A projection with every status and every approval kind represented. */
function fixture() {
  const rows = {
    "R-0001": row("R-0001", { priority: "p0", status: "open", owner: "alice" }),
    "R-0002": row("R-0002", { priority: "p1", status: "accepted", acceptance: { ...APPROVAL, until: "2026-12-31" } }),
    "R-0003": row("R-0003", { priority: "p1", status: "false-positive", false_positive: { ...APPROVAL, approval_ref: "RISK-13" } }),
    "R-0004": row("R-0004", { priority: "p2", status: "fixed", last_verified_run: "0123456789ab-0007", ack_refs: [SHA("a"), SHA("b")] }),
    "R-0005": row("R-0005", { priority: "p3", status: "regressed", ticket_url: "https://tracker.example/T-5" }),
    "R-0006": row("R-0006", { priority: "p0", status: "superseded", superseded_by: "R-0001", subject_kind: "threat", subject: "T-001" }),
  };
  return { engagement_id: "eng-2026-001", seq: 9, chain_sha256: SHA("c"), rows };
}

test("deterministic: same projection ⇒ byte-identical output; key order of rows does not matter", () => {
  const a = renderRegister(fixture());
  const b = renderRegister(fixture());
  assert.equal(a, b);
  const shuffled = fixture();
  shuffled.rows = Object.fromEntries(Object.entries(shuffled.rows).reverse());
  assert.equal(renderRegister(shuffled), a, "rows are rendered in id order whatever the object order");
  assert.ok(a.endsWith("\n"), "ends with one newline");
  assert.ok(!a.includes("\r"), "LF only");
});

test("header carries engagement_id, seq and the anchor", () => {
  const p = fixture();
  const md = renderRegister(p);
  assert.match(md, /^# Risk register\n/);
  assert.ok(md.includes("`eng-2026-001`"), "engagement_id");
  assert.ok(md.includes("seq: `9`"), "seq");
  assert.ok(md.includes(`\`${anchor(p)}\``), "anchor <eid>:<seq>:<chain>");
});

test("every row appears exactly once in the table, in id order, with the contract columns", () => {
  const md = renderRegister(fixture());
  const lines = md.split("\n");
  const header = lines.find((l) => l.startsWith("| id |"));
  assert.equal(header, `| ${COLUMNS.join(" | ")} |`);
  assert.deepEqual(COLUMNS.slice(0, 7), ["id", "subject", "priority", "status", "owner", "ticket_url", "last_verified_run"], "plan §5 TASK-059 column order");
  const ids = ["R-0001", "R-0002", "R-0003", "R-0004", "R-0005", "R-0006"];
  const rowsSection = md.slice(md.indexOf("## Rows"), md.indexOf("## Open exposure"));
  const tableRows = rowsSection.split("\n").filter((l) => /^\| R-\d{4} \|/.test(l));
  assert.deepEqual(
    tableRows.map((l) => l.split(" | ")[0].replace("| ", "")),
    ids,
    "one table line per row, ascending id",
  );
  for (const id of ids) {
    const line = tableRows.find((l) => l.startsWith(`| ${id} |`));
    const cells = line.slice(2, -2).split(" | ");
    assert.equal(cells.length, COLUMNS.length, `${id}: one cell per column`);
    assert.equal(cells[0], id);
  }
  const r5 = tableRows.find((l) => l.startsWith("| R-0005 |"));
  assert.ok(r5.includes("| regressed |") && r5.includes("| https://tracker.example/T-5 |"), "status and ticket_url land in their columns");
  const r4 = tableRows.find((l) => l.startsWith("| R-0004 |"));
  assert.ok(r4.includes("| 0123456789ab-0007 |"), "last_verified_run");
});

test("approvals section: one bucket for acceptances, false-positives and ack rows, with approved_by/approval_ref and the literal sentence", () => {
  const md = renderRegister(fixture());
  assert.equal(UNAUTHENTICATED_SENTENCE, "None of these records is authenticated");
  const section = md.slice(md.indexOf("## Unauthenticated approvals"));
  assert.ok(section.includes(`${UNAUTHENTICATED_SENTENCE}.`), "the sentence is in the section");
  const approvalLines = section.split("\n").filter((l) => /^\| R-\d{4} \|/.test(l));
  assert.deepEqual(
    approvalLines.map((l) => l.split(" | ").slice(0, 2).join(" | ").replace("| ", "")),
    ["R-0002 | acceptance", "R-0003 | false-positive", "R-0004 | ack_refs"],
    "accepted row, false-positive row, row with ack_refs — in id order",
  );
  assert.ok(approvalLines[0].includes("| cto | RISK-12 | 2026-12-31 |"), "acceptance: approved_by, approval_ref, until");
  assert.ok(approvalLines[1].includes("| cto | RISK-13 |"), "false-positive: approved_by, approval_ref");
  assert.ok(approvalLines[2].includes(SHA("a")) && approvalLines[2].includes(SHA("b")), "ack rows list their refs");
  assert.doesNotMatch(md, /authenticated: true/);
  assert.doesNotMatch(md, /\bconfirm(ed)?\b/i, "G-8: no confirmed state anywhere in the view");
});

test("approval state is read from status, never from a leftover record (a superseded row keeps history)", () => {
  const p = fixture();
  p.rows["R-0006"].acceptance = { ...APPROVAL, until: "2026-01-01" }; // history on a dead row
  const md = renderRegister(p);
  const section = md.slice(md.indexOf("## Unauthenticated approvals"));
  assert.doesNotMatch(section, /^\| R-0006 \|/m, "a superseded row with a stale record is not an approval");
});

test("open exposure by priority = open + regressed + accepted + false-positive; never reduced by approvals", () => {
  const p = fixture();
  const md = renderRegister(p);
  const summary = summarize(p);
  assert.deepEqual(summary.open_exposure, { p0: 1, p1: 2, p2: 0, p3: 1 });
  const section = md.slice(md.indexOf("## Open exposure"), md.indexOf("## Unauthenticated approvals"));
  for (const [pri, n] of Object.entries(summary.open_exposure)) assert.ok(section.includes(`| ${pri} | ${n} |`), `${pri}=${n}`);

  // Approving every open row changes nothing in the exposure table.
  const approved = fixture();
  approved.rows["R-0001"].status = "accepted";
  approved.rows["R-0001"].acceptance = { ...APPROVAL, until: "2027-01-01" };
  approved.rows["R-0005"].status = "accepted";
  approved.rows["R-0005"].acceptance = { ...APPROVAL, until: "2027-01-01" };
  const md2 = renderRegister(approved);
  const section2 = md2.slice(md2.indexOf("## Open exposure"), md2.indexOf("## Unauthenticated approvals"));
  assert.equal(section2, section, "open exposure is identical after approvals");
});

test("empty register renders a header, an empty table and zero exposure", () => {
  const md = renderRegister({ engagement_id: "eng-2026-001", seq: 0, chain_sha256: SHA("0"), rows: {} });
  assert.match(md, /^# Risk register\n/);
  assert.ok(md.includes("seq: `0`"));
  assert.doesNotMatch(md, /^\| R-\d{4} \|/m);
  assert.ok(md.includes("| p0 | 0 |"));
  assert.ok(md.includes(UNAUTHENTICATED_SENTENCE));
});

test("operator text is confined to the row's title and table-safe: pipes escaped, newlines collapsed; no snippet or path fields exist to render", () => {
  const p = fixture();
  p.rows["R-0001"].title = "a | b\nc\r\nd";
  p.rows["R-0001"].rationale = "SHOULD NOT RENDER /src/secret/path.js";
  const md = renderRegister(p);
  const line = md.split("\n").find((l) => l.startsWith("| R-0001 |"));
  assert.ok(line.includes("a \\| b c d"), line);
  assert.ok(!md.includes("SHOULD NOT RENDER"), "rationale (free text) is not part of the view");
  assert.ok(!md.includes("/src/secret/path.js"));
});

test("rejects a non-projection", () => {
  assert.throws(() => renderRegister(null), TypeError);
  assert.throws(() => renderRegister({ engagement_id: "e", seq: 1, chain_sha256: "nope", rows: {} }), TypeError);
  assert.throws(() => renderRegister({ engagement_id: "e", seq: 1, chain_sha256: SHA("c"), rows: { "R-0001": { id: "R-0001", status: "weird", priority: "p0" } } }), TypeError);
});

test("pure module (no fs import): register-render.mjs imports nothing from node:fs, node:child_process, git.mjs or a clock", () => {
  const imports = [...SELF.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./register-fold.mjs", "./tokens.mjs"]);
  for (const banned of ["node:fs", "node:child_process", "git.mjs", "fs/promises", "child_process", "Date.now", "new Date", "Math.random", "process."]) {
    assert.ok(!SELF.includes(banned), `register-render.mjs must not reference ${banned}`);
  }
});
