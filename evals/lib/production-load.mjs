#!/usr/bin/env node
// Make an installed workspace look like a role that has been working on a
// project for months: a large memory index with topic files, a project rule in
// the role's RULES.md, and a recent lesson appended at the END of the index
// (memory is written chronologically, so the newest lessons sit last).
//
//   node production-load.mjs <workspace> <role> --rule "<text>" --lesson "<text>" [--entries 120]
//
// The memory text is generic and deterministic (no randomness), so runs are
// comparable. Sizes are chosen to match what long-running roles accumulate:
// a hook payload of roughly 25-40 KB before any cap.

import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TOPICS = [
  ["build", "the build", "a cached build output"],
  ["ci", "the CI pipeline", "a skipped CI job"],
  ["fixtures", "test fixtures", "a fixture that drifted from production data"],
  ["flaky", "timing-sensitive tests", "a test that depends on wall-clock time"],
  ["evidence", "QA evidence", "a screenshot taken before the fix was deployed"],
  ["api", "the HTTP API", "an endpoint returning a stale cached body"],
  ["db", "the database", "a migration applied to the wrong database"],
  ["review", "code review", "a finding fixed on one call site only"],
  ["release", "the release process", "a version bump left out of the changelog"],
  ["env", "environment config", "a default value masking a missing variable"],
  ["logging", "logging", "a log line that leaked a request body"],
  ["perf", "performance checks", "a benchmark run on a cold cache"],
];

const VERBS = [
  "Always confirm", "Never assume", "Re-check", "Record", "Before sign-off, verify",
  "Do not trust", "Prefer an explicit check of", "Write down",
];

function entry(i) {
  const [slug, area, trap] = TOPICS[i % TOPICS.length];
  const verb = VERBS[(i * 7) % VERBS.length];
  const name = `${slug}_${String(i).padStart(3, "0")}`;
  const hook = `${verb} ${area} state after changes — seen ${trap} hide a real failure (case ${i}); check it directly instead of inferring it from a green summary.`;
  return { name, line: `- [${slug} lesson ${i}](${name}.md) — ${hook}\n`, body: `# ${slug} lesson ${i}\n\n${hook}\n\nWhy: it cost a re-verification round when it was missed.\nHow to apply: whenever ${area} is part of the change under test.\n` };
}

function parse(argv) {
  const [work, role, ...rest] = argv;
  const o = { work, role, entries: 120 };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--rule") o.rule = rest[++i];
    else if (rest[i] === "--lesson") o.lesson = rest[++i];
    else if (rest[i] === "--entries") o.entries = Number(rest[++i]);
    else throw new Error(`unknown argument: ${rest[i]}`);
  }
  if (!work || !role) throw new Error("usage: production-load.mjs <workspace> <role> [--rule t] [--lesson t] [--entries n]");
  return o;
}

const o = parse(process.argv.slice(2));
const mem = join(o.work, ".agents", "memory", o.role);
mkdirSync(mem, { recursive: true });

let index = `# Memory index — ${o.role}\n\n`;
for (let i = 0; i < o.entries; i++) {
  const e = entry(i);
  index += e.line;
  writeFileSync(join(mem, `${e.name}.md`), e.body);
}
if (o.lesson) {
  index += `- [Most recent lesson](recent_lesson.md) — ${o.lesson}\n`;
  writeFileSync(join(mem, "recent_lesson.md"), `# Most recent lesson\n\n${o.lesson}\n`);
}
writeFileSync(join(mem, "MEMORY.md"), index);

if (o.rule) {
  const rules = join(o.work, ".claude", "agents", o.role, "RULES.md");
  if (!existsSync(rules)) throw new Error(`missing ${rules}`);
  appendFileSync(rules, `\n## Project rule\n\n${o.rule}\n`);
}
console.log(`seeded ${o.entries} memory entries for ${o.role} (${index.length} chars of index)`);
