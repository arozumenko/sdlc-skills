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
/** `k` + 12 hex chars (TL-9). The one copy: keys.mjs re-exports it as KEY_ID_PATTERN and ctx.mjs imports it (folded in TASK-008). */
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

// --- run init (TASK-012; plan §4.1 row `run init`, TL-9) ----------------------

const RUN_ID_SHAPE = /^[0-9a-f]{12}-[0-9]{4}$/;
const RUN_KIND_LIST = Object.freeze(["assessment", "review", "verify", "threat-model"]);

/** `RUN <run_id> seq=<n> kind=<k> base=<oid> head=<oid>` — the first line of `run init`; the WROTE lines follow. */
export function runLine({ run_id, seq, kind, base, head }) {
  if (typeof run_id !== "string" || !RUN_ID_SHAPE.test(run_id)) throw new TypeError(`runLine: run_id must be <12 hex>-<4 digits>, got ${String(run_id)}`);
  if (!Number.isInteger(seq) || seq < 1) throw new TypeError(`runLine: seq must be a positive integer, got ${String(seq)}`);
  if (!RUN_KIND_LIST.includes(kind)) throw new TypeError(`runLine: kind ${String(kind)} is outside the closed vocabulary`);
  if (!OID.test(base) || !OID.test(head)) throw new TypeError("runLine: base and head must be 40-hex oids");
  return `RUN ${run_id} seq=${seq} kind=${kind} base=${base} head=${head}`;
}

// --- baseline (TASK-010; spec §6.9 step 4, plan §4.1 engagement init / baseline) ---

function requireCount(where, name, n) {
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`${where}: ${name} must be a non-negative integer, got ${String(n)}`);
  return n;
}

/**
 * `BASELINE: <n> files ignored=<n>` — `engagement init` step 4 and
 * `engagement baseline`: observed files (tracked + non-ignored untracked under
 * scope_paths ∪ product_paths) and the summed per-path count of ignored files
 * left outside the observation (§2 last row: the excluded coverage is visible).
 * `files` is always the literal word, so the line parses the same for 1.
 */
export function baselineLine({ files, ignored }) {
  return `BASELINE: ${requireCount("baselineLine", "files", files)} files ignored=${requireCount("baselineLine", "ignored", ignored)}`;
}

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

// --- engagement init / validate (TASK-008; spec §6.9 steps 0–4, plan §4.1 rows `engagement init|validate`) ---

/** Step 0's second line when engagement.md was already there (the other case is ENGAGEMENT_TEMPLATE_WRITTEN). */
export const ENGAGEMENT_PRESENT = "ENGAGEMENT: present";
/** Step 1: the managed block was written (created, or re-rendered after a policy change / hand edit). */
export const IGNORE_BLOCK_WRITTEN = "IGNORE-BLOCK: written";
/** Step 1: the .gitignore already held exactly the block `artifact_policy` renders. */
export const IGNORE_BLOCK_UNCHANGED = "IGNORE-BLOCK: unchanged";
/** validate: the .gitignore holds exactly the block the policy renders (init would print `unchanged`). */
export const IGNORE_BLOCK_OK = "IGNORE-BLOCK: ok";
/** validate: init would rewrite the block — hand-edited, policy changed, or the file is gone (the deleted-file shape). */
export const IGNORE_BLOCK_STALE = "IGNORE-BLOCK: stale";
/** validate: `git ls-files` lists nothing under any active managed path. */
export const TRACKED_NONE = "TRACKED: none";
/** validate: the baseline file for this engagement exists and verifies. */
export const BASELINE_PRESENT = "BASELINE: present";
/** validate: no baseline file for this engagement. */
export const BASELINE_ABSENT = "BASELINE: absent";
/** `TRACKED(<path>)` — exit 4 (step 2): a tracked file under a managed path; `path` is repo-relative. */
// --- purge (TASK-032; plan §4.1 row `purge`, spec §6.9 / P3) ------------------

const CURRENT_KEY_OUTCOMES = Object.freeze(["removed", "kept"]);

/**
 * `PURGED runs=<n> keys=<n> current-key=removed|kept` — the one stdout line
 * of a `purge --yes` that ran: run ids deleted, key rows (keys/index.json)
 * deleted, and whether `keys/current` named one of them and was removed.
 */
