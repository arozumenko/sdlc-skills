// TASK-031 — the publication profile registry (plan §5 TASK-031; spec §6.9
// "profiles: redacted-report, full-report (explicit), tracker, handoff,
// case"; §4.1 row `publish`). The three M1 profiles are modules; the two M3
// names (`handoff`, `case`) are modules since TASK-043.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../../canon.mjs";
import { PUBLISH_PROFILES } from "../tokens.mjs";
import { EXPORT_MANIFEST_FILE, M1_PROFILES, M3_PROFILES, SIDECAR_SUFFIX, exportIdentity, expectedOutputs, manifestNameFor, memberIdentity, membersOf, profileModule, requireOutputs } from "./index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ID = "a".repeat(64);

test("registry: the five spec names; every module carries PROFILE / PROFILE_VERSION / apply (the M3 pair since TASK-043)", () => {
  assert.deepEqual([...PUBLISH_PROFILES], ["redacted-report", "full-report", "tracker", "handoff", "case"]);
  assert.deepEqual([...M1_PROFILES], ["redacted-report", "full-report", "tracker"]);
  assert.deepEqual([...M3_PROFILES], ["handoff", "case"]);
  for (const name of [...M1_PROFILES, ...M3_PROFILES]) {
    const mod = profileModule(name);
    assert.equal(mod.PROFILE, name);
    assert.ok(Number.isInteger(mod.PROFILE_VERSION) && mod.PROFILE_VERSION >= 1, `${name}: profile_version`);
    assert.equal(typeof mod.apply, "function");
  }
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
  // the recorded member list (export-manifest opts.members) hashes to the same identity
  const members = membersOf([a, b]);
  assert.deepEqual(members, [{ relpath: "findings.json", sha256: sha256Hex(b.bytes) }, { relpath: "report.md", sha256: sha256Hex(a.bytes) }], "sorted by relpath");
  assert.equal(memberIdentity(members), exportIdentity([a, b]));
  assert.throws(() => memberIdentity([{ relpath: "x", sha256: "nope" }]), TypeError);
});

test("manifest naming: report profiles write export-manifest.json; tracker writes <finding_id>.export-manifest.json; expectedOutputs inverts it", () => {
  assert.equal(EXPORT_MANIFEST_FILE, "export-manifest.json");
  assert.equal(SIDECAR_SUFFIX, ".export-manifest.json");
  assert.equal(manifestNameFor("redacted-report", {}), "export-manifest.json");
  assert.equal(manifestNameFor("full-report", {}), "export-manifest.json");
  assert.equal(manifestNameFor("tracker", { finding_id: ID }), `${ID}.export-manifest.json`);
  assert.throws(() => manifestNameFor("tracker", {}), /finding_id/);
  assert.deepEqual(expectedOutputs("redacted-report", "export-manifest.json"), { relpaths: ["report.md"], opts: {}, dir: null });
  assert.deepEqual(expectedOutputs("full-report", "export-manifest.json"), { relpaths: ["report.md", "findings.json"], opts: {}, dir: null });
  assert.deepEqual(expectedOutputs("tracker", `${ID}.export-manifest.json`), { relpaths: [`${ID}.ticket.json`], opts: { finding_id: ID }, dir: null });
  assert.equal(expectedOutputs("tracker", "export-manifest.json"), null, "a tracker manifest must be a finding sidecar");
  assert.equal(expectedOutputs("redacted-report", `${ID}.export-manifest.json`), null, "a report manifest is not a sidecar");
});

const RUN = "0123456789ab-0007";

test("TASK-043 naming: handoff and case manifests are `<run_id>.<profile>.export-manifest.json` (one per publish, in <st>/handoffs/); expectedOutputs needs the recorded opts — the handoff prompt next to the manifest, the case suite under tasks/security-<slug>-admitted", () => {
  assert.equal(manifestNameFor("handoff", { run_id: RUN }), `${RUN}.handoff.export-manifest.json`);
  assert.equal(manifestNameFor("case", { run_id: RUN }), `${RUN}.case.export-manifest.json`);
  assert.throws(() => manifestNameFor("case", {}), /run_id/);
  const members = [{ relpath: "TC-001_a.md", sha256: ID }, { relpath: "TC-002_b.md", sha256: ID }];
  assert.deepEqual(expectedOutputs("handoff", `${RUN}.handoff.export-manifest.json`, { slug: "my-product", base_url: "https://x.example.com" }), { relpaths: ["my-product.md"], opts: { slug: "my-product", base_url: "https://x.example.com" }, dir: null });
  assert.deepEqual(expectedOutputs("case", `${RUN}.case.export-manifest.json`, { slug: "my-product", members }), { relpaths: ["TC-001_a.md", "TC-002_b.md"], opts: { slug: "my-product" }, dir: "tasks/security-my-product-admitted" });
  assert.equal(expectedOutputs("case", "export-manifest.json", { slug: "x", members }), null, "a case manifest must be a run-named sidecar");
  assert.equal(expectedOutputs("handoff", `${RUN}.case.export-manifest.json`, { slug: "x", base_url: "https://x" }), null, "the profile in the name must be the manifest's");
  assert.equal(expectedOutputs("case", `${RUN}.case.export-manifest.json`, {}), null, "no slug / members recorded ⇒ nothing to compare");
  assert.equal(expectedOutputs("handoff", `${RUN}.handoff.export-manifest.json`, { slug: "x" }), null, "no base_url recorded ⇒ not re-derivable");
  assert.equal(expectedOutputs("tracker", `${ID}.export-manifest.json`, { slug: "ignored" }).relpaths[0], `${ID}.ticket.json`, "M1 profiles ignore opts");
});

test("G-9: the profile modules and the registry import no fs, child_process, git or clock", () => {
  for (const file of ["index.mjs", "redacted-report.mjs", "full-report.mjs", "tracker.mjs", "handoff.mjs", "case.mjs"]) {
    const src = readFileSync(join(HERE, file), "utf8");
    assert.doesNotMatch(src, /from "node:(fs|child_process|net|http|https|dns)"/, file);
    assert.doesNotMatch(src, /from "\.\.\/git\.mjs"/, file);
    assert.doesNotMatch(src, /Date\.now\(|new Date\(/, file);
  }
});
