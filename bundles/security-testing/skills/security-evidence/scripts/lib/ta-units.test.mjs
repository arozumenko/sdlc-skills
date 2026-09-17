// TASK-044 — lib/ta-units.mjs: the `ta-report` per-unit record (spec §9.3;
// US-037 AC-2, AC-3). The pure shaping over the TASK-018 adapter's records and
// the write-once file; the command-level flow is lib/observations.test.mjs.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256Hex } from "../canon.mjs";
import { cleanupAll, tmpDir } from "../fixtures/cli/harness.mjs";
import { adapt } from "./ingest/ta-report.mjs";
import { DIR, UNKNOWN, buildTaUnits, writeTaUnits } from "./ta-units.mjs";

after(cleanupAll);

const IMPORT = "a".repeat(64);
const HMAC = "b".repeat(64);
const CASE = "c".repeat(64);
const locator = { import_sha256: IMPORT, original_hmac: HMAC, source_path: ".agents/automation/x/report.json" };
const resolve = (id) => (id === "TC-001" ? { case_sha256: CASE, account: "unknown" } : null);

/** The TASK-018 fixture report, adapted (the real records TASK-044 consumes). */
function fixtureRecords(mutate) {
  const report = JSON.parse(readFileSync(new URL("../fixtures/ta/report.json", import.meta.url), "utf8"));
  if (mutate) mutate(report);
  return adapt({}, { run_id: "x", dir: "", envelope: {}, payload: {} }, null, report, locator).records;
}

test("buildTaUnits: one unit per adapter unit record in source order; outcome, coverage word, exclusions per assertion, findings, recovery_basis; identities via resolve; unknown never blank", () => {
  const units = buildTaUnits(fixtureRecords(), { import_sha256: IMPORT, resolve: (id) => (id === "TC-SEC-001" ? { case_sha256: CASE } : null) });
  assert.deepEqual(Object.keys(units), ["import_sha256", "batch", "base", "recovery_basis", "units"]);
  assert.equal(units.import_sha256, IMPORT);
  assert.equal(units.batch, "security-my-product-admitted");
  assert.equal(units.base, "main");
  assert.equal(units.recovery_basis, UNKNOWN, "no rebuilt-report block ⇒ unknown");
  assert.deepEqual(units.units.map((u) => u.case_id), ["TC-SEC-001", "TC-SEC-002", "TC-SEC-003"]);
  assert.deepEqual(units.units[0], { case_id: "TC-SEC-001", case_sha256: CASE, outcome: "delivered", outcome_reported: "delivered", gate_witnessed: true, coverage: "full", exclusions: [], findings: [], recovery_basis: UNKNOWN });
  assert.equal(units.units[1].case_sha256, UNKNOWN, "no admitted identity for the id ⇒ unknown");
  assert.equal(units.units[1].coverage, "partial");
  assert.deepEqual(units.units[1].exclusions, [{ step: "TC-SEC-002/3", category: "blocked-by-defect", referent: "SEC-DEF-17" }]);
  assert.deepEqual(units.units[1].findings, [{ kind: "defect", ref: "SEC-DEF-17" }]);
  assert.deepEqual([units.units[2].outcome, units.units[2].gate_witnessed], ["blocked", false]);
  for (const u of units.units) for (const [k, v] of Object.entries(u)) assert.ok(v !== null && v !== "", `${u.case_id}.${k}`);
  assert.doesNotThrow(() => canonical(units), "canonical: no floats, no undefined");
});

test("buildTaUnits: a rebuilt report carries recovery_basis on the header and on every unit; delivered without a gate witness is delivered-unwitnessed; a referent the adapter could not trust is unknown; a unit without a coverage block is unknown coverage", () => {
  const records = fixtureRecords((r) => {
    delete r.gate;
    for (const c of r.cases) delete c.gate;
    r.recovery = { rebuilt_from: ["receipts", "git"], note: "rebuilt" };
    r.cases[1].coverage.excluded[0].referent = "not a token, has spaces";
    delete r.cases[2].coverage;
  });
  const units = buildTaUnits(records, { import_sha256: IMPORT, resolve: () => null });
  assert.deepEqual(units.recovery_basis, ["receipts", "git"]);
  assert.deepEqual(units.units.map((u) => [u.outcome, u.outcome_reported, u.recovery_basis]), [["delivered-unwitnessed", "delivered", ["receipts", "git"]], ["delivered-unwitnessed", "delivered", ["receipts", "git"]], ["blocked", "blocked", ["receipts", "git"]]]);
  assert.deepEqual(units.units[1].exclusions, [{ step: "TC-SEC-002/3", category: "blocked-by-defect", referent: UNKNOWN }]);
  assert.equal(units.units[2].coverage, UNKNOWN);
  assert.deepEqual(units.units[2].exclusions, []);
});

test("buildTaUnits: argument checks — records, import_sha256, resolve, the report record at index 0", () => {
  assert.throws(() => buildTaUnits("x", { import_sha256: IMPORT, resolve }), /records must be/);
  assert.throws(() => buildTaUnits([], { import_sha256: "nope", resolve }), /import_sha256 must be 64 hex/);
  assert.throws(() => buildTaUnits([], { import_sha256: IMPORT }), /resolve must be a function/);
  assert.throws(() => buildTaUnits([], { import_sha256: IMPORT, resolve }), /no report record at index 0/);
});

test("writeTaUnits: <run>/ta-units/<import_sha256>.json is payload-only canonical JSON + LF, write-once (identical bytes idempotent, different bytes INCONSISTENT(ta-units/<sha>)), redacted before it is hashed", () => {
  const dir = tmpDir();
  const run = { dir };
  const payload = buildTaUnits(fixtureRecords(), { import_sha256: IMPORT, resolve });
  const first = writeTaUnits({}, run, payload);
  assert.equal(first.path, join(dir, DIR, `${IMPORT}.json`));
  const bytes = readFileSync(first.path);
  assert.deepEqual(bytes, first.bytes);
  assert.equal(first.sha256, sha256Hex(bytes));
  assert.equal(bytes.toString("utf8"), `${canonical(payload).toString("utf8")}\n`);
  assert.ok(!bytes.toString("utf8").includes('"envelope"'), "not an enveloped artifact");
  // idempotent
  assert.deepEqual(writeTaUnits({}, run, payload), first);
  // a different payload under the same import identity is the bundle's state gone wrong
  const other = { ...payload, batch: "other" };
  assert.throws(() => writeTaUnits({}, run, other), (err) => err.token === `INCONSISTENT(${DIR}/${IMPORT})` && err.code === 5);
  assert.deepEqual(readFileSync(first.path), bytes, "nothing rewritten");
  // G-4: a value redact.mjs rewrites never reaches the file
  const leaky = { ...payload, import_sha256: "d".repeat(64), units: [{ ...payload.units[0], findings: [{ kind: "note", ref: "password=Hunter2Hunter2Hunter2Hunter2Hunter2" }] }] };
  const written = writeTaUnits({}, run, leaky);
  assert.ok(!readFileSync(written.path, "utf8").includes("Hunter2"));
  assert.match(readFileSync(written.path, "utf8"), /REDACTED/);
  // argument check
  assert.throws(() => writeTaUnits({}, run, { units: [] }), /buildTaUnits' result/);
});
