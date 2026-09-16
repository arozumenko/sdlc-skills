// TASK-031 — the publication profile registry (plan §5 TASK-031; spec §6.9
// "profiles: redacted-report, full-report (explicit), tracker, handoff,
// case"; §4.1 row `publish`). The three M1 profiles are modules; the two M3
// names are registered and answer NOT-IMPLEMENTED(M3) through the command.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../../canon.mjs";
import { PUBLISH_PROFILES } from "../tokens.mjs";
import { EXPORT_MANIFEST_FILE, M1_PROFILES, M3_PROFILES, SIDECAR_SUFFIX, exportIdentity, expectedOutputs, manifestNameFor, profileModule, requireOutputs } from "./index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ID = "a".repeat(64);

test("registry: the five spec names; M1 modules carry PROFILE / PROFILE_VERSION / apply; M3 names resolve to null", () => {
  assert.deepEqual([...PUBLISH_PROFILES], ["redacted-report", "full-report", "tracker", "handoff", "case"]);
  assert.deepEqual([...M1_PROFILES], ["redacted-report", "full-report", "tracker"]);
  assert.deepEqual([...M3_PROFILES], ["handoff", "case"]);
  for (const name of M1_PROFILES) {
    const mod = profileModule(name);
    assert.equal(mod.PROFILE, name);
    assert.ok(Number.isInteger(mod.PROFILE_VERSION) && mod.PROFILE_VERSION >= 1, `${name}: profile_version`);
    assert.equal(typeof mod.apply, "function");
  }
  for (const name of M3_PROFILES) assert.equal(profileModule(name), null);
  assert.throws(() => profileModule("pdf"), /unknown profile/);
});

test("exportIdentity: sha256 over the canonical sorted [relpath, sha256(bytes)] list — order-independent, content-sensitive, one rule for one or many files", () => {
  const a = { relpath: "report.md", bytes: Buffer.from("# r\n") };
  const b = { relpath: "findings.json", bytes: Buffer.from("{}\n") };
  const one = exportIdentity([a]);
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(one, sha256Hex(Buffer.from(JSON.stringify([["report.md", sha256Hex(a.bytes)]]), "utf8")), "a one-file set is still the set rule");
  assert.equal(exportIdentity([a, b]), exportIdentity([b, a]));
  assert.notEqual(exportIdentity([a, b]), exportIdentity([a, { ...b, bytes: Buffer.from("{ }\n") }]));
  assert.throws(() => exportIdentity([{ relpath: "sub/report.md", bytes: Buffer.alloc(0) }]), /plain file name/);
  assert.throws(() => exportIdentity([{ relpath: "report.md", bytes: "text" }]), /Buffer/);
  assert.throws(() => requireOutputs([a, { ...a }]), /twice/);
});

test("manifest naming: report profiles write export-manifest.json; tracker writes <finding_id>.export-manifest.json; expectedOutputs inverts it", () => {
  assert.equal(EXPORT_MANIFEST_FILE, "export-manifest.json");
  assert.equal(SIDECAR_SUFFIX, ".export-manifest.json");
  assert.equal(manifestNameFor("redacted-report", {}), "export-manifest.json");
  assert.equal(manifestNameFor("full-report", {}), "export-manifest.json");
  assert.equal(manifestNameFor("tracker", { finding_id: ID }), `${ID}.export-manifest.json`);
  assert.throws(() => manifestNameFor("tracker", {}), /finding_id/);
  assert.deepEqual(expectedOutputs("redacted-report", "export-manifest.json"), { relpaths: ["report.md"], opts: {} });
  assert.deepEqual(expectedOutputs("full-report", "export-manifest.json"), { relpaths: ["report.md", "findings.json"], opts: {} });
  assert.deepEqual(expectedOutputs("tracker", `${ID}.export-manifest.json`), { relpaths: [`${ID}.ticket.json`], opts: { finding_id: ID } });
  assert.equal(expectedOutputs("tracker", "export-manifest.json"), null, "a tracker manifest must be a finding sidecar");
  assert.equal(expectedOutputs("redacted-report", `${ID}.export-manifest.json`), null, "a report manifest is not a sidecar");
});

test("G-9: the profile modules and the registry import no fs, child_process, git or clock", () => {
  for (const file of ["index.mjs", "redacted-report.mjs", "full-report.mjs", "tracker.mjs"]) {
    const src = readFileSync(join(HERE, file), "utf8");
    assert.doesNotMatch(src, /from "node:(fs|child_process|net|http|https|dns)"/, file);
    assert.doesNotMatch(src, /from "\.\.\/git\.mjs"/, file);
    assert.doesNotMatch(src, /Date\.now\(|new Date\(/, file);
  }
});
