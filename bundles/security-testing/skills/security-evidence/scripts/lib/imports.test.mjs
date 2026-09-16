// TASK-015 — lib/imports.mjs: the one persistence path for every ingest
// adapter (spec §6.6; plan §3.3 row `lib/imports.mjs`, G-2, G-3, TL-14).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, hmacHex, parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { DEFAULT_RULES, redactDeep, redactString } from "../redact.mjs";
import { cleanupAll } from "../fixtures/cli/harness.mjs";
import { ST, ctxFor, initRun, readyRepo, runDir } from "../fixtures/ingest/setup.mjs";
import { CliError } from "./exit.mjs";
import { walk } from "./fsx.mjs";
import { IMPORT_KINDS, JSON_KINDS, TEXT_KINDS, importsDir, prepareImport, snapshotImport } from "./imports.mjs";
import { loadSchema } from "./schema.mjs";
import { importExists, importLine } from "./tokens.mjs";

after(cleanupAll);

const SECRET = "password=1234";
const AUDIT_V1 = `# Audit report\n\nfinding: open redirect on /login\n\nevidence: ${SECRET}\n`;
const AUDIT_V2 = `# Audit report\n\nfinding: open redirect on /logout\n\nevidence: ${SECRET}\n`; // non-redacted content changed
const AUDIT_V3 = `# Audit report\n\nfinding: open redirect on /login\n\nevidence: password=9999\n`; // only redacted-away content changed

const keyOf = (ctx, run_id) => ctx.keyById(readArtifact(join(runDir(ctx.root, run_id), "run.json"), { kind: "run" }).envelope.key_id).bytes;

test("kind vocabulary: IMPORT_KINDS = import.schema.json's enum = TEXT_KINDS ∪ JSON_KINDS, disjoint", () => {
  const schemaKinds = loadSchema("import").$defs.Import.properties.kind.enum;
  assert.deepEqual([...IMPORT_KINDS], schemaKinds);
  assert.deepEqual([...TEXT_KINDS, ...JSON_KINDS].sort(), [...IMPORT_KINDS].sort());
  assert.ok(TEXT_KINDS.every((k) => !JSON_KINDS.includes(k)));
  assert.deepEqual([...TEXT_KINDS], ["doc", "case", "audit", "qa-run"]);
  assert.deepEqual([...JSON_KINDS], ["sarif", "ticket", "pr", "ta-report", "tracker-readback"]);
  // tokens.mjs is a leaf with its own copy of the list: every kind here must format, and a stray one must not
  for (const kind of IMPORT_KINDS) assert.equal(importLine({ kind, import_sha256: "a".repeat(64), records: 1, unlocated: 0, rejected: 0 }), `IMPORT ${kind} import_sha256=${"a".repeat(64)} records=1 unlocated=0 rejected=0`);
  assert.throws(() => importLine({ kind: "scan", import_sha256: "a".repeat(64), records: 0, unlocated: 0, rejected: 0 }), /closed vocabulary/);
  assert.throws(() => importLine({ kind: "doc", import_sha256: "a".repeat(64), records: -1, unlocated: 0, rejected: 0 }), /records/);
  assert.equal(importExists("b".repeat(64)), `IMPORT-EXISTS(${"b".repeat(64)})`);
  assert.throws(() => importExists("nope"), /import_sha256/);
});

