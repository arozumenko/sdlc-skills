// TASK-007 — engagement record parser + knowledge templates.
// Verification cases named in plan §5 (G3 / TASK-007), plus the shape
// guarantees the template and the two other knowledge files must hold so
// TASK-011 (ensureTemplates) and TASK-008 (engagement init step 1) can rely
// on them without re-checking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseEngagementMd,
  defaultRecord,
  findEngagementBlock,
  ENGAGEMENT_FILE,
  KNOWLEDGE_FILES,
  TEMPLATE_DIR,
  TEMPLATE_PATHS,
} from "./engagement.mjs";
import { CliError } from "./exit.mjs";
import { loadSchema, validate } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, "..", "..");
const BUNDLE = resolve(SKILL, "..", "..");
const REPO = resolve(BUNDLE, "..", "..");
const SELF = readFileSync(join(HERE, "engagement.mjs"), "utf8");

const template = () => readFileSync(TEMPLATE_PATHS["engagement.md.template"], "utf8");

/** Wrap a JSON text in a `json engagement` fence with a line of prose around it. */
const md = (jsonText, { tag = "json engagement", fence = "```" } = {}) =>
  `# Engagement\n\nSome prose.\n\n${fence}${tag}\n${jsonText}\n${fence}\n\nMore prose.\n`;

const validJson = () => JSON.stringify(defaultRecord(), null, 2);

/** Assert `fn` throws a CliError with `code` whose token starts with `prefix`. Returns the error. */
function assertCli(fn, code, prefix) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected a throw");
  assert.ok(caught instanceof CliError, `expected CliError, got ${caught.name}: ${caught.message}`);
  assert.equal(caught.code, code);
  assert.ok(caught.token.startsWith(prefix), `token ${JSON.stringify(caught.token)} should start with ${prefix}`);
  assert.equal(caught.message, caught.token);
  return caught;
}

// ---------------------------------------------------------------------------
// Named verification cases

test("template parses and validates", () => {
  const record = parseEngagementMd(template());
  assert.deepEqual(validate("engagement", record), []);
  assert.equal(typeof record.engagement_id, "string");
  assert.deepEqual(record, defaultRecord());
});

test("duplicate key in block rejected", () => {
  const text = md('{"engagement_id": "a", "engagement_id": "b"}');
  const err = assertCli(() => parseEngagementMd(text), 2, "ENGAGEMENT-INVALID(");
  assert.match(err.token, /duplicate key/);
});

test("missing block ⇒ ENGAGEMENT-INVALID", () => {
  const err = assertCli(() => parseEngagementMd("# Engagement\n\nNo block here.\n"), 2, "ENGAGEMENT-INVALID(");
  assert.match(err.token, /json engagement/);
  // A plain ```json fence without the `engagement` tag is not the record.
  assertCli(() => parseEngagementMd(md(validJson(), { tag: "json" })), 2, "ENGAGEMENT-INVALID(");
});

test("targets hosts must be bare hostnames", () => {
  for (const bad of ["https://github.com", "github.com/acme", "GitHub.com", "host name", "", "github.com:port"]) {
    const rec = defaultRecord();
    rec.targets.tracker = [bad];
    const err = assertCli(() => parseEngagementMd(md(JSON.stringify(rec))), 2, "ENGAGEMENT-INVALID(");
    assert.match(err.token, /targets\.tracker\[0\]/, `${JSON.stringify(bad)} must be named in the error`);
  }
  for (const good of ["github.com", "jira.example.internal:8443", "localhost:3000", "10.0.0.7"]) {
    const rec = defaultRecord();
    rec.targets.browser = [good];
    assert.deepEqual(parseEngagementMd(md(JSON.stringify(rec))).targets.browser, [good]);
  }
});

test("artifact_policy.private ⇒ POLICY-INVALID(private)", () => {
  const rec = defaultRecord();
  rec.artifact_policy.private = "committed";
  const err = assertCli(() => parseEngagementMd(md(JSON.stringify(rec))), 2, "POLICY-INVALID(private)");
  assert.equal(err.token, "POLICY-INVALID(private)");
  // Even `local` is refused: `private` is not a policy key at all (TL-13).
  rec.artifact_policy.private = "local";
  assertCli(() => parseEngagementMd(md(JSON.stringify(rec))), 2, "POLICY-INVALID(private)");
  // And the check wins over schema validation when both would fail.
  delete rec.slug;
  assertCli(() => parseEngagementMd(md(JSON.stringify(rec))), 2, "POLICY-INVALID(private)");
});

// ---------------------------------------------------------------------------
// Block extraction edge cases

