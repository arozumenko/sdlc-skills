import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CASES = new URL("./cases.mjs", import.meta.url).pathname;
const FIX = (name) => new URL(`./fixtures/cases/${name}`, import.meta.url).pathname;
const ST = ".agents/security-testing";
const CANDIDATES = `${ST}/cases/acme`;
const SUITE = "tasks/security-acme-admitted";
const BROWSER = { targets: { browser: ["staging.example.com"] } };

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [CASES, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim().split("\n"), err: r.stderr };
};
const git = (root, argv) => execFileSync("git", argv, { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", windowsHide: true }).trim();
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** mkdtemp + git init + one empty commit + an engagement record (the register.test.mjs helper; the two skills share no test code). */
function tmpRepoWithEngagement(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "st-cases-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "c0"]);
  mkdirSync(join(root, ST), { recursive: true });
  writeFileSync(join(root, `${ST}/engagement.md`), "```json engagement\n" + JSON.stringify({ engagement_id: "acme-2026-09", slug: "acme", scope_paths: ["src/"], ...extra }) + "\n```\n");
  return root;
}
/** A repo with `fixture` staged as candidate `<CANDIDATES>/<name>`. */
function withCandidate(fixture, name, extra = BROWSER) {
  const root = tmpRepoWithEngagement(extra);
  mkdirSync(join(root, CANDIDATES), { recursive: true });
  copyFileSync(FIX(fixture), join(root, CANDIDATES, name));
  return root;
}
const readIndex = (root) => JSON.parse(readFileSync(join(root, SUITE, ".admitted.json"), "utf8"));

test("admit copies a passive case into the suite, redacted, and records its sha256", () => {
  const root = withCandidate("TC-001_login-headers.md", "TC-001_acme.md");
  const r = run(root, "admit", `${CANDIDATES}/TC-001_acme.md`);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "ADMITTED tasks/security-acme-admitted/TC-001_acme.md");
  assert.equal(r.out.length, 1);
  const idx = readIndex(root);
  assert.equal(idx.length, 1);
  assert.equal(idx[0].file, "TC-001_acme.md", "the index names the bare basename");
  assert.match(idx[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(idx[0].sha256, sha256(readFileSync(join(root, SUITE, "TC-001_acme.md"))), "sha256 of the written bytes");
  assert.deepEqual(readdirSync(join(root, SUITE)).sort(), [".admitted.json", "TC-001_acme.md"]);
  assert.ok(!existsSync(join(root, `${ST}/proposals`)), "nothing proposed");
});

test("admit redacts the copy and re-admitting replaces the index entry (no duplicate)", () => {
  const root = withCandidate("TC-001_login-headers.md", "TC-001_acme.md");
  const candidate = join(root, CANDIDATES, "TC-001_acme.md");
  writeFileSync(candidate, readFileSync(candidate, "utf8").replace("| Path  | /login |", "| Path  | /login |\n| Token | Bearer abcdefghijklmnopqrstuvwxyz0123456789 |"));
  let r = run(root, "admit", `${CANDIDATES}/TC-001_acme.md`);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  const written = readFileSync(join(root, SUITE, "TC-001_acme.md"), "utf8");
  assert.ok(!written.includes("abcdefghijklmnopqrstuvwxyz0123456789"), "the suite copy is redacted");
  assert.ok(written.includes("<REDACTED:bearer>"));
  const first = readIndex(root)[0].sha256;

  writeFileSync(candidate, readFileSync(candidate, "utf8").replace("Take a screenshot of the headers panel", "Capture the headers panel"));
  r = run(root, "admit", `${CANDIDATES}/TC-001_acme.md`);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  const idx = readIndex(root);
  assert.equal(idx.length, 1, "upsert by file, never a second entry");
  assert.notEqual(idx[0].sha256, first);
  assert.equal(idx[0].sha256, sha256(readFileSync(join(root, SUITE, "TC-001_acme.md"))));
});

test("a mutating step ⇒ proposal, nothing in the suite", () => {
  const root = withCandidate("TC-002_delete-account.md", "TC-002_acme.md");
  const r = run(root, "admit", `${CANDIDATES}/TC-002_acme.md`);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "PROPOSAL .agents/security-testing/proposals/TC-002_acme.md hits=1");
  assert.ok(r.out[1].startsWith("HIT mutating-verb step 2: "), r.out[1]);
  assert.equal(r.out.length, 2);
  assert.ok(existsSync(join(root, `${ST}/proposals/TC-002_acme.md`)));
  assert.ok(!existsSync(join(root, SUITE)) || readdirSync(join(root, SUITE)).length === 0, "suite dir absent or empty");
});

test("a foreign host ⇒ proposal with the host hit; a case with an id/name mismatch or no steps is refused", () => {
  const root = withCandidate("TC-003_other-host.md", "TC-003_acme.md");
  let r = run(root, "admit", `${CANDIDATES}/TC-003_acme.md`);
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "PROPOSAL .agents/security-testing/proposals/TC-003_acme.md hits=1");
  assert.ok(r.out[1].startsWith("HIT host-not-allowed step 1: Navigate to https://evil.example.net/"), r.out[1]);

  copyFileSync(FIX("TC-001_login-headers.md"), join(root, CANDIDATES, "TC-004_acme.md"));
  r = run(root, "admit", `${CANDIDATES}/TC-004_acme.md`);
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "USAGE(admit: frontmatter id must be TC-004 (the file name prefix))");

  writeFileSync(join(root, CANDIDATES, "TC-005_acme.md"), "---\nid: TC-005\n---\n\n# TC-005: empty\n\nno steps\n");
  r = run(root, "admit", `${CANDIDATES}/TC-005_acme.md`);
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "USAGE(admit: ## Steps table is missing or empty (nothing to admit))");
});

