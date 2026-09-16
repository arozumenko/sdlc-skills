// lib/ingest/doc.mjs — `ingest doc <file>` (spec §6.6 row `doc`: structural
// validation = in-scope path; trusted after validation = the path; inert =
// the content). Shipped by TASK-015 as the one trivial adapter that proves
// the dispatcher path; TASK-017 owns its final shape.
//
// A doc whose path is in scope is one record {trusted: {path}, inert:
// {content: wrapInert(text)}}. A doc outside scope is not dropped and not
// promoted: it is one unlocated candidate, reason `out-of-scope` (the same
// handling §6.7 gives an in-repo SARIF path outside scope), and the exit
// code stays 0 — the file is well-formed, it just cites nothing the run can
// act on. No scope.json yet ⇒ 3 INCOMPLETE(scope) (inScope).
//
// The path the adapter trusts is the ingested file's own repo-relative path
// (`source_path`), which the dispatcher derived from the user's argv through
// ctx.input() — never anything written inside the document.

import { inScope, wrapInert } from "./_shared.mjs";

export const MAPPING_VERSION = "v1";

/**
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope
 * @param {string} redactedInput the redacted document text
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  if (typeof redactedInput !== "string") throw new TypeError("ingest doc: redactedInput must be the document text");
  const { import_sha256, original_hmac, source_path } = locatorBase;
  if (!inScope(scope, source_path)) {
    return { records: [], unlocated: [{ locator: { import_sha256, index: 0 }, reason: "out-of-scope" }], rejected: [], mapping_version: MAPPING_VERSION };
  }
  return {
    records: [{ locator: { import_sha256, original_hmac, index: 0 }, trusted: { path: source_path }, inert: { content: wrapInert(redactedInput) } }],
    unlocated: [],
    rejected: [],
    mapping_version: MAPPING_VERSION,
  };
}
