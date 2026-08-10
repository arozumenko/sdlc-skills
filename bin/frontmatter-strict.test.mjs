// Guard: SKILL.md / AGENT.md frontmatter must stay parseable by STRICT YAML
// parsers, not just Claude Code's lenient line-based reader.
//
// Field incident (2026-08-06): GitHub Copilot CLI failed to load two skills —
// "failed to parse YAML frontmatter: mapping values are not allowed in this
// context" — because an unquoted top-level scalar contained ": " (colon+space),
// which strict YAML reads as an illegal nested mapping. Claude Code loaded the
// same files fine, so nothing caught it. This test encodes the narrow rule
// without adding a YAML dependency (the repo is stdlib-only): an unquoted
// plain scalar value must not contain ": ", and a value that opens with a
// quote must close it on the same line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function collectFiles() {
  const files = [];
  const push = (dir, name) => {
    const p = join(dir, name);
    if (existsSync(p)) files.push(p);
  };
  const scanGroups = (base) => {
    for (const kind of ['skills', 'agents']) {
      const dir = join(base, kind);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) push(join(dir, entry.name), kind === 'skills' ? 'SKILL.md' : 'AGENT.md');
      }
    }
  };
  scanGroups(ROOT);
  const bundlesDir = join(ROOT, 'bundles');
  for (const b of readdirSync(bundlesDir, { withFileTypes: true })) {
    if (b.isDirectory()) scanGroups(join(bundlesDir, b.name));
  }
  return files;
}

// Values that open a YAML structure or a non-plain scalar are exempt from the
// plain-scalar rule; everything else must survive a strict parser as one line.
const NON_PLAIN_OPENERS = ['"', "'", '[', '{', '>', '|', '&', '*'];

function checkFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(m, `${file}: no frontmatter block`);
  const problems = [];
  m[1].split(/\r?\n/).forEach((line, i) => {
    const kv = line.match(/^([A-Za-z][\w-]*):(?:\s+(.*))?$/); // top-level keys only (no indent)
    if (!kv || kv[2] === undefined || kv[2] === '') return;
    const value = kv[2];
    const opener = value[0];
    if (NON_PLAIN_OPENERS.includes(opener)) {
      if ((opener === '"' || opener === "'") && !(value.length > 1 && value.endsWith(opener))) {
        problems.push(`line ${i + 2}: '${kv[1]}' opens a ${opener}-quoted scalar but doesn't close it on the same line`);
      }
      return;
    }
    const idx = value.indexOf(': ');
    if (idx !== -1) {
      problems.push(
        `line ${i + 2}: '${kv[1]}' is an unquoted scalar containing ": " at value offset ${idx} ` +
        `("…${value.slice(Math.max(0, idx - 20), idx + 20)}…") — strict YAML reads this as a nested ` +
        `mapping and the skill fails to load on hosts with a real YAML parser (e.g. Copilot CLI). ` +
        `Wrap the whole value in double quotes.`
      );
    }
  });
  return problems;
}

test('every SKILL.md / AGENT.md frontmatter survives a strict YAML parser', () => {
  const files = collectFiles();
  assert.ok(files.length >= 50, `expected to find the repo's skills/agents, got ${files.length} files`);
  const failures = [];
  for (const file of files) {
    const problems = checkFrontmatter(readFileSync(file, 'utf8'), file);
    for (const p of problems) failures.push(`${file.slice(ROOT.length + 1)} — ${p}`);
  }
  assert.deepEqual(failures, [], `strict-YAML frontmatter violations:\n${failures.join('\n')}`);
});
