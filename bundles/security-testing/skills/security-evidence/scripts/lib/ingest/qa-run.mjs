// lib/ingest/qa-run.mjs — `ingest qa-run <reports/RUN-YYYY-MM-DD-NNN.md>`
// (TASK-018; spec §6.6 row `qa-run`; §9.2 — TASK-044 turns these records
// into observations). US-012 AC-3.
//
// The format is bundles/manual-qa/knowledge/test-run-report-format.md — the
// run report is **Markdown**: frontmatter `run_id, suite, environment, date`
// and the `## Results` pipe table `ID | Title | Size | Status | Steps | Wall
// Clock` whose Status cell carries an icon plus one of PASS | FAIL | BLOCKED.
// The fixture scripts/fixtures/qa/RUN-2026-09-15-001.md is a verbatim copy of
// the bundle's documented example (kept identical by bin/check-skill-dupes.mjs).
//
// Records (locator.index = the source ordinal: 0 the run, k the k-th Results
// row — a rejected row keeps its ordinal, so records[] may skip an index):
//   0        trusted {record: "run", run_id, suite, environment,
//                     environment_host_allowed, date, results}
//            `run_id` must match RUN_ID; `suite` is a slug; `environment` is
//            trusted only when hostAllowed(environment, targets.browser)
//            (§6.6) — otherwise trusted.environment is null,
//            environment_host_allowed false, and the raw value is quoted in
//            inert.environment; `date` is the frontmatter's YYYY-MM-DD (data
//            about the import, not this process's clock — G-1 is untouched);
//            `results` counts every table row, rejected or not.
//            inert {title (the H1), environment?}
//   k ≥ 1    trusted {record: "result", run_id, case_id, status,
//                     screenshot_path?}
//            `case_id` must match CASE_ID (lib/ingest/case.mjs), `status` ∈
//            STATUSES (the token inside the cell — `✅ PASS` ⇒ PASS);
//            `screenshot_path` is the `**Screenshot:** \`path\`` reference
//            from the row's `## Failed Tests` / `## Blocked Tests` narrative
//            when it is a repo-relative posix path — referenced by path, never
//            copied, never opened (§6.6). Anything else in the narrative is
//            quoted: inert {title, narrative?}.
//            A row whose Status carries no known token ⇒ rejected
//            `unknown-status`; an ID that is not a case id ⇒ rejected
//            `bad-case-id` (§4.1: rejections never change the exit code).
//
// The Steps (`3/5`) and Wall Clock cells are not derived: the redacted import
// blob keeps them, and a duration is nothing the bundle acts on.
//
// Structural failures — no frontmatter, a bad run_id, no `## Results`
// table, a Results table without an ID or Status column — are the adapter's
// own exit-2 result: CliError(2, SCHEMA-INVALID(qa-run: <reason>)). The
// engagement's `targets.browser` comes from ctx.engagement() (the
// destination/authority policy, §6.6); scope is not consulted.
//
// Leaf over ./_qa-markdown.mjs, ./_shared.mjs, ./case.mjs (CASE_ID),
// ../exit.mjs, ../tokens.mjs: no fs, no child process, no git, no network
// (G-6, G-14), no clock (G-1).

import { MarkdownFormatError, findTable, sections, splitFrontmatter } from "./_qa-markdown.mjs";
import { hostAllowed, wrapInert } from "./_shared.mjs";
import { CASE_ID } from "./case.mjs";
import { CliError, EXIT } from "../exit.mjs";
import { schemaInvalid } from "../tokens.mjs";

export const MAPPING_VERSION = "v1";
const KIND = "qa-run";

