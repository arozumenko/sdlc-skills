// safe-update.test.mjs — `init --update` must not destroy what a user may own.
//
// Every case runs the real installer (bin/init.mjs) in a throwaway project.
// HOME, the installer's cache dir and the global git config are pinned to the
// sandbox, and every inherited GIT_* variable is dropped first (a calling git
// hook sets GIT_DIR and friends; GIT_CONFIG_COUNT / GIT_CONFIG_KEY_* inject
// configuration), so nothing here reads or writes the developer's home, cache,
// git config or repository, and nothing reaches the network (same fixture as
// security-testing-e2e.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { copyTreeDereferenced, mergeClaudeSettingsHooks, mergeVersionedHooks, seedMissingFiles } from "./init.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const INIT = join(REPO, "bin/init.mjs");
const NO_NETWORK = join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig");

function sandbox({ git = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "safe-update-"));
  const home = join(base, "home");
  const project = join(base, "project");
  mkdirSync(home);
  mkdirSync(project);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), SDLC_SKILLS_CACHE_DIR: join(home, ".cache"), GIT_CONFIG_GLOBAL: NO_NETWORK, GIT_CONFIG_NOSYSTEM: "1" });
  const run = (cmd, args, extraEnv = {}) => spawnSync(cmd, args, { cwd: project, encoding: "utf8", env: { ...env, ...extraEnv } });
  const git_ = (...args) => {
    const r = run("git", args);
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const initEnv = (extraEnv, ...args) => {
    const withTarget = args.includes("--target") ? args : [...args, "--target", "claude"];
    const r = run(process.execPath, [INIT, "init", ...withTarget, "--yes"], extraEnv);
    r.out = r.stdout + r.stderr;
    return r;
  };
  const init = (...args) => initEnv({}, ...args);
  if (git) {
    git_("init", "-q", ...(git === "parent" ? [base] : [])); // "parent": the project is a subfolder of the repository
    git_("config", "user.email", "t@example.invalid");
    git_("config", "user.name", "t");
    git_("config", "commit.gpgsign", "false");
  }
  const commitAll = (msg) => {
    git_("add", "-A");
    git_("commit", "-qm", msg);
  };
  return { base, home, project, run, init, initEnv, git: git_, commitAll, p: (...parts) => join(project, ...parts) };
}

// ── Item 1: seeds are create-only ───────────────────────────────────────────

test("--update keeps an edited seed file and a user's own file, and adds a file the project lacks", () => {
  const s = sandbox();
  assert.equal(s.init("--factory", "security-testing").status, 0);
  const seedDir = s.p(".agents/security-testing/knowledge");
  const edited = join(seedDir, "finding-schema.md");
  const own = join(seedDir, "my-notes.md");
  const missing = join(seedDir, "report-template.md"); // stands in for a file new in the scaffold
  assert.ok(existsSync(edited) && existsSync(missing), "fixture: the factory seeds these files");
  writeFileSync(edited, "local edit\n");
  writeFileSync(own, "mine\n");
  rmSync(missing);

  const r = s.init("--factory", "security-testing", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(edited, "utf8"), "local edit\n", "an edited seed file is kept");
  assert.equal(readFileSync(own, "utf8"), "mine\n", "a user's own file in the seed folder is kept");
  assert.equal(
    readFileSync(missing, "utf8"),
    readFileSync(join(REPO, "bundles/security-testing/knowledge/report-template.md"), "utf8"),
    "a file the scaffold has and the project lacks arrives",
  );
  assert.match(r.out, /seed \.agents\/security-testing\/knowledge \(exists; existing files kept\) — added 1 new file\(s\)/);
});

// ── Item 2: an update does not replace an item that has local changes ───────

const shipped = (rel) => readFileSync(join(REPO, rel), "utf8");
const KEPT = (kind, name) => new RegExp(`! ${kind}\\s+${name} kept: \\S+ has uncommitted local changes\\. Commit or stash them, or pass --force to replace it\\.`);
const SUMMARY = /! (\d+) item\(s\) NOT updated: they have uncommitted local changes/;
const BACKUP_ROOT = ".sdlc-skills-backup";

// A git project where `memory` and `knowledge-curation` are installed and
// committed with content an older package would have shipped: each differs
// from today's copy and carries a file today's copy does not have.
function committedOldInstall() {
  const s = sandbox({ git: true });
  assert.equal(s.init("--skills", "memory,knowledge-curation").status, 0);
  for (const id of ["memory", "knowledge-curation"]) {
    writeFileSync(s.p(".claude/skills", id, "SKILL.md"), `old ${id}\n`);
    writeFileSync(s.p(".claude/skills", id, "dropped-upstream.md"), "old\n");
  }
  s.commitAll("old install");
  return s;
}

