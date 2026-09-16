// TASK-046 — the `risk-register` skill (US-040 AC-1/AC-2; plan §5 TASK-046;
// spec §5 row, §6.8, D15, G-8).
//
// The skill is prose; what this file pins is that the prose stays TRUE
// against the bundle's own scripts: it ships no scripts of its own (every
// command lives in security-evidence, D1), its transition page describes
// every event of `register-transitions.TRANSITIONS` — every `from → to`
// pair, every required flag, every emitter, and which events are
// emitter-only — by iterating that export (never a copy), its approvals page
// names every key of `APPROVAL_KEYS` with `authenticated: false`, the text
// says there is no confirmed state, open exposure is spelled from
// `EXPOSED_STATUSES`, the anchor page names the three `anchor verify`
// tokens, and `register.mjs render` is named with the view's eight columns
// taken from `register-render.COLUMNS`. Everything is read as text — no
// Markdown parser, no YAML parser (stdlib only, G-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPOSED_STATUSES } from "./lib/register-fold.mjs";
import { COLUMNS, UNAUTHENTICATED_SENTENCE } from "./lib/register-render.mjs";
import { APPROVAL_KEYS, EMITTER_ONLY_EVENTS, EVENTS, NO_ROW, TRANSITIONS } from "./lib/register-transitions.mjs";
import { ANCHOR_DIVERGED, ANCHOR_MATCH, ANCHOR_TRUNCATED, CORRUPT, EQUIVALENCE_REQUIRED, REGISTER_STATUSES, emitterOnly, transitionRejected } from "./lib/tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..", "..", "risk-register");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const REFERENCES = ["transitions", "approvals", "anchor"];

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

const SCRIPTS = ["evidence.mjs", "verify.mjs", "register.mjs"];
/** A span "names a command" when it invokes a program or a `.mjs` file. */
const COMMAND_SHAPED = /^(?:node|git|npm|npx|gh|curl|sh|bash|python3?|pip)\b|\.mjs\b/;

/** The script name a command-shaped span invokes, with an optional `node <dir>/` prefix stripped. */
function invokedScript(span) {
  const s = span.replace(/^node\s+/, "").replace(/^(?:\$?\{?<[^>]+>\}?\/|[\w.@-]+\/)+/, "");
  return s.split(/\s+/)[0];
}

/**
 * The prose form of one `from → to` pair, as references/transitions.md
 * spells it: statuses backticked, "no row" for NO_ROW, "same" for a
 * status-preserving event. Derived from the table's own vocabulary so a
 * renamed status fails here, not in a reader's head.
 */
const pair = (from, to) => `${from === NO_ROW ? "no row" : `\`${from}\``} → ${to === NO_ROW ? "no row" : to === "same" ? "same" : `\`${to}\``}`;

/** Does the text name a result token verbatim, backticked, with or without the house-style exit-code prefix (`` `4 TOKEN` ``)? */
function namesToken(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\`(?:\\d )?${escaped}\``).test(text);
}

/** The paragraph of references/transitions.md that describes one event (its `### \`<event>\`` section). */
function eventSection(text, event) {
  const heading = `### \`${event}\``;
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `transitions.md has a section ${heading}`);
  const next = text.indexOf("\n### ", start + heading.length);
  return text.slice(start, next === -1 ? text.length : next);
}

