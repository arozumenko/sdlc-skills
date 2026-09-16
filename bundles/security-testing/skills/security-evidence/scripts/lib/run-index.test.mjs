// TASK-012 — lib/run-index.mjs: the TL-14 index files are the only files
// rewritten under a run, and only through appendIndex (G-10).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { cleanupAll, initRepo } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { CliError } from "./exit.mjs";
import { INDEXES, appendIndex, replaceIndex, writeEmptyIndexes } from "./run-index.mjs";

after(cleanupAll);

const RUN_ID = "0123456789ab-0001";
const KEY_ID = "kabcdef012345";
const NOW = "2026-09-16T10:00:00Z";
const ctxFor = (repo) => createContext({ root: repo }, { env: { SECURITY_EVIDENCE_NOW: NOW } });
const head = { schema_version: 1, run_id: RUN_ID, engagement_id: "eng-2026-001", key_id: KEY_ID, now: () => NOW };

test("INDEXES: the three TL-14 index files, their kinds and list keys", () => {
  assert.deepEqual(INDEXES, {
    imports: { file: "imports.json", kind: "imports-index", key: "imports" },
    observations: { file: "observations.json", kind: "observations-index", key: "observations" },
    proposals: { file: "proposals-index.json", kind: "proposals-index", key: "proposals" },
  });
});

test("writeEmptyIndexes writes the three empty artifacts write-once (P2); a second call is EEXIST", () => {
  const ctx = ctxFor(initRepo());
  const written = writeEmptyIndexes(ctx, head);
  assert.deepEqual(Object.keys(written), ["imports", "observations", "proposals"]);
  const dir = join(ctx.st, "runs", RUN_ID);
  assert.deepEqual(readArtifact(join(dir, "imports.json"), { kind: "imports-index" }).payload, { imports: [] });
  assert.deepEqual(readArtifact(join(dir, "observations.json"), { kind: "observations-index" }).payload, { observations: [] });
  assert.deepEqual(readArtifact(join(dir, "proposals-index.json"), { kind: "proposals-index" }).payload, { proposals: [] });
  assert.equal(written.imports.envelope.self_sha256, readArtifact(join(dir, "imports.json")).envelope.self_sha256);
  assert.throws(() => writeEmptyIndexes(ctx, head), (err) => err.code === "EEXIST");
});

test("appendIndex: reads, pushes, re-envelopes (created_at from ctx.now, identity from the new payload), rewrites atomically under the run lock", async () => {
  const ctx = ctxFor(initRepo());
  writeEmptyIndexes(ctx, head);
  const dir = join(ctx.st, "runs", RUN_ID);
  const before = readArtifact(join(dir, "imports.json"));

  const later = createContext({ root: ctx.root }, { env: { SECURITY_EVIDENCE_NOW: "2026-09-16T12:00:00Z" } });
  const entry = { kind: "sarif", import_sha256: "1".repeat(64), original_hmac: "2".repeat(64) };
  const written = await appendIndex(later, RUN_ID, "imports", entry);
  const after1 = readArtifact(join(dir, "imports.json"), { kind: "imports-index" });
  assert.deepEqual(after1.payload, { imports: [entry] });
  assert.equal(after1.envelope.self_sha256, written.envelope.self_sha256);
  assert.notEqual(after1.envelope.self_sha256, before.envelope.self_sha256);
  assert.equal(after1.envelope.created_at, "2026-09-16T12:00:00Z");
  assert.equal(after1.envelope.run_id, RUN_ID);
  assert.equal(after1.envelope.engagement_id, "eng-2026-001");
  assert.equal(after1.envelope.key_id, KEY_ID, "the run's key_id is carried, not re-read");

  const second = { kind: "ticket", import_sha256: "3".repeat(64), original_hmac: "4".repeat(64) };
  await appendIndex(later, RUN_ID, "imports", second);
  assert.deepEqual(readArtifact(join(dir, "imports.json")).payload.imports, [entry, second]);

  await appendIndex(later, RUN_ID, "observations", { observation_id: "O-001", sha256: "5".repeat(64) });
  await appendIndex(later, RUN_ID, "proposals", { id: "P-001", sha256: "6".repeat(64), path: ".agents/security-testing/proposals/P-001.proposal.md" });
  assert.deepEqual(readArtifact(join(dir, "observations.json")).payload, { observations: [{ observation_id: "O-001", sha256: "5".repeat(64) }] });
  assert.equal(readArtifact(join(dir, "proposals-index.json")).payload.proposals.length, 1);

  assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith(".")), [], "no tmp file, no lock inside the run");
  assert.ok(!existsSync(join(ctx.st, "ledger", `${RUN_ID}.lock`)), "run lock released");
});

