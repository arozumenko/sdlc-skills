import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APP_LINES, buildRepo } from "./fixtures/cite/build-repo.mjs";
import { BLOCK_BEGIN, BLOCK_END } from "./lib/ignore-block.mjs";

const CITE = new URL("./cite.mjs", import.meta.url).pathname;
const TEMPLATE = new URL("../../../knowledge/engagement.md.template", import.meta.url).pathname;

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [CITE, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim().split("\n"), err: r.stderr };
};
const ENG = (root, extra = {}) => {
  mkdirSync(join(root, ".agents/security-testing"), { recursive: true });
  writeFileSync(join(root, ".agents/security-testing/engagement.md"), "```json engagement\n" + JSON.stringify({ engagement_id: "acme-2026-09", slug: "acme", scope_paths: ["src/"], ...extra }) + "\n```\n");
};

test("init without engagement.md seeds the template and asks for an edit", () => {
  const { root } = buildRepo();
  const r = run(root, "init");
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("WROTE .agents/security-testing/engagement.md"), r.out.join("\n"));
  assert.ok(r.out.includes("EDIT-ENGAGEMENT-AND-RERUN"));
  const seeded = join(root, ".agents/security-testing/engagement.md");
  assert.ok(existsSync(seeded));
  assert.equal(readFileSync(seeded, "utf8"), readFileSync(TEMPLATE, "utf8"), "the seeded file is the skill-relative template");
  assert.ok(!existsSync(join(root, ".gitignore")), "nothing else is written before the record is edited");
  assert.equal(run(root, "init").code, 2, "a second run on the unedited template still asks for the edit");
});

test("init with a valid engagement writes the ignore block once", () => {
  const { root } = buildRepo();
  ENG(root);
  let r = run(root, "init");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.ok(r.out.includes("IGNORE-BLOCK: written"));
  assert.ok(r.out.includes("INIT ok"));
  r = run(root, "init");
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("IGNORE-BLOCK: present"));
  assert.ok(r.out.includes("INIT ok"));
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /# security-testing:begin\n\.agents\/security-testing\/reviews\//);
  assert.equal(ignore, `${BLOCK_BEGIN}\n.agents/security-testing/reviews/\n.agents/security-testing/verify/\n.agents/security-testing/register/\n.agents/security-testing/proposals/\n${BLOCK_END}\n`);
});

test("init keeps the consumer's own .gitignore lines", () => {
  const { root } = buildRepo();
  ENG(root);
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  assert.equal(run(root, "init").code, 0);
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^node_modules\/\n# security-testing:begin\n/);
});

test("init fails closed when a private path is tracked", () => {
  const { root } = buildRepo();
  ENG(root);
  mkdirSync(join(root, ".agents/security-testing/register"), { recursive: true });
  writeFileSync(join(root, ".agents/security-testing/register/events.jsonl"), "");
  spawnSync("git", ["add", "-f", ".agents"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "oops"], { cwd: root });
  const r = run(root, "init");
  assert.equal(r.code, 4);
  assert.ok(r.out.some((l) => l.startsWith("TRACKED .agents/security-testing/register/events.jsonl")), r.out.join("\n"));
  assert.ok(!r.out.includes("INIT ok"));
  assert.ok(!existsSync(join(root, ".gitignore")), "no ignore block is written on a failed probe");
});

test("init reports an invalid engagement record through its token", () => {
  const { root } = buildRepo();
  ENG(root, { scope_paths: [] });
  const r = run(root, "init");
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("ENGAGEMENT-INVALID(scope_paths)"));
});