test("clean tracked destination: --update replaces the folder, as before", () => {
  const s = committedOldInstall();
  const r = s.init("--skills", "memory,knowledge-curation", "--update");
  assert.equal(r.status, 0, r.out);
  for (const id of ["memory", "knowledge-curation"]) {
    assert.equal(readFileSync(s.p(".claude/skills", id, "SKILL.md"), "utf8"), shipped(`skills/${id}/SKILL.md`));
    assert.ok(!existsSync(s.p(".claude/skills", id, "dropped-upstream.md")), "a file the package no longer ships is gone");
  }
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
  assert.ok(!existsSync(s.p(BACKUP_ROOT)), "git history is the backup; no backup folder");
  assert.match(r.out, /Done: 2 installed, 0 skipped\./);
});

for (const [what, mutate] of [
  ["an uncommitted edit", (s) => writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n")],
  ["an untracked file", (s) => writeFileSync(s.p(".claude/skills/memory/my-notes.md"), "mine\n")],
  ["an uncommitted deletion", (s) => rmSync(s.p(".claude/skills/memory/dropped-upstream.md"))],
]) {
  test(`destination with ${what}: kept, reported, and the other items still update`, () => {
    const s = committedOldInstall();
    mutate(s);
    const before = s.git("status", "--porcelain", "--", ".claude/skills/memory");
    assert.notEqual(before, "", "fixture: git sees the local change");
    const r = s.init("--skills", "memory,knowledge-curation", "--update");
    assert.equal(r.status, 0, r.out);
    assert.equal(s.git("status", "--porcelain", "--", ".claude/skills/memory"), before, "the folder is exactly as the user left it");
    assert.match(r.out, KEPT("skill", "memory"));
    assert.equal(readFileSync(s.p(".claude/skills/knowledge-curation/SKILL.md"), "utf8"), shipped("skills/knowledge-curation/SKILL.md"), "the clean item is updated");
    assert.equal(r.out.match(SUMMARY)?.[1], "1", r.out);
    assert.match(r.out, /NOT updated: they have uncommitted local changes \(\.claude\/skills\/memory\)\./, "the summary names the kept path");
    assert.ok(r.out.indexOf("NOT updated") > r.out.indexOf("Done:"), "the summary is the last thing printed");
  });
}

test("project in a subfolder of the repository: local changes are still seen", () => {
  const s = sandbox({ git: "parent" });
  assert.equal(s.init("--skills", "memory,knowledge-curation").status, 0);
  for (const id of ["memory", "knowledge-curation"]) writeFileSync(s.p(".claude/skills", id, "SKILL.md"), `old ${id}\n`);
  s.commitAll("old install");
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  const r = s.init("--skills", "memory,knowledge-curation", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), "my local edit\n");
  assert.match(r.out, KEPT("skill", "memory"));
  assert.equal(readFileSync(s.p(".claude/skills/knowledge-curation/SKILL.md"), "utf8"), shipped("skills/knowledge-curation/SKILL.md"));
  assert.ok(!existsSync(s.p(BACKUP_ROOT)), "the clean item is restored from git history, not from a backup");
});

test("--force replaces a destination that has local changes", () => {
  const s = committedOldInstall();
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  const r = s.init("--skills", "memory", "--update", "--force");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), shipped("skills/memory/SKILL.md"));
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
});

test("project outside git: the old folder is copied to a backup before it is replaced", () => {
  const s = sandbox();
  assert.equal(s.init("--skills", "memory").status, 0);
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  writeFileSync(s.p(".claude/skills/memory/my-notes.md"), "mine\n");
  const r = s.init("--skills", "memory", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), shipped("skills/memory/SKILL.md"), "replaced");
  const m = r.out.match(/skill\s+memory: previous copy saved to (\.sdlc-skills-backup\/\d{8}-\d{6}\/claude\/skills\/memory)/);
  assert.ok(m, r.out);
  assert.equal(readFileSync(s.p(m[1], "SKILL.md"), "utf8"), "my local edit\n", "the backup holds the old content");
  assert.equal(readFileSync(s.p(m[1], "my-notes.md"), "utf8"), "mine\n");
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
});

test("destination git ignores: no history to restore from, so it is backed up and replaced", () => {
  const s = sandbox({ git: true });
  writeFileSync(s.p(".gitignore"), ".claude/\n.sdlc-skills-backup/\n");
  assert.equal(s.init("--skills", "memory").status, 0);
  s.commitAll("project");
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  const r = s.init("--skills", "memory", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), shipped("skills/memory/SKILL.md"));
  const m = r.out.match(/previous copy saved to (\S+)/);
  assert.ok(m, r.out);
  assert.equal(readFileSync(s.p(m[1], "SKILL.md"), "utf8"), "my local edit\n");
});

test("uncommitted content identical to a copy this package ships is not a local change", () => {
  // Two factories ship different copies of one skill. Updating them back to
  // back in one uncommitted tree must end on the second factory's copy, as it
  // always has: the first run's output is the installer's, not the user's.
  const s = sandbox({ git: true });
  assert.equal(s.init("--skills", "manual-qa/playwright-testing").status, 0);
  s.commitAll("install");
  const dest = s.p(".claude/skills/playwright-testing/SKILL.md");
  const fd = shipped("bundles/feature-development/skills/playwright-testing/SKILL.md");
  const mq = shipped("bundles/manual-qa/skills/playwright-testing/SKILL.md");
  assert.notEqual(fd, mq, "fixture: the two factories' copies differ");

  assert.equal(s.init("--skills", "feature-development/playwright-testing", "--update").status, 0);
  assert.equal(readFileSync(dest, "utf8"), fd);
  assert.notEqual(s.git("status", "--porcelain", "--", ".claude/skills/playwright-testing"), "", "fixture: uncommitted after the first run");

  const r = s.init("--skills", "manual-qa/playwright-testing", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(dest, "utf8"), mq);
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
  assert.ok(!existsSync(s.p(BACKUP_ROOT)));
});

