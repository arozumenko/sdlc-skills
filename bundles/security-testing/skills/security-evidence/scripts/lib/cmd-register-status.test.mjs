// TASK-028 — `register.mjs status [--json]` (plan §4.3). Assertions are
// deliberately minimal: with only `add` in the fold every row is `open`;
// TASK-029 adds the approval and exposure cases over the full table.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrict } from "../canon.mjs";
import { cleanupAll, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { TEMPLATE_PATHS } from "./engagement.mjs";

after(cleanupAll);

const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const RUN = "0123456789ab-0001";
const add = (title, priority) => ["add", "--subject", "f".repeat(64), "--priority", priority, "--title", title, "--run", RUN];

async function seeded(rows) {
  const repo = initRepo();
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  for (const [t, p] of rows) {
    const r = await runScript("register", add(t, p), { cwd: repo, env: ENV });
    assert.equal(r.code, 0, r.stderr);
  }
  return { repo, dir: join(st, "register") };
}

test("status: counts by status × priority, OPEN-EXPOSURE, APPROVALS unauthenticated=<n>", async () => {
  const { repo } = await seeded([["a", "p0"], ["b", "p1"], ["c", "p1"]]);
  const r = await runScript("register", ["status"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(
    r.stdout,
    [
      "STATUS rows=3 seq=3",
      "OPEN-EXPOSURE p0=1 p1=2 p2=0 p3=0",
      "APPROVALS unauthenticated=0",
      "COUNT open p0=1 p1=2 p2=0 p3=0",
      "COUNT accepted p0=0 p1=0 p2=0 p3=0",
      "COUNT fixed p0=0 p1=0 p2=0 p3=0",
      "COUNT regressed p0=0 p1=0 p2=0 p3=0",
      "COUNT false-positive p0=0 p1=0 p2=0 p3=0",
      "COUNT superseded p0=0 p1=0 p2=0 p3=0",
      "",
    ].join("\n"),
  );
});

test("status --json = {counts, open_exposure, unauthenticated_approvals, rows} on one line", async () => {
  const { repo, dir } = await seeded([["a", "p2"]]);
  const r = await runScript("register", ["status", "--json"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout.split("\n");
  assert.equal(out.length, 2, "one JSON line");
  const json = parseStrict(out[0]);
  assert.deepEqual(Object.keys(json), ["counts", "open_exposure", "unauthenticated_approvals", "rows"]);
  assert.deepEqual(json.open_exposure, { p0: 0, p1: 0, p2: 1, p3: 0 });
  assert.equal(json.unauthenticated_approvals, 0);
  assert.deepEqual(json.counts.open, { p0: 0, p1: 0, p2: 1, p3: 0 });
  assert.deepEqual(json.rows, parseStrict(readFileSync(join(dir, "projection.json"))).rows);
});

test("status on an empty register; status runs the recovery rule (behind ⇒ rebuilt, ahead ⇒ CORRUPT)", async () => {
  const { repo, dir } = await seeded([]);
  const r = await runScript("register", ["status"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^STATUS rows=0 seq=0\n/);

  await runScript("register", add("a", "p3"), { cwd: repo, env: ENV });
  const { rmSync, writeFileSync } = await import("node:fs");
  rmSync(join(dir, "projection.json"));
  const rebuilt = await runScript("register", ["status"], { cwd: repo, env: ENV });
  assert.equal(rebuilt.code, 0);
  assert.match(rebuilt.stdout, /^STATUS rows=1 seq=1\n/);
  assert.equal(parseStrict(readFileSync(join(dir, "projection.json"))).seq, 1);

  writeFileSync(join(dir, "events.jsonl"), "");
  const corrupt = await runScript("register", ["status"], { cwd: repo, env: ENV });
  assert.equal(corrupt.code, 5);
  assert.equal(corrupt.stdout, "CORRUPT\n");
});

test("usage: unknown flag or a positional ⇒ exit 2", async () => {
  const { repo } = await seeded([]);
  for (const argv of [["status", "--nope"], ["status", "extra"]]) {
    const r = await runScript("register", argv, { cwd: repo, env: ENV });
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, /^USAGE\(status: /);
  }
});
