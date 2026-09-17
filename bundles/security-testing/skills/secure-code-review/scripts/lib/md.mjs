// lib/md.mjs — the Markdown tables `cite.mjs check --md` prints for the lead
// to paste into the report (spec D6): findings + coverage for a findings
// file, elements + threats + mitigations for a threat model, and the
// `TABLES sha256=<h>` the report carries so a reader can re-render and
// compare. Cells are one line each (`|` escaped, newlines flattened); ids
// and oids print as their first seven hex chars. Every table function takes
// the document AS WRITTEN BACK by `check` — redacted, stamped — so nothing
// here re-redacts; the caller still passes the rendered text through
// `redactString` before printing, like every other string.
//
// Leaf module: stdlib only, no I/O.

import { createHash } from "node:crypto";

const NOT_REVIEWED = "not independently reviewed";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const short = (s) => (typeof s === "string" && s.length > 0 ? s.slice(0, 7) : "-");
const text = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** One cell: `|` escaped, any newline run flattened to one space. */
export const escapeCell = (v) => text(v).replace(/\r?\n|\r/g, " ").replace(/\|/g, "\\|");

/**
 * A GitHub-flavoured Markdown table. Short rows are padded with empty cells.
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @returns {string} ends with a newline
 */
export function table(headers, rows) {
  if (!Array.isArray(headers) || headers.length === 0) throw new TypeError("table: headers must be a non-empty array");
  const line = (cells) => `| ${cells.map(escapeCell).join(" | ")} |`;
  const out = [line(headers), `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) out.push(line(headers.map((_, i) => row[i])));
  return `${out.join("\n")}\n`;
}

/** `path:s-e @oid7 state` for one citation; a malformed one prints what it has. */
function citation(c) {
  if (!isObject(c)) return "-";
  const lines = Array.isArray(c.lines) && c.lines.length === 2 ? `:${c.lines[0]}-${c.lines[1]}` : "";
  return `${text(c.path)}${lines} @${short(c.oid)} ${text(c.state) || "-"}`;
}
const citations = (list) => (Array.isArray(list) ? list.map(citation).join("; ") : "");
const ranges = (list) => (Array.isArray(list) ? list.map(([s, e]) => `${s}-${e}`).join(", ") : "");

/**
 * `id | priority | class | title | citations | snippet | second opinion`;
 * `noSnippets` drops the snippet column, `seconds` supplies the valid second
 * opinions by finding id (`{assertion, by}`).
 * @param {object} doc a checked findings document
 * @param {{noSnippets?: boolean, seconds?: Map<string, {assertion: string, by: string}>}} [options]
 */
export function findingsTable(doc, { noSnippets = false, seconds = new Map() } = {}) {
  const headers = ["id", "priority", "class", "title", "citations", ...(noSnippets ? [] : ["snippet"]), "second opinion"];
  const rows = (Array.isArray(doc.findings) ? doc.findings : []).filter(isObject).map((f) => {
    const second = typeof f.id === "string" ? seconds.get(f.id) : undefined;
    const snippet = Array.isArray(f.citations) ? f.citations.filter(isObject).map((c) => text(c.snippet_redacted)).filter((s) => s.length > 0).join("; ") : "";
    return [short(f.id), f.priority, f.class, f.title, citations(f.citations), ...(noSnippets ? [] : [snippet]), second ? `${second.assertion} by ${second.by}` : NOT_REVIEWED];
  });
  return table(headers, rows);
}

/**
 * `path | status | examined ranges | unexamined ranges`, rendered by status:
 * an `unexamined` row's `ranges` is the hole (the whole file), not examined
 * lines; a `partial` row has both.
 * @param {object} doc a checked findings document (`doc.coverage.rows`)
 */
export function coverageTable(doc) {
  const rows = (isObject(doc.coverage) && Array.isArray(doc.coverage.rows) ? doc.coverage.rows : []).filter(isObject).map((r) => {
    if (r.status === "examined") return [r.path, r.status, ranges(r.ranges), ""];
    if (r.status === "unexamined") return [r.path, r.status, "", ranges(r.ranges)];
    return [r.path, r.status, ranges(r.ranges), ranges(r.unexamined)];
  });
  return table(["path", "status", "examined ranges", "unexamined ranges"], rows);
}

/** `id | kind | name | citations` */
export function elementsTable(doc) {
  const rows = (Array.isArray(doc.elements) ? doc.elements : []).filter(isObject).map((e) => [e.id, e.kind, e.name, citations(e.citations)]);
  return table(["id", "kind", "name", "citations"], rows);
}

/** `id | element | stride | title | disposition` */
export function threatsTable(doc) {
  const rows = (Array.isArray(doc.threats) ? doc.threats : []).filter(isObject).map((t) => [t.id, t.element_id, t.stride, t.title, t.disposition]);
  return table(["id", "element", "stride", "title", "disposition"], rows);
}

/** `threat | id | claim | citations`, one row per mitigation in threat order. */
export function mitigationsTable(doc) {
  const rows = [];
  for (const t of (Array.isArray(doc.threats) ? doc.threats : []).filter(isObject)) {
    for (const m of (Array.isArray(t.mitigations) ? t.mitigations : []).filter(isObject)) rows.push([t.id, m.id, m.claim, citations(m.citations)]);
  }
  return table(["threat", "id", "claim", "citations"], rows);
}

/** Hex sha256 of the rendered tables text — the `TABLES sha256=<h>` line. */
export const tablesSha256 = (rendered) => createHash("sha256").update(rendered, "utf8").digest("hex");