test("a destination the same run already replaced is not backed up or judged a second time", () => {
  // Outside git, with an agent the installer rewrites after the copy (Cursor
  // gets a skills list), named twice in one run. The second pass meets the
  // run's own output: it differs from every shipped copy, so only the record
  // of what this run wrote stops a second backup over the first.
  const s = sandbox();
  const args = ["--agents", "personal-assistant,personal-assistant", "--skills", "memory", "--target", "cursor"];
  assert.equal(s.init(...args).status, 0);
  const agent = s.p(".cursor/agents/personal-assistant/AGENT.md");
  assert.match(readFileSync(agent, "utf8"), /SKILLS-INJECTED/, "fixture: the installed agent is not a plain copy");
  writeFileSync(agent, "my local edit\n");
  const r = s.init(...args, "--update");
  assert.equal(r.status, 0, r.out);
  const saved = [...r.out.matchAll(/previous copy saved to (\S+)/g)].map((m) => m[1]);
  assert.equal(saved.length, 1, r.out);
  assert.equal(readFileSync(s.p(saved[0], "AGENT.md"), "utf8"), "my local edit\n", "the one backup holds the original content");
  assert.match(r.out, /Done: 3 installed, 0 skipped\./);
});

for (const [target, file] of [["copilot", ".github/agents/personal-assistant.agent.md"], ["codex", ".codex/agents/personal-assistant.toml"]]) {
  const args = ["--agents", "personal-assistant", "--skills", "memory", "--target", target];
  const oldInstall = (git) => {
    const s = sandbox({ git });
    assert.equal(s.init(...args).status, 0);
    writeFileSync(s.p(file), "old agent file\n");
    if (git) s.commitAll("old install");
    return s;
  };

  test(`${target} single-file agent, clean and tracked: --update overwrites it, as before`, () => {
    const s = oldInstall(true);
    const r = s.init(...args, "--update");
    assert.equal(r.status, 0, r.out);
    assert.notEqual(readFileSync(s.p(file), "utf8"), "old agent file\n");
    assert.doesNotMatch(r.out, /kept:|NOT updated/);
  });

  test(`${target} single-file agent with an uncommitted edit: kept; --force overwrites`, () => {
    const s = oldInstall(true);
    writeFileSync(s.p(file), "my local edit\n");
    const r = s.init(...args, "--update");
    assert.equal(r.status, 0, r.out);
    assert.equal(readFileSync(s.p(file), "utf8"), "my local edit\n");
    assert.match(r.out, KEPT("agent", "personal-assistant"));
    assert.match(r.out, SUMMARY);
    const forced = s.init(...args, "--update", "--force");
    assert.equal(forced.status, 0, forced.out);
    assert.notEqual(readFileSync(s.p(file), "utf8"), "my local edit\n");
    assert.doesNotMatch(forced.out, /kept:|NOT updated/);
  });

  test(`${target} single-file agent outside git: the old file is copied to a backup first`, () => {
    const s = oldInstall(false);
    const r = s.init(...args, "--update");
    assert.equal(r.status, 0, r.out);
    assert.notEqual(readFileSync(s.p(file), "utf8"), "old agent file\n");
    const m = r.out.match(/agent\s+personal-assistant: previous copy saved to (\S+)/);
    assert.ok(m, r.out);
    assert.ok(!m[1].includes("/."), `backup path has no dot-folder a host could scan: ${m[1]}`);
    assert.equal(readFileSync(s.p(m[1]), "utf8"), "old agent file\n");
  });
}

// ── Item 4: one backup per run for settings files ───────────────────────────

const USER_SETTINGS = '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n';

test("a factory install merges settings.json twice; the backup holds the file as it was before the run", () => {
  const s = sandbox();
  mkdirSync(s.p(".claude"));
  writeFileSync(s.p(".claude/settings.json"), USER_SETTINGS);
  const r = s.init("--factory", "manual-qa");
  assert.equal(r.status, 0, r.out);
  const merged = JSON.parse(readFileSync(s.p(".claude/settings.json"), "utf8"));
  const tags = new Set(Object.values(merged.hooks).flat().map((g) => g._factory));
  assert.ok(tags.has("sdlc-core") && tags.has("manual-qa"), "fixture: both merges ran in this one run");
  assert.equal(readFileSync(s.p(".claude/settings.json.bak"), "utf8"), USER_SETTINGS);
});