test("show prints numbered redacted lines at HEAD and at an older oid", () => {
  const { root, oid1, oid2 } = buildRepo();
  ENG(root);
  let r = run(root, "show", "src/app.js", "3", "5");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.match(r.out[0], /^SHOW src\/app\.js [0-9a-f]{7} 3-5$/);
  assert.equal(r.out[0], `SHOW src/app.js ${oid2.slice(0, 7)} 3-5`);
  assert.equal(r.out.length, 4);
  assert.match(r.out[1], /^3\t/);
  assert.equal(r.out[2], `4\t${APP_LINES[3]}`);
  assert.ok(r.out.some((l) => l.includes("<REDACTED:key-value>")), "the password line is redacted");
  assert.ok(!r.out.some((l) => l.includes("hunter22x")), "the secret never reaches stdout");
  r = run(root, "show", "src/app.js", "--at", oid1);
  assert.equal(r.code, 0);
  assert.match(r.out[0], new RegExp(`SHOW src/app.js ${oid1.slice(0, 7)} 1-`));
  assert.equal(r.out[0], `SHOW src/app.js ${oid1.slice(0, 7)} 1-12`);
  assert.equal(r.out.length, 13, "the whole file by default, raw line numbers");
  assert.equal(r.out[4], "4\tconst PORT = 8080;", "line 4 as it was at c1");
  assert.equal(r.out[12], `12\t${APP_LINES[11]}`);
});

test("show clamps an end past the last line and accepts a short oid", () => {
  const { root, oid2 } = buildRepo();
  ENG(root);
  const r = run(root, "show", "src/app.js", "11", "30", "--at", oid2.slice(0, 7));
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out[0], `SHOW src/app.js ${oid2.slice(0, 7)} 11-12`);
  assert.equal(r.out.length, 3);
});

test("show refuses a path outside scope and a range over 40 lines", () => {
  const { root } = buildRepo();
  ENG(root);
  assert.equal(run(root, "show", "README.md").code, 2);
  assert.ok(run(root, "show", "README.md").out[0].startsWith("USAGE(show: README.md is not under scope_paths"));
  assert.equal(run(root, "show", "src/app.js", "1", "60").code, 2);
  assert.ok(run(root, "show", "src/app.js", "1", "60").out[0].startsWith("USAGE(show: range over 40 lines"));
  assert.equal(run(root, "show", "src/app.js", "1", "40").code, 0, "exactly 40 lines is allowed");
});

test("show refuses bad ranges, a missing path and an unknown ref with a usage line", () => {
  const { root } = buildRepo();
  ENG(root);
  for (const args of [["show"], ["show", "src/app.js", "5", "3"], ["show", "src/app.js", "0", "3"], ["show", "src/app.js", "x", "3"], ["show", "src/app.js", "3"], ["show", "src/app.js", "20", "25"]]) {
    const r = run(root, ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.out[0], /^USAGE\(show: /, args.join(" "));
  }
  let r = run(root, "show", "src/nope.js");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(show: src\/nope\.js is not in the tree at [0-9a-f]{7}\)$/);
  r = run(root, "show", "src/app.js", "--at", "nope");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "USAGE(show: unknown ref nope)");
  r = run(root, "show", "../src/app.js");
  assert.equal(r.code, 2);
  assert.ok(r.out[0].startsWith("USAGE(show: ../src/app.js is not under scope_paths"));
});

test("show needs a readable engagement record", () => {
  const { root } = buildRepo();
  const r = run(root, "show", "src/app.js");
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("ENGAGEMENT-MISSING"));
});

test("the command table holds init and show; MAX_RANGE_LINES is exported; importing does not run main", async () => {
  // A `process.exit` inside the import would kill this runner; the export
  // check below makes the "import is inert" claim explicit.
  const mod = await import(CITE);
  assert.deepEqual(Object.keys(mod.COMMANDS).slice(0, 2), ["init", "show"]);
  assert.equal(mod.MAX_RANGE_LINES, 40);
  assert.equal(typeof mod.underScope, "function");
  const { root } = buildRepo();
  const r = run(root, "nope");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "USAGE(cite: unknown command nope)");
});

test("main runs when the script is reached through a symlink or an aliased directory", () => {
  // Review 1: `resolve(argv[1]) === fileURLToPath(import.meta.url)` compared a
  // non-canonical invoked path against Node's realpath'd module URL, so a
  // file symlink, a `--symlink` install, or a copy under macOS's aliased
  // tmpdir made main() silently never run (exit 0, no result line).
  const { root } = buildRepo();
  const link = join(root, "cite-link.mjs");
  symlinkSync(CITE, link);
  const r = spawnSync(process.execPath, [link, "nope"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 2, `stdout=${r.stdout} stderr=${r.stderr}`);
  assert.equal(r.stdout.trim(), "USAGE(cite: unknown command nope)");
});
