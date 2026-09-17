import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// ---------------------------------------------------------------- check (findings)

const FIX = new URL("./fixtures/cite/", import.meta.url).pathname;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const SNIPPET_3_5 = APP_LINES.slice(2, 5).join("\n");
const REVIEW = ".agents/security-testing/reviews/r1";
const HEX64 = /^[0-9a-f]{64}$/;
/** A fixture template with `$HEAD`/`$ID`/`$SHA` filled in, as a string. */
const fill = (name, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`$${k}`, v), readFileSync(join(FIX, name), "utf8"));
/** Build the repo + engagement + review dir; write `findings.json` from a template name or an object. */
const review = (doc, { head } = {}) => {
  const repo = buildRepo();
  ENG(repo.root);
  const dir = join(repo.root, REVIEW);
  mkdirSync(dir, { recursive: true });
  const text = typeof doc === "string" ? fill(doc, { HEAD: head ?? repo.oid2 }) : `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(join(dir, "findings.json"), text);
  return { ...repo, dir, file: join(dir, "findings.json"), rel: `${REVIEW}/findings.json` };
};
const readDoc = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeDoc = (file, doc) => writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
/** An agent-style findings document (no check-written keys). */
const agentDoc = (head, overrides = {}) => ({
  head,
  scope_paths: ["src/"],
  examined: [{ path: "src/app.js" }],
  findings: [{ title: "Hard-coded credential", class: "hardcoded-secret", priority: "p1", confidence: "high", citations: [{ path: "src/app.js", lines: [3, 5], snippet: SNIPPET_3_5 }], rationale: "…", fix: "…" }],
  ...overrides,
});

test("check verifies citations, stamps oid/state/id, tiles coverage, prints the summary", () => {
  const { root, oid2, file, rel } = review("findings-ok.json");
  const r = run(root, "check", rel);
  assert.equal(r.code, 0, `${r.out.join("\n")}\n${r.err}`);
  assert.ok(r.out.includes("CHECK verified=1 failed=0"), r.out.join("\n"));
  assert.ok(r.out.includes("COVERAGE examined=1 partial=0 unexamined=1"));
  assert.equal(r.out[r.out.length - 1], "CHECK verified=1 failed=0", "CHECK is the last line");
  assert.ok(!r.out.some((l) => l.startsWith("FAILED")));
  const f = readDoc(file);
  assert.match(f.findings[0].id, HEX64);
  assert.equal(f.findings[0].citations[0].state, "VERIFIED");
  assert.equal(f.findings[0].citations[0].oid, oid2, "the full 40-hex oid survives redaction");
  assert.match(f.findings[0].citations[0].snippet_redacted, /<REDACTED:key-value>/);
  assert.ok(!JSON.stringify(f).includes("hunter22x"), "snippet written back is redacted");
  assert.match(f.findings[0].citations[0].snippet, /<REDACTED:key-value>/, "the agent's snippet field is redacted in place");
  assert.deepEqual(f.coverage.rows.map((x) => x.status), ["examined", "unexamined"]);
  assert.deepEqual(f.coverage.rows.map((x) => x.path), ["src/app.js", "src/util.js"]);
  assert.match(f.check_stamp, HEX64);
  assert.equal(f.head, oid2);
});

test("check re-runs freely on its own output: same exit, same id, same bytes", () => {
  const { root, file, rel } = review("findings-ok.json");
  assert.equal(run(root, "check", rel).code, 0);
  const first = readFileSync(file, "utf8");
  const r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.ok(r.out.includes("CHECK verified=1 failed=0"));
  assert.equal(readFileSync(file, "utf8"), first, "a second run is byte-idempotent");
  assert.equal(readDoc(file).findings[0].id, JSON.parse(first).findings[0].id);
});

test("a wrong snippet ⇒ FAILED line and exit 4; re-running after a fix passes", () => {
  const { root, oid2, file, rel } = review("findings-bad-snippet.json");
  let r = run(root, "check", rel);
  assert.equal(r.code, 4, r.out.join("\n"));
  assert.ok(r.out.includes("FAILED 0.0 snippet-not-found"), r.out.join("\n"));
  assert.ok(r.out.includes("CHECK verified=0 failed=1"));
  assert.ok(r.out.includes("COVERAGE examined=1 partial=1 unexamined=0"));
  let f = readDoc(file);
  assert.equal(f.findings[0].citations[0].state, "FAILED(snippet-not-found)", "the FAILED state is written back in place");
  assert.equal(f.findings[0].citations[0].oid, oid2, "the oid is stamped even on a FAILED citation");
  assert.equal(f.findings[0].id, undefined, "no id until every citation verifies");
  assert.match(f.check_stamp, HEX64);
  // The reviewer rewrites its assertion file (agents never write id/state); check passes.
  writeDoc(file, agentDoc(oid2));
  r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.ok(r.out.includes("CHECK verified=1 failed=0"));
  f = readDoc(file);
  assert.equal(f.findings[0].citations[0].state, "VERIFIED");
  assert.match(f.findings[0].id, HEX64);
});

test("agent-written id/state/verdict ⇒ REFUSED, nothing written", () => {
  const { root, oid2, file, rel } = review("findings-agent-wrote-id.json");
  const before = readFileSync(file, "utf8");
  let r = run(root, "check", rel);
  assert.equal(r.code, 2, r.out.join("\n"));
  assert.equal(r.out[0], "REFUSED agent-written key id");
  assert.equal(r.out.length, 1);
  assert.equal(readFileSync(file, "utf8"), before, "file bytes unchanged");
  for (const [key, mutate] of [
    ["state", (d) => { d.findings[0].citations[0].state = "VERIFIED"; }],
    ["verdict", (d) => { d.findings[0].verdict = "VERIFIED"; }],
    ["verdict", (d) => { d.findings[0].citations[0].verdict = "VERIFIED"; }],
    ["snippet_redacted", (d) => { d.findings[0].citations[0].snippet_redacted = "x"; }],
    ["coverage", (d) => { d.coverage = { examined: 2, partial: 0, unexamined: 0, rows: [] }; }],
    ["check_stamp", (d) => { d.check_stamp = "0".repeat(64); }],
    // D10 keys at positions check never writes are refused outright, stamp or not.
    ["state", (d) => { d.findings[0].state = "VERIFIED"; }],
    ["id", (d) => { d.findings[0].citations[0].id = "x"; }],
    ["verdict", (d) => { d.verdict = "VERIFIED"; }],
    ["state", (d) => { d.state = "VERIFIED"; }],
    ["id", (d) => { d.id = "x"; }],
    ["state", (d) => { d.examined[0].state = "VERIFIED"; }],
    ["verdict", (d) => { d.findings[0].extra = { nested: { verdict: "VERIFIED" } }; }],
  ]) {
    const d = agentDoc(oid2);
    mutate(d);
    writeDoc(file, d);
    const bytes = readFileSync(file, "utf8");
    r = run(root, "check", rel);
    assert.equal(r.code, 2, key);
    assert.equal(r.out[0], `REFUSED agent-written key ${key}`);
    assert.equal(readFileSync(file, "utf8"), bytes, `${key}: nothing written`);
  }
  // A hand-edit of a stamped file (an assertion changed under check's keys) is refused too.
  writeDoc(file, agentDoc(oid2));
  assert.equal(run(root, "check", rel).code, 0);
  const stamped = readDoc(file);
  stamped.findings[0].rationale = "edited by hand";
  writeDoc(file, stamped);
  r = run(root, "check", rel);
  assert.equal(r.code, 2, r.out.join("\n"));
  assert.equal(r.out[0], "REFUSED agent-written key id");
  // A stray D10 key added to a correctly stamped file is refused by name, not as a stamp mismatch.
  writeDoc(file, agentDoc(oid2));
  assert.equal(run(root, "check", rel).code, 0);
  const stampedAgain = readDoc(file);
  stampedAgain.findings[0].state = "VERIFIED";
  writeDoc(file, stampedAgain);
  r = run(root, "check", rel);
  assert.equal(r.code, 2, r.out.join("\n"));
  assert.equal(r.out[0], "REFUSED agent-written key state");
});

test("dirty scope ⇒ DIRTY-SCOPE and exit 2; dirt outside scope does not block", () => {
  const { root, file, rel } = review("findings-ok.json");
  const before = readFileSync(file, "utf8");
  writeFileSync(join(root, "src", "util.js"), "export const clamp = () => 0;\n");
  let r = run(root, "check", rel);
  assert.equal(r.code, 2, r.out.join("\n"));
  assert.deepEqual(r.out, ["DIRTY-SCOPE src/util.js"]);
  assert.equal(readFileSync(file, "utf8"), before, "nothing written");
  writeFileSync(join(root, "src", "new.js"), "export {};\n");
  r = run(root, "check", rel);
  assert.deepEqual(r.out, ["DIRTY-SCOPE src/new.js", "DIRTY-SCOPE src/util.js"], "one line per dirty path, untracked included");
  spawnSync("git", ["checkout", "--", "src/util.js"], { cwd: root });
  rmSync(join(root, "src", "new.js"));
  spawnSync("git", ["mv", "src/util.js", "src/moved.js"], { cwd: root });
  r = run(root, "check", rel);
  assert.deepEqual(r.out, ["DIRTY-SCOPE src/moved.js"], "a staged rename prints the new path, never `old -> new`");
  spawnSync("git", ["mv", "src/moved.js", "src/util.js"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# edited outside scope\n");
  r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
});

test("second-<id>.json is validated; a stale one is STALE-REVIEW", () => {
  const { root, oid2, oid1, dir, file, rel } = review("findings-ok.json");
  assert.equal(run(root, "check", rel).code, 0);
  const id = readDoc(file).findings[0].id;
  const second = join(dir, `second-${id}.json`);
  writeFileSync(second, fill("second-ok.json", { ID: id, HEAD: oid2, SHA: sha256(readFileSync(file)) }));
  let r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.ok(r.out.includes(`SECOND ${id} confirmed`), r.out.join("\n"));
  assert.ok(!r.out.some((l) => l.startsWith("STALE-REVIEW")));
  // The reviewer's file is left alone: check never rewrites a second opinion.
  const secondBytes = readFileSync(second, "utf8");
  assert.equal(run(root, "check", rel).code, 0);
  assert.equal(readFileSync(second, "utf8"), secondBytes);
  // The findings file changes under the second opinion ⇒ stale.
  writeDoc(file, agentDoc(oid2, { findings: [{ ...agentDoc(oid2).findings[0], rationale: "rewritten" }] }));
  r = run(root, "check", rel);
  assert.equal(r.code, 4, r.out.join("\n"));
  assert.ok(r.out.includes(`STALE-REVIEW ${id}`), r.out.join("\n"));
  assert.ok(r.out.includes("CHECK verified=1 failed=0"), "the citations still verify; the second opinion is what is stale");
  assert.equal(readDoc(file).findings[0].id, id, "the id does not depend on the rationale");
  // Re-hash ⇒ current again; then a wrong oid, a bad assertion, an unknown finding and a broken file are each stale.
  writeFileSync(second, fill("second-ok.json", { ID: id, HEAD: oid2, SHA: sha256(readFileSync(file)) }));
  assert.equal(run(root, "check", rel).code, 0);
  const current = () => sha256(readFileSync(file));
  for (const [what, text] of [
    ["wrong oid", fill("second-ok.json", { ID: id, HEAD: oid1, SHA: current() })],
    ["bad assertion", fill("second-ok.json", { ID: id, HEAD: oid2, SHA: current() }).replace("confirmed", "maybe")],
    ["missing by", fill("second-ok.json", { ID: id, HEAD: oid2, SHA: current() }).replace("\"by\": \"s1\"", "\"by\": 1")],
    ["not json", "{ nope"],
  ]) {
    writeFileSync(second, text);
    r = run(root, "check", rel);
    assert.equal(r.code, 4, what);
    assert.ok(r.out.includes(`STALE-REVIEW ${id}`), `${what}: ${r.out.join("\n")}`);
  }
  writeFileSync(second, fill("second-ok.json", { ID: "f".repeat(64), HEAD: oid2, SHA: current() }));
  r = run(root, "check", rel);
  assert.equal(r.code, 4);
  assert.ok(r.out.includes(`STALE-REVIEW ${"f".repeat(64)}`), "an unknown finding_id is reported by that id");
});

test("citation paths are canonicalised; examined paths must already be canonical", () => {
  const { root, oid2, file, rel } = review(agentDoc(undefined, { findings: [{ ...agentDoc().findings[0], citations: [{ path: "./src/app.js", lines: [3, 5], snippet: SNIPPET_3_5 }] }] }));
  let r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  let f = readDoc(file);
  assert.equal(f.findings[0].citations[0].path, "src/app.js", "written back canonical");
  assert.equal(f.findings[0].citations[0].oid, oid2, "no head in the file ⇒ HEAD is stamped");
  const canonicalId = f.findings[0].id;
  writeDoc(file, agentDoc(oid2));
  assert.equal(run(root, "check", rel).code, 0);
  assert.equal(readDoc(file).findings[0].id, canonicalId, "the same file yields one id however the path is spelled");
  writeDoc(file, agentDoc(oid2, { examined: [{ path: "./src/app.js" }] }));
  r = run(root, "check", rel);
  assert.equal(r.code, 2, r.out.join("\n"));
  assert.equal(r.out[0], "USAGE(check: examined: not in scope: ./src/app.js)");
});

test("head names the review commit: citations default to it and coverage counts lines there", () => {
  const { root, oid1, file, rel } = review(agentDoc(undefined), { head: undefined });
  const doc = readDoc(file);
  doc.head = oid1;
  doc.findings[0].citations[0] = { path: "src/app.js", lines: [4, 4], snippet: "const PORT = 8080;" };
  writeDoc(file, doc);
  const r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  const f = readDoc(file);
  assert.equal(f.findings[0].citations[0].oid, oid1);
  assert.deepEqual(f.coverage.rows[0].ranges, [[1, 12]]);
});

test("a malformed document is a usage error that never echoes the file's bytes", () => {
  const { root, file, rel } = review("findings-ok.json");
  const cases = [
    ["not json at all hunter22x", /^USAGE\(check: .*not valid JSON/],
    ["[1, 2]", /^USAGE\(check: .*JSON object/],
    [JSON.stringify({ findings: "x" }), /^USAGE\(check: findings must be an array/],
    [JSON.stringify({ examined: "x", findings: [] }), /^USAGE\(check: examined must be an array/],
    [JSON.stringify({ head: 7, examined: [], findings: [] }), /^USAGE\(check: head must be a 40-hex oid/],
    [JSON.stringify({ head: "0".repeat(40), examined: [], findings: [] }), /^USAGE\(check: head [0-9a-f]{7} is not a commit/],
    [JSON.stringify({ examined: [], findings: [{ class: "x" }] }), /^USAGE\(check: findings\[0\] must carry a class and a non-empty citations array/],
    [JSON.stringify({ examined: [], findings: [{ citations: [{}] }] }), /^USAGE\(check: findings\[0\] must carry a class/],
    [JSON.stringify({ nope: 1 }), /^USAGE\(check: neither a findings nor a threat-model document/],
    [JSON.stringify({ elements: "x", threats: [] }), /^USAGE\(check: elements must be an array/],
    [JSON.stringify({ elements: [], threats: "x" }), /^USAGE\(check: threats must be an array/],
    [JSON.stringify({ head: 7, elements: [], threats: [] }), /^USAGE\(check: head must be a 40-hex oid/],
  ];
  for (const [text, re] of cases) {
    writeFileSync(file, text);
    const r = run(root, "check", rel);
    assert.equal(r.code, 2, text);
    assert.match(r.out[0], re, text);
    assert.ok(!`${r.out.join("\n")}${r.err}`.includes("hunter22x"), "file bytes never reach a printed message");
    assert.equal(readFileSync(file, "utf8"), text, "nothing written");
  }
  let r = run(root, "check");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(check: usage: check </);
  r = run(root, "check", ".agents/security-testing/reviews/r1/nope.json");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "USAGE(check: .agents/security-testing/reviews/r1/nope.json not found)");
});

test("an empty findings list is a valid review; the command table now holds check", async () => {
  const { root, file, rel } = review(agentDoc(undefined, { findings: [], examined: [] }));
  const r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.deepEqual(r.out, ["COVERAGE examined=0 partial=0 unexamined=2", "CHECK verified=0 failed=0"]);
  assert.deepEqual(readDoc(file).findings, []);
  const mod = await import(CITE);
  assert.deepEqual(Object.keys(mod.COMMANDS), ["init", "show", "check", "redact"]);
});

test("show prints the canonical path in its header", () => {
  const { root, oid2 } = buildRepo();
  ENG(root);
  const r = run(root, "show", "./src/./app.js", "1", "2");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out[0], `SHOW src/app.js ${oid2.slice(0, 7)} 1-2`);
});

// ---------------------------------------------------------------- check (threat model)

const REGISTER = ".agents/security-testing/register/events.jsonl";
const SUITE = "tasks/security-acme-admitted";
/** Append register events as Task 6 writes them: one JSON object per line. */
const writeRegister = (root, events) => {
  mkdirSync(join(root, ".agents/security-testing/register"), { recursive: true });
  writeFileSync(join(root, REGISTER), events.map((e, i) => JSON.stringify({ seq: i + 1, ts: "2026-09-17T00:00:00Z", actor: "lead", payload: {}, ...e })).join("\n") + "\n");
};
/** The admitted suite index as Task 7 writes it. */
const writeAdmitted = (root, files) => {
  mkdirSync(join(root, SUITE), { recursive: true });
  writeFileSync(join(root, SUITE, ".admitted.json"), `${JSON.stringify(files.map((file) => ({ file, sha256: "0".repeat(64) })))}\n`);
};
/** Build the repo + engagement + one live register row + one admitted case; write `threat-model.json` from a fixture or an object. */
const model = (doc, { register = [{ row_id: "R-0001", event: "add" }], admitted = ["TC-001_login.md"] } = {}) => {
  const repo = buildRepo();
  ENG(repo.root);
  if (register !== null) writeRegister(repo.root, register);
  if (admitted !== null) writeAdmitted(repo.root, admitted);
  const dir = join(repo.root, ".agents/security-testing");
  const text = typeof doc === "string" ? fill(doc, { HEAD: repo.oid2 }) : `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(join(dir, "threat-model.json"), text);
  return { ...repo, dir, file: join(dir, "threat-model.json"), rel: ".agents/security-testing/threat-model.json" };
};

