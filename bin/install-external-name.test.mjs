import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isBarePathSegment } from "./init.mjs";
import { extractSkillMdName } from "./lib/skill-md.mjs";

// installExternalSkill names the installed directory from the upstream
// SKILL.md's `name:` field — content from a third-party repo cloned at a
// moving ref. That value becomes a path segment, and on `--update` the
// resulting path is passed to rmSync(recursive, force). `path.join`
// normalizes, so an unguarded traversal in `name:` escapes the install root
// entirely. isBarePathSegment is the guard; these tests pin its contract.

test("isBarePathSegment: accepts ordinary skill directory names", () => {
  for (const name of ["tdd", "compose-ui-testing-patterns", "swiftui_pro", "skill.v2", "a"]) {
    assert.equal(isBarePathSegment(name), true, `expected ${name} to be accepted`);
  }
});

test("isBarePathSegment: rejects parent-directory traversal", () => {
  for (const name of ["../../../../tmp/pwned", "../x", "..", "a/../../b"]) {
    assert.equal(isBarePathSegment(name), false, `expected ${name} to be rejected`);
  }
});

test("isBarePathSegment: rejects absolute paths and any embedded separator", () => {
  for (const name of ["/etc/passwd", "/tmp/pwned", "nested/skill", "a\\b", "..\\..\\win"]) {
    assert.equal(isBarePathSegment(name), false, `expected ${name} to be rejected`);
  }
});

test("isBarePathSegment: rejects the path specials, empties, NUL, and non-strings", () => {
  for (const name of [".", "..", "", "a\0b", null, undefined, 42, {}]) {
    assert.equal(isBarePathSegment(name), false, `expected ${JSON.stringify(name)} to be rejected`);
  }
});

// The concrete escape this guard exists to stop: join() silently resolves the
// traversal, so without the guard the "install directory" is outside the
// project entirely — and rmSync would be pointed at it on --update.
test("isBarePathSegment: rejects the value that demonstrably escapes the skills dir via join()", () => {
  const skillsDir = "/proj/.claude/skills";
  const malicious = "../../../../tmp/pwned";
  assert.equal(join(skillsDir, malicious), "/tmp/pwned", "join() normalizes the traversal — this is the escape");
  assert.equal(isBarePathSegment(malicious), false);
  // With the guard the installer falls back to the registry id, which always
  // stays inside the skills dir.
  assert.equal(join(skillsDir, "some-skill").startsWith(`${skillsDir}/`), true);
});

// End-to-end over the two units the installer actually composes: a hostile
// upstream SKILL.md parses to a traversal string, and the guard rejects it.
test("a hostile upstream SKILL.md name is parsed faithfully but rejected by the guard", () => {
  const hostile = "---\nname: ../../../../tmp/pwned\ndescription: evil\n---\n";
  const parsed = extractSkillMdName(hostile);
  assert.equal(parsed, "../../../../tmp/pwned", "the parser does not sanitize — that is the caller's job");
  assert.equal(isBarePathSegment(parsed), false, "the caller's guard must reject it");
});
