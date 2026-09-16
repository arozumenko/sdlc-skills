// lib/ingest/_tracker.mjs — the structural half the tracker-side adapters
// share (TASK-017; spec §6.6 rows `ticket`, `pr`, `tracker-readback`; D5
// "untrusted content proposes; only scope- and target-validated references
// act").
//
// A tracker's JSON has no schema this bundle can pin (GitHub, GitLab, Jira
// and the lead's `issue-tracking` skill each shape it differently), so
// "tracker JSON schema" (§6.6) is read as the smallest closed set of fields
// an adapter needs, validated field by field:
//
//   parseTicket(kind, value)
//       the ticket shape `ingest ticket` and `ingest tracker-readback` share:
//       `id` (non-empty string or non-negative integer — GitHub numbers
//       issues, Jira keys them), `url` (non-empty string; the host rule is
//       the adapter's, not a structural check), `state` (non-empty string,
//       kept as the tracker spells it), `labels` (optional; strings, or
//       GitHub-style `{name}` objects normalised to their names; absent ⇒
//       []), `title` / `body` (optional strings — the inert column). Every
//       other key is ignored here: it is preserved in the redacted import
//       blob and never enters a record. A failure is the kind's exit-2 result,
//       CliError(2, SCHEMA-INVALID(<kind>: <field> must be …)) — prose first,
//       never the value (G-4's high-entropy rule reads a token that starts
//       with a long value as a secret).
//   inertText({title?, body?})
//       the inert column: each present string wrapped by wrapInert (banner +
//       nonce-delimited block, redacted once more); absent stays absent.
//   trackerHosts(ctx)
//       `engagement.targets.tracker` from ctx.engagement() — the live
//       engagement.md, the destination/authority policy (§6.6 last
//       paragraph), which the lead may extend between runs; an off-shape
//       engagement is a caller bug (parseEngagementMd validates the schema).
//   HOST_NOT_ALLOWED
//       the one rejection reason these adapters write: a well-formed ticket
//       or PR whose url host is not in targets.tracker is `rejected[]`
//       (exit 0, §4.1 "rejections inside a well-formed file never change the
//       exit code"), never a record and never a throw on data.
//
// Leaf over ./_shared.mjs (wrapInert), ../exit.mjs, ../tokens.mjs: no fs, no
// child process, no git, no network (G-6, G-14).

import { CliError, EXIT } from "../exit.mjs";
import { schemaInvalid } from "../tokens.mjs";
import { wrapInert } from "./_shared.mjs";

/** `rejected[].reason` for a ticket / PR whose url host is outside `targets.tracker`. */
export const HOST_NOT_ALLOWED = "host-not-allowed";

/** The kind's exit-2 structural result. */
export const structural = (kind, reason) => new CliError(EXIT.USAGE, schemaInvalid(kind, reason));

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `value` must be a JSON object (the root of a tracker file, or the --sent payload). */
export function requireObject(kind, value, what = "root") {
  if (!isPlainObject(value)) throw structural(kind, `${what} must be an object`);
  return value;
}

/** A required non-empty string field. */
export function requireString(kind, obj, field, label = field) {
  const v = obj[field];
  if (typeof v !== "string" || v === "") throw structural(kind, `${label} must be a non-empty string`);
  return v;
}

/** An optional string field: absent (or null) ⇒ undefined; present ⇒ must be a string (may be empty). */
export function optionalString(kind, obj, field, label = field) {
  const v = obj[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw structural(kind, `${label} must be a string when present`);
  return v;
}

function parseLabels(kind, value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw structural(kind, "labels must be an array of strings or {name} objects");
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    if (isPlainObject(entry) && typeof entry.name === "string") return entry.name;
    throw structural(kind, "labels must be an array of strings or {name} objects");
  });
}

/**
 * @param {"ticket" | "tracker-readback"} kind names the exit-2 token
 * @param {unknown} value the redacted parsed tracker JSON
 * @returns {{id: string | number, url: string, state: string, labels: string[], title?: string, body?: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(<kind>: …)
 */
export function parseTicket(kind, value) {
  const obj = requireObject(kind, value);
  const id = obj.id;
  const idOk = (typeof id === "string" && id !== "") || (Number.isInteger(id) && id >= 0);
  if (!idOk) throw structural(kind, "id must be a non-empty string or a non-negative integer");
  const url = requireString(kind, obj, "url");
  const state = requireString(kind, obj, "state");
  const labels = parseLabels(kind, obj.labels);
  const out = { id, url, state, labels };
  const title = optionalString(kind, obj, "title");
  const body = optionalString(kind, obj, "body");
  if (title !== undefined) out.title = title;
  if (body !== undefined) out.body = body;
  return out;
}

/**
 * @param {{title?: string, body?: string}} fields
 * @returns {{title?: string, body?: string}} each present string in its inert form
 */
export function inertText({ title, body } = {}) {
  const out = {};
  if (title !== undefined) out.title = wrapInert(title);
  if (body !== undefined) out.body = wrapInert(body);
  return out;
}

/**
 * @param {{engagement: () => {targets: {tracker: string[]}}}} ctx
 * @returns {string[]}
 * @throws {TypeError} when ctx has no engagement() or it carries no targets.tracker list
 */
export function trackerHosts(ctx) {
  if (ctx === null || typeof ctx !== "object" || typeof ctx.engagement !== "function") throw new TypeError("trackerHosts: ctx.engagement() is required");
  const list = ctx.engagement()?.targets?.tracker;
  if (!Array.isArray(list)) throw new TypeError("trackerHosts: engagement.targets.tracker must be an array of hosts");
  return list;
}
