// Several factories may own the same agent or skill id, with different content,
// and every copy installs to one folder per id. When an install skips an item
// because the folder exists, the "exists" line says the folder may hold another
// factory's copy — only for ids that more than one factory owns. HOME, the
// installer cache and git's global config are pinned to temp dirs (pattern:
// bin/lib/core-hook-spec.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const NO_NETWORK = join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig");
const NOTE = "exists, maybe another factory's copy; use --update to replace it";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "ecn-"));
  for (const d of ["home", "proj"]) mkdirSync(join(root, d));
  const env = { ...process.env, HOME: join(root, "home"), SDLC_SKILLS_CACHE_DIR: join(root, "cache"), GIT_CONFIG_GLOBAL: NO_NETWORK };
  const run = (init, ...args) => {
    const r = spawnSync(process.execPath, [init, "init", ...args, "--target", "claude", "--yes"], { cwd: join(root, "proj"), env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return r.stdout;
  };
  return { root, proj: join(root, "proj"), run };
}

test("standalone skill: a skipped id that two factories own gets the note, a single-owner id does not", () => {
  const { root, proj, run } = sandbox();
  try {
    const init = join(REPO, "bin/init.mjs");
    run(init, "--skills", "test-automation/code-review,memory");
    const first = readFileSync(join(proj, ".claude/skills/code-review/SKILL.md"), "utf8");
    const out = run(init, "--skills", "feature-development/code-review,memory");
    assert.ok(out.includes(`— skill  code-review (${NOTE})`), out);
    assert.ok(out.includes("— skill  memory (exists; use --update)"), out);
    // The skip itself is unchanged: the first factory's copy is still on disk.
    assert.equal(readFileSync(join(proj, ".claude/skills/code-review/SKILL.md"), "utf8"), first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A package copy with two factories that both own agent `worker` and skill
// `shared`; factory `two` alone owns skill `solo`.
function fixturePackage(root) {
  const pkg = join(root, "pkg");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  cpSync(join(REPO, "bin/init.mjs"), join(pkg, "bin/init.mjs"));
  cpSync(join(REPO, "bin/lib"), join(pkg, "bin/lib"), { recursive: true, filter: (src) => !src.endsWith(".test.mjs") });
  const put = (rel, text) => { mkdirSync(join(pkg, rel, ".."), { recursive: true }); writeFileSync(join(pkg, rel), text); };
  for (const [id, skills] of [["one", ["shared"]], ["two", ["shared", "solo"]]]) {
    put(`bundles/${id}/factory.json`, JSON.stringify({ id, title: id, agents: [], localAgents: ["worker"], localSkills: skills, skills: [] }));
    put(`bundles/${id}/agents/worker/AGENT.md`, `---\nname: worker\ndescription: Worker of ${id}\nmodel: sonnet\nskills: [shared]\n---\n\n# Worker of ${id}\n`);
    for (const s of skills) put(`bundles/${id}/skills/${s}/SKILL.md`, `---\nname: ${s}\ndescription: Fixture skill\n---\n# ${s} of ${id}\n`);
  }
  return pkg;
}

test("factory install: skipped agent and skill ids that another factory also owns get the note", () => {
  const { root, proj, run } = sandbox();
  try {
    const init = join(fixturePackage(root), "bin/init.mjs");
    run(init, "--factory", "one");
    const out = run(init, "--factory", "two");
    assert.ok(out.includes(`— agent  worker (${NOTE})`), out);
    assert.ok(out.includes(`— skill  shared (${NOTE})`), out);
    assert.match(readFileSync(join(proj, ".claude/skills/shared/SKILL.md"), "utf8"), /shared of one/);
    // An id only this factory owns keeps the plain line.
    assert.ok(run(init, "--factory", "two").includes("— skill  solo (exists; use --update)"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