test("check on a threat model verifies element and mitigation citations, lints, stamps and re-runs", () => {
  const { root, oid2, file, rel } = model("threat-model-ok.json");
  let r = run(root, "check", rel);
  assert.equal(r.code, 0, `${r.out.join("\n")}\n${r.err}`);
  assert.deepEqual(r.out, ["MODEL elements=1 threats=4 open=1", "CHECK verified=2 failed=0"]);
  const m = readDoc(file);
  assert.equal(m.elements[0].id, "E-001", "the agent's ids stay");
  assert.equal(m.elements[0].citations[0].state, "VERIFIED");
  assert.equal(m.elements[0].citations[0].oid, oid2);
  assert.equal(m.elements[0].citations[0].snippet_redacted, "import { readFileSync } from \"node:fs\";\nimport { createServer } from \"node:http\";");
  assert.equal(m.threats[2].mitigations[0].citations[0].state, "VERIFIED");
  assert.equal(m.threats[2].mitigations[0].citations[0].oid, oid2);
  assert.match(m.check_stamp, HEX64);
  assert.equal(m.coverage, undefined, "no coverage on a threat model");
  const first = readFileSync(file, "utf8");
  r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(readFileSync(file, "utf8"), first, "a second run is byte-idempotent");
});

test("a dangling planned(TC-nnn) ⇒ TM-INVALID and exit 4; the file is still written back", () => {
  const { root, oid2, file, rel } = model("threat-model-dangling.json");
  const r = run(root, "check", rel);
  assert.equal(r.code, 4, r.out.join("\n"));
  assert.ok(r.out.includes("TM-INVALID T-003: planned(TC-009): not in the admitted suite"), r.out.join("\n"));
  assert.ok(r.out.includes("MODEL elements=1 threats=3 open=0"));
  assert.equal(r.out.at(-1), "CHECK verified=1 failed=0", "CHECK is last; TM-INVALID does not count as a failed citation");
  const m = readDoc(file);
  assert.equal(m.elements[0].citations[0].state, "VERIFIED");
  assert.equal(m.elements[0].citations[0].oid, oid2);
  assert.match(m.check_stamp, HEX64);
});

