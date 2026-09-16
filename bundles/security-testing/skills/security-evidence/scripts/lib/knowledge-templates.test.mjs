// TASK-011 — engagement init step 0: knowledge templates + engagement.md
// template copy (spec §6.9 step 0 / P3, D12; US-007 AC-1, AC-2).
//
// Verification cases named in plan §5 (G4 / TASK-011) plus the interface
// contract's guarantees: after step 0 the three knowledge files exist under
// <st>/knowledge/, and step 0 never touches .gitignore, keys or the baseline.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { cleanupAll, initRepo } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { ENGAGEMENT_FILE, KNOWLEDGE_FILES, TEMPLATE_PATHS, defaultRecord, parseEngagementMd } from "./engagement.mjs";
import { walk } from "./fsx.mjs";
import { ENGAGEMENT_TEMPLATE_WRITTEN, templatesLine } from "./tokens.mjs";
import { KNOWLEDGE_DIR, ensureEngagementMd, ensureTemplates, stepTemplates } from "./knowledge-templates.mjs";

after(cleanupAll);

const HERE = resolve(new URL(".", import.meta.url).pathname);
const SELF = readFileSync(join(HERE, "knowledge-templates.mjs"), "utf8");

function capture() {
  return { text: "", write(s) { this.text += s; } };
}

/** A ctx over a fresh fixture repo, with captured streams. */
function fresh() {
  const repo = initRepo();
  const out = capture();
  const err = capture();
  const ctx = createContext({}, { cwd: repo, env: {}, stdout: out, stderr: err });
  return { repo, ctx, out, err, st: ctx.st, knowledge: join(ctx.st, KNOWLEDGE_DIR) };
}

/** Every file under the repo, repo-relative posix, `.git/` excluded. */
function repoFiles(repo) {
  return walk(repo).filter((p) => !p.startsWith(".git/"));
}

const shipped = (name) => readFileSync(TEMPLATE_PATHS[name]);

// ---------------------------------------------------------------------------
// Named verification cases

test("absent ⇒ written", () => {
  const { ctx, knowledge } = fresh();
  assert.equal(existsSync(knowledge), false, "fixture starts without <st>/knowledge/");

  const result = ensureTemplates(ctx);

  assert.deepEqual(result, { written: [...KNOWLEDGE_FILES], present: [] });
  for (const name of KNOWLEDGE_FILES) {
    const dest = join(knowledge, name);
    assert.ok(existsSync(dest), `${name} exists after step 0 (interface contract)`);
    assert.deepEqual(readFileSync(dest), shipped(name), `${name} is a byte-identical copy of the shipped template`);
  }
});

test("present and locally edited ⇒ untouched", () => {
  const { ctx, knowledge } = fresh();
  mkdirSync(knowledge, { recursive: true });
  const edited = "# my own finding schema\n\nlocally edited, must survive\n";
  writeFileSync(join(knowledge, "finding-schema.md"), edited);

  const first = ensureTemplates(ctx);

  assert.deepEqual(first, { written: ["engagement.md.template", "report-reading-guide.md"], present: ["finding-schema.md"] }, "existing wins, per file");
  assert.equal(readFileSync(join(knowledge, "finding-schema.md"), "utf8"), edited, "the local edit is untouched (US-007 AC-2)");
  assert.deepEqual(readFileSync(join(knowledge, "engagement.md.template")), shipped("engagement.md.template"));

  // Idempotent: a second run writes nothing and reports everything present.
  const before = KNOWLEDGE_FILES.map((name) => readFileSync(join(knowledge, name)));
  const second = ensureTemplates(ctx);
  assert.deepEqual(second, { written: [], present: [...KNOWLEDGE_FILES] });
  KNOWLEDGE_FILES.forEach((name, i) => assert.deepEqual(readFileSync(join(knowledge, name)), before[i], `${name} unchanged on the second run`));
});

