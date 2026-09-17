// prose.test.mjs — the assertions that pin the bundle's prose (agents,
// skills, references, briefings) to the contracts the scripts enforce.
// One file for Tasks 9–12; every assertion group is its own test() so a
// later task extends the file without touching an earlier group. Task 9
// owns: secure-code-review (SKILL.md, references/), security-reviewer
// (AGENT.md, SOUL.md, RULES.md, the briefing) and the no-placeholder sweep.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const B = new URL("./", import.meta.url).pathname;
const read = (p) => readFileSync(join(B, p), "utf8");
/** Scalar frontmatter keys of a Markdown file (the subset the agent files use). */
const fm = (text) =>
  Object.fromEntries(
    text
      .split("\n---")[0]
      .split("\n")
      .slice(1)
      .filter((l) => /^[a-z-]+:/.test(l))
      .map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
  );

const SKILL = "skills/secure-code-review";
const AGENT = "agents/security-reviewer";
const CONTRACTS = ["review", "vulnerability-review", "mitigation-review", "fix-review"];

// ---------------------------------------------------------------- Task 9: security-reviewer

test("security-reviewer frontmatter and contracts", () => {
  const a = read(`${AGENT}/AGENT.md`);
  const f = fm(a);
  assert.equal(f.name, "security-reviewer");
  assert.equal(f.model, "sonnet");
  assert.equal(f.skills, "[memory, secure-code-review]");
  assert.equal(f["skills-on-demand"], "[systematic-debugging]");
  assert.equal(f["context-docs"], "security-testing/engagement.md security-testing/knowledge/finding-schema.md");
  assert.ok(!("tools" in f) && !("mcpServers" in f), "no tools:, no mcpServers (bundles/SPEC.md)");
  for (const c of CONTRACTS) assert.match(a, new RegExp(`### \`${c}\``), c);
  for (const cmd of ["cite.mjs show", "cite.mjs check", "second-<id>.json", "findings.json"]) assert.ok(a.includes(cmd), cmd);
  for (const banned of ["packet", "receipt", "security-evidence", "gate --claims", "normalised line"]) assert.ok(!a.toLowerCase().includes(banned), banned);
  assert.match(a, /never writes? .*`id`.*`state`.*`verdict`/i);
  assert.match(a, /fresh dispatch/i);
  assert.ok(a.split("\n").length <= 200, "AGENT.md stays within 200 lines");
});

