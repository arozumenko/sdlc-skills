// TASK-013 — `evidence.mjs scope` (plan §4.1 row `scope`, §5 TASK-013; spec
// §6.2, D18 / P6, US-009 AC-1…AC-4). Every repo is built in a temp dir by the
// CLI harness; every run is allocated by the real `run init`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactId, hmacHex, readArtifact, sha256Hex } from "../canon.mjs";
import { cleanupAll, git, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { DEFAULT_RULES, redactString } from "../redact.mjs";
import { createContext } from "./ctx.mjs";
import { defaultRecord, TEMPLATE_PATHS } from "./engagement.mjs";
import { walk } from "./fsx.mjs";
import { ensureKey } from "./keys.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const ST = join(".agents", "security-testing");
const SHA256 = /^[0-9a-f]{64}$/;
const OID = /^[0-9a-f]{40}$/;
const SCOPE_LINE = /^SCOPE files=([0-9]+) ranges=([0-9]+) skipped=([0-9]+) snapshot=([0-9]+)$/;
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

function engagementMd(record) {
  return `# Engagement\n\n\`\`\`json engagement\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

/** A committed fixture repo with the ignore block committed, an engagement.md and the engagement's key. */
function readyRepo({ record } = {}) {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), IGNORE_BLOCK);
  git(repo, ["add", ".gitignore"]);
  git(repo, ["commit", "-q", "-m", "ignore block"]);
  const st = join(repo, ST);
  mkdirSync(st, { recursive: true });
  if (record) writeFileSync(join(st, "engagement.md"), engagementMd(record));
  else copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  const ctx = createContext({ root: repo }, { env: { ...process.env, ...ENV } });
  ensureKey(ctx, { engagement_id: ctx.engagement().engagement_id });
  return repo;
}

const runDir = (repo, run_id) => join(repo, ST, "runs", run_id);
const snapshotDir = (repo, run_id) => join(repo, ST, "private", "snapshots", run_id);

function keyBytes(repo) {
  const current = readFileSync(join(repo, ST, "private", "keys", "current"), "utf8").trim();
  return readFileSync(join(repo, ST, "private", "keys", current));
}

async function initRun(repo, kind, extra = []) {
  const args = ["run", "init", "--kind", kind, ...(kind === "review" ? ["--base", "HEAD"] : []), ...extra];
  const r = await runScript("evidence", args, { cwd: repo, env: ENV });
  assert.equal(r.code, 0, `run init ${kind}: ${r.stdout}${r.stderr}`);
  return /^RUN (\S+)/.exec(r.stdout)[1];
}

async function scope(repo, run_id, extra = []) {
  return runScript("evidence", ["scope", "--run", run_id, ...extra], { cwd: repo, env: ENV });
}

function parseScopeLine(stdout) {
  const m = SCOPE_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `first line is the SCOPE token: ${JSON.stringify(stdout)}`);
  return { files: Number(m[1]), ranges: Number(m[2]), skipped: Number(m[3]), snapshot: Number(m[4]) };
}

function readScope(repo, run_id) {
  return readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
}

/** Every file under <st> (private/ included) that contains `needle`. */
function filesContaining(repo, needle) {
  const st = join(repo, ST);
  return walk(st).filter((rel) => {
    const abs = join(st, rel);
    if (lstatSync(abs).isSymbolicLink()) return false;
    return readFileSync(abs).includes(needle);
  });
}

test("payload shape and scope_sha256: files/ranges/skipped, head side from head_oid, WROTE carries the on-disk identity", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const r = await scope(repo, run_id);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  assert.deepEqual(parseScopeLine(r.stdout), { files: 1, ranges: 1, skipped: 0, snapshot: 0 });

  const art = readScope(repo, run_id);
  assert.deepEqual(Object.keys(art.payload).sort(), ["files", "ranges", "skipped"]);
  assert.deepEqual(validate("scope", art.payload), []);
  assert.equal(art.envelope.self_sha256, artifactId(art.payload), "scope_sha256 = sha256(canonical(payload))");
  assert.equal(art.envelope.run_id, run_id);
  assert.equal(art.envelope.kind, "scope");
  assert.equal(art.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  assert.equal(art.envelope.key_id, run.envelope.key_id, "the run's key, not whatever is current");

  const head = git(repo, ["rev-parse", "HEAD"]);
  const bytes = readFileSync(join(repo, "src", "app.js"));
  assert.deepEqual(art.payload.files, [
    {
      path: "src/app.js",
      side: "head",
      oid: git(repo, ["rev-parse", `${head}:src/app.js`]),
      file_hmac: hmacHex(keyBytes(repo), bytes),
      lines: 1,
    },
  ]);
  assert.match(art.payload.files[0].oid, OID);
  assert.match(art.payload.files[0].file_hmac, SHA256);
  assert.deepEqual(art.payload.ranges, { "src/app.js": [[1, 1]] });
  assert.deepEqual(art.payload.skipped, []);

  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2, "SCOPE + one WROTE line");
  assert.equal(lines[1], `WROTE ${ST}/runs/${run_id}/scope.json sha256=${art.envelope.self_sha256}`);
});

test("assessment on a clean tree has no snapshot and no private/snapshots dir", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const r = await scope(repo, run_id);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const art = readScope(repo, run_id);
  assert.ok(!("snapshot" in art.payload), "payload.snapshot absent");
  assert.ok(!existsSync(snapshotDir(repo, run_id)), "no private/snapshots/<run>/");
  assert.ok(!existsSync(join(repo, ST, "private", "snapshots")), "no private/snapshots/ at all");
  assert.equal(parseScopeLine(r.stdout).snapshot, 0);
});

test("dirty review snapshot of a file containing password=1234 ⇒ snapshot bytes redacted, HMAC present, no original bytes anywhere under .agents/security-testing/", async () => {
  const repo = readyRepo();
  const original = `export const a = 1;\nconst cfg = { ${SECRET} };\n`;
  writeFileSync(join(repo, "src", "app.js"), original);
  const run_id = await initRun(repo, "review");
  const r = await scope(repo, run_id);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseScopeLine(r.stdout), { files: 1, ranges: 1, skipped: 0, snapshot: 1 });

  const snap = join(snapshotDir(repo, run_id), "src", "app.js");
  assert.ok(existsSync(snap), "private/snapshots/<run>/<path> exists");
  const redactedBytes = readFileSync(snap);
  assert.ok(!redactedBytes.includes(SECRET), "snapshot bytes are redacted");
  assert.match(redactedBytes.toString("utf8"), /<REDACTED:password-assign>/);
  assert.equal(redactedBytes.toString("utf8"), redactString(Buffer.from(original)).text, "redacted by redact.mjs, byte for byte");

  const art = readScope(repo, run_id);
  assert.deepEqual(validate("scope", art.payload), []);
  const original_hmac = hmacHex(keyBytes(repo), Buffer.from(original));
  const redacted_sha256 = sha256Hex(redactedBytes);
  assert.deepEqual(art.payload.snapshot, { "src/app.js": { original_hmac, redacted_sha256, redaction_version: DEFAULT_RULES.redaction_version } });
  assert.deepEqual(art.payload.files, [{ path: "src/app.js", side: "snapshot", oid: redacted_sha256, file_hmac: original_hmac, lines: 2 }]);
  assert.deepEqual(art.payload.ranges, { "src/app.js": [[1, 2]] });

  // §12: every file under <st>, private/ included
  assert.deepEqual(filesContaining(repo, SECRET), []);
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
});

test("untracked in-scope file snapshotted the same way; a clean tracked file stays on the head side", async () => {
  const repo = readyRepo();
  const original = `const ${SECRET};\nexport const b = 2;\n`;
  writeFileSync(join(repo, "src", "new.js"), original);
  const run_id = await initRun(repo, "review");
  const r = await scope(repo, run_id);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseScopeLine(r.stdout), { files: 2, ranges: 2, skipped: 0, snapshot: 1 });

  const art = readScope(repo, run_id);
  const snap = readFileSync(join(snapshotDir(repo, run_id), "src", "new.js"));
  assert.ok(!snap.includes(SECRET));
  const original_hmac = hmacHex(keyBytes(repo), Buffer.from(original));
  assert.deepEqual(art.payload.snapshot, { "src/new.js": { original_hmac, redacted_sha256: sha256Hex(snap), redaction_version: DEFAULT_RULES.redaction_version } });
  assert.deepEqual(
    art.payload.files.map((f) => [f.path, f.side]),
    [
      ["src/app.js", "head"],
      ["src/new.js", "snapshot"],
    ],
  );
  assert.equal(art.payload.files[1].file_hmac, original_hmac);
  assert.ok(!existsSync(join(snapshotDir(repo, run_id), "src", "app.js")), "the clean file is not snapshotted");
  assert.deepEqual(filesContaining(repo, SECRET), []);

  // an ignored untracked file is outside the observation (never listed, never snapshotted)
  const ignored = readyRepo();
  writeFileSync(join(ignored, ".gitignore"), `${IGNORE_BLOCK}src/*.log\n`);
  writeFileSync(join(ignored, "src", "debug.log"), `${SECRET}\n`);
  const rid = await initRun(ignored, "review");
  const ir = await scope(ignored, rid);
  assert.equal(ir.code, 0, ir.stdout + ir.stderr);
  assert.deepEqual(readScope(ignored, rid).payload.files.map((f) => f.path), ["src/app.js"]);
  assert.ok(!existsSync(join(snapshotDir(ignored, rid), "src", "debug.log")));
});

test("binary/oversize/symlink land in skipped[] with reason; submodule and a deleted tracked file too", async () => {
  const repo = readyRepo({ record: { ...defaultRecord(), scope_paths: ["src/", "vendor/"], product_paths: [] } });
  // committed shapes: a binary (NUL in the first 8 KiB), an oversize text, a symlink, a submodule
  writeFileSync(join(repo, "src", "logo.png"), Buffer.concat([Buffer.from("PNG"), Buffer.alloc(16, 0), Buffer.from("tail")]));
  writeFileSync(join(repo, "src", "big.js"), `${"x".repeat(80)}\n`.repeat(40));
  symlinkSync("app.js", join(repo, "src", "link.js"));
  const sub = initRepo();
  git(repo, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/lib"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "shapes"]);

  const run_id = await initRun(repo, "assessment");
  const r = await scope(repo, run_id, ["--max-bytes", "1000"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const art = readScope(repo, run_id);
  assert.deepEqual(validate("scope", art.payload), []);
  assert.deepEqual(art.payload.files.map((f) => f.path), ["src/app.js"]);
  assert.deepEqual(art.payload.skipped, [
    { path: "src/big.js", reason: "too-large" },
    { path: "src/link.js", reason: "symlink" },
    { path: "src/logo.png", reason: "binary" },
    { path: "vendor/lib", reason: "submodule" },
  ]);
  assert.deepEqual(Object.keys(art.payload.ranges), ["src/app.js"], "a skipped file admits no range");
  assert.deepEqual(parseScopeLine(r.stdout), { files: 1, ranges: 1, skipped: 4, snapshot: 0 });

  // the default cap admits the 3 KiB file
  const wide = await initRun(repo, "assessment");
  const w = await scope(repo, wide);
  assert.equal(w.code, 0, w.stdout + w.stderr);
  assert.deepEqual(readScope(repo, wide).payload.files.map((f) => [f.path, f.lines]), [
    ["src/app.js", 1],
    ["src/big.js", 40],
  ]);

  // review: the same shapes as working-tree files (untracked binary, oversize edit, symlink, deleted tracked file)
  const rv = readyRepo();
  writeFileSync(join(rv, "src", "blob.bin"), Buffer.concat([Buffer.alloc(8, 0), Buffer.from("x")]));
  writeFileSync(join(rv, "src", "huge.js"), `${"y".repeat(80)}\n`.repeat(40));
  symlinkSync("app.js", join(rv, "src", "alias.js"));
  git(rv, ["rm", "-q", "--cached", "src/app.js"]); // still in HEAD, absent from the index: dirty
  writeFileSync(join(rv, "src", "app.js"), "export const a = 1;\n");
  const rvId = await initRun(rv, "review");
  const rr = await scope(rv, rvId, ["--max-bytes", "1000"]);
  assert.equal(rr.code, 0, rr.stdout + rr.stderr);
  const rvScope = readScope(rv, rvId).payload;
  assert.deepEqual(rvScope.skipped, [
    { path: "src/alias.js", reason: "symlink" },
    { path: "src/blob.bin", reason: "binary" },
    { path: "src/huge.js", reason: "too-large" },
  ]);
  assert.deepEqual(rvScope.files.map((f) => [f.path, f.side]), [["src/app.js", "snapshot"]], "unstaged-but-present file is dirty ⇒ snapshot");
  assert.ok(!existsSync(join(snapshotDir(rv, rvId), "src", "huge.js")), "a skipped file is never persisted");
  assert.ok(!existsSync(join(snapshotDir(rv, rvId), "src", "blob.bin")));

  // a tracked file deleted from the working tree (still in the index) has nothing to review
  const del = readyRepo();
  rmSync(join(del, "src", "app.js"));
  const delId = await initRun(del, "review");
  const dr = await scope(del, delId);
  assert.equal(dr.code, 0, dr.stdout + dr.stderr);
  const delScope = readScope(del, delId).payload;
  assert.deepEqual(delScope.files, []);
  assert.deepEqual(delScope.skipped, [{ path: "src/app.js", reason: "unreadable" }]);
  assert.ok(!existsSync(snapshotDir(del, delId)));

  // a staged deletion (`git rm`) is no longer tracked: not listed, not skipped
  const staged = readyRepo();
  git(staged, ["rm", "-q", "src/app.js"]);
  const stagedId = await initRun(staged, "review");
  const sr = await scope(staged, stagedId);
  assert.equal(sr.code, 0, sr.stdout + sr.stderr);
  assert.deepEqual(readScope(staged, stagedId).payload, { files: [], ranges: {}, skipped: [] });
});

test("assessment tree dirtied after run init ⇒ 3 DIRTY-TREE, nothing written", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  writeFileSync(join(repo, "src", "app.js"), `export const a = 2; // ${SECRET}\n`);
  const r = await scope(repo, run_id);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(r.stdout, "DIRTY-TREE\n");
  assert.ok(!existsSync(join(runDir(repo, run_id), "scope.json")));
  assert.ok(!existsSync(join(repo, ST, "private", "snapshots")), "an assessment never snapshots, dirty or not");
  assert.deepEqual(filesContaining(repo, SECRET), []);

  // an untracked file under the assessed paths is dirt too
  git(repo, ["checkout", "--", "src/app.js"]);
  writeFileSync(join(repo, "src", "stray.js"), "export const s = 1;\n");
  const u = await scope(repo, run_id);
  assert.equal(u.code, 3);
  assert.equal(u.stdout, "DIRTY-TREE\n");

  // P6: dirt under the bundle's managed paths and outside the assessed paths never counts
  const clean = readyRepo();
  const cid = await initRun(clean, "assessment");
  writeFileSync(join(clean, "README.md"), "# changed outside scope_paths ∪ product_paths\n");
  mkdirSync(join(clean, "reports", "security"), { recursive: true });
  writeFileSync(join(clean, "reports", "security", "draft.md"), "draft\n");
  writeFileSync(join(clean, ST, "risk-register.md"), "rendered\n");
  const c = await scope(clean, cid);
  assert.equal(c.code, 0, c.stdout + c.stderr);
});

test("Rio's nit: --base is not a scope flag ⇒ 2 USAGE; an assessment whose head_oid is no longer HEAD ⇒ 2 USAGE, never a snapshot", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  const b = await scope(repo, run_id, ["--base", "HEAD~1"]);
  assert.equal(b.code, 2, b.stdout + b.stderr);
  assert.equal(b.stdout, "USAGE(scope: unknown flag --base)\n");
  assert.ok(!existsSync(join(runDir(repo, run_id), "scope.json")));

  // HEAD moves after run init: the clean-tree check compares the working tree
  // against HEAD, which now says nothing about head_oid (D18).
  writeFileSync(join(repo, "src", "app.js"), "export const a = 3;\n");
  git(repo, ["commit", "-q", "-am", "moved"]);
  const m = await scope(repo, run_id);
  assert.equal(m.code, 2, m.stdout + m.stderr);
  const head_oid = readArtifact(join(runDir(repo, run_id), "run.json")).payload.head_oid;
  assert.equal(m.stdout, `USAGE(scope: run ${run_id} head_oid ${head_oid} is not HEAD (assessment))\n`);
  assert.ok(!existsSync(join(runDir(repo, run_id), "scope.json")));
  assert.ok(!existsSync(join(repo, ST, "private", "snapshots")));

  // a review run pinned to an older head: a file that is clean against HEAD
  // but differs at head_oid is dirty relative to the run's head ⇒ snapshot
  const rv = readyRepo();
  writeFileSync(join(rv, "src", "app.js"), "export const a = 9;\n");
  git(rv, ["commit", "-q", "-am", "newer"]);
  const rid = await initRun(rv, "review", ["--head", "HEAD~1"]);
  const rr = await scope(rv, rid);
  assert.equal(rr.code, 0, rr.stdout + rr.stderr);
  const s = readScope(rv, rid).payload;
  assert.deepEqual(s.files.map((f) => [f.path, f.side]), [["src/app.js", "snapshot"]]);
  assert.equal(readFileSync(join(snapshotDir(rv, rid), "src", "app.js"), "utf8"), "export const a = 9;\n");
});

test("write-once: second scope on the same run ⇒ 2 SCOPE-EXISTS; COMMITTED run ⇒ 2 RUN-COMMITTED; unknown run / bad argv ⇒ 2 USAGE; no key ⇒ 2 KEY: unavailable", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "review");
  const first = await scope(repo, run_id);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const before = readFileSync(join(runDir(repo, run_id), "scope.json"), "utf8");
  const again = await scope(repo, run_id);
  assert.equal(again.code, 2, again.stdout + again.stderr);
  assert.equal(again.stdout, "SCOPE-EXISTS\n");
  assert.equal(readFileSync(join(runDir(repo, run_id), "scope.json"), "utf8"), before, "byte-identical");

  const committed = await initRun(repo, "review");
  writeFileSync(join(runDir(repo, committed), "COMMITTED"), "x\n");
  const c = await scope(repo, committed);
  assert.equal(c.code, 2);
  assert.equal(c.stdout, "RUN-COMMITTED\n");
  assert.ok(!existsSync(join(runDir(repo, committed), "scope.json")));

  const head = git(repo, ["rev-parse", "HEAD"]).slice(0, 12);
  const unknown = await scope(repo, `${head}-0099`);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stdout, `USAGE(scope: unknown run ${head}-0099)\n`);
  for (const [args, re] of [
    [[], /^USAGE\(scope: --run is required\)$/m],
    [["--run", "nope"], /^USAGE\(scope: --run must be <12 hex>-<4 digits>, got nope\)$/m],
    [["--run", run_id, "--max-bytes", "0"], /^USAGE\(scope: --max-bytes must be a positive integer\)$/m],
    [["--run", run_id, "--max-bytes", "12k"], /^USAGE\(scope: --max-bytes must be a positive integer\)$/m],
    [["--run", run_id, "extra"], /^USAGE\(scope: unexpected argument extra\)$/m],
  ]) {
    const r = await runScript("evidence", ["scope", ...args], { cwd: repo, env: ENV });
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.stdout, re);
  }

  // the run's key is gone ⇒ no HMAC can be computed ⇒ refused before anything is read
  const lost = readyRepo();
  const lid = await initRun(lost, "review");
  writeFileSync(join(lost, "src", "app.js"), `${SECRET}\n`);
  const { key_id } = readArtifact(join(runDir(lost, lid), "run.json")).envelope;
  rmSync(join(lost, ST, "private", "keys", key_id));
  const k = await scope(lost, lid);
  assert.equal(k.code, 2, k.stdout + k.stderr);
  assert.equal(k.stdout, "KEY: unavailable\n");
  assert.ok(!existsSync(join(lost, ST, "private", "snapshots")));
});

test("--include narrows the file set (path prefix or glob); empty scope still writes the artifact", async () => {
  const repo = readyRepo({ record: { ...defaultRecord(), scope_paths: ["src/", "lib/"], product_paths: [] } });
  mkdirSync(join(repo, "lib", "deep"), { recursive: true });
  writeFileSync(join(repo, "src", "util.ts"), "export const u = 1;\n");
  writeFileSync(join(repo, "lib", "a.js"), "a\n");
  writeFileSync(join(repo, "lib", "deep", "b.js"), "b\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "more"]);

  const all = await initRun(repo, "assessment");
  const a = await scope(repo, all);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.deepEqual(readScope(repo, all).payload.files.map((f) => f.path), ["lib/a.js", "lib/deep/b.js", "src/app.js", "src/util.ts"]);

  const cases = [
    [["--include", "lib"], ["lib/a.js", "lib/deep/b.js"]],
    [["--include", "lib/"], ["lib/a.js", "lib/deep/b.js"]],
    [["--include", "src/app.js"], ["src/app.js"]],
    [["--include", "*.ts"], []],
    [["--include", "**/*.ts"], ["src/util.ts"]],
    [["--include", "src/*.ts", "--include", "lib/*.js"], ["lib/a.js", "src/util.ts"]],
    [["--include", "nothing/"], []],
  ];
  for (const [args, expected] of cases) {
    const id = await initRun(repo, "assessment");
    const r = await scope(repo, id, args);
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    const art = readScope(repo, id);
    assert.deepEqual(art.payload.files.map((f) => f.path), expected, args.join(" "));
    assert.deepEqual(validate("scope", art.payload), []);
    if (expected.length === 0) {
      assert.deepEqual(art.payload, { files: [], ranges: {}, skipped: [] }, "empty scope is still an artifact (coverage says INDETERMINATE, not scope)");
      assert.deepEqual(parseScopeLine(r.stdout), { files: 0, ranges: 0, skipped: 0, snapshot: 0 });
    }
  }

  // empty scope_paths ⇒ nothing assessed, artifact written
  const none = readyRepo({ record: { ...defaultRecord(), scope_paths: [], product_paths: [] } });
  const nid = await initRun(none, "assessment");
  const n = await scope(none, nid);
  assert.equal(n.code, 0, n.stdout + n.stderr);
  assert.deepEqual(readScope(none, nid).payload, { files: [], ranges: {}, skipped: [] });
});

