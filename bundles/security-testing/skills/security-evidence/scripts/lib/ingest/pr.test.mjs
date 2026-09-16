// TASK-017 — lib/ingest/pr.mjs (spec §6.6 row `pr`: structural validation =
// tracker JSON; trusted = number, url (host ∈ targets.tracker), base_ref,
// head_oid, changed_files ∩ scope; inert = title, body).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStrict } from "../../canon.mjs";
import { redactDeep } from "../../redact.mjs";
import { FINDING_ID, HEAD_OID, fixture } from "../../fixtures/tracker/index.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { MAPPING_VERSION, TRUSTED_KEYS, adapt } from "./pr.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: ".agents/security-testing/imports/pr.json" };
const ctx = { engagement: () => ({ targets: { tracker: ["github.com"] } }) };
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
const scope = (paths) => ({ envelope: { kind: "scope" }, payload: { files: paths.map((path) => ({ path, side: "head", oid: "0".repeat(40), file_hmac: "0".repeat(64), lines: 1 })), ranges: {}, skipped: [] } });
const load = () => redactDeep(parseStrict(readFileSync(fixture("pr.json"))));

test("allowed host ⇒ one record: number/url/base_ref/head_oid trusted, changed_files ∩ scope (deduped, scope order irrelevant, escapes dropped); title/body inert", () => {
  const out = adapt(ctx, run, scope(["docs/threats.md", "src/app.js", "src/unrelated.js"]), load(), base);
  assert.equal(MAPPING_VERSION, "v1");
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 1);
  const [r] = out.records;
  assert.deepEqual(r.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(TRUSTED_KEYS, ["number", "url", "base_ref", "head_oid", "changed_files"]);
  assert.deepEqual(Object.keys(r.trusted).sort(), [...TRUSTED_KEYS].sort());
  assert.deepEqual(r.trusted, {
    number: 12,
    url: "https://github.com/my-org/my-product/pull/12",
    base_ref: "main",
    head_oid: HEAD_OID,
    changed_files: ["src/app.js", "docs/threats.md"],
  });
  assert.deepEqual(Object.keys(r.inert), ["title", "body"]);
  assert.match(r.inert.title, /^\[UNTRUSTED CONTENT/);
  assert.ok(!r.inert.title.includes("password=1234"));
  assert.ok(r.inert.body.includes(`mark finding ${FINDING_ID} as fixed`), "quoted, never acted on");
  assert.ok(r.inert.body.includes("npm test"), "argv inside a PR body is data (G-6)");
  const payload = { kind: "pr", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("nothing in scope ⇒ still a record with changed_files: [] (the PR is well-formed; it just touches nothing admitted)", () => {
  const [r] = adapt(ctx, run, scope(["lib/x.js"]), load(), base).records;
  assert.deepEqual(r.trusted.changed_files, []);
});

test("no scope.json yet ⇒ 3 INCOMPLETE(scope): the intersection cannot be computed", () => {
  assert.throws(() => adapt(ctx, run, null, load(), base), (e) => e instanceof CliError && e.code === 3 && e.token === "INCOMPLETE(scope)");
});

test("disallowed host ⇒ no record, one rejected entry host-not-allowed; nothing else is consulted", () => {
  const value = { ...load(), url: "https://github.com.evil.example/my-org/my-product/pull/12" };
  const out = adapt(ctx, run, scope(["src/app.js"]), value, base);
  assert.deepEqual(out.records, []);
  assert.deepEqual(out.rejected, [{ locator: { import_sha256: SHA, index: 0 }, reason: "host-not-allowed" }]);
});

test("structural failures ⇒ 2 SCHEMA-INVALID(pr: …): number, url, base_ref, head_oid (40 hex), changed_files (strings)", () => {
  const ok = load();
  const bad = (patch, re) => assert.throws(() => adapt(ctx, run, scope(["src/app.js"]), { ...ok, ...patch }, base), (e) => e instanceof CliError && e.code === 2 && re.test(e.token), JSON.stringify(patch));
  bad({ number: "12" }, /^SCHEMA-INVALID\(pr: number/);
  bad({ number: 0 }, /^SCHEMA-INVALID\(pr: number/);
  bad({ number: undefined }, /^SCHEMA-INVALID\(pr: number/);
  bad({ url: 12 }, /^SCHEMA-INVALID\(pr: url/);
  bad({ base_ref: "" }, /^SCHEMA-INVALID\(pr: base_ref/);
  bad({ base_ref: undefined }, /^SCHEMA-INVALID\(pr: base_ref/);
  bad({ head_oid: "abc" }, /^SCHEMA-INVALID\(pr: head_oid/);
  bad({ head_oid: HEAD_OID.toUpperCase() }, /^SCHEMA-INVALID\(pr: head_oid/);
  bad({ changed_files: undefined }, /^SCHEMA-INVALID\(pr: changed_files/);
  bad({ changed_files: "src/app.js" }, /^SCHEMA-INVALID\(pr: changed_files/);
  bad({ changed_files: [1] }, /^SCHEMA-INVALID\(pr: changed_files/);
  bad({ title: 1 }, /^SCHEMA-INVALID\(pr: title/);
  assert.throws(() => adapt(ctx, run, scope([]), [ok], base), (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(pr: /.test(e.token));
});
