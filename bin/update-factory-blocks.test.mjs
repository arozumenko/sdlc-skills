// Regression: `init --update` without `--factory` (e.g. `init --all --update`)
// must refresh the managed factory blocks a project already carries in
// AGENTS.md / CLAUDE.md. Before the fix only `--factory <id>` spliced
// instructions, so an `--all --update` refreshed agents and skills but left
// the team rules from the original install — a consumer's feature-development
// block never gained the delivery-monitor section its refreshed agents use.
//
// Second regression (further down): a project that created CLAUDE.md after its
// first factory install kept the block in AGENTS.md only, and no update added
// it to CLAUDE.md, the one file Claude Code's main session auto-loads.
//
// Third (from ORPHAN down): a START with no END made the second run replace the
// project text up to the appended block's END; markers are now whole lines
// outside closed code fences, and a stray START is reported on every run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dedupeFactoryBlocks, importsAgentsMd, installInstructions, managedFactoryIds, refreshInstalledFactoryBlocks, scanFactoryBlocks } from "./init.mjs";
import { filterRoleSections } from "./lib/factory-selection.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const INIT = join(REPO, "bin/init.mjs");
// No agents are installed in these temp projects, so every role section is kept (markers stripped).
// Independent of the filter: with no agents installed, every stack's rules must survive.
test("refreshed blocks keep every stack section when no agents are installed", () => {
  const body = instructions("feature-development");
  for (const h of ["## Web stack", "## iOS stack", "## Android stack", "Not verified:", "## Delivery tracking"]) assert.ok(body.includes(h), h);
  assert.doesNotMatch(body, /<!-- \/?roles/);
});
const instructions = (id) => filterRoleSections(readFileSync(join(REPO, "bundles", id, "instructions.md"), "utf8"), null).trim();

const STALE_AGENTS = [
  "# AGENTS",
  "",
  "Project text above.",
  "",
  "<!-- BUNDLE:feature-development START -->",
  "stale feature-development rules (pre delivery-monitor)",
  "<!-- BUNDLE:feature-development END -->",
  "",
  "<!-- FACTORY:no-such-factory START -->",
  "keep me",
  "<!-- FACTORY:no-such-factory END -->",
  "",
  "Project text below.",
  "",
].join("\n");

const STALE_CLAUDE = [
  "# CLAUDE",
  "",
  "Mine.",
  "",
  "<!-- FACTORY:manual-qa START -->",
  "stale manual-qa rules",
  "<!-- FACTORY:manual-qa END -->",
  "",
].join("\n");

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "update-blocks-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

function assertRefreshed(root) {
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
  // Old BUNDLE marker migrates to FACTORY with the current body.
  assert.ok(!agents.includes("<!-- BUNDLE:feature-development"), "old marker migrated");
  assert.ok(agents.includes(`<!-- FACTORY:feature-development START -->\n${instructions("feature-development")}\n<!-- FACTORY:feature-development END -->`));
  assert.match(agents, /^## Delivery tracking$/m);
  assert.ok(!agents.includes("stale feature-development rules"));
  // Text outside the markers and unknown factories' blocks are preserved.
  assert.ok(agents.startsWith("# AGENTS\n\nProject text above.\n\n"));
  assert.ok(agents.includes("Project text below."));
  assert.ok(agents.includes("<!-- FACTORY:no-such-factory START -->\nkeep me\n<!-- FACTORY:no-such-factory END -->"));
  // CLAUDE.md blocks refresh too.
  assert.ok(claude.includes(`<!-- FACTORY:manual-qa START -->\n${instructions("manual-qa")}\n<!-- FACTORY:manual-qa END -->`));
  assert.ok(claude.startsWith("# CLAUDE\n\nMine.\n\n"));
  assert.ok(!claude.includes("stale manual-qa rules"));
}

test("managedFactoryIds finds both marker forms, in order, deduped", () => {
  const text = `${STALE_AGENTS}\n<!-- BUNDLE:feature-development START -->\nx\n<!-- BUNDLE:feature-development END -->\n`;
  assert.deepEqual(managedFactoryIds(text), ["feature-development", "no-such-factory"]);
  assert.deepEqual(managedFactoryIds("# nothing managed\n"), []);
});

test("refreshInstalledFactoryBlocks rewrites the existing blocks in place and adds the one CLAUDE.md lacks", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  assert.deepEqual(results, [
    { file: "AGENTS.md", id: "feature-development", status: "refreshed" },
    { file: "AGENTS.md", id: "no-such-factory", status: "unknown factory; left as-is" },
    { file: "CLAUDE.md", id: "manual-qa", status: "refreshed" },
    { file: "CLAUDE.md", id: "feature-development", status: "added" },
  ]);
  assertRefreshed(root);
  // Idempotent: a second pass changes nothing.
  const before = readFileSync(join(root, "AGENTS.md"), "utf8") + readFileSync(join(root, "CLAUDE.md"), "utf8");
  refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8") + readFileSync(join(root, "CLAUDE.md"), "utf8"), before);
});

