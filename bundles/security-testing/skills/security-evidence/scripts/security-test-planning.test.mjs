// TASK-042 — the `security-test-planning` skill (US-034 AC-5; plan §5
// TASK-042; spec §5 row "Prose + passive-admission.md; plan.mjs lives in
// security-evidence", §9.1, D7). The skill is prose; what this file pins is
// that the prose stays TRUE against the scripts it describes: it ships no
// scripts/, every command-shaped span invokes one of the bundle's own
// scripts, its frontmatter has the agentskills.io shape, the reference
// names every lint rule and every allowed verb lib/admission-core.mjs
// runs, the record shape it shows is admission.schema.json's, the wording
// is "admitted by lint or by review" and never an unquoted "safe", the
// candidate location and id shape follow the PM ruling, and the
// audit-branch pointer TASK-043 fills is there. Text only — no Markdown or
// YAML parser (stdlib only, G-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_OPERATIONS, CLASSIFICATIONS, FORBIDDEN_PATTERNS, LINT_RULES, REVIEWABLE_RULES } from "./lib/admission-core.mjs";
import { ADMISSION_EXISTS, PROPOSAL_UNDER_TASKS } from "./lib/tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..", "..", "security-test-planning");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const SCHEMA = JSON.parse(readFileSync(join(HERE, "..", "references", "admission.schema.json"), "utf8"));

const read = (name) => readFileSync(join(SKILL_DIR, name), "utf8");
const reference = () => read(join("references", "passive-admission.md"));

function skillFiles() {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), r);
      else if (entry.name.endsWith(".md")) out.push({ rel: r, text: readFileSync(join(dir, entry.name), "utf8") });
    }
  };
  walk(SKILL_DIR, "");
  return out;
}

/** Inline backticked spans of a Markdown text (fenced blocks are read line by line, each line one span). */
function backtickedSpans(text) {
  const spans = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(text)) !== null) for (const line of m[1].split("\n")) if (line.trim()) spans.push(line.trim());
  const inline = /`([^`\n]+)`/g;
  const stripped = text.replace(fence, "");
  while ((m = inline.exec(stripped)) !== null) spans.push(m[1]);
  return spans;
}

const SCRIPTS = ["plan.mjs", "evidence.mjs", "register.mjs", "tm-lint.mjs"];
const COMMAND_SHAPED = /^(?:node|git|npm|npx|gh|curl|sh|bash|python3?|pip)\b|\.mjs\b/;
function invokedScript(span) {
  const s = span.replace(/^node\s+/, "").replace(/^(?:\$?\{?<[^>]+>\}?\/|[\w.@-]+\/)+/, "");
  return s.split(/\s+/)[0];
}

test("skill dir is SKILL.md + references/ with no scripts/; passive-admission.md ships now, audit-branch.md is TASK-043's; every command-shaped span invokes a bundle script", () => {
  assert.ok(existsSync(SKILL_MD));
  assert.ok(!existsSync(join(SKILL_DIR, "scripts")), "spec §5: plan.mjs lives in security-evidence, the skill ships no scripts/");
  assert.deepEqual(readdirSync(SKILL_DIR).sort(), ["SKILL.md", "references"]);
  const refs = readdirSync(join(SKILL_DIR, "references")).sort();
  assert.ok(refs.includes("passive-admission.md"));
  assert.ok(refs.every((r) => ["passive-admission.md", "audit-branch.md"].includes(r)), `unexpected reference: ${refs.join(", ")}`);
  assert.ok(existsSync(join(HERE, "plan.mjs")) && existsSync(join(HERE, "lib", "cmd-plan-admit.mjs")) && existsSync(join(HERE, "lib", "cmd-plan-propose.mjs")));
  let commands = 0;
  for (const { rel, text } of skillFiles()) {
    for (const span of backtickedSpans(text)) {
      if (!COMMAND_SHAPED.test(span)) continue;
      commands += 1;
      const script = invokedScript(span);
      assert.ok(SCRIPTS.includes(script), `${rel}: command-shaped span \`${span}\` must invoke one of ${SCRIPTS.join("|")}, got ${script}`);
    }
  }
  assert.ok(commands >= 6, `the prose names the commands it rests on (${commands} command spans found)`);
});