test("engagement.md absent ⇒ template copied and template-written returned; present ⇒ present", () => {
  const { ctx, st, repo } = fresh();
  const dest = join(st, ENGAGEMENT_FILE);
  assert.equal(existsSync(dest), false);

  const first = stepTemplates(ctx);

  assert.equal(first.templates, "written");
  assert.equal(first.engagement, "template-written");
  assert.deepEqual(readFileSync(dest), shipped("engagement.md.template"), "engagement.md is the template copy, byte for byte");
  // The copy is a usable record: ctx.engagement() over it is the template's default record.
  assert.deepEqual(parseEngagementMd(readFileSync(dest)), defaultRecord());
  assert.deepEqual(ctx.engagement(), defaultRecord());

  // Re-run: everything present, nothing rewritten (P3: the operator edits and re-runs).
  writeFileSync(dest, "# edited by the operator\n\nnot even a valid record yet\n");
  const second = stepTemplates(ctx);
  assert.equal(second.templates, "present");
  assert.equal(second.engagement, "present");
  assert.equal(readFileSync(dest, "utf8"), "# edited by the operator\n\nnot even a valid record yet\n", "step 0 checks presence only; it never validates or rewrites engagement.md");

  // The step's footprint is exactly the four files under <st>/ — no .gitignore, no keys, no baseline (interface contract).
  assert.deepEqual(repoFiles(repo).filter((p) => p.startsWith(".agents/")), [
    ".agents/security-testing/engagement.md",
    ".agents/security-testing/knowledge/engagement.md.template",
    ".agents/security-testing/knowledge/finding-schema.md",
    ".agents/security-testing/knowledge/report-reading-guide.md",
  ]);
  assert.equal(existsSync(join(repo, ".gitignore")), false, "step 0 never touches .gitignore (G-5: that is step 1, TASK-008)");
  assert.equal(existsSync(join(st, "private")), false, "step 0 creates no key and no baseline");
});

// ---------------------------------------------------------------------------
// Shape guarantees

test("ensureEngagementMd: {written: true} once, then {written: false}; templates stay independent of it", () => {
  const { ctx, st, knowledge } = fresh();
  assert.deepEqual(ensureEngagementMd(ctx), { written: true });
  assert.deepEqual(ensureEngagementMd(ctx), { written: false });
  assert.ok(existsSync(join(st, ENGAGEMENT_FILE)));
  assert.equal(existsSync(knowledge), false, "ensureEngagementMd does not install the knowledge files");
});

test("stepTemplates result carries the per-file lists the TEMPLATES line is rendered from", () => {
  const { ctx, knowledge } = fresh();
  mkdirSync(knowledge, { recursive: true });
  writeFileSync(join(knowledge, "report-reading-guide.md"), "local\n");
  const result = stepTemplates(ctx);
  assert.deepEqual(result, {
    templates: "written",
    engagement: "template-written",
    written: ["engagement.md.template", "finding-schema.md"],
    present: ["report-reading-guide.md"],
  });
  assert.equal(templatesLine(result), "TEMPLATES: engagement.md.template=written finding-schema.md=written report-reading-guide.md=present");
  assert.equal(ENGAGEMENT_TEMPLATE_WRITTEN, "ENGAGEMENT: template written — edit and re-run");
});

test("templatesLine: KNOWLEDGE_FILES order, every file accounted for exactly once", () => {
  assert.equal(templatesLine({ written: [], present: [...KNOWLEDGE_FILES] }), "TEMPLATES: engagement.md.template=present finding-schema.md=present report-reading-guide.md=present");
  assert.throws(() => templatesLine({ written: ["finding-schema.md"], present: [] }), /accounted/, "a file missing from both lists is a bug, not a line");
  assert.throws(() => templatesLine({ written: ["finding-schema.md"], present: [...KNOWLEDGE_FILES] }), /accounted/, "a file in both lists is a bug, not a line");
});

test("step 0 prints nothing itself: the pipeline (TASK-008) owns stdout", () => {
  const { ctx, out, err } = fresh();
  stepTemplates(ctx);
  assert.equal(out.text, "");
  assert.equal(err.text, "");
});

test("the copy is the shipped file: TEMPLATE_PATHS is the only source and knowledge/ under <st> the only destination", () => {
  const { ctx, repo, st } = fresh();
  stepTemplates(ctx);
  for (const name of KNOWLEDGE_FILES) {
    assert.deepEqual(readFileSync(join(st, KNOWLEDGE_DIR, name)), readFileSync(TEMPLATE_PATHS[name]));
  }
  assert.equal(relative(repo, join(st, KNOWLEDGE_DIR)), join(".agents", "security-testing", "knowledge"));
});

test("module boundary: writes go through fsx (write-once), no child process, no clock, no network, no console", () => {
  assert.doesNotMatch(SELF, /writeFileSync|appendFileSync|copyFileSync|console\.log|child_process|node:http|node:net|node:dns|fetch\(|Date\.now\(|new Date\(/);
  assert.match(SELF, /writeExclusive/, "existing wins by construction: the `wx` flag decides, not a stat-then-write race");
  assert.match(SELF, /from "\.\/engagement\.mjs"/, "TEMPLATE_PATHS / KNOWLEDGE_FILES come from TASK-007, not a second list");
});