test("a settings file the run itself created is not backed up by the run's second merge", () => {
  const s = sandbox();
  const r = s.init("--factory", "manual-qa");
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(s.p(".claude/settings.json")));
  assert.ok(!existsSync(s.p(".claude/settings.json.bak")), "nothing of the user's existed to back up");
});

test("mergeClaudeSettingsHooks: two merges in one process write the backup once", () => {
  const file = join(mkdtempSync(join(tmpdir(), "safe-update-")), "settings.json");
  writeFileSync(file, USER_SETTINGS);
  const spec = { SessionStart: [{ hooks: [{ type: "command", command: "true" }] }] };
  assert.equal(mergeClaudeSettingsHooks(file, spec, "one"), true);
  assert.equal(mergeClaudeSettingsHooks(file, spec, "two"), true);
  assert.equal(readFileSync(file + ".bak", "utf8"), USER_SETTINGS);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).hooks.SessionStart.length, 2, "both merges still land");
});

test("mergeVersionedHooks: two merges in one process write the backup once", () => {
  const file = join(mkdtempSync(join(tmpdir(), "safe-update-")), "hooks.json");
  const original = '{ "version": 1, "hooks": { "sessionStart": [{ "command": "./mine.sh" }] } }\n';
  writeFileSync(file, original);
  assert.equal(mergeVersionedHooks(file, { sessionStart: [{ command: "./one/run.sh" }] }, "/one/"), true);
  assert.equal(mergeVersionedHooks(file, { sessionStart: [{ command: "./two/run.sh" }] }, "/two/"), true);
  assert.equal(readFileSync(file + ".bak", "utf8"), original);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).hooks.sessionStart.length, 3, "both merges still land, the user's hook stays");
});

// ── Item 3: copyTreeDereferenced stays inside its source tree ───────────────

// A package-like tree: pkg/skills/demo is what gets copied; pkg/shared is
// inside the package but outside the skill; outside/ is outside the package.
function linkFixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "safe-update-links-")));
  const pkg = join(base, "pkg");
  const src = join(pkg, "skills", "demo");
  mkdirSync(join(src, "sub"), { recursive: true });
  mkdirSync(join(pkg, "shared"));
  mkdirSync(join(base, "outside"));
  writeFileSync(join(src, "SKILL.md"), "skill\n");
  writeFileSync(join(src, "sub", "inner.md"), "inner\n");
  writeFileSync(join(pkg, "shared", "guide.md"), "guide\n");
  writeFileSync(join(base, "outside", "secret.txt"), "secret\n");
  return { base, pkg, src, dest: join(base, "dest") };
}

// Runs the copy with console.error captured; returns the warnings.
function copyQuietly(src, dest, opts) {
  const warnings = [];
  const original = console.error;
  console.error = (...a) => warnings.push(a.join(" "));
  try {
    copyTreeDereferenced(src, dest, opts);
  } finally {
    console.error = original;
  }
  return warnings;
}

test("a link whose target is outside the allowed root is skipped with a warning", () => {
  const f = linkFixture();
  symlinkSync(join(f.base, "outside", "secret.txt"), join(f.src, "leak.txt"));
  symlinkSync(join(f.base, "outside"), join(f.src, "leak-dir"));
  const warnings = copyQuietly(f.src, f.dest, { force: true, root: f.pkg });
  assert.deepEqual(readdirSync(f.dest).sort(), ["SKILL.md", "sub"], "nothing from outside the root is copied");
  assert.equal(warnings.length, 2, warnings.join("\n"));
  for (const w of warnings) assert.match(w, /skipped symlink .*leak.* \(outside /);
});

test("a link whose target is inside the allowed root is copied as real content, as before", () => {
  const f = linkFixture();
  symlinkSync(join("..", "..", "shared"), join(f.src, "references")); // out of the skill, inside the package
  symlinkSync(join("sub", "inner.md"), join(f.src, "alias.md"));
  symlinkSync("sub", join(f.src, "sub-again")); // the same folder twice is not a cycle
  const warnings = copyQuietly(f.src, f.dest, { force: true, root: f.pkg });
  assert.deepEqual(warnings, []);
  assert.equal(readFileSync(join(f.dest, "references", "guide.md"), "utf8"), "guide\n");
  assert.equal(readFileSync(join(f.dest, "alias.md"), "utf8"), "inner\n");
  assert.equal(readFileSync(join(f.dest, "sub-again", "inner.md"), "utf8"), "inner\n");
  for (const name of ["references", "alias.md", "sub-again"]) assert.ok(!lstatSync(join(f.dest, name)).isSymbolicLink(), `${name} is materialized`);
});

test("with no root given, the allowed root is the tree being copied", () => {
  const f = linkFixture();
  symlinkSync(join("sub", "inner.md"), join(f.src, "alias.md"));
  symlinkSync(join("..", "..", "shared"), join(f.src, "references"));
  const warnings = copyQuietly(f.src, f.dest, { force: true });
  assert.equal(readFileSync(join(f.dest, "alias.md"), "utf8"), "inner\n", "a link inside the tree is copied");
  assert.ok(!existsSync(join(f.dest, "references")), "a link out of the tree is not");
  assert.equal(warnings.length, 1, warnings.join("\n"));
});

test("a top-level link is checked against the root the caller names", () => {
  const f = linkFixture();
  const inside = join(f.pkg, "skills", "linked");
  const outside = join(f.pkg, "skills", "escaped");
  symlinkSync(f.src, inside);
  symlinkSync(join(f.base, "outside"), outside);
  assert.deepEqual(copyQuietly(inside, f.dest, { force: true, root: f.pkg }), []);
  assert.equal(readFileSync(join(f.dest, "SKILL.md"), "utf8"), "skill\n");
  const dest2 = join(f.base, "dest2");
  assert.equal(copyQuietly(outside, dest2, { force: true, root: f.pkg }).length, 1);
  assert.ok(!existsSync(dest2));
});

test("a directory cycle is detected and the copy terminates", () => {
  const f = linkFixture();
  symlinkSync("..", join(f.src, "sub", "loop")); // sub/loop → the skill folder itself
  const warnings = copyQuietly(f.src, f.dest, { force: true, root: f.pkg });
  assert.equal(readFileSync(join(f.dest, "sub", "inner.md"), "utf8"), "inner\n");
  assert.ok(!existsSync(join(f.dest, "sub", "loop")), "the cycle is not followed");
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /cycle/);
});

