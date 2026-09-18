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

// ---------------------------------------------------------------- Task 10: threat-modeler / threat-modeling

const SKILL10 = "skills/threat-modeling";
const AGENT10 = "agents/threat-modeler";
const DISPOSITIONS = ["open", "accepted(R-nnnn)", "mitigated(M-nnn)", "planned(TC-nnn)", "out-of-scope(<reason>)"];
const BANNED10 = ["tm-lint", "packet", "receipt", "dispositions.json"];

test("threat-modeler frontmatter", () => {
  const a = read(`${AGENT10}/AGENT.md`);
  const f = fm(a);
  assert.equal(f.name, "threat-modeler");
  assert.equal(f.model, "opus");
  assert.equal(f.color, "purple");
  assert.equal(f.group, "security");
  assert.equal(f.theme, '{color: colour93, icon: "🕸️", short_name: tm}');
  assert.equal(f.aliases, "[threat-modeler, tm]");
  assert.equal(f["context-docs"], "security-testing/engagement.md security-testing/knowledge/finding-schema.md");
  assert.equal(f.skills, "[memory, threat-modeling]");
  assert.equal(f["skills-on-demand"], "[secure-code-review, gathering-context]");
  assert.ok(!("tools" in f) && !("mcpServers" in f), "no tools:, no mcpServers (bundles/SPEC.md)");
  assert.ok(a.split("\n").length <= 180, "AGENT.md stays within 180 lines");
});

test("threat-modeler body carries the return-line rule, cite.mjs check, the cases path and the five dispositions", () => {
  const a = read(`${AGENT10}/AGENT.md`);
  assert.match(a, /MODEL_WRITTEN elements=<n> threats=<n> open=<n>/, "return line on a clean check");
  assert.match(a, /TM-INVALID/, "the failure return line is named");
  assert.ok(a.includes("cite.mjs check"), "cite.mjs check");
  assert.ok(a.includes(".agents/security-testing/cases/"), "candidate case location");
  const body = a + read(`${SKILL10}/SKILL.md`);
  for (const d of DISPOSITIONS) assert.ok(body.includes(d), `AGENT.md/SKILL.md: ${d}`);
});

test("threat-modeler assigns element/threat/mitigation ids itself and never writes check's stamped keys", () => {
  const norm = (s) => s.replace(/\s+/g, " ");
  const files = {
    "AGENT.md": norm(read(`${AGENT10}/AGENT.md`)),
    "RULES.md": norm(read(`${AGENT10}/RULES.md`)),
    "SKILL.md": norm(read(`${SKILL10}/SKILL.md`)),
  };
  for (const [name, text] of Object.entries(files)) {
    assert.match(text, /assigns? every element.{0,40}own id/i, `${name}: assigns its own id`);
    assert.ok(text.includes("E-nnn") && text.includes("T-nnn") && text.includes("M-nnn"), `${name}: names the id patterns`);
    assert.match(text, /`state`, `oid`, `snippet_redacted` or `check_stamp`/, `${name}: the correct never-write list (id excluded)`);
    assert.ok(!/never write.{0,10}`id`/i.test(text), `${name}: must not claim the modeler never writes id`);
  }
});

