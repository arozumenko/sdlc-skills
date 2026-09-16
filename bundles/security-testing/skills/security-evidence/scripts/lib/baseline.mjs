// lib/baseline.mjs — the working-tree baseline (TASK-010; spec §6.9 step 4,
// §2 last row, D4; plan §3.3 row `lib/baseline.mjs`, §4.1 `engagement
// baseline`). `engagement init` step 4 (TASK-008) calls stepBaseline;
// `engagement baseline` (cmd-engagement-baseline.mjs) rewrites the file;
// `sign-off` (TASK-033) reads it back and lists diffBaseline's result as
// CHANGES-SINCE-BASELINE / EXCLUDED-COVERAGE.
//
// What is observed (§2, last row — the promise, exactly): for every path in
// `scope_paths ∪ product_paths` of engagement.md, every tracked file
// (`git ls-files -- <p>`) and every non-ignored untracked file (`git ls-files
// --others --exclude-standard -- <p>`), keyed by repo-relative path to the
// HMAC of its working-tree content under the engagement key. Git-ignored
// files are outside the observation; their number per configured path is
// recorded as `ignored_count[p]` (`git ls-files --others --ignored
// --exclude-standard -- <p>`) so the excluded coverage is visible. HEAD and
// index state ride along: `head_oid` and `index_sha256` — a plain sha256
// over the `git ls-files --stage` listing, which is git metadata (modes,
// blob oids, paths), never content (G-2). Nothing here excludes the bundle's
// own managed paths: P6 narrows the *cleanliness* check of `run init`, not
// the observation, so an engagement.md edit or a `register render` after
// init shows up at sign-off as the change it is (plan §8, risk 5).
//
// The file is `<st>/private/baseline.<engagement_id>.json`, an enveloped
// `baseline` artifact (kind list in envelope.schema.json; payload shape in
// baseline.schema.json) with `run_id: ""` — it belongs to the engagement, not
// to a run. It is the one artifact under `private/` that is rewritten:
// canon.writeArtifact is tmp+rename, so a re-run replaces it atomically
// (plan §4.1: "atomic overwrite"). `purge` deletes it with the engagement.
//
//   observedPaths(record)          → scope_paths ∪ product_paths, deduplicated, first-appearance order
//   baselinePath(ctx, eid)         → <st>/private/baseline.<eid>.json (eid NFC; refuses an id that cannot name a file)
//   computeBaseline(ctx)           → payload   — CliError 2 ENGAGEMENT-MISSING without engagement.md;
//                                                CliError 2 USAGE(baseline: …) without a key
//   writeBaseline(ctx, payload)    → artifact  — as written (post-redaction identity)
//   stepBaseline(ctx)              → {payload, artifact, path, files, ignored}   (init step 4)
//   readBaseline(ctx, eid)         → artifact | null (absent); integrity failures propagate (exit 5)
//   diffBaseline(ctx, baseline)    → {changed[], added[], removed[], ignored_counts{}}
//
// diffBaseline re-observes the tree with the *current* engagement's paths and
// compares HMACs: `changed` = same path, different HMAC; `added` = observed
// now, not in the baseline; `removed` = in the baseline, not observed now
// (deleted, or now ignored); `ignored_counts` = the current per-path counts.
// Every list is sorted and the baseline passed in is never mutated. The key:
// an artifact (`{envelope, payload}`, as readBaseline returns it) is compared
// under the key its envelope names, so a rotation after init does not turn
// every file into a change; a bare payload is compared under the current key.
// A key that is gone ⇒ CliError 4 `KEY: unavailable` — without it no HMAC
// can be recomputed, so no change can be observed.
//
// A tracked path that is not a regular file in the working tree is keyed the
// way git stores it: a symlink over its link target; a submodule (a
// directory) or a tracked file deleted from the working tree has no content
// here and gets no entry (its later reappearance is `added`).
//
// Imports: node:fs (reads only — every write is canon.writeArtifact),
// node:path, ../canon.mjs, ./git.mjs (the one place git runs, G-6),
// ./schema.mjs, ./exit.mjs, ./tokens.mjs. No child process of its own, no
// network (G-14), no clock (G-1: created_at is ctx.now() via makeEnvelope).

