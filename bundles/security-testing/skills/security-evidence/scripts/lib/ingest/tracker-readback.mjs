// lib/ingest/tracker-readback.mjs — `ingest tracker-readback <file> --sent
// <ticket.json>` (TASK-017; spec §6.6 row `tracker-readback`: tracker JSON
// after a mutation; trusted after validation = the fields the mutation set;
// inert = everything else; spec P4 / §9.4: the lead posts the
// `publish --profile tracker` payload through `issue-tracking`, then runs
// this on the tracker's response).
//
// Two inputs. The read-back (`<file>`) is the tracker's JSON after the
// mutation — the same shape as a ticket (_tracker.parseTicket). The sent
// payload (`--sent`, `handoffs/<finding_id>.ticket.json` as publish wrote
// it — TASK-031's `{finding_id, title, class, priority, path, lines,
// context_redacted, fix_prompt, fingerprint}`) reaches the adapter as
// `extra.sent_payload`, parsed and redacted by the dispatcher; only
// `finding_id` and `title` are read from it (required strings; anything
// else is TASK-031's concern). Missing `--sent` is 2 USAGE.
//
// The fields the mutation set, and so the closed `trusted` set:
//   finding_id                the sent payload's — never read from the tracker
//   id, url, labels, state    what the tracker now says (read-back)
//   body_contains_finding_id  the read-back body names `finding_id` (the one
//                             fact tm-lint's `ticketed` disposition rests on)
//   mismatch: [<field>]       READBACK_FIELDS order — `url` when its host is
//                             not in targets.tracker (the record is kept so
//                             the lead sees it; TASK-045 appends no event
//                             on a foreign host), `title` when the read-back
//                             carries a title that differs from the sent
//                             one (an absent title is nothing to compare),
//                             `body` when the read-back body is absent or
//                             does not contain `finding_id` (an unconfirmed
//                             ticket must not become `ticketed`).
// Both sides are compared in their redacted form (the sent payload was
// written redacted; the read-back is redacted before the adapter sees it).
// `title` / `body` are inert (wrapInert). The register `ticketed` event is
// **not** appended here — TASK-045 wires it in cmd-ingest's post-step from
// this record's `url` and `mismatch`; this adapter produces the record only.
//
// Leaf over ./_shared.mjs, ./_tracker.mjs, ../exit.mjs, ../tokens.mjs: no
// fs, no child process, no git, no network (G-6, G-14).

import { usageError } from "../exit.mjs";
import { READBACK_FIELDS } from "../tokens.mjs";
import { hostAllowed } from "./_shared.mjs";
import { inertText, parseTicket, requireObject, requireString, trackerHosts } from "./_tracker.mjs";

export const MAPPING_VERSION = "v1";
/** The closed `trusted` key set of a read-back record (spec §6.6 row `tracker-readback`, plan TASK-017). */
export const TRUSTED_KEYS = Object.freeze(["finding_id", "id", "url", "labels", "state", "body_contains_finding_id", "mismatch"]);

const KIND = "tracker-readback";
const COMMAND = "ingest";

function parseSent(extra) {
  const payload = extra?.sent_payload;
  if (payload === undefined) throw usageError(COMMAND, `--sent <ticket.json> is required for ${KIND}`);
  const obj = requireObject(KIND, payload, "--sent payload");
  return { finding_id: requireString(KIND, obj, "finding_id", "--sent finding_id"), title: requireString(KIND, obj, "title", "--sent title") };
}

/** The mismatched fields, in READBACK_FIELDS order. */
function mismatches({ hostOk, titleOk, bodyOk }) {
  const failed = { url: !hostOk, title: !titleOk, body: !bodyOk };
  return READBACK_FIELDS.filter((field) => failed[field]);
}

/**
 * @param {object} ctx
 * @param {{run_id: string, dir: string, envelope: object, payload: object}} run
 * @param {{envelope: object, payload: object} | null} scope unused: a read-back cites nothing
 * @param {unknown} redactedInput the redacted parsed read-back JSON
 * @param {{import_sha256: string, original_hmac: string, source_path: string}} locatorBase
 * @param {{sent?: string, sent_payload?: unknown}} [extra] the resolved --sent path and its redacted parsed payload
 * @returns {{records: object[], unlocated: object[], rejected: object[], mapping_version: string}}
 * @throws {CliError} 2 USAGE(ingest: --sent …) · 2 SCHEMA-INVALID(tracker-readback: …)
 */
export function adapt(ctx, run, scope, redactedInput, locatorBase, extra) {
  const { import_sha256, original_hmac } = locatorBase;
  const sent = parseSent(extra);
  const readback = parseTicket(KIND, redactedInput);
  const body_contains_finding_id = typeof readback.body === "string" && readback.body.includes(sent.finding_id);
  const mismatch = mismatches({
    hostOk: hostAllowed(readback.url, trackerHosts(ctx)),
    titleOk: readback.title === undefined || readback.title === sent.title,
    bodyOk: body_contains_finding_id,
  });
  const trusted = {
    finding_id: sent.finding_id,
    id: readback.id,
    url: readback.url,
    labels: readback.labels,
    state: readback.state,
    body_contains_finding_id,
    mismatch,
  };
  return {
    records: [{ locator: { import_sha256, original_hmac, index: 0 }, trusted, inert: inertText(readback) }],
    unlocated: [],
    rejected: [],
    mapping_version: MAPPING_VERSION,
  };
}
