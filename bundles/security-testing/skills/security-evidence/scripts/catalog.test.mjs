// TASK-052 — catalog rows, marketplaces, final docs (US-046 AC-1…AC-3; plan
// §5 TASK-052; spec §10, §20). What this file pins: the root `README.md`
// factory table, `AGENTS.md` and `bundles/SPEC.md` "Current factories" each
// carry a `security-testing` row naming the three local agents and the six
// local skills with the §10 description sentence; the three generated
// marketplaces are current (`gen-marketplaces.mjs --check` exits 0) and list
// every security agent/skill exactly once; the hand-curated
// `.claude-plugin/marketplace.json` lists the nine once each in the shape of
// its existing entries; no catalog text says the forbidden phrase; and the
// bundle docs describe M3 (CHANGELOG entries, the `ingest` / `publish` rows
// of `security-evidence/SKILL.md`, the README's admitted-suite row).
// Everything is read as text — no Markdown parser (stdlib only, G-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_STRINGS } from "./lib/tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = resolve(HERE, "..", "..", "..");
const REPO_ROOT = resolve(BUNDLE_DIR, "..", "..");
const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");

const AGENTS = ["security-lead", "threat-modeler", "security-reviewer"];
const SKILLS = ["security-evidence", "security-engagement", "threat-modeling", "secure-code-review", "security-test-planning", "risk-register"];
const DESCRIPTION =
  "Threat-led, read-only security testing team: code-derived STRIDE threat model, evidence-gated secure code review with re-checkable citations, passive security cases for the manual-qa and test-automation bundles, fix verification from a validated test-start snapshot, and a residual-risk register.";
const GENERATED = [".cursor-plugin/marketplace.json", ".codex-plugin/marketplace.json", ".github/plugin/marketplace.json"];

