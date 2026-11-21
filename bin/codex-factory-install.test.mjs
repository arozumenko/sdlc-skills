// Codex agents install as generated .toml files, not copied AGENT.md
// directories. These tests install a factory with `--target codex` and read the
// installed .toml: a factory's own skills are enabled, and a factory's skill
// overlay reaches the agent. HOME, the installer cache and git's global config
// are pinned to temp dirs (pattern: bin/lib/core-hook-spec.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const NO_NETWORK = join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig");

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "cfi-"));
  for (const d of ["home", "proj"]) mkdirSync(join(root, d));
  const env = { ...process.env, HOME: join(root, "home"), SDLC_SKILLS_CACHE_DIR: join(root, "cache"), GIT_CONFIG_GLOBAL: NO_NETWORK };
  return { root, proj: join(root, "proj"), env };
}
const install = (init, cwd, env, ...args) =>
  spawnSync(process.execPath, [init, "init", ...args, "--target", "codex", "--yes"], { cwd, env, encoding: "utf8" });
// The skills an installed Codex agent enables, in file order.
const enabled = (toml) => [...toml.matchAll(/\[\[skills\.config\]\]\npath = "\.codex\/skills\/([^/"]+)\/SKILL\.md"\nenabled = true/g)].map((m) => m[1]);

// A package copy holding the real installer and one small factory: two agents,
// three factory-owned skills, and a skill overlay on each agent.
function fixturePackage(root) {
  const pkg = join(root, "pkg");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  cpSync(join(REPO, "bin/init.mjs"), join(pkg, "bin/init.mjs"));
  cpSync(join(REPO, "bin/lib"), join(pkg, "bin/lib"), { recursive: true, filter: (src) => !src.endsWith(".test.mjs") });
  const put = (rel, text) => { mkdirSync(join(pkg, rel, ".."), { recursive: true }); writeFileSync(join(pkg, rel), text); };
  const overlay = { add: ["added"], remove: ["dropped"] };
  put("bundles/demo/factory.json", JSON.stringify({
    id: "demo", title: "Demo", agents: [], localAgents: ["worker", "planner"], localSkills: ["kept", "dropped", "added"], skills: [],
    skillOverlays: { worker: overlay, planner: overlay },
  }));
  for (const id of ["kept", "dropped", "added"]) put(`bundles/demo/skills/${id}/SKILL.md`, `---\nname: ${id}\ndescription: Fixture skill\n---\n# ${id}\n`);
  put("bundles/demo/agents/worker/AGENT.md", "---\nname: worker\ndescription: Fixture agent\nmodel: sonnet\nskills: [kept, dropped]\n---\n\n# Worker\n");
  put("bundles/demo/agents/planner/AGENT.md", "---\nname: planner\ndescription: Fixture agent\nmodel: sonnet\nskills: [kept, dropped]\nskills-on-demand: []\n---\n\n# Planner\n");
  return pkg;
}

test("a factory-owned skill is enabled in the installed Codex agent", () => {
  const { root, proj, env } = sandbox();
  try {
    const r = install(join(REPO, "bin/init.mjs"), proj, env, "--factory", "security-testing");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    // security-lead declares `skills: [memory, security-engagement]`: one
    // top-level skill, one that only the security-testing factory owns.
    assert.deepEqual(enabled(readFileSync(join(proj, ".codex/agents/security-lead.toml"), "utf8")), ["memory", "security-engagement"]);
    assert.ok(existsSync(join(proj, ".codex/skills/security-engagement/SKILL.md")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a skill overlay reaches the installed Codex agent", () => {
  const { root, proj, env } = sandbox();
  try {
    const init = join(fixturePackage(root), "bin/init.mjs");
    const r = install(init, proj, env, "--factory", "demo");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const worker = readFileSync(join(proj, ".codex/agents/worker.toml"), "utf8");
    assert.deepEqual(enabled(worker), ["kept", "added"]);
    assert.doesNotMatch(worker, /dropped/);
    assert.match(r.stdout, /↻ skills {2}worker \(\+added -dropped\)/);
    // Same rule as every other target: on an agent that has a
    // `skills-on-demand:` line the add lands there — installed, not enabled.
    assert.deepEqual(enabled(readFileSync(join(proj, ".codex/agents/planner.toml"), "utf8")), ["kept"]);
    assert.ok(existsSync(join(proj, ".codex/skills/added/SKILL.md")));

    // A second run without --update leaves the overlaid file as it is.
    const again = install(init, proj, env, "--factory", "demo");
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.equal(readFileSync(join(proj, ".codex/agents/worker.toml"), "utf8"), worker);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
