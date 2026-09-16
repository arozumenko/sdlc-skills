// lib/register-render.mjs — the lead's Markdown view of the register
// (TASK-059; spec §6.8 / P5, D14, plan §4.3 `render`). Pure (G-9): a function
// of the projection alone — no file system, no clock, no git — so the same
// projection renders to the same bytes wherever it is rendered, and `check` /
// `sign-off` could re-derive the view from a register snapshot.
//
// Layout (LF, one trailing newline):
//   # Risk register                 header: engagement_id, seq, anchor
//   ## Rows                         one table line per row, ascending id, COLUMNS
//   ## Open exposure                priority → rows in EXPOSED_STATUSES (register-fold.summarize)
//   ## Unauthenticated approvals    UNAUTHENTICATED_SENTENCE, then one line per
//                                   approval-like record: acceptance (status
//                                   accepted), false-positive (status
//                                   false-positive), ack_refs (non-empty)
//
// What may appear (G-4, spec §2 row 4): the only operator-authored text is the
// row's `title`; `rationale`, `test_refs`, `proposal_refs` and every snippet or
// path field live elsewhere and are never rendered. The command layer still
// passes the whole string through redact.mjs before it is written — the
// projection can carry raw bytes when a log was written behind the CLI's
// back — but a title is the one cell where a rule could fire.
//
// Approvals (D15, G-8, register-transitions.mjs header): the approval state is
// read from `status`, never from a record's presence — a `superseded` row may
// keep an acceptance as history and is not an approval. Open exposure is
// summarize()'s: open + regressed + accepted + false-positive; an approval
// never subtracts from it, and this module has no arithmetic of its own.
//
// Table cells: `|` is escaped as `\|`, CR/LF collapse to one space, an empty
// value renders as `-`, so a row is always exactly one line and the column
// count is fixed (a consumer can split on ` | `).

import { EXPOSED_STATUSES, anchor, summarize } from "./register-fold.mjs";
import { REGISTER_PRIORITIES, REGISTER_STATUSES } from "./tokens.mjs";

/** The main table's columns, in order (plan §5 TASK-059 names the first seven; `title` is the one operator-text column). */
export const COLUMNS = Object.freeze(["id", "subject", "priority", "status", "owner", "ticket_url", "last_verified_run", "title"]);
export const APPROVAL_COLUMNS = Object.freeze(["row", "kind", "approved_by", "approval_ref", "until"]);
export const EXPOSURE_COLUMNS = Object.freeze(["priority", "rows"]);
export const UNAUTHENTICATED_SENTENCE = "None of these records is authenticated";

const SHA256 = /^[0-9a-f]{64}$/;
const ROW_ID = /^R-[0-9]{4}$/;
const EMPTY = "-";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** One Markdown table cell: never a pipe or a line break, never empty. */
function cell(value) {
  const s = value === undefined || value === null ? "" : String(value);
  const flat = s.replace(/\r\n|\r|\n/g, " ").replace(/\|/g, "\\|");
  return flat === "" ? EMPTY : flat;
}

function tableLine(cells) {
  return `| ${cells.join(" | ")} |`;
}

function table(columns, lines) {
  return [tableLine(columns), tableLine(columns.map(() => "---")), ...lines.map(tableLine)];
}

function checkProjection(projection) {
  if (!isPlainObject(projection)) throw new TypeError("renderRegister: a projection {engagement_id, seq, chain_sha256, rows} is required");
  if (typeof projection.engagement_id !== "string" || projection.engagement_id.length === 0) throw new TypeError("renderRegister: engagement_id must be a non-empty string");
  if (!Number.isInteger(projection.seq) || projection.seq < 0) throw new TypeError(`renderRegister: seq must be a non-negative integer, got ${String(projection.seq)}`);
  if (typeof projection.chain_sha256 !== "string" || !SHA256.test(projection.chain_sha256)) throw new TypeError("renderRegister: chain_sha256 must be 64 lowercase hex chars");
  if (!isPlainObject(projection.rows)) throw new TypeError("renderRegister: rows must be an object keyed by row id");
  for (const [id, row] of Object.entries(projection.rows)) {
    if (!isPlainObject(row) || row.id !== id || !ROW_ID.test(id)) throw new TypeError(`renderRegister: row ${String(id)} is not a row keyed by its id`);
    if (!REGISTER_STATUSES.includes(row.status)) throw new TypeError(`renderRegister: row ${id} has status ${String(row.status)} (outside the closed vocabulary)`);
    if (!REGISTER_PRIORITIES.includes(row.priority)) throw new TypeError(`renderRegister: row ${id} has priority ${String(row.priority)} (outside the closed vocabulary)`);
  }
}

/** Rows in ascending id order (R-0001 < R-0002 …; the ids are zero-padded, so string order is numeric order). */
function sortedRows(projection) {
  return Object.keys(projection.rows)
    .sort()
    .map((id) => projection.rows[id]);
}

/**
 * The approval-like records of one row, by status (never by record
 * presence), as approvals-table lines. A row can contribute more than one
 * line (an accepted row whose fix was later acknowledged keeps its ack_refs).
 * @param {object} row
 * @returns {string[][]}
 */
function approvalLines(row) {
  const out = [];
  if (row.status === "accepted" && isPlainObject(row.acceptance)) {
    out.push([row.id, "acceptance", cell(row.acceptance.approved_by), cell(row.acceptance.approval_ref), cell(row.acceptance.until)]);
  }
  if (row.status === "false-positive" && isPlainObject(row.false_positive)) {
    out.push([row.id, "false-positive", cell(row.false_positive.approved_by), cell(row.false_positive.approval_ref), EMPTY]);
  }
  if (Array.isArray(row.ack_refs) && row.ack_refs.length > 0) {
    out.push([row.id, "ack_refs", EMPTY, cell(row.ack_refs.join(", ")), EMPTY]);
  }
  return out;
}

/**
 * Render the projection as Markdown. Deterministic: the same projection —
 * whatever the key order of `rows` — yields the same string.
 * @param {{engagement_id: string, seq: number, chain_sha256: string, rows: Record<string, object>}} projection
 * @returns {string} Markdown, LF line endings, one trailing newline
 * @throws {TypeError} not a projection
 */
export function renderRegister(projection) {
  checkProjection(projection);
  const rows = sortedRows(projection);
  const summary = summarize(projection);

  const lines = [
    "# Risk register",
    "",
    `- engagement: \`${projection.engagement_id}\``,
    `- seq: \`${projection.seq}\``,
    `- anchor: \`${anchor(projection)}\``,
    "",
    "Generated by `register.mjs render` from `.agents/security-testing/register/projection.json` (D14: the JSON is the model of record; this file is a derived view). Re-run `render` after every register change.",
    "",
    "## Rows",
    "",
    ...table(
      COLUMNS,
      rows.map((row) => COLUMNS.map((c) => cell(row[c]))),
    ),
    "",
    "## Open exposure",
    "",
    `Rows whose status is one of ${EXPOSED_STATUSES.map((s) => `\`${s}\``).join(", ")}. An unauthenticated approval never reduces it.`,
    "",
    ...table(
      EXPOSURE_COLUMNS,
      REGISTER_PRIORITIES.map((p) => [p, String(summary.open_exposure[p])]),
    ),
    "",
    "## Unauthenticated approvals",
    "",
    `${UNAUTHENTICATED_SENTENCE}. Every approval-like record is stored as \`authenticated: false\`; no command authenticates one, and none of them reduces open exposure.`,
    "",
    ...table(
      APPROVAL_COLUMNS,
      rows.flatMap(approvalLines),
    ),
    "",
  ];
  return lines.join("\n");
}
