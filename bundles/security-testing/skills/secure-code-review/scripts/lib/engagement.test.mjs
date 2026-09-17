import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EngagementError, TEMPLATE_ENGAGEMENT_ID, readEngagement, stDir } from "./engagement.mjs";

const VALID = { engagement_id: "acme-2026-09", slug: "acme", scope_paths: ["src/", "lib/util.js"] };

function rootWith(block) {
  const root = mkdtempSync(join(tmpdir(), "st-eng-"));
  if (block === undefined) return root;
  mkdirSync(stDir(root), { recursive: true });
  const body = typeof block === "string" ? block : JSON.stringify(block, null, 2);
  writeFileSync(join(stDir(root), "engagement.md"), `# Security engagement\n\nProse above the block.\n\n\`\`\`json engagement\n${body}\n\`\`\`\n\nProse below.\n`);
  return root;
}

function tokenOf(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof EngagementError, `expected EngagementError, got ${err && err.name}: ${err && err.message}`);
    assert.equal(err.name, "EngagementError");
    return err.token;
  }
  assert.fail("expected a throw");
}

test("stDir is <root>/.agents/security-testing", () => {
  assert.equal(stDir("/x/y"), join("/x/y", ".agents", "security-testing"));
});

test("a root without engagement.md is ENGAGEMENT-MISSING", () => {
  assert.equal(tokenOf(() => readEngagement(rootWith(undefined))), "ENGAGEMENT-MISSING");
});

test("the template sentinel is EDIT-ENGAGEMENT-AND-RERUN", () => {
  assert.equal(TEMPLATE_ENGAGEMENT_ID, "my-product-2026-09");
  const root = rootWith({ ...VALID, engagement_id: "my-product-2026-09" });
  assert.equal(tokenOf(() => readEngagement(root)), "EDIT-ENGAGEMENT-AND-RERUN");
});

test("a block missing scope_paths is ENGAGEMENT-INVALID(scope_paths)", () => {
  const { scope_paths: _drop, ...rest } = VALID;
  assert.equal(tokenOf(() => readEngagement(rootWith(rest))), "ENGAGEMENT-INVALID(scope_paths)");
});

test("every field is validated and the token names the field", () => {
  const cases = [
    [{ ...VALID, engagement_id: "" }, "ENGAGEMENT-INVALID(engagement_id)"],
    [{ ...VALID, slug: "Acme Corp" }, "ENGAGEMENT-INVALID(slug)"],
    [{ ...VALID, slug: "-acme" }, "ENGAGEMENT-INVALID(slug)"],
    [{ ...VALID, scope_paths: [] }, "ENGAGEMENT-INVALID(scope_paths)"],
    [{ ...VALID, scope_paths: ["/etc"] }, "ENGAGEMENT-INVALID(scope_paths)"],
    [{ ...VALID, scope_paths: ["src/../../x"] }, "ENGAGEMENT-INVALID(scope_paths)"],
    [{ ...VALID, scope_paths: ["src\\win"] }, "ENGAGEMENT-INVALID(scope_paths)"],
    [{ ...VALID, product_paths: "src/" }, "ENGAGEMENT-INVALID(product_paths)"],
    [{ ...VALID, targets: { browser: ["http://a.example"] } }, "ENGAGEMENT-INVALID(targets.browser)"],
    [{ ...VALID, targets: "x" }, "ENGAGEMENT-INVALID(targets)"],
    [{ ...VALID, base_url: 7 }, "ENGAGEMENT-INVALID(base_url)"],
    [{ ...VALID, execute_project_tests: { argv: [] } }, "ENGAGEMENT-INVALID(execute_project_tests.argv)"],
    [{ ...VALID, execute_project_tests: { argv: "npm test" } }, "ENGAGEMENT-INVALID(execute_project_tests.argv)"],
    [{ ...VALID, execute_project_tests: [] }, "ENGAGEMENT-INVALID(execute_project_tests)"],
  ];
  for (const [block, token] of cases) assert.equal(tokenOf(() => readEngagement(rootWith(block))), token, JSON.stringify(block));
});

test("a file without a json engagement block, or with unparsable json, is ENGAGEMENT-INVALID", () => {
  const noBlock = mkdtempSync(join(tmpdir(), "st-eng-"));
  mkdirSync(stDir(noBlock), { recursive: true });
  writeFileSync(join(stDir(noBlock), "engagement.md"), "# nothing fenced here\n```json\n{}\n```\n");
  assert.equal(tokenOf(() => readEngagement(noBlock)), "ENGAGEMENT-INVALID(block)");
  assert.equal(tokenOf(() => readEngagement(rootWith("{ not json"))), "ENGAGEMENT-INVALID(json)");
  assert.equal(tokenOf(() => readEngagement(rootWith("[1]"))), "ENGAGEMENT-INVALID(json)");
});

test("a valid file parses; optional fields are undefined when omitted", () => {
  const root = rootWith(VALID);
  const { record, path } = readEngagement(root);
  assert.equal(path, join(stDir(root), "engagement.md"));
  assert.equal(record.slug, "acme");
  assert.equal(record.engagement_id, "acme-2026-09");
  assert.deepEqual(record.scope_paths, ["src/", "lib/util.js"]);
  assert.equal(record.execute_project_tests, undefined);
  assert.equal(record.product_paths, undefined);
  assert.equal(record.targets, undefined);
  assert.equal(record.base_url, undefined);
});

test("the full shape round-trips, and only the first json engagement block counts", () => {
  const full = { ...VALID, product_paths: ["src/"], targets: { browser: ["app.example.com", "localhost"] }, base_url: "https://app.example.com", execute_project_tests: { argv: ["npm", "test"] } };
  const root = rootWith(JSON.stringify(full) + "\n```\n\n```json engagement\n{\"engagement_id\":\"other\"}");
  const { record } = readEngagement(root);
  assert.deepEqual(record, full);
  assert.deepEqual(record.execute_project_tests.argv, ["npm", "test"]);
});