test("refreshInstalledFactoryBlocks leaves a file without managed blocks alone and does not re-do the --factory block", () => {
  const plain = "# AGENTS\n\nNo managed blocks here.\n";
  const root = project({ "AGENTS.md": plain });
  assert.deepEqual(refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO }), []);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), plain);
  assert.ok(!existsSync(join(root, "CLAUDE.md")), "CLAUDE.md is never created");

  const skipped = project({ "AGENTS.md": STALE_AGENTS });
  const results = refreshInstalledFactoryBlocks({ cwd: skipped, pkgRoot: REPO, skip: "feature-development" });
  assert.ok(!results.some((r) => r.id === "feature-development"));
  assert.ok(readFileSync(join(skipped, "AGENTS.md"), "utf8").includes("stale feature-development rules"));
});

test("init --update without --factory refreshes the installed factory blocks", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const r = spawnSync(process.execPath, [INIT, "init", "--skills", "memory", "--update", "--target", "claude", "--yes"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: root, SDLC_SKILLS_CACHE_DIR: join(root, ".cache") },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /installed factory instructions/);
  assertRefreshed(root);
});

test("init without --update leaves the factory blocks alone", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const r = spawnSync(process.execPath, [INIT, "init", "--skills", "memory", "--target", "claude", "--yes"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: root, SDLC_SKILLS_CACHE_DIR: join(root, ".cache") },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), STALE_AGENTS);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), STALE_CLAUDE);
});

const count = (text, needle) => text.split(needle).length - 1;

// A project that created CLAUDE.md after its first factory install kept the
// block in AGENTS.md only. Claude Code auto-loads CLAUDE.md, not AGENTS.md, so
// the main session never saw the team rules. Before this fix `--update` only
// refreshed blocks already present, so it never repaired that.

test("--update adds a block AGENTS.md carries to an existing CLAUDE.md that lacks it", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  assert.deepEqual(results.filter((r) => r.file === "CLAUDE.md"), [
    { file: "CLAUDE.md", id: "manual-qa", status: "refreshed" },
    { file: "CLAUDE.md", id: "feature-development", status: "added" },
  ]);
  const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
  assert.equal(count(claude, "<!-- FACTORY:feature-development START -->"), 1);
  assert.match(claude, /^## Waiting on slow steps/m);
  // The project's own text and the block it already had stay where they were.
  assert.ok(claude.startsWith("# CLAUDE\n\nMine.\n\n<!-- FACTORY:manual-qa START -->"));
  assert.ok(claude.indexOf("FACTORY:manual-qa END") < claude.indexOf("FACTORY:feature-development START"));
  // A section both factories ship is read once.
  assert.equal(count(claude, "## Agent memory — two layers"), 1);
  // An unknown factory's block has no source text, so it is not copied over.
  assert.ok(!claude.includes("no-such-factory"));
});

test("a second --update refreshes the added block and changes nothing", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  const before = readFileSync(join(root, "CLAUDE.md"), "utf8");
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  assert.deepEqual(results.filter((r) => r.file === "CLAUDE.md").map((r) => r.status), ["refreshed", "refreshed"]);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), before);
});

test("a CLAUDE.md that imports AGENTS.md already loads the block, so none is added", () => {
  for (const line of ["@AGENTS.md", "See @./AGENTS.md for the team rules."]) {
    const importing = `# CLAUDE\n\n${line}\n`;
    const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": importing });
    const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
    // Said out loud, so a wrong "it imports" guess is visible in the install output.
    assert.deepEqual(results.filter((r) => r.file === "CLAUDE.md"), [{ file: "CLAUDE.md", id: "feature-development", status: "imports AGENTS.md; not added" }], line);
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), importing, line);
  }
});

