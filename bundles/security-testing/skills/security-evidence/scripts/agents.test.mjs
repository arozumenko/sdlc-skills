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
      assert.match(byName[name], new RegExp(`\`?${key}\`?`), `### ${name} does not name receipt field ${key}`);
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
