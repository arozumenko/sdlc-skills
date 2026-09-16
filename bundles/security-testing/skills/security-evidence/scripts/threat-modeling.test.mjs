// TASK-039 — the `threat-modeling` skill (US-031 AC-1; plan §5 TASK-039;
// spec §5 row "Prose + references; tm-lint lives in security-evidence",
// §4 threat-modeler row, §6.10, D14).
//
// The skill is prose; what this file pins is that the prose stays TRUE
// against the scripts it describes: it ships no scripts/, every
// command-shaped span invokes one of the bundle's own scripts, its
// frontmatter has the agentskills.io shape, its references cover the DFD
// element kinds and STRIDE letters of threat-model.schema.json, every
// disposition kind and `resolved_via` value, the three derived mitigation
// states, the return line the threat-modeler owes, and the exact TM-INVALID
// wordings lib/tm-lint-core.mjs prints. Text only — no Markdown or YAML
// parser (stdlib only, G-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESOLVED_VIA, lintDispositions } from "./lib/tm-lint-core.mjs";
import { DISPOSITION_KINDS, MITIGATION_CONFIRMED, MITIGATION_GAP, MITIGATION_INDETERMINATE, NOT_INDEPENDENTLY_REVIEWED, PATH_NOT_IN_SCOPE, RANGE_NOT_ADMITTED, RANGE_TOO_LONG, SNAPSHOT_EXISTS, TM_DIRTY_CITATION } from "./lib/tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..", "..", "threat-modeling");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const REFERENCES = ["dfd-elements", "stride", "mitigations-as-claims", "dispositions"];
const SCHEMA = JSON.parse(readFileSync(join(HERE, "..", "references", "threat-model.schema.json"), "utf8"));

const read = (name) => readFileSync(join(SKILL_DIR, name), "utf8");
const ref = (name) => read(join("references", `${name}.md`));

/** Every Markdown file the skill ships, `{rel, text}`. */
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

const SCRIPTS = ["tm-lint.mjs", "evidence.mjs", "register.mjs", "plan.mjs"];
const COMMAND_SHAPED = /^(?:node|git|npm|npx|gh|curl|sh|bash|python3?|pip)\b|\.mjs\b/;
function invokedScript(span) {
  const s = span.replace(/^node\s+/, "").replace(/^(?:\$?\{?<[^>]+>\}?\/|[\w.@-]+\/)+/, "");
  return s.split(/\s+/)[0];
}

test("skill dir is SKILL.md + references/ with no scripts/; every command-shaped span invokes a bundle script (tm-lint.mjs lives in security-evidence)", () => {
  assert.ok(existsSync(SKILL_MD));
  assert.ok(!existsSync(join(SKILL_DIR, "scripts")), "spec §5: tm-lint lives in security-evidence, the skill ships no scripts/");
  assert.deepEqual(readdirSync(SKILL_DIR).sort(), ["SKILL.md", "references"]);
  assert.deepEqual(readdirSync(join(SKILL_DIR, "references")).sort(), REFERENCES.map((n) => `${n}.md`).sort());
  assert.ok(existsSync(join(HERE, "tm-lint.mjs")) && existsSync(join(HERE, "lib", "cmd-tm-lint.mjs")), "US-031 AC-1: tm-lint.mjs is under security-evidence/scripts/");
  let commands = 0;
  for (const { rel, text } of skillFiles()) {
    for (const span of backtickedSpans(text)) {
      if (!COMMAND_SHAPED.test(span)) continue;
      commands += 1;
      const script = invokedScript(span);
      assert.ok(SCRIPTS.includes(script), `${rel}: command-shaped span \`${span}\` must invoke one of ${SCRIPTS.join("|")}, got ${script}`);
    }
  }
  assert.ok(commands >= 8, `the prose names the commands it rests on (${commands} command spans found)`);
});

test("SKILL.md frontmatter: agentskills.io shape (name, description, license, metadata), name matches the directory, description states triggers", () => {
  const text = read("SKILL.md");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, "frontmatter block present");
  const fm = m[1];
  assert.match(fm, /^name: threat-modeling$/m);
  const desc = fm.match(/^description: (.*)$/m);
  assert.ok(desc, "description present");
  assert.match(desc[1].replace(/^"|"$/g, ""), /^Use when /);
  assert.ok(desc[1].length <= 1024, "description within the agentskills.io limit");
  assert.match(fm, /^license: /m);
  assert.match(fm, /^metadata:\n\s+authors:\n\s+- "[^"]+ <[^>]+>"/m, "metadata.authors present, quoted");
  assert.doesNotMatch(fm, /^(tools|allowed-tools):/m);
  for (const name of REFERENCES) assert.ok(m[2].includes(`references/${name}.md`), `SKILL.md links references/${name}.md`);
});

