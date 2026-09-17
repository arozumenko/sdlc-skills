// TASK-035 — the `security-engagement` skill (US-027 AC-1/AC-2, US-039 AC-3
// second dedupe layer; plan §5 TASK-035; spec §5 row, §7, §9.4 / P4, §2, §8).
//
// The skill is prose; what this file pins is that the prose stays TRUE
// against the bundle's own scripts: it ships no scripts of its own and names
// only the three scripts `security-evidence` exports, its sign-off checklist
// enumerates exactly the fail causes and listing headers `cmd-sign-off.mjs`
// exports (so a token added there without a checklist row fails here), its
// tracker rules state both P4 dedupe layers and the read-back, its workflow
// states the P1 order, and its disclosure page names every profile and every
// key of the tracker payload. Everything is read as text — no Markdown
// parser, no YAML parser (stdlib only, G-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FAIL_CAUSES, LISTING_HEADERS } from "./lib/cmd-sign-off.mjs";
import { TICKET_KEYS } from "./lib/profiles/tracker.mjs";
import { PUBLISH_PROFILES } from "./lib/tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..", "..", "security-engagement");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const REFERENCES = ["workflow", "sign-off-checklist", "tracker-rules", "disclosure-profiles"];

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

// plan.mjs and tm-lint.mjs joined the workflow with M3 (final-review I-1); every one of them lives in security-evidence (D1).
const SCRIPTS = ["evidence.mjs", "verify.mjs", "register.mjs", "plan.mjs", "tm-lint.mjs"];
/** A span "names a command" when it invokes a program or a `.mjs` file. */
const COMMAND_SHAPED = /^(?:node|git|npm|npx|gh|curl|sh|bash|python3?|pip)\b|\.mjs\b/;

/** The script name a command-shaped span invokes, with an optional `node <dir>/` prefix stripped. */
function invokedScript(span) {
  const s = span.replace(/^node\s+/, "").replace(/^(?:\$?\{?<[^>]+>\}?\/|[\w.@-]+\/)+/, "");
  return s.split(/\s+/)[0];
}

test("skill dir has no scripts/; every backticked command starts with evidence.mjs|verify.mjs|register.mjs|plan.mjs|tm-lint.mjs", () => {
  assert.ok(existsSync(SKILL_MD), "SKILL.md exists");
  assert.ok(!existsSync(join(SKILL_DIR, "scripts")), "US-027 AC-1: the skill ships no scripts/ (every script lives in security-evidence, D1)");
  for (const name of REFERENCES) assert.ok(existsSync(join(SKILL_DIR, "references", `${name}.md`)), `references/${name}.md exists`);
  const entries = readdirSync(SKILL_DIR).sort();
  assert.deepEqual(entries, ["SKILL.md", "references"], "the skill is SKILL.md + references/ and nothing else");

  let commands = 0;
  for (const { rel, text } of skillFiles()) {
    for (const span of backtickedSpans(text)) {
      if (!COMMAND_SHAPED.test(span)) continue;
      commands += 1;
      const script = invokedScript(span);
      assert.ok(SCRIPTS.includes(script), `${rel}: command-shaped span \`${span}\` must invoke one of ${SCRIPTS.join("|")}, got ${script}`);
    }
  }
  assert.ok(commands >= 20, `the workflow names the pipeline commands (${commands} command spans found)`);
});

test("SKILL.md frontmatter: agentskills.io shape, name matches the directory, description states triggers only", () => {
  const text = read("SKILL.md");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(m, "frontmatter block present");
  const fm = m[1];
  assert.match(fm, /^name: security-engagement$/m);
  const desc = fm.match(/^description: (.*)$/m);
  assert.ok(desc, "description present");
  assert.match(desc[1].replace(/^"|"$/g, ""), /^Use when /, "description starts with the trigger, not a workflow summary");
  assert.ok(desc[1].length <= 1024, "description within the agentskills.io limit");
  for (const name of REFERENCES) assert.ok(m[2].includes(`references/${name}.md`), `SKILL.md links references/${name}.md`);
});