test("prepareImport: HMAC over the original bytes, sha256 over the redacted bytes; text kinds redactString, JSON kinds redactDeep + canonical", () => {
  const key = Buffer.alloc(32, 7);
  const text = prepareImport(key, Buffer.from(AUDIT_V1), { kind: "audit" });
  assert.equal(text.original_hmac, hmacHex(key, Buffer.from(AUDIT_V1)));
  const redactedText = redactString(AUDIT_V1).text;
  assert.equal(text.redacted, redactedText);
  assert.ok(!redactedText.includes(SECRET) && redactedText.includes("<REDACTED:"));
  assert.equal(text.redactedBytes.toString("utf8"), redactedText);
  assert.equal(text.import_sha256, sha256Hex(text.redactedBytes));
  assert.equal(text.redaction_version, DEFAULT_RULES.redaction_version);

  const json = `{"z": 1, "a": {"note": "${SECRET}"}, "list": [1, "two"]}\n`;
  const j = prepareImport(key, Buffer.from(json), { kind: "ticket" });
  assert.equal(j.original_hmac, hmacHex(key, Buffer.from(json)));
  const expected = redactDeep(parseStrict(json));
  assert.deepEqual(j.redacted, expected);
  assert.equal(j.redactedBytes.toString("utf8"), `${canonical(expected).toString("utf8")}\n`);
  assert.equal(j.import_sha256, sha256Hex(j.redactedBytes));
  assert.ok(!j.redactedBytes.includes(SECRET));

  // same redacted form ⇒ same identity, whatever the whitespace / key order of the JSON source
  const j2 = prepareImport(key, Buffer.from(`{"list":[1,"two"],"a":{"note":"${SECRET}"},"z":1}`), { kind: "ticket" });
  assert.equal(j2.import_sha256, j.import_sha256);
  assert.notEqual(j2.original_hmac, j.original_hmac);

  assert.throws(() => prepareImport(key, Buffer.from("x"), { kind: "nope" }), /kind/);
  assert.throws(() => prepareImport(key, "not bytes", { kind: "doc" }), TypeError);
  assert.throws(() => prepareImport(Buffer.alloc(0), Buffer.from("x"), { kind: "doc" }), /key/);
});

test("prepareImport: a malformed JSON-kind input is the command's own exit 2 (SCHEMA-INVALID(<kind>: …)), never a CanonError for the dispatcher", () => {
  const key = Buffer.alloc(32, 7);
  for (const [kind, bytes] of [
    ["sarif", "{not json"],
    ["ticket", '{"a": 1, "a": 2}'], // duplicate key
    ["pr", '{"n": 1.5}'], // float
    ["ta-report", ""],
  ]) {
    assert.throws(
      () => prepareImport(key, Buffer.from(bytes), { kind }),
      (e) => e instanceof CliError && e.code === 2 && e.token.startsWith(`SCHEMA-INVALID(${kind}: `),
      `${kind}: ${JSON.stringify(bytes)}`,
    );
  }
  // a text kind never parses: the same bytes are just text
  assert.equal(prepareImport(key, Buffer.from("{not json"), { kind: "doc" }).redacted, "{not json");
});

test("same-path audit report replacement ⇒ different import_sha256 when non-redacted content changed, different original_hmac only when redacted-away content changed (US-012 AC-5)", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "review");
  const ctx = ctxFor(repo);
  const source_path = "reports/audit.md";

  const v1 = await snapshotImport(ctx, run_id, Buffer.from(AUDIT_V1), { kind: "audit", source_path });
  const v2 = await snapshotImport(ctx, run_id, Buffer.from(AUDIT_V2), { kind: "audit", source_path });
  const v3 = await snapshotImport(ctx, run_id, Buffer.from(AUDIT_V3), { kind: "audit", source_path });

  // v2: the finding text changed ⇒ both identities move
  assert.notEqual(v2.import_sha256, v1.import_sha256);
  assert.notEqual(v2.original_hmac, v1.original_hmac);
  // v3: only the secret changed ⇒ the redacted identity is the same file, the keyed original differs
  assert.equal(v3.import_sha256, v1.import_sha256);
  assert.notEqual(v3.original_hmac, v1.original_hmac);
  assert.equal(v3.path, v1.path);

  const key = keyOf(ctx, run_id);
  assert.equal(v1.original_hmac, hmacHex(key, Buffer.from(AUDIT_V1)));
  assert.equal(v1.redaction_version, DEFAULT_RULES.redaction_version);

  // the blob is named by the sha256 of its own bytes, under ledger/<run>/imports/
  assert.equal(v1.path, join(importsDir(ctx, run_id), v1.import_sha256));
  assert.equal(importsDir(ctx, run_id), join(repo, ST, "ledger", run_id, "imports"));
  const bytes = readFileSync(v1.path);
  assert.equal(sha256Hex(bytes), v1.import_sha256);
  assert.equal(bytes.toString("utf8"), redactString(AUDIT_V1).text);
  assert.ok(existsSync(join(importsDir(ctx, run_id), v2.import_sha256)));
});

