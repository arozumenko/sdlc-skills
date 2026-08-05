// Shared parser for a SKILL.md's `name:` frontmatter field.
//
// Two callers must agree on exactly what "the name" is, or they silently
// drift apart:
//   - bin/init.mjs (installExternalSkill) uses it to name the directory an
//     external skill installs into.
//   - bin/validate-bundles.mjs (--check-externals) uses it to verify a
//     skills.json `repo:` entry's `id` matches what upstream actually
//     declares — the exact value the installer will use as the directory
//     name. If this parser is hardened/changed in only one importer, the
//     guard stops predicting the installer's real behavior.
// Both import this one implementation instead of keeping their own copies
// of the regex in sync by hand.
export function extractSkillMdName(text) {
  const m = text.match(/^name:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}