test("accepted(R-nnnn) is read from the register fold: add is live; supersede and close-false-positive are not", () => {
  const cases = [
    [[{ row_id: "R-0001", event: "add" }], 0],
    [[{ row_id: "R-0001", event: "add" }, { row_id: "R-0001", event: "accept" }], 0],
    [[{ row_id: "R-0001", event: "add" }, { row_id: "R-0001", event: "fixed" }], 0],
    [[{ row_id: "R-0001", event: "add" }, { row_id: "R-0001", event: "supersede" }], 4],
    [[{ row_id: "R-0001", event: "add" }, { row_id: "R-0001", event: "close-false-positive" }], 4],
    [[{ row_id: "R-0001", event: "add" }, { row_id: "R-0001", event: "close-false-positive" }, { row_id: "R-0001", event: "reopen" }], 0],
    [[{ row_id: "R-0002", event: "add" }], 4],
    [[{ row_id: "R-0001", event: "ticket" }], 4, "a row with no add event does not exist"],
    [null, 4, "no register file ⇒ no rows"],
    [[], 4],
  ];
  for (const [register, code, why] of cases) {
    const { root, rel } = model("threat-model-ok.json", { register });
    const r = run(root, "check", rel);
    assert.equal(r.code, code, `${why ?? JSON.stringify(register)}: ${r.out.join("\n")}`);
    assert.equal(r.out.includes("TM-INVALID T-001: accepted(R-0001): no such register row"), code === 4, JSON.stringify(register));
  }
});