test("no scripts/; every event of register-transitions.TRANSITIONS and the approval record shape are described; text says there is no confirmed state; render is named", () => {
  assert.ok(existsSync(SKILL_MD), "SKILL.md exists");
  assert.ok(!existsSync(join(SKILL_DIR, "scripts")), "US-040 AC-1: the skill ships no scripts/ (register.mjs lives in security-evidence, D1)");
  for (const name of REFERENCES) assert.ok(existsSync(join(SKILL_DIR, "references", `${name}.md`)), `references/${name}.md exists`);
  assert.deepEqual(readdirSync(SKILL_DIR).sort(), ["SKILL.md", "references"], "the skill is SKILL.md + references/ and nothing else");
  assert.deepEqual(readdirSync(join(SKILL_DIR, "references")).sort(), REFERENCES.map((n) => `${n}.md`).sort(), "exactly the three references the plan names");

  // Every event of the table, iterated from the export (US-040 AC-2 against US-021 AC-1).
  const transitions = ref("transitions");
  assert.ok(EVENTS.length >= 13, `the table TASK-029 shipped (${EVENTS.length} events)`);
  for (const event of EVENTS) {
    const spec = TRANSITIONS[event];
    const section = eventSection(transitions, event);
    if (spec.from === "any") {
      assert.match(section, /any status/, `${event}: from any status`);
      assert.match(section, /status unchanged/, `${event}: the status is unchanged`);
    } else if (spec.from.length === 0) {
      assert.match(section, /never touches a row|no row/, `${event}: touches no row`);
    } else {
      for (const from of spec.from) assert.ok(section.includes(pair(from, spec.to)), `${event}: describes the pair ${pair(from, spec.to)}`);
    }
    for (const flag of spec.requires) assert.ok(section.includes(`\`--${flag}`), `${event}: names the required flag --${flag}`);
    for (const emitter of spec.emitters) assert.ok(section.includes(`\`${emitter}\``), `${event}: names its emitter \`${emitter}\``);
    if (EMITTER_ONLY_EVENTS.includes(event)) assert.match(section, /emitter-only/, `${event}: is described as emitter-only`);
  }
  // Every status of the closed vocabulary is named, so the reader can place any row.
  for (const status of REGISTER_STATUSES) assert.ok(transitions.includes(`\`${status}\``), `transitions.md names the status \`${status}\``);
  assert.ok(namesToken(transitions, transitionRejected("<event>", "<from>")), "a pair outside the table is TRANSITION-REJECTED(<event>: <from>)");
  assert.ok(namesToken(transitions, emitterOnly("<event>")), "the generic transition verb refuses emitter-only events with EMITTER-ONLY(<event>)");
  assert.ok(namesToken(transitions, EQUIVALENCE_REQUIRED), "supersede with neither flag is EQUIVALENCE-REQUIRED");

  // The approval record shape (US-021 AC-3), key by key.
  const approvals = ref("approvals");
  for (const key of APPROVAL_KEYS) assert.ok(approvals.includes(`\`${key}\``), `approvals.md names the record key \`${key}\``);
  assert.match(approvals, /`until`/, "an acceptance carries until");
  assert.match(approvals, /authenticated: false/, "the record is stored as authenticated: false");

  // There is no confirmed state (D15, G-8) — the plan's sentence, verbatim, in SKILL.md.
  const skill = read("SKILL.md");
  assert.ok(skill.includes("there is no confirmed state — no command creates one"), "SKILL.md: there is no confirmed state — no command creates one");
  assert.match(skill, /`confirm`/, "the reader knows there is no confirm command");

  // render is named, with the view's eight columns in the renderer's order.
  assert.match(skill, /`register\.mjs render`|register\.mjs render/, "SKILL.md names register.mjs render");
  assert.match(skill, /`risk-register\.md`|risk-register\.md/, "SKILL.md names the rendered view");
  assert.equal(COLUMNS.length, 8, "the view has eight columns (PM log after TASK-059 review 1)");
  assert.ok(skill.includes(COLUMNS.join(" | ")), `SKILL.md spells the eight columns in order: ${COLUMNS.join(" | ")}`);
});

test("SKILL.md frontmatter: agentskills.io shape, name matches the directory, description states triggers only", () => {
  const text = read("SKILL.md");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, "frontmatter block present");
  const fm = m[1];
  assert.match(fm, /^name: risk-register$/m);
  const desc = fm.match(/^description: (.*)$/m);
  assert.ok(desc, "description present");
  assert.match(desc[1].replace(/^"|"$/g, ""), /^Use when /, "description starts with the trigger, not a workflow summary");
  assert.ok(desc[1].length <= 1024, "description within the agentskills.io limit");
  assert.match(fm, /^license: /m, "license present (plan §5 TASK-046)");
  assert.match(fm, /^metadata:\n(?:  .*\n?)+/m, "metadata block present");
  assert.match(fm, /^  version: "\d+\.\d+\.\d+"$/m, "metadata.version is a quoted semver");
  for (const name of REFERENCES) assert.ok(m[2].includes(`references/${name}.md`), `SKILL.md links references/${name}.md`);
});

test("every backticked command starts with evidence.mjs|verify.mjs|register.mjs; no forbidden strings; no authenticated record spelled true", () => {
  let commands = 0;
  for (const { rel, text } of skillFiles()) {
    for (const span of backtickedSpans(text)) {
      if (!COMMAND_SHAPED.test(span)) continue;
      commands += 1;
      const script = invokedScript(span);
      assert.ok(SCRIPTS.includes(script), `${rel}: command-shaped span \`${span}\` must invoke one of ${SCRIPTS.join("|")}, got ${script}`);
    }
    assert.doesNotMatch(text, /UNGATED|exact checkout/, `${rel}: G-13 forbidden strings`);
    assert.doesNotMatch(text, /authenticated:\s*true/, `${rel}: G-8 — an approval record is never spelled authenticated: true, not even as an example`);
    assert.doesNotMatch(text, /register\.mjs confirm/, `${rel}: no confirm command is ever invoked`);
  }
  assert.ok(commands >= 12, `the skill names the register commands (${commands} command spans found)`);
});