test("a mention of AGENTS.md that is not an import does not hold the block back", () => {
  const mentions = [
    "See `AGENTS.md` for the full team reference.",
    "The `@AGENTS.md` form would import it.",
    "Write `import @AGENTS.md here` to pull it in.",
    "The rules are in @AGENTS.md.",
    "Rules (@AGENTS.md) apply.",
    "Not @AGENTS.md.bak either.",
    "```\n@AGENTS.md\n```",
    "Mail team@AGENTS.md.example for access.",
  ];
  for (const line of mentions) {
    const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": `# CLAUDE\n\n${line}\n` });
    refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
    assert.ok(readFileSync(join(root, "CLAUDE.md"), "utf8").includes("<!-- FACTORY:feature-development START -->"), line);
  }
});

test("skip keeps the --factory block out of the CLAUDE.md copy", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO, skip: "feature-development" });
  assert.ok(!results.some((r) => r.id === "feature-development"));
  assert.ok(!readFileSync(join(root, "CLAUDE.md"), "utf8").includes("FACTORY:feature-development"));
});

test("a plain run that only changed the roster adds no block to CLAUDE.md", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO, onlyRoleFiltered: true });
  assert.ok(!results.some((r) => r.file === "CLAUDE.md" && r.id === "feature-development"));
  assert.ok(!readFileSync(join(root, "CLAUDE.md"), "utf8").includes("FACTORY:feature-development"));
});

test("init --update without --factory reports and adds the missing CLAUDE.md block", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const r = spawnSync(process.execPath, [INIT, "init", "--skills", "memory", "--update", "--target", "claude", "--yes"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: root, SDLC_SKILLS_CACHE_DIR: join(root, ".cache") },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /✓ instructions CLAUDE\.md feature-development \(added\)/);
  assert.ok(readFileSync(join(root, "CLAUDE.md"), "utf8").includes("<!-- FACTORY:feature-development START -->"));
});

// Review round 1.
const blk = (id, body, marker = "FACTORY") => `<!-- ${marker}:${id} START -->\n${body}\n<!-- ${marker}:${id} END -->`;
// A small package: two factories with instructions, one without.
function fakePkg() {
  const pkg = mkdtempSync(join(tmpdir(), "update-blocks-pkg-"));
  for (const [id, manifest, body] of [["aa", { instructions: "instructions.md" }, "## A rules\na"], ["bb", { instructions: "instructions.md" }, "## B rules\nb"], ["cc", {}, null]]) {
    mkdirSync(join(pkg, "bundles", id), { recursive: true });
    writeFileSync(join(pkg, "bundles", id, "factory.json"), JSON.stringify(manifest));
    if (body) writeFileSync(join(pkg, "bundles", id, "instructions.md"), body + "\n");
  }
  return pkg;
}
const claudeRows = (results) => results.filter((r) => r.file === "CLAUDE.md");

test("several blocks CLAUDE.md lacks are all added, in AGENTS.md order", () => {
  const root = project({ "AGENTS.md": `# A\n\n${blk("bb", "old")}\n\n${blk("aa", "old")}\n`, "CLAUDE.md": "# CLAUDE\n" });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg() });
  assert.deepEqual(claudeRows(results), [{ file: "CLAUDE.md", id: "bb", status: "added" }, { file: "CLAUDE.md", id: "aa", status: "added" }]);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), `# CLAUDE\n\n${blk("bb", "## B rules\nb")}\n\n${blk("aa", "## A rules\na")}\n`);
});

test("AGENTS.md carries a known block and CLAUDE.md is absent: it is not created", () => {
  const root = project({ "AGENTS.md": `# A\n\n${blk("aa", "old")}\n` });
  assert.deepEqual(refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg() }), [{ file: "AGENTS.md", id: "aa", status: "refreshed" }]);
  assert.ok(!existsSync(join(root, "CLAUDE.md")));
});

test("the added block is filtered by the installed roster, the same as the AGENTS.md block", () => {
  const root = project({ "AGENTS.md": `# A\n\n${blk("feature-development", "old")}\n`, "CLAUDE.md": "# CLAUDE\n" });
  mkdirSync(join(root, ".claude/agents/python-dev"), { recursive: true });
  writeFileSync(join(root, ".claude/agents/python-dev/AGENT.md"), "---\nname: python-dev\n---\n");
  refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  const cut = (t) => t.slice(t.indexOf("<!-- FACTORY:feature-development START -->"), t.indexOf("<!-- FACTORY:feature-development END -->"));
  const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
  assert.match(claude, /^## Web stack/m);
  assert.doesNotMatch(claude, /^## Android stack/m);
  assert.equal(cut(claude), cut(readFileSync(join(root, "AGENTS.md"), "utf8")));
});

test("an importing CLAUDE.md still has the blocks it carries refreshed", () => {
  const root = project({ "AGENTS.md": `# A\n\n${blk("aa", "old")}\n`, "CLAUDE.md": `@AGENTS.md\n\n${blk("bb", "stale")}\n` });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg() });
  assert.deepEqual(claudeRows(results), [{ file: "CLAUDE.md", id: "bb", status: "refreshed" }, { file: "CLAUDE.md", id: "aa", status: "imports AGENTS.md; not added" }]);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), `@AGENTS.md\n\n${blk("bb", "## B rules\nb")}\n`);
});