export function purged({ runs, keys, current_key }) {
  if (!Number.isInteger(runs) || runs < 0) throw new TypeError(`purged: runs must be a non-negative integer, got ${String(runs)}`);
  if (!Number.isInteger(keys) || keys < 0) throw new TypeError(`purged: keys must be a non-negative integer, got ${String(keys)}`);
  if (!CURRENT_KEY_OUTCOMES.includes(current_key)) throw new TypeError(`purged: current_key must be removed|kept, got ${String(current_key)}`);
  return `PURGED runs=${runs} keys=${keys} current-key=${current_key}`;
}

/** `PURGE <repo-relative path>` — one line per path the plan would delete (printed without `--yes`, before the exit-2 token). */
export function purgePlan(relPath) {
  requireRepoRelative("purgePlan", relPath);
  return `PURGE ${relPath}`;
}

/**
 * `TRACKED(<repo-relative path>)` — exit 4: a file git tracks under a
 * managed-ignored destination (spec §6.9 step 2 for `engagement init`;
 * `purge` refuses over the same condition before deleting anything).
 */
export function tracked(relPath) {
  requireRepoRelative("tracked", relPath);
  return `TRACKED(${relPath})`;
}
/** `NOT-IGNORED(<pattern>)` — exit 4 (step 2): `git check-ignore` refused the pattern's probe file; names the pattern. */
export function notIgnored(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0 || pattern.includes("\n")) throw new TypeError(`notIgnored: pattern must be a non-empty single line, got ${String(pattern)}`);
  return `NOT-IGNORED(${pattern})`;
}

// --- scope (TASK-013; plan §4.1 row `scope`, spec §6.2, D18 / P6) -------------

/** `SCOPE-EXISTS` — exit 2: `scope` refuses a run that already has a scope.json (G-10: write-once; retry = new seq). Parallel to `run snapshot`'s SNAPSHOT-EXISTS. */
export const SCOPE_EXISTS = "SCOPE-EXISTS";

/**
 * `SCOPE files=<n> ranges=<n> skipped=<n> snapshot=<n>` — the first line of
 * `scope`; the WROTE line follows. `ranges` is the number of admitted range
 * entries summed over every file (an empty file admits none), `snapshot` the
 * number of dirty/untracked review files stored redacted under private/.
 */
export function scopeLine({ files, ranges, skipped, snapshot }) {
  return `SCOPE files=${requireCount("scopeLine", "files", files)} ranges=${requireCount("scopeLine", "ranges", ranges)} skipped=${requireCount("scopeLine", "skipped", skipped)} snapshot=${requireCount("scopeLine", "snapshot", snapshot)}`;
}

// --- ingest (TASK-015; plan §4.1 row `ingest`, spec §6.6) --------------------

/** The `ingest <kind>` vocabulary = import.schema.json's `kind` enum; the leaf cannot import imports.mjs, so imports.test.mjs guards the drift. */
const IMPORT_KIND_LIST = Object.freeze(["sarif", "ticket", "pr", "doc", "case", "audit", "qa-run", "ta-report", "tracker-readback"]);

/** `IMPORT <kind> import_sha256=<h> records=<n> unlocated=<n> rejected=<n>` — the first line of `ingest`; the WROTE lines follow. */
export function importLine({ kind, import_sha256, records, unlocated, rejected }) {
  if (!IMPORT_KIND_LIST.includes(kind)) throw new TypeError(`importLine: kind ${String(kind)} is outside the closed vocabulary`);
  if (!SHA256.test(import_sha256)) throw new TypeError("importLine: import_sha256 must be 64 lowercase hex chars");
  requireCount("importLine", "records", records);
  requireCount("importLine", "unlocated", unlocated);
  requireCount("importLine", "rejected", rejected);
  return `IMPORT ${kind} import_sha256=${import_sha256} records=${records} unlocated=${unlocated} rejected=${rejected}`;
}

/** `IMPORT-EXISTS(<import_sha256>)` — exit 2: the same redacted bytes were already ingested into this run (its record is write-once, G-10). */
export function importExists(import_sha256) {
  if (!SHA256.test(import_sha256)) throw new TypeError("importExists: import_sha256 must be 64 lowercase hex chars");
  return `IMPORT-EXISTS(${import_sha256})`;
}

