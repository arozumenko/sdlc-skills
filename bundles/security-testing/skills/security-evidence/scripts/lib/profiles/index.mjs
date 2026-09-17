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
// that dedupe shrinks). The M3 profiles (TASK-043) invert the same way: the
// hand-off prompt `<slug>.md` lands in `<st>/handoffs/` and the admitted
// suite in `tasks/security-<slug>-admitted/` — a directory that holds
// nothing but admitted cases (spec §2, §9.2), so its manifest cannot sit
// next to its outputs — and both are re-published by every later run, so
// their manifests are per-run sidecars in `<st>/handoffs/`:
// `<run_id>.handoff.export-manifest.json` / `<run_id>.case.export-manifest.json`.
// `expectedOutputs` inverts the name so check-export knows which files to
// compare; the M3 pair also needs the manifest's recorded `opts`
// (export-manifest.schema.json `opts`, the TASK-043 G-15 extension: `slug`
// and `base_url` re-derive the handoff prompt, `members` — the sorted
// [{relpath, sha256}] list `output_sha256` hashes — names the suite files
// and is what sign-off's UNADMITTED listing compares against).
//
// Pure (G-9): imports ../../canon.mjs (canonical, sha256Hex), ../tokens.mjs and
// the five profile modules. No fs, no git, no clock.

import { canonical, sha256Hex } from "../../canon.mjs";
import { PUBLISH_PROFILES } from "../tokens.mjs";
import * as caseProfile from "./case.mjs";
import * as fullReport from "./full-report.mjs";
import * as handoff from "./handoff.mjs";
import * as redactedReport from "./redacted-report.mjs";
import * as tracker from "./tracker.mjs";

export { PUBLISH_PROFILES };
/** The profiles M1 ships. */
export const M1_PROFILES = Object.freeze(["redacted-report", "full-report", "tracker"]);
/** The two hand-off profiles (M3, TASK-043). */
export const M3_PROFILES = Object.freeze(["handoff", "case"]);
export const EXPORT_MANIFEST_FILE = "export-manifest.json";
export const SIDECAR_SUFFIX = ".export-manifest.json";

const MODULES = Object.freeze({ "redacted-report": redactedReport, "full-report": fullReport, tracker, handoff, case: caseProfile });
const SHA256 = /^[0-9a-f]{64}$/;
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SIDECAR = /^([0-9a-f]{64})\.export-manifest\.json$/;
const RUN_ID = /^[0-9a-f]{12}-[0-9]{4}$/;
const M3_SIDECAR = /^([0-9a-f]{12}-[0-9]{4})\.(handoff|case)\.export-manifest\.json$/;
const SLUG = /^[a-z0-9-]+$/;

/**
 * The module for a registered profile.
 * @param {string} name
 * @returns {{PROFILE: string, PROFILE_VERSION: number, apply: Function}}
 * @throws {TypeError} unknown profile (a caller bug — argv validation happens before)
 */
export function profileModule(name) {
  if (Object.hasOwn(MODULES, name)) return MODULES[name];
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
 * The recorded member list of an output set: sorted [{relpath, sha256}] —
 * exactly what `exportIdentity` hashes (export-manifest `opts.members`).
 * @param {{relpath: string, bytes: Buffer}[]} outputs
 * @returns {{relpath: string, sha256: string}[]}
 */
export function membersOf(outputs) {
  requireOutputs(outputs);
  return outputs.map((o) => ({ relpath: o.relpath, sha256: sha256Hex(o.bytes) })).sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0));
}

/**
 * `output_sha256` from a recorded member list (`memberIdentity(membersOf(x)) === exportIdentity(x)`).
 * @param {{relpath: string, sha256: string}[]} members
 * @returns {string}
 */
export function memberIdentity(members) {
  if (!Array.isArray(members) || !members.every((m) => m !== null && typeof m === "object" && typeof m.relpath === "string" && PLAIN_NAME.test(m.relpath) && SHA256.test(m.sha256))) throw new TypeError("profiles: members must be [{relpath, sha256}]");
  const list = members.map((m) => [m.relpath, m.sha256]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(canonical(list));
}

/**
 * The manifest file name for a publish of `profile` with `opts`.
 * @param {string} profile
 * @param {{finding_id?: string, run_id?: string}} opts
 * @returns {string}
 */
export function manifestNameFor(profile, opts) {
  if (profile === "tracker") {
    if (typeof opts?.finding_id !== "string" || !SHA256.test(opts.finding_id)) throw new TypeError("profiles: the tracker manifest name needs opts.finding_id");
    return `${opts.finding_id}${SIDECAR_SUFFIX}`;
  }
  if (M3_PROFILES.includes(profile)) {
    if (typeof opts?.run_id !== "string" || !RUN_ID.test(opts.run_id)) throw new TypeError(`profiles: the ${profile} manifest name needs opts.run_id`);
    return `${opts.run_id}.${profile}${SIDECAR_SUFFIX}`;
  }
  if (!M1_PROFILES.includes(profile)) throw new TypeError(`profiles: unknown profile ${String(profile)}`);
  return EXPORT_MANIFEST_FILE;
}

/**
 * The output files a manifest named `name` covers, the opts that re-apply
 * the profile to produce them, and the repo-relative directory they live
 * in (`null` = next to the manifest); `null` when the name does not fit the
 * profile (a tracker manifest that is not a sidecar, a sidecar for a report
 * profile, an M3 manifest not named for its run) or when the recorded
 * `opts` lack what the M3 profile needs (`slug` + `base_url` for handoff,
 * `slug` + `members` for case).
 * @param {string} profile
 * @param {string} name the manifest's base name
 * @param {{slug?: string, base_url?: string, members?: {relpath: string, sha256: string}[]}} [recorded] the manifest's `opts`
 * @returns {{relpaths: string[], opts: object, dir: string | null} | null}
 */
export function expectedOutputs(profile, name, recorded = {}) {
  if (profile === "tracker") {
    const m = SIDECAR.exec(name);
    if (!m) return null;
    return { relpaths: [tracker.ticketFile(m[1])], opts: { finding_id: m[1] }, dir: null };
  }
  if (M3_PROFILES.includes(profile)) {
    const m = M3_SIDECAR.exec(name);
    if (!m || m[2] !== profile) return null;
    const slug = recorded?.slug;
    if (typeof slug !== "string" || !SLUG.test(slug)) return null;
    if (profile === "handoff") {
      if (typeof recorded.base_url !== "string") return null;
      return { relpaths: [handoff.promptFile(slug)], opts: { slug, base_url: recorded.base_url }, dir: null };
    }
    if (!Array.isArray(recorded.members)) return null;
    try {
      memberIdentity(recorded.members);
    } catch {
      return null;
    }
    return { relpaths: recorded.members.map((x) => x.relpath), opts: { slug }, dir: caseProfile.suiteDir(slug) };
  }
  if (!M1_PROFILES.includes(profile)) throw new TypeError(`profiles: unknown profile ${String(profile)}`);
  if (name !== EXPORT_MANIFEST_FILE) return null;
  return { relpaths: [...MODULES[profile].OUTPUTS], opts: {}, dir: null };
}