test("a block CLAUDE.md carries under the old BUNDLE marker is refreshed once, not added", () => {
  const root = project({ "AGENTS.md": `# A\n\n${blk("aa", "old")}\n`, "CLAUDE.md": `# CLAUDE\n\n${blk("aa", "old", "BUNDLE")}\n` });
  assert.deepEqual(claudeRows(refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg() })), [{ file: "CLAUDE.md", id: "aa", status: "refreshed" }]);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), `# CLAUDE\n\n${blk("aa", "## A rules\na")}\n`);
});

test("a factory with no instructions is not copied to CLAUDE.md", () => {
  const root = project({ "AGENTS.md": `# A\n\n${blk("cc", "keep")}\n`, "CLAUDE.md": "# CLAUDE\n" });
  assert.deepEqual(refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg() }), [{ file: "AGENTS.md", id: "cc", status: "no instructions in factory; left as-is" }]);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# CLAUDE\n");
});

test("with skip (--factory X --update) the other factories' missing blocks are still added", () => {
  const root = project({ "AGENTS.md": `# A\n\n${blk("aa", "old")}\n\n${blk("bb", "new")}\n`, "CLAUDE.md": `# CLAUDE\n\n${blk("bb", "new")}\n` });
  assert.deepEqual(claudeRows(refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg(), skip: "bb" })), [{ file: "CLAUDE.md", id: "aa", status: "added" }]);
});

test("a block the file names but does not close keeps its warning mark and is not reported as added", () => {
  // The file's own START has no END, so spliceFactoryBlock appends a full block after it and names the stray line
  // (printed with "!"). That is a damaged file, not the CLAUDE.md copy, which reports "added".
  const root = project({ "AGENTS.md": `# A\n\n<!-- FACTORY:aa START -->\nno end marker\n`, "CLAUDE.md": "# CLAUDE\n" });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg() });
  assert.deepEqual(results[0], { file: "AGENTS.md", id: "aa", status: `appended${STRAY}` });
});

test("importsAgentsMd: only what Claude Code reads as an import counts", () => {
  const yes = ["@AGENTS.md", "# CLAUDE\r\n\r\n@AGENTS.md\r\n", "```\ncode\n```\n\n@AGENTS.md\n", "See @./AGENTS.md for the rules.", "<!-- note -->\n@AGENTS.md\n", "Use `code` then @AGENTS.md here"];
  for (const t of yes) assert.equal(importsAgentsMd(t), true, JSON.stringify(t));
  const no = {
    "tilde fence": "~~~\n@AGENTS.md\n~~~\n",
    "indented fence": "   ```md\n@AGENTS.md\n   ```\n",
    "shorter inner fence": "````\n```\n@AGENTS.md\n````\n",
    "CRLF fence": "# CLAUDE\r\n\r\n```\r\n@AGENTS.md\r\n```\r\n",
    "double-backtick code": "Type `` @AGENTS.md `` to import.",
    "four-space code block": "Example:\n\n    @AGENTS.md\n",
    "tab code block": "Example:\n\n\t@AGENTS.md\n",
    "html comment": "<!-- @AGENTS.md -->",
    "multi-line html comment": "<!--\n@AGENTS.md\n-->\nText.",
    "unclosed code span": "Start ` and @AGENTS.md goes on",
  };
  for (const [why, t] of Object.entries(no)) assert.equal(importsAgentsMd(t), false, why);
});

test("a --factory install does not add its block to a CLAUDE.md that imports AGENTS.md", () => {
  const pkg = fakePkg(), factory = { id: "aa", dir: join(pkg, "bundles", "aa"), instructions: "instructions.md" };
  const importing = "# CLAUDE\n\n@AGENTS.md\n";
  const root = project({ "CLAUDE.md": importing });
  installInstructions(factory, root);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), importing);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), `# AGENTS\n\n${blk("aa", "## A rules\na")}\n`, "AGENTS.md is created with the block");
  // The block it already carries is still replaced in place.
  const carrying = project({ "CLAUDE.md": `@AGENTS.md\n\n${blk("aa", "stale")}\n` });
  installInstructions(factory, carrying);
  assert.equal(readFileSync(join(carrying, "CLAUDE.md"), "utf8"), `@AGENTS.md\n\n${blk("aa", "## A rules\na")}\n`);
  // Without the import, the block is appended as before.
  const plain = project({ "CLAUDE.md": "# CLAUDE\n" });
  installInstructions(factory, plain);
  assert.equal(readFileSync(join(plain, "CLAUDE.md"), "utf8"), `# CLAUDE\n\n${blk("aa", "## A rules\na")}\n`);
});

