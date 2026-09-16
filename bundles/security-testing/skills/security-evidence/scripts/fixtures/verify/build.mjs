// TASK-026 — fixture builder: cases.mjs → enveloped verify.json artifacts plus
// hash-consistent packet and receipt pools (PM log, before G6), and the raw
// evaluate() inputs. See README.md for the layout.
//
//   node scripts/fixtures/verify/build.mjs           rebuild in place
//   node scripts/fixtures/verify/build.mjs --check   exit 1 if committed files are stale
//
// Every artifact goes through canon.writeArtifact (redact → self_sha256 →
// tmp+rename), so the fixtures are byte-for-byte what the real writers
// produce; the builder asserts that redaction changed nothing (a fixture
// that trips a rule would get an identity different from the one the verify
// payload names). Deterministic: fixed created_at, no clock, no randomness.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { artifactId, makeEnvelope, sha256Hex, writeArtifact } from "../../canon.mjs";
import { validate } from "../../lib/schema.mjs";
import { evaluate } from "../../lib/evaluate.mjs";
import { CASES, CREATED_AT, ENGAGEMENT_ID, KEY_ID, RULES, RUN_ID_PREFIX, SCHEMA_VERSION } from "./cases.mjs";

export { CASES, CREATED_AT, ENGAGEMENT_ID, KEY_ID, RULES, RUN_ID_PREFIX, SCHEMA_VERSION };

const HERE = dirname(fileURLToPath(import.meta.url));
/** scripts/fixtures — the root `build(root)` writes `evaluate/` and `verify/` under. */
export const FIXTURES_ROOT = join(HERE, "..");

const BASE_OID = "a0".repeat(20);
const HEAD_OID = "b1".repeat(20);
const BLOB_OID = "c2".repeat(20);
const POLICY_SHA256 = "9".repeat(64);
const RANGE_HMAC = "8".repeat(64);
const OTHER_RANGE_HMAC = "7".repeat(64);
const DEFAULT_INSTALL = { ran: false, allow_tracked_changes: false, tracked_changes: [], untracked_count: 0, untracked_bytes: 0 };

const hex = (label) => sha256Hex(Buffer.from(label, "utf8"));
const now = () => CREATED_AT;
const runId = (i) => `${RUN_ID_PREFIX}-${String(i + 1).padStart(4, "0")}`;
/** Indicator identity per plan §4.2: sha256(kind \0 path \0 line content). */
const indicatorId = (ind) => sha256Hex(Buffer.from(`${ind.kind}\0${ind.path}\0${ind.content}`, "utf8"));

function fail(rule, message) {
  throw new Error(`fixtures/verify build: ${rule}: ${message}`);
}

function assertValid(rule, schema, value) {
  const errors = validate(schema, value);
  if (errors.length > 0) fail(rule, `${schema} schema: ${errors.join("; ")}`);
}

/**
 * Write one enveloped artifact into a content-addressed pool and return its
 * identity. Refuses to overwrite a pool entry with different bytes (two cases
 * producing the same payload under different envelopes would otherwise race).
 */
function writePooled(pool, head, payload, rule, schema) {
  assertValid(rule, schema, payload);
  const id = artifactId(payload);
  const path = join(pool, `${id}.json`);
  const written = writeArtifact(`${path}.new`, makeEnvelope(head, payload));
  if (written.envelope.self_sha256 !== id) fail(rule, `${schema} payload changed under redaction`);
  const bytes = readFileSync(`${path}.new`);
  rmSync(`${path}.new`);
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) fail(rule, `${schema} ${id} already in the pool with different bytes`);
  } else {
    writeFileSync(path, bytes);
  }
  return id;
}

function packetPayload(findingId, ranges, rangeHmac) {
  return {
    kind: "subject",
    subject_ids: [findingId],
    files: [{ path: "src/db.js", side: "head", oid: BLOB_OID, ranges, range_hmac: rangeHmac }],
    policy_sha256: POLICY_SHA256,
  };
}

