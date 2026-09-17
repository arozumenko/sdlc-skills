// TASK-037 — the M1 manifest and the bundle's front-door prose (US-029
// AC-1…AC-7, US-003 AC-3, US-030 AC-3; plan §4.8, §5 TASK-037; spec §2, §8,
// §10, D10, D12). TASK-048 — the final manifest (US-042 AC-1; plan §4.8
// "Final"): three local agents, six local skills, three briefings, everything
// else identical to M1.
//
// What this file pins: `factory.json` is byte-for-byte the §4.8 final contract;
// `FACTORY.md` carries the five §10 use_cases and nothing that over-promises;
// the README's Guarantees table has one script row per §2 promise, each
// qualified the way §8 demands, and its Not guaranteed list has every §8
// item; the standalone section repeats the `secure-code-review` sequence
// instead of re-deriving it; `instructions.md` binds only this bundle's
// roles; `security-evidence/SKILL.md` indexes every command and schema and
// its `metadata.version` equals `scripts/version.json`; and a `--factory`
// install through the TASK-056 offline harness seeds `knowledge/`.
// Everything is read as text — no Markdown parser, no YAML parser beyond the
// two the repo already exports (stdlib only, G-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../../../../../bin/validate-factories.mjs";
import { parseMetaField } from "../../../../../bin/gen-marketplaces.mjs";
import { FORBIDDEN_STRINGS } from "./lib/tokens.mjs";
import { KNOWLEDGE_FILES } from "./lib/engagement.mjs";
import { assertNoNetwork, createOfflineInstall, runInstaller } from "./fixtures/offline/harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..");
const BUNDLE_DIR = resolve(SKILL_DIR, "..", "..");
const REPO_ROOT = resolve(BUNDLE_DIR, "..", "..");
const read = (rel) => readFileSync(join(BUNDLE_DIR, rel), "utf8");

// ---------------------------------------------------------------------------
// AC-1 — factory.json equals the final contract (plan §4.8, spec §10; US-042 AC-1)

const DESCRIPTION =
  "Threat-led, read-only security testing team: code-derived STRIDE threat model, evidence-gated secure code review with re-checkable citations, passive security cases for the manual-qa and test-automation bundles, fix verification from a validated test-start snapshot, and a residual-risk register.";

// The M1 manifest (TASK-037) — kept so the "everything else identical" half of
// the final contract is asserted against the object it was identical to.
const M1_MANIFEST = {
  id: "security-testing",
  title: "Security Testing Team",
  description: DESCRIPTION,
  agents: [],
  localAgents: ["security-reviewer"],
  localSkills: ["security-evidence", "secure-code-review", "security-engagement"],
  skills: ["memory", "knowledge-curation"],
  briefings: { "security-reviewer": "briefings/security-reviewer.md" },
  seed: { knowledge: ".agents/security-testing/knowledge" },
  instructions: "instructions.md",
};

// The final manifest (TASK-048; plan §4.8 "Final", spec §3 D1, §4): the roster
// in the order the plan spells it, the six D1 skills in the plan's order, one
// briefing per role. Never `hooks`, never `targets`; no `skillOverlays` either
// (SPIKE-002: `issue-tracking` resolves through the item index, plan §8).
const FINAL_MANIFEST = {
  ...M1_MANIFEST,
  localAgents: ["security-lead", "threat-modeler", "security-reviewer"],
  localSkills: ["security-evidence", "security-engagement", "threat-modeling", "secure-code-review", "security-test-planning", "risk-register"],
  briefings: {
    "security-lead": "briefings/security-lead.md",
    "threat-modeler": "briefings/threat-modeler.md",
    "security-reviewer": "briefings/security-reviewer.md",
  },
};