test("install output: added is a success, an import skip is a note, an unclosed block is a warning", () => {
  const cli = (files) => {
    const root = project(files);
    const r = spawnSync(process.execPath, [INIT, "init", "--skills", "memory", "--update", "--target", "claude", "--yes"], { cwd: root, encoding: "utf8", env: { ...process.env, HOME: root, SDLC_SKILLS_CACHE_DIR: join(root, ".cache") } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return r.stdout;
  };
  assert.match(cli({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": "# CLAUDE\n\n@AGENTS.md\n" }), /— instructions CLAUDE\.md feature-development \(imports AGENTS\.md; not added\)/);
  assert.match(cli({ "AGENTS.md": "# A\n\n<!-- FACTORY:manual-qa START -->\nno end marker\n" }), /! instructions AGENTS\.md manual-qa \(appended; unclosed START marker left as text/);
});

// A START marker with no END marker (a hand edit cut the block short). The first run appends a whole block after the
// project text. A splice that paired markers across lines matched from the orphan START to the appended END on the
// second run and replaced everything between them, project text included.
const ORPHAN = `# A\n\n<!-- FACTORY:aa START -->\nno end marker\n\n## Project notes\nkeep me\n`;
const STRAY = "; unclosed START marker left as text: delete it and any cut-short rules after it";

test("an unclosed block: the project text after it survives the second run", () => {
  const root = project({ "AGENTS.md": ORPHAN });
  const pkg = fakePkg();
  assert.deepEqual(refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: pkg }), [{ file: "AGENTS.md", id: "aa", status: `appended${STRAY}` }]);
  const first = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.equal(first, `${ORPHAN}\n${blk("aa", "## A rules\na")}\n`);
  assert.deepEqual(refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: pkg }), [{ file: "AGENTS.md", id: "aa", status: `refreshed${STRAY}` }]);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), first);
});

test("an unclosed block: a --factory install twice keeps the project text", () => {
  const factory = { id: "aa", dir: join(fakePkg(), "bundles", "aa"), instructions: "instructions.md" };
  const root = project({ "AGENTS.md": ORPHAN });
  installInstructions(factory, root);
  installInstructions(factory, root);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), `${ORPHAN}\n${blk("aa", "## A rules\na")}\n`);
});

test("an unclosed block: dedupe does not treat the project text up to the next block's END as block content", () => {
  // bb ships "## Shared". The project's own "## Shared" section sits after an orphan aa START, before the real aa block.
  const text = `${blk("bb", "## Shared\nb")}\n\n<!-- FACTORY:aa START -->\n\n## Shared\nproject's own\n\n${blk("aa", "## A rules\na")}\n`;
  assert.equal(dedupeFactoryBlocks(text), text);
});

// Markers count only as whole lines, and an unclosed START is reported on every run, not only on the run that appends.
const AA = blk("aa", "## A rules\na");
const runFactory = (root) => {
  const factory = { id: "aa", dir: join(fakePkg(), "bundles", "aa"), instructions: "instructions.md" };
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try { installInstructions(factory, root); } finally { console.log = log; }
  return lines.join("\n");
};
const twice = (files, run) => {
  const root = project(files);
  const out1 = run(root);
  const first = readFileSync(join(root, "AGENTS.md"), "utf8");
  const out2 = run(root);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), first, "the second run changes nothing");
  return { first, out1, out2 };
};

test("markers quoted inside a line are not a block", () => {
  const doc = "# A\n\nMarkers look like `<!-- FACTORY:aa START -->...<!-- FACTORY:aa END -->` in docs.\n";
  const { first } = twice({ "AGENTS.md": doc }, runFactory);
  assert.equal(first, `${doc}\n${AA}\n`);
});

test("an unclosed START is reported on every run, on the --factory path", () => {
  const { out1, out2 } = twice({ "AGENTS.md": ORPHAN }, runFactory);
  assert.ok(out1.includes(`! instructions AGENTS.md (appended${STRAY})`), out1);
  assert.ok(out2.includes(`! instructions AGENTS.md (refreshed${STRAY})`), out2);
});

