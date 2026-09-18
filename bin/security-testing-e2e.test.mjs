// security-testing-e2e.test.mjs — installed end-to-end test for the
// security-testing factory, offline.
//
// Runs the real installer (bin/init.mjs) into a throwaway consumer repo, the
// same way a human would, and drives the installed scripts from their
// installed location (.claude/skills/<id>/scripts/...) rather than in-repo —
// that is the shape a real consumer sees, and it is the only way to exercise
// path resolution such as secure-code-review/scripts/verify.mjs reaching
// ../../risk-register/scripts/register.mjs once both are installed siblings.
//
// Network is blocked via GIT_CONFIG_GLOBAL pointing `insteadOf` at a
// nonexistent path (fixtures/security-testing-e2e/no-network.gitconfig): the
// factory's `skills: ["memory", "knowledge-curation"]` are monorepo orphan
// skills (skills.json: `monorepo: sdlc-skills`), so a correct install never
// touches git-clone at all. If that ever regresses, the clone attempt fails
// loudly against /nonexistent/ instead of silently reaching the network.
//
// HOME and the installer's cache dir (SDLC_SKILLS_CACHE_DIR — see
// bin/init.mjs's cacheRoot()) are pinned to the temp consumer dir so nothing
// here ever reads or writes the developer's real ~/.cache or ~/.gitconfig.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = new URL("..", import.meta.url).pathname;
const INIT = join(REPO, "bin/init.mjs");

const sh = (cwd, cmd, args, env = {}) =>
  spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env, HOME: cwd, SDLC_SKILLS_CACHE_DIR: join(cwd, ".cache") } });

