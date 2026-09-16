// TASK-028 — `register.mjs anchor print | anchor verify --expect <eid:seq:hash>` (spec §6.8).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, parseStrict } from "../canon.mjs";
import { cleanupAll, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { TEMPLATE_PATHS } from "./engagement.mjs";
import { GENESIS_SHA256, eventSha256, replay } from "./register-fold.mjs";

after(cleanupAll);

const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const RUN = "0123456789ab-0001";
const add = (title) => ["add", "--subject", "f".repeat(64), "--priority", "p1", "--title", title, "--run", RUN];

async function seeded(titles) {
  const repo = initRepo();
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  for (const t of titles) {
    const r = await runScript("register", add(t), { cwd: repo, env: ENV });
    assert.equal(r.code, 0, r.stderr);
  }
  return { repo, dir: join(st, "register") };
}

const lines = (path) => readFileSync(path, "utf8").split("\n").filter((l) => l !== "");
const events = (dir) => lines(join(dir, "events.jsonl")).map((l) => parseStrict(l));

test("anchor print ⇒ <engagement_id>:<seq>:<chain_sha256>, bare, unredacted; anchor verify --expect <that> ⇒ MATCH (AC-4)", async () => {
  const { repo, dir } = await seeded(["a", "b"]);
  const projection = parseStrict(readFileSync(join(dir, "projection.json")));
  const p = await runScript("register", ["anchor", "print"], { cwd: repo, env: ENV });
  assert.equal(p.code, 0, p.stderr);
  assert.equal(p.stdout, `eng-2026-001:2:${projection.chain_sha256}\n`);
  assert.equal(p.stderr, "");

  const v = await runScript("register", ["anchor", "verify", "--expect", p.stdout.trim()], { cwd: repo, env: ENV });
  assert.equal(v.code, 0, v.stderr);
  assert.equal(v.stdout, "MATCH\n");
});

test("an empty register anchors at seq 0 with the genesis hash", async () => {
  const { repo } = await seeded([]);
  const p = await runScript("register", ["anchor", "print"], { cwd: repo, env: ENV });
  assert.equal(p.stdout, `eng-2026-001:0:${GENESIS_SHA256}\n`);
});

test("truncated log + projection vs anchor verify ⇒ TRUNCATED, exit 5", async () => {
  const { repo, dir } = await seeded(["a", "b", "c"]);
  const expect = (await runScript("register", ["anchor", "print"], { cwd: repo, env: ENV })).stdout.trim();
  const kept = events(dir).slice(0, 2);
  writeFileSync(join(dir, "events.jsonl"), `${kept.map((e) => canonical(e).toString("utf8")).join("\n")}\n`);
  writeFileSync(join(dir, "projection.json"), canonical(replay(kept, "eng-2026-001")));
  const v = await runScript("register", ["anchor", "verify", "--expect", expect], { cwd: repo, env: ENV });
  assert.equal(v.code, 5);
  assert.equal(v.stdout, "TRUNCATED\n");
});

test("rewritten event ⇒ DIVERGED, exit 5", async () => {
  const { repo, dir } = await seeded(["a", "b", "c"]);
  const expect = (await runScript("register", ["anchor", "print"], { cwd: repo, env: ENV })).stdout.trim();
  const all = events(dir);
  all[1].payload.title = "b (rewritten)";
  let prev = GENESIS_SHA256;
  for (const e of all) {
    e.prev_sha256 = prev;
    prev = eventSha256(e);
  }
  writeFileSync(join(dir, "events.jsonl"), `${all.map((e) => canonical(e).toString("utf8")).join("\n")}\n`);
  writeFileSync(join(dir, "projection.json"), canonical(replay(all, "eng-2026-001")));
  const v = await runScript("register", ["anchor", "verify", "--expect", expect], { cwd: repo, env: ENV });
  assert.equal(v.code, 5);
  assert.equal(v.stdout, "DIVERGED\n");

  // A register that advanced past the anchor is not the anchored state either: print a fresh anchor after the last change.
  const { repo: grown } = await seeded(["a", "b", "c"]);
  const older = (await runScript("register", ["anchor", "print"], { cwd: grown, env: ENV })).stdout.trim();
  await runScript("register", add("d"), { cwd: grown, env: ENV });
  const g = await runScript("register", ["anchor", "verify", "--expect", older], { cwd: grown, env: ENV });
  assert.equal(g.code, 5);
  assert.equal(g.stdout, "DIVERGED\n");
});

test("anchor verify on a corrupt register ⇒ CORRUPT before any comparison", async () => {
  const { repo, dir } = await seeded(["a", "b"]);
  const expect = (await runScript("register", ["anchor", "print"], { cwd: repo, env: ENV })).stdout.trim();
  const [first] = lines(join(dir, "events.jsonl"));
  writeFileSync(join(dir, "events.jsonl"), `${first}\n`); // projection ahead
  const v = await runScript("register", ["anchor", "verify", "--expect", expect], { cwd: repo, env: ENV });
  assert.equal(v.code, 5);
  assert.equal(v.stdout, "CORRUPT\n");
});

test("usage: missing subcommand, unknown subcommand, verify without --expect or with a malformed anchor ⇒ exit 2", async () => {
  const { repo } = await seeded([]);
  const cases = [
    [["anchor"], /print \| verify/],
    [["anchor", "nope"], /print \| verify/],
    [["anchor", "verify"], /--expect/],
    [["anchor", "verify", "--expect", "garbage"], /--expect/],
    [["anchor", "print", "--expect", "x:1:" + "a".repeat(64)], /--expect/],
    [["anchor", "print", "extra"], /unexpected/],
  ];
  for (const [argv, re] of cases) {
    const r = await runScript("register", argv, { cwd: repo, env: ENV });
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, /^USAGE\(anchor: /, argv.join(" "));
    assert.match(r.stdout, re, argv.join(" "));
  }
});