test("security-reviewer return lines, the fix loop and the second-opinion hash rule", () => {
  const a = read(`${AGENT}/AGENT.md`);
  for (const line of ["REVIEW_WRITTEN findings=<n>", "SECOND_WRITTEN <id> <assertion>", "FIX_REVIEW_WRITTEN <id> <not-refound|refound>"]) assert.ok(a.includes(line), line);
  assert.match(a, /REFUSED agent-written key/, "the stamped-file edit refusal is named");
  assert.match(a, /check_stamp/, "the agent knows which keys check writes");
  assert.match(a, /exactly as it is on disk after the lead'?s `?check`?/i, "findings_sha256 = the stamped file as on disk");
  assert.match(a, /40-hex/i, "second-<id>.json oid is the full oid");
  assert.match(a, /restart/i, "a verify restart does not undo the register event");
});

test("security-reviewer SOUL.md, RULES.md and briefing carry no dropped-pipeline vocabulary", () => {
  const soul = read(`${AGENT}/SOUL.md`);
  const rules = read(`${AGENT}/RULES.md`);
  const brief = read("briefings/security-reviewer.md");
  for (const [name, text] of [["SOUL.md", soul], ["RULES.md", rules], ["briefing", brief]]) {
    for (const banned of [/packet/i, /receipt/i, /security-evidence/i, /\bgate\b/i, /normalised line/i, /worktree/i]) assert.ok(!banned.test(text), `${name}: ${banned}`);
  }
  assert.match(soul, /^# Soul/m);
  assert.match(rules, /^# Rules/m);
  assert.ok(rules.split("\n").filter((l) => /^\d+\. \*\*/.test(l)).length >= 4, "RULES.md lists the four roster rules as numbered bullets");
  const bf = fm(brief);
  assert.equal(bf.name, "Project briefing");
  assert.equal(bf.type, "project");
  assert.match(brief, /^## Project Knowledge/m);
  assert.match(brief, /^## My Role Focus/m);
  assert.ok(brief.split("\n").length <= 40, "briefing stays near 30 lines");
});

// ---------------------------------------------------------------- Task 9: secure-code-review

test("secure-code-review SKILL.md names the shapes and the result lines", () => {
  const s = read(`${SKILL}/SKILL.md`);
  assert.match(s, /^description: "Use when /m);
  assert.match(s, /^name: secure-code-review$/m);
  for (const t of ["CHECK verified=", "FAILED", "COVERAGE examined=", "SECOND", "STALE-REVIEW", "VERDICT", "PENDING-REVIEW"]) assert.ok(s.includes(t), t);
  assert.ok(s.length < 12000, "SKILL.md stays under ~250 lines");
  assert.ok(s.split("\n").length <= 250, "SKILL.md ≤ 250 lines");
});

test("secure-code-review SKILL.md quotes the real command spellings and every spec §6 token", () => {
  const s = read(`${SKILL}/SKILL.md`);
  const help = (script) => spawnSync(process.execPath, [join(B, SKILL, "scripts", script), "--help"], { encoding: "utf8" }).stdout.trimEnd();
  assert.ok(s.includes(help("cite.mjs")), "cite.mjs --help pasted verbatim");
  assert.ok(s.includes(help("verify.mjs")), "verify.mjs --help pasted verbatim");
  assert.ok(s.includes("verify.mjs --finding <id> --review <dir> --head <oid> [--assertion not-refound|refound --by <session>]"), "the real verify synopsis");
  const tokens = [
    "WROTE", "EDIT-ENGAGEMENT-AND-RERUN", "TRACKED", "IGNORE-BLOCK", "INIT ok", "SHOW", "REFUSED agent-written key", "DIRTY-SCOPE", "FAILED(", "VERIFIED",
    "SECOND", "STALE-REVIEW", "COVERAGE examined=", "TM-INVALID", "MODEL elements=", "CHECK verified=", "TABLES sha256=", "REDACTED", "USAGE(", "ENGAGEMENT-MISSING",
    "ENGAGEMENT-INVALID", "GIT-ERROR", "CORRUPT", "NOT-AT-HEAD", "DIRTY", "UNVERIFIED-NOT-A-FIX", "UNVERIFIED-NO-TEST-SURFACE", "UNVERIFIED-DELETION-ONLY",
    "UNVERIFIED-TESTS-FAILED", "UNVERIFIED-REFOUND", "ADVISORY", "PENDING-REVIEW", "NEXT: dispatch security-reviewer fix-review", "REGISTER: skipped", "VERDICT",
  ];
  for (const t of tokens) assert.ok(s.includes(t), t);
  assert.match(s, /\.gitignore/, "the one unredacted write is named");
  assert.match(s, /--skills security-testing\/secure-code-review/, "standalone use");
  for (const banned of ["packet", "receipt", "security-evidence", "gate --claims", "normalised line"]) assert.ok(!s.toLowerCase().includes(banned), banned);
});

test("taxonomy.md ships exactly 15 class ids and the references carry no dropped-pipeline vocabulary", () => {
  const tax = read(`${SKILL}/references/taxonomy.md`);
  const ids = tax.split("\n").filter((l) => /^\| `[a-z-]+` \|/.test(l)).map((l) => l.split("|")[1].trim().replace(/`/g, ""));
  assert.equal(ids.length, 15, ids.join(","));
  assert.equal(new Set(ids).size, 15, "ids are unique");
  for (const f of ["taxonomy.md", "refutation-criteria.md", "do-not-flag.md", "findings-shape.md"]) {
    const t = read(`${SKILL}/references/${f}`);
    for (const banned of [/packet/i, /receipt/i, /security-evidence/i, /\bgate\b/i, /claims file/i, /normalised line/i, /verify\.mjs all/i, /ingest sarif/i]) assert.ok(!banned.test(t), `${f}: ${banned}`);
  }
  const shape = read(`${SKILL}/references/findings-shape.md`);
  for (const k of ["findings_sha256", "second-<id>.json", "\"examined\"", "\"citations\"", "check_stamp", "snippet_redacted"]) assert.ok(shape.includes(k), k);
});

test("the standalone install ships the engagement template and cite.mjs init finds it", () => {
  const skillCopy = read(`${SKILL}/references/engagement.md.template`);
  assert.equal(skillCopy, read("knowledge/engagement.md.template"), "byte-identical to knowledge/engagement.md.template");
  // A one-skill install: <root>/.claude/skills/secure-code-review/ with no knowledge/ anywhere.
  const root = mkdtempSync(join(tmpdir(), "prose-standalone-"));
  const git = (...argv) => spawnSync("git", argv, { cwd: root, encoding: "utf8", shell: false });
  git("init", "-q");
  const installed = join(root, ".claude", "skills", "secure-code-review");
  mkdirSync(installed, { recursive: true });
  cpSync(join(B, SKILL, "scripts"), join(installed, "scripts"), { recursive: true });
  cpSync(join(B, SKILL, "references"), join(installed, "references"), { recursive: true });
  const r = spawnSync(process.execPath, [join(installed, "scripts", "cite.mjs"), "init"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("WROTE .agents/security-testing/engagement.md"), r.stdout);
  assert.ok(r.stdout.includes("EDIT-ENGAGEMENT-AND-RERUN"), r.stdout);
  assert.equal(readFileSync(join(root, ".agents/security-testing/engagement.md"), "utf8"), skillCopy);
});

// ---------------------------------------------------------------- placeholders

/** Every Markdown / JSON file under the bundle, recursively (fixtures and eval runs included). */
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.(md|json|template)$/.test(name)) out.push(abs);
  }
  return out;
}

/** Files Task 9 owns; Tasks 10–12 extend the list as they replace their placeholders. */
const OWNED = [
  `${AGENT}/AGENT.md`,
  `${AGENT}/SOUL.md`,
  `${AGENT}/RULES.md`,
  "briefings/security-reviewer.md",
  `${SKILL}/SKILL.md`,
  `${SKILL}/references/taxonomy.md`,
  `${SKILL}/references/refutation-criteria.md`,
  `${SKILL}/references/do-not-flag.md`,
  `${SKILL}/references/findings-shape.md`,
  `${SKILL}/references/engagement.md.template`,
];

/** The Task 1 stub phrasings: a line that opens with "Placeholder", or "replaced / written in Task N". ("placeholder secrets" in do-not-flag.md is prose, not a stub.) */
const STUB = [/^Placeholder\b/m, /(replaced|written) in Task \d/i, /^description: placeholder/m];

test("no 'Placeholder' / 'replaced in Task' text remains in the files Task 9 owns", () => {
  for (const rel of OWNED) {
    assert.ok(existsSync(join(B, rel)), `${rel} exists`);
    const t = read(rel);
    for (const re of STUB) assert.ok(!re.test(t), `${rel}: ${re}`);
  }
  // The sweep the later tasks widen: every file under the skill and agent directories Task 9 owns.
  for (const abs of [...walk(join(B, SKILL)), ...walk(join(B, AGENT))]) {
    const t = readFileSync(abs, "utf8");
    for (const re of STUB) assert.ok(!re.test(t), `${abs}: ${re}`);
  }
});