test("a corrupt register line ⇒ CORRUPT and exit 5, nothing written; a corrupt .admitted.json likewise", () => {
  const { root, file, rel } = model("threat-model-ok.json");
  const before = readFileSync(file, "utf8");
  writeFileSync(join(root, REGISTER), `${JSON.stringify({ seq: 1, row_id: "R-0001", event: "add" })}\nnot json hunter22x\n`);
  let r = run(root, "check", rel);
  assert.equal(r.code, 5, r.out.join("\n"));
  assert.deepEqual(r.out, ["CORRUPT events.jsonl:2"]);
  assert.ok(!`${r.out.join("\n")}${r.err}`.includes("hunter22x"));
  assert.equal(readFileSync(file, "utf8"), before);
  writeFileSync(join(root, REGISTER), `${JSON.stringify({ seq: 1, event: "add" })}\n`);
  r = run(root, "check", rel);
  assert.deepEqual([r.code, r.out], [5, ["CORRUPT events.jsonl:1"]], "a line without row_id/event");
  writeRegister(root, [{ row_id: "R-0001", event: "add" }]);
  writeFileSync(join(root, SUITE, ".admitted.json"), "{ nope");
  r = run(root, "check", rel);
  assert.deepEqual([r.code, r.out], [5, [`CORRUPT ${SUITE}/.admitted.json`]]);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("planned(TC-nnn) needs the case in .admitted.json by its TC prefix; no suite ⇒ none admitted", () => {
  let { root, rel } = model("threat-model-ok.json", { admitted: ["TC-001_other-slug.md", "TC-002_x.md"] });
  assert.equal(run(root, "check", rel).code, 0);
  ({ root, rel } = model("threat-model-ok.json", { admitted: ["TC-002_x.md"] }));
  let r = run(root, "check", rel);
  assert.equal(r.code, 4);
  assert.ok(r.out.includes("TM-INVALID T-002: planned(TC-001): not in the admitted suite"), r.out.join("\n"));
  ({ root, rel } = model("threat-model-ok.json", { admitted: null }));
  r = run(root, "check", rel);
  assert.equal(r.code, 4);
  assert.ok(r.out.includes("TM-INVALID T-002: planned(TC-001): not in the admitted suite"), r.out.join("\n"));
});

test("threat-model mode: a FAILED citation, a structural defect and a dirty scope", () => {
  const { root, file, rel } = model("threat-model-ok.json");
  const doc = readDoc(file);
  doc.elements[0].citations[0].snippet = "nope";
  doc.threats[0].element_id = "E-009";
  writeDoc(file, doc);
  let r = run(root, "check", rel);
  assert.equal(r.code, 4, r.out.join("\n"));
  assert.deepEqual(r.out, ["FAILED E-001.0 snippet-not-found", "TM-INVALID T-001: element E-009 is not in the model", "MODEL elements=1 threats=4 open=1", "CHECK verified=1 failed=1"]);
  assert.equal(readDoc(file).elements[0].citations[0].state, "FAILED(snippet-not-found)");
  // A mitigation citation fails under its own locus.
  const fixed = readDoc(file);
  delete fixed.check_stamp;
  fixed.elements[0].citations[0] = { path: "src/app.js", lines: [1, 3], snippet: "import { readFileSync } from \"node:fs\";" };
  delete fixed.elements[0].citations[0].state;
  fixed.threats[0].element_id = "E-001";
  fixed.threats[2].mitigations[0].citations[0] = { path: "README.md", lines: [1, 1], snippet: "# fixture" };
  for (const t of fixed.threats) for (const m of t.mitigations) for (const c of m.citations) delete c.state;
  writeDoc(file, fixed);
  r = run(root, "check", rel);
  assert.equal(r.code, 4, r.out.join("\n"));
  assert.ok(r.out.includes("FAILED M-001.0 path-not-in-scope"), r.out.join("\n"));
  // Dirt under scope blocks before anything is checked or written.
  const before = readFileSync(file, "utf8");
  writeFileSync(join(root, "src", "util.js"), "export const clamp = () => 0;\n");
  r = run(root, "check", rel);
  assert.deepEqual([r.code, r.out], [2, ["DIRTY-SCOPE src/util.js"]]);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("threat-model mode: D10 — state/verdict anywhere and id outside E/T/M positions are refused; stamped output re-runs", () => {
  const { root, file, rel } = model("threat-model-ok.json");
  const clean = readDoc(file);
  for (const [key, mutate] of [
    ["state", (d) => { d.elements[0].citations[0].state = "VERIFIED"; }],
    ["state", (d) => { d.threats[0].state = "open"; }],
    ["verdict", (d) => { d.verdict = "VERIFIED"; }],
    ["verdict", (d) => { d.threats[2].mitigations[0].verdict = "confirmed"; }],
    ["id", (d) => { d.elements[0].citations[0].id = "x"; }],
    ["id", (d) => { d.id = "x"; }],
    ["snippet_redacted", (d) => { d.elements[0].citations[0].snippet_redacted = "x"; }],
    ["check_stamp", (d) => { d.check_stamp = "0".repeat(64); }],
  ]) {
    const d = structuredClone(clean);
    mutate(d);
    writeDoc(file, d);
    const bytes = readFileSync(file, "utf8");
    const r = run(root, "check", rel);
    assert.equal(r.code, 2, key);
    assert.equal(r.out[0], `REFUSED agent-written key ${key}`);
    assert.equal(readFileSync(file, "utf8"), bytes, `${key}: nothing written`);
  }
  writeDoc(file, clean);
  assert.equal(run(root, "check", rel).code, 0);
  const stamped = readDoc(file);
  stamped.threats[0].title = "edited under the stamp";
  writeDoc(file, stamped);
  const r = run(root, "check", rel);
  assert.equal(r.code, 2, r.out.join("\n"));
  assert.equal(r.out[0], "REFUSED agent-written key state");
});

test("an empty model is valid", () => {
  const { root, rel } = model({ elements: [], threats: [] });
  const r = run(root, "check", rel);
  assert.deepEqual([r.code, r.out], [0, ["MODEL elements=0 threats=0 open=0", "CHECK verified=0 failed=0"]]);
});

// ---------------------------------------------------------------- --md and redact

/** The tables block `--md` printed: every line after CHECK up to TABLES, as the text the sha256 covers. */
const tablesOf = (out) => {
  const start = out.findIndex((l) => l.startsWith("CHECK ")) + 1;
  return { text: `${out.slice(start, -1).join("\n")}\n`, last: out.at(-1) };
};

test("check --md prints the findings and coverage tables and a TABLES sha256 line; --no-snippets drops snippets", () => {
  const { root, oid2, dir, file, rel } = review("findings-ok.json");
  let r = run(root, "check", rel, "--md");
  assert.equal(r.code, 0, `${r.out.join("\n")}\n${r.err}`);
  assert.ok(r.out.includes("CHECK verified=1 failed=0"));
  assert.ok(r.out.some((l) => l.startsWith("| id | priority |")), r.out.join("\n"));
  assert.ok(r.out.some((l) => l.startsWith("| path | status |")));
  assert.ok(r.out.some((l) => l.includes("<REDACTED:key-value>")), "the snippet column carries the redacted snippet");
  assert.ok(!r.out.some((l) => l.includes("hunter22x")));
  assert.ok(r.out.some((l) => l.includes("not independently reviewed")));
  let { text, last } = tablesOf(r.out);
  assert.match(last, /^TABLES sha256=[0-9a-f]{64}$/);
  assert.equal(last, `TABLES sha256=${sha256(text)}`, "the hash covers exactly the printed tables");
  const id = readDoc(file).findings[0].id;
  assert.ok(text.includes(`| ${id.slice(0, 7)} | p1 | hardcoded-secret | Hard-coded credential | src/app.js:3-5 @${oid2.slice(0, 7)} VERIFIED |`), text);
  assert.ok(text.includes("| src/app.js | examined | 1-12 |  |"), text);
  assert.ok(text.includes("| src/util.js | unexamined |  | 1-2 |"), text);
  const again = run(root, "check", rel, "--md");
  assert.equal(again.out.at(-1), last, "the same doc renders to the same hash");
  r = run(root, "check", rel, "--md", "--no-snippets");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.ok(!r.out.some((l) => l.includes("hunter") || l.includes("<REDACTED")), r.out.join("\n"));
  assert.match(r.out.at(-1), /^TABLES sha256=[0-9a-f]{64}$/);
  assert.notEqual(r.out.at(-1), last);
  // A valid second opinion shows up in the table.
  writeFileSync(join(dir, `second-${id}.json`), fill("second-ok.json", { ID: id, HEAD: oid2, SHA: sha256(readFileSync(file)) }));
  r = run(root, "check", rel, "--md", "--no-snippets");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.ok(r.out.some((l) => l.endsWith("| confirmed by s1 |")), r.out.join("\n"));
  // --md without check's flags order: flags may come first.
  r = run(root, "check", "--md", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
});

test("check --md on a threat model prints elements, threats and mitigations; a failing check still prints tables", () => {
  const { root, oid2, rel } = model("threat-model-ok.json");
  let r = run(root, "check", rel, "--md");
  assert.equal(r.code, 0, `${r.out.join("\n")}\n${r.err}`);
  const { text, last } = tablesOf(r.out);
  assert.equal(last, `TABLES sha256=${sha256(text)}`);
  assert.ok(text.includes(`| E-001 | process | HTTP handler | src/app.js:1-3 @${oid2.slice(0, 7)} VERIFIED |`), text);
  assert.ok(text.includes("| T-001 | E-001 | I | Secret in source | accepted(R-0001) |"), text);
  assert.ok(text.includes(`| T-003 | M-001 | The handler reads the path straight from req.url \\| no normalisation yet | src/app.js:7-10 @${oid2.slice(0, 7)} VERIFIED |`), text);
  assert.ok(!text.includes("| id | priority |"), "no findings table on a model");
  const dangling = model("threat-model-dangling.json");
  r = run(dangling.root, "check", dangling.rel, "--md");
  assert.equal(r.code, 4, r.out.join("\n"));
  assert.ok(r.out.includes("TM-INVALID T-003: planned(TC-009): not in the admitted suite"));
  assert.ok(r.out.some((l) => l.startsWith("| T-003 | E-001 | T |")));
  assert.match(r.out.at(-1), /^TABLES sha256=[0-9a-f]{64}$/);
  assert.equal(run(dangling.root, "check", dangling.rel, "--no-snippets").code, 2, "--no-snippets needs --md");
});

test("redact rewrites a Markdown file in place and reports hits", () => {
  const { root } = buildRepo();
  ENG(root);
  mkdirSync(join(root, "reports"), { recursive: true });
  const report = join(root, "reports", "x.md");
  writeFileSync(report, "# Report\n\ntoken = abcdefghijkl1234\n\nSee Bearer aaaaaaaaaaaaaaaaaaaaaaaa in the log.\n");
  let r = run(root, "redact", "reports/x.md");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.deepEqual(r.out, ["REDACTED reports/x.md hits=2"]);
  const after = readFileSync(report, "utf8");
  assert.ok(!after.includes("abcdefghijkl1234"));
  assert.ok(!after.includes("aaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.equal(after, "# Report\n\ntoken = <REDACTED:key-value>\n\nSee Bearer <REDACTED:bearer> in the log.\n");
  r = run(root, "redact", "reports/x.md");
  assert.deepEqual([r.code, r.out], [0, ["REDACTED reports/x.md hits=0"]], "a clean file is reported with zero hits and left alone");
  assert.equal(readFileSync(report, "utf8"), after);
  // The path itself is a user string: printed redacted.
  r = run(root, "redact", "reports/nope.md");
  assert.deepEqual([r.code, r.out], [2, ["USAGE(redact: reports/nope.md not found)"]]);
  writeFileSync(join(root, "reports", "x.txt"), "token = abcdefghijkl1234\n");
  r = run(root, "redact", "reports/x.txt");
  assert.deepEqual([r.code, r.out], [2, ["USAGE(redact: reports/x.txt is not a .md file)"]]);
  assert.ok(readFileSync(join(root, "reports", "x.txt"), "utf8").includes("abcdefghijkl1234"), "a refused file is untouched");
  r = run(root, "redact");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(redact: usage: redact <file\.md>\)$/);
});
