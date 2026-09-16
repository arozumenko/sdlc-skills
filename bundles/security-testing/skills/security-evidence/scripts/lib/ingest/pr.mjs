// lib/ingest/pr.mjs — `ingest pr <file>` (TASK-017; spec §6.6 row `pr`:
// structural validation = tracker JSON; trusted after validation = `number`,
// `url` (same host rule as ticket), `base_ref`, `head_oid`,
// `changed_files[] ∩ scope`; inert = title, body).
//
// One PR per file, one record per PR. Structural: `number` (integer ≥ 1),
// `url` (non-empty string), `base_ref` (non-empty string — a ref *name*,
// data; nothing here ever resolves it, G-6), `head_oid` (40 lowercase hex),
// `changed_files` (array of strings, may be empty), optional `title` /
// `body` strings. Trust: the host rule (a foreign or unparseable url ⇒
// `rejected[]` host-not-allowed, no record, exit 0) and the intersection —
// `changed_files` is kept only where the path is exactly one of
// `scope.files[].path` (inScope: repo-relative posix, no normalisation, so
// `../etc/passwd` or `./src/app.js` can never match), deduplicated, in the
// PR's order. Nothing is inferred from a path that fails the intersection:
// it is visible in the redacted import blob and that is all. An empty
// intersection is still a record (the PR is well-formed; it touches nothing
// admitted). No scope.json yet ⇒ 3 INCOMPLETE(scope) (inScope): the
// intersection cannot be computed before `scope` ran (§6.1 order).
//
// `title` / `body` never enter `trusted` (a "Closes #7" or a test command
// inside a PR body is text). Keys outside the closed set are preserved in
// the redacted import blob and nowhere else.
//
// Leaf over ./_shared.mjs, ./_tracker.mjs, ../exit.mjs, ../tokens.mjs: no fs,
// no child process, no git, no network (G-6, G-14).

import { CliError, EXIT } from "../exit.mjs";
import { incomplete } from "../tokens.mjs";
import { hostAllowed, inScope } from "./_shared.mjs";
import { HOST_NOT_ALLOWED, inertText, optionalString, requireObject, requireString, structural, trackerHosts } from "./_tracker.mjs";

export const MAPPING_VERSION = "v1";
/** The closed `trusted` key set of a PR record (spec §6.6 row `pr`). */
export const TRUSTED_KEYS = Object.freeze(["number", "url", "base_ref", "head_oid", "changed_files"]);

const KIND = "pr";
const OID = /^[0-9a-f]{40}$/;

function parsePr(value) {
  const obj = requireObject(KIND, value);
  if (!Number.isInteger(obj.number) || obj.number < 1) throw structural(KIND, "number must be a positive integer");
  const url = requireString(KIND, obj, "url");
  const base_ref = requireString(KIND, obj, "base_ref");
  if (typeof obj.head_oid !== "string" || !OID.test(obj.head_oid)) throw structural(KIND, "head_oid must be a 40-char lowercase hex oid");
  if (!Array.isArray(obj.changed_files) || obj.changed_files.some((p) => typeof p !== "string")) throw structural(KIND, "changed_files must be an array of strings");
  const out = { number: obj.number, url, base_ref, head_oid: obj.head_oid, changed_files: obj.changed_files };
  const title = optionalString(KIND, obj, "title");
  const body = optionalString(KIND, obj, "body");
  if (title !== undefined) out.title = title;
  if (body !== undefined) out.body = body;
  return out;
}

/**
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope the run's scope.json, or null when absent
 * @param {unknown} redactedInput the redacted parsed tracker JSON
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(pr: …) on an off-shape file · 3 INCOMPLETE(scope) without scope.json
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  const { import_sha256, original_hmac } = locatorBase;
  const pr = parsePr(redactedInput);
  if (!hostAllowed(pr.url, trackerHosts(ctx))) {
    return { records: [], unlocated: [], rejected: [{ locator: { import_sha256, index: 0 }, reason: HOST_NOT_ALLOWED }], mapping_version: MAPPING_VERSION };
  }
  if (scope === null || scope === undefined) throw new CliError(EXIT.INDETERMINATE, incomplete("scope")); // also with changed_files: [] — inScope's rule, stated once more so an empty list cannot skip it
  const changed_files = [];
  for (const path of pr.changed_files) {
    if (!changed_files.includes(path) && inScope(scope, path)) changed_files.push(path);
  }
  const trusted = { number: pr.number, url: pr.url, base_ref: pr.base_ref, head_oid: pr.head_oid, changed_files };
  return {
    records: [{ locator: { import_sha256, original_hmac, index: 0 }, trusted, inert: inertText(pr) }],
    unlocated: [],
    rejected: [],
    mapping_version: MAPPING_VERSION,
  };
}