test("threat-modeling SKILL.md starts 'Use when', names the shape and the five dispositions", () => {
  const s = read(`${SKILL10}/SKILL.md`);
  assert.match(s, /^description: "Use when /m);
  assert.match(s, /^name: threat-modeling$/m);
  assert.ok(s.includes("cite.mjs check"), "cite.mjs check");
  assert.ok(s.includes(".agents/security-testing/cases/"), "candidate case location");
  for (const d of DISPOSITIONS) assert.ok(s.includes(d), `SKILL.md: ${d}`);
  for (const t of ["MODEL_WRITTEN", "TM-INVALID", "MODEL elements=", "CHECK verified="]) assert.ok(s.includes(t), t);
  assert.ok(s.split("\n").length <= 200, "SKILL.md stays within 200 lines");
});

test("threat-modeler SOUL.md, RULES.md and briefing carry none of the dropped vocabulary", () => {
  const soul = read(`${AGENT10}/SOUL.md`);
  const rules = read(`${AGENT10}/RULES.md`);
  const brief = read("briefings/threat-modeler.md");
  assert.match(soul, /^# Soul/m);
  assert.match(rules, /^# Rules/m);
  assert.ok(rules.split("\n").filter((l) => /^\d+\. \*\*/.test(l)).length >= 4, "RULES.md lists the four roster rules as numbered bullets");
  const bf = fm(brief);
  assert.equal(bf.name, "Project briefing");
  assert.equal(bf.type, "project");
  assert.match(brief, /^## Project Knowledge/m);
  assert.match(brief, /^## My Role Focus/m);
  for (const [name, text] of [["SOUL.md", soul], ["RULES.md", rules], ["briefing", brief]]) {
    for (const b of BANNED10) assert.ok(!text.toLowerCase().includes(b), `${name}: ${b}`);
  }
});

test("no dropped-pipeline vocabulary anywhere in the threat-modeling skill or the threat-modeler agent", () => {
  for (const abs of [...walk(join(B, SKILL10)), ...walk(join(B, AGENT10))]) {
    const t = readFileSync(abs, "utf8").toLowerCase();
    for (const b of BANNED10) assert.ok(!t.includes(b), `${abs}: ${b}`);
    assert.ok(!t.includes("resolved_via"), `${abs}: resolved_via`);
  }
});

test("no 'Placeholder' / 'replaced in Task' text remains under threat-modeling or threat-modeler", () => {
  for (const rel of [`${AGENT10}/AGENT.md`, `${AGENT10}/SOUL.md`, `${AGENT10}/RULES.md`, "briefings/threat-modeler.md", `${SKILL10}/SKILL.md`]) {
    assert.ok(existsSync(join(B, rel)), `${rel} exists`);
  }
  for (const abs of [...walk(join(B, SKILL10)), ...walk(join(B, AGENT10)), join(B, "briefings/threat-modeler.md")]) {
    const t = readFileSync(abs, "utf8");
    for (const re of STUB) assert.ok(!re.test(t), `${abs}: ${re}`);
  }
});

// ---------------------------------------------------------------- Task 11

import { TRANSITIONS } from "./skills/risk-register/scripts/lib/transitions.mjs";

const SKILL_PLAN = "skills/security-test-planning";
const SKILL_REG = "skills/risk-register";
const SKILL_ENG = "skills/security-engagement";

test("risk-register SKILL.md names every TRANSITIONS event, the approval shape and render", () => {
  const s = read(`${SKILL_REG}/SKILL.md`);
  assert.match(s, /^name: risk-register$/m);
  assert.match(s, /^description: "Use when /m);
  for (const event of Object.keys(TRANSITIONS)) assert.ok(s.includes(event), `event ${event}`);
  assert.ok(s.includes("authenticated: false"), "authenticated: false");
  assert.ok(s.includes("there is no confirmed state"), "there is no confirmed state");
  assert.ok(s.includes("register.mjs render"), "register.mjs render");
  assert.ok(s.split("\n").length <= 150, "SKILL.md stays within 150 lines");
});

test("security-test-planning SKILL.md mandates the case path/filename, names admit/verify-suite, admitted by lint, and never claims safe", () => {
  const s = read(`${SKILL_PLAN}/SKILL.md`);
  assert.match(s, /^name: security-test-planning$/m);
  assert.match(s, /^description: "Use when /m);
  assert.ok(s.includes(".agents/security-testing/cases/"), "candidate case location");
  assert.ok(s.includes("TC-NNN_<slug>.md"), "case filename pattern");
  assert.ok(s.includes("cases.mjs admit"), "cases.mjs admit");
  assert.ok(s.includes("verify-suite"), "verify-suite");
  assert.ok(s.includes("admitted by lint"), "admitted by lint");
  const withoutPhrase = s.replace(/never says ["']?safe["']?/gi, "");
  assert.ok(!/\bsafe\b/i.test(withoutPhrase), "never claims safe as a fact");
  assert.ok(s.split("\n").length <= 150, "SKILL.md stays within 150 lines");
});

test("security-engagement SKILL.md frontmatter and line budget", () => {
  const s = read(`${SKILL_ENG}/SKILL.md`);
  assert.match(s, /^name: security-engagement$/m);
  assert.match(s, /^description: "Use when /m);
  assert.ok(s.split("\n").length <= 100, "SKILL.md stays within 100 lines");
});

test("security-engagement/references/workflow.md lists the spec §7 commands in increasing order and carries no dropped-pipeline vocabulary", () => {
  const w = read(`${SKILL_ENG}/references/workflow.md`);
  const commands = ["cite.mjs init", "cite.mjs check", "register.mjs add", "cases.mjs admit", "cases.mjs verify-suite", "verify.mjs", "register.mjs accept", "register.mjs status"];
  let last = -1;
  for (const c of commands) {
    const i = w.indexOf(c);
    assert.ok(i >= 0, c);
    assert.ok(i > last, `${c} out of order (index ${i} <= ${last})`);
    last = i;
  }
  for (const banned of ["evidence.mjs", "run init", "packet", "publish", "COMMITTED", "M2", "M3"]) assert.ok(!w.includes(banned), banned);
});

// ---------------------------------------------------------------- Task 11 fix round 1 (Rio)

test("workflow.md uses the real register.mjs add verb and does not claim verify.mjs prints PENDING-REVIEW", () => {
  const w = read(`${SKILL_ENG}/references/workflow.md`);
  assert.ok(w.includes("register.mjs add --finding"), "register.mjs add --finding");
  for (const banned of ["--subject", "subject_kind", "first_seen_run", "--run <run_id>"]) assert.ok(!w.includes(banned), banned);
  assert.match(w, /NEXT: dispatch security-reviewer fix-review/);
  assert.ok(!/prints?[^.\n]{0,40}PENDING-REVIEW/i.test(w), "does not claim verify.mjs prints PENDING-REVIEW as an output line");
});

test("risk-register docs use the real add verb, row fields and append-only approvals (no subject/subject_kind/first_seen_run/--run, no per-status acceptance/false_positive sub-object)", () => {
  const files = [`${SKILL_REG}/SKILL.md`, `${SKILL_REG}/references/transitions.md`, `${SKILL_REG}/references/approvals.md`];
  for (const rel of files) {
    const t = read(rel);
    for (const banned of ["--subject", "subject_kind", "first_seen_run", "--run <run_id>", '"acceptance":', '"false_positive"']) assert.ok(!t.includes(banned), `${rel}: ${banned}`);
  }
  const s = read(`${SKILL_REG}/SKILL.md`);
  assert.ok(s.includes("finding_id"), "finding_id field");
  assert.ok(s.includes("approvals"), "approvals array");
  assert.ok(s.includes("accepted_until"), "accepted_until field");
  assert.ok(s.includes("--finding <64-hex sha256>") || s.includes("--finding <64-hex"), "the real --finding flag");
});

test("passive-admission.md carries the corrected observe/tooling vocabulary", () => {
  const p = read(`${SKILL_PLAN}/references/passive-admission.md`);
  assert.match(p, /\bscreenshot\b/, "bare screenshot verb");
  assert.ok(p.includes("owasp zap") || p.includes("zaproxy"), "zap only matches as owasp zap / zaproxy");
  assert.ok(!/\|\s*zap\s*,/i.test(p) && !/,\s*zap\s*,/i.test(p) && !/,\s*zap\s*\|/i.test(p), "bare zap is not listed as its own tooling token");
  for (const t of ["msfconsole", "ncat", "rm -<flags>"]) assert.ok(p.includes(t), t);
});

// ---------------------------------------------------------------- Task 12: security-lead / README / CHANGELOG

const AGENT12 = "agents/security-lead";
const PHASES12 = "Init · Review · Register · Model · Cases · Hand-off (stop) · Report · Fix · Acceptances · Sign-off";

test("security-lead frontmatter", () => {
  const a = read(`${AGENT12}/AGENT.md`);
  const f = fm(a);
  assert.equal(f.name, "security-lead");
  assert.equal(f.model, "sonnet");
  assert.equal(f.color, "blue");
  assert.equal(f.group, "security");
  assert.equal(f.theme, '{color: colour27, icon: "🔐", short_name: lead}');
  assert.equal(f.aliases, "[security-lead, seclead]");
  assert.equal(
    f["context-docs"],
    "security-testing/engagement.md security-testing/knowledge/finding-schema.md security-testing/risk-register.md",
  );
  assert.equal(f.skills, "[memory, security-engagement]");
  assert.equal(
    f["skills-on-demand"],
    "[secure-code-review, risk-register, security-test-planning, issue-tracking, verifying-outcomes]",
  );
  assert.ok(!("tools" in f) && !("mcpServers" in f), "no tools:, no mcpServers (bundles/SPEC.md)");
});

test("security-lead body names the ten phases, links the procedure, proposes rather than approves, and stays within budget", () => {
  const a = read(`${AGENT12}/AGENT.md`);
  assert.ok(a.includes(PHASES12), "the ten phases, in order, with the stop marked");
  assert.ok(a.includes("references/workflow.md"), "links the full procedure");
  assert.ok(a.includes("proposes"), "proposes");
  assert.ok(!/lead approves/i.test(a), "never says the lead approves");
  for (const line of [
    "REVIEW_WRITTEN findings=<n>",
    "SECOND_WRITTEN <id> <assertion>",
    "FIX_REVIEW_WRITTEN <id> <not-refound|refound>",
    "MODEL_WRITTEN elements=<n> threats=<n> open=<n>",
  ]) {
    assert.ok(a.includes(line), line);
  }
  assert.ok(a.split("\n").length <= 250, "AGENT.md stays within 250 lines");
});

test("security-lead SOUL.md, RULES.md and briefing carry no dropped-pipeline vocabulary", () => {
  const soul = read(`${AGENT12}/SOUL.md`);
  const rules = read(`${AGENT12}/RULES.md`);
  const brief = read("briefings/security-lead.md");
  assert.match(soul, /^# Soul/m);
  assert.match(rules, /^# Rules/m);
  assert.ok(rules.split("\n").filter((l) => /^\d+\. \*\*/.test(l)).length >= 4, "RULES.md lists the four roster rules as numbered bullets");
  const bf = fm(brief);
  assert.equal(bf.name, "Project briefing");
  assert.equal(bf.type, "project");
  assert.match(brief, /^## Project Knowledge/m);
  assert.match(brief, /^## My Role Focus/m);
  for (const [name, text] of [["SOUL.md", soul], ["RULES.md", rules], ["briefing", brief]]) {
    for (const banned of [/packet/i, /receipt/i, /security-evidence/i, /\bgate\b/i, /normalised line/i, /worktree/i]) assert.ok(!banned.test(text), `${name}: ${banned}`);
  }
});

test("README names the roster and skills, the Guarantees / Not guaranteed table, and the install smoke block", () => {
  const r = read("README.md");
  const guaranteeRows = [
    "Every citation carries a commit oid and a ≤40-line range",
    "Every scoped range is accounted for exactly once",
    "Nothing a script writes contains bytes matching a redaction rule",
    "is written only by `cases.mjs admit`",
    "A `VERIFIED` verdict means the project's tests exited 0",
    "Every approval-like record is stored `authenticated: false`",
  ];
  for (const row of guaranteeRows) assert.ok(r.includes(row), row);
  const scriptRows = (r.match(/^\|.*\bscript\b.*\|$/gim) || []).length;
  assert.ok(scriptRows >= 6, `at least six script-tagged Guarantees rows (got ${scriptRows})`);
  assert.ok(r.includes("Not guaranteed"), "Not guaranteed section");
  assert.ok(!r.toLowerCase().includes("exact checkout"), "never 'exact checkout'");
  assert.match(r, /GIT-ERROR/, "GIT-ERROR is named");
  assert.match(r, /\.gitignore/, "the one unredacted write is named");
  const smoke = [
    "npx github:arozumenko/sdlc-skills init --factory security-testing --target claude --yes",
    "node .claude/skills/secure-code-review/scripts/cite.mjs init",
    "node .claude/skills/secure-code-review/scripts/cite.mjs check .agents/security-testing/reviews/<dir>/findings.json",
    "node .claude/skills/risk-register/scripts/register.mjs status",
  ];
  const bashBlocks = [...r.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
  assert.ok(bashBlocks.some((b) => b === smoke.join("\n")), "an exact four-line smoke block");
  assert.ok(r.split("\n").length <= 300, "README stays within 300 lines");
});

test("CHANGELOG.md ships one 1.0.0 entry naming the four scripts", () => {
  const c = read("CHANGELOG.md");
  assert.match(c, /^## 1\.0\.0$/m);
  for (const script of ["cite.mjs", "verify.mjs", "cases.mjs", "register.mjs"]) assert.ok(c.includes(script), script);
});

test("no file under the bundle still spells the flat second-opinion path (second-M-nnn.json lives in the review directory)", () => {
  function walkAll(dir, out = []) {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      if (name === "node_modules") continue;
      const st = statSync(abs);
      if (st.isDirectory()) walkAll(abs, out);
      else out.push(abs);
    }
    return out;
  }
  for (const abs of walkAll(B)) {
    if (!/\.(md|json|template)$/.test(abs)) continue;
    const t = readFileSync(abs, "utf8");
    assert.ok(!/security-testing\/second-/.test(t), `${abs}: security-testing/second-`);
  }
});

test("no 'Placeholder' / 'replaced in Task' text remains anywhere under the bundle", () => {
  function walkAll(dir, out = []) {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      if (name === "node_modules") continue;
      const st = statSync(abs);
      if (st.isDirectory()) walkAll(abs, out);
      else out.push(abs);
    }
    return out;
  }
  for (const abs of walkAll(B)) {
    if (!/\.(md|json|template)$/.test(abs)) continue;
    const t = readFileSync(abs, "utf8");
    for (const re of STUB) assert.ok(!re.test(t), `${abs}: ${re}`);
  }
});