test("external skill: a link inside the fetched checkout is materialized, one that leaves it is skipped", () => {
  const s = sandbox();
  // A local stand-in for the upstream repository, cloned into the installer's
  // cache where it looks for chrisbanes/skills. Its `origin` is a local path,
  // so the installer's fetch never leaves the sandbox.
  const upstream = join(s.base, "upstream");
  const skill = join(upstream, "skills", "compose-state-and-effects");
  mkdirSync(skill, { recursive: true });
  mkdirSync(join(upstream, "references"));
  mkdirSync(join(s.base, "outside"));
  writeFileSync(join(upstream, "references", "guide.md"), "guide\n");
  writeFileSync(join(s.base, "outside", "secret.txt"), "secret\n");
  writeFileSync(join(skill, "SKILL.md"), "---\nname: compose-state-and-effects\ndescription: stand-in\n---\n");
  symlinkSync(join("..", "..", "references"), join(skill, "references"));
  symlinkSync(join(s.base, "outside", "secret.txt"), join(skill, "leak.txt"));
  const git = (...args) => {
    const r = s.run("git", args);
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q", "--initial-branch=main", upstream);
  git("-C", upstream, "add", "-A");
  git("-C", upstream, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qm", "upstream");
  const cache = join(s.home, ".cache", "sdlc-skills", "registry");
  mkdirSync(cache, { recursive: true });
  git("clone", "-q", upstream, join(cache, "chrisbanes__skills"));

  const r = s.init("--skills", "compose-state-and-effects");
  assert.equal(r.status, 0, r.out);
  const installed = s.p(".claude/skills/compose-state-and-effects");
  assert.ok(existsSync(join(installed, "SKILL.md")), r.out);
  assert.equal(readFileSync(join(installed, "references", "guide.md"), "utf8"), "guide\n", "a link to a sibling folder of the checkout still installs");
  assert.ok(!lstatSync(join(installed, "references")).isSymbolicLink());
  assert.ok(!existsSync(join(installed, "leak.txt")), "a link out of the checkout is not copied");
  assert.match(r.out, /skipped symlink .*leak\.txt/);
});

// ── Rework: seed type conflicts and links in a scaffold ─────────────────────

test("seed destination is a file where the scaffold has a folder: kept, reported, install continues", () => {
  const s = sandbox();
  mkdirSync(s.p(".agents/security-testing"), { recursive: true });
  writeFileSync(s.p(".agents/security-testing/knowledge"), "my file\n");
  const r = s.init("--factory", "security-testing");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".agents/security-testing/knowledge"), "utf8"), "my file\n");
  assert.equal((r.out.match(/! seed \.agents\/security-testing\/knowledge: the project has a file where the factory has a folder; kept/g) || []).length, 1, r.out);
  assert.match(r.out, /Done: /);
});

test("seed destination has a folder where the scaffold has a file: kept, reported, the rest is added", () => {
  const s = sandbox();
  mkdirSync(s.p(".agents/security-testing/knowledge/finding-schema.md"), { recursive: true });
  writeFileSync(s.p(".agents/security-testing/knowledge/finding-schema.md/mine.md"), "mine\n");
  const r = s.init("--factory", "security-testing");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".agents/security-testing/knowledge/finding-schema.md/mine.md"), "utf8"), "mine\n");
  assert.ok(existsSync(s.p(".agents/security-testing/knowledge/report-template.md")), "the other scaffold files still arrive");
  assert.equal((r.out.match(/! seed \.agents\/security-testing\/knowledge\/finding-schema\.md: the project has a folder where the factory has a file; kept/g) || []).length, 1, r.out);
});

