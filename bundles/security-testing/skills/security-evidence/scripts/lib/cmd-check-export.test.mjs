// TASK-031 — `evidence.mjs check-export <export-manifest.json> [--source <run
// dir>]` (plan §4.1 row `check-export`, §5 TASK-031; spec §6.9 "re-applies
// the profile to the source and byte-compares (VERIFIED-DERIVATIVE) or,
// without the source, reports LINKED-ONLY", §12; US-023 AC-3, AC-4).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnvelope, readArtifact, writeArtifact } from "../canon.mjs";
import { cleanupAll, git } from "../fixtures/cli/harness.mjs";
import { readyRepo } from "../fixtures/ingest/setup.mjs";
import { ENV, ST, committedReviewRun, evidence } from "../fixtures/publish/setup.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDOFFS = join(ST, "handoffs");
const runRel = (run_id) => join(ST, "runs", run_id);
const check = (repo, manifest, source) => evidence(repo, ["check-export", manifest, ...(source === undefined ? [] : ["--source", source])]);

async function published(profile, to, options) {
  const built = await committedReviewRun(options);
  const r = await evidence(built.repo, ["publish", "--run", built.run_id, "--profile", profile, "--to", to]);
  assert.equal(r.code, 0, `publish ${profile}: ${r.stdout}${r.stderr}`);
  return built;
}

