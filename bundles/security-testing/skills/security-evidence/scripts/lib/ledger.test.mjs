// TASK-012 — lib/ledger.mjs: run allocation under the ledger lock (spec §6.1
// "run init appends {seq, run_id, kind} to ledger/index.json under a lock";
// TL-9 run_id; TL-14 index files).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrict } from "../canon.mjs";
import { cleanupAll, initRepo } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { CliError } from "./exit.mjs";
import { RUN_ID, allocateRun, ledgerPaths, listCommittedRuns, readIndex, runIdOf, withRunLock } from "./ledger.mjs";

after(cleanupAll);

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const BASE = "fedcba9876543210fedcba9876543210fedcba98";
const ctxFor = (repo) => createContext({ root: repo }, { env: { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z" } });

test("runIdOf: head_oid[0:12] + '-' + seq zero-padded to 4 (TL-9); RUN_ID matches it", () => {
  assert.equal(runIdOf(HEAD, 1), "0123456789ab-0001");
  assert.equal(runIdOf(HEAD, 42), "0123456789ab-0042");
  assert.equal(runIdOf(HEAD, 9999), "0123456789ab-9999");
  assert.ok(RUN_ID.test(runIdOf(HEAD, 7)));
  assert.throws(() => runIdOf("short", 1), /head_oid/);
  assert.throws(() => runIdOf(HEAD, 0), /seq/);
  assert.throws(() => runIdOf(HEAD, 10000), /seq/);
  assert.throws(() => runIdOf(HEAD, 1.5), /seq/);
});

test("allocateRun: first seq is 1, then max+1; the index is canonical JSON, one entry per run, in seq order", async () => {
  const ctx = ctxFor(initRepo());
  assert.deepEqual(readIndex(ctx), []);
  const a = await allocateRun(ctx, { kind: "assessment", base_oid: HEAD, head_oid: HEAD });
  assert.deepEqual(a, { seq: 1, run_id: "0123456789ab-0001" });
  const b = await allocateRun(ctx, { kind: "review", base_oid: BASE, head_oid: HEAD });
  assert.deepEqual(b, { seq: 2, run_id: "0123456789ab-0002" });
  const paths = ledgerPaths(ctx);
  const text = readFileSync(paths.index, "utf8");
  assert.equal(text, `[{"kind":"assessment","run_id":"0123456789ab-0001","seq":1},{"kind":"review","run_id":"0123456789ab-0002","seq":2}]\n`);
  assert.deepEqual(readIndex(ctx), parseStrict(text));
  assert.ok(!existsSync(paths.lock), "lock released");
  assert.deepEqual(readdirSync(paths.dir), ["index.json"], "nothing but the index under ledger/");
});

test("allocateRun: seq is max+1 even when the index has gaps, and never reuses a seq", async () => {
  const ctx = ctxFor(initRepo());
  const paths = ledgerPaths(ctx);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.index, `[{"kind":"review","run_id":"0123456789ab-0001","seq":1},{"kind":"review","run_id":"0123456789ab-0005","seq":5}]\n`);
  const r = await allocateRun(ctx, { kind: "verify", base_oid: HEAD, head_oid: HEAD });
  assert.deepEqual(r, { seq: 6, run_id: "0123456789ab-0006" });
  assert.equal(readIndex(ctx).length, 3);
});

test("allocateRun refuses a bad kind or oid before touching the ledger", async () => {
  const ctx = ctxFor(initRepo());
  await assert.rejects(allocateRun(ctx, { kind: "audit", base_oid: HEAD, head_oid: HEAD }), /kind/);
  await assert.rejects(allocateRun(ctx, { kind: "review", base_oid: "HEAD", head_oid: HEAD }), /base_oid/);
  await assert.rejects(allocateRun(ctx, { kind: "review", base_oid: HEAD, head_oid: "abc" }), /head_oid/);
  assert.ok(!existsSync(ledgerPaths(ctx).index));
});

test("readIndex: a malformed or off-shape index is exit 5 INCONSISTENT(ledger/index.json)", () => {
  const ctx = ctxFor(initRepo());
  const paths = ledgerPaths(ctx);
  mkdirSync(paths.dir, { recursive: true });
  const bad = [
    "not json\n",
    `{"runs":[]}\n`,
    `[{"kind":"review","run_id":"0123456789ab-0001"}]\n`, // seq missing
    `[{"kind":"review","run_id":"0123456789ab-0001","seq":1,"extra":true}]\n`,
    `[{"kind":"nope","run_id":"0123456789ab-0001","seq":1}]\n`,
    `[{"kind":"review","run_id":"bad","seq":1}]\n`,
    `[{"kind":"review","run_id":"0123456789ab-0001","seq":1},{"kind":"review","run_id":"0123456789ab-0002","seq":1}]\n`, // duplicate seq
    `[{"kind":"review","run_id":"0123456789ab-0001","seq":1},{"kind":"review","run_id":"0123456789ab-0001","seq":2}]\n`, // duplicate run_id
    `[{"kind":"review","run_id":"0123456789ab-0002","seq":2},{"kind":"review","run_id":"0123456789ab-0001","seq":1}]\n`, // out of order
  ];
  for (const text of bad) {
    writeFileSync(paths.index, text);
    assert.throws(
      () => readIndex(ctx),
      (err) => err instanceof CliError && err.code === 5 && err.token === "INCONSISTENT(ledger/index.json)",
      text,
    );
  }
});

test("listCommittedRuns: only runs whose directory carries COMMITTED", async () => {
  const ctx = ctxFor(initRepo());
  const a = await allocateRun(ctx, { kind: "assessment", base_oid: HEAD, head_oid: HEAD });
  const b = await allocateRun(ctx, { kind: "review", base_oid: HEAD, head_oid: HEAD });
  await allocateRun(ctx, { kind: "verify", base_oid: HEAD, head_oid: HEAD });
  assert.deepEqual(listCommittedRuns(ctx), []);
  for (const { run_id } of [a, b]) {
    mkdirSync(join(ctx.st, "runs", run_id), { recursive: true });
    writeFileSync(join(ctx.st, "runs", run_id, "COMMITTED"), "sha256=x\n");
  }
  assert.deepEqual(listCommittedRuns(ctx), [
    { kind: "assessment", run_id: a.run_id, seq: 1 },
    { kind: "review", run_id: b.run_id, seq: 2 },
  ]);
});

test("withRunLock: serialises in-process callers, lives under ledger/ (outside every walked tree) and is released after a throw", async () => {
  const ctx = ctxFor(initRepo());
  const run_id = "0123456789ab-0001";
  const lock = join(ctx.st, "ledger", `${run_id}.lock`);
  // Mutual exclusion, not FIFO: fsx.withLock promises no order (the first
  // caller may lose a round to mkdir-ing the parent), only that critical
  // sections never overlap — so the log must read BEGIN x, END x, BEGIN y, END y.
  const order = [];
  const holder = (tag) =>
    withRunLock(ctx, run_id, async () => {
      order.push(`BEGIN ${tag}`);
      assert.ok(existsSync(lock), "lock dir exists while held");
      await new Promise((r) => setTimeout(r, 60));
      order.push(`END ${tag}`);
      return tag;
    });
  assert.deepEqual((await Promise.all([holder("a"), holder("b")])).sort(), ["a", "b"]);
  assert.equal(order.length, 4);
  assert.equal(order[1], order[0].replace("BEGIN", "END"));
  assert.equal(order[3], order[2].replace("BEGIN", "END"));
  assert.ok(!existsSync(lock));
  await assert.rejects(withRunLock(ctx, run_id, () => Promise.reject(new Error("boom"))), /boom/);
  assert.ok(!existsSync(lock), "released after a throw");
  assert.ok(!existsSync(join(ctx.st, "runs", run_id)), "the lock never creates the run directory");
  assert.throws(() => withRunLock(ctx, "nope", () => {}), /run_id/);
});
