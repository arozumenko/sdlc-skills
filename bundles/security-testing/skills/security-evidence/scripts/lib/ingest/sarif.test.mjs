// TASK-016 — lib/ingest/sarif.mjs, the I/O half of `ingest sarif`: the
// versioned mapping file (`references/sarif-mapping.v1.json`, D6, US-010
// AC-6) and the wiring of the pure core to cite.resolveSide. The matrix
// itself is lib/ingest/_sarif.test.mjs (fake side) and lib/ingest-sarif.test.mjs
// (the CLI over the real store).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict } from "../../canon.mjs";
import { validate } from "../schema.mjs";
import { MAPPING_PATH, MAPPING_VERSION, adapt, loadMapping } from "./sarif.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("the shipped mapping validates against sarif-mapping.v1.schema.json, is version v1 and carries the plan's tool confidences and level table", () => {
  assert.equal(MAPPING_PATH, join(HERE, "..", "..", "..", "references", "sarif-mapping.v1.json"));
  const mapping = loadMapping();
  assert.deepEqual(validate("sarif-mapping.v1", mapping), []);
  assert.equal(mapping.version, "v1");
  assert.equal(MAPPING_VERSION, "v1");
  const confidences = Object.fromEntries(Object.entries(mapping.tools).map(([k, v]) => [k, v.confidence]));
  assert.deepEqual(confidences, { semgrep: 6, gitleaks: 7, trivy: 7, "osv-scanner": 8, codeql: 7, unknown: 3 });
  assert.equal(mapping.default_confidence, 3);
  assert.deepEqual(mapping.level_priority, { error: "p1", warning: "p2", note: "p3" });
  assert.equal(mapping.tools.unknown.rule_prefix_class && Object.keys(mapping.tools.unknown.rule_prefix_class).length, 0, "an unknown tool has no prefix table (tags only)");
  // every tag / prefix class is a finding class
  const classes = new Set(["injection", "xss", "ssrf", "path-traversal", "deserialization", "auth", "authz", "crypto", "secret", "input-validation", "config", "logging", "dos", "supply-chain", "unmapped"]);
  for (const c of Object.values(mapping.tag_class)) assert.ok(classes.has(c), c);
  for (const t of Object.values(mapping.tools)) for (const c of Object.values(t.rule_prefix_class)) assert.ok(classes.has(c), c);
  // the file on disk is exactly what loadMapping returns (canonical-parsed, no defaults added)
  assert.deepEqual(mapping, parseStrict(readFileSync(MAPPING_PATH)));
});

test("loadMapping: a mapping that fails its schema is a bundle bug (throws), never a silent fallback", () => {
  assert.throws(() => loadMapping(join(HERE, "..", "..", "fixtures", "schemas", "sarif-mapping.v1.bad.json")), /sarif-mapping\.v1/);
  assert.throws(() => loadMapping(join(HERE, "..", "..", "fixtures", "sarif", "not-sarif.json")), /sarif-mapping\.v1/);
});

test("adapt: without scope.json ⇒ 3 INCOMPLETE(scope) before any side is read (§6.1 order)", async () => {
  const ctx = {};
  const run = { run_id: "0123456789ab-0001", dir: "/nowhere", envelope: {}, payload: {} };
  const base = { import_sha256: "a".repeat(64), original_hmac: "b".repeat(64), source_path: "x" };
  await assert.rejects(async () => adapt(ctx, run, null, { runs: [] }, base), (err) => err.code === 3 && err.token === "INCOMPLETE(scope)");
});
