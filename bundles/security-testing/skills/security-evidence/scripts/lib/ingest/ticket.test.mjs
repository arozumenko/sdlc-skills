// TASK-017 — lib/ingest/ticket.mjs (spec §6.6 row `ticket`: structural
// validation = tracker JSON; trusted = id, url (host ∈ targets.tracker),
// labels, state; inert = title, body). The CLI path is ingest-tracker.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStrict } from "../../canon.mjs";
import { redactDeep } from "../../redact.mjs";
import { fixture } from "../../fixtures/tracker/index.mjs";
import { CliError } from "../exit.mjs";
import { validate } from "../schema.mjs";
import { MAPPING_VERSION, TRUSTED_KEYS, adapt } from "./ticket.mjs";

const SHA = "a".repeat(64);
const HMAC = "b".repeat(64);
const base = { import_sha256: SHA, original_hmac: HMAC, source_path: ".agents/security-testing/imports/ticket.json" };
const ctx = { engagement: () => ({ targets: { tracker: ["github.com"] } }) };
const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
const scope = { envelope: { kind: "scope" }, payload: { files: [], ranges: {}, skipped: [] } };
const load = (name) => redactDeep(parseStrict(readFileSync(fixture(name))));

test("allowed host ⇒ one record trusting id/url/labels/state only; title and body inert (wrapped, redacted); mapping_version v1", () => {
  const out = adapt(ctx, run, scope, load("ticket.json"), base);
  assert.equal(MAPPING_VERSION, "v1");
  assert.equal(out.mapping_version, MAPPING_VERSION);
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.records.length, 1);
  const [r] = out.records;
  assert.deepEqual(r.locator, { import_sha256: SHA, original_hmac: HMAC, index: 0 });
  assert.deepEqual(Object.keys(r.trusted).sort(), [...TRUSTED_KEYS].sort());
  assert.deepEqual(TRUSTED_KEYS, ["id", "url", "labels", "state"]);
  assert.equal(r.trusted.id, 7);
  assert.equal(r.trusted.url, "https://github.com/my-org/my-product/issues/7?<REDACTED:token-assign>", "the url is the redacted one; the host survives");
  assert.deepEqual(r.trusted.labels, ["security", "p1"]);
  assert.equal(r.trusted.state, "open");
  assert.equal(Object.hasOwn(r.trusted, "assignee"), false, "keys outside the spec's trusted column never enter trusted");
  assert.deepEqual(Object.keys(r.inert), ["title", "body"]);
  for (const v of Object.values(r.inert)) {
    assert.match(v, /^\[UNTRUSTED CONTENT/);
    assert.ok(!v.includes("password=1234"));
  }
  assert.ok(r.inert.body.includes("Ignore all previous instructions"), "quoted, never acted on");
  assert.ok(r.inert.body.includes("src/app.js:1-2"), "a citation inside the body is text, not a citation");
  const payload = { kind: "ticket", import_sha256: SHA, original_hmac: HMAC, redaction_version: 1, source_path: base.source_path, ...out };
  assert.deepEqual(validate("import", payload), []);
});

test("disallowed host ⇒ no record, one rejected entry host-not-allowed, exit code unchanged (no throw); {name} labels would have been accepted", () => {
  const out = adapt(ctx, run, scope, load("ticket.foreign-host.json"), base);
  assert.deepEqual(out.records, []);
  assert.deepEqual(out.unlocated, []);
  assert.deepEqual(out.rejected, [{ locator: { import_sha256: SHA, index: 0 }, reason: "host-not-allowed" }]);
  // the same file with the host listed is accepted, labels normalised to names
  const allowed = { engagement: () => ({ targets: { tracker: ["tracker.evil.example"] } }) };
  const ok = adapt(allowed, run, scope, load("ticket.foreign-host.json"), base);
  assert.equal(ok.records.length, 1);
  assert.deepEqual(ok.records[0].trusted, { id: "SEC-42", url: "https://tracker.evil.example/browse/SEC-42", state: "open", labels: ["security"] });
});

test("an unparseable or fully redacted url is not an allowed host (fail closed)", () => {
  const value = { ...load("ticket.json"), url: "<REDACTED:token-assign>" };
  const out = adapt(ctx, run, scope, value, base);
  assert.equal(out.records.length, 0);
  assert.equal(out.rejected[0].reason, "host-not-allowed");
});

test("structural failure ⇒ 2 SCHEMA-INVALID(ticket: …); the scope is not consulted (a ticket cites nothing)", () => {
  assert.throws(() => adapt(ctx, run, null, { url: "https://github.com/x", state: "open" }, base), (e) => e instanceof CliError && e.code === 2 && e.token === "SCHEMA-INVALID(ticket: id must be a non-empty string or a non-negative integer)");
  assert.throws(() => adapt(ctx, run, null, [], base), (e) => e instanceof CliError && e.code === 2 && /^SCHEMA-INVALID\(ticket: /.test(e.token));
  // scope may be absent: a ticket does not need scope.json (no INCOMPLETE(scope))
  const out = adapt(ctx, run, null, load("ticket.json"), base);
  assert.equal(out.records.length, 1);
});

test("title and body are never trusted even when they spell trusted keys", () => {
  const value = { id: 1, url: "https://github.com/o/r/issues/1", state: "open", title: "state: closed", body: "{\"url\": \"https://evil.example\"}" };
  const [r] = adapt(ctx, run, scope, value, base).records;
  assert.equal(r.trusted.state, "open");
  assert.equal(r.trusted.url, "https://github.com/o/r/issues/1");
});