test("block extraction: tolerates CRLF, indentation up to three spaces, longer fences and ~~~", () => {
  const json = validJson();
  assert.deepEqual(parseEngagementMd(md(json).replaceAll("\n", "\r\n")), defaultRecord());
  assert.deepEqual(parseEngagementMd(md(json, { fence: "````" })), defaultRecord());
  assert.deepEqual(parseEngagementMd(md(json, { fence: "~~~" })), defaultRecord());
  assert.deepEqual(parseEngagementMd(`   \`\`\`json engagement\n${json}\n   \`\`\`\n`), defaultRecord());
  assert.deepEqual(parseEngagementMd(`\`\`\` json   engagement \n${json}\n\`\`\`\n`), defaultRecord());
});

test("block extraction: two blocks, unterminated fence, non-object payload ⇒ ENGAGEMENT-INVALID", () => {
  const json = validJson();
  const two = md(json) + md(json);
  assert.match(assertCli(() => parseEngagementMd(two), 2, "ENGAGEMENT-INVALID(").token, /more than one/);
  const open = `\`\`\`json engagement\n${json}\n`;
  assert.match(assertCli(() => parseEngagementMd(open), 2, "ENGAGEMENT-INVALID(").token, /unterminated/);
  assert.match(assertCli(() => parseEngagementMd(md("[1, 2]")), 2, "ENGAGEMENT-INVALID(").token, /expected object/);
  assert.match(assertCli(() => parseEngagementMd(md("")), 2, "ENGAGEMENT-INVALID(").token, /empty/);
  assert.match(assertCli(() => parseEngagementMd(md('{"a": 1.5}')), 2, "ENGAGEMENT-INVALID(").token, /float/);
  // A mismatched closing fence (~~~ for ```) does not close the block.
  const mixed = `\`\`\`json engagement\n${json}\n~~~\n`;
  assert.match(assertCli(() => parseEngagementMd(mixed), 2, "ENGAGEMENT-INVALID(").token, /unterminated/);
});

test("findEngagementBlock returns the block text and 1-based line numbers", () => {
  const found = findEngagementBlock(md('{"x": 1}'));
  assert.deepEqual(found, { text: '{"x": 1}', startLine: 6, endLine: 6 });
  assert.equal(findEngagementBlock("nothing"), null);
});

test("schema errors are all named in the token, in order", () => {
  const rec = defaultRecord();
  delete rec.slug;
  rec.targets.tracker = ["https://x"];
  const err = assertCli(() => parseEngagementMd(md(JSON.stringify(rec))), 2, "ENGAGEMENT-INVALID(");
  assert.match(err.token, /missing required "slug"/);
  assert.match(err.token, /targets\.tracker\[0\]/);
  assert.ok(err.token.indexOf("slug") < err.token.indexOf("tracker"));
  assert.ok(err.token.endsWith(")"));
});

test("parseEngagementMd accepts bytes as well as text and rejects other inputs", () => {
  assert.deepEqual(parseEngagementMd(Buffer.from(template(), "utf8")), defaultRecord());
  assert.throws(() => parseEngagementMd(42), TypeError);
  assert.throws(() => parseEngagementMd(null), TypeError);
});