test("sign-off checklist names every FAIL cause token and every listing header exported by cmd-sign-off.mjs", () => {
  const text = ref("sign-off-checklist");
  assert.ok(FAIL_CAUSES.length >= 10 && LISTING_HEADERS.length === 7, "the exported lists are the ones TASK-033 shipped");
  for (const cause of FAIL_CAUSES) assert.ok(text.includes(`\`${cause}\``), `checklist names the fail cause \`${cause}\` verbatim`);
  for (const header of LISTING_HEADERS) assert.ok(text.includes(`\`${header}`), `checklist names the listing header \`${header}\` verbatim (backticked, possibly with its count)`);
  // Checklist rows appear in the script's evaluation order, so a reader can follow the output top to bottom.
  const positions = FAIL_CAUSES.map((c) => text.indexOf(`\`${c}\``));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "fail causes are listed in evaluation order");
  const headerPositions = LISTING_HEADERS.map((h) => text.indexOf(`\`${h}`));
  assert.deepEqual([...headerPositions].sort((a, b) => a - b), headerPositions, "listings are in print order");
  assert.match(text, /one line per tracked pattern/, "PM log after G16: TRACKED prints one FAIL line per tracked pattern");
  assert.match(text, /`SIGN-OFF: OK`/);
  assert.match(text, /`SIGN-OFF: FAIL\(<cause>\)`/);
  assert.match(text, /informational/i, "the listings are informational and never change the exit code (US-025 AC-5)");
  assert.doesNotMatch(text, /UNGATED|exact checkout/, "G-13 forbidden strings");
  // TASK-047 (routed TASK-035 follow-up): which causes name their run, by group, as cmd-sign-off.mjs prints them —
  // ` run=<run_id>` on INCONSISTENT / STRUCTURE-ONLY / SCOPE-DRIFTED, inside the parens for COVERAGE-INDETERMINATE, none on the rest.
  assert.doesNotMatch(text, /Every cause but the first two and the register ones names its\s+run/, "the wrong sentence is gone");
  const intro = text.slice(0, text.indexOf("| `SIGN-OFF: FAIL(<cause>)` |"));
  assert.match(intro, /`INCONSISTENT\(<field>\)`, `STRUCTURE-ONLY` and `SCOPE-DRIFTED\(<n> files\)` carry ` run=<run_id>`/);
  assert.match(intro, /`COVERAGE-INDETERMINATE\(<run>\)` names its run inside the parentheses/);
  assert.match(intro, /`CORRUPT`, `TRUNCATED`, `DIVERGED`, `DISPOSITIONS\(<threat ids>\)` and `TRACKED\(<path>\)` carry no run/);
  assert.match(intro, /`NO-ASSESSMENT`[^.]*no run/);
});