test("factory.json equals the final contract", () => {
  const manifest = JSON.parse(read("factory.json"));
  assert.deepEqual(manifest, FINAL_MANIFEST, "plan §4.8 final object, key for key");
  assert.deepEqual(Object.keys(manifest), Object.keys(M1_MANIFEST), "the same keys as M1, in the same order — nothing added");
  for (const key of ["id", "title", "description", "agents", "skills", "seed", "instructions"]) assert.deepEqual(manifest[key], M1_MANIFEST[key], `${key} identical to M1`);
  assert.ok(!("hooks" in manifest), "no hooks (D4)");
  assert.ok(!("targets" in manifest), "no targets (targets only governs bundle hooks)");
  assert.ok(!("skillOverlays" in manifest), "no skillOverlays (SPIKE-002: every declared skill resolves without one)");
  assert.deepEqual(Object.keys(manifest.briefings), manifest.localAgents, "one briefing per local agent, keyed by the roster in roster order");
  assert.equal(manifest.localSkills.length, 6, "the six D1 skills");
  // Every declared file exists where the validator will look for it.
  for (const a of manifest.localAgents) assert.ok(existsSync(join(BUNDLE_DIR, "agents", a, "AGENT.md")), `agents/${a}/AGENT.md`);
  for (const s of manifest.localSkills) assert.ok(existsSync(join(BUNDLE_DIR, "skills", s, "SKILL.md")), `skills/${s}/SKILL.md`);
  for (const rel of Object.values(manifest.briefings)) assert.ok(existsSync(join(BUNDLE_DIR, rel)), rel);
  for (const src of Object.keys(manifest.seed)) assert.ok(statSync(join(BUNDLE_DIR, src)).isDirectory(), `seed source ${src}`);
  assert.ok(existsSync(join(BUNDLE_DIR, manifest.instructions)), manifest.instructions);
  for (const s of manifest.skills) assert.ok(existsSync(join(REPO_ROOT, "skills", s, "SKILL.md")), `${s} is a monorepo skill (no network)`);
});

// ---------------------------------------------------------------------------
// AC-2 — FACTORY.md

const USE_CASES = [
  "Code-derived STRIDE threat model with file:line citations",
  "Evidence-gated secure code review whose citations anyone with the repo can re-check",
  "Passive security cases in manual-qa format, proposals for active testing",
  "Fix verification from a validated test-start snapshot with a script-emitted verdict",
  "Residual-risk register with unauthenticated acceptance records and expiry",
];

test("FACTORY.md fields and exactly five use_cases; no project_deployments", () => {
  const text = read("FACTORY.md");
  const fm = parseFrontmatter(text);
  assert.ok(fm, "FACTORY.md has YAML frontmatter");
  assert.equal(fm.name, "Security Testing Team");
  assert.equal(fm.description, DESCRIPTION, "description is the §10 sentence");
  assert.equal(fm.owner, "Applied AI");
  assert.ok(Array.isArray(fm.authors) && fm.authors.length > 0, "authors is a non-empty list");
  for (const a of fm.authors) assert.match(a, /^.+ <[^<>@\s]+@[^<>@\s]+>$/, `author "Name <email>": ${a}`);
  assert.equal(fm.install_script, "npx github:arozumenko/sdlc-skills init --factory security-testing");
  assert.equal(fm.install_script_unix, "npx github:arozumenko/sdlc-skills init --factory security-testing");
  assert.equal(fm.sdlc_phase, "Security Testing", "single scalar");
  assert.equal(fm.support_level, "Best Effort Support");
  assert.deepEqual(fm.use_cases, USE_CASES, "exactly the five §10 strings, in order");
  assert.ok(!("project_deployments" in fm), "project_deployments key omitted (N/A)");
  // The v2 wording that R5 retired must not have crept back in.
  assert.doesNotMatch(text, /human-approved|fresh-context verification|re-verifiable with one command/i);
});

// ---------------------------------------------------------------------------
// AC-4 / US-003 AC-3 — README Guarantees + Not guaranteed

const QUALIFICATION = "for runs carrying a `COMMITTED` marker produced by the canonical pipeline";