test("scope identity is content-only: two runs over the same tree produce the same scope_sha256 (G-1); an empty file admits no range", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "empty.js"), "");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "empty"]);
  const a = await initRun(repo, "assessment");
  const b = await initRun(repo, "assessment");
  const ra = await scope(repo, a);
  const rb = await runScript("evidence", ["scope", "--run", b], { cwd: repo, env: { ...ENV, SECURITY_EVIDENCE_NOW: "2026-09-16T11:00:00Z" } });
  assert.equal(ra.code, 0, ra.stdout + ra.stderr);
  assert.equal(rb.code, 0, rb.stdout + rb.stderr);
  const sa = readScope(repo, a);
  const sb = readScope(repo, b);
  assert.equal(sa.envelope.self_sha256, sb.envelope.self_sha256);
  assert.notEqual(sa.envelope.created_at, sb.envelope.created_at);
  assert.deepEqual(sa.payload.files.map((f) => [f.path, f.lines]), [
    ["src/app.js", 1],
    ["src/empty.js", 0],
  ]);
  assert.deepEqual(sa.payload.ranges, { "src/app.js": [[1, 1]], "src/empty.js": [] });
  assert.deepEqual(parseScopeLine(ra.stdout), { files: 2, ranges: 1, skipped: 0, snapshot: 0 });
});
