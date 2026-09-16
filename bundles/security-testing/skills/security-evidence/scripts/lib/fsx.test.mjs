import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupAll, tmpDir } from "../fixtures/cli/harness.mjs";
import { LockTimeoutError, appendLine, rmTree, walk, withLock, withLockSync, writeAtomic, writeExclusive } from "./fsx.mjs";

after(cleanupAll);

const FSX_URL = new URL("./fsx.mjs", import.meta.url).href;

test("fsx.mjs imports only node:* and reads no wall clock (G-1: stale locks are judged by fs mtimes)", () => {
  const src = readFileSync(fileURLToPath(FSX_URL), "utf8");
  const specifiers = [...src.matchAll(/^\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const s of specifiers) assert.ok(s.startsWith("node:"), `unexpected import ${s}`);
  assert.doesNotMatch(src, /child_process|\bfetch\(|node:http|node:net|node:dns/);
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/, "G-1");
});

test("writeExclusive fails when the file exists", () => {
  const dir = tmpDir();
  const path = join(dir, "nested", "run.json");
  writeExclusive(path, Buffer.from("one\n"));
  assert.equal(readFileSync(path, "utf8"), "one\n");
  assert.throws(() => writeExclusive(path, Buffer.from("two\n")), (e) => e.code === "EEXIST");
  assert.equal(readFileSync(path, "utf8"), "one\n", "first bytes untouched");
  if (process.platform !== "win32") {
    const keyPath = join(dir, "key");
    writeExclusive(keyPath, Buffer.alloc(32), 0o600);
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  }
});

test("appendLine appends exactly one line per call and creates the file", () => {
  const path = join(tmpDir(), "events.jsonl");
  appendLine(path, '{"seq":1}');
  appendLine(path, '{"seq":2}');
  assert.equal(readFileSync(path, "utf8"), '{"seq":1}\n{"seq":2}\n');
  assert.throws(() => appendLine(path, "a\nb"), /newline/);
});

test("writeAtomic leaves no tmp file", () => {
  const dir = tmpDir();
  const path = join(dir, "index.json");
  writeAtomic(path, Buffer.from("v1\n"));
  writeAtomic(path, "v2\n");
  assert.equal(readFileSync(path, "utf8"), "v2\n");
  assert.deepEqual(readdirSync(dir), ["index.json"]);
  // a failing write (target is a directory) leaves no tmp file behind either
  mkdirSync(join(dir, "adir"));
  assert.throws(() => writeAtomic(join(dir, "adir"), "x"));
  assert.deepEqual(readdirSync(dir).sort(), ["adir", "index.json"]);
});

test("withLock serialises two writers", async () => {
  const dir = tmpDir();
  const lockDir = join(dir, "index.lock");
  const log = join(dir, "log.txt");
  // Two child processes each take the lock, write BEGIN, sleep, write END.
  // Serialised ⇒ the log is BEGIN END BEGIN END, never BEGIN BEGIN.
  const worker = join(dir, "worker.mjs");
  writeFileSync(
    worker,
    `import { withLockSync, appendLine } from ${JSON.stringify(FSX_URL)};
     const [lockDir, log, tag] = process.argv.slice(2);
     withLockSync(lockDir, () => {
       appendLine(log, "BEGIN " + tag);
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
       appendLine(log, "END " + tag);
     });`,
  );
  const spawnWorker = (tag) =>
    new Promise((done, fail) => {
      execFile(process.execPath, [worker, lockDir, log, tag], { cwd: dir, env: { PATH: process.env.PATH }, shell: false }, (err, stdout, stderr) =>
        err ? fail(new Error(stderr || err.message)) : done(stdout),
      );
    });
  await Promise.all([spawnWorker("a"), spawnWorker("b")]);
  const lines = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^BEGIN (a|b)$/);
  assert.equal(lines[1], lines[0].replace("BEGIN", "END"));
  assert.match(lines[2], /^BEGIN (a|b)$/);
  assert.equal(lines[3], lines[2].replace("BEGIN", "END"));
  assert.equal(existsSync(lockDir), false, "lock released");
});

test("withLock (async) serialises two in-process writers and releases on throw", async () => {
  const dir = tmpDir();
  const lockDir = join(dir, "lock");
  const order = [];
  const writer = (tag) =>
    withLock(lockDir, async () => {
      order.push(`BEGIN ${tag}`);
      await new Promise((r) => setTimeout(r, 60));
      order.push(`END ${tag}`);
      return tag;
    });
  const results = await Promise.all([writer("a"), writer("b")]);
  assert.deepEqual(results.sort(), ["a", "b"]);
  assert.equal(order[1], order[0].replace("BEGIN", "END"));
  assert.equal(order[3], order[2].replace("BEGIN", "END"));
  await assert.rejects(withLock(lockDir, () => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(existsSync(lockDir), false, "released after a throwing fn");
  assert.equal(withLockSync(lockDir, () => 42), 42);
});

test("withLock times out on a live lock and reclaims a stale one", async () => {
  const dir = tmpDir();
  const lockDir = join(dir, "lock");
  mkdirSync(lockDir);
  await assert.rejects(withLock(lockDir, () => 1, { timeoutMs: 120 }), (e) => e instanceof LockTimeoutError);
  assert.throws(() => withLockSync(lockDir, () => 1, { timeoutMs: 120 }), (e) => e instanceof LockTimeoutError);
  // a lock older than staleMs is reclaimed
  const old = (Date.now() - 120_000) / 1000;
  utimesSync(lockDir, old, old);
  assert.equal(await withLock(lockDir, () => "ran", { timeoutMs: 500, staleMs: 60_000 }), "ran");
  assert.equal(existsSync(lockDir), false);
});

test("walk lists files recursively, sorted, with posix-relative paths; rmTree removes a tree", () => {
  const dir = tmpDir();
  mkdirSync(join(dir, "b", "inner"), { recursive: true });
  mkdirSync(join(dir, "a"));
  writeFileSync(join(dir, "b", "inner", "z.txt"), "");
  writeFileSync(join(dir, "b", "y.txt"), "");
  writeFileSync(join(dir, "a", "x.txt"), "");
  writeFileSync(join(dir, "top.txt"), "");
  assert.deepEqual(walk(dir), ["a/x.txt", "b/inner/z.txt", "b/y.txt", "top.txt"]);
  assert.deepEqual(walk(join(dir, "missing")), []);
  // UTF-8 byte order, as canon sorts keys: U+FF5E (EF BD 9E) precedes U+1F600 (F0 9F 98 80),
  // whereas UTF-16 code units (D83D DE00 < FF5E) would put the emoji first.
  const uni = tmpDir();
  writeFileSync(join(uni, "\u{1F600}.txt"), "");
  writeFileSync(join(uni, "\uFF5E.txt"), "");
  assert.deepEqual(walk(uni), ["\uFF5E.txt", "\u{1F600}.txt"]);
  rmTree(join(dir, "b"));
  assert.equal(existsSync(join(dir, "b")), false);
  rmTree(join(dir, "b")); // idempotent
});