// --- consume-verdict (TASK-030; plan §4.3, spec §6.4 last paragraph) -----------

/** `NO-ROW` — exit 2: the register has no live row whose subject is the verify artifact's finding id (the lead adds rows). */
export const NO_ROW = "NO-ROW";

/** `CONSUMED <verdict> row=<R-id> verify=<sha256>` — the first line of `register.mjs consume-verdict`; one ROW line per appended event follows. */
export function consumed({ verdict, row: id, verify }) {
  if (!VERDICT_PATTERN.test(verdict)) throw new TypeError(`consumed: verdict ${String(verdict)} is outside the closed vocabulary`);
  if (!ROW_ID.test(id)) throw new TypeError(`consumed: row must be R-nnnn, got ${String(id)}`);
  if (!SHA256.test(verify)) throw new TypeError(`consumed: verify must be a sha256, got ${String(verify)}`);
  return `CONSUMED ${verdict} row=${id} verify=${verify}`;
}

// --- run snapshot (TASK-058; plan §4.1 rows `run snapshot register|verify|proposals`, spec P2) ---

/** Exit 2: the run already holds this snapshot (`register-events.json`, or `verify-snapshots/<id>/`) — write-once, G-10. */
export const SNAPSHOT_EXISTS = "SNAPSHOT-EXISTS";

/** `KIND(<kind>)` — exit 2: `run snapshot` on a run whose kind is not `assessment`. */
export function kindRefused(kind) {
  if (!RUN_KIND_LIST.includes(kind)) throw new TypeError(`kindRefused: kind ${String(kind)} is outside the closed vocabulary`);
  return `KIND(${kind})`;
}

/** `SNAPSHOT register events=<n> chain=<sha256>` — the register log as copied into the run; the WROTE line follows. */
export function snapshotRegister({ events, chain_sha256 }) {
  if (!Number.isInteger(events) || events < 0) throw new TypeError(`snapshotRegister: events must be a non-negative integer, got ${String(events)}`);
  if (!SHA256.test(chain_sha256)) throw new TypeError(`snapshotRegister: chain must be 64 lowercase hex chars, got ${String(chain_sha256)}`);
  return `SNAPSHOT register events=${events} chain=${chain_sha256}`;
}

/** `SNAPSHOT verify from=<verify_run_id> sha256=<verify self_sha256>` — one per `--from`, after its files are copied and re-verified. */
export function snapshotVerify({ from, sha256 }) {
  if (typeof from !== "string" || !RUN_ID_SHAPE.test(from)) throw new TypeError(`snapshotVerify: from must be <12 hex>-<4 digits>, got ${String(from)}`);
  if (!SHA256.test(sha256)) throw new TypeError(`snapshotVerify: sha256 must be 64 lowercase hex chars, got ${String(sha256)}`);
  return `SNAPSHOT verify from=${from} sha256=${sha256}`;
}

/** `SNAPSHOT proposals n=<n>` — the proposals index was rewritten with n entries; the WROTE line follows. */
export function snapshotProposals(n) {
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`snapshotProposals: n must be a non-negative integer, got ${String(n)}`);
  return `SNAPSHOT proposals n=${n}`;
}

// --- register render (TASK-059; plan §4.3 `render`, spec §6.8 / P5) -----------

/** `RENDER <repo-relative path> rows=<n> seq=<n>` — `register.mjs render` wrote the Markdown view (not an enveloped artifact, so not `WROTE`). */
export function rendered({ relPath, rows, seq }) {
  requireRepoRelative("rendered", relPath);
  if (!Number.isInteger(rows) || rows < 0) throw new TypeError(`rendered: rows must be a non-negative integer, got ${String(rows)}`);
  if (!Number.isInteger(seq) || seq < 0) throw new TypeError(`rendered: seq must be a non-negative integer, got ${String(seq)}`);
  return `RENDER ${relPath} rows=${rows} seq=${seq}`;
}

// --- citations (TASK-014; spec §6.2 range rule / v3 §6.1, plan §5 TASK-014) ------
// `cite.checkRange` reasons. Not stdout tokens: `gate` records them as
// `rejects.json` reasons and `gate-result.rejected_counts` keys and the report
// displays them — spelled once here (G-13). The plan names RANGE-NOT-ADMITTED;
// the other four are TASK-014's spellings (recorded in the plan's PM log).