test("an unclosed START is reported on every run, on the --update path", () => {
  const pkg = fakePkg();
  const refresh = (root) => refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: pkg });
  const root = project({ "AGENTS.md": ORPHAN });
  const note = STRAY;
  assert.deepEqual(refresh(root), [{ file: "AGENTS.md", id: "aa", status: `appended${note}` }]);
  assert.deepEqual(refresh(root), [{ file: "AGENTS.md", id: "aa", status: `refreshed${note}` }]);
  // A stray START after a complete block is reported too, though nothing is appended.
  const after = project({ "AGENTS.md": `# A\n\n${blk("aa", "old")}\n\n<!-- FACTORY:aa START -->\npasted twice\n` });
  assert.deepEqual(refresh(after), [{ file: "AGENTS.md", id: "aa", status: `refreshed${STRAY}` }]);
});

test("the CLI marks an unclosed START with ! on the second --update", () => {
  const root = project({ "AGENTS.md": "# A\n\n<!-- FACTORY:manual-qa START -->\nno end marker\n" });
  const run = () => spawnSync(process.execPath, [INIT, "init", "--skills", "memory", "--update", "--target", "claude", "--yes"], { cwd: root, encoding: "utf8", env: { ...process.env, HOME: root, SDLC_SKILLS_CACHE_DIR: join(root, ".cache") } });
  run();
  const r = run();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /! instructions AGENTS\.md manual-qa \(refreshed; unclosed START marker left as text/);
});

test("an unclosed START keeps the project text in the old BUNDLE form and in CRLF files", () => {
  const variants = {
    "BUNDLE start": ORPHAN.replace("FACTORY:aa START", "BUNDLE:aa START"),
    "BUNDLE start above an old BUNDLE block": `${ORPHAN.replace("FACTORY:aa START", "BUNDLE:aa START")}\n${blk("aa", "old", "BUNDLE")}\n`,
    "CRLF": ORPHAN.replace(/\n/g, "\r\n"),
  };
  for (const [why, doc] of Object.entries(variants)) {
    const { first } = twice({ "AGENTS.md": doc }, runFactory);
    assert.ok(first.includes("## Project notes") && first.includes("keep me"), why);
    // The appended block is written with LF, also into a CRLF file.
    assert.ok(first.includes(AA), why);
  }
});

test("dedupe leaves the text after an unclosed START alone in the BUNDLE form and in CRLF files", () => {
  const base = `${blk("bb", "## Shared\nb")}\n\n<!-- FACTORY:aa START -->\n\n## Shared\nproject's own\n\n${blk("aa", "## A rules\na")}\n`;
  for (const text of [base.replace("FACTORY:aa START -->\n\n## Shared", "BUNDLE:aa START -->\n\n## Shared"), base.replace(/\n/g, "\r\n")]) {
    assert.equal(dedupeFactoryBlocks(text), text);
  }
});

test("a marker line with trailing spaces or tabs is still a marker", () => {
  // The splice used to match markers anywhere, so a hand edit that left trailing whitespace still refreshed in place.
  const doc = `# A\n\n<!-- FACTORY:aa START --> \nold\n<!-- FACTORY:aa END -->\t\n\nafter\n`;
  const { first, out2 } = twice({ "AGENTS.md": doc }, runFactory);
  // What follows END on its line is kept, as the old in-text match kept it.
  assert.equal(first, `# A\n\n<!-- FACTORY:aa START -->\n## A rules\na\n<!-- FACTORY:aa END -->\t\n\nafter\n`);
  assert.match(out2, /✓ instructions AGENTS\.md \(refreshed\)/);
});

// Code fences do not hide markers from the splice, as for the old in-text match. Markers may be indented up to 3 spaces (CommonMark still reads them
// as HTML) and the first line may carry a byte order mark.
const REFRESHED = (before, after = "") => `${before}${AA}\n${after}`;

test("a code fence that never closes, above the block, does not hide it", () => {
  const doc = "# A\n\n```\nnever closed\n\n<!-- FACTORY:aa START -->\nold\n<!-- FACTORY:aa END -->\n";
  const { first, out1 } = twice({ "AGENTS.md": doc }, runFactory);
  assert.equal(first, REFRESHED("# A\n\n```\nnever closed\n\n"));
  assert.match(out1, /✓ instructions AGENTS\.md \(refreshed\)/);
});