test("SKILL.md carries the four standing rules, the return line, both tm-lint commands and the write-once reading", () => {
  const text = read("SKILL.md");
  const prose = text.replace(/\s+/g, " ");
  assert.match(prose, /External text proposes; only scope- and target-validated references act/);
  assert.match(prose, /Writable paths:\*\* `\.agents\/security-testing\/\*\*` and `\.agents\/memory\/<role>\/\*\*`/);
  assert.match(prose, /You write assertions, never states, verdicts, ids or gate stamps/);
  assert.match(prose, /Never merge, close, rotate or fix/);
  assert.match(text, /`MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>`/, "spec §4: the threat-modeler's return line");
  assert.match(text, /`TM elements=<n> threats=<n> undisposed=<n>`/, "plan §4.4: the TM line the return line repeats");
  assert.match(text, /tm-lint\.mjs check --run <run_id>/);
  assert.match(text, /tm-lint\.mjs render --run <run_id>/);
  assert.match(text, /build-report --template threat-model/);
  assert.match(text, new RegExp(`\`${SNAPSHOT_EXISTS}\``), "G-10: a different model against a snapshotted run");
  assert.match(text, /write-once/);
  assert.match(text, new RegExp(TM_DIRTY_CITATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")), "PM ruling R2 verbatim");
  assert.match(text, /threat-model\.schema\.json/);
  assert.doesNotMatch(text, /UNGATED|exact checkout/, "G-13 forbidden strings");
});

test("dfd-elements and stride cover the schema's element kinds and STRIDE letters; the range rule matches cite-core's tokens", () => {
  const dfd = ref("dfd-elements");
  for (const kind of SCHEMA.$defs.Element.properties.kind.enum) assert.ok(dfd.includes(`\`${kind}\``), `dfd-elements names element kind ${kind}`);
  for (const token of [PATH_NOT_IN_SCOPE, RANGE_TOO_LONG, RANGE_NOT_ADMITTED]) assert.ok(dfd.includes(`\`${token}\``), `dfd-elements names ${token}`);
  assert.match(dfd, /at most 40 lines/);
  assert.match(dfd, /`head`/);
  assert.match(dfd, /`base`/);
  assert.match(dfd, /cites a dirty file; build the model on an\s+assessment run/, "R2 wording");
  const stride = ref("stride");
  for (const letter of SCHEMA.$defs.Threat.properties.stride.enum) assert.ok(stride.includes(`\`${letter}\``), `stride names the letter ${letter}`);
  assert.match(stride, /\| kind \| S \| T \| R \| I \| D \| E \|/, "the applicability table");
  assert.match(stride, /subject_kind: threat/, "a register row on a threat");
});

test("mitigations-as-claims: claims, never states — the three derived states, the mitigation-review contract, the not-reviewed wording", () => {
  const text = ref("mitigations-as-claims");
  assert.match(text, /a claim, not a fact/);
  for (const state of [MITIGATION_CONFIRMED, MITIGATION_GAP, MITIGATION_INDETERMINATE]) assert.ok(text.includes(state), `names ${state}`);
  assert.match(text, /packet --run <run_id> --kind subject --subject\s+M-nnn/);
  assert.match(text, /receipt validate --run <run_id> <receipt>/);
  assert.match(text, /assertion: confirmed \| gap \| indeterminate/);
  assert.match(text, /\*\*fresh\*\* `security-reviewer`/);
  assert.ok(text.includes(NOT_INDEPENDENTLY_REVIEWED), "the report's wording for a mitigation without a receipt");
  assert.match(text, /never grade your own claim/);
});

test("dispositions: every kind and every resolved_via of the schema, the sign-off policies, and the exact TM-INVALID wordings tm-lint-core prints", () => {
  const text = ref("dispositions");
  for (const kind of DISPOSITION_KINDS) assert.ok(text.includes(`\`${kind}\``), `names disposition kind ${kind}`);
  for (const via of RESOLVED_VIA) assert.ok(text.includes(`\`${via}\``), `names resolved_via ${via}`);
  assert.deepEqual([...DISPOSITION_KINDS], SCHEMA.$defs.Disposition.properties.kind.enum);
  for (const policy of ["executed-or-ticketed", "all", "none"]) assert.ok(text.includes(`\`${policy}\``), `names sign-off policy ${policy}`);
  assert.match(text, /`DISPOSITIONS\(<threat ids>\)`/);
  assert.match(text, /authenticated: false/, "an acceptance disposes, it approves nothing (D15, G-8)");
  assert.match(text, /dispositions\.json/);
  assert.match(text, /run snapshot register/);
  assert.match(text, /run snapshot proposals/);
  assert.match(text, /ingest tracker-readback/);
  // the wordings, derived from the core with evidence that knows nothing (and a row that disagrees)
  const none = { proposal: () => false, admission: () => false, observation: () => false, readback: () => false, row: () => undefined, mitigationState: () => undefined };
  const threat = (id, disposition, mitigations = []) => ({ id, element_id: "E-001", stride: "T", title: "t", mitigations, disposition });
  const reason = (t, evidence = none) => lintDispositions({ elements: [], threats: [t] }, evidence).error.reason;
  const expected = [
    reason(threat("T-002", { kind: "planned", ref: "P-009" })),
    reason(threat("T-006", { kind: "accepted", ref: "R-0001" })),
    reason(threat("T-006", { kind: "accepted", ref: "R-0001" }), { ...none, row: () => ({ subject: "T-002", status: "accepted" }) }),
    reason(threat("T-006", { kind: "accepted", ref: "R-0001" }), { ...none, row: () => ({ subject: "T-006", status: "open" }) }),
    reason(threat("T-007", { kind: "mitigated", ref: "M-001" })),
    reason(threat("T-007", { kind: "mitigated", ref: "M-001" }, [{ id: "M-001", claim: "c" }])),
  ];
  for (const r of expected) assert.ok(text.includes(r), `dispositions.md quotes the script's wording: ${r}`);
  assert.ok(text.includes("no admission record admissions/"));
  assert.ok(text.includes("no observation observations/"));
  assert.ok(text.includes("no tracker-readback record shows a ticket body at that url carrying"));
  assert.doesNotMatch(text, /\bconfirm\b(?! state)/i, "no `confirm` command, no confirmed state (D15); `confirmed` is the reviewer's assertion only");
});