test("candidate outside <st>/cases/ or a bad id is refused", () => {
  const root = tmpRepoWithEngagement(BROWSER);
  mkdirSync(join(root, "tasks/x"), { recursive: true });
  copyFileSync(FIX("TC-001_login-headers.md"), join(root, "tasks/x/TC-001_acme.md"));
  let r = run(root, "admit", "tasks/x/TC-001_acme.md");
  assert.equal(r.code, 2);
  assert.ok(r.out[0].startsWith("USAGE(admit: candidates live under .agents/security-testing/cases/"), r.out[0]);

  mkdirSync(join(root, CANDIDATES), { recursive: true });
  copyFileSync(FIX("TC-001_login-headers.md"), join(root, CANDIDATES, "TC-1_acme.md"));
  r = run(root, "admit", `${CANDIDATES}/TC-1_acme.md`);
  assert.equal(r.code, 2);
  assert.ok(r.out[0].startsWith("USAGE(admit: file name must be TC-NNN_<slug>.md"), r.out[0]);

  r = run(root, "admit", `${CANDIDATES}/TC-009_missing.md`);
  assert.equal(r.code, 2);
  assert.ok(r.out[0].startsWith("USAGE(admit: no such file"), r.out[0]);

  r = run(root, "admit");
  assert.equal(r.code, 2);
  assert.ok(r.out[0].startsWith("USAGE(admit: "), r.out[0]);
  assert.ok(!existsSync(join(root, SUITE)) && !existsSync(join(root, `${ST}/proposals`)), "a refusal writes nothing");
});