test("a half fence inside an old block body does not hide its END", () => {
  const doc = "<!-- FACTORY:aa START -->\nold\n```\nhalf a fence\n<!-- FACTORY:aa END -->\n\nmine\n";
  const { first, out1 } = twice({ "AGENTS.md": doc }, runFactory);
  assert.equal(first, REFRESHED("", "\nmine\n"));
  assert.match(out1, /✓ instructions AGENTS\.md \(refreshed\)/);
});

test("a marker indented up to 3 spaces, or after a byte order mark, is still a marker", () => {
  for (const [why, doc, want] of [
    ["indented", "# A\n\n  <!-- FACTORY:aa START -->\nold\n  <!-- FACTORY:aa END -->\n\nafter\n", `# A\n\n  ${AA}\n\nafter\n`],
    ["byte order mark", "﻿<!-- FACTORY:aa START -->\r\nold\r\n<!-- FACTORY:aa END -->\r\n", `﻿${AA}\r\n`],
  ]) {
    const { first } = twice({ "AGENTS.md": doc }, runFactory);
    assert.equal(first, want, why);
  }
  // Four spaces is an indented code block, not a marker.
  assert.deepEqual(scanFactoryBlocks("    <!-- FACTORY:aa START -->\nx\n    <!-- FACTORY:aa END -->\n").blocks, []);
});

test("a line that ends in a marker is prose, not a block START", () => {
  const doc = "# A\n\nSee the block: <!-- FACTORY:aa START -->\nmine\n<!-- FACTORY:aa END -->\n";
  assert.deepEqual(scanFactoryBlocks(doc).blocks, []);
});

test("a refreshed block in a CRLF file keeps the file's line endings around it", () => {
  const doc = "# A\r\n\r\n<!-- FACTORY:aa START -->\r\nold\r\n<!-- FACTORY:aa END -->\r\n\r\nafter\r\n";
  const { first } = twice({ "AGENTS.md": doc }, runFactory);
  assert.equal(first, `# A\r\n\r\n${AA}\r\n\r\nafter\r\n`);
});

test("another factory's unclosed START is not reported on this factory's run", () => {
  const doc = `# A\n\n${blk("aa", "old")}\n\n<!-- FACTORY:bb START -->\nbb leftovers\n`;
  const { out1 } = twice({ "AGENTS.md": doc }, runFactory);
  assert.match(out1, /✓ instructions AGENTS\.md \(refreshed\)/);
});

test("with two complete blocks of one id, the first is refreshed", () => {
  const doc = `${blk("aa", "first")}\n\nmid\n\n${blk("aa", "second")}\n`;
  const { first } = twice({ "AGENTS.md": doc }, runFactory);
  assert.ok(first.startsWith(`${AA}\n\nmid\n\n<!-- FACTORY:aa START -->`), first);
});

test("managedFactoryIds lists an unclosed START and the blocks in file order", () => {
  assert.deepEqual(managedFactoryIds(`<!-- FACTORY:bb START -->\nx\n\n${blk("aa", "a")}\n`), ["bb", "aa"]);
});