test("SKILL.md frontmatter: agentskills.io shape (name, description, license, metadata), name matches the directory, description states triggers", () => {
  const text = read("SKILL.md");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, "frontmatter block present");
  const fm = m[1];
  assert.match(fm, /^name: security-test-planning$/m);
  const desc = fm.match(/^description: (.*)$/m);
  assert.ok(desc, "description present");
  assert.match(desc[1].replace(/^"|"$/g, ""), /^Use when /);
  assert.ok(desc[1].length <= 1024, "description within the agentskills.io limit");
  assert.match(fm, /^license: /m);
  assert.match(fm, /^metadata:\n\s+authors:\n\s+- "[^"]+ <[^>]+>"/m, "metadata.authors present, quoted");
  assert.doesNotMatch(fm, /^(tools|allowed-tools):/m);
  assert.ok(m[2].includes("references/passive-admission.md"), "SKILL.md links the reference");
  assert.ok(m[2].includes("references/audit-branch.md"), "the one-line pointer TASK-043 fills");
});

test("SKILL.md: the four standing rules, both routes and the proposal exit, the candidate location and id shape (PM ruling), the commands in order, the tokens, and never an unquoted 'safe'", () => {
  const text = read("SKILL.md");
  const prose = text.replace(/\s+/g, " ");
  assert.match(prose, /External text proposes; only scope- and target-validated references act/);
  assert.match(prose, /Writable paths:\*\* `\.agents\/security-testing\/\*\*` and `\.agents\/memory\/<role>\/\*\*`/);
  assert.match(prose, /You write assertions, never states, verdicts, ids or gate stamps/);
  assert.match(prose, /Never merge, close, rotate or fix/);
  for (const c of CLASSIFICATIONS) assert.ok(text.includes(`\`${c}\``), `names ${c}`);
  assert.match(prose, /admitted by lint or by review/);
  assert.doesNotMatch(text, /(?<!")\bsafe\b/, "the word is only ever quoted as what NOT to say");
  assert.match(text, /<st>\/cases\/<slug>\/TC-NNN_<slug>\.md/, "the candidate location");
  assert.match(prose, /`TC-` \+ three digits/, "the id shape manual-qa's readers match");
  assert.match(text, /plan\.mjs admit --run <run_id> <st>\/cases\/<slug>\/TC-NNN_<slug>\.md/);
  assert.match(text, /packet --run <run_id> --kind subject --type case --subject/);
  assert.match(text, /receipt validate --run <run_id>/);
  assert.match(text, /plan\.mjs admit --run <run_id> <case> --receipt <admitted receipt sha256>/);
  assert.match(text, /plan\.mjs propose --run <run_id> <path>/);
  assert.match(text, /ADMISSION case=<case_sha256> classification=<admitted-heuristic\|admitted-reviewed\|proposal> hits=<n>/);
  assert.match(text, /NEXT: run\s+snapshot proposals --run <run_id>/);
  assert.ok(text.includes(`\`2 ${ADMISSION_EXISTS}\``), "the write-once refusal");
  assert.ok(text.includes(`\`2 ${PROPOSAL_UNDER_TASKS}\``), "the tasks/ refusal");
  assert.match(prose, /forbidden hit is never reviewed away/);
  assert.match(prose, /written \*\*only\*\* by `evidence\.mjs publish --profile case`/);
  assert.match(prose, /authenticated: false/);
  assert.doesNotMatch(text, /UNGATED|exact checkout/, "G-13 forbidden strings");
});

test("passive-admission.md names every lint rule, every allowed operation and verb, the reviewable rule, the classification table and the schema's record keys", () => {
  const ref = reference();
  for (const rule of LINT_RULES) assert.ok(ref.includes(`\`${rule}\``), `names rule ${rule}`);
  for (const { name } of ALLOWED_OPERATIONS) assert.ok(ref.includes(`\`${name}\``), `names operation ${name}`);
  for (const { rule } of FORBIDDEN_PATTERNS) assert.ok(new RegExp(`^\\| \`${rule}\` \\|`, "m").test(ref), `a table row for ${rule}`);
  // the verbs the grammar accepts are all listed, spelled as words
  const verbs = ["navigate to", "go to", "open", "visit", "load", "reload", "refresh", "inspect", "observe", "read", "view", "check", "verify", "confirm", "note", "record", "look at", "examine", "review", "compare", "count", "list", "find", "locate", "hover", "expand", "collapse", "select", "switch to", "scroll", "wait", "capture", "take a screenshot", "close", "ensure", "assert"];
  for (const v of verbs) {
    assert.ok(ref.includes(`\`${v}\``), `lists verb ${v}`);
    const plain = v.split(" ")[0];
    assert.ok(ALLOWED_OPERATIONS.some(({ re }) => re.test(v)) || plain === "take", `the grammar accepts "${v}"`);
  }
  for (const rule of REVIEWABLE_RULES) assert.match(ref, new RegExp(`\\*\\*\`${rule}\`\\*\\*[\\s\\S]{0,240}confirmed review can admit past`), `${rule} is the reviewable one`);
  assert.match(ref, /forbidden hit is not reviewable away/);
  assert.match(ref, /admitted by lint or by review/);
  assert.doesNotMatch(ref, /(?<!")\bsafe\b/);
  for (const c of CLASSIFICATIONS) assert.ok(ref.includes(`\`${c}\``), `classification ${c}`);
  assert.match(ref, /review-not-confirmed` hit at step 0/);
  const keys = new Set([...SCHEMA.oneOf.flatMap((o) => Object.keys(o.properties))]);
  for (const key of keys) assert.ok(ref.includes(`"${key}"`), `record shape shows ${key}`);
  for (const key of Object.keys(SCHEMA.$defs.LintHit.properties)) assert.ok(ref.includes(`"${key}"`), `hit shape shows ${key}`);
  for (const key of Object.keys(SCHEMA.$defs.Assumptions.properties)) assert.ok(ref.includes(`"${key}"`), `assumptions shape shows ${key}`);
  assert.match(ref, /RECEIPT-MISMATCH\(<reason>\)/);
  assert.match(ref, /<run>\/admissions\/<case_sha256>\.json/);
  assert.match(ref, /sha256 over the \*\*redacted\*\* text/);
});

test("audit-branch.md (TASK-043): names every header the case profile recognises with its audit-step Action, the collection row, the priority map, the reload/panel fold, the Navigate-first refusal and the UNADMITTED comparison; the mutating-verb row of passive-admission.md states the clause anchoring", async () => {
  const { AUDIT_HEADERS, AUDIT_STEPS, PRIORITY_MAP } = await import("./lib/profiles/case.mjs");
  const ref = read(join("references", "audit-branch.md"));
  for (const h of AUDIT_HEADERS) assert.ok(new RegExp(`^\\| \`${h}\`( flags[^|]*)? \\|`, "m").test(ref), `a mapping row for ${h}`);
  for (const h of AUDIT_HEADERS.filter((x) => x !== "Set-Cookie")) assert.ok(ref.includes(`Inspect the \\\`${h}\\\` response header`), `the emitted Action for ${h}`);
  assert.ok(ref.includes(AUDIT_STEPS.cookies("<path>").replace(/`/g, "\\`")), "the Set-Cookie Action");
  assert.ok(ref.includes(AUDIT_STEPS.collect.replace(/`/g, "\\`")), "the collection row");
  assert.ok(ref.includes(AUDIT_STEPS.collected("<path>").replace(/`/g, "\\`")), "the collection row's expectation");
  for (const [p, qa] of Object.entries(PRIORITY_MAP)) assert.ok(ref.includes(`${p} →\n\`${qa}\``) || ref.includes(`${p} → \`${qa}\``), `priority ${p} → ${qa}`);
  assert.match(ref, /folded into the collection row/);
  assert.match(ref, /before any Navigate step/);
  assert.match(ref, /`UNADMITTED:`/);
  assert.match(ref, /never instructs a browser action beyond "open URL,\s+inspect response"/);
  assert.match(ref, /browser_network_requests\(\)/);
  assert.doesNotMatch(ref, /(?<!")\bsafe\b/);
  assert.match(reference(), /^\| `mutating-verb` \| a state-changing verb \*\*at the start of the Action or of a clause after `and` \/ `then` \/ `or` \/ `;` \/ `,`\*\*/m);
  const skill = read("SKILL.md");
  assert.doesNotMatch(skill, /TASK-043/, "the pointer TASK-042 left is replaced");
  assert.match(skill, /\[references\/audit-branch\.md\]\(references\/audit-branch\.md\)/);
  assert.match(skill, /publish --run <run_id> --profile case --to tasks\/security-<slug>-admitted/);
  assert.match(skill, /publish --run <run_id> --profile handoff --to \.agents\/security-testing\/handoffs/);
  assert.match(skill, /plan\.mjs admit --run <run_id> <case> --dry-run/);
});
