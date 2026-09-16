// TASK-028 — register-core: the append-only log at <st>/register/ with
// rebuild-vs-corrupt recovery and an anchor (US-020, spec §6.8, plan §4.3).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, parseStrict } from "../canon.mjs";
import { cleanupAll, initRepo } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { TEMPLATE_PATHS } from "./engagement.mjs";
import { CliError } from "./exit.mjs";
import { GENESIS_SHA256, TransitionError, eventSha256, replay as foldReplay } from "./register-fold.mjs";
import { anchor, anchorVerify, append, openRegister, readEvents, rebuildProjection, registerPaths, replay, verifyChain } from "./register-core.mjs";

after(cleanupAll);

const SELF = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "register-core.mjs"), "utf8");
const NOW = "2026-09-16T10:00:00Z";
const RUN = "0123456789ab-0001";
const FINDING = "f".repeat(64);

function repoWithEngagement() {
  const repo = initRepo();
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  return repo;
}

function streams() {
  const stdout = { text: "", write(s) { this.text += s; } };
  const stderr = { text: "", write(s) { this.text += s; } };
  return { stdout, stderr };
}

function makeCtx(repo, { now = NOW, actor = "lead" } = {}) {
  const s = streams();
  const ctx = createContext({ root: repo, actor }, { cwd: repo, env: { SECURITY_EVIDENCE_NOW: now }, ...s });
  return { ctx, ...s };
}

const addArgs = (title, row_id) => ({ row_id, event: "add", payload: { subject: FINDING, subject_kind: "finding", title, priority: "p1", owner: "", first_seen_run: RUN }, ref: RUN });

async function seeded(titles) {
  const repo = repoWithEngagement();
  const { ctx, stderr } = makeCtx(repo);
  for (const [i, title] of titles.entries()) await append(ctx, addArgs(title, `R-${String(i + 1).padStart(4, "0")}`));
  return { repo, ctx, stderr, paths: registerPaths(ctx) };
}

const lines = (path) => readFileSync(path, "utf8").split("\n").filter((l) => l !== "");
const snapshot = (dir) => Object.fromEntries(readdirSync(dir).map((n) => [n, statSync(join(dir, n)).isDirectory() ? "<dir>" : readFileSync(join(dir, n), "utf8")]));

const isCorrupt = (e) => e instanceof CliError && e.code === 5 && e.token === "CORRUPT";

// ---------------------------------------------------------------------------

test("register dir is created under <st>/register/; an empty register projects seq 0 and the genesis chain", async () => {
  const repo = repoWithEngagement();
  const { ctx } = makeCtx(repo);
  const paths = registerPaths(ctx);
  assert.equal(paths.dir, join(repo, ".agents", "security-testing", "register"));
  assert.deepEqual(Object.keys(paths).sort(), ["aliases", "dir", "events", "lock", "projection"]);

  const reg = await openRegister(ctx);
  assert.ok(existsSync(paths.dir));
  assert.ok(!existsSync(paths.lock), "the lock is released");
  assert.equal(reg.rebuilt, true, "a missing projection is written");
  assert.deepEqual(reg.events, []);
  assert.deepEqual(reg.projection, { engagement_id: "eng-2026-001", seq: 0, chain_sha256: GENESIS_SHA256, rows: {} });
  assert.deepEqual(parseStrict(readFileSync(paths.projection)), reg.projection);
  assert.ok(!existsSync(paths.events), "no log until the first append");

  const again = await openRegister(ctx);
  assert.equal(again.rebuilt, false);
});

test("openRegister without engagement.md ⇒ CliError 2 ENGAGEMENT-MISSING and no register dir", async () => {
  const repo = initRepo();
  const { ctx } = makeCtx(repo);
  await assert.rejects(openRegister(ctx), (e) => e instanceof CliError && e.code === 2 && e.token === "ENGAGEMENT-MISSING");
  assert.ok(!existsSync(registerPaths(ctx).dir));
});

