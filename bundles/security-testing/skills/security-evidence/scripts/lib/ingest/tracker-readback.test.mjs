// TASK-017 — lib/ingest/tracker-readback.mjs (spec §6.6 row
// `tracker-readback`: tracker JSON after a mutation; trusted = the fields the
// mutation set; inert = everything else; `mismatch: [<field>]` when the
// read-back differs from what `publish --profile tracker` sent). The CLI path
// (READBACK lines) is ingest-tracker.test.mjs; the `ticketed` event is TASK-045.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStrict } from "../../canon.mjs";
import { redactDeep } from "../../redact.mjs";
import { FINDING_ID, fixture } from "../../fixtures/tracker/index.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { READBACK_FIELDS } from "../tokens.mjs";
import { MAPPING_VERSION, TRUSTED_KEYS, adapt } from "./tracker-readback.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: ".agents/security-testing/imports/readback.json" };
const ctx = { engagement: () => ({ targets: { tracker: ["github.com"] } }) };
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
const load = (name) => redactDeep(parseStrict(readFileSync(fixture(name))));
const sent = () => ({ sent: "/repo/.agents/security-testing/handoffs/x.ticket.json", sent_payload: load("sent.ticket.json") });

test("matching read-back ⇒ one record: finding_id + id/url/labels/state + body_contains_finding_id:true + mismatch:[]; title/body inert", () => {
  const out = adapt(ctx, run, null, load("readback.json"), base, sent());
  assert.equal(MAPPING_VERSION, "v1");
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 1);
  const [r] = out.records;
  assert.deepEqual(r.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(TRUSTED_KEYS, ["finding_id", "id", "url", "labels", "state", "body_contains_finding_id", "mismatch"]);
  assert.deepEqual(Object.keys(r.trusted).sort(), [...TRUSTED_KEYS].sort());
  assert.deepEqual(r.trusted, {
    finding_id: FINDING_ID,
    id: 7,
    url: "https://github.com/my-org/my-product/issues/7",
    labels: ["security", "p1"],
    state: "open",
    body_contains_finding_id: true,
    mismatch: [],
  });
  assert.deepEqual(Object.keys(r.inert), ["title", "body"]);
  assert.match(r.inert.body, /^\[UNTRUSTED CONTENT/);
  assert.ok(!r.inert.body.includes("password=1234"));
  assert.ok(r.inert.body.includes("Load bugfix-workflow"), "quoted, never acted on");
  const payload = { kind: "tracker-readback", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("read-back whose title differs and whose body lacks the finding id ⇒ mismatch [title, body], body_contains_finding_id:false; still one record", () => {
  const [r] = adapt(ctx, run, null, load("readback.mismatch.json"), base, sent()).records;
  assert.deepEqual(r.trusted.mismatch, ["title", "body"]);
  assert.equal(r.trusted.body_contains_finding_id, false);
  assert.equal(r.trusted.id, 8);
  assert.equal(r.trusted.finding_id, FINDING_ID, "the finding id is the sent payload's, never the read-back's");
});

test("foreign host ⇒ mismatch includes url (the record is kept for the lead to see; TASK-045 appends no event); mismatch order is READBACK_FIELDS order", () => {
  const value = { ...load("readback.mismatch.json"), url: "https://tracker.evil.example/browse/SEC-42" };
  const [r] = adapt(ctx, run, null, value, base, sent()).records;
  assert.deepEqual(r.trusted.mismatch, ["url", "title", "body"]);
  assert.deepEqual(READBACK_FIELDS, ["url", "title", "body"]);
  assert.equal(r.trusted.url, "https://tracker.evil.example/browse/SEC-42");
});

test("absent title is not a mismatch (nothing to compare); absent body is (the id cannot be confirmed)", () => {
  const value = { id: 7, url: "https://github.com/my-org/my-product/issues/7", state: "open" };
  const [r] = adapt(ctx, run, null, value, base, sent()).records;
  assert.deepEqual(r.trusted.mismatch, ["body"]);
  assert.equal(r.trusted.body_contains_finding_id, false);
  assert.deepEqual(r.trusted.labels, []);
  assert.deepEqual(r.inert, {});
});

test("the sent payload is validated: finding_id and title are required strings; missing --sent is a usage error", () => {
  const rb = load("readback.json");
  const bad = (sent_payload, re) => assert.throws(() => adapt(ctx, run, null, rb, base, { sent: "/x", sent_payload }), (e) => e instanceof CliError && e.code === 2 && re.test(e.token), JSON.stringify(sent_payload));
  bad({ title: "t" }, /^SCHEMA-INVALID\(tracker-readback: --sent finding_id/);
  bad({ finding_id: "", title: "t" }, /^SCHEMA-INVALID\(tracker-readback: --sent finding_id/);
  bad({ finding_id: FINDING_ID }, /^SCHEMA-INVALID\(tracker-readback: --sent title/);
  bad({ finding_id: FINDING_ID, title: 1 }, /^SCHEMA-INVALID\(tracker-readback: --sent title/);
  bad([], /^SCHEMA-INVALID\(tracker-readback: --sent /);
  bad(null, /^SCHEMA-INVALID\(tracker-readback: --sent /);
  assert.throws(() => adapt(ctx, run, null, rb, base, {}), (e) => e instanceof CliError && e.code === 2 && e.token === "USAGE(ingest: --sent <ticket.json> is required for tracker-readback)");
  assert.throws(() => adapt(ctx, run, null, rb, base), (e) => e instanceof CliError && e.code === 2 && /--sent/.test(e.token));
});

test("read-back structural failures ⇒ 2 SCHEMA-INVALID(tracker-readback: …)", () => {
  const rb = load("readback.json");
  assert.throws(() => adapt(ctx, run, null, { ...rb, id: undefined }, base, sent()), (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(tracker-readback: id/.test(e.token));
  assert.throws(() => adapt(ctx, run, null, { ...rb, state: 1 }, base, sent()), (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(tracker-readback: state/.test(e.token));
});