test("original bytes never persisted: nothing under <st> (private/ and ledger/ included) contains password=1234", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const ctx = ctxFor(repo);
  await snapshotImport(ctx, run_id, Buffer.from(AUDIT_V1), { kind: "audit", source_path: "reports/audit.md" });
  await snapshotImport(ctx, run_id, Buffer.from(`{"title": "t", "body": "${SECRET} in the body"}`), { kind: "ticket", source_path: "ticket.json" });
  const st = join(repo, ST);
  const files = walk(st);
  assert.ok(files.some((f) => f.startsWith(`ledger/${run_id}/imports/`)), "the blobs exist");
  for (const rel of files) {
    const p = join(st, rel);
    if (!statSync(p).isFile()) continue;
    assert.ok(!readFileSync(p).includes(SECRET), `${rel} carries the original bytes`);
  }
});

test("assessment run: imports.json gains one entry per snapshot, {kind, import_sha256, original_hmac}; review run: no imports.json", async () => {
  const repo = readyRepo();
  const assessment = await initRun(repo, "assessment");
  const ctx = ctxFor(repo);
  const a = await snapshotImport(ctx, assessment, Buffer.from(AUDIT_V1), { kind: "audit", source_path: "reports/audit.md" });
  const b = await snapshotImport(ctx, assessment, Buffer.from("plain doc\n"), { kind: "doc", source_path: "docs/x.md" });
  const index = readArtifact(join(runDir(repo, assessment), "imports.json"), { kind: "imports-index" });
  assert.deepEqual(index.payload, {
    imports: [
      { kind: "audit", import_sha256: a.import_sha256, original_hmac: a.original_hmac },
      { kind: "doc", import_sha256: b.import_sha256, original_hmac: b.original_hmac },
    ],
  });
  assert.equal(index.envelope.run_id, assessment);

  // index: false leaves the blob written and the index untouched (the dispatcher indexes after the record exists)
  const c = await snapshotImport(ctx, assessment, Buffer.from("another doc\n"), { kind: "doc", source_path: "docs/y.md", index: false });
  assert.ok(existsSync(c.path));
  assert.equal(readArtifact(join(runDir(repo, assessment), "imports.json")).payload.imports.length, 2);

  const review = await initRun(repo, "review");
  const r = await snapshotImport(ctx, review, Buffer.from(AUDIT_V1), { kind: "audit", source_path: "reports/audit.md" });
  assert.ok(existsSync(r.path));
  assert.ok(!existsSync(join(runDir(repo, review), "imports.json")), "review runs carry no index (build-report lists ingest/ directly)");
});

test("a COMMITTED run accepts no import (G-10): exit 2 RUN-COMMITTED, nothing written under ledger/<run>/imports/", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "review");
  const ctx = ctxFor(repo);
  writeFileSync(join(runDir(repo, run_id), "COMMITTED"), "x\n");
  await assert.rejects(
    snapshotImport(ctx, run_id, Buffer.from(AUDIT_V1), { kind: "audit", source_path: "reports/audit.md" }),
    (e) => e instanceof CliError && e.code === 2 && e.token === "RUN-COMMITTED",
  );
  assert.deepEqual(walk(importsDir(ctx, run_id)), []);
});

test("an unknown run or a missing key is refused before any write", async () => {
  const repo = readyRepo();
  const ctx = ctxFor(repo);
  await assert.rejects(
    snapshotImport(ctx, "0123456789ab-0001", Buffer.from("x"), { kind: "doc", source_path: "x.md" }),
    (e) => e instanceof CliError && e.code === 2 && /USAGE\(ingest: unknown run 0123456789ab-0001\)/.test(e.token),
  );
  await assert.rejects(snapshotImport(ctx, "not-a-run", Buffer.from("x"), { kind: "doc", source_path: "x.md" }), (e) => e instanceof CliError && e.code === 2);
  const run_id = await initRun(repo, "review");
  const keys = join(repo, ST, "private", "keys");
  const run = readArtifact(join(runDir(repo, run_id), "run.json"));
  const { renameSync } = await import("node:fs");
  renameSync(join(keys, run.envelope.key_id), join(keys, "gone"));
  await assert.rejects(
    snapshotImport(ctx, run_id, Buffer.from("x"), { kind: "doc", source_path: "x.md" }),
    (e) => e instanceof CliError && e.code === 2 && e.token === "KEY: unavailable",
  );
  assert.deepEqual(walk(importsDir(ctx, run_id)), []);
});
