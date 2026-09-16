// TASK-014 — lib/cite.mjs: side-aware citation resolution (spec §6.2 "Every
// citation carries side: base | head | snapshot"; US-009 AC-5; US-002 AC-6).
// The pure rules live in cite-core.mjs and are re-exported here; this file
// covers the I/O half against repos built by the CLI harness, with every run
// allocated by the real `run init` and every scope written by the real `scope`
// (so the private snapshot layout is TASK-013's, not this test's guess).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readArtifact, sha256Hex } from "../canon.mjs";
import { cleanupAll, git, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { TEMPLATE_PATHS } from "./engagement.mjs";
import { ensureKey } from "./keys.mjs";
import { ObjectMissing, SnapshotMismatch, SnapshotMissing, checkRange, occurrenceOf, rangeBytes, resolveSide, resolveWorking } from "./cite.mjs";
import * as core from "./cite-core.mjs";
import { RANGE_NOT_ADMITTED, RANGE_TOO_LONG } from "./tokens.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const ST = join(".agents", "security-testing");
const SECRET = "password=1234";

const IGNORE_BLOCK = [
  "# security-testing:begin",
  ".agents/security-testing/private/",
  ".agents/security-testing/ledger/",
  ".agents/security-testing/runs/",
  ".agents/security-testing/receipts/",
  ".agents/security-testing/proposals/",
  ".agents/security-testing/handoffs/",
  ".agents/security-testing/imports/",
  ".agents/security-testing/register/",
  "reports/security/",
  "tasks/security-*/",
  "# security-testing:end",
  "",
].join("\n");

/** A committed fixture repo with the ignore block, the template engagement.md (scope_paths: src/) and its key. */
function readyRepo() {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), IGNORE_BLOCK);
  git(repo, ["add", ".gitignore"]);
  git(repo, ["commit", "-q", "-m", "ignore block"]);
  const st = join(repo, ST);
  mkdirSync(st, { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  const ctx = createContext({ root: repo }, { env: { ...process.env, ...ENV } });
  ensureKey(ctx, { engagement_id: ctx.engagement().engagement_id });
  return repo;
}

const ctxOf = (repo) => createContext({ root: repo }, { env: { ...process.env, ...ENV }, stdout: { write() {} }, stderr: { write() {} } });
const runDir = (repo, run_id) => join(repo, ST, "runs", run_id);
const snapshotPath = (repo, run_id, path) => join(repo, ST, "private", "snapshots", run_id, path);

async function initRun(repo, kind, extra = []) {
  const args = ["run", "init", "--kind", kind, ...(kind === "review" && !extra.includes("--base") ? ["--base", "HEAD"] : []), ...extra];
  const r = await runScript("evidence", args, { cwd: repo, env: ENV });
  assert.equal(r.code, 0, `run init ${kind}: ${r.stdout}${r.stderr}`);
  return /^RUN (\S+)/.exec(r.stdout)[1];
}

async function scoped(repo, run_id) {
  const r = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, `scope: ${r.stdout}${r.stderr}`);
  return {
    run: readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" }),
    scope: readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" }),
  };
}

// --- module shape ---------------------------------------------------------------

test("cite.mjs re-exports the pure core unchanged, so `lib/cite.mjs` is the one import every consumer needs (plan §3.3)", () => {
  assert.equal(checkRange, core.checkRange);
  assert.equal(occurrenceOf, core.occurrenceOf);
  assert.equal(rangeBytes, core.rangeBytes);
  const src = readFileSync(join(HERE, "cite.mjs"), "utf8");
  assert.ok(!src.includes("child_process"), "the I/O layer runs git only through git.mjs (G-6)");
  assert.ok(!src.includes("fetch(") && !src.includes("node:http"), "no network (G-14)");
});

// --- resolveSide -------------------------------------------------------------------

test("side head resolves via git show <head_oid>:<path>; the bytes are the committed ones even when the working file has changed since", async () => {
  const repo = readyRepo();
  const committed = "export const a = 1;\n";
  const run_id = await initRun(repo, "assessment");
  const { run, scope } = await scoped(repo, run_id);
  writeFileSync(join(repo, "src", "app.js"), "export const a = 2; // edited after scope\n");
  const bytes = resolveSide(ctxOf(repo), run, scope, { path: "src/app.js", side: "head" });
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(bytes.toString("utf8"), committed);
  assert.equal(git(repo, ["rev-parse", `${run.payload.head_oid}:src/app.js`]), scope.payload.files.find((f) => f.path === "src/app.js").oid);
});