test("a CLAUDE.md that imports AGENTS.md and holds only a stray START gets no block, and the stray is reported", () => {
  const claude = "# CLAUDE\n\n@AGENTS.md\n\n<!-- FACTORY:aa START -->\nleftover\n";
  const factoryRoot = project({ "AGENTS.md": `# A\n\n${AA}\n`, "CLAUDE.md": claude });
  const out = runFactory(factoryRoot);
  assert.equal(readFileSync(join(factoryRoot, "CLAUDE.md"), "utf8"), claude);
  assert.match(out, /! instructions CLAUDE\.md \(imports AGENTS\.md; not added; unclosed START marker left as text/);
  const updateRoot = project({ "AGENTS.md": `# A\n\n${blk("aa", "old")}\n`, "CLAUDE.md": claude });
  const results = refreshInstalledFactoryBlocks({ cwd: updateRoot, pkgRoot: fakePkg() });
  assert.deepEqual(claudeRows(results), [{ file: "CLAUDE.md", id: "aa", status: `imports AGENTS.md; not added${STRAY}` }]);
  assert.equal(readFileSync(join(updateRoot, "CLAUDE.md"), "utf8"), claude);
});

test("a very large file does not crash the splice or dedupe", () => {
  const doc = "line\n".repeat(300000) + `${blk("aa", "old")}\n`;
  const { first } = twice({ "AGENTS.md": doc }, runFactory);
  assert.ok(first.endsWith(`${AA}\n`));
});

test("every shipped instructions.md scans back as exactly one block", () => {
  const ids = readdirSync(join(REPO, "bundles")).filter((id) => existsSync(join(REPO, "bundles", id, "instructions.md")));
  assert.ok(ids.length >= 4, ids.join(","));
  for (const id of ids) {
    const src = join(REPO, "bundles", id, "instructions.md");
    const { blocks, unclosed } = scanFactoryBlocks(`# A\n\n${blk(id, filterRoleSections(readFileSync(src, "utf8"), null).trim())}\n`);
    assert.equal(blocks.length, 1, id);
    assert.equal(unclosed.length, 0, id);
  }
});

// The splice ignores code fences: a fence left open in project text must not pair with a fence line inside a factory
// body or in later project text and hide the block, or every run appends another copy.
const FENCED_BODY = "## F rules\n\n```\nnpm test\n```\n\nmore";
const runFactoryWith = (body) => (root) => {
  const pkg = mkdtempSync(join(tmpdir(), "update-blocks-pkg-"));
  mkdirSync(join(pkg, "bundles", "aa"), { recursive: true });
  writeFileSync(join(pkg, "bundles", "aa", "instructions.md"), body + "\n");
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try { installInstructions({ id: "aa", dir: join(pkg, "bundles", "aa"), instructions: "instructions.md" }, root); } finally { console.log = log; }
  return lines.join("\n");
};

test("a fence left open in project text does not pair with a fence in the appended block", () => {
  const doc = "# Project\n\nSetup:\n```\nnpm install\n";
  const { first, out2 } = twice({ "AGENTS.md": doc }, runFactoryWith(FENCED_BODY));
  assert.equal(first, `${doc}\n${blk("aa", FENCED_BODY)}\n`);
  assert.match(out2, /✓ instructions AGENTS\.md \(refreshed\)/);
});

test("a block after a fence left open in project text is refreshed in place on both paths", () => {
  const doc = `# A\n\n\`\`\`bash\nnpm i\n\n${blk("aa", "old\n```\nx\n```")}\n`;
  const { first } = twice({ "AGENTS.md": doc }, runFactoryWith(FENCED_BODY));
  assert.equal(first, `# A\n\n\`\`\`bash\nnpm i\n\n${blk("aa", FENCED_BODY)}\n`);
  assert.equal(scanFactoryBlocks(doc).blocks.length, 1);
  assert.deepEqual(managedFactoryIds(doc), ["aa"]);
});

test("a factory body with a marker line of its own is not written, and says so", () => {
  const doc = `# A\n\n${blk("aa", "old")}\n\nafter\n`;
  const root = project({ "AGENTS.md": doc });
  const out = runFactoryWith("## Broken\n<!-- FACTORY:aa END -->\nrest")(root);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), doc);
  assert.match(out, /! instructions AGENTS\.md \(not written: the factory's instructions contain a block marker line\)/);
});

test("dedupe treats an indented START as a block, as the splice does", () => {
  const text = `${blk("bb", "## Shared\nb")}\n\n  <!-- FACTORY:aa START -->\n## Shared\nagain\n<!-- FACTORY:aa END -->\n`;
  assert.equal(dedupeFactoryBlocks(text), `${blk("bb", "## Shared\nb")}\n\n  <!-- FACTORY:aa START -->\n<!-- FACTORY:aa END -->\n`);
});

test("fences around or after a block never make the block count grow", () => {
  const body = "## Rules\n\nbe nice";
  const cases = {
    "open fence before, fence pair after": `# P\n\`\`\`\nx\n\n${blk("aa", "old")}\n\n\`\`\`\ny\n\`\`\`\n`,
    "tilde fence left open before": `# P\n~~~\nx\n\n${blk("aa", "old")}\n`,
    "closed fence holding a START example": `# P\n\`\`\`\n<!-- FACTORY:aa START -->\n\`\`\`\n\n${blk("aa", "old")}\n\n\`\`\`\ncode\n\`\`\`\n`,
    "old body had fences, new one has none": `# P\n\`\`\`\nx\n\n${blk("aa", "## F rules\n\n\`\`\`\nnpm test\n\`\`\`\n\nmore")}\n\n\`\`\`\ny\n\`\`\`\n`,
  };
  for (const [why, doc] of Object.entries(cases)) {
    const root = project({ "AGENTS.md": doc });
    const before = scanFactoryBlocks(doc).blocks.length;
    for (let n = 0; n < 3; n++) runFactoryWith(body)(root);
    const after = readFileSync(join(root, "AGENTS.md"), "utf8");
    assert.equal(scanFactoryBlocks(after).blocks.length, before, why);
    assert.ok(after.includes(blk("aa", body)), why);
  }
});
