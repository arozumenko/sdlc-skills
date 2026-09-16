// lib/ingest/doc.mjs — `ingest doc <file>` (spec §6.6 row `doc`: structural
// validation = in-scope path; trusted after validation = the path; inert =
// the content). Shipped by TASK-015 as the one trivial adapter that proves
// the dispatcher path; TASK-017 owns its final shape.
//
// A doc whose path is in scope is one record {trusted: {path}, inert:
// {content: wrapInert(text)}}. A doc outside scope fails the row's
// *structural* validation (§6.6 puts "in-scope path" in that column, and
// §4.1 makes a structural failure exit 2), so it is
// 2 SCHEMA-INVALID(doc: path <p> is not in scope) and nothing is written —
// a document is not a finding candidate, so the §6.7 `unlocated
// out-of-scope` handling TASK-015 used provisionally does not apply (the
// TASK-015 follow-up asked TASK-017 to confirm or change; changed). No
// scope.json yet ⇒ 3 INCOMPLETE(scope) (inScope).
//
// The path the adapter trusts is the ingested file's own repo-relative path
// (`source_path`), which the dispatcher derived from the user's argv through
// ctx.input() — never anything written inside the document.

import { CliError, EXIT } from "../exit.mjs";
import { schemaInvalid } from "../tokens.mjs";
import { inScope, wrapInert } from "./_shared.mjs";

export const MAPPING_VERSION = "v1";

/**
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope
 * @param {string} redactedInput the redacted document text
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(doc: path … is not in scope) · 3 INCOMPLETE(scope)
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  if (typeof redactedInput !== "string") throw new TypeError("ingest doc: redactedInput must be the document text");
  const { import_sha256, original_hmac, source_path } = locatorBase;
  if (!inScope(scope, source_path)) throw new CliError(EXIT.USAGE, schemaInvalid("doc", `path ${source_path} is not in scope`));
  return {
    records: [{ locator: { import_sha256, original_hmac, index: 0 }, trusted: { path: source_path }, inert: { content: wrapInert(redactedInput) } }],
    unlocated: [],
    rejected: [],
    mapping_version: MAPPING_VERSION,
  };
}