/** `RUN-YYYY-MM-DD-NNN` (test-run-report-format.md § File Location & Naming). */
export const RUN_ID = /^RUN-\d{4}-\d{2}-\d{2}-\d{3}$/;
/** The Status vocabulary, in the format's order. */
export const STATUSES = Object.freeze(["PASS", "FAIL", "BLOCKED"]);
export const REJECT_UNKNOWN_STATUS = "unknown-status";
export const REJECT_BAD_CASE_ID = "bad-case-id";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESULTS_HEADING = /^##[ \t]+Results[ \t]*$/;
const STATUS_TOKEN = /(?<![A-Z])(PASS|FAIL|BLOCKED)(?![A-Z])/;
const H1 = /^#[ \t]+(.*?)[ \t]*$/m;
const NARRATIVE_HEADING = /^(?:[^\s]+[ \t]+)?(TC-[A-Z0-9-]+)[ \t]*:/; // `❌ TC-002: title` (any icon) or `TC-002: title`
const SCREENSHOT = /\*\*Screenshot:\*\*[ \t]*`([^`\r\n]+)`/;
/** A repo-relative posix path: not absolute, no backslash, no `.` / `..` segment, no whitespace. */
const REPO_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\s]+$/;

function invalid(reason) {
  return new CliError(EXIT.USAGE, schemaInvalid(KIND, reason));
}

function column(columns, name) {
  const i = columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  return i;
}

/**
 * Parse a manual-qa run report.
 * @param {string} text
 * @returns {{run_id: string, suite: string | null, environment: string | null, date: string | null, title: string | null, results: {id: string, title: string, size: string | null, status: string | null, steps: string | null, wall_clock: string | null, screenshot: string | null}[], narratives: Record<string, string>}}
 * @throws {CliError} 2 SCHEMA-INVALID(qa-run: …)
 * @throws {TypeError} when `text` is not a string
 */
export function parseRunReport(text) {
  if (typeof text !== "string") throw new TypeError("ingest qa-run: the input must be the report text");
  let split;
  try {
    split = splitFrontmatter(text);
  } catch (err) {
    if (err instanceof MarkdownFormatError) throw invalid(err.message);
    throw err;
  }
  const { frontmatter: fm, body } = split;
  if (fm === null) throw invalid("no frontmatter block (test-run-report-format.md requires one)");
  if (typeof fm.run_id !== "string" || !RUN_ID.test(fm.run_id)) throw invalid("run_id is missing or is not RUN-YYYY-MM-DD-NNN");
  const table = findTable(body, RESULTS_HEADING);
  if (table === null) throw invalid("no ## Results table");
  const idCol = column(table.columns, "ID");
  const statusCol = column(table.columns, "Status");
  if (idCol < 0 || statusCol < 0) throw invalid("the ## Results table needs ID and Status columns");
  const titleCol = column(table.columns, "Title");
  const sizeCol = column(table.columns, "Size");
  const stepsCol = column(table.columns, "Steps");
  const wallCol = column(table.columns, "Wall Clock");

  // Failure / blocked narratives: every `### … TC-xxx: …` section, keyed by case id.
  const narratives = {};
  for (const s of sections(body, 3)) {
    const m = NARRATIVE_HEADING.exec(s.title);
    if (m && !Object.hasOwn(narratives, m[1])) narratives[m[1]] = `${s.title}\n${s.text}`.trim();
  }

  const results = table.rows.map((row) => {
    const status = STATUS_TOKEN.exec(row[statusCol] ?? "");
    const id = row[idCol] ?? "";
    const narrative = Object.hasOwn(narratives, id) ? narratives[id] : null;
    const shot = narrative === null ? null : SCREENSHOT.exec(narrative);
    return {
      id,
      title: titleCol < 0 ? "" : row[titleCol],
      size: sizeCol < 0 || row[sizeCol] === "" ? null : row[sizeCol],
      status: status ? status[1] : null,
      steps: stepsCol < 0 || row[stepsCol] === "" ? null : row[stepsCol],
      wall_clock: wallCol < 0 || row[wallCol] === "" ? null : row[wallCol],
      screenshot: shot ? shot[1].trim() : null,
    };
  });
  const h1 = H1.exec(body);
  return {
    run_id: fm.run_id,
    suite: typeof fm.suite === "string" ? fm.suite : null,
    environment: typeof fm.environment === "string" ? fm.environment : null,
    date: typeof fm.date === "string" ? fm.date : null,
    title: h1 ? h1[1] : null,
    results,
    narratives,
  };
}

/**
 * @param {object} ctx provides engagement().targets.browser
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope unused
 * @param {string} redactedInput the redacted report text
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(qa-run: …)
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  const report = parseRunReport(redactedInput);
  const browser = ctx.engagement().targets.browser;
  const { import_sha256, original_hmac } = locatorBase;

  const allowed = report.environment !== null && hostAllowed(report.environment, browser);
  const head = {
    locator: { import_sha256, original_hmac, index: 0 },
    trusted: {
      record: "run",
      run_id: report.run_id,
      suite: report.suite !== null && SLUG.test(report.suite) ? report.suite : null,
      environment: allowed ? report.environment : null,
      environment_host_allowed: allowed,
      date: report.date !== null && DATE.test(report.date) ? report.date : null,
      results: report.results.length,
    },
    inert: { title: wrapInert(report.title ?? "") },
  };
  if (!allowed && report.environment !== null) head.inert.environment = wrapInert(report.environment);

  const records = [head];
  const rejected = [];
  report.results.forEach((row, i) => {
    const index = i + 1;
    if (!CASE_ID.test(row.id)) {
      rejected.push({ reason: REJECT_BAD_CASE_ID, locator: { import_sha256, index } });
      return;
    }
    if (row.status === null) {
      rejected.push({ reason: REJECT_UNKNOWN_STATUS, locator: { import_sha256, index } });
      return;
    }
    const trusted = { record: "result", run_id: report.run_id, case_id: row.id, status: row.status };
    if (row.screenshot !== null && REPO_RELATIVE.test(row.screenshot)) trusted.screenshot_path = row.screenshot;
    const inert = { title: wrapInert(row.title) };
    if (Object.hasOwn(report.narratives, row.id)) inert.narrative = wrapInert(report.narratives[row.id]);
    records.push({ locator: { import_sha256, original_hmac, index }, trusted, inert });
  });

  return { records, unlocated: [], rejected, mapping_version: MAPPING_VERSION };
}
