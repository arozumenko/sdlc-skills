// lib/profiles/tracker.mjs — the `tracker` publication profile (TASK-031;
// spec §6.9 "tracker (title, class, priority, path, lines, context_redacted,
// fix_prompt)", §9.4 / P4 "the script produces the validated, redacted
// payload file … dedupes against the register and prior imports"; plan §5
// TASK-031; US-039 AC-1 at the payload level, AC-3 first layer).
//
// The scripts have no tracker access (G-14): this profile writes one payload
// file per accepted finding, `<st>/handoffs/<finding_id>.ticket.json`, and
// the lead posts it through the `issue-tracking` skill, then runs `ingest
// tracker-readback --sent <that file> <response.json>`, which is the only
// emitter of the register's `ticketed` event (TASK-045). Nothing here
// touches the register.
//
// Payload — exactly nine keys (TICKET_KEYS), written canonical (so the file
// is one line + LF and its identity is over what is on disk):
//
//   finding_id        the gate-derived id (plain or keyed, §6.5) — what the
//                     read-back must find in the ticket body
//   title, class, priority, path, lines
//                     as gated (`lines` is the normalised [start, end])
//   context_redacted  the finding's recorded `context_redacted` (a
//                     secret-class finding, §6.5) and/or its description
//                     prose, joined by a blank line; `unknown / not assessed`
//                     when the finding carries neither (§11: blank forbidden).
//                     NEVER `snippet` and never `snippet_redacted`: a ticket
//                     lives in a foreign system, and a code snippet — plain
//                     or redacted — is not what a tracker body is for.
//   fix_prompt        a stub here; TASK-045's lib/fix-prompt.mjs replaces it.
//                     Names the finding, the range, the bugfix-workflow skill
//                     and the exact verify command the developer reports back
//                     with (`--base` = the run's head_oid, where the finding
//                     was observed; `--head` = the fix commit, unknown here).
//   fingerprint       sha256(path\0class): the coarse search key for the
//                     lead's second-layer dedupe (§9.4 "searches the live
//                     tracker by fingerprint") — same file, same class ⇒ same
//                     key; the exact identity is `finding_id`. Plain sha256
//                     over a path and a class name, never over content (G-2).
//
// First-layer dedupe (`plan`): a finding is skipped when
//   (a) a register row with `subject == finding_id` carries a `ticket_url`
//       (whatever its status — the row was ticketed by a read-back), or
//   (b) a `ticket` import record of the run has `trusted.state` equal to
//       `open` (compared case-insensitively — the tracker's spelling is kept
//       verbatim in the record, TASK-017) and its inert title or body
//       contains the finding id. Inert text is data, not an instruction:
//       the only effect it can have here is to *withhold* a post.
// The register is the durable cross-run memory (a read-back from any run
// lands there); imports are the run's own `ingest/*.json` (TL-3 boundary).
// `apply` never consults the register: check-export re-applies the profile
// later, after read-backs have changed it.
//
// Pure (G-9): imports ../../canon.mjs (canonical, sha256Hex), ../../redact.mjs
// (redactDeep, redactString) and ../tokens.mjs. No fs, no git, no clock.

import { canonical, sha256Hex } from "../../canon.mjs";
import { redactDeep, redactString } from "../../redact.mjs";
import { NOT_ASSESSED } from "../tokens.mjs";

export const PROFILE = "tracker";
export const PROFILE_VERSION = 1;
/** The closed nine-key payload shape, in this order (US-039 AC-1). */
export const TICKET_KEYS = Object.freeze(["finding_id", "title", "class", "priority", "path", "lines", "context_redacted", "fix_prompt", "fingerprint"]);

const SHA256 = /^[0-9a-f]{64}$/;

/** A finding the source's gate never accepted: no ticket can be derived (check-export reads it as MISMATCH(output)). */
export class NotAccepted extends Error {
  constructor(finding_id) {
    super(`tracker: ${finding_id} is not an accepted finding of the source run`);
    this.name = "NotAccepted";
    this.finding_id = finding_id;
  }
}

/** `<finding_id>.ticket.json` */
export const ticketFile = (finding_id) => `${finding_id}.ticket.json`;

/**
 * sha256(path\0class) — the coarse tracker search key.
 * @param {string} path
 * @param {string} cls
 * @returns {string}
 */
export function fingerprintOf(path, cls) {
  if (typeof path !== "string" || typeof cls !== "string") throw new TypeError("fingerprintOf: path and class must be strings");
  return sha256Hex(Buffer.from(`${path}\0${cls}`, "utf8"));
}