test("CliError has the lib/exit.mjs shape: (code, token), name, message = token", () => {
  const err = new CliError(2, "ENGAGEMENT-MISSING");
  assert.equal(err.code, 2);
  assert.equal(err.token, "ENGAGEMENT-MISSING");
  assert.equal(err.message, "ENGAGEMENT-MISSING");
  assert.equal(err.name, "CliError");
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// defaultRecord() and the template block

test("defaultRecord returns a fresh deep copy every call", () => {
  const a = defaultRecord();
  const b = defaultRecord();
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  a.targets.tracker.push("evil.example");
  assert.deepEqual(defaultRecord(), b);
  assert.deepEqual(validate("engagement", b), []);
});

test("template block carries every key of the engagement schema, including optional ones", () => {
  const schema = loadSchema("engagement");
  const record = parseEngagementMd(template());
  const missing = [];
  const walk = (node, value, path) => {
    if (!node.properties) return;
    for (const [key, sub] of Object.entries(node.properties)) {
      if (!(key in value)) {
        missing.push(`${path}.${key}`);
        continue;
      }
      if (sub.type === "object" && value[key] && typeof value[key] === "object") walk(sub, value[key], `${path}.${key}`);
    }
  };
  walk(schema, record, "$");
  assert.deepEqual(missing, []);
});

test("template documents the defaults the spec fixes", () => {
  const text = template();
  const record = parseEngagementMd(text);
  // require_dispositions default (spec §6.10) is what the example carries.
  assert.equal(record.sign_off.require_dispositions, "executed-or-ticketed");
  assert.match(text, /executed-or-ticketed/);
  // Every artifact_policy key present and `local` (plan TASK-007).
  const policyKeys = Object.keys(loadSchema("engagement").properties.artifact_policy.properties);
  assert.deepEqual(Object.keys(record.artifact_policy).sort(), [...policyKeys].sort());
  assert.ok(Object.values(record.artifact_policy).every((v) => v === "local"));
  // `private` is documented as never a policy key (TL-13).
  assert.match(text, /private/);
  assert.match(text, /POLICY-INVALID\(private\)/);
  // The engagement.md machine record is the one `json engagement` block (TL-5).
  assert.match(text, /json engagement/);
});

test("template documents scope_paths / product_paths as the assessment cleanliness-check paths (D18 / P6)", () => {
  const text = template();
  assert.match(text, /scope_paths/);
  assert.match(text, /product_paths/);
  assert.match(text, /DIRTY-TREE/);
  assert.match(text, /clean/i);
  // The bundle's own managed paths are excluded from that check (P6).
  assert.match(text, /\.agents\/security-testing/);
  assert.match(text, /reports\/security\//);
  assert.match(text, /tasks\/security-\*\//);
  // And the baseline observation covers the same union (§6.9 step 4).
  assert.match(text, /baseline/i);
});

test("template documents targets as bare hostnames and execute_project_tests as the only argv source", () => {
  const text = template();
  assert.match(text, /bare hostname/i);
  assert.match(text, /execute_project_tests/);
  assert.match(text, /allow_tracked_changes/);
  assert.match(text, /timeout_s/);
  assert.match(text, /600/);
});

// ---------------------------------------------------------------------------
// Knowledge files: locations, copies, dupes pairing

test("TEMPLATE_PATHS names exactly the three knowledge files, each an absolute path that exists", () => {
  assert.deepEqual(KNOWLEDGE_FILES, ["engagement.md.template", "finding-schema.md", "report-reading-guide.md"]);
  assert.deepEqual(Object.keys(TEMPLATE_PATHS), [...KNOWLEDGE_FILES]);
  assert.equal(TEMPLATE_DIR, join(SKILL, "templates", "knowledge"));
  for (const [name, path] of Object.entries(TEMPLATE_PATHS)) {
    assert.ok(path.startsWith("/"), `${name}: ${path} not absolute`);
    assert.equal(basename(path), name);
    assert.equal(dirname(path), TEMPLATE_DIR);
    assert.ok(existsSync(path), `${path} missing`);
  }
  assert.ok(Object.isFrozen(TEMPLATE_PATHS));
  assert.ok(Object.isFrozen(KNOWLEDGE_FILES));
  assert.equal(ENGAGEMENT_FILE, "engagement.md");
});

test("bundle knowledge/ and skill templates/knowledge/ copies are byte-identical and paired in check-skill-dupes", () => {
  const dupes = readFileSync(join(REPO, "bin", "check-skill-dupes.mjs"), "utf8");
  for (const name of KNOWLEDGE_FILES) {
    const canonical = `bundles/security-testing/knowledge/${name}`;
    const copy = `bundles/security-testing/skills/security-evidence/templates/knowledge/${name}`;
    assert.ok(existsSync(join(REPO, canonical)), `${canonical} missing`);
    assert.ok(existsSync(join(REPO, copy)), `${copy} missing`);
    assert.ok(readFileSync(join(REPO, canonical)).equals(readFileSync(join(REPO, copy))), `${name} drifted`);
    assert.ok(dupes.includes(`"${canonical}"`), `${canonical} not in GROUPS`);
    assert.ok(dupes.includes(`"${copy}"`), `${copy} not in GROUPS`);
    assert.equal(join(REPO, copy), TEMPLATE_PATHS[name]);
  }
});

test("finding-schema.md renders every Finding key and every state / verdict token", () => {
  const text = readFileSync(TEMPLATE_PATHS["finding-schema.md"], "utf8");
  const finding = loadSchema("finding").$defs.Finding;
  for (const key of Object.keys(finding.properties)) assert.ok(text.includes(`\`${key}\``), `Finding key ${key} not rendered`);
  for (const cls of finding.properties.class.enum) assert.ok(text.includes(`\`${cls}\``), `class ${cls} missing`);
  for (const token of [
    "CITATION_VERIFIED",
    "CITATION_FAILED",
    "REVIEW_CONFIRMED",
    "REVIEW_REFUTED",
    "REVIEW_INDETERMINATE",
    "MITIGATION_CONFIRMED",
    "MITIGATION_GAP",
    "MITIGATION_INDETERMINATE",
    "VERIFIED",
    "REGRESSED",
    "UNVERIFIED-REFOUND",
    "UNVERIFIED-NOT-COMMITTED",
    "UNVERIFIED-TESTS-FAILED",
    "UNVERIFIED-NO-TEST-SURFACE",
    "UNVERIFIED-INDETERMINATE(",
    "UNVERIFIED-SUPPRESSION(",
    "UNVERIFIED-REFUTED-FINDING",
  ]) {
    assert.ok(text.includes(token), `token ${token} missing from finding-schema.md`);
  }
  // Agents assert, scripts derive (G-7): the doc must say so.
  assert.match(text, /never write.*\bid\b|never.*\bids?\b.*state|scripts derive/i);
  // No forbidden strings (G-13).
  assert.doesNotMatch(text, /UNGATED|exact checkout/);
});

test("report-reading-guide.md explains every check token and the ORIGIN line", () => {
  const text = readFileSync(TEMPLATE_PATHS["report-reading-guide.md"], "utf8");
  for (const token of [
    "CONSISTENT",
    "CONSISTENT-REDACTED-ONLY(",
    "INCONSISTENT(",
    "STRUCTURE-ONLY",
    "CURRENT",
    "CITATION-DRIFTED(",
    "SCOPE-DRIFTED(",
    "ORIGIN: unauthenticated",
    "ORIGIN: matches supplied digest",
    "KEY: available",
    "KEY: unavailable",
    "INCOMPLETE(COMMITTED)",
    "--integrity",
    "--drift",
    "--trusted-digest",
    "VERIFIED-DERIVATIVE",
    "LINKED-ONLY",
    "MISMATCH(output)",
  ]) {
    assert.ok(text.includes(token), `token ${token} missing from report-reading-guide.md`);
  }
  // Consistency, not provenance (D2): the guide must say what ORIGIN does not prove.
  assert.match(text, /not.*(prove|proof|provenance|who)/i);
  assert.match(text, /authenticated: false|unauthenticated/);
  assert.doesNotMatch(text, /UNGATED|exact checkout/);
});

// ---------------------------------------------------------------------------
// Guardrails on the module itself

test("engagement.mjs imports only canon, schema and node:path/url — no fs writes, no child process, no network, no clock", () => {
  const imports = [...SELF.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]).sort();
  // ./exit.mjs and ./tokens.mjs are TASK-006's; they become allowed (and required) once they exist — see the merge tripwire below.
  assert.deepEqual(imports.filter((i) => i !== "./exit.mjs" && i !== "./tokens.mjs"), ["../canon.mjs", "./schema.mjs", "node:path", "node:url"]);
  assert.doesNotMatch(SELF, /node:child_process|node:http|node:net|node:dns|\bfetch\(|Date\.now|new Date\(/);
  assert.doesNotMatch(SELF, /writeFileSync|appendFileSync|console\.log/);
  assert.doesNotMatch(SELF, /UNGATED|exact checkout/);
});

// ---------------------------------------------------------------------------
// TASK-006 merge tripwire. TASK-006 (same group G3) owns lib/exit.mjs (CliError)
// and lib/tokens.mjs (result strings, G-13). Until they exist this module
// carries a shape-identical CliError and formats its two tokens inline; the
// moment they exist the shim MUST go, or the dispatcher's `instanceof CliError`
// mapping misses ours and ENGAGEMENT-INVALID / POLICY-INVALID exit 1 instead
// of 2. This test turns that TODO into a red suite at merge time.

test("merge tripwire: once lib/exit.mjs exists, CliError is imported from it and the local shim is gone", () => {
  const definesShim = /^export class CliError\b/m.test(SELF);
  const importsExit = /^import \{[^}]*\bCliError\b[^}]*\} from "\.\/exit\.mjs";$/m.test(SELF);
  if (existsSync(join(HERE, "exit.mjs"))) {
    assert.ok(importsExit, "lib/exit.mjs exists: engagement.mjs must `import { CliError } from \"./exit.mjs\"`");
    assert.ok(!definesShim, "lib/exit.mjs exists: drop the local `export class CliError` shim (two classes ⇒ instanceof mismatch ⇒ exit 1)");
  } else {
    assert.ok(definesShim && !importsExit, "lib/exit.mjs absent: keep the local shim until TASK-006 lands");
  }
});

test("merge tripwire: once lib/tokens.mjs exists, no result token is formatted inline (G-13)", () => {
  if (!existsSync(join(HERE, "tokens.mjs"))) return;
  assert.ok(/from "\.\/tokens\.mjs";$/m.test(SELF), "lib/tokens.mjs exists: engagement.mjs must take its tokens from it");
  assert.doesNotMatch(SELF, /["`]ENGAGEMENT-INVALID\(|["`]POLICY-INVALID\(/, "ENGAGEMENT-INVALID / POLICY-INVALID must be lib/tokens.mjs rows, not inline strings");
});
