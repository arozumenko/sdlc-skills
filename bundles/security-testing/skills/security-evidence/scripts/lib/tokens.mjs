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
export const EQUIVALENCE_REQUIRED = "EQUIVALENCE-REQUIRED"; // §4.3 supersede with neither --subject-equivalent nor --transfer-exposure (thrown by TASK-029)

// --- exit-3 class -----------------------------------------------------------
export const DIRTY_TREE = "DIRTY-TREE"; // D18 / P6

// --- exit-4 class -----------------------------------------------------------
export const NO_ASSESSMENT = "NO-ASSESSMENT"; // §7 sign-off

// --- exit-5 class -----------------------------------------------------------
export const CORRUPT = "CORRUPT"; // §6.8 register recovery
export const ANCHOR_TRUNCATED = "TRUNCATED"; // §6.8 anchor verify: the log is shorter than the anchored seq
export const ANCHOR_DIVERGED = "DIVERGED"; // §6.8 anchor verify: not the anchored state (rewritten, or advanced past the anchor)

// --- exit-0 results ---------------------------------------------------------
export const ANCHOR_MATCH = "MATCH"; // §6.8 anchor verify: exactly the anchored state

// --- markers ----------------------------------------------------------------
export const COMMITTED = "COMMITTED"; // build-report's last line and the run marker file name

// --- engagement init step 0 (TASK-011; §6.9 step 0 / P3) --------------------
/** Printed before EDIT-ENGAGEMENT-AND-RERUN when step 0 wrote the engagement.md template copy. */
export const ENGAGEMENT_TEMPLATE_WRITTEN = "ENGAGEMENT: template written — edit and re-run";

const KNOWLEDGE_FILE_ORDER = Object.freeze(["engagement.md.template", "finding-schema.md", "report-reading-guide.md"]);
/**
 * `TEMPLATES: <file>=written|present …` — one entry per knowledge file, in
 * plan §3.2 order, from a `{written[], present[]}` result (knowledge-templates
 * ensureTemplates / stepTemplates). A file missing from both lists or named
 * in both is a caller bug: the line is thrown, not guessed.
 */
export function templatesLine({ written, present }) {
  if (!Array.isArray(written) || !Array.isArray(present)) throw new TypeError("templatesLine: written and present must be arrays");
  const parts = KNOWLEDGE_FILE_ORDER.map((name) => {
    const w = written.includes(name);
    const p = present.includes(name);
    if (w === p) throw new TypeError(`templatesLine: ${name} must be accounted for exactly once (written xor present)`);
    return `${name}=${w ? "written" : "present"}`;
  });
  const stray = [...written, ...present].filter((name) => !KNOWLEDGE_FILE_ORDER.includes(name));
  if (stray.length) throw new TypeError(`templatesLine: unknown knowledge file(s) ${stray.join(", ")}`);
  return `TEMPLATES: ${parts.join(" ")}`;
}

// --- keys (TASK-009; spec §6.5, plan §4.1 engagement init / validate, check) ----
export const KEY_AVAILABLE = "KEY: available"; // engagement validate, check
export const KEY_UNAVAILABLE = "KEY: unavailable"; // the recorded key_id has no file ⇒ STRUCTURE-ONLY

const KEY_STATUSES = Object.freeze(["created", "reused", "rotated"]);
/** `k` + 12 hex chars (TL-9). The one copy keys.mjs re-exports as KEY_ID_PATTERN; ctx.mjs still carries its own (TASK-008 to fold). */
export const KEY_ID = /^k[0-9a-f]{12}$/;
/** `KEY: <key_id> created|reused|rotated` — engagement init step 3, from keys.ensureKey's `{key_id, status}`. */
export function keyLine(key_id, status) {
  if (typeof key_id !== "string" || !KEY_ID.test(key_id)) throw new TypeError(`keyLine: key_id must be k + 12 hex chars, got ${String(key_id)}`);
  if (!KEY_STATUSES.includes(status)) throw new TypeError(`keyLine: status must be created|reused|rotated, got ${String(status)}`);
  return `KEY: ${key_id} ${status}`;
}
// --- register vocabulary (plan §4.3 row fields) ------------------------------
export const REGISTER_STATUSES = Object.freeze(["open", "accepted", "fixed", "regressed", "false-positive", "superseded"]);
export const REGISTER_PRIORITIES = Object.freeze(["p0", "p1", "p2", "p3"]);

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

// --- register (TASK-028; plan §4.3) -------------------------------------------

const ROW_ID = /^R-[0-9]{4}$/;

function requireRepoRelative(where, relPath) {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relPath) || relPath === ".." || relPath.startsWith("../")) {
    throw new TypeError(`${where}: path must be repo-relative, got ${String(relPath)}`);
  }
}

function byPriority(where, counts) {
  if (counts === null || typeof counts !== "object") throw new TypeError(`${where}: counts must be an object`);
  return REGISTER_PRIORITIES.map((p) => {
    if (!Number.isInteger(counts[p]) || counts[p] < 0) throw new TypeError(`${where}: ${p} must be a non-negative integer`);
    return `${p}=${counts[p]}`;
  }).join(" ");
}