/** The M1 stub; TASK-045's generator (lib/fix-prompt.mjs) replaces it. */
export function fixPromptStub({ finding_id, class: cls, priority, path, lines, base_oid }) {
  return [
    `Load the bugfix-workflow skill for security finding ${finding_id} (${cls}, ${priority}) at ${path}:${lines[0]}-${lines[1]}.`,
    "Fix the cause at the cited range; never edit tests, ignore files or suppression config to make it pass.",
    `Report back with the exact command: verify.mjs all --finding ${finding_id} --base ${base_oid} --head <fix-commit>`,
  ].join(" ");
}

function contextOf(finding) {
  const parts = [];
  if (typeof finding.context_redacted === "string" && finding.context_redacted !== "") parts.push(finding.context_redacted);
  if (typeof finding.description === "string" && finding.description !== "") parts.push(finding.description);
  return parts.length === 0 ? NOT_ASSESSED : redactString(parts.join("\n\n")).text;
}

/**
 * The nine-key payload for one gated finding (see the header).
 * @param {import("./_source.mjs").Source} source
 * @param {object} finding a finding of the source's claimed set
 * @returns {object}
 */
export function payloadFor(source, finding) {
  if (finding === null || typeof finding !== "object" || !SHA256.test(finding.id)) throw new TypeError("payloadFor: finding must be a gated finding");
  const base = { finding_id: finding.id, class: finding.class, priority: finding.priority, path: finding.path, lines: [finding.lines[0], finding.lines[1]] };
  return redactDeep({
    finding_id: finding.id,
    title: finding.title,
    class: finding.class,
    priority: finding.priority,
    path: finding.path,
    lines: base.lines,
    context_redacted: contextOf(finding),
    fix_prompt: fixPromptStub({ ...base, base_oid: source.run.payload.head_oid }),
    fingerprint: fingerprintOf(finding.path, finding.class),
  });
}

function acceptedIds(source) {
  const accepted = source.gateResult?.payload?.accepted;
  if (!Array.isArray(accepted)) return [];
  return [...accepted].sort();
}

function findingOf(source, finding_id) {
  const findings = source.claimed?.payload?.findings;
  if (!Array.isArray(findings)) return null;
  return findings.find((f) => f.id === finding_id) ?? null;
}

function textNames(value, id) {
  return typeof value === "string" && value.includes(id);
}

/**
 * First-layer dedupe (see the header).
 * @param {import("./_source.mjs").Source} source
 * @param {{rows: Record<string, object>} | null} register the register projection, or null
 * @returns {{candidates: string[], tickets: string[], deduped: {finding_id: string, existing: string}[]}}
 */
export function plan(source, register) {
  const rows = register === null || register === undefined ? [] : Object.values(register.rows ?? {});
  const tickets = (source.imports ?? []).filter((i) => i.payload.kind === "ticket").flatMap((i) => i.payload.records);
  const candidates = acceptedIds(source);
  const deduped = [];
  const keep = [];
  for (const id of candidates) {
    const row = rows.find((r) => r.subject === id && typeof r.ticket_url === "string" && r.ticket_url !== "");
    if (row) {
      deduped.push({ finding_id: id, existing: row.ticket_url });
      continue;
    }
    const open = tickets.find((rec) => typeof rec.trusted?.state === "string" && rec.trusted.state.toLowerCase() === "open" && (textNames(rec.inert?.title, id) || textNames(rec.inert?.body, id)));
    if (open) {
      deduped.push({ finding_id: id, existing: open.trusted.url });
      continue;
    }
    keep.push(id);
  }
  return { candidates, tickets: keep, deduped };
}

/**
 * One ticket payload file for `opts.finding_id` (see the header).
 * @param {import("./_source.mjs").Source} source
 * @param {object | null} _register unused: dedupe is `plan`'s, never apply's
 * @param {{finding_id: string}} opts
 * @returns {{relpath: string, bytes: Buffer}[]}
 * @throws {NotAccepted} the id is not in the source's gate-result.accepted (or has no finding record)
 */
export function apply(source, _register, opts) {
  const finding_id = opts?.finding_id;
  if (typeof finding_id !== "string" || !SHA256.test(finding_id)) throw new TypeError("tracker.apply: opts.finding_id is required");
  if (!acceptedIds(source).includes(finding_id)) throw new NotAccepted(finding_id);
  const finding = findingOf(source, finding_id);
  if (finding === null) throw new NotAccepted(finding_id);
  const payload = payloadFor(source, finding);
  return [{ relpath: ticketFile(finding_id), bytes: Buffer.concat([canonical(payload), Buffer.from("\n")]) }];
}