function buildCase(c, i, dirs) {
  const rule = c.rule;
  const run_id = runId(i);
  const finding_id = hex(`fixture:finding:${rule}`);
  const head = (kind) => ({ schema_version: SCHEMA_VERSION, kind, run_id, engagement_id: ENGAGEMENT_ID, key_id: KEY_ID, now });

  const packet_sha256 = writePooled(dirs.packets, head("packet"), packetPayload(finding_id, [[10, 14]], RANGE_HMAC), rule, "packet");
  let otherPacket = null;
  const otherPacketId = () => {
    if (otherPacket === null) otherPacket = writePooled(dirs.packets, head("packet"), packetPayload(finding_id, [[1, 5]], OTHER_RANGE_HMAC), rule, "packet");
    return otherPacket;
  };

  const indicators = c.indicators.map((ind) => {
    const row = { id: indicatorId(ind), kind: ind.kind, path: ind.path, line: ind.line };
    if (ind.sensitive === true) row.sensitive = true;
    return row;
  });

  const receipts = c.receipts.map((spec) => {
    const onOther = spec.other_packet === true;
    const target = onOther ? otherPacketId() : packet_sha256;
    const applied = spec.applied === undefined ? !onOther : spec.applied;
    if (onOther && applied) fail(rule, "a receipt on another packet cannot be applied");
    let payload;
    let row;
    if (spec.fix !== undefined) {
      payload = { type: "fix-review", subject_id: finding_id, packet_sha256: target, assertion: spec.fix, reviewer_run_id: run_id };
      row = { type: "fix-review", assertion: spec.fix, applied };
    } else if (spec.ack !== undefined) {
      const ind = typeof spec.ack === "number" ? c.indicators[spec.ack] : spec.ack;
      if (ind === undefined) fail(rule, `ack index ${spec.ack} out of range`);
      const indicator_id = indicatorId(ind);
      payload = { type: "ack", subject_id: finding_id, packet_sha256: target, assertion: { indicator_id }, reviewer_run_id: run_id };
      row = { type: "ack", indicator_id, applied };
    } else {
      fail(rule, "receipt spec needs fix or ack");
    }
    const sha256 = writePooled(dirs.receipts, head("receipt"), payload, rule, "receipt");
    const out = { sha256, ...row };
    if (!applied) out.not_applied_reason = onOther ? "packet-mismatch" : spec.not_applied_reason ?? fail(rule, "applied:false needs not_applied_reason");
    return out;
  });

  const raw = {
    finding_id,
    base_oid: BASE_OID,
    head_oid: HEAD_OID,
    branch: c.branch,
    tree_before: HEAD_OID,
    install: c.install ?? DEFAULT_INSTALL,
    tested_tree: c.tested_tree ?? "same-as-head",
    suppression: { indicators, deletion_only: c.deletion_only },
    tests: c.tests,
    packet_sha256,
    receipts,
    row_status_at_start: c.row_status_at_start,
  };
  const evaluation = evaluate(raw);
  if (evaluation.verdict !== c.verdict) fail(rule, `case documents ${c.verdict} but evaluate() says ${evaluation.verdict}`);
  const payload = { ...raw, evaluation };
  assertValid(rule, "verify", payload);

  writeFileSync(join(dirs.evaluate, `${rule}.raw.json`), `${JSON.stringify(raw, null, 2)}\n`);
  const written = writeArtifact(join(dirs.verify, `${rule}.json`), makeEnvelope(head("verify"), payload));
  if (written.envelope.self_sha256 !== artifactId(payload)) fail(rule, "verify payload changed under redaction");
}

/**
 * Build every fixture under `root` (`<root>/evaluate/*.raw.json`,
 * `<root>/verify/*.json`, `<root>/verify/{packets,receipts}/*.json`).
 * @param {string} root
 * @returns {string[]} the generated files, root-relative, sorted
 */
export function build(root) {
  const dirs = {
    evaluate: join(root, "evaluate"),
    verify: join(root, "verify"),
    packets: join(root, "verify", "packets"),
    receipts: join(root, "verify", "receipts"),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const seen = new Set();
  CASES.forEach((c, i) => {
    if (!/^[a-z0-9-]+$/.test(c.rule)) fail(c.rule, "rule names are [a-z0-9-]");
    if (seen.has(c.rule)) fail(c.rule, "duplicate rule");
    seen.add(c.rule);
    buildCase(c, i, dirs);
  });
  return generatedFiles(root);
}

/**
 * The generated files present under `root`, root-relative with `/`
 * separators, sorted. Only the four generated patterns — never README.md,
 * cases.mjs, build.mjs or tests.
 * @param {string} root
 * @returns {string[]}
 */
export function generatedFiles(root) {
  const list = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f)) : []);
  const files = [
    ...list(join(root, "evaluate"), /^[a-z0-9-]+\.raw\.json$/),
    ...list(join(root, "verify"), /^[a-z0-9-]+\.json$/),
    ...list(join(root, "verify", "packets"), /^[0-9a-f]{64}\.json$/),
    ...list(join(root, "verify", "receipts"), /^[0-9a-f]{64}\.json$/),
  ];
  return files.map((f) => relative(root, f).split("\\").join("/")).sort();
}

/**
 * Compare the committed fixtures with a fresh build.
 * @param {string} root
 * @returns {{stale: string[], missing: string[], extra: string[]}}
 */
export function check(root) {
  const tmp = mkdtempSync(join(tmpdir(), "verify-fixtures-check-"));
  try {
    const fresh = build(tmp);
    const committed = generatedFiles(root);
    const missing = fresh.filter((f) => !committed.includes(f));
    const extra = committed.filter((f) => !fresh.includes(f));
    const stale = fresh.filter((f) => committed.includes(f) && !readFileSync(join(tmp, f)).equals(readFileSync(join(root, f))));
    return { stale, missing, extra };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Rebuild in place: write the fresh set and delete generated files that are
 * no longer produced (a renamed rule leaves no stale twin behind).
 * @param {string} root
 * @returns {{written: string[], removed: string[]}}
 */
export function sync(root) {
  const tmp = mkdtempSync(join(tmpdir(), "verify-fixtures-build-"));
  try {
    const fresh = build(tmp);
    const removed = generatedFiles(root).filter((f) => !fresh.includes(f));
    for (const f of removed) rmSync(join(root, f));
    for (const f of fresh) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      writeFileSync(join(root, f), readFileSync(join(tmp, f)));
    }
    return { written: fresh, removed };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const { stale, missing, extra } = check(FIXTURES_ROOT);
    const problems = [...stale.map((f) => `stale ${f}`), ...missing.map((f) => `missing ${f}`), ...extra.map((f) => `extra ${f}`)];
    if (problems.length > 0) {
      process.stderr.write(`${problems.join("\n")}\nrun: node scripts/fixtures/verify/build.mjs\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("verify fixtures up to date\n");
    }
  } else if (args.length === 0) {
    const { written, removed } = sync(FIXTURES_ROOT);
    process.stdout.write(`wrote ${written.length} fixture files${removed.length ? `, removed ${removed.length}` : ""}\n`);
  } else {
    process.stderr.write("usage: node build.mjs [--check]\n");
    process.exitCode = 2;
  }
}
