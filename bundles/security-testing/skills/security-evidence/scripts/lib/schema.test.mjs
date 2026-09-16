// TASK-005 — JSON schemas + lib/schema.mjs validator subset.
// Verification cases named in the task plan §5, plus the guardrails the
// schema files must hold (G-8 grep guards, integers only, closed objects).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validate,
  loadSchema,
  forbiddenKeys,
  resolveRef,
  SchemaError,
  SCHEMA_DIR,
  SCHEMA_NAMES,
  SCHEMA_ALIASES,
  SUPPORTED_KEYWORDS,
  ENVELOPE_KINDS,
  RECEIPT_FORBIDDEN_KEYS,
} from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "schemas");
const SELF = readFileSync(join(HERE, "schema.mjs"), "utf8");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const fixture = (name, kind) => readJson(join(FIXTURES, `${name}.${kind}.json`));
const schemaFiles = () => readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json")).sort();

// Walk every subschema of a schema document; yields [path, subschema].
function* subschemas(node, path = "#") {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  yield [path, node];
  for (const key of ["properties", "patternProperties", "$defs"]) {
    if (node[key]) for (const [k, v] of Object.entries(node[key])) yield* subschemas(v, `${path}/${key}/${k}`);
  }
  if (node.items) yield* subschemas(node.items, `${path}/items`);
  if (node.oneOf) for (let i = 0; i < node.oneOf.length; i++) yield* subschemas(node.oneOf[i], `${path}/oneOf/${i}`);
}

// Entry object of a named schema (follows a root $ref); returns the object
// subschema whose `required`/`properties` are the payload's top level.
function entryOf(name) {
  const root = loadSchema(name);
  return root.$ref ? resolveRef(root, root.$ref) : root;
}

const SHA256 = "a".repeat(64);
const SHA256_B = "b".repeat(64);
const OID = "c".repeat(40);

// ---------------------------------------------------------------------------
// US-002 AC-4 — preimage table honoured
// ---------------------------------------------------------------------------

test("preimage table honoured", () => {
  // Spec §6.1 rows. Two rows are read through the §20 amendments that the
  // §6.1 table itself was not re-edited for: P1 adds `kind` to the packet
  // (§6.4 spells `{kind, subject_ids[], files[], policy_sha256}`), and P5
  // (INDETERMINATE coverage blocks sign-off) is carried as the coverage
  // payload's `indeterminate` flag, per the TASK-005 shape.
  const rows = {
    run: { required: ["engagement_id", "seq", "base_oid", "head_oid", "template"] },
    scope: { required: ["files", "ranges", "skipped"], optional: ["snapshot"] },
    "gate-result": { required: ["accepted", "unverifiable", "rejected_counts", "scope_sha256", "claimed_sha256"] },
    coverage: { required: ["accounting", "scanner_rows", "scope_sha256", "examined_sha256", "indeterminate"] },
    packet: { required: ["kind", "subject_ids", "files", "policy_sha256"] },
    "run-manifest": { required: ["inputs", "report_sha256", "template", "template_version", "tool_version"] },
  };
  for (const [name, row] of Object.entries(rows)) {
    const entry = entryOf(name);
    assert.deepEqual([...entry.required].sort(), [...row.required].sort(), `${name}: required keys`);
    const expectedProps = [...row.required, ...(row.optional ?? [])].sort();
    assert.deepEqual(Object.keys(entry.properties).sort(), expectedProps, `${name}: property keys`);
    assert.equal(entry.additionalProperties, false, `${name}: closed`);
  }
  // packet.files[] item keys
  const packet = loadSchema("packet");
  const itemsRaw = entryOf("packet").properties.files.items;
  const fileItem = itemsRaw.$ref ? resolveRef(packet, itemsRaw.$ref) : itemsRaw;
  assert.deepEqual([...fileItem.required].sort(), ["oid", "path", "range_hmac", "ranges", "side"]);
  // receipt: every oneOf branch carries exactly the §6.1 receipt keys
  const receipt = loadSchema("receipt");
  assert.ok(Array.isArray(receipt.oneOf) && receipt.oneOf.length === 4, "receipt is a oneOf of four types");
  for (const branch of receipt.oneOf) {
    const b = branch.$ref ? resolveRef(receipt, branch.$ref) : branch;
    assert.deepEqual([...b.required].sort(), ["assertion", "packet_sha256", "reviewer_run_id", "subject_id", "type"]);
    assert.deepEqual(Object.keys(b.properties).sort(), ["assertion", "packet_sha256", "reviewer_run_id", "subject_id", "type"]);
    assert.equal(b.additionalProperties, false);
  }
});

