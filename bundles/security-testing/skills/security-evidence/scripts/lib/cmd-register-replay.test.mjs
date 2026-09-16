// TASK-028 — `register.mjs replay [--write]` (plan §4.3): rebuild the projection from the log.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, parseStrict } from "../canon.mjs";
import { cleanupAll, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { TEMPLATE_PATHS } from "./engagement.mjs";

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

test("replay prints REPLAY seq=<n> rows=<n> chain=<sha>; --write persists and prints PROJECTION <rel path>", async () => {
  const { repo, dir } = await seeded(["a", "b"]);
  const projection = parseStrict(readFileSync(join(dir, "projection.json")));
  const r = await runScript("register", ["replay"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `REPLAY seq=2 rows=2 chain=${projection.chain_sha256}\n`);

  const bytesBefore = readFileSync(join(dir, "projection.json"));
  const w = await runScript("register", ["replay", "--write"], { cwd: repo, env: ENV });
  assert.equal(w.code, 0, w.stderr);
  assert.equal(w.stdout, `REPLAY seq=2 rows=2 chain=${projection.chain_sha256}\nPROJECTION .agents/security-testing/register/projection.json\n`);
  assert.ok(readFileSync(join(dir, "projection.json")).equals(bytesBefore), "byte-identical projection (AC-5)");
});

test("a missing or behind projection is rebuilt by replay (and by every other command); an ahead projection is CORRUPT", async () => {
  const { repo, dir } = await seeded(["a", "b", "c"]);
  const good = readFileSync(join(dir, "projection.json"));
  rmSync(join(dir, "projection.json"));
  const r = await runScript("register", ["replay"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(readFileSync(join(dir, "projection.json")).equals(good), "rebuilt from the log, byte-identical");

  const [first] = lines(join(dir, "events.jsonl"));
  writeFileSync(join(dir, "events.jsonl"), `${first}\n`);
  const c = await runScript("register", ["replay", "--write"], { cwd: repo, env: ENV });
  assert.equal(c.code, 5);
  assert.equal(c.stdout, "CORRUPT\n");
  assert.ok(readFileSync(join(dir, "projection.json")).equals(good), "nothing written");
});

test("an empty register replays to seq 0 with the genesis chain", async () => {
  const { repo } = await seeded([]);
  const r = await runScript("register", ["replay"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `REPLAY seq=0 rows=0 chain=${"0".repeat(64)}\n`);
});

test("usage: unknown flag or a positional ⇒ exit 2", async () => {
  const { repo } = await seeded([]);
  for (const argv of [["replay", "--nope"], ["replay", "extra"]]) {
    const r = await runScript("register", argv, { cwd: repo, env: ENV });
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, /^USAGE\(replay: /);
  }
});

test("the written projection is canonical bytes (what canon.canonical yields for the replayed projection)", async () => {
  const { repo, dir } = await seeded(["a"]);
  await runScript("register", ["replay", "--write"], { cwd: repo, env: ENV });
  const bytes = readFileSync(join(dir, "projection.json"));
  assert.ok(bytes.equals(canonical(parseStrict(bytes))));
});
