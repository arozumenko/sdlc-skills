// Shared parser for a SKILL.md's `name:` frontmatter field.
//
// Two callers must agree on exactly what "the name" is, or they silently
// drift apart:
//   - bin/init.mjs (installExternalSkill) uses it to name the directory an
//     external skill installs into.
//   - bin/validate-factories.mjs (--check-externals) uses it to verify a
//     skills.json `repo:` entry's `id` matches what upstream actually
//     declares — the exact value the installer will use as the directory
//     name. If this parser is hardened/changed in only one importer, the
//     guard stops predicting the installer's real behavior.
// Both import this one implementation instead of keeping their own copies
// of the regex in sync by hand.
//
// Contract (both callers depend on all three clauses):
//   1. The `name:` is read *only* from the leading `---` frontmatter block.
//      A `name:` elsewhere in the body — inside a fenced code block, an
//      example, a prose line — is not the skill's name and must not be
//      picked up. A document with no leading frontmatter block yields null.
//   2. An empty or whitespace-only value (`name:`, `name: ""`, `name: '  '`)
//      yields null, not "". This matters because the two callers test the
//      result differently: init.mjs tests truthiness (and falls back to the
//      registry id) while validate-factories.mjs tests `=== null` (and reports
//      "no name: frontmatter"). Returning "" would make them disagree about
//      the same document; returning null makes them agree by construction.
//   3. The returned name is trimmed and stripped of one layer of surrounding
//      quotes. It is NOT otherwise sanitized — callers that turn it into a
//      filesystem path must validate it themselves (init.mjs rejects any
//      value that is not a bare path segment).
export function extractSkillMdName(text) {
  // Leading (unanchored-by-/m) `---` block only, tolerating a UTF-8 BOM.
  // Same frontmatter shape bin/validate-factories.mjs's parseFrontmatter uses.
  const fm = String(text).match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  // `[ \t]*`, not `\s*`: `\s` matches newlines, so `\s*` on a bare `name:`
  // line would skip past the line break and capture the *next* key's value.
  const m = fm[1].match(/^name:[ \t]*(.*)$/m);
  if (!m) return null;
  const name = m[1].trim().replace(/^["']|["']$/g, "").trim();
  return name === "" ? null : name;
}
