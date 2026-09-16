// lib/tokens.mjs — every result token the scripts print, spelled once
// (TASK-006 initial rows; later tasks add their rows here, G-13 / G-15).
//
// stdout is the result channel: one token per line, exactly as the spec
// spells it (plan §3.1). A command never builds a token inline — it imports
// the constant or calls the formatter, so a spelling lives in one place and
// the grep guard in tokens.test.mjs can hold the closed vocabulary.
//
// Leaf module: no imports.

// --- exit-2 class -----------------------------------------------------------
export const NOT_A_WORK_TREE = "NOT-A-WORK-TREE"; // TL-2: commands refuse to run outside a git work tree
export const EDIT_ENGAGEMENT_AND_RERUN = "EDIT-ENGAGEMENT-AND-RERUN"; // §6.9 step 0
export const ENGAGEMENT_MISSING = "ENGAGEMENT-MISSING"; // §4.1 run init / engagement baseline
export const POLICY_INVALID_PRIVATE = "POLICY-INVALID(private)"; // TL-13
export const RUN_COMMITTED = "RUN-COMMITTED"; // G-10: run snapshot refuses a COMMITTED run

// --- exit-3 class -----------------------------------------------------------
export const DIRTY_TREE = "DIRTY-TREE"; // D18 / P6

// --- exit-4 class -----------------------------------------------------------
export const NO_ASSESSMENT = "NO-ASSESSMENT"; // §7 sign-off

// --- exit-5 class -----------------------------------------------------------
export const CORRUPT = "CORRUPT"; // §6.8 register recovery

// --- markers ----------------------------------------------------------------
export const COMMITTED = "COMMITTED"; // build-report's last line and the run marker file name

// --- keys (TASK-009; spec §6.5, plan §4.1 engagement init / validate, check) ----
export const KEY_AVAILABLE = "KEY: available"; // engagement validate, check
export const KEY_UNAVAILABLE = "KEY: unavailable"; // the recorded key_id has no file ⇒ STRUCTURE-ONLY

const KEY_STATUSES = Object.freeze(["created", "reused", "rotated"]);
const KEY_ID = /^k[0-9a-f]{12}$/;
/** `KEY: <key_id> created|reused|rotated` — engagement init step 3, from keys.ensureKey's `{key_id, status}`. */
export function keyLine(key_id, status) {
  if (typeof key_id !== "string" || !KEY_ID.test(key_id)) throw new TypeError(`keyLine: key_id must be k + 12 hex chars, got ${String(key_id)}`);
  if (!KEY_STATUSES.includes(status)) throw new TypeError(`keyLine: status must be created|reused|rotated, got ${String(status)}`);
  return `KEY: ${key_id} ${status}`;
}

/** `INCOMPLETE(<name>)` — exit 3 (required input missing). */
export const incomplete = (name) => `INCOMPLETE(${name})`;
/** `INCONSISTENT(<field>)` — exit 5 (check, build-report). */
export const inconsistent = (field) => `INCONSISTENT(${field})`;
/** `ENGAGEMENT-INVALID(<err>)` — exit 2. */
export const engagementInvalid = (err) => `ENGAGEMENT-INVALID(${err})`;
/** `SCHEMA-INVALID(<schema>: <err>)` — exit 2 (an input file failed its schema before the command ran). */
export const schemaInvalid = (schema, err) => `SCHEMA-INVALID(${schema}: ${err})`;
/** `USAGE(<command>: <message>)` — exit 2 (bad argv for a known command). */
export const usage = (command, message) => `USAGE(${command}: ${message})`;

const MILESTONES = Object.freeze(["M2", "M3"]);
/** `NOT-IMPLEMENTED(M2|M3)` — exit 2, printed by the tm-lint / plan stubs M1 ships shape-only. */
export function notImplemented(milestone) {
  if (!MILESTONES.includes(milestone)) throw new TypeError(`notImplemented: milestone must be M2|M3, got ${String(milestone)}`);
  return `NOT-IMPLEMENTED(${milestone})`;
}

const SHA256 = /^[0-9a-f]{64}$/;
const OID = /^[0-9a-f]{40}$/;

/**
 * `WROTE <repo-relative path> sha256=<self_sha256>` — the last line of every
 * command that writes an enveloped artifact (§3.1). The sha is the identity
 * of what is on disk: pass writeArtifact's *returned* artifact, never the
 * makeEnvelope result (ctx.wrote enforces this against the file).
 */
export function wrote(relPath, sha256) {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relPath)) {
    throw new TypeError(`wrote: path must be repo-relative, got ${String(relPath)}`);
  }
  // ctx.rel() yields `../…` for a path outside root (or a symlinked spelling
  // of root); a WROTE line must never name a file outside the consumer repo.
  if (relPath === ".." || relPath.startsWith("../")) {
    throw new TypeError(`wrote: path must be inside the repo, got ${String(relPath)}`);
  }
  if (!SHA256.test(sha256)) throw new TypeError(`wrote: sha256 must be 64 lowercase hex chars, got ${String(sha256)}`);
  return `WROTE ${relPath} sha256=${sha256}`;
}

/** verify.schema.json `evaluation.verdict` pattern (plan TASK-005). */
export const VERDICT_PATTERN =
  /^(VERIFIED|REGRESSED|UNVERIFIED-REFOUND|UNVERIFIED-NOT-COMMITTED|UNVERIFIED-TESTS-FAILED|UNVERIFIED-NO-TEST-SURFACE|UNVERIFIED-INDETERMINATE\([a-z-]+\)|UNVERIFIED-SUPPRESSION\((deletion-only|[0-9]+ unacked)\))$/;

/**
 * The last line of `verify.mjs all`, exactly (plan §4.2):
 * `VERDICT <token> finding=<id> base=<oid> head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>`.
 */
export function verdictLine({ verdict, finding, base, head, tested_tree, verify }) {
  if (!VERDICT_PATTERN.test(verdict)) throw new TypeError(`verdictLine: verdict ${String(verdict)} is outside the closed vocabulary`);
  if (!SHA256.test(finding)) throw new TypeError("verdictLine: finding must be a sha256");
  if (!OID.test(base) || !OID.test(head)) throw new TypeError("verdictLine: base and head must be 40-hex oids");
  if (tested_tree !== "same-as-head" && !SHA256.test(tested_tree)) throw new TypeError("verdictLine: tested_tree must be an hmac or same-as-head");
  if (!SHA256.test(verify)) throw new TypeError("verdictLine: verify must be a sha256");
  return `VERDICT ${verdict} finding=${finding} base=${base} head=${head} tested_tree=${tested_tree} verify=${verify}`;
}

/** G-13: strings that must never appear under scripts/ (grep-guarded by tokens.test.mjs). */
export const FORBIDDEN_STRINGS = Object.freeze(["UNGATED", "exact checkout"]);
