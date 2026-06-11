import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildItemIndex, resolveItem, catalogIds, itemKnown } from "./item-resolver.mjs";

// Build a throwaway repo tree: an orphan agent/skill at top level, plus two
// bundles that each own a "scout" agent and a "memory" skill.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ir-"));
  const A = (p) => { mkdirSync(join(root, p), { recursive: true }); writeFileSync(join(root, p, "AGENT.md"), "x"); };
  const S = (p) => { mkdirSync(join(root, p), { recursive: true }); writeFileSync(join(root, p, "SKILL.md"), "x"); };
  A("agents/personal-assistant");            // orphan agent
  S("skills/deep-research");                 // orphan skill
  mkdirSync(join(root, "bundles/alpha"), { recursive: true }); writeFileSync(join(root, "bundles/alpha/bundle.json"), "{}");
  mkdirSync(join(root, "bundles/beta"), { recursive: true }); writeFileSync(join(root, "bundles/beta/bundle.json"), "{}");
  A("bundles/alpha/agents/scout");
  A("bundles/beta/agents/scout");
  S("bundles/beta/skills/memory");
  return root;
}

test("buildItemIndex finds orphans and bundle items", () => {
  const root = fixture();
  const idx = buildItemIndex(root);
  assert.deepEqual(catalogIds(idx, "agents"), ["personal-assistant", "scout"]);
  assert.deepEqual(catalogIds(idx, "skills"), ["deep-research", "memory"]);
  rmSync(root, { recursive: true, force: true });
});

test("resolveItem: orphan resolves to top-level root", () => {
  const root = fixture();
  const idx = buildItemIndex(root);
  const r = resolveItem(idx, "agents", "personal-assistant");
  assert.equal(r.dir, root);
  assert.equal(r.bundle, null);
  assert.deepEqual(r.ambiguousAcross, []);
  rmSync(root, { recursive: true, force: true });
});

test("resolveItem: multi-bundle id picks alphabetical-first bundle + reports ambiguity", () => {
  const root = fixture();
  const idx = buildItemIndex(root);
  const r = resolveItem(idx, "agents", "scout");
  assert.equal(r.bundle, "alpha");
  assert.equal(r.dir, join(root, "bundles/alpha"));
  assert.deepEqual(r.ambiguousAcross, ["alpha", "beta"]);
  rmSync(root, { recursive: true, force: true });
});

test("resolveItem: qualified bundle/name selects that bundle", () => {
  const root = fixture();
  const idx = buildItemIndex(root);
  const r = resolveItem(idx, "agents", "beta/scout");
  assert.equal(r.bundle, "beta");
  assert.equal(r.dir, join(root, "bundles/beta"));
  rmSync(root, { recursive: true, force: true });
});

test("resolveItem: unknown id and unknown qualified bundle return null", () => {
  const root = fixture();
  const idx = buildItemIndex(root);
  assert.equal(resolveItem(idx, "agents", "nope"), null);
  assert.equal(resolveItem(idx, "agents", "alpha/memory"), null); // memory is a skill, not an alpha agent
  rmSync(root, { recursive: true, force: true });
});

test("itemKnown reflects resolvability", () => {
  const root = fixture();
  const idx = buildItemIndex(root);
  assert.equal(itemKnown(idx, "skills", "memory"), true);
  assert.equal(itemKnown(idx, "skills", "beta/memory"), true);
  assert.equal(itemKnown(idx, "skills", "ghost"), false);
  rmSync(root, { recursive: true, force: true });
});