/** `lines` is not `[start, end]` of integers with 1 ≤ start ≤ end. */
export const RANGE_INVALID = "RANGE-INVALID";
/** `end - start + 1 > 40` (spec §6.2). */
export const RANGE_TOO_LONG = "RANGE-TOO-LONG";
/** The cited path is not a `scope.files[]` entry (skipped, or never listed). */
export const PATH_NOT_IN_SCOPE = "PATH-NOT-IN-SCOPE";
/** A `head` citation of a `snapshot`-side scope file or vice versa (`base` is exempt: its bytes are never a scope file). */
export const SIDE_MISMATCH = "SIDE-MISMATCH";
/** A primary range that lies inside no single admitted range of its file (spec §6.2). */
export const RANGE_NOT_ADMITTED = "RANGE-NOT-ADMITTED";
// --- ingest tracker-readback (TASK-017; plan §4.1 row `ingest`, spec §6.6 / P4) ---

/**
 * The fields a read-back can differ from the sent payload on, in the order
 * the adapter records them and the READBACK lines print them: `url` (host ∉
 * targets.tracker), `title` (read-back title ≠ sent title), `body` (the
 * read-back body does not name the finding id). The adapter imports this
 * list, so the record's `mismatch[]` and the stdout token share one vocabulary.
 */
export const READBACK_FIELDS = Object.freeze(["url", "title", "body"]);

/** `READBACK: ok` — the read-back matches what was sent on every READBACK_FIELDS entry (TASK-045 may then append `ticketed`). */
export const READBACK_OK = "READBACK: ok";

/** `READBACK: MISMATCH(<field>)` — one line per mismatched field, after the IMPORT line and before the WROTE lines. */
export function readbackMismatch(field) {
  if (!READBACK_FIELDS.includes(field)) throw new TypeError(`readbackMismatch: field ${String(field)} is outside the closed vocabulary`);
  return `READBACK: MISMATCH(${field})`;
}
// --- ingest sarif (TASK-016; spec §6.6 row `sarif`, §6.7 fallback matrix, D6) ---
// Not stdout tokens: the adapter records them in the import record
// (`rejected[].reason`, `unlocated[].reason`, `trusted.recorded[]`) and the
// report displays them (US-010 AC-3 "rejections are counted by reason and
// displayed") — spelled once here (G-13). lib/ingest/_sarif.mjs groups them
// as REJECT / RECORDED for its callers.

// `rejected[].reason`: a result the §6.7 matrix rejects — counted, never dropped.
/** neither a usable `ruleId` (non-empty string) nor a usable `ruleIndex` (an index into `rules[]`) */
export const SARIF_RULE_MISSING = "rule-missing";
/** §6.7 "ruleIndex and ruleId disagree" */
export const SARIF_RULE_MISMATCH = "rule-mismatch";
/** `level` present but outside `error|warning|note|none` */
export const SARIF_LEVEL_INVALID = "level-invalid";
/** §6.7 "malformed region": `startLine`/`endLine` not integers ≥ 1, `endLine < startLine`, or a snippet that is not `{text: string}` */
export const SARIF_REGION_MALFORMED = "region-malformed";
/** the region names a raw line past the end of the file at the recorded side */
export const SARIF_REGION_OUTSIDE_FILE = "region-outside-file";
/** every raw line of the region is blank — there is no normalised line to cite */
export const SARIF_REGION_BLANK = "region-blank";
/** the scope file's bytes are not UTF-8, so its lines cannot be numbered */
export const SARIF_FILE_NOT_TEXT = "file-not-text";

// `trusted.recorded[]` of a located SARIF record: the §6.7 fallbacks taken, in evaluation order.
/** §6.7 "unknown tool … recorded": class from tags only, `default_confidence` */
export const SARIF_UNKNOWN_TOOL = "unknown-tool";
/** the result's `ruleId` names no `rules[]` entry: no tags, no default level */
export const SARIF_RULE_NOT_IN_METADATA = "rule-not-in-metadata";
/** the rule's `defaultConfiguration.level` is outside the vocabulary and was treated as absent */
export const SARIF_RULE_DEFAULT_LEVEL_INVALID = "rule-default-level-invalid";
/** §6.7 "level absent ⇒ rule defaultConfiguration.level" */
export const SARIF_LEVEL_FROM_RULE_DEFAULT = "level-from-rule-default";
/** §6.7 "… absent ⇒ p3" */
export const SARIF_LEVEL_ABSENT = "level-absent";
/** §6.7 "startLine present, endLine absent ⇒ endLine = startLine" */
export const SARIF_ENDLINE_DEFAULTED = "endline-defaulted";
/** §6.7 "region present, snippet absent ⇒ snippet read from the recorded side" */
export const SARIF_SNIPPET_FROM_SIDE = "snippet-from-side";

