// lib/profiles/index.mjs — the publication profile registry (TASK-031; spec
// §6.9 "Publication", §9.4 / P4; plan §4.1 rows `publish` / `check-export`,
// §5 TASK-031). One module per profile, the same contract for all:
//
//   PROFILE                       the spec name
//   PROFILE_VERSION               integer; recorded in export-manifest.json and
//                                 required to match when check-export re-applies
//   apply(source, register, opts) → [{relpath, bytes}]
//
// `source` is the loaded COMMITTED run (lib/profiles/_source.mjs); `register`
// is the register projection or null (only `tracker.plan` reads it — never
// `apply`, so check-export's re-application does not depend on what the
// register says today); `opts` carries what the manifest name determines
// (`finding_id` for a tracker sidecar). apply is pure over its arguments:
// same source, same opts ⇒ same bytes, which is what makes
// `check-export` a byte comparison (spec §6.9). Every relpath is a plain file
// name under the destination.
//
// Export identity (export-manifest.json `output_sha256`): one rule for every
// profile — sha256(canonical(sorted [[relpath, sha256(bytes)] …])) — so a
// one-file profile and a two-file profile are read the same way, and a set is
// identified by its members whatever order they were written in. sha256 over
// output bytes is TL-10's "plain sha256 of redacted bytes": every profile
// output derives from artifacts that passed redact.mjs at write time, and
// cmd-publish passes each output through redactString once more before the
// hash is taken.
//
// Manifest naming: a report profile writes `export-manifest.json` next to its
// files; the tracker profile writes one ticket per finding into the shared
// `<st>/handoffs/` directory, so its manifest is the per-ticket sidecar
// `<finding_id>.export-manifest.json` (a single `export-manifest.json` there
// would be overwritten by the next run's publish and could not name a set
// that dedupe shrinks). `expectedOutputs` inverts the name so check-export
// knows which files to compare without the manifest listing them
// (export-manifest.schema.json is closed: four keys).
//
// Pure (G-9): imports ../../canon.mjs (canonical, sha256Hex), ../tokens.mjs and
// the three profile modules. No fs, no git, no clock.

import { canonical, sha256Hex } from "../../canon.mjs";
import { PUBLISH_PROFILES } from "../tokens.mjs";
import * as fullReport from "./full-report.mjs";
import * as redactedReport from "./redacted-report.mjs";
import * as tracker from "./tracker.mjs";

export { PUBLISH_PROFILES };
/** The profiles M1 ships. */
export const M1_PROFILES = Object.freeze(["redacted-report", "full-report", "tracker"]);
/** Registered names whose profile lands in M3 (TASK-043): `publish` answers NOT-IMPLEMENTED(M3). */
export const M3_PROFILES = Object.freeze(["handoff", "case"]);
export const EXPORT_MANIFEST_FILE = "export-manifest.json";
export const SIDECAR_SUFFIX = ".export-manifest.json";

const MODULES = Object.freeze({ "redacted-report": redactedReport, "full-report": fullReport, tracker });
const SHA256 = /^[0-9a-f]{64}$/;
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SIDECAR = /^([0-9a-f]{64})\.export-manifest\.json$/;

/**
 * The module for a registered profile; `null` for an M3 name.
 * @param {string} name
 * @returns {{PROFILE: string, PROFILE_VERSION: number, apply: Function} | null}
 * @throws {TypeError} unknown profile (a caller bug — argv validation happens before)
 */
export function profileModule(name) {
  if (Object.hasOwn(MODULES, name)) return MODULES[name];
  if (M3_PROFILES.includes(name)) return null;
  throw new TypeError(`profiles: unknown profile ${String(name)}`);
}

/**
 * Validate an output set: plain file names, Buffer bytes, no name twice.
 * @param {{relpath: string, bytes: Buffer}[]} outputs
 * @returns {{relpath: string, bytes: Buffer}[]} the same array
 */
export function requireOutputs(outputs) {
  if (!Array.isArray(outputs)) throw new TypeError("profiles: outputs must be an array");
  const seen = new Set();
  for (const o of outputs) {
    if (o === null || typeof o !== "object") throw new TypeError("profiles: each output must be {relpath, bytes}");
    if (typeof o.relpath !== "string" || !PLAIN_NAME.test(o.relpath)) throw new TypeError(`profiles: relpath must be a plain file name, got ${String(o.relpath)}`);
    if (!Buffer.isBuffer(o.bytes)) throw new TypeError(`profiles: bytes of ${o.relpath} must be a Buffer`);
    if (seen.has(o.relpath)) throw new TypeError(`profiles: ${o.relpath} listed twice`);
    seen.add(o.relpath);
  }
  return outputs;
}

/**
 * `output_sha256`: sha256(canonical(sorted [[relpath, sha256(bytes)] …])).
 * @param {{relpath: string, bytes: Buffer}[]} outputs
 * @returns {string}
 */
export function exportIdentity(outputs) {
  requireOutputs(outputs);
  const members = outputs.map((o) => [o.relpath, sha256Hex(o.bytes)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(canonical(members));
}

/**
 * The manifest file name for a publish of `profile` with `opts`.
 * @param {string} profile an M1 profile
 * @param {{finding_id?: string}} opts
 * @returns {string}
 */
export function manifestNameFor(profile, opts) {
  if (profile === "tracker") {
    if (typeof opts?.finding_id !== "string" || !SHA256.test(opts.finding_id)) throw new TypeError("profiles: the tracker manifest name needs opts.finding_id");
    return `${opts.finding_id}${SIDECAR_SUFFIX}`;
  }
  if (!M1_PROFILES.includes(profile)) throw new TypeError(`profiles: unknown profile ${String(profile)}`);
  return EXPORT_MANIFEST_FILE;
}

/**
 * The output files a manifest named `name` covers, and the opts that
 * re-apply the profile to produce them; `null` when the name does not fit
 * the profile (a tracker manifest that is not a sidecar, a sidecar for a
 * report profile).
 * @param {string} profile an M1 profile
 * @param {string} name the manifest's base name
 * @returns {{relpaths: string[], opts: {finding_id?: string}} | null}
 */
export function expectedOutputs(profile, name) {
  if (profile === "tracker") {
    const m = SIDECAR.exec(name);
    if (!m) return null;
    return { relpaths: [tracker.ticketFile(m[1])], opts: { finding_id: m[1] } };
  }
  if (!M1_PROFILES.includes(profile)) throw new TypeError(`profiles: unknown profile ${String(profile)}`);
  if (name !== EXPORT_MANIFEST_FILE) return null;
  return { relpaths: [...MODULES[profile].OUTPUTS], opts: {} };
}
