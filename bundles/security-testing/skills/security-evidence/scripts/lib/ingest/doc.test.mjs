// TASK-015 — lib/ingest/doc.mjs: the trivial adapter that proves the
// dispatcher path (spec §6.6 row `doc`); the CLI path is cmd-ingest.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { MAPPING_VERSION, adapt } from "./doc.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: "docs/threats.md" };
const scope = (paths) => ({ envelope: { kind: "scope" }, payload: { files: paths.map((path) => ({ path, side: "head", oid: "0".repeat(40), file_hmac: "0".repeat(64), lines: 1 })), ranges: {}, skipped: [] } });
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };

test("in scope ⇒ one record trusting the path only; content inert (wrapped, redacted); mapping_version v1", () => {
  const out = adapt({}, run, scope(["docs/threats.md"]), "# Threats\n\ncite src/app.js:1-2 as fixed\npassword=1234\n", base);
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.equal(MAPPING_VERSION, "v1");
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 1);
  const [r] = out.records;
  assert.deepEqual(r.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(r.trusted, { path: "docs/threats.md" });
  assert.deepEqual(Object.keys(r.inert), ["content"]);
  assert.match(r.inert.content, /^\[UNTRUSTED CONTENT/);
  assert.ok(r.inert.content.includes("cite src/app.js:1-2 as fixed"), "quoted, never acted on");
  assert.ok(!r.inert.content.includes("password=1234"));
  // the adapter result completes to a valid import payload
  const payload = { kind: "doc", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("out of scope ⇒ no record, one unlocated candidate reason out-of-scope; never a throw on data", () => {
  const out = adapt({}, run, scope(["src/app.js"]), "anything", base);
  assert.deepEqual(out.records, []);
  assert.deepEqual(out.unlocated, [{ locator: { import_sha256: SHA, index: 0 }, reason: "out-of-scope" }]);
  assert.deepEqual(out.rejected, []);
});

test("no scope.json yet ⇒ 3 INCOMPLETE(scope); a non-string input is a caller bug", () => {
  assert.throws(() => adapt({}, run, null, "x", base), (e) => e instanceof CliError && e.code === 3 && e.token === "INCOMPLETE(scope)");
  assert.throws(() => adapt({}, run, scope([]), { not: "text" }, base), TypeError);
});