/** `unlocated[].reason` (import.schema.json Candidate enum): §6.7 row 1 — no physicalLocation, URI not canonicalisable inside the repo, or no line region. */
export const UNLOCATED_NO_LOCATION = "no-location";
/** `unlocated[].reason`: §6.7 row 2 — a canonical in-repo path that is not a `scope.files[]` entry. */
export const UNLOCATED_OUT_OF_SCOPE = "out-of-scope";

// --- packet (TASK-057; plan §4.1 row `packet`, spec §6.4 / P1, TL-15) -------------

/** packet.schema.json `kind` vocabulary — tokens.mjs is a leaf, so this is its own copy (packet-core.PACKET_KINDS is the module's; packet-core.test pins them equal). */
const PACKET_KIND_LIST = Object.freeze(["scope", "subject"]);

/**
 * `PACKET <repo-relative path> sha256=<packet_sha256> kind=<scope|subject> files=<n>`
 * — the first line of `evidence.mjs packet`; the WROTE line follows. The sha
 * is the packet's identity and the file's name (`<run>/packets/<sha>.json`):
 * what a claims / examined / receipt file names as `packet_sha256`.
 */
export function packetLine({ relPath, sha256, kind, files }) {
  requireRepoRelative("packetLine", relPath);
  if (!SHA256.test(sha256)) throw new TypeError(`packetLine: sha256 must be 64 lowercase hex chars, got ${String(sha256)}`);
  if (!PACKET_KIND_LIST.includes(kind)) throw new TypeError(`packetLine: kind ${String(kind)} is outside the closed vocabulary`);
  return `PACKET ${relPath} sha256=${sha256} kind=${kind} files=${requireCount("packetLine", "files", files)}`;
}

// --- gate (TASK-019; plan §4.1 row `gate`, §5 TASK-019; spec §6.1 gate-result, §6.5, TL-15) ---

/** `gate` citation states — the only two a finding can carry (spec §6.5; finding.schema.json `state`). */
export const CITATION_VERIFIED = "CITATION_VERIFIED";
export const CITATION_FAILED = "CITATION_FAILED";

/**
 * `GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>` — the first
 * line of `evidence.mjs gate`; four WROTE lines follow (findings.claimed.json,
 * gate-result.json, rejects.json, unlocated.json, in write order). `rejected`
 * counts gate's own rejections (adapter-level rejections stay in the import
 * records); `unlocated` counts the candidates copied from the import records.
 */
export function gateLine({ accepted, unverifiable, rejected, unlocated }) {
  return `GATE accepted=${requireCount("gateLine", "accepted", accepted)} unverifiable=${requireCount("gateLine", "unverifiable", unverifiable)} rejected=${requireCount("gateLine", "rejected", rejected)} unlocated=${requireCount("gateLine", "unlocated", unlocated)}`;
}

/** `CLAIMS-PACKET-MISMATCH(<file>)` — exit 2 (TL-15): the claims file's `packet_sha256` is not a `kind: scope` packet of the run (or its `scope_sha256` is not the run's scope). `<file>` is the path as the user typed it. */
export function claimsPacketMismatch(file) {
  if (typeof file !== "string" || file === "" || file.includes("\n")) throw new TypeError("claimsPacketMismatch: file must be a one-line path");
  return `CLAIMS-PACKET-MISMATCH(${file})`;
}

/** `GATE-EXISTS` — exit 2: the run already has its gate artifacts (write-once, G-10; retry = new seq). Not spelled by the spec; the SCOPE-EXISTS shape. */
export const GATE_EXISTS = "GATE-EXISTS";