test("side base resolves via git show <base_oid>:<path> after the file was deleted at head (US-009 AC-5); head for the same path is ObjectMissing", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "old.js"), "const token = 'legacy';\nmodule.exports = token;\n");
  git(repo, ["add", "src/old.js"]);
  git(repo, ["commit", "-q", "-m", "add old.js"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["rm", "-q", "src/old.js"]);
  git(repo, ["commit", "-q", "-m", "delete old.js"]);
  const run_id = await initRun(repo, "review", ["--base", base]);
  const { run, scope } = await scoped(repo, run_id);
  assert.equal(run.payload.base_oid, base);
  assert.notEqual(run.payload.head_oid, base);
  assert.ok(!scope.payload.files.some((f) => f.path === "src/old.js"), "deleted at head ⇒ not a scope file");

  const ctx = ctxOf(repo);
  const bytes = resolveSide(ctx, run, scope, { path: "src/old.js", side: "base" });
  assert.equal(bytes.toString("utf8"), "const token = 'legacy';\nmodule.exports = token;\n");
  assert.equal(rangeBytes(bytes, 1, 1).toString("utf8"), "const token = 'legacy';\n");

  assert.throws(() => resolveSide(ctx, run, scope, { path: "src/old.js", side: "head" }), (err) => {
    assert.ok(err instanceof ObjectMissing, `expected ObjectMissing, got ${err.name}: ${err.message}`);
    assert.equal(err.side, "head");
    assert.equal(err.oid, run.payload.head_oid);
    assert.equal(err.path, "src/old.js");
    return true;
  });
});

test("side base|head refuse a tree: a directory path is ObjectMissing, never tree bytes (Rio's TASK-006 note: blobOid verifies cat-file -t blob)", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const { run, scope } = await scoped(repo, run_id);
  const ctx = ctxOf(repo);
  assert.throws(() => resolveSide(ctx, run, scope, { path: "src", side: "head" }), ObjectMissing);
  assert.throws(() => resolveSide(ctx, run, scope, { path: "src", side: "base" }), ObjectMissing);
  assert.throws(() => resolveSide(ctx, run, scope, { path: "src/missing.js", side: "head" }), ObjectMissing);
});

test("side snapshot resolves the private snapshot (US-009 AC-5): redacted bytes, never the original; sha256 checked against scope.snapshot", async () => {
  const repo = readyRepo();
  const original = `const a = 1;\n// ${SECRET}\nconst b = 2;\n`;
  writeFileSync(join(repo, "src", "app.js"), original);
  const run_id = await initRun(repo, "review");
  const { run, scope } = await scoped(repo, run_id);
  const entry = scope.payload.snapshot["src/app.js"];
  assert.ok(entry, "scope recorded the snapshot");

  const ctx = ctxOf(repo);
  const bytes = resolveSide(ctx, run, scope, { path: "src/app.js", side: "snapshot" });
  assert.ok(!bytes.toString("utf8").includes(SECRET), "the snapshot is redacted");
  assert.equal(sha256Hex(bytes), entry.redacted_sha256);
  assert.deepEqual(bytes, readFileSync(snapshotPath(repo, run_id, "src/app.js")));
  // the redacted snapshot is what side: snapshot line numbers index — three normalised lines here
  assert.equal(core.lineMap(bytes).lines.length, scope.payload.files.find((f) => f.path === "src/app.js").lines);
  assert.equal(rangeBytes(bytes, 1, 1).toString("utf8"), "const a = 1;\n");

  // head for the same path is the committed content, not the working file (the scope says snapshot; checkRange refuses head, resolveSide does not consult the scope for git sides)
  assert.equal(resolveSide(ctx, run, scope, { path: "src/app.js", side: "head" }).toString("utf8"), "export const a = 1;\n");
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [1, 1] }), { ok: false, reason: "SIDE-MISMATCH" });
});

test("side snapshot: a path the scope did not snapshot, or a missing file, is SnapshotMissing; tampered bytes are SnapshotMismatch", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "dirty.js"), "let x = 1;\n");
  const run_id = await initRun(repo, "review");
  const { run, scope } = await scoped(repo, run_id);
  const ctx = ctxOf(repo);
  // src/app.js is clean ⇒ side head in scope, no snapshot entry
  assert.throws(() => resolveSide(ctx, run, scope, { path: "src/app.js", side: "snapshot" }), (err) => err instanceof SnapshotMissing && err.path === "src/app.js" && err.run_id === run_id);
  // recorded but the file is gone
  rmSync(snapshotPath(repo, run_id, "src/dirty.js"));
  assert.throws(() => resolveSide(ctx, run, scope, { path: "src/dirty.js", side: "snapshot" }), SnapshotMissing);
  // recorded, present, but not the recorded bytes
  writeFileSync(snapshotPath(repo, run_id, "src/dirty.js"), "let x = 2;\n");
  assert.throws(() => resolveSide(ctx, run, scope, { path: "src/dirty.js", side: "snapshot" }), (err) => {
    assert.ok(err instanceof SnapshotMismatch, err.message);
    assert.equal(err.path, "src/dirty.js");
    assert.equal(err.expected, scope.payload.snapshot["src/dirty.js"].redacted_sha256);
    assert.equal(err.actual, sha256Hex(Buffer.from("let x = 2;\n")));
    return true;
  });
});

