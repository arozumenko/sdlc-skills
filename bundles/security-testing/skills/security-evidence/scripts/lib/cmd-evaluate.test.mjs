// TASK-026 — `verify.mjs evaluate <verify.json> | --raw <json>` (plan §4.2):
// pure over its input, JSON on stdout, exit 0; 2 on malformed input; 5 when a
// verify.json fails its own self_sha256 (readArtifact IntegrityError).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { run, USAGE } from "./cmd-evaluate.mjs";
import { evaluate } from "./evaluate.mjs";
import { readArtifact } from "../canon.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY_FIXTURES = join(HERE, "..", "fixtures", "verify");
const SELF = readFileSync(join(HERE, "cmd-evaluate.mjs"), "utf8");

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "cmd-evaluate-"));
  tmpDirs.push(d);
  return d;
}

function fakeCtx() {
  const out = [];
  const log = [];
  return { ctx: { out: (s) => out.push(s), log: (s) => log.push(s) }, out, log };
}

const verifyFixtures = () => readdirSync(VERIFY_FIXTURES).filter((f) => f.endsWith(".json")).sort();

test("file input: prints evaluate() of the payload minus evaluation, exit 0", async () => {
  const files = verifyFixtures();
  assert.ok(files.length > 0, "built verify fixtures present");
  for (const f of files) {
    const path = join(VERIFY_FIXTURES, f);
    const { ctx, out, log } = fakeCtx();
    const code = await run([path], ctx);
    assert.equal(code, 0, `${f}: exit`);
    assert.equal(out.length, 1, `${f}: exactly one stdout line`);
    assert.deepEqual(log, [], `${f}: no stderr`);
    const printed = JSON.parse(out[0]);
    const { evaluation, ...raw } = readArtifact(path, { kind: "verify" }).payload;
    assert.deepEqual(printed, evaluate(raw), `${f}: matches evaluate()`);
    assert.deepEqual(printed, evaluation, `${f}: matches the stored evaluation`);
    assert.deepEqual(Object.keys(printed), ["verdict", "refound_observed", "ack_refs", "events"]);
  }
});

test("--raw <json>: evaluates the inline payload, exit 0", async () => {
  const path = join(VERIFY_FIXTURES, verifyFixtures()[0]);
  const { evaluation, ...raw } = readArtifact(path).payload;
  const { ctx, out } = fakeCtx();
  assert.equal(await run(["--raw", JSON.stringify(raw)], ctx), 0);
  assert.deepEqual(JSON.parse(out[0]), evaluation);
});

test("--raw with an incomplete payload still evaluates (indeterminate is a verdict, not an error)", async () => {
  const { ctx, out } = fakeCtx();
  assert.equal(await run(["--raw", '{"row_status_at_start":"open"}'], ctx), 0);
  assert.equal(JSON.parse(out[0]).verdict, "UNVERIFIED-INDETERMINATE(branch)");
});

test("malformed ⇒ exit 2, diagnostics on stderr, nothing on stdout", async () => {
  const dir = tmp();
  const notJson = join(dir, "x.json");
  writeFileSync(notJson, "{not json");
  const dup = join(dir, "dup.json");
  writeFileSync(dup, '{"a":1,"a":2}');
  const notArtifact = join(dir, "plain.json");
  writeFileSync(notArtifact, '{"branch":"COMMITTED"}');
  const cases = [
    [[], "no argument"],
    [["--raw"], "--raw without value"],
    [["--raw", "{not json"], "--raw not json"],
    [["--raw", "[1,2]"], "--raw not an object"],
    [["--raw", '{"a":1.5}'], "--raw float"],
    [[notJson], "file not json"],
    [[dup], "duplicate key"],
    [[notArtifact], "file without envelope"],
    [[join(dir, "missing.json")], "file absent"],
    [["--raw", "{}", "extra"], "extra positional"],
    [["--bogus", "{}"], "unknown flag"],
  ];
  for (const [argv, label] of cases) {
    const { ctx, out, log } = fakeCtx();
    assert.equal(await run(argv, ctx), 2, label);
    assert.deepEqual(out, [], `${label}: stdout empty`);
    assert.ok(log.length >= 1, `${label}: stderr diagnostic`);
  }
});

test("--help ⇒ usage on stdout, exit 0", async () => {
  const { ctx, out } = fakeCtx();
  assert.equal(await run(["--help"], ctx), 0);
  assert.equal(out.join("\n"), USAGE);
  assert.match(USAGE, /evaluate/);
});

test("tampered verify.json ⇒ exit 5 (integrity), nothing on stdout", async () => {
  const dir = tmp();
  const src = join(VERIFY_FIXTURES, verifyFixtures()[0]);
  const artifact = JSON.parse(readFileSync(src, "utf8"));
  artifact.payload.row_status_at_start = "superseded";
  const path = join(dir, "verify.json");
  writeFileSync(path, JSON.stringify(artifact));
  const { ctx, out, log } = fakeCtx();
  assert.equal(await run([path], ctx), 5);
  assert.deepEqual(out, []);
  assert.match(log.join("\n"), /self_sha256/);
});

test("wrong kind ⇒ exit 5", async () => {
  const dir = tmp();
  const src = join(VERIFY_FIXTURES, verifyFixtures()[0]);
  const artifact = JSON.parse(readFileSync(src, "utf8"));
  artifact.envelope.kind = "scope";
  const path = join(dir, "verify.json");
  writeFileSync(path, JSON.stringify(artifact));
  const { ctx, out } = fakeCtx();
  assert.equal(await run([path], ctx), 5);
  assert.deepEqual(out, []);
});

test("no git, no child process, no network, no console; stdout only via ctx.out", () => {
  for (const banned of ["node:child_process", "child_process", "git.mjs", "node:http", "node:https", "node:net", "node:dns", "fetch(", "console."]) {
    assert.ok(!SELF.includes(banned), `cmd-evaluate.mjs must not reference ${banned}`);
  }
});