test("tracker-rules names both dedupe layers and tracker-readback", () => {
  const text = ref("tracker-rules");
  // P4, verbatim (plan §5 TASK-035; spec §9.4).
  assert.match(text, /the script dedupes against the register and prior imports/);
  assert.match(text, /\*\*you\*\* search the live tracker by `fingerprint` through `issue-tracking` before posting/);
  assert.match(text, /post the payload file's fields and nothing else/);
  assert.match(text, /then run `ingest tracker-readback --sent <payload> <response>`/);
  assert.match(text, /the bundle promises the first layer only/);
  // The mechanics the rules rest on.
  assert.match(text, /publish --run <run_id> --profile tracker --to \.agents\/security-testing\/handoffs/);
  assert.match(text, /`DEDUPE finding=<id> existing=<url>`/);
  assert.match(text, /`NEXT: post <path> via issue-tracking, then ingest tracker-readback --sent <path> <response\.json>`/);
  assert.match(text, /`READBACK: ok`/);
  assert.match(text, /`READBACK: MISMATCH\(<field>\)`/);
  assert.match(text, /read-back after every mutation/i);
  assert.match(text, /never merge/i);
  assert.match(text, /never close/i);
  assert.match(text, /`targets\.tracker`/, "a url on a host outside targets.tracker is inert");
  assert.match(text, /`targets\.repo`/, "targets.repo is read from engagement.md, not the payload");
  for (const key of TICKET_KEYS) assert.ok(text.includes(`\`${key}\``), `tracker rules name the payload key \`${key}\``);
  assert.match(text, /`fingerprint`[^\n]*sha256\(path\\0class\)|sha256\(path\\0class\)/, "the fingerprint's preimage is stated so the lead knows what the search key means");
  // final-review I-5 (PM log after G20, decided): no v1 producer of a threat ticket — `ticketed(<url>)` on a threat is
  // unreachable by design; threats dispose through the other four kinds; the profile is a v2 item in NOTES.md
  assert.match(text, /## Threats are not ticketed in v1/);
  assert.match(text, /`publish --profile tracker` writes finding tickets only/);
  assert.match(text, /`planned`, `executed`, `accepted` or `mitigated`/);
  assert.match(text, /v2 item/);
  assert.match(text, /`NOTES.md`/);
});

test("workflow states the P1 order and the stand-down check", () => {
  const text = ref("workflow");
  const order = [
    "run init",
    "scope --run",
    "packet --run <run_id> --kind scope",
    "dispatch",
    "gate --run <run_id> --claims",
    "coverage --run <run_id> --examined",
    "packet --run <run_id> --kind subject",
    "fresh",
    "vulnerability-review",
    "receipt validate",
    "build-report",
    "check ",
  ];
  let at = 0;
  for (const step of order) {
    const i = text.indexOf(step, at);
    assert.ok(i >= 0, `workflow names \`${step}\` after the previous step (P1 order)`);
    at = i;
  }
  assert.match(text, /## Stand-down check/);
  for (const token of ["`2 EDIT-ENGAGEMENT-AND-RERUN`", "`2 ENGAGEMENT-INVALID(<reason>)`", "`4 TRACKED(<path>)`", "`4 NOT-IGNORED(<path>)`", "`3 DIRTY-TREE`", "`KEY: unavailable`"]) {
    assert.ok(text.includes(token), `stand-down check keys on ${token}`);
  }
  // The four phases, in order.
  const phases = ["## Assess", "## Plan", "## Review", "## Verify"];
  at = 0;
  for (const p of phases) {
    const i = text.indexOf(p, at);
    assert.ok(i >= 0, `workflow has the phase heading ${p} in order`);
    at = i;
  }
  // verify.mjs all is two-pass and needs the finding's gate run in the ledger (PM log after G13).
  assert.match(text, /verify\.mjs all --finding <id> --base <oid> --head <oid>(?! --receipts)/);
  assert.match(text, /verify\.mjs all --finding <id> --base <oid> --head <oid> --receipts <dir>/);
  assert.match(text, /`NEXT: dispatch security-reviewer fix-review`/);
  assert.match(text, /`REGISTER: no row for finding`/);
  assert.match(text, /register\.mjs add --subject <finding_id>/);
  assert.match(text, /`TESTS_INDETERMINATE\(timeout\)`[^\n]*exit(?:s|ed)? 0|exit(?:s|ed)? 0[^\n]*`TESTS_INDETERMINATE\(timeout\)`/, "PM log after G13: a passing suite that leaves a daemon holding stdout reads as a timeout");
  // TASK-016's review sentence: scanners on a clean tree, from the repo root.
  assert.match(text, /clean tree/);
  assert.match(text, /shifted regions/);
  assert.match(text, /repo(?:sitory)? root/);
  assert.match(text, /--scanner-rows/);
  assert.match(text, /\{rows: \[\{import_sha256, paths\?\}\]\}/, "the --scanner-rows shape (PM log after G7)");
  // purge's plan shape (PM log after TASK-032).
  assert.match(text, /`PURGE <repo-relative path>`/);
  assert.match(text, /purge --engagement <engagement_id> --yes/);
});

test("workflow Assess and Plan describe the M3 state (final-review I-1): the planning commands, the threat-model lint and its two run files; no milestone-dated text", () => {
  const text = ref("workflow");
  const assess = text.slice(text.indexOf("## Assess"), text.indexOf("## Plan"));
  const plan = text.slice(text.indexOf("## Plan"), text.indexOf("## Review"));
  // the M3 commands the lead's assess contract runs, named in the canonical order
  const ASSESS_SPANS = [
    "plan.mjs admit --run <run_id> <case> --dry-run",
    "plan.mjs admit --run <run_id> <st>/cases/<slug>/TC-NNN_<slug>.md",
    "packet --run <run_id> --kind subject --type case --subject <case>",
    "plan.mjs admit --run <run_id> <case> --receipt <sha256>",
    "ingest case <candidate> --run <run_id>",
    "ingest qa-run <report> --run <run_id>",
    "ingest ta-report <report> --run <run_id>",
    "plan.mjs propose --run <run_id> <path>",
    "tm-lint.mjs check --run <run_id>",
    "build-report --run <run_id> --template assessment",
  ];
  const PLAN_SPANS = [
    "plan.mjs admit --run <run_id> <st>/cases/<slug>/TC-NNN_<slug>.md",
    "ingest case <candidate> --run <run_id>",
    "plan.mjs propose --run <run_id> <path>",
    "publish --run <run_id> --profile case --to tasks/security-<slug>-admitted",
    "publish --run <run_id> --profile handoff --to <st>/handoffs",
    "plan.mjs ta-prompt --run <run_id> --slug <slug> --base <branch>",
  ];
  for (const [name, where, spans] of [["Assess", assess, ASSESS_SPANS], ["Plan", plan, PLAN_SPANS]]) {
    let at = 0;
    for (const span of spans) {
      const i = where.indexOf(span, at);
      assert.ok(i >= 0, `## ${name} names \`${span}\` in order`);
      at = i;
    }
  }
  // the tokens the scripts print (tokens.mjs), quoted as printed
  assert.match(assess, /ADMISSION case=<case_sha256> classification=<admitted-heuristic\|admitted-reviewed\|proposal> hits=<n>/);
  assert.match(assess, /OBSERVATION <id> case=<c> result=<r>/);
  assert.match(assess, /TA-UNITS <run>\/ta-units\/<sha>\.json units=<n> sha256=<h>/);
  assert.match(assess, /TM elements=<n> threats=<n> undisposed=<n>/);
  assert.match(assess, /3 INCOMPLETE\(threat-model\)/);
  assert.match(assess, /3 INCOMPLETE\(dispositions\)/, "dispositions.json is a required assessment input (TASK-048)");
  assert.match(assess, /<run>\/threat-model\.json/);
  assert.match(assess, /<run>\/dispositions\.json/);
  assert.match(assess, /confirmed passive/, "a case packet's `confirmed` means confirmed passive (I-2)");
  assert.match(assess, /same run,\s+same model/, "the mitigated sequence runs inside one run (I-4)");
  assert.match(plan, /PROPOSAL <st>\/proposals\/<id>\.proposal\.md id=<P-nnn> sha256=<h>/);
  assert.match(plan, /PUBLISHED profile=case output=\.\/tasks\/security-<slug>-admitted\/TC-NNN_<slug>\.md sha256=<h>/);
  // the M1/M2-dated sentences are gone
  for (const stale of ["Until M2 lands", "land with M3", "at M1", "at M2", "(from M2)", "hand-craft"]) {
    assert.ok(!text.includes(stale), `workflow no longer says "${stale}"`);
  }
  assert.doesNotMatch(text, /\bM[123]\b/, "no milestone-dated text in the preloaded workflow");
  // TEMPLATES is quoted per file, as templatesLine prints it (dogfood #8)
  assert.match(text, /TEMPLATES: engagement\.md\.template=written finding-schema\.md=written report-reading-guide\.md=written/);
  assert.match(text, /TEMPLATES: engagement\.md\.template=present finding-schema\.md=present report-reading-guide\.md=present/);
  assert.doesNotMatch(text, /TEMPLATES: (?:written|present)`/, "no bare `TEMPLATES: written|present` spelling");
});

test("disclosure-profiles explains every publish profile and what each reveals", () => {
  const text = ref("disclosure-profiles");
  for (const p of PUBLISH_PROFILES) assert.ok(text.includes(`\`${p}\``), `disclosure page names the profile \`${p}\``);
  assert.match(text, /`full-report`[^\n]*explicit/i, "full-report is explicit (never a default)");
  assert.match(text, /no default/i, "--profile has no default");
  for (const key of TICKET_KEYS) assert.ok(text.includes(`\`${key}\``), `tracker column names \`${key}\``);
  assert.match(text, /never `snippet`/, "a tracker payload never carries the snippet");
  assert.match(text, /`export-manifest\.json`/);
  assert.match(text, /`<finding_id>\.export-manifest\.json`/, "the tracker sidecar manifest");
  assert.match(text, /`VERIFIED-DERIVATIVE`/);
  assert.match(text, /`LINKED-ONLY`/);
  assert.match(text, /`MISMATCH\(output\)`/);
  assert.doesNotMatch(text, /NOT-IMPLEMENTED\(M3\)/, "handoff and case landed with TASK-043");
  assert.match(text, /`<run_id>\.case\.export-manifest\.json`/, "the case manifest sidecar");
  assert.match(text, /audit-step form/, "the case profile names the audit branch");
  assert.match(text, /already exists with different content/, "--to refuses to clobber a file it did not derive");
});

test("SKILL.md carries the §2 promise table and the §8 Not guaranteed list in the spec's words", () => {
  const text = read("SKILL.md");
  assert.match(text, /## What it will and won't do/);
  assert.match(text, /## Not guaranteed/);
  const promises = [
    "**Consistency and re-derivation.**",
    "**Integrity against the recorded snapshot**",
    "**Tests execute from a validated test-start snapshot**",
    "**Bounded redaction before any persistence, including under `private/`**",
    "**Only admitted cases are written to the hand-off suite**",
    "**Every approval-like record is stored and reported as unauthenticated.**",
    "**Per-path observation of working-tree changes**",
  ];
  for (const p of promises) assert.ok(text.includes(p), `§2 left column: ${p}`);
  const cannot = [
    "Origin. A consistent set can be authored by anyone with write access.",
    "That a model read what it declared examined; original bytes of a dirty file after it changes.",
    "Test meaningfulness; class closed at the sink; suppression detection beyond lexical indicators.",
    "Detection of secrets outside the rule list.",
    "That a QA runner refuses a case handed to it directly.",
    "That any human approved anything.",
    "Attribution of a change to a role; changes to git-ignored files.",
  ];
  for (const c of cannot) assert.ok(text.includes(c), `§2 right column: ${c}`);
  const notGuaranteed =
    "origin; model reading; human approval; secrets outside the rule list; semantic suppression; test meaningfulness; direct-run refusal by QA runners; threat completeness; host-preloaded instruction files and direct agent reads; attribution of tree changes; encryption of local artifacts; the core context hooks installed by the installer are outside this bundle's control";
  assert.ok(text.includes(notGuaranteed), "§8 Not guaranteed, verbatim");
  assert.match(text, /for runs carrying a `COMMITTED` marker produced by the canonical pipeline/, "D10 qualification");
  assert.doesNotMatch(text, /UNGATED|exact checkout/, "G-13 forbidden strings");
});

test("the lead's four standing rules and the never list are stated", () => {
  const text = read("SKILL.md");
  assert.match(text, /External text proposes; only scope- and target-validated references act/);
  assert.match(text, /never merge, close, rotate, fix|Never merge, close, rotate or fix/i);
  assert.match(text, /`\.agents\/security-testing\/\*\*`/);
  assert.match(text, /`reports\/security\/\*\*`/);
  assert.match(text, /`tasks\/security-\*\/\*\*`/);
  assert.match(text, /assertions?[^\n]*never states, verdicts, ids|never writes? a state, verdict, id/i);
  assert.match(text, /`confirm`/, "the lead knows there is no confirm command (D15)");
  assert.match(text, /authenticated: false/, "approvals are unauthenticated records");
});
