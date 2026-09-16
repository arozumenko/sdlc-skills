// lib/ingest/ticket.mjs — `ingest ticket <file>` (TASK-017; spec §6.6 row
// `ticket`: structural validation = tracker JSON; trusted after validation =
// `id`, `url` (host must be in engagement.md targets.tracker), `labels`,
// `state`; inert = title, body).
//
// One ticket per file, one record per ticket. The structural half is
// _tracker.parseTicket (exit 2 on an off-shape file, nothing written). The
// trust half is the host rule: a url whose host is not one of
// `targets.tracker` — or that does not parse at all, a fully redacted url
// included — makes the whole ticket a `rejected[]` entry, reason
// `host-not-allowed`, and no record: a reference that fails target
// validation must not act (D5), but a well-formed file never changes the
// exit code (§4.1). The url that is trusted is the *redacted* one (a token
// in its query is already `<REDACTED:…>` when it reaches the adapter).
//
// `title` and `body` never enter `trusted`, whatever they spell; they are
// stored only as wrapInert(text). Keys outside the closed set (assignee,
// comments, …) are preserved in the redacted import blob and nowhere else.
// A ticket cites nothing, so `scope` is not consulted (a run without
// scope.json can ingest a ticket).
//
// Leaf over ./_shared.mjs, ./_tracker.mjs: no fs, no child process, no git,
// no network (G-6, G-14).

import { hostAllowed } from "./_shared.mjs";
import { HOST_NOT_ALLOWED, inertText, parseTicket, trackerHosts } from "./_tracker.mjs";

export const MAPPING_VERSION = "v1";
/** The closed `trusted` key set of a ticket record (spec §6.6 row `ticket`). */
export const TRUSTED_KEYS = Object.freeze(["id", "url", "labels", "state"]);

const KIND = "ticket";

/**
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope unused: a ticket cites nothing
 * @param {unknown} redactedInput the redacted parsed tracker JSON
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 SCHEMA-INVALID(ticket: …) on an off-shape file
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase) {
  const { import_sha256, original_hmac } = locatorBase;
  const ticket = parseTicket(KIND, redactedInput);
  if (!hostAllowed(ticket.url, trackerHosts(ctx))) {
    return { records: [], unlocated: [], rejected: [{ locator: { import_sha256, index: 0 }, reason: HOST_NOT_ALLOWED }], mapping_version: MAPPING_VERSION };
  }
  const trusted = { id: ticket.id, url: ticket.url, labels: ticket.labels, state: ticket.state };
  return {
    records: [{ locator: { import_sha256, original_hmac, index: 0 }, trusted, inert: inertText(ticket) }],
    unlocated: [],
    rejected: [],
    mapping_version: MAPPING_VERSION,
  };
}