test("appendIndex refuses an off-schema entry, an unknown index name, a bad run id, and leaves the file untouched", async () => {
  const ctx = ctxFor(initRepo());
  writeEmptyIndexes(ctx, head);
  const path = join(ctx.st, "runs", RUN_ID, "imports.json");
  const bytes = readFileSync(path, "utf8");
  await assert.rejects(appendIndex(ctx, RUN_ID, "imports", { kind: "sarif" }), /imports-index/);
  await assert.rejects(appendIndex(ctx, RUN_ID, "imports", { kind: "sarif", import_sha256: "x", original_hmac: "y", extra: 1 }), /imports-index/);
  await assert.rejects(appendIndex(ctx, RUN_ID, "findings", { a: 1 }), /index name/);
  await assert.rejects(appendIndex(ctx, "bad-id", "imports", { kind: "sarif", import_sha256: "1".repeat(64), original_hmac: "2".repeat(64) }), /run_id/);
  assert.equal(readFileSync(path, "utf8"), bytes);
});

test("appendIndex on a run without the index ⇒ exit 3 INCOMPLETE(<name>); on a COMMITTED run ⇒ exit 2 RUN-COMMITTED (G-10)", async () => {
  const ctx = ctxFor(initRepo());
  const dir = join(ctx.st, "runs", RUN_ID);
  mkdirSync(dir, { recursive: true });
  const entry = { kind: "sarif", import_sha256: "1".repeat(64), original_hmac: "2".repeat(64) };
  await assert.rejects(appendIndex(ctx, RUN_ID, "imports", entry), (err) => err instanceof CliError && err.code === 3 && err.token === "INCOMPLETE(imports)");

  writeEmptyIndexes(ctx, head);
  writeFileSync(join(dir, "COMMITTED"), "sha256=x\n");
  const bytes = readFileSync(join(dir, "imports.json"), "utf8");
  await assert.rejects(appendIndex(ctx, RUN_ID, "imports", entry), (err) => err instanceof CliError && err.code === 2 && err.token === "RUN-COMMITTED");
  assert.equal(readFileSync(join(dir, "imports.json"), "utf8"), bytes);
});

test("appendIndex refuses a tampered index (self_sha256 mismatch ⇒ IntegrityError, exit-5 class)", async () => {
  const ctx = ctxFor(initRepo());
  const dir = join(ctx.st, "runs", RUN_ID);
  mkdirSync(dir, { recursive: true });
  const art = writeArtifact(join(dir, "imports.json"), makeEnvelope({ ...head, kind: "imports-index" }, { imports: [] }));
  writeFileSync(join(dir, "imports.json"), JSON.stringify({ envelope: art.envelope, payload: { imports: [{ kind: "x", import_sha256: "1".repeat(64), original_hmac: "2".repeat(64) }] } }));
  await assert.rejects(appendIndex(ctx, RUN_ID, "imports", { kind: "sarif", import_sha256: "1".repeat(64), original_hmac: "2".repeat(64) }), (err) => err.name === "IntegrityError");
});

