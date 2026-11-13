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
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importsAgentsMd, installInstructions, managedFactoryIds, refreshInstalledFactoryBlocks } from "./init.mjs";
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
  // The file's own START marker has no END: the old append path runs. That is a damaged file, not the CLAUDE.md copy.
  const root = project({ "AGENTS.md": `# A\n\n<!-- FACTORY:aa START -->\nno end marker\n`, "CLAUDE.md": "# CLAUDE\n" });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: fakePkg() });
  assert.deepEqual(results[0], { file: "AGENTS.md", id: "aa", status: "appended" });
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

test("install output: added is a success, an import skip is a note, an unclosed block stays a warning", () => {
  const cli = (files) => {
    const root = project(files);
    const r = spawnSync(process.execPath, [INIT, "init", "--skills", "memory", "--update", "--target", "claude", "--yes"], { cwd: root, encoding: "utf8", env: { ...process.env, HOME: root, SDLC_SKILLS_CACHE_DIR: join(root, ".cache") } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return r.stdout;
  };
  assert.match(cli({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": "# CLAUDE\n\n@AGENTS.md\n" }), /— instructions CLAUDE\.md feature-development \(imports AGENTS\.md; not added\)/);
  assert.match(cli({ "AGENTS.md": "# A\n\n<!-- FACTORY:manual-qa START -->\nno end marker\n" }), /! instructions AGENTS\.md manual-qa \(appended\)/);
});