test("open exposure is spelled from EXPOSED_STATUSES and never reduced by an approval; the approval state is read from status", () => {
  const skill = read("SKILL.md");
  const approvals = ref("approvals");
  assert.equal(EXPOSED_STATUSES.length, 4, "the four exposed statuses TASK-028/029 shipped (PM log after TASK-029 review 1)");
  for (const status of EXPOSED_STATUSES) assert.ok(approvals.includes(`\`${status}\``), `approvals.md names the exposed status \`${status}\``);
  assert.match(approvals, /never reduce[sd]? open exposure|open exposure is never reduced/i, "approvals never reduce open exposure (G-8)");
  assert.match(skill, /never reduce[sd]? open exposure|open exposure is never reduced/i, "SKILL.md says it too");
  assert.match(approvals, /`open_exposure`/, "the status --json key");
  assert.match(approvals, /`unauthenticated_approvals`/, "the one approvals bucket");
  assert.match(approvals, /register\.mjs status --json/, "where to read the numbers");
  assert.ok(approvals.includes(UNAUTHENTICATED_SENTENCE), "the rendered view's sentence, verbatim");
  assert.match(approvals, /read (?:the approval state )?from `status`, never from the record's presence/, "register-transitions.mjs header invariant");
  assert.match(approvals, /`superseded`[^\n]*history|history[^\n]*`superseded`/, "a superseded row may keep a record as history");
  assert.match(approvals, /`acceptance-expired`/, "expiry is an event the reader can recognise");
  assert.match(approvals, /00:00 UTC/, "when an acceptance lapses (register-transitions.mjs header)");
});

test("anchor page names anchor print, anchor verify --expect, the three tokens, and where the anchor lives (outside the repo)", () => {
  const text = ref("anchor");
  assert.match(text, /register\.mjs anchor print/);
  assert.match(text, /register\.mjs anchor verify --expect <engagement_id:seq:hash>/);
  assert.match(text, /`<engagement_id>:<seq>:<chain_sha256>`/, "the anchor's shape");
  for (const token of [ANCHOR_MATCH, ANCHOR_TRUNCATED, ANCHOR_DIVERGED, CORRUPT]) assert.ok(namesToken(text, token), `anchor.md names \`${token}\``);
  assert.match(text, /outside the repo(?:sitory)?/i, "the anchor is kept outside the repository");
  assert.match(text, /evidence\.mjs sign-off --engagement <engagement_id> --expect <anchor>/, "sign-off consumes the held anchor");
  assert.match(text, /after (?:the|every) (?:last )?register change|after every (?:register )?(?:change|mutation)/i, "print a fresh anchor after the last change (DIVERGED also means the log advanced)");
  assert.match(text, /`(?:<st>\/register\/)?events\.jsonl`/, "the anchor is over the hash-chained log");
  assert.match(text, /`(?:<st>\/register\/)?finding-alias\.jsonl`/, "the alias log is chained too and is not witnessed by the anchor (PM log after TASK-029 review 1)");
  const skill = read("SKILL.md");
  assert.match(skill, /register\.mjs anchor print/, "SKILL.md names anchor print");
});

test("SKILL.md says what a row is: every row field, the subject kinds, the id shape and the model of record", () => {
  const skill = read("SKILL.md");
  const fields = ["id", "subject", "subject_kind", "title", "status", "priority", "owner", "first_seen_run", "last_verified_run", "ticket_url", "test_refs", "proposal_refs", "acceptance", "false_positive", "ack_refs", "rationale", "supersedes", "superseded_by"];
  for (const f of fields) assert.ok(skill.includes(`\`${f}\``), `SKILL.md names the row field \`${f}\``);
  assert.match(skill, /`R-nnnn`/, "row ids");
  assert.match(skill, /`finding`[^\n]*`threat`|`threat`[^\n]*`finding`/, "subject kinds");
  assert.match(skill, /`(?:<st>\/register\/)?events\.jsonl`/, "the log");
  assert.match(skill, /`(?:<st>\/register\/)?projection\.json`/, "the projection");
  assert.match(skill, /model of record/, "D14: the JSON is the model of record; the Markdown is a view");
  assert.match(skill, /context-docs|context doc/, "risk-register.md is the injected context-doc");
  assert.match(skill, /ingest tracker-readback/, "the one emitter of ticketed is named where the lead will look for it");
  for (const event of EMITTER_ONLY_EVENTS) assert.ok(skill.includes(`\`${event}\``), `SKILL.md names the emitter-only event \`${event}\``);
  assert.match(skill, /by hand/, "why the lead cannot append emitter-only events by hand");
});