test("append: one canonical line per event carrying seq, prev_sha256, ts = ctx.now(), actor; the projection follows the log", async () => {
  const { ctx, paths } = await seeded([]);
  const first = await append(ctx, addArgs("first", "R-0001"));
  assert.deepEqual(first.event, { seq: 1, prev_sha256: GENESIS_SHA256, ts: NOW, actor: "lead", row_id: "R-0001", event: "add", payload: addArgs("first").payload, ref: RUN });
  assert.equal(first.projection.seq, 1);
  assert.equal(first.projection.rows["R-0001"].status, "open");

  const { ctx: later } = makeCtx(ctx.root, { now: "2026-09-17T00:00:00Z", actor: "reviewer" });
  const second = await append(later, addArgs("second", "R-0002"));
  assert.equal(second.event.seq, 2);
  assert.equal(second.event.prev_sha256, eventSha256(first.event));
  assert.equal(second.event.ts, "2026-09-17T00:00:00Z");
  assert.equal(second.event.actor, "reviewer");

  const stored = lines(paths.events);
  assert.equal(stored.length, 2);
  assert.equal(stored[0], canonical(first.event).toString("utf8"));
  assert.equal(stored[1], canonical(second.event).toString("utf8"));
  assert.ok(readFileSync(paths.events, "utf8").endsWith("\n"));
  const onDisk = parseStrict(readFileSync(paths.projection));
  assert.deepEqual(onDisk, second.projection);
  assert.deepEqual(onDisk, foldReplay(readEvents(ctx), "eng-2026-001"));
  assert.equal(readEvents(ctx).length, 2);
});

test("interrupted append ⇒ rebuild (US-020 AC-2): a log line whose projection write never happened is replayed on the next open", async () => {
  const { ctx, paths, stderr } = await seeded(["a", "b"]);
  const events = readEvents(ctx);
  const third = { seq: 3, prev_sha256: eventSha256(events[1]), ts: NOW, actor: "lead", ...addArgs("c", "R-0003") };
  writeFileSync(paths.events, `${readFileSync(paths.events, "utf8")}${canonical(third).toString("utf8")}\n`);
  assert.equal(parseStrict(readFileSync(paths.projection)).seq, 2, "projection is behind");

  const reg = await openRegister(ctx);
  assert.equal(reg.rebuilt, true);
  assert.equal(reg.projection.seq, 3);
  assert.equal(parseStrict(readFileSync(paths.projection)).seq, 3, "rebuilt on disk");
  assert.deepEqual(Object.keys(reg.projection.rows), ["R-0001", "R-0002", "R-0003"]);
  assert.equal(stderr.text, "", "a rebuild is normal, not a diagnostic");
});

test("projection ahead of log ⇒ exit 5 CORRUPT and nothing written", async () => {
  const { ctx, paths, stderr } = await seeded(["a", "b", "c"]);
  writeFileSync(paths.events, `${lines(paths.events).slice(0, 2).join("\n")}\n`);
  const before = snapshot(paths.dir);

  await assert.rejects(openRegister(ctx), isCorrupt);
  assert.match(stderr.text, /projection.*ahead|ahead of the log/i, "the reason goes to stderr");
  assert.deepEqual(snapshot(paths.dir), before, "nothing under register/ changed");
  assert.ok(!existsSync(paths.lock));

  await assert.rejects(append(ctx, addArgs("d", "R-0004")), isCorrupt);
  assert.deepEqual(snapshot(paths.dir), before, "append writes nothing on a corrupt register");
  await assert.rejects(rebuildProjection(ctx), isCorrupt, "replay --write cannot paper over a truncated log");
  assert.deepEqual(snapshot(paths.dir), before);
});