test("check-export VERIFIED-DERIVATIVE and LINKED-ONLY (spec §12; US-023 AC-3, AC-4): every M1 profile, with and without --source; exactly one stdout line", async () => {
  const { repo, run_id, ids } = await published("redacted-report", "reports/security/r");
  await evidence(repo, ["publish", "--run", run_id, "--profile", "full-report", "--to", "reports/security/f"]);
  const t = await evidence(repo, ["publish", "--run", run_id, "--profile", "tracker", "--to", HANDOFFS]);
  assert.equal(t.code, 0, `${t.stdout}${t.stderr}`);
  const manifests = ["reports/security/r/export-manifest.json", "reports/security/f/export-manifest.json", join(HANDOFFS, `${ids.injection}.export-manifest.json`), join(HANDOFFS, `${ids.secret}.export-manifest.json`)];
  for (const m of manifests) {
    const withSource = await check(repo, m, runRel(run_id));
    assert.equal(withSource.code, 0, `${m}: ${withSource.stdout}${withSource.stderr}`);
    assert.equal(withSource.stdout, "VERIFIED-DERIVATIVE\n", m);
    const without = await check(repo, m);
    assert.equal(without.code, 0, `${m}: ${without.stdout}${without.stderr}`);
    assert.equal(without.stdout, "LINKED-ONLY\n", m);
  }
  // --source as an absolute path, or as the manifest.json inside the run dir? only the run dir is accepted
  const abs = await check(repo, manifests[0], join(repo, runRel(run_id)));
  assert.equal(abs.stdout, "VERIFIED-DERIVATIVE\n");
  const viaFile = await check(repo, manifests[0], join(runRel(run_id), "manifest.json"));
  assert.equal(viaFile.code, 2);
  assert.match(viaFile.stdout, /^USAGE\(check-export: --source must be a run directory/m);
});

test("tampered output ⇒ MISMATCH exit 5 — with the source (the re-applied profile differs) and without it (the files no longer match their own manifest); a missing output file is a mismatch too", async () => {
  const { repo, run_id, ids } = await published("full-report", "reports/security/f");
  const dest = join(repo, "reports", "security", "f");
  const manifest = "reports/security/f/export-manifest.json";
  const original = readFileSync(join(dest, "report.md"));
  writeFileSync(join(dest, "report.md"), Buffer.concat([original, Buffer.from("\n<!-- edited after publication -->\n")]));
  let r = await check(repo, manifest, runRel(run_id));
  assert.equal(r.code, 5);
  assert.equal(r.stdout, "MISMATCH(output)\n");
  r = await check(repo, manifest);
  assert.equal(r.code, 5, "without the source the outputs are still compared against output_sha256");
  assert.equal(r.stdout, "MISMATCH(output)\n");
  writeFileSync(join(dest, "report.md"), original);
  assert.equal((await check(repo, manifest, runRel(run_id))).stdout, "VERIFIED-DERIVATIVE\n", "restored");
  // findings.json edited: same
  const findings = readFileSync(join(dest, "findings.json"));
  writeFileSync(join(dest, "findings.json"), findings.toString("utf8").replace('"p1"', '"p3"'));
  r = await check(repo, manifest, runRel(run_id));
  assert.equal(r.code, 5);
  assert.equal(r.stdout, "MISMATCH(output)\n");
  writeFileSync(join(dest, "findings.json"), findings);
  // a missing output
  rmSync(join(dest, "findings.json"));
  r = await check(repo, manifest, runRel(run_id));
  assert.equal(r.code, 5);
  assert.equal(r.stdout, "MISMATCH(output)\n");
  r = await check(repo, manifest);
  assert.equal(r.code, 5);
  assert.equal(r.stdout, "MISMATCH(output)\n");
  writeFileSync(join(dest, "findings.json"), findings);
  // a tracker ticket edited after publication
  const t = await evidence(repo, ["publish", "--run", run_id, "--profile", "tracker", "--to", HANDOFFS]);
  assert.equal(t.code, 0, `${t.stdout}${t.stderr}`);
  const ticket = join(repo, HANDOFFS, `${ids.injection}.ticket.json`);
  const ticketBytes = readFileSync(ticket);
  writeFileSync(ticket, ticketBytes.toString("utf8").replace('"p1"', '"p0"'));
  r = await check(repo, join(HANDOFFS, `${ids.injection}.export-manifest.json`), runRel(run_id));
  assert.equal(r.code, 5);
  assert.equal(r.stdout, "MISMATCH(output)\n");
  writeFileSync(ticket, ticketBytes);
  assert.equal((await check(repo, join(HANDOFFS, `${ids.injection}.export-manifest.json`), runRel(run_id))).stdout, "VERIFIED-DERIVATIVE\n");
});

test("--source that is not this export's source ⇒ 2 USAGE; a source that is not COMMITTED ⇒ 2 USAGE; a sidecar naming a finding the source never accepted ⇒ MISMATCH(output)", async () => {
  const { repo, run_id, ids, dir } = await published("redacted-report", "reports/security/r");
  const manifest = "reports/security/r/export-manifest.json";
  // another COMMITTED run (a different tree ⇒ a different run id), copied into this work tree so --source can name it
  const repo2 = readyRepo();
  writeFileSync(join(repo2, "extra.txt"), "x\n");
  git(repo2, ["add", "-A"]);
  git(repo2, ["commit", "-q", "-m", "extra"]);
  const other = await committedReviewRun({ repo: repo2 });
  assert.notEqual(other.run_id, run_id);
  const otherRel = join(ST, "runs", other.run_id);
  cpSync(other.dir, join(repo, otherRel), { recursive: true });
  let r = await check(repo, manifest, otherRel);
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^USAGE\(check-export: --source .* is not the source of this export \(its manifest sha256 differs\)\)$/m);
  const committed = join(dir, "COMMITTED");
  const marker = readFileSync(committed);
  rmSync(committed);
  r = await check(repo, manifest, runRel(run_id));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check-export: run [0-9a-f]{12}-\d{4} is not COMMITTED \(build-report first\)\)$/m);
  writeFileSync(committed, marker);
  // a sidecar for a finding id the source never accepted: the manifest is well-formed, the derivative cannot be re-applied
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  const bogus = "0".repeat(64);
  const sidecar = join(repo, HANDOFFS, `${bogus}.export-manifest.json`);
  writeArtifact(sidecar, makeEnvelope({ schema_version: run.envelope.schema_version, kind: "export-manifest", run_id, engagement_id: run.envelope.engagement_id, key_id: run.envelope.key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, { source_manifest_sha256: readArtifact(join(dir, "manifest.json")).envelope.self_sha256, profile: "tracker", profile_version: 1, output_sha256: "1".repeat(64) }));
  writeFileSync(join(repo, HANDOFFS, `${bogus}.ticket.json`), "{}\n");
  r = await check(repo, join(HANDOFFS, `${bogus}.export-manifest.json`), runRel(run_id));
  assert.equal(r.code, 5);
  assert.equal(r.stdout, "MISMATCH(output)\n");
  assert.ok(ids.injection !== bogus);
});