test("appendIndex refuses a hash-consistent but off-shape index (list key missing / not an array) ⇒ exit 5 INCONSISTENT(<file>), not a TypeError", async () => {
  const ctx = ctxFor(initRepo());
  const dir = join(ctx.st, "runs", RUN_ID);
  mkdirSync(dir, { recursive: true });
  const entry = { kind: "sarif", import_sha256: "1".repeat(64), original_hmac: "2".repeat(64) };
  for (const payload of [{ imports: "nope" }, { observations: [] }]) {
    writeArtifact(join(dir, "imports.json"), makeEnvelope({ ...head, kind: "imports-index" }, payload));
    const before = readFileSync(join(dir, "imports.json"), "utf8");
    await assert.rejects(appendIndex(ctx, RUN_ID, "imports", entry), (err) => err instanceof CliError && err.code === 5 && err.token === "INCONSISTENT(imports.json)");
    assert.equal(readFileSync(join(dir, "imports.json"), "utf8"), before, "index untouched");
  }
});

// --- TASK-058: replaceIndex — `run snapshot proposals` rewrites the whole list (TL-14) ---

test("replaceIndex (TASK-058): rewrites the list wholesale under the run lock; same refusals as appendIndex", async () => {
  const ctx = ctxFor(initRepo());
  writeEmptyIndexes(ctx, head);
  const dir = join(ctx.st, "runs", RUN_ID);
  const path = join(dir, "proposals-index.json");
  const p = (n) => ({ id: `P-00${n}`, sha256: String(n).repeat(64), path: `.agents/security-testing/proposals/P-00${n}.proposal.md` });
  await appendIndex(ctx, RUN_ID, "proposals", p(1));

  const later = createContext({ root: ctx.root }, { env: { SECURITY_EVIDENCE_NOW: "2026-09-16T12:00:00Z" } });
  const written = await replaceIndex(later, RUN_ID, "proposals", [p(2), p(3)]);
  const after1 = readArtifact(path, { kind: "proposals-index" });
  assert.deepEqual(after1.payload, { proposals: [p(2), p(3)] }, "replaced, not appended");
  assert.equal(after1.envelope.self_sha256, written.envelope.self_sha256);
  assert.equal(after1.envelope.created_at, "2026-09-16T12:00:00Z");
  assert.equal(after1.envelope.key_id, KEY_ID, "the run's key_id is carried");

  await replaceIndex(later, RUN_ID, "proposals", []);
  assert.deepEqual(readArtifact(path).payload, { proposals: [] }, "an empty list is a valid rewrite");
  assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith(".")), [], "no tmp file inside the run");
  assert.ok(!existsSync(join(ctx.st, "ledger", `${RUN_ID}.lock`)), "run lock released");

  // refusals: not an array / off-schema entry (file untouched), unknown name, COMMITTED, missing index
  const bytes = readFileSync(path, "utf8");
  await assert.rejects(replaceIndex(ctx, RUN_ID, "proposals", { id: "P-001" }), /array/);
  await assert.rejects(replaceIndex(ctx, RUN_ID, "proposals", [{ id: "P-001" }]), /proposals-index/);
  await assert.rejects(replaceIndex(ctx, RUN_ID, "findings", []), /index name/);
  assert.equal(readFileSync(path, "utf8"), bytes);
  writeFileSync(join(dir, "COMMITTED"), `${"a".repeat(64)}\n`);
  await assert.rejects(replaceIndex(ctx, RUN_ID, "proposals", [p(1)]), (err) => err instanceof CliError && err.code === 2 && err.token === "RUN-COMMITTED");
  assert.equal(readFileSync(path, "utf8"), bytes);

  const other = ctxFor(initRepo());
  mkdirSync(join(other.st, "runs", RUN_ID), { recursive: true });
  await assert.rejects(replaceIndex(other, RUN_ID, "proposals", []), (err) => err instanceof CliError && err.code === 3 && err.token === "INCOMPLETE(proposals)");
});