test("a file where the seed's parent folder goes: kept, reported, install continues", () => {
  const s = sandbox();
  mkdirSync(s.p(".agents"));
  writeFileSync(s.p(".agents/security-testing"), "my file\n");
  const r = s.init("--factory", "security-testing");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".agents/security-testing"), "utf8"), "my file\n");
  assert.match(r.out, /! seed \.agents\/security-testing\/knowledge: the project has a file where one of its parent folders goes; kept, nothing seeded/);
  assert.match(r.out, /Done: /);
});

test("seedMissingFiles checks links before following them and stops on a cycle", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "safe-update-seed-")));
  const scaffold = join(base, "pkg", "scaffold");
  const dest = join(base, "project", "docs");
  mkdirSync(join(scaffold, "sub"), { recursive: true });
  mkdirSync(join(base, "pkg", "shared"));
  mkdirSync(join(base, "outside"));
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(scaffold, "sub", "inner.md"), "inner\n");
  writeFileSync(join(base, "pkg", "shared", "guide.md"), "guide\n");
  writeFileSync(join(base, "outside", "secret.txt"), "secret\n");
  symlinkSync(join(base, "outside"), join(scaffold, "leak-dir"));
  symlinkSync(join(base, "outside", "secret.txt"), join(scaffold, "leak.txt"));
  symlinkSync("..", join(scaffold, "sub", "loop"));
  symlinkSync(join("..", "shared"), join(scaffold, "references"));

  const warnings = [];
  const original = console.error;
  console.error = (...a) => warnings.push(a.join(" "));
  let added;
  try {
    added = seedMissingFiles(scaffold, dest, join(base, "pkg"));
  } finally {
    console.error = original;
  }
  assert.equal(added, 2, "inner.md and the linked guide.md");
  assert.deepEqual(readdirSync(dest).sort(), ["references", "sub"]);
  assert.deepEqual(readdirSync(join(dest, "sub")), ["inner.md"], "the cycle is not followed");
  assert.equal(readFileSync(join(dest, "references", "guide.md"), "utf8"), "guide\n", "a link inside the root is still followed");
  assert.equal(warnings.length, 3, warnings.join("\n"));
});

// ── Rework: the update guard ────────────────────────────────────────────────

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

test("an agent the update kept is not rewritten by the factory's skill overlay", () => {
  // The iOS overlay removes playwright-testing from qa-engineer. The user put
  // it back and has not committed that.
  const s = sandbox({ git: true });
  const args = ["--factory", "feature-development", "--agents", "ios-dev"];
  assert.equal(s.init(...args).status, 0);
  const agent = s.p(".claude/agents/qa-engineer/AGENT.md");
  const installed = readFileSync(agent, "utf8");
  const onDemand = (text) => text.match(/^skills-on-demand: \[.*\]$/m)[0];
  assert.doesNotMatch(onDemand(installed), /playwright-testing/, "fixture: the overlay removed it at install");
  s.commitAll("install");
  const restored = installed.replace(/^skills-on-demand: \[/m, "skills-on-demand: [playwright-testing, ");
  assert.notEqual(restored, installed);
  writeFileSync(agent, restored);

  const r = s.init(...args, "--update");
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, KEPT("agent", "qa-engineer"));
  assert.equal(readFileSync(agent, "utf8"), restored, "the kept agent is byte-for-byte the user's");
  assert.doesNotMatch(r.out, /↻ skills\s+qa-engineer/);
  assert.match(r.out, /↻ skills\s+tech-lead/, "agents the run did replace are still tuned");
});

test("a plain re-run that adds a role still tunes the agents already installed", () => {
  const s = sandbox();
  assert.equal(s.init("--factory", "feature-development", "--agents", "python-dev").status, 0);
  const agent = s.p(".claude/agents/tech-lead/AGENT.md");
  assert.doesNotMatch(readFileSync(agent, "utf8"), /swiftui-pro/);
  const r = s.init("--factory", "feature-development", "--agents", "python-dev,ios-dev");
  assert.equal(r.status, 0, r.out);
  assert.match(readFileSync(agent, "utf8"), /^skills-on-demand: \[.*swiftui-pro/m);
});

test("a tracked skill the user deleted without committing stays deleted; --force installs it", () => {
  const s = committedOldInstall();
  rmSync(s.p(".claude/skills/memory"), { recursive: true });
  const r = s.init("--skills", "memory,knowledge-curation", "--update");
  assert.equal(r.status, 0, r.out);
  assert.ok(!existsSync(s.p(".claude/skills/memory")), "the deletion is a local change; nothing is recreated");
  assert.match(r.out, KEPT("skill", "memory"));
  assert.equal(r.out.match(SUMMARY)?.[1], "1", r.out);
  assert.equal(readFileSync(s.p(".claude/skills/knowledge-curation/SKILL.md"), "utf8"), shipped("skills/knowledge-curation/SKILL.md"));
  const forced = s.init("--skills", "memory", "--update", "--force");
  assert.equal(forced.status, 0, forced.out);
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), shipped("skills/memory/SKILL.md"));
});

test("a destination git never tracked is a new install under --update, as before", () => {
  const s = committedOldInstall();
  const r = s.init("--skills", "memory,verifying-outcomes", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".claude/skills/verifying-outcomes/SKILL.md"), "utf8"), shipped("skills/verifying-outcomes/SKILL.md"));
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
});