/** `TRANSITION-REJECTED(<event>: <from>)` — exit 4 (§4.3: an (event, from) pair outside the table). */
export const transitionRejected = (event, from) => `TRANSITION-REJECTED(${event}: ${from})`;

/** `ROW <R-id> status=<status> priority=<priority> seq=<n>` — the result of a register verb that changed a row. */
export function row({ id, status, priority, seq }) {
  if (!ROW_ID.test(id)) throw new TypeError(`row: id must be R-nnnn, got ${String(id)}`);
  if (!REGISTER_STATUSES.includes(status)) throw new TypeError(`row: status ${String(status)} is outside the closed vocabulary`);
  if (!REGISTER_PRIORITIES.includes(priority)) throw new TypeError(`row: priority ${String(priority)} is outside the closed vocabulary`);
  if (!Number.isInteger(seq) || seq < 1) throw new TypeError(`row: seq must be a positive integer, got ${String(seq)}`);
  return `ROW ${id} status=${status} priority=${priority} seq=${seq}`;
}

/** `REPLAY seq=<n> rows=<n> chain=<sha256>` — `register.mjs replay`. */
export function replayed({ seq, rows, chain_sha256 }) {
  if (!Number.isInteger(seq) || seq < 0) throw new TypeError(`replayed: seq must be a non-negative integer, got ${String(seq)}`);
  if (!Number.isInteger(rows) || rows < 0) throw new TypeError(`replayed: rows must be a non-negative integer, got ${String(rows)}`);
  if (!SHA256.test(chain_sha256)) throw new TypeError(`replayed: chain must be 64 lowercase hex chars, got ${String(chain_sha256)}`);
  return `REPLAY seq=${seq} rows=${rows} chain=${chain_sha256}`;
}

/** `PROJECTION <repo-relative path>` — `register.mjs replay --write` persisted the projection (not an enveloped artifact, so not `WROTE`). */
export function projection(relPath) {
  requireRepoRelative("projection", relPath);
  return `PROJECTION ${relPath}`;
}

/** `STATUS rows=<n> seq=<n>` — first line of `register.mjs status`. */
export function statusLine({ rows, seq }) {
  if (!Number.isInteger(rows) || rows < 0) throw new TypeError(`statusLine: rows must be a non-negative integer, got ${String(rows)}`);
  if (!Number.isInteger(seq) || seq < 0) throw new TypeError(`statusLine: seq must be a non-negative integer, got ${String(seq)}`);
  return `STATUS rows=${rows} seq=${seq}`;
}

/** `OPEN-EXPOSURE p0=<n> p1=<n> p2=<n> p3=<n>` — open + regressed rows by priority; no approval ever reduces it (G-8). */
export function openExposure(counts) {
  return `OPEN-EXPOSURE ${byPriority("openExposure", counts)}`;
}

/** `APPROVALS unauthenticated=<n>` — the one bucket every approval-like record lands in (D15). */
export function approvals(n) {
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`approvals: n must be a non-negative integer, got ${String(n)}`);
  return `APPROVALS unauthenticated=${n}`;
}

/** `COUNT <status> p0=<n> p1=<n> p2=<n> p3=<n>` — one per status, in REGISTER_STATUSES order. */
export function count(status, counts) {
  if (!REGISTER_STATUSES.includes(status)) throw new TypeError(`count: status ${String(status)} is outside the closed vocabulary`);
  return `COUNT ${status} ${byPriority("count", counts)}`;
}

/** G-13: strings that must never appear under scripts/ (grep-guarded by tokens.test.mjs). */
export const FORBIDDEN_STRINGS = Object.freeze(["UNGATED", "exact checkout"]);

// --- register transitions (TASK-029; plan §4.3, spec §6.8) --------------------

/** `EMITTER-ONLY(<event>)` — exit 2: the generic `transition` verb refuses an event only a script step appends (ticketed, fixed, …). */
export const emitterOnly = (event) => `EMITTER-ONLY(${event})`;

/** `NOT-EQUIVALENT(<R-id>: <R-id>)` — exit 4: `supersede --subject-equivalent` where the subjects are neither the same id nor alias-linked. */
export const notEquivalent = (source, target) => `NOT-EQUIVALENT(${source}: ${target})`;

/** `ALIAS from=<finding_id> to=<finding_id> seq=<n>` — `register.mjs alias` appended a line to finding-alias.jsonl. */
export function aliased({ from_id, to_id, seq }) {
  if (!SHA256.test(from_id) || !SHA256.test(to_id)) throw new TypeError("aliased: from_id and to_id must be finding ids (sha256)");
  if (!Number.isInteger(seq) || seq < 1) throw new TypeError(`aliased: seq must be a positive integer, got ${String(seq)}`);
  return `ALIAS from=${from_id} to=${to_id} seq=${seq}`;
}

/** `CHECK expired=<n>` — the last line of `register.mjs check`, after one ROW line per expired acceptance. */
export function checked(expired) {
  if (!Number.isInteger(expired) || expired < 0) throw new TypeError(`checked: expired must be a non-negative integer, got ${String(expired)}`);
  return `CHECK expired=${expired}`;
}
