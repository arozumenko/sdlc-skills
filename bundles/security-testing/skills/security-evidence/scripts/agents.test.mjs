// TASK-036 — the `security-reviewer` agent, its SOUL, standing rules and
// briefing (US-028 AC-1…AC-3; plan §4.7 frontmatter contract, §5 TASK-036;
// spec §4 body rules 1–4, §6.4 packet discipline, §20 P1).
//
// The agent is prose; what this file pins is the CONTRACT the rest of the
// bundle builds on: the frontmatter the tech-lead reviews against §4.7 (and
// that `factory.json`, TASK-037, will list), the four §4 rules, the four
// dispatch contracts with their closed return-line grammars, and the P1
// invariant that the `review` contract never instructs a receipt. The
// frontmatter is read with the same line-based reading the installer uses —
// no YAML parser (stdlib only, G-11).
//
// TASK-040 extends it with the `threat-modeler` agent (US-032 AC-1…AC-3;
// plan §4.7 "threat-modeler (M2)", §5 TASK-040; spec §4 row, §6.10): the
// frontmatter block, the same four rules, and the return-line rule —
// `MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>` only after
// `tm-lint.mjs check` exits 0, otherwise the lint line verbatim — plus the
// mitigations-as-claims invariant (a `mitigation-review` is a separate
// `security-reviewer` dispatch over a subject packet; the modeler never
// writes a mitigation state).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..", "..", "..");
const BUNDLE = resolve(HERE, "..", "..", "..");
const AGENT_DIR = join(BUNDLE, "agents", "security-reviewer");
const AGENT_MD = join(AGENT_DIR, "AGENT.md");
const BRIEFING = join(BUNDLE, "briefings", "security-reviewer.md");
const TECH_LEAD_MD = join(REPO, "bundles", "feature-development", "agents", "tech-lead", "AGENT.md");

/** `{fm, body}` — the text between the first `---` pair and everything after it. */
function split(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, "no frontmatter block");
  return { fm: m[1], body: m[2] };
}

/** Top-level `key: value` lines of a frontmatter block, in file order (block-form children are collected under their parent). */
function topLevel(fm) {
  const out = new Map();
  let current = null;
  for (const line of fm.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):(?:\s+(.*))?$/);
    if (kv) {
      current = kv[1];
      out.set(current, { value: kv[2] ?? "", children: [] });
    } else if (current && /^\s+\S/.test(line)) {
      out.get(current).children.push(line);
    }
  }
  return out;
}