/** The rows (arrays of trimmed cells) of every Markdown table in `text` whose first cell matches `first`. */
function rowsStartingWith(text, first) {
  const cells = (l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  return text.split("\n").filter((l) => /^\|/.test(l)).map(cells).filter((r) => r[0] === first);
}

// ---------------------------------------------------------------------------
// AC-1 — README.md, AGENTS.md, bundles/SPEC.md rows

test("README.md factory table has a security-testing row: three agents, six skills, the §10 sentence, install command, bundle README link", () => {
  const readme = read("README.md");
  const rows = rowsStartingWith(readme, "`security-testing`");
  assert.equal(rows.length, 1, "exactly one `security-testing` row in the README tables");
  const row = rows[0].join(" | ");
  for (const id of [...AGENTS, ...SKILLS]) assert.ok(row.includes(`\`${id}\``), `README row names \`${id}\``);
  assert.ok(row.includes(DESCRIPTION), "README row carries the §10 description sentence verbatim");
  assert.ok(row.includes("bundles/security-testing/README.md"), "README row cross-links the bundle README");
  assert.match(readme, /npx github:arozumenko\/sdlc-skills init --factory security-testing/, "README install command");
  assert.doesNotMatch(readme, /Four\s+ship today/, "the factory count sentence is updated");
  assert.match(readme, /Five\s+ship today/);
});

test("AGENTS.md consumer summary has a security-testing bullet naming the three agents", () => {
  const agents = read("AGENTS.md");
  const bullet = agents.split(/\n(?=- \*\*`)/).find((p) => p.startsWith("- **`security-testing`**"));
  assert.ok(bullet, "AGENTS.md bullet `security-testing`");
  for (const id of AGENTS) assert.ok(bullet.includes(id), `AGENTS.md bullet names ${id}`);
  assert.doesNotMatch(agents, /Four factories ship/);
  assert.match(agents, /Five factories ship/);
});

test("bundles/SPEC.md 'Current factories' table has a security-testing row naming the three agents and six skills", () => {
  const spec = read("bundles/SPEC.md");
  const start = spec.indexOf("\n## Current factories");
  assert.ok(start >= 0, "## Current factories");
  const section = spec.slice(start + 1, spec.indexOf("\n## ", start + 1) > 0 ? spec.indexOf("\n## ", start + 1) : undefined);
  const rows = rowsStartingWith(section, "`security-testing`");
  assert.equal(rows.length, 1, "one `security-testing` row under Current factories");
  const row = rows[0].join(" | ");
  for (const id of [...AGENTS, ...SKILLS]) assert.ok(row.includes(`\`${id}\``), `SPEC row names \`${id}\``);
});

// ---------------------------------------------------------------------------
// AC-2 — generated marketplaces current; every security agent/skill once

test("gen-marketplaces.mjs --check exits 0 (the three generated manifests are current)", async () => {
  const r = await new Promise((done) => {
    execFile(process.execPath, [join(REPO_ROOT, "bin", "gen-marketplaces.mjs"), "--check"], { cwd: REPO_ROOT, env: { PATH: process.env.PATH }, shell: false, encoding: "utf8" }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
  assert.equal(r.code, 0, `validate:marketplaces is stale:\n${r.stdout}${r.stderr}`);
});

test("generated marketplaces list each security agent (Cursor) and skill (all three) exactly once, sourced from bundles/security-testing", () => {
  for (const rel of GENERATED) {
    const m = JSON.parse(read(rel));
    const names = m.plugins.map((p) => p.name);
    const expected = rel.startsWith(".cursor-plugin") ? [...AGENTS, ...SKILLS] : SKILLS;
    for (const id of expected) {
      assert.equal(names.filter((n) => n === id).length, 1, `${id} appears exactly once in ${rel}`);
      const entry = m.plugins.find((p) => p.name === id);
      assert.equal(entry.source, `./bundles/security-testing/${AGENTS.includes(id) ? "agents" : "skills"}/${id}`, `${rel}: ${id} source`);
    }
    if (!rel.startsWith(".cursor-plugin")) for (const id of AGENTS) assert.ok(!names.includes(id), `${rel} carries skills only (no ${id})`);
  }
});

test(".claude-plugin/marketplace.json (hand-curated) lists the nine security entries once each, in the shape of its existing entries", () => {
  const m = JSON.parse(read(".claude-plugin/marketplace.json"));
  const names = m.plugins.map((p) => p.name);
  // The existing entries spell factory paths `./factories/<id>/…` (TASK-037 review note); follow them.
  const precedent = m.plugins.find((p) => p.name === "app-profiler");
  assert.equal(precedent.source, "./factories/manual-qa/agents/app-profiler", "precedent shape unchanged");
  for (const id of [...AGENTS, ...SKILLS]) {
    assert.equal(names.filter((n) => n === id).length, 1, `${id} appears exactly once in .claude-plugin/marketplace.json`);
    const entry = m.plugins.find((p) => p.name === id);
    assert.equal(entry.source, `./factories/security-testing/${AGENTS.includes(id) ? "agents" : "skills"}/${id}`, `${id} source`);
    assert.equal(entry.version, precedent.version, `${id} version matches the catalog`);
    assert.ok(typeof entry.description === "string" && entry.description.length > 20, `${id} has a description`);
  }
});

// ---------------------------------------------------------------------------
// AC-3 — no "exact checkout" in any catalog text

test("no catalog text says the forbidden phrase: README.md, AGENTS.md, bundles/SPEC.md, the four marketplaces", () => {
  const needle = FORBIDDEN_STRINGS[1];
  assert.equal(needle, "exact checkout");
  const offenders = ["README.md", "AGENTS.md", "bundles/SPEC.md", ".claude-plugin/marketplace.json", ...GENERATED].filter((rel) => read(rel).includes(needle));
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// Bundle docs sweep — CHANGELOG M2/M3, SKILL.md rows, README M3 wording

test("CHANGELOG.md carries M2 and M3 entries naming what landed", () => {
  const log = read("bundles/security-testing/CHANGELOG.md");
  assert.match(log, /^## .*M2/m, "an M2 heading");
  assert.match(log, /^## .*M3/m, "an M3 heading");
  for (const needle of ["tm-lint.mjs check", "render", "threat-modeler", "threat-modeling"]) assert.ok(log.includes(needle), `M2 entry names ${needle}`);
  for (const needle of ["plan.mjs admit", "propose", "ta-prompt", "publish --profile case", "handoff", "observations", "security-lead", "security-test-planning", "risk-register", "tracker-readback"]) {
    assert.ok(log.includes(needle), `M3 entry names ${needle}`);
  }
});

test("security-evidence SKILL.md: the ingest row spells TICKETED / READBACK (no register row); the publish row spells DEDUPE existing=<url>", () => {
  const skill = read("bundles/security-testing/skills/security-evidence/SKILL.md");
  const ingest = rowsStartingWith(skill, "`evidence.mjs ingest <kind> <file> --run <id> [--sent <ticket.json>]`");
  assert.equal(ingest.length, 1, "one ingest row");
  assert.ok(ingest[0].join(" | ").includes("`TICKETED <R-id> <url>`"), "ingest row spells `TICKETED <R-id> <url>`");
  assert.ok(ingest[0].join(" | ").includes("`READBACK: ok (no register row)`"), "ingest row spells `READBACK: ok (no register row)`");
  const publish = skill.split("\n").filter((l) => l.startsWith("| `evidence.mjs publish "));
  assert.equal(publish.length, 1, "one publish row");
  assert.ok(publish[0].includes("existing=<url>"), "publish row spells `existing=<url>`");
  assert.ok(!publish[0].includes("existing=<R-id>"), "publish row no longer says `existing=<R-id>`");
});

test("bundle README describes M3: no NOT-IMPLEMENTED(M3) / UNADMITTED: not evaluated; the admitted-suite row names the recorded identities; roster lists all three agents", () => {
  const readme = read("bundles/security-testing/README.md");
  assert.ok(!readme.includes("NOT-IMPLEMENTED(M3)"), "no NOT-IMPLEMENTED(M3)");
  assert.ok(!readme.includes("UNADMITTED: not evaluated"), "no `UNADMITTED: not evaluated`");
  assert.ok(!readme.includes("This release is M1"), "no M1 release banner");
  const row = readme.split("\n").find((l) => /^\| \*\*Only admitted cases are written to the hand-off suite/.test(l));
  assert.ok(row, "the admitted-suite Guarantees row");
  assert.match(row, /`publish --profile case`/);
  assert.match(row, /UNADMITTED: <n>/);
  for (const id of AGENTS) assert.ok(readme.includes(`| \`${id}\` |`), `roster row for ${id}`);
  for (const id of SKILLS) assert.ok(readme.includes(`| \`${id}\` |`), `skills row for ${id}`);
});