test("resolveSide: argument checks — side vocabulary, repo-relative path (no `..`, no absolute, no backslash), run shape", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const { run, scope } = await scoped(repo, run_id);
  const ctx = ctxOf(repo);
  assert.throws(() => resolveSide(ctx, run, scope, { path: "src/app.js", side: "working" }), TypeError);
  for (const path of ["../etc/passwd", "/etc/passwd", "src/../../x", "src\\app.js", "", "src//app.js", "./src/app.js", "src/app.js\0"]) {
    assert.throws(() => resolveSide(ctx, run, scope, { path, side: "snapshot" }), TypeError, path);
    assert.throws(() => resolveSide(ctx, run, scope, { path, side: "head" }), TypeError, path);
  }
  assert.throws(() => resolveSide(ctx, { payload: run.payload }, scope, { path: "src/app.js", side: "snapshot" }), TypeError, "snapshot needs the run id");
  assert.throws(() => resolveSide(ctx, { envelope: run.envelope, payload: { seq: 1 } }, scope, { path: "src/app.js", side: "head" }), TypeError, "head needs head_oid");
  // the ingest-adapter run shape ({run_id, dir, envelope, payload}) is accepted too
  assert.equal(resolveSide(ctx, { run_id, dir: runDir(repo, run_id), envelope: run.envelope, payload: run.payload }, scope, { path: "src/app.js", side: "head" }).toString(), "export const a = 1;\n");
  // a bare scope payload works like the artifact
  assert.throws(() => resolveSide(ctx, run, scope.payload, { path: "src/app.js", side: "snapshot" }), SnapshotMissing);
});

// --- resolveWorking -----------------------------------------------------------------

test("resolveWorking: the working-tree bytes for drift; absent, directory and symlink ⇒ null; path guard", async () => {
  const repo = readyRepo();
  const ctx = ctxOf(repo);
  assert.equal(resolveWorking(ctx, "src/app.js").toString("utf8"), "export const a = 1;\n");
  writeFileSync(join(repo, "src", "app.js"), "changed\n");
  assert.equal(resolveWorking(ctx, "src/app.js").toString("utf8"), "changed\n");
  assert.equal(resolveWorking(ctx, "src/missing.js"), null);
  assert.equal(resolveWorking(ctx, "src"), null);
  assert.equal(resolveWorking(ctx, "src/app.js/x"), null, "ENOTDIR is absence, not an error");
  symlinkSync("app.js", join(repo, "src", "alias.js"));
  assert.equal(resolveWorking(ctx, "src/alias.js"), null, "a symlink is never followed (scope skips them)");
  assert.throws(() => resolveWorking(ctx, "../outside"), TypeError);
  assert.throws(() => resolveWorking(ctx, "/etc/passwd"), TypeError);
});

// --- the flow gate will run, end to end over real bytes ---------------------------------

test("occurrence recomputed against a caller hint: the hint is not an input, the file bytes decide", async () => {
  const repo = readyRepo();
  const block = "if (user.isAdmin) {\n  grant();\n}\n";
  writeFileSync(join(repo, "src", "app.js"), `${block}\n${block}\n${block}`);
  git(repo, ["add", "src/app.js"]);
  git(repo, ["commit", "-q", "-m", "three identical blocks"]);
  const run_id = await initRun(repo, "assessment");
  const { run, scope } = await scoped(repo, run_id);
  const ctx = ctxOf(repo);
  const bytes = resolveSide(ctx, run, scope, { path: "src/app.js", side: "head" });
  const { lines } = core.lineMap(bytes);
  assert.equal(lines.length, 9, "blank separators are not normalised lines");

  // the claim cites the second block (normalised lines 4-6) and hints occurrence 0
  const claim = { path: "src/app.js", side: "head", lines: [4, 6], snippet: block, occurrence_hint: 0 };
  assert.deepEqual(checkRange(scope, claim), { ok: true });
  const snippetLines = core.lineMap(Buffer.from(claim.snippet)).lines;
  const occurrence = occurrenceOf(lines, snippetLines, claim.lines[0]);
  assert.equal(occurrence, 1);
  assert.notEqual(occurrence, claim.occurrence_hint);
  assert.equal(occurrenceOf(lines, snippetLines, claim.lines[0], claim.occurrence_hint), 1, "an extra argument changes nothing");
  assert.equal(occurrenceOf(lines, snippetLines, 7), 2);
  assert.equal(occurrenceOf(lines, snippetLines, 5), null, "a mis-aligned range does not locate the snippet");

  // the raw bytes of the cited range are the second block, newline-preserving (what range_hmac is computed over)
  assert.equal(rangeBytes(bytes, 4, 6).toString("utf8"), block);
  // the range rule over the same scope
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [1, 41] }), { ok: false, reason: RANGE_TOO_LONG });
  assert.deepEqual(checkRange(scope, { path: "src/app.js", side: "head", lines: [9, 10] }), { ok: false, reason: RANGE_NOT_ADMITTED });
  assert.ok(existsSync(join(runDir(repo, run_id), "scope.json")));
});
