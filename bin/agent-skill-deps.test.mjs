import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inferSkillsFromAgents, loadSkillRegistry } from "./init.mjs";
import { buildItemIndex, catalogIds } from "./lib/item-resolver.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("a bundle-owned agent's declared skills are inferred from its bundle copy", () => {
  const index = buildItemIndex(ROOT);
  const skills = catalogIds(index, "skills");
  const registry = loadSkillRegistry();
  const { monorepo } = inferSkillsFromAgents(["scout"], skills, registry, index);
  // scout (bundle-owned) declares these; before the fix the list was empty.
  for (const s of ["seeding-a-project", "memory", "session-retrospective"]) {
    assert.ok(monorepo.includes(s), `expected scout dep "${s}" to resolve, got: ${monorepo.join(", ")}`);
  }
});

test("an orphan agent's declared skills still resolve from top-level", () => {
  const index = buildItemIndex(ROOT);
  const skills = catalogIds(index, "skills");
  const registry = loadSkillRegistry();
  // personal-assistant is the top-level orphan agent; it must still resolve (non-empty result).
  const { monorepo, external } = inferSkillsFromAgents(["personal-assistant"], skills, registry, index);
  assert.ok(monorepo.length + external.length > 0, "personal-assistant should declare at least one resolvable skill");
});
