// TASK-026 — the enveloped verify.json fixtures and their packet/receipt
// pools (consumed by TASK-030 consume-verdict, TASK-058 run snapshot verify,
// TASK-025 check). Every committed file must equal a fresh build, validate
// against its schema, read back through canon.readArtifact, and be
// hash-consistent with what the verify payload references.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { build, generatedFiles, RULES, RUN_ID_PREFIX, CREATED_AT, ENGAGEMENT_ID, KEY_ID } from "./build.mjs";
import { readArtifact, artifactId } from "../../canon.mjs";
import { validate } from "../../lib/schema.mjs";
import { evaluate } from "../../lib/evaluate.mjs";
import { matches } from "../../redact.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..");
const VERIFY = HERE;
const EVALUATE = join(FIXTURES, "evaluate");

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const HEX64 = /^[0-9a-f]{64}$/;
const verifyFiles = () => readdirSync(VERIFY).filter((f) => f.endsWith(".json")).sort();
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("one enveloped verify.json and one raw fixture per rule", () => {
  assert.ok(RULES.length >= 14, `rules: ${RULES.length}`);
  assert.deepEqual(new Set(RULES).size, RULES.length, "rule names unique");
  assert.deepEqual(verifyFiles(), [...RULES].sort().map((r) => `${r}.json`));
  assert.deepEqual(
    readdirSync(EVALUATE).filter((f) => f.endsWith(".raw.json")).sort(),
    [...RULES].sort().map((r) => `${r}.raw.json`),
  );
});

test("every built verify.json validates against the verify schema and readArtifact accepts it", () => {
  for (const f of verifyFiles()) {
    const path = join(VERIFY, f);
    const { envelope, payload } = readArtifact(path, { kind: "verify" });
    assert.deepEqual(validate("envelope", envelope), [], `${f}: envelope`);
    assert.deepEqual(validate("verify", payload), [], `${f}: payload`);
    assert.equal(envelope.self_sha256, artifactId(payload));
    assert.equal(envelope.schema_version, 1);
    assert.equal(envelope.created_at, CREATED_AT);
    assert.equal(envelope.engagement_id, ENGAGEMENT_ID);
    assert.equal(envelope.key_id, KEY_ID);
    assert.match(envelope.run_id, new RegExp(`^${RUN_ID_PREFIX}-[0-9]{4}$`));
    assert.ok(readFileSync(path, "utf8").endsWith("\n"), `${f}: trailing LF (writeArtifact bytes)`);
  }
});

test("run ids are unique and sequential in rule order", () => {
  const ids = RULES.map((r) => readArtifact(join(VERIFY, `${r}.json`)).envelope.run_id);
  assert.deepEqual(ids, RULES.map((_, i) => `${RUN_ID_PREFIX}-${String(i + 1).padStart(4, "0")}`));
});

test("evaluation is exactly evaluate() of the rest, and the raw fixture is the rest", () => {
  for (const rule of RULES) {
    const { payload } = readArtifact(join(VERIFY, `${rule}.json`));
    const { evaluation, ...raw } = payload;
    assert.deepEqual(evaluation, evaluate(raw), `${rule}: evaluation`);
    assert.deepEqual(readJson(join(EVALUATE, `${rule}.raw.json`)), raw, `${rule}: raw fixture`);
    assert.ok(!("evaluation" in readJson(join(EVALUATE, `${rule}.raw.json`))), `${rule}: raw has no evaluation`);
  }
});

test("packet_sha256 names a packet artifact in packets/ whose self_sha256 equals it", () => {
  for (const rule of RULES) {
    const { envelope, payload } = readArtifact(join(VERIFY, `${rule}.json`));
    const path = join(VERIFY, "packets", `${payload.packet_sha256}.json`);
    assert.ok(existsSync(path), `${rule}: ${relative(VERIFY, path)}`);
    const packet = readArtifact(path, { kind: "packet" });
    assert.equal(packet.envelope.self_sha256, payload.packet_sha256);
    assert.deepEqual(validate("packet", packet.payload), [], `${rule}: packet schema`);
    assert.equal(packet.payload.kind, "subject");
    assert.ok(packet.payload.subject_ids.includes(payload.finding_id), `${rule}: packet subject is the finding`);
    assert.equal(packet.envelope.run_id, envelope.run_id);
    assert.equal(packet.envelope.created_at, CREATED_AT);
    for (const file of packet.payload.files) assert.equal(file.side, "head", `${rule}: fix-review packet is built from the head worktree`);
  }
});

