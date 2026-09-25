// Regression: `init --update` without `--factory` (e.g. `init --all --update`)
// must refresh the managed factory blocks a project already carries in
// AGENTS.md / CLAUDE.md. Before the fix only `--factory <id>` spliced
// instructions, so an `--all --update` refreshed agents and skills but left
// the team rules from the original install — a consumer's feature-development
// block never gained the delivery-monitor section its refreshed agents use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { managedFactoryIds, refreshInstalledFactoryBlocks } from "./init.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const INIT = join(REPO, "bin/init.mjs");
const instructions = (id) => readFileSync(join(REPO, "bundles", id, "instructions.md"), "utf8").trim();

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
  assert.match(agents, /Delivery tracking \(delivery-monitor\)/);
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

test("refreshInstalledFactoryBlocks rewrites existing blocks only", () => {
  const root = project({ "AGENTS.md": STALE_AGENTS, "CLAUDE.md": STALE_CLAUDE });
  const results = refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  assert.deepEqual(results, [
    { file: "AGENTS.md", id: "feature-development", status: "refreshed" },
    { file: "AGENTS.md", id: "no-such-factory", status: "unknown factory; left as-is" },
    { file: "CLAUDE.md", id: "manual-qa", status: "refreshed" },
  ]);
  assertRefreshed(root);
  // Idempotent: a second pass changes nothing.
  const before = readFileSync(join(root, "AGENTS.md"), "utf8") + readFileSync(join(root, "CLAUDE.md"), "utf8");
  refreshInstalledFactoryBlocks({ cwd: root, pkgRoot: REPO });
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8") + readFileSync(join(root, "CLAUDE.md"), "utf8"), before);
});

test("refreshInstalledFactoryBlocks never appends, creates, or re-does the --factory block", () => {
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