for (const [target, file] of [["copilot", ".github/agents/personal-assistant.agent.md"], ["codex", ".codex/agents/personal-assistant.toml"]]) {
  test(`${target} single-file agent deleted without committing stays deleted`, () => {
    const s = sandbox({ git: true });
    const args = ["--agents", "personal-assistant", "--skills", "memory", "--target", target];
    assert.equal(s.init(...args).status, 0);
    s.commitAll("install");
    rmSync(s.p(file));
    const r = s.init(...args, "--update");
    assert.equal(r.status, 0, r.out);
    assert.ok(!existsSync(s.p(file)));
    assert.match(r.out, KEPT("agent", "personal-assistant"));
  });
}

test("GIT_DIR and GIT_WORK_TREE aimed at another clean checkout do not hide a local edit", () => {
  const s = committedOldInstall();
  const other = join(s.base, "other");
  s.git("clone", "-q", s.project, other); // same paths, nothing to commit
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  const r = s.initEnv({ GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other }, "--skills", "memory", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), "my local edit\n");
  assert.match(r.out, KEPT("skill", "memory"));
  assert.ok(!existsSync(s.p(BACKUP_ROOT)));
});

test("a destination that is a submodule with ignore=all still shows its local change", () => {
  const s = sandbox({ git: true });
  const upstream = join(s.base, "skill-repo");
  mkdirSync(upstream);
  writeFileSync(join(upstream, "SKILL.md"), "old memory\n");
  const g = (...args) => {
    const r = s.run("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args]);
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  g("init", "-q", upstream);
  g("-C", upstream, "add", "-A");
  g("-C", upstream, "commit", "-qm", "skill");
  g("submodule", "add", "-q", upstream, ".claude/skills/memory");
  g("config", "submodule..claude/skills/memory.ignore", "all");
  s.commitAll("project with a submodule skill");
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  assert.equal(s.git("status", "--porcelain"), "", "fixture: plain git status hides the change");

  const r = s.init("--skills", "memory", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), "my local edit\n");
  assert.match(r.out, KEPT("skill", "memory"));
});

test("two backups in the same second both survive", () => {
  const s = sandbox();
  assert.equal(s.init("--skills", "memory").status, 0);
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "second edit\n");
  // Stand-ins for a backup an earlier run made in the second this run will hit.
  const earlier = [];
  for (let i = 0; i < 20; i++) {
    const f = s.p(BACKUP_ROOT, stamp(Date.now() + i * 1000), "claude/skills/memory/SKILL.md");
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "first backup\n");
    earlier.push(f);
  }
  const r = s.init("--skills", "memory", "--update");
  assert.equal(r.status, 0, r.out);
  const m = r.out.match(/previous copy saved to (\S+)/);
  assert.ok(m, r.out);
  assert.equal(readFileSync(s.p(m[1], "SKILL.md"), "utf8"), "second edit\n");
  for (const f of earlier) assert.equal(readFileSync(f, "utf8"), "first backup\n", "an earlier backup is not overwritten");
});

// A local stand-in for chrisbanes/skills, cloned into the installer's cache.
// Its `origin` is a local path, so the installer's fetch never leaves the sandbox.
const EXTERNAL = "compose-state-and-effects";
function externalFixture(s, body = "upstream v1\n") {
  const upstream = join(s.base, "upstream");
  const skill = join(upstream, "skills", EXTERNAL);
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), `---\nname: ${EXTERNAL}\ndescription: stand-in\n---\n${body}`);
  const g = (...args) => {
    const r = s.run("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args]);
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  };
  g("init", "-q", "--initial-branch=main", upstream);
  g("-C", upstream, "add", "-A");
  g("-C", upstream, "commit", "-qm", "upstream");
  const cache = join(s.home, ".cache", "sdlc-skills", "registry");
  mkdirSync(cache, { recursive: true });
  g("clone", "-q", upstream, join(cache, "chrisbanes__skills"));
  return {
    publish(text) {
      writeFileSync(join(skill, "SKILL.md"), `---\nname: ${EXTERNAL}\ndescription: stand-in\n---\n${text}`);
      g("-C", upstream, "commit", "-qam", "upstream change");
    },
  };
}
const externalFile = (s) => s.p(".claude/skills", EXTERNAL, "SKILL.md");

test("external skill, clean and tracked: --update replaces it with the new upstream content, as before", () => {
  const s = sandbox({ git: true });
  const up = externalFixture(s);
  assert.equal(s.init("--skills", EXTERNAL).status, 0);
  s.commitAll("install");
  up.publish("upstream v2\n");
  const r = s.init("--skills", EXTERNAL, "--update");
  assert.equal(r.status, 0, r.out);
  assert.match(readFileSync(externalFile(s), "utf8"), /upstream v2/);
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
  assert.ok(!existsSync(s.p(BACKUP_ROOT)));
});