function consumerRepo() {
  const root = mkdtempSync(join(tmpdir(), "st-e2e-"));
  sh(root, "git", ["init", "-q"]);
  sh(root, "git", ["config", "user.email", "t@t"]);
  sh(root, "git", ["config", "user.name", "t"]);
  sh(root, "git", ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/app.js"), "export function q(db, id) {\n  return db.query('SELECT * FROM t WHERE id = ' + id);\n}\n");
  writeFileSync(join(root, "package.json"), '{"name":"c","type":"module","scripts":{"test":"node --test"}}\n');
  // installInstructions() only refreshes CLAUDE.md when it already exists
  // (it's auto-loaded and scout-owned; the installer never creates or bloats
  // a lean one) — a real Claude Code project already has one, so the fixture
  // seeds a minimal one to exercise the splice.
  writeFileSync(join(root, "CLAUDE.md"), "# Test Project\n");
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-qm", "c1"]);
  return root;
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

test("factory install on claude: three agents, five skills, briefings, splice; no network", () => {
  const root = consumerRepo();
  const r = sh(root, process.execPath, [INIT, "init", "--factory", "security-testing", "--target", "claude", "--yes"], {
    GIT_CONFIG_GLOBAL: join(REPO, "bin/fixtures/security-testing-e2e/no-network.gitconfig"),
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // The factory must install with zero network: no skill in the roster may
  // resolve to an external (repo:) entry. A future regression (e.g. a
  // skills-on-demand list gaining an external skill again) must fail this
  // test outright rather than pass "loudly but non-fatally".
  const output = r.stdout + r.stderr;
  assert.ok(!output.includes("github.com"), `installer output mentions github.com (network attempted): ${output}`);
  assert.ok(!/\b(?:clone|fetch)\b[^\n]*failed/i.test(output), `installer output has a clone/fetch failure line: ${output}`);
  for (const a of ["security-lead", "threat-modeler", "security-reviewer"]) {
    assert.ok(existsSync(join(root, ".claude/agents", a, "AGENT.md")), a);
    assert.ok(existsSync(join(root, ".agents/memory", a, "project_briefing.md")), a + " briefing");
  }
  for (const s of ["secure-code-review", "threat-modeling", "security-test-planning", "risk-register", "security-engagement"]) {
    assert.ok(existsSync(join(root, ".claude/skills", s, "SKILL.md")), s);
  }
  assert.match(readFileSync(join(root, "CLAUDE.md"), "utf8"), /<!-- FACTORY:security-testing START -->/);

  // PM ruling (supersedes the ≤90 single bound): two counts over the
  // installed skill + agent trees. installer-side skip of *.test.mjs /
  // fixtures/ is the follow-up that drops consumers to the runtime set.
  const skillDirs = ["secure-code-review", "threat-modeling", "security-test-planning", "risk-register", "security-engagement"].map((s) =>
    join(root, ".claude/skills", s)
  );
  const agentDirs = ["security-lead", "threat-modeler", "security-reviewer"].map((a) => join(root, ".claude/agents", a));
  const installed = [...skillDirs, ...agentDirs].filter(existsSync).flatMap(walk);
  const isTestFixtureEval = (p) => p.endsWith(".test.mjs") || p.includes("/fixtures/") || p.includes("/evals/");
  const runtime = installed.filter((p) => !isTestFixtureEval(p));
  const testFixtureEval = installed.filter(isTestFixtureEval);
  assert.ok(runtime.length <= 75, `installed runtime files ${runtime.length} > 75 — the bundle is growing again`);
  assert.ok(testFixtureEval.length <= 70, `installed test+fixture+eval files ${testFixtureEval.length} > 70 — the bundle is growing again`);
});

test("standalone one-skill path: init → review → check → register → verify", () => {
  const root = consumerRepo();
  assert.equal(sh(root, process.execPath, [INIT, "init", "--skills", "security-testing/secure-code-review", "--target", "claude", "--yes"]).status, 0);
  const cite = join(root, ".claude/skills/secure-code-review/scripts/cite.mjs");
  let r = sh(root, process.execPath, [cite, "init"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /EDIT-ENGAGEMENT-AND-RERUN/);
  writeFileSync(
    join(root, ".agents/security-testing/engagement.md"),
    "```json engagement\n" + JSON.stringify({ engagement_id: "c-2026", slug: "c", scope_paths: ["src/"], execute_project_tests: { argv: ["npm", "test"] } }) + "\n```\n"
  );
  r = sh(root, process.execPath, [cite, "init"]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /INIT ok/);
  const head = sh(root, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const dir = join(root, ".agents/security-testing/reviews/r1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "findings.json"),
    JSON.stringify({
      head,
      scope_paths: ["src/"],
      examined: [{ path: "src/app.js" }],
      findings: [
        {
          title: "SQL built by concatenation",
          class: "injection",
          priority: "p1",
          confidence: "high",
          citations: [{ path: "src/app.js", lines: [2, 2], snippet: "return db.query('SELECT * FROM t WHERE id = ' + id);" }],
          rationale: "id reaches the query string",
          fix: "parameterise",
        },
      ],
    })
  );
  r = sh(root, process.execPath, [cite, "check", ".agents/security-testing/reviews/r1/findings.json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /CHECK verified=1 failed=0/);
  assert.match(r.stdout, /COVERAGE examined=1 partial=0 unexamined=0/);
  const id = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings[0].id;
  // fix commit
  writeFileSync(join(root, "src/app.js"), "export function q(db, id) {\n  return db.query('SELECT * FROM t WHERE id = ?', [id]);\n}\n");
  writeFileSync(join(root, "src/app.test.mjs"), "import { test } from 'node:test'; test('ok', () => {});\n");
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-qm", "fix"]);
  const verify = join(root, ".claude/skills/secure-code-review/scripts/verify.mjs");
  const head2 = sh(root, "git", ["rev-parse", "HEAD"]).stdout.trim();
  r = sh(root, process.execPath, [verify, "--finding", id, "--review", ".agents/security-testing/reviews/r1", "--head", head2]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /NEXT: dispatch security-reviewer fix-review/);
  r = sh(root, process.execPath, [verify, "--finding", id, "--review", ".agents/security-testing/reviews/r1", "--head", head2, "--assertion", "not-refound", "--by", "e2e"]);
  assert.match(r.stdout, /VERDICT VERIFIED finding=/);
  assert.match(r.stdout, /REGISTER: skipped/);
});

test("README smoke block matches the commands this test runs", () => {
  const readme = readFileSync(join(REPO, "bundles/security-testing/README.md"), "utf8");
  const block = readme.split("```bash")[1].split("```")[0];
  for (const cmd of ["init --factory security-testing --target claude --yes", "cite.mjs init", "cite.mjs check", "register.mjs status"]) {
    assert.ok(block.includes(cmd), cmd);
  }
});
