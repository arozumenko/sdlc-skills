// A factory's instructions.md can wrap stack-specific text in
// `<!-- roles: a b -->` … `<!-- /roles -->`. The installer keeps a section only
// when one of its roles is installed, so a Python-only project does not carry
// the iOS and Android rules in its always-loaded CLAUDE.md (solo, 2026-11-10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { filterRoleSections } from "./lib/factory-selection.mjs";
import { installedRoleNames, refreshInstalledFactoryBlocks } from "./init.mjs";

const BODY = [
  "# Team",
  "",
  "<!-- roles: python-dev js-dev -->",
  "## Web stack",
  "web rules",
  "<!-- /roles -->",
  "",
  "<!-- roles: android-dev -->",
  "## Android stack",
  "android rules",
  "<!-- /roles -->",
  "",
  "## Shared",
  "shared rules",
].join("\n");

test("keeps only sections whose roles are installed, and strips the markers", () => {
  const out = filterRoleSections(BODY, ["python-dev", "tech-lead"]);
  assert.match(out, /web rules/);
  assert.doesNotMatch(out, /android rules/);
  assert.match(out, /shared rules/);
  assert.doesNotMatch(out, /<!-- \/?roles/);
  assert.doesNotMatch(out, /\n{3,}/, "dropping a section leaves no blank-line pile-up");
});

test("unknown roster (null or empty) keeps every section: fail open", () => {
  for (const roles of [null, []]) {
    const out = filterRoleSections(BODY, roles);
    assert.match(out, /web rules/);
    assert.match(out, /android rules/);
    assert.doesNotMatch(out, /<!-- \/?roles/);
  }
});

test("an unclosed section is kept whole rather than eating the rest of the file", () => {
  const out = filterRoleSections("a\n<!-- roles: ios-dev -->\nios\nb", ["python-dev"]);
  assert.match(out, /ios/);
  assert.match(out, /b/);
});

test("the shipped feature-development instructions drop iOS/Android for a Python-only roster", () => {
  const src = readFileSync(new URL("../bundles/feature-development/instructions.md", import.meta.url), "utf8");
  const out = filterRoleSections(src, ["python-dev", "tech-lead", "project-manager", "qa-engineer"]);
  assert.match(out, /## Web stack/);
  assert.doesNotMatch(out, /## iOS stack/);
  assert.doesNotMatch(out, /## Android stack/);
  assert.doesNotMatch(out, /Not verified:/, "Android definition-of-done rule is gone");
  assert.match(out, /## Definition of done/);
  assert.match(out, /## Delivery tracking/);
  const all = filterRoleSections(src, null);
  assert.match(all, /## iOS stack/);
  assert.match(all, /Not verified:/);
});

test("--update refresh filters by the agents installed on disk", () => {
  const cwd = mkdtempSync(join(tmpdir(), "role-sections-"));
  mkdirSync(join(cwd, ".claude/agents/python-dev"), { recursive: true });
  writeFileSync(join(cwd, ".claude/agents/python-dev/AGENT.md"), "---\nname: python-dev\n---\n");
  assert.deepEqual(installedRoleNames(cwd), ["python-dev"]);
  writeFileSync(join(cwd, "CLAUDE.md"), "# CLAUDE\n\n<!-- FACTORY:feature-development START -->\nold\n<!-- FACTORY:feature-development END -->\n");
  refreshInstalledFactoryBlocks({ cwd });
  const text = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
  assert.match(text, /## Web stack/);
  assert.doesNotMatch(text, /## Android stack/);
});