test("external skill with an uncommitted edit: kept; --force replaces", () => {
  const s = sandbox({ git: true });
  const up = externalFixture(s);
  assert.equal(s.init("--skills", EXTERNAL).status, 0);
  s.commitAll("install");
  up.publish("upstream v2\n");
  writeFileSync(externalFile(s), "my local edit\n");
  const r = s.init("--skills", EXTERNAL, "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(externalFile(s), "utf8"), "my local edit\n");
  assert.match(r.out, KEPT("skill", EXTERNAL));
  assert.match(r.out, SUMMARY);
  const forced = s.init("--skills", EXTERNAL, "--update", "--force");
  assert.equal(forced.status, 0, forced.out);
  assert.match(readFileSync(externalFile(s), "utf8"), /upstream v2/);
});

test("external skill deleted without committing stays deleted", () => {
  const s = sandbox({ git: true });
  externalFixture(s);
  assert.equal(s.init("--skills", EXTERNAL).status, 0);
  s.commitAll("install");
  rmSync(s.p(".claude/skills", EXTERNAL), { recursive: true });
  const r = s.init("--skills", EXTERNAL, "--update");
  assert.equal(r.status, 0, r.out);
  assert.ok(!existsSync(s.p(".claude/skills", EXTERNAL)));
  assert.match(r.out, KEPT("skill", EXTERNAL));
});

test("external skill outside git: the old folder is copied to a backup before it is replaced", () => {
  const s = sandbox();
  const up = externalFixture(s);
  assert.equal(s.init("--skills", EXTERNAL).status, 0);
  up.publish("upstream v2\n");
  writeFileSync(externalFile(s), "my local edit\n");
  const r = s.init("--skills", EXTERNAL, "--update");
  assert.equal(r.status, 0, r.out);
  assert.match(readFileSync(externalFile(s), "utf8"), /upstream v2/);
  const m = r.out.match(/previous copy saved to (\S+)/);
  assert.ok(m, r.out);
  assert.equal(readFileSync(s.p(m[1], "SKILL.md"), "utf8"), "my local edit\n");
});

test("external skill unchanged since install is replaced without a backup outside git", () => {
  const s = sandbox();
  externalFixture(s);
  assert.equal(s.init("--skills", EXTERNAL).status, 0);
  const r = s.init("--skills", EXTERNAL, "--update");
  assert.equal(r.status, 0, r.out);
  assert.ok(!existsSync(s.p(BACKUP_ROOT)), "identical to the fetched copy: nothing to save");
});

test("the NOT updated summary is printed even when the run fails later", () => {
  const s = committedOldInstall();
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  rmSync(s.p(".claude/hooks"), { recursive: true });
  writeFileSync(s.p(".claude/hooks"), "a file where the hook scripts folder goes\n"); // makes the hooks step throw
  const r = s.init("--skills", "memory", "--update");
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Install failed:/);
  assert.match(r.out, KEPT("skill", "memory"));
  assert.equal(r.out.match(SUMMARY)?.[1], "1", r.out);
});

// ── Round 2 ─────────────────────────────────────────────────────────────────

test("a file where an installed factory's seed parent goes does not abort a later update", () => {
  const s = sandbox();
  writeFileSync(s.p("CLAUDE.md"), "# Project\n"); // the block lands in AGENTS.md and CLAUDE.md: two refresh passes
  assert.equal(s.init("--factory", "security-testing").status, 0);
  rmSync(s.p(".agents/security-testing"), { recursive: true });
  writeFileSync(s.p(".agents/security-testing"), "my file\n");
  const r = s.init("--skills", "memory", "--update");
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(s.p(".agents/security-testing"), "utf8"), "my file\n");
  assert.equal((r.out.match(/! seed \.agents\/security-testing\/knowledge: the project has a file where one of its parent folders goes; kept, nothing seeded/g) || []).length, 1, r.out);
  assert.match(r.out, /Done: /);
});

test("the git snapshot honours the caller's GIT_CONFIG_GLOBAL", () => {
  // The caller's global config ignores .claude/ through core.excludesFile. With
  // it, git cannot restore the destination: backup, then replace. Without it,
  // git would report the folder untracked and the update would keep it.
  const s = sandbox({ git: true });
  const excludes = join(s.home, "ignore");
  const config = join(s.home, "gitconfig");
  writeFileSync(excludes, ".claude/\n.sdlc-skills-backup/\n");
  writeFileSync(config, `${readFileSync(NO_NETWORK, "utf8")}[core]\n\texcludesFile = ${excludes}\n`);
  const env = { GIT_CONFIG_GLOBAL: config };
  assert.equal(s.initEnv(env, "--skills", "memory").status, 0);
  writeFileSync(s.p(".claude/skills/memory/SKILL.md"), "my local edit\n");
  const r = s.initEnv(env, "--skills", "memory", "--update");
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
  const m = r.out.match(/previous copy saved to (\S+)/);
  assert.ok(m, r.out);
  assert.equal(readFileSync(s.p(m[1], "SKILL.md"), "utf8"), "my local edit\n");
  assert.equal(readFileSync(s.p(".claude/skills/memory/SKILL.md"), "utf8"), shipped("skills/memory/SKILL.md"));
});