// `rejects.json` reasons that are gate's own (the five cite.checkRange reasons
// above are recorded there too). Not stdout tokens: they key
// `gate-result.rejected_counts` and the report displays them — spelled once (G-13).
/** G-7: a claim carrying `id`, `state` or another forbidden key (schema.RECEIPT_FORBIDDEN_KEYS) — the agent tried to write an identity or a state. */
export const GATE_AGENT_WROTE_ID = "agent-wrote-id";
/** a claim that is not a finding.schema.json Claim — `priority` / `confidence` missing or off-range (never defaulted), a snippet that normalises to nothing, an unknown field. */
export const GATE_CLAIM_INVALID = "claim-invalid";
/** a `base` citation of a scope file that has no blob at `base_oid` (the file was added after base). */
export const GATE_PATH_NOT_AT_SIDE = "PATH-NOT-AT-SIDE";
/** a range that runs past the last normalised line of the file at its side: a `base` primary citation past the base blob, or a typed citation past its file. */
export const GATE_RANGE_OUTSIDE_FILE = "RANGE-OUTSIDE-FILE";
/** the file at the cited side is not UTF-8, so its lines cannot be numbered or compared. */
export const GATE_FILE_NOT_TEXT = "FILE-NOT-TEXT";
/** a second candidate with the identity of one already gated (same path, class, snippet, occurrence): one finding, one entry; a CITATION_VERIFIED candidate outranks a CITATION_FAILED one, else the first wins. */
export const GATE_DUPLICATE_ID = "duplicate-id";

// --- coverage (TASK-020; plan §4.1 row `coverage`, spec D3 / §6.3, US-014) -------

/** `EXAMINED-PACKET-MISMATCH` — exit 2: the examined declaration's `packet_sha256` is not a `kind: scope` packet of this run (TL-15). */
export const EXAMINED_PACKET_MISMATCH = "EXAMINED-PACKET-MISMATCH";
/** `COVERAGE-EXISTS` — exit 2: `coverage` refuses a run that already has examined.json or coverage.json (G-10: write-once; retry = new seq). Parallel to SCOPE-EXISTS. */
export const COVERAGE_EXISTS = "COVERAGE-EXISTS";
/** `COVERAGE INDETERMINATE` — exit 0: the scope has no files (D3); coverage.json carries `indeterminate: true`, which `sign-off` (TASK-033) turns into `COVERAGE-INDETERMINATE(<run>)`. */
export const COVERAGE_INDETERMINATE = "COVERAGE INDETERMINATE";

function requireLineRange(where, path, start, end) {
  if (typeof path !== "string" || path.length === 0) throw new TypeError(`${where}: path must be a non-empty string`);
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start) throw new TypeError(`${where}: range must be integers 1 ≤ start ≤ end, got ${String(start)}-${String(end)}`);
}

/** `OVERLAP(<path>:<a>-<b>)` — exit 4: two examined declarations cover the same lines; `a-b` is the intersection (plan §5 TASK-020). */
export function overlap(path, start, end) {
  requireLineRange("overlap", path, start, end);
  return `OVERLAP(${path}:${start}-${end})`;
}

/** `GAP(<path>:<a>-<b>)` — exit 4: lines of an admitted range that no accounting entry covers — a bug in the accounting, never a declaration gap (which is reported as `unexamined`). */
export function gap(path, start, end) {
  requireLineRange("gap", path, start, end);
  return `GAP(${path}:${start}-${end})`;
}

/**
 * `COVERAGE examined=<n> skipped=<n> scanner=<n>` — the first line of
 * `coverage` when the scope is not empty; the two WROTE lines follow. The
 * counts are accounting entries by status (`examined`, `skipped`,
 * `scanner-only`); `unexamined` entries are the remainder and are not printed.
 */
export function coverageLine({ examined, skipped, scanner }) {
  return `COVERAGE examined=${requireCount("coverageLine", "examined", examined)} skipped=${requireCount("coverageLine", "skipped", skipped)} scanner=${requireCount("coverageLine", "scanner", scanner)}`;
}

// --- packet --kind subject (TASK-021; plan §5 TASK-021, §4.1 row `packet`; spec §6.4 / P1) ---

/**
 * `UNVERIFIABLE-SUBJECT(<id>)` — exit 2: `packet --kind subject` names a
 * finding in `gate-result.unverifiable[]` (CITATION_FAILED): there is nothing
 * a reviewer can confirm, so no packet is built (plan §5 TASK-021). The
 * TASK-057 `NOT-IMPLEMENTED(TASK-021)` stub row is gone: the subject packet
 * ships. `<id>` is the finding id as given (a keyed or plain identity, never
 * content).
 */