test("prev_sha256 mismatch ⇒ CORRUPT (AC-3); so do a partial last line, an edited projection at the same seq and an unparseable projection", async () => {
  const { ctx, paths } = await seeded(["a", "b", "c"]);
  const good = readFileSync(paths.events, "utf8");
  const goodProjection = readFileSync(paths.projection);

  const events = lines(paths.events).map((l) => parseStrict(l));
  events[1].prev_sha256 = "1".repeat(64);
  writeFileSync(paths.events, `${events.map((e) => canonical(e).toString("utf8")).join("\n")}\n`);
  await assert.rejects(openRegister(ctx), isCorrupt);
  assert.throws(() => readEvents(ctx), isCorrupt, "readEvents runs the same chain check");
  assert.equal(readFileSync(paths.projection).equals(goodProjection), true, "projection untouched");

  writeFileSync(paths.events, good.slice(0, -10));
  await assert.rejects(openRegister(ctx), isCorrupt, "a partial last line is not an interrupted projection write");

  writeFileSync(paths.events, good);
  const edited = parseStrict(goodProjection);
  edited.rows["R-0001"].priority = "p3";
  writeFileSync(paths.projection, canonical(edited));
  await assert.rejects(openRegister(ctx), isCorrupt, "same seq, different content");
  assert.ok(readFileSync(paths.projection).equals(canonical(edited)), "the edited projection is left for inspection, not overwritten");

  writeFileSync(paths.projection, "{not json");
  await assert.rejects(openRegister(ctx), isCorrupt);

  writeFileSync(paths.projection, goodProjection);
  assert.equal((await openRegister(ctx)).rebuilt, false, "restored ⇒ healthy");
});

test("anchor print then verify ⇒ MATCH (AC-4); the anchor is <engagement_id>:<seq>:<chain_sha256>", async () => {
  const { ctx } = await seeded(["a", "b"]);
  const reg = await openRegister(ctx);
  const a = anchor(reg.projection);
  assert.equal(a, `eng-2026-001:2:${reg.projection.chain_sha256}`);
  assert.equal(anchorVerify((await openRegister(ctx)).projection, a), "MATCH");
  assert.deepEqual(verifyChain(reg.events), { seq: 2, chain_sha256: reg.projection.chain_sha256 });
});

test("truncated log + projection vs anchor verify ⇒ TRUNCATED", async () => {
  const { ctx, paths } = await seeded(["a", "b", "c"]);
  const expect = anchor((await openRegister(ctx)).projection);
  // Both files shortened together (a projection ahead of the log is CORRUPT, tested above).
  writeFileSync(paths.events, `${lines(paths.events).slice(0, 2).join("\n")}\n`);
  writeFileSync(paths.projection, canonical(foldReplay(readEvents(ctx), "eng-2026-001")));
  const reg = await openRegister(ctx);
  assert.equal(reg.projection.seq, 2);
  assert.equal(anchorVerify(reg.projection, expect), "TRUNCATED");
});

test("rewritten event ⇒ DIVERGED: a re-chained log of the same length is internally valid but is not the anchored register", async () => {
  const { ctx, paths } = await seeded(["a", "b", "c"]);
  const expect = anchor((await openRegister(ctx)).projection);
  const events = readEvents(ctx);
  events[0].payload.title = "A (rewritten)";
  let prev = GENESIS_SHA256;
  for (const e of events) {
    e.prev_sha256 = prev;
    prev = eventSha256(e);
  }
  writeFileSync(paths.events, `${events.map((e) => canonical(e).toString("utf8")).join("\n")}\n`);
  writeFileSync(paths.projection, canonical(foldReplay(events, "eng-2026-001")));
  const reg = await openRegister(ctx);
  assert.equal(reg.rebuilt, false, "the rewritten register is self-consistent");
  assert.equal(anchorVerify(reg.projection, expect), "DIVERGED");
});

test("replay is deterministic (AC-5): rebuildProjection twice ⇒ byte-identical projection.json; equals canonical(replay(events))", async () => {
  const { ctx, paths } = await seeded(["a", "b"]);
  const one = await rebuildProjection(ctx);
  const bytesOne = readFileSync(paths.projection);
  const two = await rebuildProjection(ctx);
  const bytesTwo = readFileSync(paths.projection);
  assert.ok(bytesOne.equals(bytesTwo));
  assert.ok(bytesOne.equals(canonical(replay(readEvents(ctx), "eng-2026-001"))));
  assert.deepEqual(one.projection, two.projection);
  assert.equal(one.written, true);
});