// ---------------------------------------------------------------------------
// Schema-file guardrails (G-8, integers only, closed objects, hash patterns)
// ---------------------------------------------------------------------------

test("no schema declares number; integers only", () => {
  for (const file of schemaFiles()) {
    const doc = readJson(join(SCHEMA_DIR, file));
    for (const [path, sub] of subschemas(doc)) {
      assert.notEqual(sub.type, "number", `${file} ${path} declares type number`);
    }
    assert.ok(!/"type"\s*:\s*"number"/.test(readFileSync(join(SCHEMA_DIR, file), "utf8")), `${file}: raw text has number`);
  }
});

test("no schema has authenticated:true or the word confirmed outside the receipt/threat enums", () => {
  for (const file of schemaFiles()) {
    const text = readFileSync(join(SCHEMA_DIR, file), "utf8");
    assert.ok(!/authenticated"?\s*:\s*true/.test(text), `${file}: authenticated:true`);
    const doc = readJson(join(SCHEMA_DIR, file));
    for (const [path, sub] of subschemas(doc)) {
      if (sub.properties?.authenticated) {
        assert.deepEqual(sub.properties.authenticated, { type: "boolean", const: false }, `${file} ${path}: authenticated must be const false`);
      }
      // "confirmed" may appear only as a receipt assertion enum member.
      const hasConfirmed = (sub.enum ?? []).includes("confirmed") || sub.const === "confirmed";
      if (hasConfirmed) {
        assert.equal(file, "receipt.schema.json", `${file} ${path}: "confirmed" outside receipt`);
        assert.match(path, /\/properties\/assertion$/, `${file} ${path}: "confirmed" outside an assertion enum`);
      }
    }
    // no other string-literal use of the word (titles, comments, consts)
    const matches = text.match(/confirmed/g) ?? [];
    if (file !== "receipt.schema.json") assert.equal(matches.length, 0, `${file}: word confirmed present`);
    assert.ok(!/"confirm"/.test(text), `${file}: confirm command name present`);
  }
});

test("every object level is closed and every $ref points at #/$defs", () => {
  for (const file of schemaFiles()) {
    const doc = readJson(join(SCHEMA_DIR, file));
    for (const [path, sub] of subschemas(doc)) {
      if (sub.type === "object") {
        assert.equal(sub.additionalProperties, false, `${file} ${path}: object without additionalProperties:false`);
      }
      if (sub.$ref !== undefined) {
        assert.match(sub.$ref, /^#\/\$defs\/[A-Za-z0-9_-]+$/, `${file} ${path}: $ref outside #/$defs`);
        assert.ok(doc.$defs && doc.$defs[sub.$ref.slice("#/$defs/".length)], `${file} ${path}: dangling $ref ${sub.$ref}`);
      }
      if (sub.$defs !== undefined) assert.equal(path, "#", `${file} ${path}: $defs only at the root`);
    }
  }
});

test("every *_sha256 / *_hmac / oid property carries the hex pattern; every ranges value is [start>=1, end]", () => {
  const HEX40 = "^[0-9a-f]{40}$";
  const HEX64 = "^[0-9a-f]{64}$";
  const EITHER = "^[0-9a-f]{40}$|^[0-9a-f]{64}$";
  const isRangeSchema = (s) =>
    s && s.type === "array" && s.minItems === 2 && s.maxItems === 2 && s.items && s.items.type === "integer" && s.items.minimum === 1;
  for (const file of schemaFiles()) {
    const doc = readJson(join(SCHEMA_DIR, file));
    const deref = (s) => (s && s.$ref ? resolveRef(doc, s.$ref) : s);
    for (const [path, sub] of subschemas(doc)) {
      for (const [key, raw] of Object.entries(sub.properties ?? {})) {
        const prop = deref(raw);
        const where = `${file} ${path}/properties/${key}`;
        if (/_sha256$|^sha256$|_hmac$/.test(key)) {
          assert.equal(prop.type, "string", `${where}: hash must be a string`);
          assert.equal(prop.pattern, HEX64, `${where}: hash pattern`);
        }
        if (key === "oid" || /_oid$/.test(key)) {
          if (file === "observation.schema.json") continue; // head_oid may be the string "unknown" (TASK-005)
          assert.ok([HEX40, EITHER].includes(prop.pattern), `${where}: oid pattern`);
        }
        if (key === "ranges") {
          // either [range] or {<path>: [range]}
          if (prop.type === "array") assert.ok(isRangeSchema(deref(prop.items)), `${where}: ranges items must be a range`);
          else {
            assert.equal(prop.type, "object");
            const [pp] = Object.values(prop.patternProperties);
            assert.ok(isRangeSchema(deref(deref(pp).items)), `${where}: ranges values must be [range]`);
          }
        }
        if (key === "lines" && prop.type === "array") assert.ok(isRangeSchema(prop), `${where}: lines must be a range`);
      }
    }
  }
});

test("every §4.1 envelope kind resolves to a schema and the envelope enum lists exactly them", () => {
  const env = loadSchema("envelope");
  assert.deepEqual([...env.properties.kind.enum].sort(), [...ENVELOPE_KINDS].sort());
  assert.equal(ENVELOPE_KINDS.length, 25);
  for (const kind of ENVELOPE_KINDS) assert.ok(loadSchema(kind), `kind ${kind} has no schema`);
  assert.deepEqual(env.properties.schema_version, { type: "integer", const: 1 });
});

// ---------------------------------------------------------------------------
// US-015 AC-7 — receipt forbidden keys
// ---------------------------------------------------------------------------

const okReceipt = () => ({
  type: "vulnerability-review",
  subject_id: SHA256,
  packet_sha256: SHA256_B,
  assertion: "confirmed",
  reviewer_run_id: "deadbeefcafe-0001",
});

test("receipt schema rejects state/verdict/id/gate fields and forbiddenKeys names them", () => {
  assert.deepEqual(validate("receipt", okReceipt()), []);
  assert.deepEqual(RECEIPT_FORBIDDEN_KEYS, ["state", "verdict", "id", "gate", "gate_stamp", "states"]);
  for (const key of RECEIPT_FORBIDDEN_KEYS) {
    const r = { ...okReceipt(), [key]: "x" };
    assert.ok(validate("receipt", r).length > 0, `receipt with ${key} must fail schema`);
    assert.deepEqual(forbiddenKeys(r), [key]);
  }
  // nested forbidden keys are named too, each once, in encounter order
  const nested = { ...okReceipt(), extra: { deep: [{ verdict: "VERIFIED", state: "x" }], id: 1 } };
  assert.deepEqual(forbiddenKeys(nested), ["verdict", "state", "id"]);
  assert.deepEqual(forbiddenKeys(okReceipt()), []);
  // an ack receipt's indicator_id is not "id"
  const ack = { type: "ack", subject_id: SHA256, packet_sha256: SHA256_B, assertion: { indicator_id: SHA256 }, reviewer_run_id: "r" };
  assert.deepEqual(validate("receipt", ack), []);
  assert.deepEqual(forbiddenKeys(ack), []);
  // per-type assertion vocabularies are closed
  assert.deepEqual(validate("receipt", { ...okReceipt(), type: "mitigation-review", assertion: "gap" }), []);
  assert.deepEqual(validate("receipt", { ...okReceipt(), type: "fix-review", assertion: "not-refound" }), []);
  assert.ok(validate("receipt", { ...okReceipt(), type: "fix-review", assertion: "confirmed" }).length > 0);
  assert.ok(validate("receipt", { ...okReceipt(), type: "mitigation-review", assertion: "refuted" }).length > 0);
  assert.ok(validate("receipt", { ...okReceipt(), assertion: "gap" }).length > 0);
  assert.ok(validate("receipt", { ...okReceipt(), type: "review" }).length > 0, "P1: type review no longer exists");
});

// ---------------------------------------------------------------------------
// Shape-specific cases
// ---------------------------------------------------------------------------

const packetFile = () => ({ path: "src/a.js", side: "head", oid: OID, ranges: [[1, 10]], range_hmac: SHA256 });

test("packet kind scope requires empty subject_ids; subject requires ≥1", () => {
  const base = { files: [packetFile()], policy_sha256: SHA256_B };
  assert.deepEqual(validate("packet", { ...base, kind: "scope", subject_ids: [] }), []);
  assert.ok(validate("packet", { ...base, kind: "scope", subject_ids: [SHA256] }).length > 0);
  assert.deepEqual(validate("packet", { ...base, kind: "subject", subject_ids: [SHA256] }), []);
  assert.ok(validate("packet", { ...base, kind: "subject", subject_ids: [] }).length > 0);
  assert.ok(validate("packet", { ...base, subject_ids: [] }).length > 0, "kind is required");
  assert.ok(validate("packet", { ...base, kind: "fix", subject_ids: [] }).length > 0);
  assert.ok(validate("packet", { ...base, kind: "scope", subject_ids: [], files: [{ ...packetFile(), side: "working" }] }).length > 0);
});

const okFinding = () => ({
  id: SHA256,
  title: "SQL built from request input",
  class: "injection",
  priority: "p1",
  confidence: 7,
  path: "src/db.js",
  side: "head",
  lines: [10, 14],
  state: "CITATION_VERIFIED",
  occurrence: 0,
  source: { kind: "agent", ref: SHA256_B, index: 0 },
  snippet: "db.query(`select * from t where id=${req.query.id}`)",
});

test("finding: exactly one of snippet/snippet_redacted/context_redacted", () => {
  assert.deepEqual(validate("finding", okFinding()), []);
  const { snippet, ...none } = okFinding();
  assert.ok(validate("finding", none).length > 0, "none of the three");
  assert.deepEqual(validate("finding", { ...none, snippet_redacted: "x" }), []);
  assert.deepEqual(validate("finding", { ...none, context_redacted: "x" }), []);
  assert.ok(validate("finding", { ...none, snippet, snippet_redacted: "x" }).length > 0, "two of the three");
  assert.ok(validate("finding", { ...none, snippet, snippet_redacted: "x", context_redacted: "y" }).length > 0);
  // bounds and enums
  assert.ok(validate("finding", { ...okFinding(), confidence: 11 }).length > 0);
  assert.ok(validate("finding", { ...okFinding(), confidence: -1 }).length > 0);
  assert.ok(validate("finding", { ...okFinding(), lines: [0, 3] }).length > 0, "start >= 1");
  assert.ok(validate("finding", { ...okFinding(), lines: [3] }).length > 0);
  assert.ok(validate("finding", { ...okFinding(), cwe: "CWE-89" }).length === 0);
  assert.ok(validate("finding", { ...okFinding(), cwe: "89" }).length > 0);
  assert.ok(validate("finding", { ...okFinding(), state: "REVIEW_CONFIRMED" }).length > 0, "state enum is CITATION_* only");
  assert.ok(validate("finding", { ...okFinding(), class: "other" }).length > 0);
});

test("claim = finding minus id/state/occurrence/source, plus occurrence_hint; claims and claimed name their scope", () => {
  const { id, state, occurrence, source, ...claim } = okFinding();
  assert.deepEqual(validate("claim", claim), []);
  assert.deepEqual(validate("claim", { ...claim, occurrence_hint: 2 }), []);
  for (const key of ["id", "state", "occurrence", "source"]) {
    assert.ok(validate("claim", { ...claim, [key]: okFinding()[key] }).length > 0, `claim with ${key} fails`);
  }
  assert.deepEqual(forbiddenKeys({ ...claim, id: SHA256 }), ["id"]);
  assert.deepEqual(validate("claims", { scope_sha256: SHA256, packet_sha256: SHA256_B, findings: [claim] }), []);
  assert.ok(validate("claims", { scope_sha256: SHA256, findings: [claim] }).length > 0, "claims must name their scope packet (TL-15)");
  assert.deepEqual(validate("claimed", { scope_sha256: SHA256, findings: [okFinding()] }), []);
  assert.ok(validate("claimed", { scope_sha256: SHA256, findings: [claim] }).length > 0, "claimed carries full findings");
});

const okEngagement = () => ({
  engagement_id: "eng-2026-09",
  slug: "acme-shop",
  scope_paths: ["src/"],
  product_paths: ["src/", "package.json"],
  targets: { tracker: ["github.com"], browser: ["staging.example.com:8443"], repo: "acme/shop" },
});

test("engagement: artifact_policy.private is rejected", () => {
  assert.deepEqual(validate("engagement", okEngagement()), []);
  const ok = { ...okEngagement(), artifact_policy: { ledger: "local", runs: "committed", register: "committed" } };
  assert.deepEqual(validate("engagement", ok), []);
  const errs = validate("engagement", { ...okEngagement(), artifact_policy: { private: "committed" } });
  assert.ok(errs.length > 0);
  assert.match(errs[0], /artifact_policy.*private/);
  assert.ok(validate("engagement", { ...okEngagement(), artifact_policy: { runs: "public" } }).length > 0);
  // hosts: no scheme, no path
  assert.ok(validate("engagement", { ...okEngagement(), targets: { ...okEngagement().targets, tracker: ["https://github.com"] } }).length > 0);
  assert.ok(validate("engagement", { ...okEngagement(), targets: { ...okEngagement().targets, browser: ["a.example.com/path"] } }).length > 0);
  // execute_project_tests.argv needs at least one token; sign_off enum closed
  assert.ok(validate("engagement", { ...okEngagement(), execute_project_tests: { argv: [] } }).length > 0);
  assert.deepEqual(validate("engagement", { ...okEngagement(), execute_project_tests: { argv: ["npm", "test"], timeout_s: 300, install: { argv: ["npm", "ci"], allow_tracked_changes: false } } }), []);
  assert.deepEqual(validate("engagement", { ...okEngagement(), sign_off: { require_dispositions: "executed-or-ticketed" } }), []);
  assert.ok(validate("engagement", { ...okEngagement(), sign_off: { require_dispositions: "some" } }).length > 0);
  assert.ok(validate("engagement", { ...okEngagement(), slug: "Acme Shop" }).length > 0);
});

test("verify: verdict pattern is the closed token grammar", () => {
  const v = fixture("verify", "ok");
  const withVerdict = (verdict) => ({ ...v, evaluation: { ...v.evaluation, verdict } });
  for (const good of [
    "VERIFIED", "REGRESSED", "UNVERIFIED-REFOUND", "UNVERIFIED-NOT-COMMITTED", "UNVERIFIED-TESTS-FAILED",
    "UNVERIFIED-NO-TEST-SURFACE", "UNVERIFIED-INDETERMINATE(fix-review)", "UNVERIFIED-INDETERMINATE(tests)",
    "UNVERIFIED-SUPPRESSION(deletion-only)", "UNVERIFIED-SUPPRESSION(2 unacked)",
  ]) assert.deepEqual(validate("verify", withVerdict(good)), [], good);
  for (const bad of ["VERIFIED-ISH", "UNVERIFIED-INDETERMINATE()", "UNVERIFIED-SUPPRESSION(unacked)", "UNGATED", "verified", ""]) {
    assert.ok(validate("verify", withVerdict(bad)).length > 0, bad);
  }
  assert.deepEqual(validate("verify", { ...v, tested_tree: "same-as-head" }), []);
  assert.deepEqual(validate("verify", { ...v, tested_tree: SHA256 }), []);
  assert.ok(validate("verify", { ...v, tested_tree: "same-as-base" }).length > 0);
  assert.ok(validate("verify", { ...v, evaluation: { ...v.evaluation, events: [{ event: "regression-observed", payload: { verify_sha256: SHA256 } }] } }).length > 0, "evaluate() payloads are empty");
});

test("register: statuses, events and approvals are the closed vocabularies; approvals are never authenticated", () => {
  const proj = fixture("register", "ok");
  assert.deepEqual(validate("register", proj), []);
  const row = Object.values(proj.rows)[0];
  assert.ok(validate("register", { ...proj, rows: { "R-0001": { ...row, status: "confirmed" } } }).length > 0);
  assert.ok(validate("register", { ...proj, rows: { "R-0001": { ...row, acceptance: { ...row.acceptance, authenticated: true } } } }).length > 0);
  assert.ok(validate("register", { ...proj, rows: { "row-1": row } }).length > 0, "row keys are R-nnnn");
  const ev = fixture("register-event", "ok");
  assert.deepEqual(validate("register-event", ev), []);
  assert.ok(validate("register-event", { ...ev, event: "confirm" }).length > 0);
  assert.deepEqual(validate("register-event", { ...ev, event: "ticketed", payload: { ticket_url: "https://github.com/x/y/issues/1", import_sha256: SHA256 } }), []);
  assert.deepEqual(validate("register-snapshot", fixture("register-snapshot", "ok")), []);
  assert.deepEqual(validate("finding-alias", fixture("finding-alias", "ok")), []);
});

test("admission: receipt_sha256 required iff admitted-reviewed", () => {
  const a = fixture("admission", "ok");
  const { receipt_sha256, ...heuristic } = { ...a, classification: "admitted-heuristic" };
  assert.deepEqual(validate("admission", heuristic), []);
  assert.ok(validate("admission", { ...heuristic, receipt_sha256: SHA256 }).length > 0, "heuristic must not name a receipt");
  assert.deepEqual(validate("admission", { ...heuristic, classification: "admitted-reviewed", receipt_sha256: SHA256 }), []);
  assert.ok(validate("admission", { ...heuristic, classification: "admitted-reviewed" }).length > 0, "reviewed must name a receipt");
  assert.deepEqual(validate("admission", { ...heuristic, classification: "proposal" }), []);
});

// ---------------------------------------------------------------------------
// Table-driven fixtures
// ---------------------------------------------------------------------------

test("every shape above has a fixture that validates and a mutated fixture that fails", () => {
  assert.ok(SCHEMA_NAMES.length >= 35, `expected every shape to be addressable, got ${SCHEMA_NAMES.length}`);
  for (const name of SCHEMA_NAMES) {
    const okPath = join(FIXTURES, `${name}.ok.json`);
    const badPath = join(FIXTURES, `${name}.bad.json`);
    assert.ok(existsSync(okPath), `missing fixture ${name}.ok.json`);
    assert.ok(existsSync(badPath), `missing fixture ${name}.bad.json`);
    const ok = readJson(okPath);
    assert.deepEqual(validate(name, ok), [], `${name}.ok.json must validate`);
    const bad = readJson(badPath);
    assert.ok(validate(name, bad).length > 0, `${name}.bad.json must fail`);
    // programmatic mutations of the ok fixture: an unknown key fails everywhere ...
    assert.ok(validate(name, { ...ok, __unknown_key__: 1 }).length > 0, `${name}: unknown root key must fail`);
    // ... and dropping any required root key fails.
    const entry = entryOf(name);
    for (const key of entry.required ?? []) {
      const { [key]: _drop, ...rest } = ok;
      assert.ok(validate(name, rest).length > 0, `${name}: dropping ${key} must fail`);
    }
  }
  // every schema file is addressable by its own name
  for (const file of schemaFiles()) {
    assert.ok(SCHEMA_NAMES.includes(file.replace(/\.schema\.json$/, "")), `${file} not in SCHEMA_NAMES`);
  }
  // every alias resolves to a def that exists
  for (const [alias, target] of Object.entries(SCHEMA_ALIASES)) {
    const root = loadSchema(alias);
    if (target.def) assert.ok(root.$defs?.[target.def], `${alias} → ${target.file}#/$defs/${target.def} missing`);
  }
});

// ---------------------------------------------------------------------------
// Validator behaviour
// ---------------------------------------------------------------------------

test("unsupported keyword throws", () => {
  // A schema that uses a keyword outside the subset must fail loud at load,
  // not silently accept every value.
  const load = (schema) => loadSchema({ name: "inline-test", schema });
  assert.throws(() => load({ type: "object", additionalProperties: false, properties: { a: { type: "string", minLength: 1 } } }), (e) => e instanceof SchemaError && /minLength/.test(e.message));
  assert.throws(() => load({ type: "number" }), (e) => e instanceof SchemaError && /number/.test(e.message));
  assert.throws(() => load({ type: ["string", "null"] }), SchemaError);
  assert.throws(() => load({ allOf: [{ type: "string" }] }), (e) => e instanceof SchemaError && /allOf/.test(e.message));
  assert.throws(() => load({ anyOf: [{ type: "string" }] }), SchemaError);
  assert.throws(() => load({ type: "object", additionalProperties: true }), (e) => e instanceof SchemaError && /additionalProperties/.test(e.message));
  assert.throws(() => load({ type: "object", additionalProperties: { type: "string" } }), SchemaError);
  assert.throws(() => load({ $ref: "other.schema.json#/$defs/X" }), (e) => e instanceof SchemaError && /\$ref/.test(e.message));
  assert.throws(() => load({ $ref: "#/$defs/Missing" }), (e) => e instanceof SchemaError && /Missing/.test(e.message));
  assert.throws(() => load({ type: "object", additionalProperties: false, properties: { a: { $defs: {} } } }), SchemaError);
  assert.throws(() => load({ type: "string", pattern: "(" }), SchemaError);
  assert.throws(() => validate("no-such-schema", {}), (e) => e instanceof SchemaError && /no-such-schema/.test(e.message));
  assert.deepEqual([...SUPPORTED_KEYWORDS].sort(), [
    "$ref", "additionalProperties", "const", "enum", "items", "maxItems", "maximum", "minItems", "minimum",
    "oneOf", "pattern", "patternProperties", "properties", "required", "type",
  ]);
});

test("validator: types, enum, const, bounds, pattern, patternProperties, oneOf exactly-one, error paths", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["n", "s", "arr", "map", "either"],
    properties: {
      n: { type: "integer", minimum: 0, maximum: 10 },
      s: { type: "string", pattern: "^[a-z]+$" },
      b: { type: "boolean" },
      z: { type: "null" },
      e: { type: "string", enum: ["x", "y"] },
      c: { const: 1 },
      arr: { type: "array", minItems: 1, maxItems: 2, items: { type: "integer" } },
      map: { type: "object", additionalProperties: false, patternProperties: { "^R-[0-9]{4}$": { type: "integer" } } },
      either: { type: "string", oneOf: [{ pattern: "^a" }, { const: "b" }] },
      ref: { $ref: "#/$defs/Inner" },
    },
    $defs: { Inner: { type: "object", additionalProperties: false, required: ["k"], properties: { k: { type: "string" } } } },
  };
  const s = loadSchema({ name: "inline-behaviour", schema });
  const v = (value) => validate(s, value);
  const good = { n: 3, s: "abc", arr: [1], map: { "R-0001": 1 }, either: "abc" };
  assert.deepEqual(v(good), []);
  assert.deepEqual(v({ ...good, b: true, z: null, e: "x", c: 1, ref: { k: "v" } }), []);
  assert.match(v({ ...good, n: 3.5 })[0], /^\$\.n: expected integer/);
  assert.match(v({ ...good, n: -1 })[0], /^\$\.n: .*minimum 0/);
  assert.match(v({ ...good, n: 11 })[0], /^\$\.n: .*maximum 10/);
  assert.match(v({ ...good, s: "ABC" })[0], /^\$\.s: .*pattern/);
  assert.match(v({ ...good, b: "true" })[0], /^\$\.b: expected boolean/);
  assert.match(v({ ...good, z: 0 })[0], /^\$\.z: expected null/);
  assert.match(v({ ...good, e: "q" })[0], /^\$\.e: .*enum/);
  assert.match(v({ ...good, c: 2 })[0], /^\$\.c: .*const/);
  assert.match(v({ ...good, arr: [] })[0], /^\$\.arr: .*minItems 1/);
  assert.match(v({ ...good, arr: [1, 2, 3] })[0], /^\$\.arr: .*maxItems 2/);
  assert.match(v({ ...good, arr: [1, "2"] })[0], /^\$\.arr\[1\]: expected integer/);
  assert.match(v({ ...good, arr: "nope" })[0], /^\$\.arr: expected array/);
  assert.match(v({ ...good, map: { "R-1": 1 } })[0], /^\$\.map: .*"R-1"/);
  assert.match(v({ ...good, map: { "R-0001": "1" } })[0], /^\$\.map\["R-0001"\]: expected integer/);
  assert.deepEqual(v({ ...good, either: "b" }), []);
  assert.match(v({ ...good, either: "c" })[0], /^\$\.either: .*exactly one.*matched 0/);
  assert.deepEqual(v({ ...good, either: "ab" }), []);
  assert.match(v({ ...good, ref: { k: 1 } })[0], /^\$\.ref\.k: expected string/);
  assert.match(v({ ...good, ref: {} })[0], /^\$\.ref: missing required "k"/);
  assert.match(v({ ...good, extra: 1 })[0], /^\$: unknown key "extra"/);
  const { n, ...missing } = good;
  assert.match(v(missing)[0], /^\$: missing required "n"/);
  assert.match(v("str")[0], /^\$: expected object/);
  assert.match(v(null)[0], /^\$: expected object/);
  assert.match(v([])[0], /^\$: expected object/);
  // exactly-one: two matching alternatives is a failure
  const two = loadSchema({ name: "inline-two", schema: { type: "string", oneOf: [{ pattern: "^a" }, { pattern: "b$" }] } });
  assert.deepEqual(validate(two, "axxx"), []);
  assert.match(validate(two, "ab")[0], /matched 2/);
  // every error is a string and multiple errors are all reported
  const errs = v({ n: "x", s: 1, arr: [], map: {}, either: 1, extra: true });
  assert.ok(errs.length >= 5 && errs.every((e) => typeof e === "string"));
});

test("leaf module: imports only node:fs/node:path/node:url", () => {
  const imports = [...SELF.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const spec of imports) assert.ok(["node:fs", "node:path", "node:url"].includes(spec), `unexpected import ${spec}`);
  assert.ok(!/\bchild_process\b|\bfetch\(|node:http|node:net|node:dns/.test(SELF));
});