/** The rows of the first Markdown table under `## <heading>`: arrays of trimmed cells, header and separator excluded. */
function tableRows(text, heading) {
  const start = text.indexOf(`\n## ${heading}`);
  assert.ok(start >= 0, `section "## ${heading}"`);
  const body = text.slice(start + 1);
  const next = body.indexOf("\n## ");
  const section = next >= 0 ? body.slice(0, next) : body;
  const lines = section.split("\n").filter((l) => /^\|/.test(l));
  assert.ok(lines.length >= 3, `a table under "## ${heading}"`);
  const cells = (l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const header = cells(lines[0]);
  return { header, rows: lines.slice(2).map(cells), section };
}

const GUARANTEE_ROWS = [
  { key: /consistency and re-derivation/i, script: /evidence\.mjs check`/ },
  { key: /integrity against the recorded snapshot/i, script: /evidence\.mjs check --integrity --drift`/ },
  { key: /validated test-start snapshot/i, script: /`verify\.mjs all`/ },
  { key: /bounded redaction before any persistence/i, script: /`redact\.mjs`/ },
  { key: /only admitted cases are written to the hand-off suite/i, script: /`plan\.mjs admit`/ },
  { key: /every approval-like record is stored and reported as unauthenticated/i, script: /`register\.mjs/ },
  { key: /per-path observation of working-tree changes/i, script: /evidence\.mjs sign-off`/ },
];

const NOT_GUARANTEED = [
  /\borigin\b/i,
  /model read what it declared examined|model reading/i,
  /human approv/i,
  /secrets outside the rule list/i,
  /semantic suppression|suppression detection beyond lexical/i,
  /test meaningfulness/i,
  /direct-run refusal|refuses a case handed to it directly/i,
  /threat (model )?completeness/i,
  /host-preloaded instruction files/i,
  /direct agent reads|direct file reads/i,
  /attribution of (a )?(tree )?change/i,
  /encryption of local artifacts|unencrypted/i,
  /core context hooks/i,
];

test("README Guarantees table has a row per §2 promise and the Not-guaranteed list has all twelve §8 items", () => {
  const text = read("README.md");
  const { header, rows } = tableRows(text, "Guarantees");
  assert.ok(header.some((h) => /^enforced by/i.test(h)), `column "enforced by: script | prose" (got ${header.join(" / ")})`);
  const enforcedAt = header.findIndex((h) => /^enforced by/i.test(h));
  const scriptRows = rows.filter((r) => /^script\b/i.test(r[enforcedAt]));
  const proseRows = rows.filter((r) => /^prose\b/i.test(r[enforcedAt]));
  assert.equal(scriptRows.length + proseRows.length, rows.length, "every row is script or prose");
  assert.ok(scriptRows.length >= GUARANTEE_ROWS.length, `at least ${GUARANTEE_ROWS.length} script rows (one per §2 promise), got ${scriptRows.length}`);
  assert.ok(proseRows.length >= 1, "the prose-enforced rules (read-only posture) are listed as prose, never as script");
  for (const g of GUARANTEE_ROWS) {
    const row = scriptRows.find((r) => g.key.test(r.join(" | ")));
    assert.ok(row, `§2 row ${g.key}`);
    assert.match(row.join(" | "), g.script, `row ${g.key} names its script`);
  }
  for (const row of scriptRows) {
    assert.ok(row.join(" | ").includes(QUALIFICATION), `script row qualified "${QUALIFICATION}": ${row[0]}`);
  }
  // US-003 AC-3: the redaction row says the guarantee is bounded to the rule list.
  const redaction = scriptRows.find((r) => /bounded redaction/i.test(r.join(" ")));
  assert.match(redaction.join(" | "), /rule list/i, "redaction row is bounded to the rule list");

  const ng = text.slice(text.indexOf("\n## Not guaranteed"));
  assert.ok(ng.length > 20, "## Not guaranteed section");
  const ngSection = ng.slice(0, ng.indexOf("\n## ", 1) > 0 ? ng.indexOf("\n## ", 1) : undefined);
  for (const item of NOT_GUARANTEED) assert.match(ngSection, item, `§8 item ${item}`);
  assert.match(ngSection, /Active testing is out of scope in v1/);
  // Tracker: two layers, only the first promised (P4, §9.4).
  assert.match(text, /two layers/i);
  assert.match(text, /first layer/i);
  assert.match(text, /issue-tracking/);
});

test("README standalone section repeats the secure-code-review sequence verbatim and names the two-skill install", () => {
  const readme = read("README.md");
  const skill = read("skills/secure-code-review/SKILL.md");
  const install = "--skills security-testing/secure-code-review,security-testing/security-evidence";
  assert.ok(readme.includes(install), "two-skill standalone install line (D12)");
  // Steps 1–13 of SKILL.md "## Standalone review, human-driven": every `node <scripts>/…` span reappears in the README.
  const from = skill.indexOf("## Standalone review, human-driven");
  assert.ok(from >= 0, "SKILL.md standalone section");
  const to = skill.indexOf("\n## ", from + 1);
  const steps = skill.slice(from, to > 0 ? to : undefined);
  const spans = [...steps.matchAll(/`(node <scripts>\/[^`]+)`/g)].map((m) => m[1]);
  assert.ok(spans.length >= 13, `SKILL.md lists at least 13 command spans, got ${spans.length}`);
  const standalone = readme.slice(readme.indexOf("\n## Standalone"));
  assert.ok(standalone.length > 20, "## Standalone… section in the README");
  for (const span of spans) assert.ok(standalone.includes(span), `README standalone repeats \`${span}\``);
  assert.match(standalone, /\.claude\/skills\/security-evidence\/scripts/, "names where the scripts live on Claude Code");
  assert.match(standalone, /4 NO-ASSESSMENT|`NO-ASSESSMENT`/, "says sign-off exits 4 NO-ASSESSMENT by design");
});