test("verify-suite lists a hand-added file and prints both prompts when clean", () => {
  const root = withCandidate("TC-001_login-headers.md", "TC-001_acme.md", { ...BROWSER, base_url: "https://staging.example.com" });
  assert.equal(run(root, "admit", `${CANDIDATES}/TC-001_acme.md`).code, 0);

  writeFileSync(join(root, SUITE, "TC-009_x.md"), "---\nid: TC-009\n---\n# TC-009: x\n");
  let r = run(root, "verify-suite");
  assert.equal(r.code, 4, r.out.join("\n") + r.err);
  assert.ok(r.out.includes("UNADMITTED: tasks/security-acme-admitted/TC-009_x.md"), r.out.join("\n"));
  assert.ok(!r.out.some((l) => l.startsWith("SUITE ok=")), "no SUITE line while unadmitted files exist");
  assert.ok(!r.out.some((l) => l.startsWith("Run as the active agent")), "no prompts while unadmitted files exist");

  rmSync(join(root, SUITE, "TC-009_x.md"));
  r = run(root, "verify-suite");
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "SUITE ok=1");
  assert.equal(r.out[1], "Run as the active agent (claude --agent test-run-lead):");
  assert.equal(r.out[2], '"Run the suite at tasks/security-acme-admitted/ against base_url=https://staging.example.com."');
  const ta = r.out.find((l) => l.startsWith("TA-PROMPT "));
  assert.ok(ta, r.out.join("\n"));
  assert.match(ta, /^TA-PROMPT cases=\[\{"id":"TC-001","title":"Login page sends security headers","path":"tasks\/security-acme-admitted\/TC-001_acme\.md"\}\] slug=acme base=[0-9a-f]{7}$/);
  assert.ok(ta.includes('cases=[{"id":"TC-001",'));
  assert.ok(ta.includes(" slug=acme "));
  assert.equal(ta.split(" base=")[1], git(root, ["rev-parse", "HEAD"]).slice(0, 7));
});

test("verify-suite: a tampered admitted file is UNADMITTED; no index ⇒ SUITE ok=0 with the placeholder base_url", () => {
  const root = withCandidate("TC-001_login-headers.md", "TC-001_acme.md");
  assert.equal(run(root, "admit", `${CANDIDATES}/TC-001_acme.md`).code, 0);
  const admitted = join(root, SUITE, "TC-001_acme.md");
  writeFileSync(admitted, readFileSync(admitted, "utf8") + "| 6 | Delete the account | gone |\n");
  let r = run(root, "verify-suite");
  assert.equal(r.code, 4, r.out.join("\n"));
  assert.deepEqual(r.out, ["UNADMITTED: tasks/security-acme-admitted/TC-001_acme.md"]);

  const bare = tmpRepoWithEngagement(BROWSER);
  r = run(bare, "verify-suite");
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "SUITE ok=0");
  assert.equal(r.out[2], '"Run the suite at tasks/security-acme-admitted/ against base_url=<base_url>."');
  assert.ok(r.out.includes("TA-PROMPT cases=[] slug=acme base=" + git(bare, ["rev-parse", "HEAD"]).slice(0, 7)));

  writeFileSync(join(bare, `${ST}/engagement.md`), "no block\n");
  r = run(bare, "verify-suite");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "ENGAGEMENT-INVALID(block)");
});

test("verify-suite: a corrupt index is exit 5 and no bytes of it print", () => {
  const root = tmpRepoWithEngagement(BROWSER);
  mkdirSync(join(root, SUITE), { recursive: true });
  writeFileSync(join(root, SUITE, ".admitted.json"), "{\"password\": \"hunter22xyz\"}");
  const r = run(root, "verify-suite");
  assert.equal(r.code, 5, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "CORRUPT tasks/security-acme-admitted/.admitted.json");
  assert.ok(!(r.out.join("\n") + r.err).includes("hunter22xyz"));
  mkdirSync(join(root, CANDIDATES), { recursive: true });
  copyFileSync(FIX("TC-001_login-headers.md"), join(root, CANDIDATES, "TC-001_acme.md"));
  const r2 = run(root, "admit", `${CANDIDATES}/TC-001_acme.md`);
  assert.equal(r2.code, 5, r2.out.join("\n") + r2.err);
  assert.equal(r2.out[0], "CORRUPT tasks/security-acme-admitted/.admitted.json");
  assert.deepEqual(readdirSync(join(root, SUITE)), [".admitted.json"], "a corrupt index is never written past");
});

test("usage: unknown command, missing command", () => {
  const root = tmpRepoWithEngagement(BROWSER);
  assert.equal(run(root, "nope").code, 2);
  assert.equal(run(root).code, 2);
  assert.equal(run(root, "--help").code, 0);
});
