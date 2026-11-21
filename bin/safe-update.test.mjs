// safe-update.test.mjs — `init --update` must not destroy what a user may own.
//
// Every case runs the real installer (bin/init.mjs) in a throwaway project.
// HOME, the installer's cache dir and the global git config are pinned to the
// sandbox, and GIT_* variables a calling git hook may have set are dropped, so
// nothing here reads or writes the developer's home, cache, git config or
// repository, and nothing reaches the network (same fixture as
// security-testing-e2e.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { mergeClaudeSettingsHooks, mergeVersionedHooks } from "./init.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const INIT = join(REPO, "bin/init.mjs");
const NO_NETWORK = join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig");

function sandbox({ git = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "safe-update-"));
  const home = join(base, "home");
  const project = join(base, "project");
  mkdirSync(home);
  mkdirSync(project);
  const env = { ...process.env, HOME: home, SDLC_SKILLS_CACHE_DIR: join(home, ".cache"), GIT_CONFIG_GLOBAL: NO_NETWORK, GIT_CONFIG_NOSYSTEM: "1" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"]) delete env[k];
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: project, encoding: "utf8", env });
  const git_ = (...args) => {
    const r = run("git", args);
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const init = (...args) => {
    const withTarget = args.includes("--target") ? args : [...args, "--target", "claude"];
    const r = run(process.execPath, [INIT, "init", ...withTarget, "--yes"]);
    r.out = r.stdout + r.stderr;
    return r;
  };
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
  return { project, init, git: git_, commitAll, p: (...parts) => join(project, ...parts) };
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

test("a destination the same run already replaced is replaced again, not kept", () => {
  const s = committedOldInstall();
  const r = s.init("--skills", "memory,memory", "--update");
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /kept:|NOT updated/);
  assert.match(r.out, /Done: 2 installed, 0 skipped\./);
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
