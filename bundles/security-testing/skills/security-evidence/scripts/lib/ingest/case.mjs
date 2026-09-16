// lib/ingest/case.mjs — `ingest case <TC file>` (TASK-018; spec §6.6 row
// `case`: structural validation = the manual-qa TC frontmatter; trusted
// after validation = ids and `requirements`; inert = steps). US-012 AC-1.
//
// The format is bundles/manual-qa/knowledge/test-case-format.md; the fixture
// scripts/fixtures/qa/TC-SEC-001.md is a verbatim copy of that bundle's
// documented example (bin/check-skill-dupes.mjs keeps the two identical, so
// an upstream format change fails `npm run validate:dupes` here).
//
// One record per file (index 0):
//   trusted  {id, external_id?, requirements[]}
//            `id` must match CASE_ID (the canonical `TC-NNN`, or the
//            `TC-<suite>-NNN` shape the security hand-off suite writes, §9.2);
//            `external_id` (a tracker key, optional) and every `requirements`
//            entry must be an ID token — no whitespace, no path characters.
//            Exactly the §6.6 trusted column: nothing about a case acts
//            except its identities and its traceability links. `priority`,
//            `type`, `size` and the rest of the frontmatter stay in the
//            redacted import blob for anyone who needs them
//            (parseTestCase exposes them for in-process readers such as the
//            admitted-suite publisher, TASK-043).
//   inert    {title, steps, body} — the title, the `## Steps` table's data
//            rows (one line per row) and the whole text after the
//            frontmatter, each wrapped by wrapInert (redacted again, provenance
//            banner, nonce-delimited).
//
// Structural failures — no frontmatter, no `id`, an id / external_id /
// requirement that is not an ID token, duplicate keys, an unterminated
// block — are the adapter's own exit-2 result: CliError(2,
// SCHEMA-INVALID(case: <reason>)). The adapter never reads a file, never
// writes, never prints; scope is not consulted (a case is target-validated
// at admission, plan.mjs, not scope-validated here).
//
// Leaf over ./_qa-markdown.mjs, ./_shared.mjs, ../exit.mjs, ../tokens.mjs:
// no fs, no child process, no git, no network (G-6, G-14), no clock (G-1).

import { MarkdownFormatError, findTable, splitFrontmatter } from "./_qa-markdown.mjs";
import { wrapInert } from "./_shared.mjs";
import { CliError, EXIT } from "../exit.mjs";
import { schemaInvalid } from "../tokens.mjs";

export const MAPPING_VERSION = "v1";
const KIND = "case";

/** A manual-qa case id: `TC-` then upper-case alphanumeric segments joined by single hyphens (`TC-001`, `TC-SEC-001`). */
export const CASE_ID = /^TC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
/** An id token as another system spells it (`JIRA-4821`, `SEC-REQ-004`): no whitespace, no slash, no dot-dot. */
export const ID_TOKEN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._:#-]{0,63}$/;

const STEPS_HEADING = /^##[ \t]+Steps[ \t]*$/;

function invalid(reason) {
  return new CliError(EXIT.USAGE, schemaInvalid(KIND, reason));
}

function optionalToken(fm, key) {
  const v = fm[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !ID_TOKEN.test(v)) throw invalid(`${key} is not an id token`);
  return v;
}

function stringOrNull(v) {
  return typeof v === "string" ? v : null;
}

/**
 * Parse a manual-qa test case file.
 * @param {string} text
 * @returns {{id: string, external_id: string | null, requirements: string[], title: string | null, priority: string | null, type: string | null, module: string | null, size: string | null, tags: string[], steps: string, body: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(case: …)
 * @throws {TypeError} when `text` is not a string
 */
export function parseTestCase(text) {
  if (typeof text !== "string") throw new TypeError("ingest case: the input must be the case text");
  let split;
  try {
    split = splitFrontmatter(text);
  } catch (err) {
    if (err instanceof MarkdownFormatError) throw invalid(err.message);
    throw err;
  }
  const { frontmatter: fm, body } = split;
  if (fm === null) throw invalid("no frontmatter block (test-case-format.md requires one)");
  if (typeof fm.id !== "string" || !CASE_ID.test(fm.id)) throw invalid("id is missing or is not a TC id");
  const external_id = optionalToken(fm, "external_id");
  let requirements = [];
  if (fm.requirements !== undefined && fm.requirements !== null) {
    const list = Array.isArray(fm.requirements) ? fm.requirements : [fm.requirements];
    if (!list.every((r) => typeof r === "string" && ID_TOKEN.test(r))) throw invalid("requirements must be a list of id tokens");
    requirements = list;
  }
  const tags = Array.isArray(fm.tags) ? fm.tags.filter((t) => typeof t === "string") : [];
  const table = findTable(body, STEPS_HEADING);
  const steps = table ? table.rows.map((row) => row.join(" | ")).join("\n") : "";
  return {
    id: fm.id,
    external_id,
    requirements,
    title: stringOrNull(fm.title),
    priority: stringOrNull(fm.priority),
    type: stringOrNull(fm.type),
    module: stringOrNull(fm.module),
    size: stringOrNull(fm.size),
    tags,
    steps,
    body,
  };
}

/**
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope unused: a case is not scope-validated
 * @param {string} redactedInput the redacted case text
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(case: …)
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  const tc = parseTestCase(redactedInput);
  const { import_sha256, original_hmac } = locatorBase;
  const trusted = { id: tc.id, requirements: tc.requirements };
  if (tc.external_id !== null) trusted.external_id = tc.external_id;
  const inert = {
    title: wrapInert(tc.title ?? ""),
    steps: wrapInert(tc.steps),
    body: wrapInert(tc.body),
  };
  return {
    records: [{ locator: { import_sha256, original_hmac, index: 0 }, trusted, inert }],
    unlocated: [],
    rejected: [],
    mapping_version: MAPPING_VERSION,
  };
}