test("every receipts[].sha256 names a receipt artifact in receipts/ consistent with the verify row", () => {
  let seen = 0;
  for (const rule of RULES) {
    const { envelope, payload } = readArtifact(join(VERIFY, `${rule}.json`));
    for (const row of payload.receipts) {
      seen++;
      const path = join(VERIFY, "receipts", `${row.sha256}.json`);
      assert.ok(existsSync(path), `${rule}: ${relative(VERIFY, path)}`);
      const receipt = readArtifact(path, { kind: "receipt" });
      assert.equal(receipt.envelope.self_sha256, row.sha256);
      assert.equal(receipt.envelope.run_id, envelope.run_id);
      assert.deepEqual(validate("receipt", receipt.payload), [], `${rule}: receipt schema`);
      const p = receipt.payload;
      assert.equal(p.type, row.type);
      assert.equal(p.subject_id, payload.finding_id);
      assert.equal(p.reviewer_run_id, envelope.run_id, `${rule}: reviewer_run_id is the verify run`);
      if (row.type === "ack") {
        assert.equal(p.assertion.indicator_id, row.indicator_id);
        assert.ok(!("assertion" in row), `${rule}: ack rows carry indicator_id, not assertion`);
      } else {
        assert.equal(p.assertion, row.assertion);
        assert.ok(!("indicator_id" in row));
      }
      if (row.applied) {
        assert.equal(p.packet_sha256, payload.packet_sha256, `${rule}: an applied receipt names the fix-review packet`);
        assert.ok(!("not_applied_reason" in row));
      } else {
        assert.equal(typeof row.not_applied_reason, "string", `${rule}: not-applied rows say why`);
      }
      if (row.not_applied_reason === "packet-mismatch") {
        assert.notEqual(p.packet_sha256, payload.packet_sha256);
        assert.ok(existsSync(join(VERIFY, "packets", `${p.packet_sha256}.json`)), `${rule}: the other packet is in the pool too`);
      }
    }
  }
  assert.ok(seen > 0);
});

test("pools contain no orphans and nothing that trips a redaction rule", () => {
  const referencedPackets = new Set();
  const referencedReceipts = new Set();
  for (const rule of RULES) {
    const { payload } = readArtifact(join(VERIFY, `${rule}.json`));
    referencedPackets.add(payload.packet_sha256);
    for (const r of payload.receipts) {
      referencedReceipts.add(r.sha256);
      const p = readArtifact(join(VERIFY, "receipts", `${r.sha256}.json`)).payload;
      referencedPackets.add(p.packet_sha256);
    }
  }
  const pool = (dir) => readdirSync(join(VERIFY, dir)).map((f) => f.replace(/\.json$/, "")).sort();
  assert.deepEqual(pool("packets"), [...referencedPackets].sort());
  assert.deepEqual(pool("receipts"), [...referencedReceipts].sort());
  for (const f of generatedFiles(FIXTURES)) {
    assert.equal(matches(readFileSync(join(FIXTURES, f))), false, `${f}: fixture bytes match a redaction rule`);
  }
});

test("committed fixtures equal a fresh build (run `node scripts/fixtures/verify/build.mjs` after editing cases.mjs)", () => {
  const root = mkdtempSync(join(tmpdir(), "verify-fixtures-"));
  tmpDirs.push(root);
  const written = build(root);
  assert.deepEqual(written, generatedFiles(root));
  assert.deepEqual(generatedFiles(FIXTURES), written, "file set");
  for (const f of written) {
    assert.deepEqual(readFileSync(join(root, f)), readFileSync(join(FIXTURES, f)), `${f}: bytes`);
  }
  for (const f of written) assert.match(f, /^(evaluate\/[a-z0-9-]+\.raw\.json|verify\/([a-z0-9-]+|packets\/[0-9a-f]{64}|receipts\/[0-9a-f]{64})\.json)$/);
});

test("ids are hex and finding_id/indicator ids are 64-hex; every raw is a plain object with no evaluation", () => {
  for (const rule of RULES) {
    const raw = readJson(join(EVALUATE, `${rule}.raw.json`));
    assert.match(raw.finding_id, HEX64);
    for (const ind of raw.suppression.indicators) assert.match(ind.id, HEX64);
  }
});