export function unverifiableSubject(id) {
  if (!SHA256.test(id)) throw new TypeError(`unverifiableSubject: id must be a finding id (64 lowercase hex chars), got ${String(id)}`);
  return `UNVERIFIABLE-SUBJECT(${id})`;
}

// --- receipt validate | apply + states (TASK-022; plan §4.1 rows `receipt validate|apply`, §5 TASK-022; spec §6.4 receipt table, §6.3 derivation row `REVIEW_*, MITIGATION_*`) ---

// Derived states (states.mjs; spec §6.4 table). CITATION_VERIFIED / CITATION_FAILED
// are gate's (above); these six are receipt apply's. `*_INDETERMINATE` is also
// what conflicting same-run assertions derive.
export const REVIEW_CONFIRMED = "REVIEW_CONFIRMED";
export const REVIEW_REFUTED = "REVIEW_REFUTED";
export const REVIEW_INDETERMINATE = "REVIEW_INDETERMINATE";
export const MITIGATION_CONFIRMED = "MITIGATION_CONFIRMED";
export const MITIGATION_GAP = "MITIGATION_GAP";
export const MITIGATION_INDETERMINATE = "MITIGATION_INDETERMINATE";

// `not_applied[].reason` (states.applyReceipts). Not stdout tokens: `receipt
// apply --json` and the report display them — spelled once (G-13).
/** the receipt's `packet_sha256` names no packet of the set. */
export const NOT_APPLIED_PACKET_UNKNOWN = "packet-unknown";
/** the named packet does not list `subject_id` (a scope packet lists no subject at all). */
export const NOT_APPLIED_SUBJECT_NOT_IN_PACKET = "subject-not-in-packet";
/** spec §6.4 row 2: the subject is a CITATION_FAILED finding — it stays unverifiable, whatever the receipt says. */
export const NOT_APPLIED_CITATION_FAILED = "citation-failed";
/** a mitigation-review receipt whose subject is a gate finding: mitigation states live on threat-model mitigations only and never promote a finding. */
export const NOT_APPLIED_SUBJECT_IS_FINDING = "subject-is-finding";
/** spec §6.4 row 3: a fix-review or ack receipt on a REVIEW_REFUTED finding changes nothing (`verify` refuses such a finding). */
export const NOT_APPLIED_REVIEW_REFUTED = "review-refuted";

/**
 * `REJECTED(<reason>)` — exit 4: `receipt validate` refused the drop-box file.
 * The reasons (plan §4.1): `schema: <err>`, `forbidden field <name>`,
 * `unknown packet`, `scope packet`, `packet_sha256 mismatch`, `subject_id not
 * in packet.subject_ids`, `reviewer_run_id != run`, `oid mismatch <path>` —
 * the plan's `∉` / `≠` spelled in ASCII so the token greps.
 */
export function rejected(reason) {
  if (typeof reason !== "string" || reason.length === 0 || reason.includes("\n")) throw new TypeError("rejected: reason must be a non-empty single line");
  return `REJECTED(${reason})`;
}
/** `schema: <err>` — the file is not strict JSON or not a receipt.schema.json receipt (the first error). */
export const receiptSchemaReason = (err) => `schema: ${err}`;
/** `forbidden field <name>` — the receipt carries an id, a state or another schema.RECEIPT_FORBIDDEN_KEYS key anywhere (US-015 AC-7, G-7). */
export const receiptForbiddenReason = (name) => `forbidden field ${name}`;
/** `unknown packet` — `packet_sha256` names no `<run>/packets/<sha>.json`. */
export const RECEIPT_UNKNOWN_PACKET = "unknown packet";
/** `scope packet` — the named packet is `kind: scope`; only a subject packet is a receipt target (P1). */
export const RECEIPT_SCOPE_PACKET = "scope packet";
/** `packet_sha256 mismatch` — the packet file exists but its `self_sha256` is not the name the receipt cites. */
export const RECEIPT_PACKET_SHA_MISMATCH = "packet_sha256 mismatch";
/** `subject_id not in packet.subject_ids`. */
export const RECEIPT_SUBJECT_NOT_IN_PACKET = "subject_id not in packet.subject_ids";
/** `reviewer_run_id != run` — the receipt names another run (or no run at all). */
export const RECEIPT_RUN_MISMATCH = "reviewer_run_id != run";
/** `oid mismatch <path>` — a `packet.files[]` entry's oid is not the blob at the run's head/base oid (or the scope's snapshot `redacted_sha256`). */
export function receiptOidMismatch(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\n")) throw new TypeError("receiptOidMismatch: path must be a non-empty single line");
  return `oid mismatch ${path}`;
}