// ---------------------------------------------------------------------------
// AC-5 — no "exact checkout" anywhere under the bundle or the generated marketplaces

test("no file under bundles/security-testing or generated marketplaces contains 'exact checkout'", () => {
  assert.deepEqual(FORBIDDEN_STRINGS, ["UNGATED", "exact checkout"]);
  const needle = FORBIDDEN_STRINGS[1];
  const offenders = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === ".git") continue;
        visit(p);
        continue;
      }
      // Test files spell the needle to grep for it (precedent: tokens.test.mjs);
      // tokens.mjs carries the literal list, stripped before scanning.
      if (name.endsWith(".test.mjs")) continue;
      let src = readFileSync(p, "utf8");
      if (name === "tokens.mjs") src = src.replace(/export const FORBIDDEN_STRINGS = Object\.freeze\(\[[^\]]*\]\);/, "");
      if (src.includes(needle)) offenders.push(relative(REPO_ROOT, p));
    }
  };
  visit(BUNDLE_DIR);
  for (const rel of [".cursor-plugin/marketplace.json", ".codex-plugin/marketplace.json", ".github/plugin/marketplace.json"]) {
    const p = join(REPO_ROOT, rel);
    assert.ok(existsSync(p), rel);
    if (readFileSync(p, "utf8").includes(needle)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

// The generated marketplaces are regenerated by TASK-052 (never hand-edited);
// this pins only what M1 already published. TASK-052 asserts the final rows.
test("generated marketplaces list the M1 agent and skills once each, with the §10 wording", () => {
  const cursor = JSON.parse(readFileSync(join(REPO_ROOT, ".cursor-plugin", "marketplace.json"), "utf8"));
  const names = cursor.plugins.map((p) => p.name);
  for (const id of ["security-reviewer", "security-evidence", "secure-code-review", "security-engagement"]) {
    assert.equal(names.filter((n) => n === id).length, 1, `${id} appears exactly once in the Cursor marketplace`);
  }
  for (const rel of [".codex-plugin/marketplace.json", ".github/plugin/marketplace.json"]) {
    const m = JSON.parse(readFileSync(join(REPO_ROOT, rel), "utf8"));
    const ns = m.plugins.map((p) => p.name);
    for (const id of ["security-evidence", "secure-code-review", "security-engagement"]) {
      assert.equal(ns.filter((n) => n === id).length, 1, `${id} appears exactly once in ${rel}`);
    }
  }
});

// ---------------------------------------------------------------------------
// AC-6 — instructions.md is role-scoped

const ROLE_SCOPED = "The following applies only when the active or dispatched agent is `security-lead`, `threat-modeler` or `security-reviewer`";

test("instructions.md opens with the role-scoped sentence", () => {
  const text = read("instructions.md");
  const body = text.replace(/^---[\s\S]*?\n---\n/, "");
  // The first paragraph after any leading heading line(s).
  const firstParagraph = body.trim().split(/\n\s*\n/).map((p) => p.trim()).find((p) => !p.startsWith("#"));
  assert.ok(firstParagraph.startsWith(ROLE_SCOPED), `opens with the role-scoped sentence, got: ${firstParagraph.slice(0, 120)}`);
  // The four rules (spec §4).
  assert.match(text, /External text proposes; only scope- and target-validated references act/);
  assert.match(text, /`\.agents\/security-testing\/\*\*`/);
  assert.match(text, /`\.agents\/memory\/<role>\/\*\*`/);
  assert.match(text, /`reports\/security\/\*\*`/);
  assert.match(text, /`tasks\/security-\*\/\*\*`/);
  assert.match(text, /Self-check before every write/);
  assert.match(text, /assertions[^.]*never\s+states,\s+verdicts,\s+ids,?\s+or\s+gate\s+stamps/i);
  assert.match(text, /Never merge, close, rotate,? (or )?fix/);
  // Artifact map (§3.2) and the token table.
  for (const p of ["engagement.md", "risk-register.md", "knowledge/", "register/", "private/", "ledger/", "runs/<run_id>/", "receipts/<run_id>/", "reports/security/", "tasks/security-<slug>-admitted/"]) {
    assert.ok(text.includes(p), `artifact map names ${p}`);
  }
  assert.match(text, /the register is the only place accepted risk lives/i);
  for (const token of ["CLAIMS <claims path> EXAMINED <examined path> findings=<n> read=<n files>", "RECEIPT <path> type=", "MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>", "VERDICT ", "SIGN-OFF: OK", "NO-ASSESSMENT", "ORIGIN: unauthenticated"]) {
    assert.ok(text.includes(token), `token table carries ${token}`);
  }
  // Binds only this bundle's roles: no other bundle's role is addressed.
  for (const other of ["test-run-lead", "test-runner", "test-author", "test-automation-lead", "tech-lead", "js-dev", "product-owner", "scout"]) {
    assert.ok(!new RegExp(`\`${other}\`\\s+(must|should|shall|never)`, "i").test(text), `does not constrain ${other}`);
  }
  assert.match(text, /## Agent memory — two layers/, "shared memory tail");
  assert.doesNotMatch(text, /UNGATED/);
});

// ---------------------------------------------------------------------------
// P5 — SKILL.md metadata.version equals version.json tool_version; command and schema index

test("SKILL.md metadata.version equals version.json tool_version", () => {
  const text = read("skills/security-evidence/SKILL.md");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, "SKILL.md frontmatter");
  const version = parseMetaField(fm[1], "version");
  const { tool_version } = JSON.parse(readFileSync(join(HERE, "version.json"), "utf8"));
  assert.equal(version, tool_version, "metadata.version === scripts/version.json tool_version (P5)");
  assert.match(fm[1], /^name: security-evidence$/m);
  assert.match(fm[1], /^description: .+/m);
  assert.doesNotMatch(fm[1], /^tools:/m);
});

test("SKILL.md is a command index: every evidence.mjs command, run snapshot *, register render, verify/tm-lint/plan, every schema, redaction stated", () => {
  const text = read("skills/security-evidence/SKILL.md");
  // evidence.mjs commands are the keys of its COMMANDS table.
  const evidenceSrc = readFileSync(join(HERE, "evidence.mjs"), "utf8");
  const commands = [...evidenceSrc.matchAll(/^\s+"?([a-z-]+)"?: \(\) => import\(/gm)].map((m) => m[1]);
  assert.ok(commands.length >= 14, `evidence.mjs registers commands, found ${commands.length}`);
  for (const c of commands) assert.match(text, new RegExp(`\`(?:evidence\\.mjs )?${c.replace(/-/g, "\\-")}(?: |\`)`), `SKILL.md indexes \`${c}\``);
  for (const sub of ["engagement init", "engagement validate", "engagement baseline", "run init", "run snapshot register", "run snapshot verify", "run snapshot proposals", "receipt validate", "receipt apply", "--kind scope", "--kind subject --subject <id>"]) {
    assert.ok(text.includes(sub), `SKILL.md indexes ${sub}`);
  }
  assert.match(text, /`verify\.mjs all`/);
  assert.match(text, /`verify\.mjs evaluate`/);
  for (const r of ["add", "accept", "revoke", "check", "close-false-positive", "reopen", "supersede", "alias", "consume-verdict", "render", "status", "replay", "anchor print", "anchor verify"]) {
    assert.ok(text.includes(`register.mjs ${r}`), `SKILL.md indexes register.mjs ${r}`);
  }
  assert.match(text, /`tm-lint\.mjs check`/);
  assert.match(text, /`plan\.mjs admit`/);
  // Schema index: every references/*.schema.json is named.
  const schemas = readdirSync(join(SKILL_DIR, "references")).filter((n) => n.endsWith(".schema.json")).sort();
  assert.ok(schemas.length >= 20, `references/ holds the schemas, found ${schemas.length}`);
  for (const s of schemas) assert.ok(text.includes(s), `SKILL.md schema index names ${s}`);
  for (const s of ["sarif-mapping.v1.json", "redaction-rules.json", "packet-policy.v1.json"]) assert.ok(text.includes(s), `names ${s}`);
  // Every string is redacted (G-4).
  assert.match(text, /every string[^.]*redact/i);
  // No approval verb; no confirmed state (G-8, D15).
  assert.doesNotMatch(text, /register\.mjs confirm\b/);
  assert.match(text, /no `confirm` verb/, "says there is no confirm verb (D15)");
  assert.doesNotMatch(text, /authenticated: true/);
  assert.doesNotMatch(text, /UNGATED/);
});

// ---------------------------------------------------------------------------
// AC-7 — the seed lands through a real --factory install, offline (TASK-056 harness)

// Both externals the final roster resolves live in obra/superpowers, so one
// fixture remote serves both subdirs (the harness refuses a repo twice).
const SD = {
  id: "systematic-debugging",
  repo: "obra/superpowers",
  subdir: "skills",
  files: {
    "systematic-debugging/SKILL.md": "---\nname: systematic-debugging\ndescription: offline fixture copy (TASK-037 manifest test)\n---\n\n# fixture body OFFLINE-FIXTURE-037\n",
    "dispatching-parallel-agents/SKILL.md": "---\nname: dispatching-parallel-agents\ndescription: offline fixture copy (TASK-048 manifest test)\n---\n\n# fixture body OFFLINE-FIXTURE-037-DPA\n",
  },
};

test("seed installs knowledge/ with engagement.md.template and finding-schema.md", async () => {
  const h = createOfflineInstall({ externals: [SD] });
  try {
    const r = await runInstaller({
      env: h.env,
      cwd: h.projectDir,
      args: ["init", "--factory", "security-testing", "--target", "claude", "--yes"],
    });
    const out = r.stdout + r.stderr;
    assert.equal(r.code, 0, out);
    assertNoNetwork(out);
    assert.ok(!/external fetch failed/.test(out), out);

    const knowledge = join(h.projectDir, ".agents", "security-testing", "knowledge");
    assert.ok(statSync(knowledge).isDirectory(), "seed dest .agents/security-testing/knowledge/");
    for (const name of ["engagement.md.template", "finding-schema.md"]) {
      assert.ok(existsSync(join(knowledge, name)), `${name} seeded`);
      assert.equal(readFileSync(join(knowledge, name), "utf8"), read(join("knowledge", name)), `${name} byte-identical to the bundle copy`);
    }
    assert.deepEqual(readdirSync(knowledge).sort(), [...KNOWLEDGE_FILES].sort(), "exactly the knowledge files TASK-007 lists");

    // The roster: each role's directory (with its inert NOTES.md sibling) copied as-is, each briefing seeded (final manifest, TASK-048).
    const manifest = JSON.parse(read("factory.json"));
    for (const role of manifest.localAgents) {
      const agentDir = join(h.projectDir, ".claude", "agents", role);
      for (const f of ["AGENT.md", "SOUL.md", "RULES.md", "NOTES.md"]) assert.ok(existsSync(join(agentDir, f)), `agent ${role}/${f}`);
      assert.ok(existsSync(join(h.projectDir, ".agents", "memory", role, "project_briefing.md")), `${role} briefing seeded`);
    }
    // Local skills + monorepo skills + the two externals, from the cache clone (the full resolution is asserted by e2e.test.mjs).
    for (const s of [...manifest.localSkills, ...manifest.skills, "systematic-debugging", "dispatching-parallel-agents"]) {
      assert.ok(existsSync(join(h.projectDir, ".claude", "skills", s, "SKILL.md")), `skill ${s} installed`);
    }
    assert.match(readFileSync(join(h.projectDir, ".claude", "skills", "systematic-debugging", "SKILL.md"), "utf8"), /OFFLINE-FIXTURE-037/);
    assert.match(readFileSync(join(h.projectDir, ".claude", "skills", "dispatching-parallel-agents", "SKILL.md"), "utf8"), /OFFLINE-FIXTURE-037-DPA/);
    assert.ok(existsSync(join(h.projectDir, ".claude", "skills", "security-evidence", "scripts", "evidence.mjs")), "scripts ship with the skill");
    // Instructions spliced under the FACTORY marker, role-scoped.
    for (const f of ["AGENTS.md", "CLAUDE.md"]) {
      const p = join(h.projectDir, f);
      if (!existsSync(p)) continue;
      const t = readFileSync(p, "utf8");
      assert.match(t, /<!-- FACTORY:security-testing START -->/);
      assert.ok(t.includes(ROLE_SCOPED), `${f} carries the role-scoped sentence`);
    }
    assert.ok(existsSync(join(h.projectDir, "AGENTS.md")) || existsSync(join(h.projectDir, "CLAUDE.md")), "instructions spliced into a root context file");
  } finally {
    h.cleanup();
  }
});
