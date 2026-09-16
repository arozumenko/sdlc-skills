// TASK-028 — `register.mjs add` (plan §4.3 row `add`): a new row R-nnnn, status open.
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
const FINDING = "f".repeat(64);
const BASE = ["add", "--subject", FINDING, "--priority", "p1", "--title", "SQL built from request input", "--run", RUN];

function repoWithEngagement() {
  const repo = initRepo();
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  return repo;
}

const registerDir = (repo) => join(repo, ".agents", "security-testing", "register");
const lines = (path) => readFileSync(path, "utf8").split("\n").filter((l) => l !== "");

test("add ⇒ ROW R-0001 status=open priority=p1 seq=1; the event and the projection land under <st>/register/", async () => {
  const repo = repoWithEngagement();
  const r = await runScript("register", BASE, { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "ROW R-0001 status=open priority=p1 seq=1\n");
  assert.equal(r.stderr, "");

  const [line] = lines(join(registerDir(repo), "events.jsonl"));
  const event = parseStrict(line);
  assert.deepEqual(event, {
    seq: 1,
    prev_sha256: "0".repeat(64),
    ts: "2026-09-16T10:00:00Z",
    actor: "lead",
    row_id: "R-0001",
    event: "add",
    payload: { subject: FINDING, subject_kind: "finding", title: "SQL built from request input", priority: "p1", owner: "", first_seen_run: RUN },
    ref: RUN,
  });
  const projection = parseStrict(readFileSync(join(registerDir(repo), "projection.json")));
  assert.equal(projection.engagement_id, "eng-2026-001");
  assert.equal(projection.seq, 1);
  assert.equal(projection.rows["R-0001"].status, "open");
  assert.equal(projection.rows["R-0001"].title, "SQL built from request input");

  const second = await runScript("register", ["add", "--subject", "T-001", "--priority", "p0", "--title", "Spoofed callback", "--run", RUN, "--owner", "team-payments"], { cwd: repo, env: ENV });
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.stdout, "ROW R-0002 status=open priority=p0 seq=2\n");
  const after2 = parseStrict(readFileSync(join(registerDir(repo), "projection.json")));
  assert.equal(after2.rows["R-0002"].subject_kind, "threat");
  assert.equal(after2.rows["R-0002"].owner, "team-payments");
  assert.equal(lines(join(registerDir(repo), "events.jsonl")).length, 2);
});

test("--actor / SECURITY_EVIDENCE_ACTOR / unknown, in that order, become the event's actor", async () => {
  const repo = repoWithEngagement();
  await runScript("register", ["--actor", "cli-actor", ...BASE], { cwd: repo, env: ENV });
  await runScript("register", BASE, { cwd: repo, env: { SECURITY_EVIDENCE_NOW: ENV.SECURITY_EVIDENCE_NOW } });
  const [a, b] = lines(join(registerDir(repo), "events.jsonl")).map((l) => parseStrict(l));
  assert.equal(a.actor, "cli-actor");
  assert.equal(b.actor, "unknown");
});

test("usage: every required flag, priority enum, subject shape, run_id shape ⇒ exit 2 USAGE(add: …) and nothing written", async () => {
  const repo = repoWithEngagement();
  const cases = [
    [["add"], /--subject/],
    [["add", "--subject", FINDING], /--priority/],
    [["add", "--subject", FINDING, "--priority", "p1"], /--title/],
    [["add", "--subject", FINDING, "--priority", "p1", "--title", "t"], /--run/],
    [["add", "--subject", FINDING, "--priority", "p9", "--title", "t", "--run", RUN], /--priority/],
    [["add", "--subject", "not-an-id", "--priority", "p1", "--title", "t", "--run", RUN], /--subject/],
    [["add", "--subject", FINDING, "--priority", "p1", "--title", "t", "--run", "nope"], /--run/],
    [["add", "--subject", FINDING, "--priority", "p1", "--title", "t", "--run", RUN, "extra"], /unexpected/],
    [["add", "--subject", FINDING, "--priority", "p1", "--title", "t", "--run", RUN, "--nope"], /unknown flag/],
  ];
  for (const [argv, re] of cases) {
    const r = await runScript("register", argv, { cwd: repo, env: ENV });
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, /^USAGE\(add: /, argv.join(" "));
    assert.match(r.stdout, re, argv.join(" "));
  }
  assert.throws(() => readFileSync(join(registerDir(repo), "events.jsonl")), /ENOENT/, "no log was started");
});

test("without engagement.md ⇒ exit 2 ENGAGEMENT-MISSING", async () => {
  const repo = initRepo();
  const r = await runScript("register", BASE, { cwd: repo, env: ENV });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "ENGAGEMENT-MISSING\n");
});

test("the title is redacted before it is hashed or stored (G-4)", async () => {
  const repo = repoWithEngagement();
  const r = await runScript("register", ["add", "--subject", FINDING, "--priority", "p2", "--title", "hard-coded password=hunter2", "--run", RUN], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  for (const name of ["events.jsonl", "projection.json"]) {
    const text = readFileSync(join(registerDir(repo), name), "utf8");
    assert.ok(!text.includes("hunter2"), name);
    assert.ok(text.includes("<REDACTED:password-assign>"), name);
  }
});

test("a corrupt register refuses add with exit 5 CORRUPT", async () => {
  const repo = repoWithEngagement();
  await runScript("register", BASE, { cwd: repo, env: ENV });
  await runScript("register", BASE, { cwd: repo, env: ENV });
  const log = join(registerDir(repo), "events.jsonl");
  const [first] = lines(log);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(log, `${first}\n`); // projection is now ahead
  const r = await runScript("register", BASE, { cwd: repo, env: ENV });
  assert.equal(r.code, 5);
  assert.equal(r.stdout, "CORRUPT\n");
  assert.equal(lines(log).length, 1, "nothing appended");
});