test("the manifest argument: missing ⇒ 2 USAGE; outside the work tree ⇒ 2 USAGE; not an export manifest (plain JSON, another kind, a tampered envelope, a tracker manifest not named as a sidecar) ⇒ 2 USAGE; nothing is ever written", async () => {
  const { repo, run_id, dir } = await published("redacted-report", "reports/security/r");
  let r = await evidence(repo, ["check-export"]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check-export: an export-manifest\.json path is required\)$/m);
  r = await check(repo, "../elsewhere.json");
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check-export: cannot read \.\.\/elsewhere\.json \(outside the work tree\)\)$/m);
  r = await check(repo, "reports/security/r/nope.json");
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check-export: cannot read reports\/security\/r\/nope\.json/m);
  writeFileSync(join(repo, "plain.json"), '{"profile":"tracker"}\n');
  r = await check(repo, "plain.json");
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check-export: plain\.json is not an export manifest \(/m);
  r = await check(repo, join(runRel(run_id), "manifest.json"));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /is not an export manifest \(/m, "a run manifest is another kind");
  const em = join(repo, "reports", "security", "r", "export-manifest.json");
  const bytes = readFileSync(em);
  writeFileSync(em, bytes.toString("utf8").replace('"profile":"redacted-report"', '"profile":"full-report"'));
  r = await check(repo, "reports/security/r/export-manifest.json");
  assert.equal(r.code, 2);
  assert.match(r.stdout, /is not an export manifest \(/m, "self_sha256 no longer matches");
  writeFileSync(em, bytes);
  // a tracker manifest must be a <finding_id>.export-manifest.json sidecar
  mkdirSync(join(repo, HANDOFFS), { recursive: true });
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  writeArtifact(join(repo, HANDOFFS, "export-manifest.json"), makeEnvelope({ schema_version: run.envelope.schema_version, kind: "export-manifest", run_id, engagement_id: run.envelope.engagement_id, key_id: run.envelope.key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, { source_manifest_sha256: readArtifact(join(dir, "manifest.json")).envelope.self_sha256, profile: "tracker", profile_version: 1, output_sha256: "1".repeat(64) }));
  r = await check(repo, join(HANDOFFS, "export-manifest.json"));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(check-export: a tracker export manifest must be named <finding_id>\.export-manifest\.json/m);
  // an M3 profile in a manifest: registered, not implemented
  writeArtifact(join(repo, "reports", "security", "m3.json"), makeEnvelope({ schema_version: run.envelope.schema_version, kind: "export-manifest", run_id, engagement_id: run.envelope.engagement_id, key_id: run.envelope.key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, { source_manifest_sha256: readArtifact(join(dir, "manifest.json")).envelope.self_sha256, profile: "case", profile_version: 1, output_sha256: "1".repeat(64) }));
  r = await check(repo, "reports/security/m3.json", runRel(run_id));
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "NOT-IMPLEMENTED(M3)\n");
});

test("cmd-check-export writes nothing (no fs writer imported) and prints only through ctx.out", () => {
  const src = readFileSync(join(HERE, "cmd-check-export.mjs"), "utf8");
  assert.doesNotMatch(src, /writeFileSync|writeAtomic|writeArtifact|appendFileSync|mkdirSync|renameSync/);
  assert.doesNotMatch(src, /console\.(log|error)|process\.stdout/);
  assert.doesNotMatch(src, /from "node:child_process"|fetch\(|from "node:http/);
});