test("append uses O_APPEND under lock; projection rewritten tmp+rename (AC-1)", async () => {
  const repo = repoWithEngagement();
  const paths = registerPaths(makeCtx(repo).ctx);
  const seenLock = [];
  // ctx.now() is read inside the critical section: the lock dir must exist at that moment.
  const s = streams();
  const ctx = createContext({ root: repo, actor: "lead" }, { cwd: repo, env: {}, ...s });
  const spying = Object.freeze({ ...ctx, now: () => { seenLock.push(existsSync(paths.lock)); return NOW; } });

  await append(spying, addArgs("first", "R-0001"));
  const logAfterOne = readFileSync(paths.events);
  const inoOne = statSync(paths.projection).ino;
  await append(spying, addArgs("second", "R-0002"));
  const logAfterTwo = readFileSync(paths.events);
  assert.deepEqual(seenLock, [true, true], "ts is taken while the lock is held");
  assert.ok(!existsSync(paths.lock));
  assert.ok(logAfterTwo.subarray(0, logAfterOne.length).equals(logAfterOne), "the log only grows: the first line's bytes are untouched");
  assert.equal(lines(paths.events).length, 2);
  assert.notEqual(statSync(paths.projection).ino, inoOne, "projection.json is a new inode (rename), not rewritten in place");
  assert.deepEqual(readdirSync(paths.dir).sort(), ["events.jsonl", "projection.json"], "no tmp or lock residue");

  // The primitives are fsx's — appendLine (one writeSync on an `a` fd), writeAtomic (tmp + rename), withLock (mkdir mutex).
  const fsxImport = SELF.match(/import \{([^}]*)\} from "\.\/fsx\.mjs"/);
  assert.ok(fsxImport, "register-core imports from fsx.mjs");
  const names = fsxImport[1].split(",").map((n) => n.trim()).sort();
  assert.deepEqual(names, ["appendLine", "withLock", "writeAtomic"]);
  const nodeFs = SELF.match(/import \{([^}]*)\} from "node:fs"/);
  const fsNames = nodeFs ? nodeFs[1].split(",").map((n) => n.trim()) : [];
  for (const n of fsNames) assert.ok(/^(readFileSync|mkdirSync)$/.test(n), `node:fs import ${n} is read-only or mkdir; every write goes through fsx`);
  for (const banned of ["node:child_process", "git.mjs", "Date.now", "new Date", "Math.random"]) assert.ok(!SELF.includes(banned), `register-core.mjs must not reference ${banned}`);
});

test("append redacts before hashing and writing (G-4): no original bytes under register/, the chain is over the redacted line", async () => {
  const { ctx, paths } = await seeded([]);
  const r = await append(ctx, addArgs("password=hunter2 in config", "R-0001"));
  assert.match(r.event.payload.title, /<REDACTED:password-assign>/);
  const log = readFileSync(paths.events, "utf8");
  assert.ok(!log.includes("hunter2"));
  assert.ok(!readFileSync(paths.projection, "utf8").includes("hunter2"));
  assert.equal(eventSha256(parseStrict(lines(paths.events)[0])), r.projection.chain_sha256);
});

test("append refuses an event the fold rejects before touching the log", async () => {
  const { ctx, paths } = await seeded(["a"]);
  const before = snapshot(paths.dir);
  await assert.rejects(append(ctx, { row_id: "R-0001", event: "add", payload: addArgs("dup").payload, ref: RUN }), (e) => e instanceof TransitionError && e.from === "open");
  await assert.rejects(append(ctx, { row_id: "R-0001", event: "accept", payload: {}, ref: RUN }), TransitionError);
  assert.deepEqual(snapshot(paths.dir), before);
  for (const bad of [{ row_id: "", event: "add", payload: {}, ref: RUN }, { row_id: "R-0002", event: "", payload: {}, ref: RUN }, { row_id: "R-0002", event: "add", payload: [], ref: RUN }, { row_id: "R-0002", event: "add", payload: {}, ref: 1 }]) {
    await assert.rejects(append(ctx, bad), TypeError);
  }
  assert.deepEqual(snapshot(paths.dir), before);
});
