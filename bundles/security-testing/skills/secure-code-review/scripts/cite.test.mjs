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
    [JSON.stringify({ elements: [], threats: [] }), /^USAGE\(check: threat-model mode/],
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
  r = run(root, "check", rel.replace("findings.json", "findings.json"), "--md");
  assert.ok(r.code === 2 || r.code === 0, "--md belongs to the next task; it must not crash");
});

test("an empty findings list is a valid review; the command table now holds check", async () => {
  const { root, file, rel } = review(agentDoc(undefined, { findings: [], examined: [] }));
  const r = run(root, "check", rel);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.deepEqual(r.out, ["COVERAGE examined=0 partial=0 unexamined=2", "CHECK verified=0 failed=0"]);
  assert.deepEqual(readDoc(file).findings, []);
  const mod = await import(CITE);
  assert.deepEqual(Object.keys(mod.COMMANDS).slice(0, 3), ["init", "show", "check"]);
});