const RECEIPT_TYPE_LIST = Object.freeze(["vulnerability-review", "mitigation-review", "fix-review", "ack"]);
/**
 * `RECEIPT admitted sha256=<h> type=<t> subject=<id>` — the first line of
 * `receipt validate`; the WROTE line follows with the same sha (the receipt's
 * identity and its file name under `<run>/receipts/`).
 */
export function receiptLine({ sha256, type, subject }) {
  if (!SHA256.test(sha256)) throw new TypeError(`receiptLine: sha256 must be 64 lowercase hex chars, got ${String(sha256)}`);
  if (!RECEIPT_TYPE_LIST.includes(type)) throw new TypeError(`receiptLine: type ${String(type)} is outside the closed vocabulary`);
  if (typeof subject !== "string" || subject.length === 0 || /\s/.test(subject)) throw new TypeError(`receiptLine: subject must be a non-empty id without whitespace, got ${String(subject)}`);
  return `RECEIPT admitted sha256=${sha256} type=${type} subject=${subject}`;
}

const STATE_LIST = Object.freeze([CITATION_VERIFIED, CITATION_FAILED, REVIEW_CONFIRMED, REVIEW_REFUTED, REVIEW_INDETERMINATE, MITIGATION_CONFIRMED, MITIGATION_GAP, MITIGATION_INDETERMINATE]);
/** `STATE <subject_id> <state>` — one line per subject of `receipt apply`'s table (findings, then mitigations; each sorted by id). */
export function stateLine(subject, state) {
  if (typeof subject !== "string" || subject.length === 0 || /\s/.test(subject)) throw new TypeError(`stateLine: subject must be a non-empty id without whitespace, got ${String(subject)}`);
  if (!STATE_LIST.includes(state)) throw new TypeError(`stateLine: state ${String(state)} is outside the closed vocabulary`);
  return `STATE ${subject} ${state}`;
}
/** `not-applied: <n>` — after the table (plan §4.1). */
export const notAppliedLine = (n) => `not-applied: ${requireCount("notAppliedLine", "n", n)}`;
/** `conflicts: <n>` — the last line of `receipt apply`. */
export const conflictsLine = (n) => `conflicts: ${requireCount("conflictsLine", "n", n)}`;

// --- build-report (TASK-023; plan §4.1 row `build-report`, spec §6.3) ------
/** The four report templates (run-manifest.schema.json `template` enum), in spec §6.3 order. */
export const REPORT_TEMPLATES = Object.freeze(["review", "assessment", "verify", "threat-model"]);
/** `REPORT <repo-relative path>` — the first line of `build-report`. */
export function reportLine(relPath) {
  requireRepoRelative("reportLine", relPath);
  return `REPORT ${relPath}`;
}
/** `MANIFEST sha256=<self_sha256>` — the manifest's identity, also the content of the COMMITTED marker. */
export function manifestLine(sha256) {
  if (!SHA256.test(sha256)) throw new TypeError(`manifestLine: sha256 must be 64 lowercase hex chars, got ${String(sha256)}`);
  return `MANIFEST sha256=${sha256}`;
}
/** Report cell for a field the inputs do not carry (spec §11: `unknown / not assessed` allowed, blank forbidden). */
export const NOT_ASSESSED = "unknown / not assessed";
/** Report wording for an accepted finding with no applied vulnerability-review receipt (spec §6.3 derivation table). */
export const NOT_INDEPENDENTLY_REVIEWED = "not independently reviewed";
/** `ORIGIN: unauthenticated` — the report's chain-of-custody line and `check`'s default origin (spec §2, §6.3). */
export const ORIGIN_UNAUTHENTICATED = "ORIGIN: unauthenticated";