/** `[a, b]` flow sequence → `["a", "b"]` (quotes stripped). */
function flowList(value) {
  const m = value.match(/^\[(.*)\]$/);
  assert.ok(m, `expected a flow list, got ${value}`);
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** The `## <name>` sections of a body: `{name, text}` in order (text = everything up to the next `## `). */
function h2Sections(body) {
  const out = [];
  const re = /^## (.+)$/gm;
  let m;
  const marks = [];
  while ((m = re.exec(body)) !== null) marks.push({ name: m[1].trim(), start: m.index, after: m.index + m[0].length });
  marks.forEach((mk, i) => out.push({ name: mk.name, text: body.slice(mk.after, i + 1 < marks.length ? marks[i + 1].start : body.length) }));
  return out;
}

/** The `### <name>` subsections of a section text, same shape. */
function h3Sections(text) {
  const out = [];
  const re = /^### (.+)$/gm;
  let m;
  const marks = [];
  while ((m = re.exec(text)) !== null) marks.push({ name: m[1].trim(), start: m.index, after: m.index + m[0].length });
  marks.forEach((mk, i) => out.push({ name: mk.name, text: text.slice(mk.after, i + 1 < marks.length ? marks[i + 1].start : text.length) }));
  return out;
}

/**
 * A payload field named as a field, not as a word: the backticked form
 * (`` `type` ``), the JSON-key form (`"type":`), or a member of a backticked
 * object literal (`{type: …, subject_id, …}`). PM log (TASK-036 follow-up):
 * the earlier `\`?key\`?` matched the bare word anywhere (`type` in "typed
 * citations"), so it was weaker than it read.
 */
function fieldRe(key) {
  return new RegExp(`\`${key}\`|"${key}"\\s*:|[{,]\\s*${key}\\s*[:,}]`);
}

/** `{fm, sections, section(name)}` for one agent's AGENT.md — read inside the test so a missing file fails that test, not the file. */
function loadAgent(agentMd) {
  const agent = split(readFileSync(agentMd, "utf8"));
  const sections = h2Sections(agent.body);
  return { body: agent.body, fm: topLevel(agent.fm), sections, section: (name) => sections.find((s) => s.name.startsWith(name)) };
}

const agent = split(readFileSync(AGENT_MD, "utf8"));
const fm = topLevel(agent.fm);
const sections = h2Sections(agent.body);
const section = (name) => sections.find((s) => s.name.startsWith(name));

// --- US-028 AC-1: frontmatter equals the §4.7 contract -------------------

test("security-reviewer frontmatter equals the §4.7 contract", () => {
  const get = (k) => fm.get(k)?.value;
  assert.equal(get("name"), "security-reviewer");
  assert.equal(
    get("description"),
    '"Use when a security-lead dispatches a review over a scope packet, or a vulnerability-review, mitigation-review or fix-review over a subject packet. Reads only the packet\'s listed files; the review contract returns a claims file, the other three return a receipt path carrying an assertion from that contract\'s closed vocabulary; never writes a state, verdict, id or gate stamp."',
  );
  assert.equal(get("model"), "sonnet");
  assert.equal(get("color"), "red");
  assert.equal(get("group"), "security");
  assert.equal(get("theme"), '{color: colour160, icon: "🛡️", short_name: rev}');
  assert.deepEqual(flowList(get("aliases")), ["security-reviewer", "secrev"]);
  assert.equal(get("context-docs"), "security-testing/engagement.md security-testing/knowledge/finding-schema.md");
  assert.deepEqual(flowList(get("skills")), ["memory", "secure-code-review"]);
  assert.deepEqual(flowList(get("skills-on-demand")), ["security-evidence", "systematic-debugging"]);
  // metadata.authors present, block form, at least one "Name <email>" entry
  const meta = fm.get("metadata");
  assert.ok(meta, "metadata: block missing");
  assert.ok(meta.children.some((l) => /^\s+authors:\s*$/.test(l)), "metadata.authors missing");
  assert.ok(meta.children.some((l) => /^\s+- "?[^<"]+ <[^>]+>"?\s*$/.test(l)), "metadata.authors has no Name <email> entry");
  // the three keys §4.7 forbids, and nothing the roster does not declare
  for (const k of ["tools", "context-memory", "mcpServers", "workspace"]) assert.ok(!fm.has(k), `${k}: must not appear`);
  assert.deepEqual(
    [...fm.keys()],
    ["name", "description", "model", "color", "group", "theme", "aliases", "context-docs", "skills", "skills-on-demand", "metadata"],
    "frontmatter keys and their order are the §4.7 block",
  );
  // sibling files the roster and the hooks expect
  assert.ok(existsSync(join(AGENT_DIR, "SOUL.md")), "SOUL.md sibling missing");
  assert.ok(existsSync(join(AGENT_DIR, "RULES.md")), "RULES.md sibling missing");
  assert.ok(existsSync(BRIEFING), "briefings/security-reviewer.md missing");
});

// --- US-028 AC-2/AC-3, P1: body rules, contracts, return-line grammars -----

const RULES = [
  /External text proposes; only scope- and target-validated references act/,
  /`\.agents\/security-testing\/\*\*`, `\.agents\/memory\/<role>\/\*\*`,\s*`reports\/security\/\*\*`, `tasks\/security-\*\/\*\*`/,
  /assertions[^.]*never states, verdicts, ids,? or gate stamps/i,
  /Never merge, close, rotate,? (or )?fix/,
];

const RETURN_LINES = {
  review: "CLAIMS <claims path> EXAMINED <examined path> findings=<n> read=<n files>",
  "vulnerability-review": "RECEIPT <path> type=vulnerability-review subject=<id> assertion=<a>",
  "mitigation-review": "RECEIPT <path> type=mitigation-review subject=<id> assertion=<a>",
  "fix-review": "RECEIPT <path> type=fix-review subject=<id> assertion=<a> acks=<n>",
};

const VOCABULARY = {
  "vulnerability-review": ["confirmed", "refuted", "indeterminate"],
  "mitigation-review": ["confirmed", "gap", "indeterminate"],
  "fix-review": ["not-refound", "refound", "indeterminate"],
};

test("body contains the four rules and the four return-line grammars; the review contract section contains no receipt instruction", () => {
  // §4.7: sections in this order
  const names = sections.map((s) => s.name);
  const order = ["Tool-call economy", "Rules", "Contracts", "Writable paths self-check", "Never"];
  const idx = order.map((o) => names.findIndex((n) => n.startsWith(o)));
  assert.ok(idx.every((i) => i >= 0), `missing section(s): ${order.filter((_, i) => idx[i] < 0).join(", ")} in ${names.join(" | ")}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `sections out of §4.7 order: ${names.join(" | ")}`);

  // the four §4 rules, in the Rules section
  const rules = section("Rules").text;
  RULES.forEach((re, i) => assert.match(rules, re, `rule ${i + 1} missing from ## Rules`));

  // the four contracts, each a ### subsection carrying its exact return line
  const contracts = h3Sections(section("Contracts").text);
  const byName = Object.fromEntries(contracts.map((c) => [c.name.replace(/`/g, "").split(/\s/)[0], c.text]));
  for (const [name, line] of Object.entries(RETURN_LINES)) {
    assert.ok(byName[name], `### ${name} subsection missing (found: ${Object.keys(byName).join(", ")})`);
    assert.ok(byName[name].includes(line), `### ${name} does not carry its return line verbatim: ${line}`);
  }
  // the closed assertion vocabularies, per contract
  for (const [name, words] of Object.entries(VOCABULARY)) {
    for (const w of words) assert.match(byName[name], new RegExp(`\`${w}\``), `### ${name} does not spell \`${w}\``);
  }
  // the receipt payload shape every receipt contract writes (spec §6.4)
  for (const name of Object.keys(VOCABULARY)) {
    for (const key of ["type", "subject_id", "packet_sha256", "assertion", "reviewer_run_id"]) {
      assert.match(byName[name], fieldRe(key), `### ${name} does not name receipt field ${key}`);
    }
  }
  // fix-review: ack receipts per indicator, `{indicator_id}`
  assert.match(byName["fix-review"], /`ack`/);
  assert.match(byName["fix-review"], /indicator_id/);

  // review: claims + examined files under the drop-box, naming scope_sha256 and packet_sha256; NO receipt instruction (P1)
  const review = byName.review;
  assert.match(review, /claims-<n>\.json/);
  assert.match(review, /examined-<n>\.json/);
  assert.match(review, /scope_sha256/);
  assert.match(review, /packet_sha256/);
  assert.match(review, /declared/);
  assert.match(review, /\.agents\/security-testing\/receipts\/<run_id>\//);
  // the drop-box directory is literally named `receipts/`; strip it and every negation before looking for an instruction
  const negated = review.replace(/receipts\/<run_id>\//g, "").replace(/\b(never|no|not) (a |an )?receipts?\b/gi, "");
  assert.doesNotMatch(negated, /receipt/i, "the review contract must not instruct a receipt (spec §20 P1); only negations may mention one");
  assert.doesNotMatch(review, /RECEIPT </, "the review contract must not return a RECEIPT line");

  // fresh-dispatch refusal for the three assertion contracts (spec §6.4 "never the instance that authored the claim")
  for (const name of Object.keys(VOCABULARY)) assert.match(byName[name], /fresh dispatch|fresh context|refuse/i, `### ${name} lacks the fresh-dispatch rule`);

  // the admitting commands belong to the lead, never run by the agent on its own output
  const contractsText = section("Contracts").text + section("Never").text;
  assert.match(contractsText, /receipt validate/);
  assert.match(contractsText, /gate --claims|`gate`/);
  assert.match(contractsText, /coverage --examined|`coverage`/);
});

test("Tool-call economy block is verbatim from the tech-lead agent; Writable paths self-check and Never carry the §4 lists", () => {
  const tl = h2Sections(split(readFileSync(TECH_LEAD_MD, "utf8")).body).find((s) => s.name.startsWith("Tool-call economy"));
  const mine = section("Tool-call economy");
  assert.equal(mine.name, tl.name);
  assert.equal(mine.text.trim(), tl.text.trim(), "## Tool-call economy must be the tech-lead block verbatim (plan §4.7)");

  const wp = section("Writable paths self-check").text;
  for (const p of [".agents/security-testing/**", ".agents/memory/<role>/**", "reports/security/**", "tasks/security-*/**"]) {
    assert.ok(wp.includes(p), `writable path ${p} missing from the self-check`);
  }
  assert.match(wp, /\.gitignore/);
  assert.match(wp, /engagement init/);

  const never = section("Never").text;
  for (const w of ["merge", "close", "rotate", "fix"]) assert.match(never, new RegExp(`\\b${w}\\b`, "i"), `## Never lacks "${w}"`);
  for (const w of ["state", "verdict", "id", "gate stamp"]) assert.match(never, new RegExp(`\\b${w}s?\\b`, "i"), `## Never lacks "${w}"`);
});

test("citations and declarations count normalised (non-blank) lines; snapshot-side files are read from the private snapshot", () => {
  // PM-log follow-ups from TASK-014 / TASK-020: `gate` and `coverage` index normalised lines.
  assert.match(agent.body, /non-blank/);
  assert.match(agent.body, /private\/snapshots\/<run_id>\//);
  assert.match(agent.body, /git show <oid>/);
});

// --- siblings: SOUL, RULES, briefing ---------------------------------------

test("SOUL.md, RULES.md and the briefing carry the reviewer's posture", () => {
  const soul = readFileSync(join(AGENT_DIR, "SOUL.md"), "utf8");
  assert.match(soul, /^# Soul/m);
  assert.match(soul, /## Voice/);
  assert.match(soul, /## Values/);
  assert.match(soul, /assertion/i);

  const rules = readFileSync(join(AGENT_DIR, "RULES.md"), "utf8");
  assert.match(rules, /^# Rules — security-reviewer/m);
  for (const re of RULES) assert.match(rules, re, `RULES.md is missing a §4 rule: ${re}`);
  assert.match(rules, /fresh/i);

  const briefing = split(readFileSync(BRIEFING, "utf8"));
  const bfm = topLevel(briefing.fm);
  assert.equal(bfm.get("name")?.value, "Project briefing");
  assert.equal(bfm.get("type")?.value, "project");
  assert.match(bfm.get("description")?.value ?? "", /security-testing\/security-reviewer/);
  assert.match(briefing.body, /## Project Knowledge/);
  assert.match(briefing.body, /## My Role Focus/);
  // where packets arrive; whose commands `receipt validate` / `gate` are
  assert.match(briefing.body, /runs\/<run_id>\/packets\//);
  assert.match(briefing.body, /receipts\/<run_id>\//);
  assert.match(briefing.body, /receipt validate/);
  assert.match(briefing.body, /gate/);
  assert.match(briefing.body, /lead'?s command|the lead runs|not yours/i);
});

// ===========================================================================
// TASK-040 — the `threat-modeler` agent (US-032 AC-1…AC-3; plan §4.7
// "threat-modeler (M2)", §5 TASK-040; spec §4 row, §6.10).
// ===========================================================================

const TM_DIR = join(BUNDLE, "agents", "threat-modeler");
const TM_MD = join(TM_DIR, "AGENT.md");
const TM_BRIEFING = join(BUNDLE, "briefings", "threat-modeler.md");
/** The one return line (spec §4 row; plan §5 TASK-040): the `TM` counts `tm-lint check` printed, restated. */
const TM_RETURN = "MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>";
/** What `tm-lint.mjs check` prints on exit 0 (lib/tokens.mjs `tmLine`); the return line repeats its integers. */
const TM_LINE = "TM elements=<n> threats=<n> undisposed=<n>";
/** The real command spelling (lib/cmd-tm-lint.mjs header; the skill's step 6). */
const TM_CHECK = "tm-lint.mjs check --run <run_id>";

// --- US-032 AC-1: frontmatter equals the §4.7 "threat-modeler (M2)" block ---

test("threat-modeler frontmatter equals the §4.7 contract", () => {
  const { fm } = loadAgent(TM_MD);
  const get = (k) => fm.get(k)?.value;
  assert.equal(get("name"), "threat-modeler");
  const description = get("description") ?? "";
  assert.match(description, /^"Use when .*"$/, "description is one double-quoted 'Use when …' sentence (frontmatter-strict)");
  assert.match(description, /security-lead/);
  assert.match(description, /MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>/, "description names the return line");
  assert.match(description, /never writes a state, verdict, id or gate stamp/);
  assert.equal(get("model"), "opus");
  assert.equal(get("color"), "magenta");
  assert.equal(get("group"), "security");
  assert.equal(get("theme"), '{color: colour135, icon: "🕸️", short_name: tm}');
  assert.deepEqual(flowList(get("aliases")), ["threat-modeler", "tm"]);
  assert.equal(get("context-docs"), "security-testing/engagement.md security-testing/knowledge/finding-schema.md");
  assert.deepEqual(flowList(get("skills")), ["memory", "threat-modeling"]);
  assert.deepEqual(flowList(get("skills-on-demand")), ["security-test-planning", "security-evidence", "gathering-context", "deep-research"]);
  const meta = fm.get("metadata");
  assert.ok(meta, "metadata: block missing");
  assert.ok(meta.children.some((l) => /^\s+authors:\s*$/.test(l)), "metadata.authors missing");
  assert.ok(meta.children.some((l) => /^\s+- "?[^<"]+ <[^>]+>"?\s*$/.test(l)), "metadata.authors has no Name <email> entry");
  for (const k of ["tools", "context-memory", "mcpServers", "workspace"]) assert.ok(!fm.has(k), `${k}: must not appear`);
  assert.deepEqual(
    [...fm.keys()],
    ["name", "description", "model", "color", "group", "theme", "aliases", "context-docs", "skills", "skills-on-demand", "metadata"],
    "frontmatter keys and their order are the §4.7 block",
  );
  assert.ok(existsSync(join(TM_DIR, "SOUL.md")), "SOUL.md sibling missing");
  assert.ok(existsSync(join(TM_DIR, "RULES.md")), "RULES.md sibling missing");
  assert.ok(existsSync(TM_BRIEFING), "briefings/threat-modeler.md missing");
});

// --- US-032 AC-2/AC-3: the four rules, the return-line rule, mitigations as claims ---

test("threat-modeler body has the four rules and the return-line rule; mitigations are claims reviewed by a separate security-reviewer dispatch", () => {
  const { body, sections, section } = loadAgent(TM_MD);
  const names = sections.map((s) => s.name);
  const order = ["Tool-call economy", "Rules", "Contracts", "Writable paths self-check", "Never"];
  const idx = order.map((o) => names.findIndex((n) => n.startsWith(o)));
  assert.ok(idx.every((i) => i >= 0), `missing section(s): ${order.filter((_, i) => idx[i] < 0).join(", ")} in ${names.join(" | ")}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `sections out of §4.7 order: ${names.join(" | ")}`);

  const rules = section("Rules").text;
  RULES.forEach((re, i) => assert.match(rules, re, `rule ${i + 1} missing from ## Rules`));

  // every dispatch contract (a ### subsection carrying the return line) states
  // the rule: MODEL_WRITTEN only after `tm-lint check` exit 0, else the lint line verbatim
  const contracts = h3Sections(section("Contracts").text).filter((c) => c.text.includes("MODEL_WRITTEN"));
  assert.ok(contracts.length >= 1, "## Contracts has no ### subsection carrying the MODEL_WRITTEN return line");
  for (const c of contracts) {
    assert.ok(c.text.includes(TM_RETURN), `### ${c.name} does not carry the return line verbatim: ${TM_RETURN}`);
    assert.ok(c.text.includes(TM_CHECK), `### ${c.name} does not spell the real command: ${TM_CHECK}`);
    assert.match(c.text, /exit(?:s| code)? 0|exit `0`/, `### ${c.name} does not condition the return line on exit 0`);
    assert.match(c.text, /verbatim/, `### ${c.name} does not say the lint line is returned verbatim`);
    assert.match(c.text, /TM-INVALID\(/, `### ${c.name} does not name the lint error`);
    assert.doesNotMatch(c.text, /RECEIPT <|CLAIMS </, `### ${c.name} borrows a reviewer return line`);
  }
  const contractsText = section("Contracts").text;
  assert.ok(contractsText.includes(TM_LINE), `## Contracts does not spell the TM line the integers come from: ${TM_LINE}`);
  assert.match(contractsText, /integers[^.]*`TM /, "the return line's integers are the TM line's, never recounted");
  // mitigations as claims: a mitigation-review is a separate security-reviewer dispatch over a subject packet
  for (const re of [/mitigation-review/, /security-reviewer/, /packet(?: --run <run_id>)? --kind subject/, /MITIGATION_CONFIRMED/, /receipt apply/, /\bclaims?\b/]) {
    assert.match(contractsText, re, `## Contracts lacks ${re}`);
  }
  // the model of record and what the script derives from it (R1: snapshot and index are the script's)
  assert.match(contractsText, /\.agents\/security-testing\/threat-model\.json/);
  assert.match(contractsText, /runs\/<run_id>\/threat-model\.json|<run>\/threat-model\.json/);
  assert.match(contractsText, /dispositions\.json/);
  assert.match(contractsText, /scope\.json/);
  // the six disposition kinds are spelled
  for (const k of ["undisposed", "planned", "executed", "ticketed", "accepted", "mitigated"]) {
    assert.match(contractsText, new RegExp(`\`${k}\``), `## Contracts does not spell disposition kind \`${k}\``);
  }
  // one citation per element, normalised lines, ≤ 40 lines, inside the scope
  assert.match(body, /one citation/i);
  assert.match(body, /non-blank/);
  assert.match(body, /40 lines/);
  // the admitting and rendering commands are the lead's; `tm-lint check` is the one script this agent runs
  const leadText = contractsText + section("Never").text;
  for (const cmd of ["receipt validate", "build-report", "tm-lint.mjs render"]) assert.match(leadText, new RegExp(cmd), `the lead's command ${cmd} is not named`);
});

test("threat-modeler: Tool-call economy is verbatim; Writable paths self-check names the model of record; Never carries the §4 lists and the return-line rule", () => {
  const { section } = loadAgent(TM_MD);
  const tl = h2Sections(split(readFileSync(TECH_LEAD_MD, "utf8")).body).find((s) => s.name.startsWith("Tool-call economy"));
  const mine = section("Tool-call economy");
  assert.equal(mine.name, tl.name);
  assert.equal(mine.text.trim(), tl.text.trim(), "## Tool-call economy must be the tech-lead block verbatim (plan §4.7)");

  const wp = section("Writable paths self-check").text;
  for (const p of [".agents/security-testing/**", ".agents/memory/<role>/**", "reports/security/**", "tasks/security-*/**"]) {
    assert.ok(wp.includes(p), `writable path ${p} missing from the self-check`);
  }
  assert.match(wp, /\.gitignore/);
  assert.match(wp, /engagement init/);
  assert.match(wp, /\.agents\/security-testing\/threat-model\.json/, "the self-check names the model of record");
  assert.match(wp, /runs\//, "the self-check says runs/ is the scripts'");

  const never = section("Never").text;
  for (const w of ["merge", "close", "rotate", "fix"]) assert.match(never, new RegExp(`\\b${w}\\b`, "i"), `## Never lacks "${w}"`);
  for (const w of ["state", "verdict", "id", "gate stamp"]) assert.match(never, new RegExp(`\\b${w}s?\\b`, "i"), `## Never lacks "${w}"`);
  assert.match(never, /MODEL_WRITTEN/, "## Never restates: no MODEL_WRITTEN after a non-zero exit");
  assert.match(never, /mitigation-review|mitigated/, "## Never restates: never grade your own mitigation");
});

test("threat-modeler SOUL.md, RULES.md and the briefing carry the modeler's posture", () => {
  const soul = readFileSync(join(TM_DIR, "SOUL.md"), "utf8");
  assert.match(soul, /^# Soul/m);
  assert.match(soul, /## Voice/);
  assert.match(soul, /## Values/);
  assert.match(soul, /\bclaim/i);
  assert.match(soul, /cit(e|ation)/i);

  const rules = readFileSync(join(TM_DIR, "RULES.md"), "utf8");
  assert.match(rules, /^# Rules — threat-modeler/m);
  for (const re of RULES) assert.match(rules, re, `RULES.md is missing a §4 rule: ${re}`);
  assert.ok(rules.includes(TM_RETURN), "RULES.md does not carry the return line");
  assert.ok(rules.includes(TM_CHECK), "RULES.md does not spell the real command");
  assert.match(rules, /verbatim/);
  assert.match(rules, /mitigation-review/);

  const briefing = split(readFileSync(TM_BRIEFING, "utf8"));
  const bfm = topLevel(briefing.fm);
  assert.equal(bfm.get("name")?.value, "Project briefing");
  assert.equal(bfm.get("type")?.value, "project");
  assert.match(bfm.get("description")?.value ?? "", /security-testing\/threat-modeler/);
  assert.match(briefing.body, /## Project Knowledge/);
  assert.match(briefing.body, /## My Role Focus/);
  for (const re of [/\.agents\/security-testing\/threat-model\.json/, /runs\/<run_id>\/scope\.json/, /tm-lint\.mjs check/, /dispositions\.json/, /mitigation-review/, /packet(?: --run <run_id>)? --kind subject/]) {
    assert.match(briefing.body, re, `briefing lacks ${re}`);
  }
  assert.match(briefing.body, /lead'?s command|the lead runs|not yours/i);
});

// ===========================================================================
// TASK-047 — the `security-lead` agent (US-041 AC-1…AC-4; plan §4.7
// "security-lead (M3)", §5 TASK-047; spec §4 row "only human-facing role …
// prints hand-off prompts and stops; proposes acceptances", §9.4 / P4).
//
// What this pins: the frontmatter (third `context-docs` entry is the
// rendered register view, TL-8 / TASK-059), the four rules, an `assess`
// procedure whose commands are the REAL spellings of lib/cmd-*.mjs in the
// P1/P2 order (scope packet → review → gate; every cross-run input enters
// through `run snapshot` before `build-report`) and which ends with the
// hand-off prompt and a stop; a `verify` procedure carrying the two-pass
// stdout contract of `verify all`; a `tracker` procedure naming both dedupe
// layers; and the acceptance rule — the lead proposes, a human approves,
// the record stays `authenticated: false`. Plus the routed prose items the
// PM log assigned to this task (eight-column register view, `--scanner-rows`
// shape, `mitigated` re-dispatch on the new run, `admit --dry-run`,
// candidate order commit → run init → scope → packet --type case, P6
// cleanliness, alias-aware read-back, `2 NO-ROW`, `output=./tasks/…`).
// ===========================================================================

const LEAD_DIR = join(BUNDLE, "agents", "security-lead");
const LEAD_MD = join(LEAD_DIR, "AGENT.md");
const LEAD_BRIEFING = join(BUNDLE, "briefings", "security-lead.md");

/** Each marker must occur AFTER the previous one (a cursor walk, so an earlier mention elsewhere does not satisfy the order). */
function assertOrdered(text, markers, label) {
  let cursor = 0;
  for (const m of markers) {
    const at = text.indexOf(m, cursor);
    assert.ok(at >= 0, `${label}: "${m}" not found after position ${cursor} (previous marker)`);
    cursor = at + m.length;
  }
}

test("security-lead frontmatter equals the §4.7 contract (context-docs third entry is the register view; no mcpServers)", () => {
  const { fm } = loadAgent(LEAD_MD);
  const get = (k) => fm.get(k)?.value;
  assert.equal(get("name"), "security-lead");
  const description = get("description") ?? "";
  assert.match(description, /^"Use when .*"$/, "description is one double-quoted 'Use when …' sentence (frontmatter-strict)");
  assert.match(description, /hand-off prompt/);
  assert.match(description, /stops?\b/);
  assert.match(description, /never writes a state, verdict, id or gate stamp/);
  assert.equal(get("model"), "sonnet");
  assert.equal(get("color"), "red");
  assert.equal(get("group"), "security");
  assert.equal(get("theme"), '{color: colour196, icon: "🔐", short_name: sec}');
  assert.deepEqual(flowList(get("aliases")), ["security-lead", "sec"]);
  assert.equal(
    get("context-docs"),
    "security-testing/engagement.md security-testing/knowledge/finding-schema.md security-testing/risk-register.md",
    "the third context-docs entry is the view register.mjs render writes (TASK-059)",
  );
  assert.deepEqual(flowList(get("skills")), ["memory", "security-engagement"]);
  assert.deepEqual(flowList(get("skills-on-demand")), ["risk-register", "security-evidence", "issue-tracking", "dispatching-parallel-agents", "verifying-outcomes"]);
  const meta = fm.get("metadata");
  assert.ok(meta, "metadata: block missing");
  assert.ok(meta.children.some((l) => /^\s+authors:\s*$/.test(l)), "metadata.authors missing");
  assert.ok(meta.children.some((l) => /^\s+- "?[^<"]+ <[^>]+>"?\s*$/.test(l)), "metadata.authors has no Name <email> entry");
  for (const k of ["tools", "context-memory", "mcpServers", "workspace"]) assert.ok(!fm.has(k), `${k}: must not appear`);
  assert.deepEqual(
    [...fm.keys()],
    ["name", "description", "model", "color", "group", "theme", "aliases", "context-docs", "skills", "skills-on-demand", "metadata"],
    "frontmatter keys and their order are the §4.7 block",
  );
  assert.ok(existsSync(join(LEAD_DIR, "SOUL.md")), "SOUL.md sibling missing");
  assert.ok(existsSync(join(LEAD_DIR, "RULES.md")), "RULES.md sibling missing");
  assert.ok(existsSync(LEAD_BRIEFING), "briefings/security-lead.md missing");
});

/** The P1/P2 order of the assess procedure, as the real commands are spelled (lib/cmd-*.mjs headers). A cursor walk: each after the previous. */
const ASSESS_ORDER = [
  "evidence.mjs engagement init",
  "evidence.mjs engagement validate",
  "run init --kind assessment",
  "scope --run <run_id>",
  "plan.mjs admit --run <run_id>",
  "--dry-run",
  "packet --run <run_id> --kind subject --type case --subject",
  "plan.mjs admit --run <run_id> <case> --receipt <sha256>",
  "ingest case",
  "ingest qa-run",
  "packet --run <run_id> --kind scope",
  "`review`",
  "gate --run <run_id> --claims",
  "coverage --run <run_id> --examined",
  "{rows: [{import_sha256, paths?}]}",
  "packet --run <run_id> --kind subject --subject <finding_id>",
  "`vulnerability-review`",
  "receipt validate --run <run_id>",
  "receipt apply --run <run_id>",
  "register.mjs add --subject <finding_id> --priority p0|p1|p2|p3 --title <t> --run <run_id>",
  "register.mjs render",
  "plan.mjs propose --run <run_id>",
  "run snapshot verify --run <run_id> --from <verify_run_id>",
  "run snapshot register --run <run_id>",
  "run snapshot proposals --run <run_id>",
  "`threat-modeler`",
  "MODEL_WRITTEN elements=<n> threats=<n> undisposed=<n>",
  "packet --run <run_id> --kind subject --subject M-nnn",
  "`mitigation-review`",
  "tm-lint.mjs check --run <run_id>",
  "build-report --run <run_id> --template assessment",
  "check .agents/security-testing/runs/<run_id> --integrity --drift",
  "register.mjs render",
  "sign-off --engagement <engagement_id>",
  "publish --run <run_id> --profile case --to tasks/security-<slug>-admitted",
  "publish --run <run_id> --profile handoff --to .agents/security-testing/handoffs",
  "plan.mjs ta-prompt --run <run_id> --slug <slug> --base <branch>",
  "STOP",
];

test("security-lead body: the four rules; the assess procedure lists the real commands in the P1/P2 order and ends with the hand-off prompt + stop", () => {
  const { body, sections, section } = loadAgent(LEAD_MD);
  const names = sections.map((s) => s.name);
  const order = ["Tool-call economy", "Rules", "Contracts", "Writable paths self-check", "Never"];
  const idx = order.map((o) => names.findIndex((n) => n.startsWith(o)));
  assert.ok(idx.every((i) => i >= 0), `missing section(s): ${order.filter((_, i) => idx[i] < 0).join(", ")} in ${names.join(" | ")}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `sections out of §4.7 order: ${names.join(" | ")}`);
  const rules = section("Rules").text;
  RULES.forEach((re, i) => assert.match(rules, re, `rule ${i + 1} missing from ## Rules`));

  const contracts = h3Sections(section("Contracts").text);
  const byName = Object.fromEntries(contracts.map((c) => [c.name.replace(/`/g, "").split(/\s/)[0], c.text]));
  for (const name of ["assess", "verify", "tracker", "accept"]) assert.ok(byName[name], `### ${name} subsection missing (found: ${Object.keys(byName).join(", ")})`);

  // --- assess: the P1/P2 order, then the hand-off prompt, then STOP — and nothing runs after the stop inside the procedure
  const assess = byName.assess;
  assertOrdered(assess, ASSESS_ORDER, "### assess");
  const tail = assess.slice(assess.lastIndexOf("STOP"));
  assert.doesNotMatch(tail, /node <scripts>\//, "no command follows the STOP inside ### assess");
  assert.match(assess, /Run as the active agent \(claude --agent test-run-lead\):/, "the manual-qa hand-off prompt is quoted verbatim (spec §9.2)");
  assert.match(assess, /Run as the active agent \(claude --agent test-automation-lead\):/, "the test-automation hand-off prompt is quoted verbatim (TASK-044)");
  // P1: the scope packet exists before gate and is the review contract's input; claims name it
  assert.match(assess, /CLAIMS <claims path> EXAMINED <examined path> findings=<n> read=<n files>/);
  assert.match(assess, /CLAIMS-PACKET-MISMATCH/);
  // P2: every cross-run input enters through run snapshot before build-report (the run directory is the report's only input)
  assert.match(assess, /before `build-report`|precede[s]? `build-report`/i);
  // P6: cleanliness over scope_paths ∪ product_paths with the bundle's managed paths excluded
  assert.match(assess, /scope_paths ∪ product_paths/);
  assert.match(assess, /DIRTY-TREE/);
  assert.match(assess, /risk-register\.md`[^.]*never (count|trip)|managed paths (are )?excluded|excluded/i, "P6: the bundle's own outputs never count as dirt");
  // routed: candidate order commit → run init → scope → packet --type case; the candidate location hard rule
  assert.match(assess, /commit(ted)?[^.]*run init[^.]*scope[^.]*packet[^.]*--type case/s, "the case packet binds the blob at head: commit → run init → scope → packet --type case");
  assert.match(assess, /\.agents\/security-testing\/cases\/<slug>\/TC-NNN_<slug>\.md/);
  assert.match(assess, /never under `tasks\/`/);
  // routed: admit is write-once; --dry-run reads the hits without the record; a changed route is a new run
  assert.match(assess, /ADMISSION-EXISTS/);
  assert.match(assess, /ADMISSION case=<case_sha256> classification=/);
  // routed: observations need the CANDIDATE ingested as a case in the same run, and ingest precedes gate (unlocated fold)
  assert.match(assess, /unadmitted-case/);
  assert.match(assess, /<run>\/unlocated\.json|runs\/<run_id>\/unlocated\.json/);
  assert.match(assess, /IMPORT [^\n]*unlocated=<n>/);
  // routed: the scanner-rows shape and the coverage line
  assert.match(assess, /--scanner-rows <file>/);
  assert.match(assess, /COVERAGE examined=<n> skipped=<n> scanner=<n>/);
  assert.match(assess, /COVERAGE INDETERMINATE/);
  // gate and receipt lines as the scripts print them
  assert.match(assess, /GATE accepted=<n> unverifiable=<n> rejected=<n> unlocated=<n>/);
  assert.match(assess, /RECEIPT admitted sha256=<h> type=<t> subject=<id>/);
  assert.match(assess, /REVIEW_CONFIRMED/);
  // register: every accepted finding gets a row; render after every mutation; the eight-column view
  assert.match(assess, /ROW <R-id> status=open priority=<p> seq=<n>/);
  assert.match(assess, /after every register mutation/);
  assert.match(assess, /RENDER <path> rows=<n> seq=<n>|RENDER [^\n]*rows=<n> seq=<n>/);
  // snapshots: the three lines
  assert.match(assess, /SNAPSHOT register events=<n> chain=<sha>/);
  assert.match(assess, /SNAPSHOT verify from=<id> sha256=<h>/);
  assert.match(assess, /SNAPSHOT proposals n=<n>/);
  assert.match(assess, /SNAPSHOT-EXISTS/);
  // routed: the first `mitigated` disposition costs a rebuilt mitigation packet + a fresh mitigation-review on the NEW run
  assert.match(assess, /MITIGATION_CONFIRMED/);
  assert.match(assess, /TM-INVALID\(T-nnn: mitigated\(M-nnn\)/);
  assert.match(assess, /new run[\s\S]{0,600}?packet --run <run_id> --kind subject --subject M-nnn[\s\S]{0,300}?fresh[\s\S]{0,80}?`mitigation-review`/, "the mitigated re-dispatch on the new run is spelled");
  assert.match(assess, /TM elements=<n> threats=<n> undisposed=<n>/);
  // close: the report, check and sign-off lines
  assert.match(assess, /REPORT <path>/);
  assert.match(assess, /MANIFEST sha256=<h>/);
  assert.match(assess, /`COMMITTED`/);
  assert.match(assess, /CONSISTENT/);
  assert.match(assess, /SIGN-OFF: OK/);
  assert.match(assess, /SIGN-OFF: FAIL\(<cause>\)/);
  // routed: the PUBLISHED line's `output=./tasks/…` spelling, verbatim; the republish dead-end; engagement-wide identities
  assert.match(assess, /PUBLISHED profile=case output=\.\/tasks\/security-<slug>-admitted\/TC-NNN_<slug>\.md sha256=<h>/);
  assert.match(assess, /already exists with different content/);
  assert.match(assess, /remove the stale suite file/);
  assert.match(assess, /engagement-wide/);
  assert.match(assess, /UNADMITTED:/);
  // routed: ta-prompt reads the PUBLISHED suite, never the candidates
  assert.match(assess, /ta-prompt[^.]*published suite/i);
  assert.match(assess, /run <id> has no published suite/);
  // the prompt is printed and the lead stops: no QA run, no dispatch of test-run-lead or test-automation-lead by the lead
  assert.match(tail, /stop/i);
  assert.doesNotMatch(assess.replace(/\s+/g, " "), /(?<!never )dispatch (the )?`?test-run-lead`?/, "the lead prints the prompt; it never dispatches the QA lead itself");
});

test("security-lead verify: two-pass verify all with its stdout lines; tracker: both dedupe layers and the alias-aware read-back; accept: proposes, never approves", () => {
  const { section } = loadAgent(LEAD_MD);
  const contracts = h3Sections(section("Contracts").text);
  const byName = Object.fromEntries(contracts.map((c) => [c.name.replace(/`/g, "").split(/\s/)[0], c.text]));

  // --- verify (TL-6 two-pass; the routed `verify all` stdout row)
  const verify = byName.verify;
  assertOrdered(
    verify,
    [
      "register.mjs add --subject <finding_id>",
      "verify.mjs all --finding <finding_id> --base <oid> --head <oid>",
      "NEXT: dispatch security-reviewer fix-review",
      "`fix-review`",
      "verify.mjs all --finding <finding_id> --base <oid> --head <oid> --receipts .agents/security-testing/receipts/<run_id>",
      "RECEIPT admitted",
      "CONSUMED <verdict> row=<R-id> verify=<sha256>",
      "register.mjs render",
    ],
    "### verify",
  );
  for (const line of [
    "RUN <run_id> seq=<n> kind=verify base=<oid> head=<oid>",
    "BRANCH <token>",
    "TREE-BEFORE <oid>",
    "INSTALL <ran|skipped> tracked_changes=<n> untracked=<n> bytes=<n>",
    "SUPPRESSION indicators=<n> deletion_only=<bool>",
    "TESTS <token> exe=<path> sha256=<h>",
    "PACKET <path> sha256=<h> kind=subject files=<n>",
    "REGISTER: no row for finding",
    "TRANSITION-REJECTED",
    "VERDICT <token> finding=<id> base=<oid> head=<oid> tested_tree=<hmac|same-as-head> verify=<sha256>",
  ]) {
    assert.ok(verify.includes(line), `### verify does not carry the stdout line verbatim: ${line}`);
  }
  assert.match(verify, /last\s+line/, "the last stdout line is exactly the VERDICT line");
  assert.match(verify, /exit(?:s| code)? 0|exits `0`/, "a TRANSITION-REJECTED from consume-verdict still exits 0 with its verdict");
  assert.match(verify, /2 NO-ROW/, "routed: consume-verdict before add ⇒ 2 NO-ROW");
  assert.match(verify, /UNVERIFIED-INDETERMINATE\(fix-review\)/);
  assert.match(verify, /RECEIPT <path> type=fix-review subject=<id> assertion=<a> acks=<n>/);
  assert.match(verify, /run snapshot verify --run <run_id> --from <verify_run_id>/, "the next assessment carries the verify run through run snapshot verify (P2)");

  // --- tracker (P4: two layers, stated once and verbatim)
  const tracker = byName.tracker;
  assert.match(tracker, /the script dedupes against the register and prior imports/);
  assert.match(tracker, /\*\*you\*\* search the live tracker by `fingerprint` through `issue-tracking` before posting/);
  assert.match(tracker, /post the payload file's fields and nothing else/);
  assert.match(tracker, /then run `ingest tracker-readback --sent <payload> <response>`/);
  assert.match(tracker, /the bundle promises the first layer only/);
  assertOrdered(
    tracker,
    [
      "publish --run <run_id> --profile tracker --to .agents/security-testing/handoffs",
      "DEDUPE finding=<id> existing=<url>",
      "NEXT: post <path> via issue-tracking, then ingest tracker-readback --sent <path> <response.json>",
      "`issue-tracking`",
      "ingest tracker-readback <response.json> --run <run_id> --sent .agents/security-testing/handoffs/<finding_id>.ticket.json",
      "READBACK: ok",
      "TICKETED <R-id> <url>",
      "register.mjs render",
    ],
    "### tracker",
  );
  assert.match(tracker, /READBACK: MISMATCH\(<field>\)/);
  assert.match(tracker, /READBACK: ok \(no register row\)/);
  // routed (TASK-045 PM ruling): the read-back row lookup is exact on the sent finding_id, not alias-aware — a re-keyed finding needs a row for the NEW id
  assert.match(tracker, /register\.mjs alias --from <old finding_id> --to <finding_id> --reason <r> --run <run_id>/);
  assert.match(tracker, /not alias-aware|exact[^.]*finding_id/i, "the read-back lookup is exact on the sent finding_id");
  assert.match(tracker, /row for the new id|row whose subject is the new id|add[^.]*new id/i, "a re-keyed finding needs a register row for the new id before the read-back lands");
  assert.match(tracker, /EMITTER-ONLY\(ticketed\)/);
  assert.match(tracker, /not `COMMITTED`|not COMMITTED|open run/i, "ingest needs a run that is not COMMITTED — say which run the read-back goes into");
  assert.match(tracker, /never (post|file)[^.]*by hand|never post from the report/i);

  // --- accept: the lead proposes; a human approves elsewhere; the record stays unauthenticated
  const accept = byName.accept;
  assert.match(accept, /register\.mjs accept <R-id> --until <YYYY-MM-DD> --approved-by <who> --approval-ref <ref>/);
  assert.match(accept, /register\.mjs close-false-positive <R-id> --approved-by <who> --approval-ref <ref>/);
  assert.match(accept, /`authenticated: false`/);
  assert.match(accept, /propos(e|es|al)/i);
  assert.match(accept, /human/i);
  assert.match(accept, /never[^.]*(approve|fill in|invent)[^.]*(--approved-by|approver)/i, "the lead never supplies an approver of its own");
  assert.match(accept, /open exposure|never reduces? (open )?exposure|never subtract/i);
  assert.match(accept, /register\.mjs render/);
  // there is no confirm verb and no confirmed state anywhere in the lead's prose (D15 / G-8)
  const whole = readFileSync(LEAD_MD, "utf8");
  assert.doesNotMatch(whole, /register\.mjs confirm/, "no confirm command is ever spelled as runnable (D15 / G-8)");
  assert.doesNotMatch(whole, /authenticated: true/);
  assert.doesNotMatch(whole, /UNGATED|exact checkout/, "G-13 forbidden strings");
});

test("security-lead: Tool-call economy is verbatim; Writable paths self-check and Never carry the §4 lists and the lead's own boundaries", () => {
  const { section } = loadAgent(LEAD_MD);
  const tl = h2Sections(split(readFileSync(TECH_LEAD_MD, "utf8")).body).find((s) => s.name.startsWith("Tool-call economy"));
  const mine = section("Tool-call economy");
  assert.equal(mine.name, tl.name);
  assert.equal(mine.text.trim(), tl.text.trim(), "## Tool-call economy must be the tech-lead block verbatim (plan §4.7)");

  const wp = section("Writable paths self-check").text;
  for (const p of [".agents/security-testing/**", ".agents/memory/<role>/**", "reports/security/**", "tasks/security-*/**"]) {
    assert.ok(wp.includes(p), `writable path ${p} missing from the self-check`);
  }
  assert.match(wp, /\.gitignore/);
  assert.match(wp, /engagement init/);
  assert.match(wp, /publish --profile|`publish`/, "publications go through publish and nowhere else");
  assert.match(wp, /runs\//, "the self-check says runs/ is the scripts'");
  assert.match(wp, /cases\/<slug>\//, "the self-check names the candidate-case directory the lead may write");

  const never = section("Never").text;
  for (const w of ["merge", "close", "rotate", "fix"]) assert.match(never, new RegExp(`\\b${w}\\b`, "i"), `## Never lacks "${w}"`);
  for (const w of ["state", "verdict", "id", "gate stamp"]) assert.match(never, new RegExp(`\\b${w}s?\\b`, "i"), `## Never lacks "${w}"`);
  assert.match(never, /approv/i, "## Never restates: never approve — propose");
  assert.match(never, /hand-off|test-run-lead/, "## Never restates: the hand-off prompt is printed, the suite is never run by the lead");
  assert.match(never, /by hand|from the report/i, "## Never restates: never post a ticket by hand");
  assert.match(never, /review|claim/i, "## Never restates: the lead never writes a claim or a receipt itself");
});

test("security-lead SOUL.md, RULES.md and the briefing carry the lead's posture", () => {
  const soul = readFileSync(join(LEAD_DIR, "SOUL.md"), "utf8");
  assert.match(soul, /^# Soul/m);
  assert.match(soul, /## Voice/);
  assert.match(soul, /## Values/);
  assert.match(soul, /stop/i);
  assert.match(soul, /propos/i);

  const rules = readFileSync(join(LEAD_DIR, "RULES.md"), "utf8");
  assert.match(rules, /^# Rules — security-lead/m);
  for (const re of RULES) assert.match(rules, re, `RULES.md is missing a §4 rule: ${re}`);
  assert.match(rules, /hand-off prompt/);
  assert.match(rules, /\bstop\b/i);
  assert.match(rules, /register\.mjs render/);
  assert.match(rules, /issue-tracking/);
  assert.match(rules, /fresh/);
  assert.match(rules, /authenticated: false/);

  const briefing = split(readFileSync(LEAD_BRIEFING, "utf8"));
  const bfm = topLevel(briefing.fm);
  assert.equal(bfm.get("name")?.value, "Project briefing");
  assert.equal(bfm.get("type")?.value, "project");
  assert.match(bfm.get("description")?.value ?? "", /security-testing\/security-lead/);
  assert.match(briefing.body, /## Project Knowledge/);
  assert.match(briefing.body, /## My Role Focus/);
  for (const re of [
    /\.agents\/security-testing\/engagement\.md/,
    /\.agents\/security-testing\/risk-register\.md/,
    /register\.mjs render/,
    /runs\/<run_id>\//,
    /receipts\/<run_id>\//,
    /security-evidence\/scripts/,
    /tm-lint\.mjs check/,
    /hand-off prompt/,
    /issue-tracking/,
    /id \| subject \| priority \| status \| owner \| ticket_url \| last_verified_run \| title/,
  ]) {
    assert.match(briefing.body, re, `briefing lacks ${re}`);
  }
  assert.match(briefing.body, /\bstop\b/i);
});
