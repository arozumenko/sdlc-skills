// TASK-043 — the `handoff` publication profile (plan §5 TASK-043; spec §9.2
// "Hand-off prompt (profile `handoff`)", §6.9 "handoff (case paths +
// base_url only)"; US-035 AC-3, US-038 AC-3). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE, PROFILE_VERSION, apply, promptFile, promptLines } from "./handoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (slug = "my-product", base_url = "https://staging.example.com") => Object.freeze({ run_id: "a".repeat(12) + "-0001", engagement: { payload: { slug, base_url } }, admissions: [], cases: [] });

test("the §9.2 prompt is exactly two lines, from the engagement's slug and base_url unless opts override them", () => {
  assert.equal(PROFILE, "handoff");
  assert.ok(Number.isInteger(PROFILE_VERSION) && PROFILE_VERSION >= 1);
  assert.deepEqual(promptLines("my-product", "https://staging.example.com"), [
    "Run as the active agent (claude --agent test-run-lead):",
    '"Run the suite at tasks/security-my-product-admitted/ against base_url=https://staging.example.com."',
  ]);
  const outputs = apply(source(), null, {});
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].relpath, "my-product.md");
  assert.equal(promptFile("my-product"), "my-product.md");
  assert.equal(outputs[0].bytes.toString("utf8"), 'Run as the active agent (claude --agent test-run-lead):\n"Run the suite at tasks/security-my-product-admitted/ against base_url=https://staging.example.com."\n');
  const over = apply(source(), null, { slug: "other", base_url: "https://qa.example.com:8443" });
  assert.equal(over[0].relpath, "other.md");
  assert.match(over[0].bytes.toString("utf8"), /tasks\/security-other-admitted\/ against base_url=https:\/\/qa\.example\.com:8443\.\"\n$/);
  assert.equal(apply(source(), null, {})[0].bytes.toString("utf8"), outputs[0].bytes.toString("utf8"), "deterministic");
});

test("refusals: no base_url anywhere ⇒ TypeError naming --base-url; a base_url that is not an absolute http(s) URL, or carries whitespace or a newline, is refused; a slug outside [a-z0-9-] is refused", () => {
  assert.throws(() => apply(source("my-product", null), null, {}), /--base-url/);
  assert.throws(() => apply(source(), null, { base_url: "staging.example.com" }), /http/);
  assert.throws(() => apply(source(), null, { base_url: "https://x.example.com/a b" }), /http/);
  assert.throws(() => apply(source(), null, { base_url: "https://x.example.com\n" }), /http/);
  assert.throws(() => apply(source(), null, { slug: "My Product" }), /slug/);
  assert.throws(() => promptLines("ok", 'https://x.example.com/"'), /quote/);
});

test("G-9: handoff.mjs imports no fs, child_process, git or clock; the output names no case path, no proposal and no run-directory path (spec §6.9: paths + base_url only)", () => {
  const src = readFileSync(join(HERE, "handoff.mjs"), "utf8");
  assert.doesNotMatch(src, /from "node:(fs|child_process|net|http|https|dns)"/);
  assert.doesNotMatch(src, /from "\.\.\/git\.mjs"/);
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/);
  const text = apply(source(), null, {})[0].bytes.toString("utf8");
  assert.ok(!text.includes("proposal") && !text.includes(".agents/") && !text.includes("TC-"));
});