import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { hmacHex, makeEnvelope, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { lsFiles, revParse } from "./git.mjs";
import { validate } from "./schema.mjs";
import { KEY_UNAVAILABLE, engagementInvalid, inconsistent } from "./tokens.mjs";

/** envelope.kind of the baseline artifact. */
export const BASELINE_KIND = "baseline";

// Deliberate at this call site, never defaulted (canon.makeEnvelope refuses a
// missing value): envelope.schema.json pins `const: 1`.
const SCHEMA_VERSION = 1;
const COMMAND = "baseline";
const SCHEMA = "baseline";

/**
 * `scope_paths ∪ product_paths` of an engagement record, deduplicated by exact
 * spelling, in first-appearance order (the order `ignored_count` is keyed in
 * before canonicalisation sorts it).
 * @param {{scope_paths: string[], product_paths: string[]}} record
 * @returns {string[]}
 */
export function observedPaths(record) {
  if (!Array.isArray(record?.scope_paths) || !Array.isArray(record?.product_paths)) {
    throw new TypeError("observedPaths: record must carry scope_paths and product_paths arrays");
  }
  return [...new Set([...record.scope_paths, ...record.product_paths])];
}

/** The id as the file name and the payload carry it (NFC, like keys.mjs); refuses an id that cannot name one file. */
function requireFileNameId(engagement_id) {
  if (typeof engagement_id !== "string" || engagement_id === "") throw new CliError(EXIT.USAGE, engagementInvalid("$.engagement_id: must be a non-empty string"));
  const id = engagement_id.normalize("NFC");
  if (id === "." || id === ".." || /[\\/\0]/.test(id)) {
    throw new CliError(EXIT.USAGE, engagementInvalid("$.engagement_id: must name a file (no path separator, not . or ..)"));
  }
  return id;
}

/**
 * `<st>/private/baseline.<engagement_id>.json`.
 * @param {{st: string}} ctx
 * @param {string} engagement_id
 * @returns {string} absolute path
 * @throws {CliError} 2 ENGAGEMENT-INVALID($.engagement_id: …) when the id cannot name a file
 */
export function baselinePath(ctx, engagement_id) {
  return join(ctx.st, "private", `baseline.${requireFileNameId(engagement_id)}.json`);
}

/**
 * Working-tree bytes of `path` as git would store them, or null when there is
 * nothing to key (absent, or a directory such as a submodule).
 * @returns {Buffer | null}
 */
function workingBytes(root, path) {
  const abs = join(root, path);
  let st;
  try {
    st = lstatSync(abs);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  }
  if (st.isSymbolicLink()) return Buffer.from(readlinkSync(abs, { encoding: "buffer" }));
  if (st.isDirectory()) return null;
  return readFileSync(abs);
}

/**
 * The observation itself: HMAC per observed file and the ignored count per
 * configured path. Shared by computeBaseline and diffBaseline so the two can
 * never disagree about what "observed" means.
 * @returns {{entries: Record<string, string>, ignored_count: Record<string, number>}}
 */
function observe(ctx, keyBytes, paths) {
  const seen = new Set();
  const ignored_count = {};
  for (const p of paths) {
    for (const path of lsFiles(ctx.root, { paths: [p] })) seen.add(path);
    for (const path of lsFiles(ctx.root, { others: true, excludeStandard: true, paths: [p] })) seen.add(path);
    ignored_count[p] = lsFiles(ctx.root, { others: true, ignored: true, excludeStandard: true, paths: [p] }).length;
  }
  const entries = {};
  for (const path of [...seen].sort()) {
    const bytes = workingBytes(ctx.root, path);
    if (bytes !== null) entries[path] = hmacHex(keyBytes, bytes);
  }
  return { entries, ignored_count };
}

/** The current key or the exit-2 refusal: a baseline without a key has no identity to record. */
function requireCurrentKey(ctx) {
  const key = ctx.key();
  if (key === null) throw usageError(COMMAND, "no engagement key; run engagement init first");
  return key;
}

/**
 * The baseline payload of the working tree as it is now.
 * @param {object} ctx
 * @returns {{engagement_id: string, head_oid: string, index_sha256: string, entries: Record<string, string>, ignored_count: Record<string, number>}}
 * @throws {CliError} 2 ENGAGEMENT-MISSING (no engagement.md; from ctx.engagement()), 2 ENGAGEMENT-INVALID(…),
 *   2 USAGE(baseline: …) when no key exists
 */
export function computeBaseline(ctx) {
  const record = ctx.engagement();
  const key = requireCurrentKey(ctx);
  const engagement_id = requireFileNameId(record.engagement_id);
  const { entries, ignored_count } = observe(ctx, key.bytes, observedPaths(record));
  // Git metadata, not content: mode, blob oid, stage and path per index entry — the one plain sha256 here (G-2).
  const stage = lsFiles(ctx.root, { stage: true });
  const payload = {
    engagement_id,
    head_oid: revParse(ctx.root, "HEAD"),
    index_sha256: sha256Hex(Buffer.from(stage.map((entry) => `${entry}\0`).join(""), "utf8")),
    entries,
    ignored_count,
  };
  const errors = validate(SCHEMA, payload);
  if (errors.length > 0) throw new Error(`computeBaseline: payload failed the ${SCHEMA} schema: ${errors.join("; ")}`);
  return payload;
}

/**
 * Persist `payload` as `<st>/private/baseline.<eid>.json`, replacing any
 * previous file atomically (tmp+rename). The payload must have been computed
 * under the current key: the envelope records `ctx.key().key_id`.
 * @param {object} ctx
 * @param {object} payload from computeBaseline
 * @returns {{envelope: object, payload: object}} the artifact as written
 */
export function writeBaseline(ctx, payload) {
  const key = requireCurrentKey(ctx);
  const path = baselinePath(ctx, payload.engagement_id);
  const artifact = makeEnvelope(
    { schema_version: SCHEMA_VERSION, kind: BASELINE_KIND, run_id: "", engagement_id: payload.engagement_id, key_id: key.key_id, now: ctx.now },
    payload,
  );
  return writeArtifact(path, artifact);
}

/**
 * `engagement init` step 4 / the body of `engagement baseline`: compute and
 * write. The path is resolved before anything runs, so an id that cannot name
 * a file fails before git is consulted. Prints nothing — the caller owns
 * stdout (tokens.baselineLine and ctx.wrote).
 * @param {object} ctx
 * @returns {{payload: object, artifact: {envelope: object, payload: object}, path: string, files: number, ignored: number}}
 */
export function stepBaseline(ctx) {
  const record = ctx.engagement();
  const path = baselinePath(ctx, record.engagement_id);
  const payload = computeBaseline(ctx);
  const artifact = writeBaseline(ctx, payload);
  return {
    payload,
    artifact,
    path,
    files: Object.keys(artifact.payload.entries).length,
    ignored: Object.values(payload.ignored_count).reduce((sum, n) => sum + n, 0),
  };
}

/**
 * The stored baseline of `engagement_id`, verified by self_sha256 and kind, or
 * null when there is none. A file that is not the artifact it claims to be
 * throws canon's CanonError / IntegrityError (exit 5 by the check/exit-5 rule).
 * @param {object} ctx
 * @param {string} engagement_id
 * @returns {{envelope: object, payload: object} | null}
 */
export function readBaseline(ctx, engagement_id) {
  const path = baselinePath(ctx, engagement_id);
  try {
    return readArtifact(path, { kind: BASELINE_KIND });
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function isArtifact(value) {
  return value !== null && typeof value === "object" && Object.hasOwn(value, "envelope") && Object.hasOwn(value, "payload");
}

/**
 * Per-path working-tree changes since `baseline` (spec §2 last row; the
 * listing `sign-off` prints).
 * @param {object} ctx
 * @param {{envelope: object, payload: object} | object} baseline an artifact (readBaseline) or a bare payload (computeBaseline)
 * @returns {{changed: string[], added: string[], removed: string[], ignored_counts: Record<string, number>}}
 * @throws {CliError} 4 KEY: unavailable when the key the baseline was keyed under no longer loads;
 *   5 INCONSISTENT(baseline) when the payload is not a baseline; 2 ENGAGEMENT-MISSING
 */
export function diffBaseline(ctx, baseline) {
  const payload = isArtifact(baseline) ? baseline.payload : baseline;
  if (payload === null || typeof payload !== "object" || validate(SCHEMA, payload).length > 0) {
    throw integrityFailure(inconsistent(SCHEMA));
  }
  const key = isArtifact(baseline) ? ctx.keyById(baseline.envelope.key_id) : ctx.key();
  if (key === null) throw new CliError(EXIT.FAIL, KEY_UNAVAILABLE);
  const record = ctx.engagement();
  const current = observe(ctx, key.bytes, observedPaths(record));

  const changed = [];
  const added = [];
  const removed = [];
  for (const [path, hmac] of Object.entries(current.entries)) {
    if (!Object.hasOwn(payload.entries, path)) added.push(path);
    else if (payload.entries[path] !== hmac) changed.push(path);
  }
  for (const path of Object.keys(payload.entries)) {
    if (!Object.hasOwn(current.entries, path)) removed.push(path);
  }
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort(), ignored_counts: current.ignored_count };
}
