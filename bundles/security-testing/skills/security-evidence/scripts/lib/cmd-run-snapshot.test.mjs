// TASK-058 — `evidence.mjs run snapshot register | verify | proposals` (plan
// §4.1 rows `run snapshot *`, §5 TASK-058; spec P2, §6.3, TL-3, G-10, G-16).
// The only way a cross-run or cross-tree artifact enters an assessment run
// directory. Every repo is built in a temp dir by the CLI harness (G-12); the
// verify sources are TASK-026's hash-consistent fixtures planted as fake
// COMMITTED verify runs, with the marker in TASK-023's format (manifest
// sha256 hex + one LF).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { redactString } from "../redact.mjs";
import { cleanupAll, git, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { TEMPLATE_PATHS } from "./engagement.mjs";
import { ensureKey } from "./keys.mjs";
import { verifyChain } from "./register-fold.mjs";
import { verifyAliasChain } from "./register-transitions.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY_FIXTURES = join(HERE, "..", "fixtures", "verify");
const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const ST = join(".agents", "security-testing");
const FINDING = "f".repeat(64);
const FINDING_B = "e".repeat(64);
const SHA256 = /^[0-9a-f]{64}$/;

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

/** A committed repo with the ignore block, the template engagement.md and the engagement's key — what `engagement init` leaves behind. */
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

const evidence = (repo, argv) => runScript("evidence", argv, { cwd: repo, env: ENV });
const register = (repo, argv) => runScript("register", argv, { cwd: repo, env: ENV });
const runDir = (repo, run_id) => join(repo, ST, "runs", run_id);
const registerDir = (repo) => join(repo, ST, "register");
const proposalsDir = (repo) => join(repo, ST, "proposals");

/** TASK-023's marker: the manifest sha256 hex plus one LF. */
const commitRun = (dir) => writeFileSync(join(dir, "COMMITTED"), `${sha256Hex(Buffer.from("fake manifest bytes", "utf8"))}\n`);

async function initRun(repo, kind, extra = []) {
  const r = await evidence(repo, ["run", "init", "--kind", kind, ...extra]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const m = /^RUN ([0-9a-f]{12}-[0-9]{4}) /.exec(r.stdout);
  assert.ok(m, r.stdout);
  return m[1];
}

const assessmentRun = (repo) => initRun(repo, "assessment");
const reviewRun = (repo) => initRun(repo, "review", ["--base", "HEAD"]);

async function seedRegister(repo, run_id, titles) {
  for (const title of titles) {
    const r = await register(repo, ["add", "--subject", FINDING, "--priority", "p1", "--title", title, "--run", run_id]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
  }
}

const lines = (path) => readFileSync(path, "utf8").split("\n").filter((l) => l !== "");
const readLog = (repo) => lines(join(registerDir(repo), "events.jsonl")).map((l) => parseStrict(l));
const readAliasLog = (repo) => lines(join(registerDir(repo), "finding-alias.jsonl")).map((l) => parseStrict(l));

/**
 * Plant TASK-026's `verify/<rule>.json` as a fake verify run `runs/<vid>/`
 * with its packet, every receipt the payload lists and (transitively) every
 * packet a receipt names; `committed` adds the marker.
 * @returns {{vid: string, verify: object, packets: string[], receipts: string[]}}
 */
function plantVerifyRun(repo, rule, { committed = true } = {}) {
  const src = join(VERIFY_FIXTURES, `${rule}.json`);
  const verify = readArtifact(src, { kind: "verify" });
  const vid = verify.envelope.run_id;
  const dir = runDir(repo, vid);
  mkdirSync(join(dir, "packets"), { recursive: true });
  mkdirSync(join(dir, "receipts"), { recursive: true });
  copyFileSync(src, join(dir, "verify.json"));
  const packets = new Set([verify.payload.packet_sha256]);
  const receipts = [];
  for (const { sha256 } of verify.payload.receipts) {
    receipts.push(sha256);
    copyFileSync(join(VERIFY_FIXTURES, "receipts", `${sha256}.json`), join(dir, "receipts", `${sha256}.json`));
    packets.add(readArtifact(join(VERIFY_FIXTURES, "receipts", `${sha256}.json`), { kind: "receipt" }).payload.packet_sha256);
  }
  for (const sha of packets) copyFileSync(join(VERIFY_FIXTURES, "packets", `${sha}.json`), join(dir, "packets", `${sha}.json`));
  if (committed) commitRun(dir);
  return { vid, verify, packets: [...packets].sort(), receipts: receipts.sort() };
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

test("register snapshot equals the events log; corrupt register ⇒ exit 5 and nothing written", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  await seedRegister(repo, run_id, ["SQL built from request input", "Path join without normalisation"]);
  const acc = await register(repo, ["accept", "R-0002", "--until", "2026-12-31", "--approved-by", "cto", "--approval-ref", "https://example.com/t/1"]);
  assert.equal(acc.code, 0, acc.stdout + acc.stderr);
  // an alias line too: the PM log (after TASK-029) routes "copy finding-alias.jsonl alongside events.jsonl" here
  const al = await register(repo, ["alias", "--from", FINDING_B, "--to", FINDING, "--reason", "renamed file", "--run", run_id]);
  assert.equal(al.code, 0, al.stdout + al.stderr);

  const r = await evidence(repo, ["run", "snapshot", "register", "--run", run_id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const path = join(runDir(repo, run_id), "register-events.json");
  const snap = readArtifact(path, { kind: "register-snapshot" });
  assert.deepEqual(validate("register-snapshot", snap.payload), []);

  const log = readLog(repo);
  const chain = verifyChain(log);
  assert.equal(log.length, 3);
  assert.deepEqual(snap.payload.events, log, "the events are the log, byte-for-byte as parsed");
  assert.equal(snap.payload.seq, chain.seq);
  assert.equal(snap.payload.chain_sha256, chain.chain_sha256);
  assert.equal(snap.payload.engagement_id, "eng-2026-001");
  assert.doesNotThrow(() => verifyChain(snap.payload.events), "the snapshot's chain verifies on its own");

  const aliases = readAliasLog(repo);
  assert.equal(aliases.length, 1);
  assert.deepEqual(snap.payload.aliases, aliases, "finding-alias.jsonl is witnessed by the snapshot");
  assert.doesNotThrow(() => verifyAliasChain(snap.payload.aliases));

  // envelope: the run's identity, not the register's
  assert.equal(snap.envelope.run_id, run_id);
  assert.equal(snap.envelope.engagement_id, "eng-2026-001");
  assert.equal(snap.envelope.key_id, readArtifact(join(runDir(repo, run_id), "run.json")).envelope.key_id);
  assert.equal(snap.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);

  const out = r.stdout.trimEnd().split("\n");
  assert.equal(out.length, 2);
  assert.equal(out[0], `SNAPSHOT register events=3 chain=${chain.chain_sha256}`);
  assert.equal(out[1], `WROTE ${ST}/runs/${run_id}/register-events.json sha256=${snap.envelope.self_sha256}`);

  // corrupt register: flip a byte in the middle of the log ⇒ 5 CORRUPT, nothing under the run
  const other = readyRepo();
  const run2 = await assessmentRun(other);
  await seedRegister(other, run2, ["one", "two"]);
  const eventsPath = join(registerDir(other), "events.jsonl");
  writeFileSync(eventsPath, readFileSync(eventsPath, "utf8").replace('"title":"one"', '"title":"uno"'));
  const c = await evidence(other, ["run", "snapshot", "register", "--run", run2]);
  assert.equal(c.code, 5, c.stdout + c.stderr);
  assert.equal(c.stdout, "CORRUPT\n");
  assert.ok(!existsSync(join(runDir(other, run2), "register-events.json")), "nothing written");
  assert.deepEqual(readdirSync(runDir(other, run2)).filter((n) => n.startsWith(".")), [], "no tmp file left behind");
});

test("register snapshot of an empty register: seq 0, genesis chain, no events, no aliases", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  const r = await evidence(repo, ["run", "snapshot", "register", "--run", run_id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const snap = readArtifact(join(runDir(repo, run_id), "register-events.json"), { kind: "register-snapshot" });
  assert.deepEqual(snap.payload, { engagement_id: "eng-2026-001", seq: 0, chain_sha256: "0".repeat(64), events: [], aliases: [] });
  assert.equal(r.stdout.split("\n")[0], `SNAPSHOT register events=0 chain=${"0".repeat(64)}`);
});

test("second register snapshot ⇒ SNAPSHOT-EXISTS; the first snapshot is untouched", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  await seedRegister(repo, run_id, ["one"]);
  const first = await evidence(repo, ["run", "snapshot", "register", "--run", run_id]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const path = join(runDir(repo, run_id), "register-events.json");
  const bytes = readFileSync(path);

  await seedRegister(repo, run_id, ["two"]); // the register moved on; the snapshot must not
  const second = await evidence(repo, ["run", "snapshot", "register", "--run", run_id]);
  assert.equal(second.code, 2, second.stdout + second.stderr);
  assert.equal(second.stdout, "SNAPSHOT-EXISTS\n");
  assert.ok(readFileSync(path).equals(bytes), "write-once (G-10)");
});

test("register snapshot never carries protected content: a redacted title stays redacted", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  await seedRegister(repo, run_id, ["Hardcoded credential password=hunter2secret in config loader"]);
  const r = await evidence(repo, ["run", "snapshot", "register", "--run", run_id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const raw = readFileSync(join(runDir(repo, run_id), "register-events.json"), "utf8");
  assert.ok(!raw.includes("hunter2secret"), "the secret is not in the snapshot");
  assert.ok(!readFileSync(join(registerDir(repo), "events.jsonl"), "utf8").includes("hunter2secret"), "…nor in the log it copies");
  // and the copied bytes are the log's bytes: the chain still verifies
  const snap = readArtifact(join(runDir(repo, run_id), "register-events.json"), { kind: "register-snapshot" });
  assert.equal(verifyChain(snap.payload.events).chain_sha256, snap.payload.chain_sha256);
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

test("verify snapshot copies verify.json + its packet + its receipts (fixtures from TASK-026 placed in a fake COMMITTED verify run) and re-verifies every hash", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  const a = plantVerifyRun(repo, "verified-two-acks"); // one packet, three receipts
  const b = plantVerifyRun(repo, "ack-different-packet"); // the ack names a second packet: transitive closure

  const r = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", a.vid, "--from", b.vid]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = r.stdout.trimEnd().split("\n");
  assert.deepEqual(out, [`SNAPSHOT verify from=${a.vid} sha256=${a.verify.envelope.self_sha256}`, `SNAPSHOT verify from=${b.vid} sha256=${b.verify.envelope.self_sha256}`]);

  for (const planted of [a, b]) {
    const src = runDir(repo, planted.vid);
    const dst = join(runDir(repo, run_id), "verify-snapshots", planted.vid);
    assert.ok(readFileSync(join(dst, "verify.json")).equals(readFileSync(join(src, "verify.json"))), "verify.json byte-for-byte");
    const copied = readArtifact(join(dst, "verify.json"), { kind: "verify" });
    assert.equal(copied.envelope.self_sha256, planted.verify.envelope.self_sha256);
    assert.deepEqual(readdirSync(join(dst, "packets")).sort(), planted.packets.map((s) => `${s}.json`));
    assert.deepEqual(readdirSync(join(dst, "receipts")).sort(), planted.receipts.map((s) => `${s}.json`));
    for (const sha of planted.packets) {
      assert.ok(readFileSync(join(dst, "packets", `${sha}.json`)).equals(readFileSync(join(src, "packets", `${sha}.json`))));
      assert.equal(readArtifact(join(dst, "packets", `${sha}.json`), { kind: "packet" }).envelope.self_sha256, sha);
    }
    for (const sha of planted.receipts) {
      assert.ok(readFileSync(join(dst, "receipts", `${sha}.json`)).equals(readFileSync(join(src, "receipts", `${sha}.json`))));
      assert.equal(readArtifact(join(dst, "receipts", `${sha}.json`), { kind: "receipt" }).envelope.self_sha256, sha);
    }
    assert.deepEqual(readdirSync(dst).sort(), ["packets", "receipts", "verify.json"], "nothing else is copied (no COMMITTED, no run.json)");
  }
  assert.ok(b.packets.length === 2, "the packet-mismatch case carries the second packet");

  // the same source twice is write-once
  const again = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", a.vid]);
  assert.equal(again.code, 2, again.stdout + again.stderr);
  assert.equal(again.stdout, "SNAPSHOT-EXISTS\n");
});

test("uncommitted source ⇒ INCOMPLETE(verify:<id>); a missing source run is INCOMPLETE too; nothing copied", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  const ok = plantVerifyRun(repo, "verified-no-indicators");
  const open = plantVerifyRun(repo, "no-test-surface", { committed: false });
  const r = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", ok.vid, "--from", open.vid]);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(r.stdout, `INCOMPLETE(verify:${open.vid})\n`);
  assert.deepEqual(readdirSync(join(runDir(repo, run_id), "verify-snapshots")), [], "every source is checked before anything is copied");

  const missing = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", "deadbeef0000-0099"]);
  assert.equal(missing.code, 3, missing.stdout + missing.stderr);
  assert.equal(missing.stdout, "INCOMPLETE(verify:deadbeef0000-0099)\n");
});

test("tampered source verify.json ⇒ INCONSISTENT(verify:<id>); so is a tampered or missing referenced packet or receipt", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  const { vid, verify } = plantVerifyRun(repo, "verified-two-acks");
  const src = join(runDir(repo, vid), "verify.json");
  const original = readFileSync(src, "utf8");
  writeFileSync(src, original.replace('"row_status_at_start":"open"', '"row_status_at_start":"fixed"'));
  const t = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", vid]);
  assert.equal(t.code, 5, t.stdout + t.stderr);
  assert.equal(t.stdout, `INCONSISTENT(verify:${vid})\n`);
  assert.ok(!existsSync(join(runDir(repo, run_id), "verify-snapshots", vid)), "nothing copied");
  writeFileSync(src, original);

  // a receipt whose bytes no longer hash to the name the verify payload gives it
  const receiptSha = verify.payload.receipts[0].sha256;
  const receiptPath = join(runDir(repo, vid), "receipts", `${receiptSha}.json`);
  const receiptBytes = readFileSync(receiptPath, "utf8");
  writeFileSync(receiptPath, receiptBytes.replace('"assertion":"', '"assertion":"x'));
  const rt = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", vid]);
  assert.equal(rt.code, 5, rt.stdout + rt.stderr);
  assert.equal(rt.stdout, `INCONSISTENT(verify:${vid})\n`);
  writeFileSync(receiptPath, receiptBytes);

  // a COMMITTED run that lost its packet is inconsistent, not incomplete
  const packetPath = join(runDir(repo, vid), "packets", `${verify.payload.packet_sha256}.json`);
  const packetBytes = readFileSync(packetPath);
  writeFileSync(packetPath, "");
  const mp = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", vid]);
  assert.equal(mp.code, 5, mp.stdout + mp.stderr);
  assert.equal(mp.stdout, `INCONSISTENT(verify:${vid})\n`);
  writeFileSync(packetPath, packetBytes);

  // restored: the snapshot goes through
  const ok = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", vid]);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
});

// ---------------------------------------------------------------------------
// proposals
// ---------------------------------------------------------------------------

test("proposals index lists files with sha256; empty dir ⇒ {proposals: []}", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  const indexPath = join(runDir(repo, run_id), "proposals-index.json");

  // no proposals directory at all: the index is rewritten, still empty
  const empty = await evidence(repo, ["run", "snapshot", "proposals", "--run", run_id]);
  assert.equal(empty.code, 0, empty.stdout + empty.stderr);
  const e = readArtifact(indexPath, { kind: "proposals-index" });
  assert.deepEqual(e.payload, { proposals: [] });
  assert.deepEqual(empty.stdout.trimEnd().split("\n"), ["SNAPSHOT proposals n=0", `WROTE ${ST}/runs/${run_id}/proposals-index.json sha256=${e.envelope.self_sha256}`]);

  mkdirSync(proposalsDir(repo), { recursive: true });
  const p1 = "# P-002\n\n```json proposal\n{\"id\": \"P-002\"}\n```\n";
  const p2 = "# P-001\n\nRate limit the login endpoint. token=ghp_0123456789abcdefghijklmnopqrstuvwxyz\n";
  writeFileSync(join(proposalsDir(repo), "P-002.proposal.md"), p1);
  writeFileSync(join(proposalsDir(repo), "P-001.proposal.md"), p2);
  writeFileSync(join(proposalsDir(repo), "notes.md"), "not a proposal\n");
  mkdirSync(join(proposalsDir(repo), "drafts.proposal.md")); // a directory with the suffix is not a file
  const r = await evidence(repo, ["run", "snapshot", "proposals", "--run", run_id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const idx = readArtifact(indexPath, { kind: "proposals-index" });
  assert.deepEqual(validate("proposals-index", idx.payload), []);
  // sha256 over the REDACTED bytes (G-2: a proposal is operator/agent text that may match a rule)
  const sha = (text) => sha256Hex(Buffer.from(redactString(text).text, "utf8"));
  assert.notEqual(sha(p2), sha256Hex(Buffer.from(p2, "utf8")), "the fixture token trips a rule, so the two hashes differ");
  assert.deepEqual(idx.payload, {
    proposals: [
      { id: "P-001", sha256: sha(p2), path: `${ST}/proposals/P-001.proposal.md` },
      { id: "P-002", sha256: sha(p1), path: `${ST}/proposals/P-002.proposal.md` },
    ],
  });
  assert.equal(r.stdout.split("\n")[0], "SNAPSHOT proposals n=2");
  assert.equal(idx.envelope.run_id, run_id);
  assert.equal(idx.envelope.key_id, e.envelope.key_id, "the run's key_id is carried");
  assert.ok(!readFileSync(indexPath, "utf8").includes("ghp_0123456789"), "nothing protected reaches the run");

  // a second snapshot is a rewrite (TL-14), not an append: no duplicates
  const again = await evidence(repo, ["run", "snapshot", "proposals", "--run", run_id]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.deepEqual(readArtifact(indexPath).payload, idx.payload);
  assert.deepEqual(readdirSync(runDir(repo, run_id)).filter((n) => n.startsWith(".")), [], "no tmp file left behind");
});

// ---------------------------------------------------------------------------
// refusals common to all three
// ---------------------------------------------------------------------------

test("committed run or review run refused", async () => {
  const repo = readyRepo();
  const assessment = await assessmentRun(repo);
  const review = await reviewRun(repo);
  const { vid } = plantVerifyRun(repo, "verified-no-indicators");
  const subs = [
    ["register", []],
    ["verify", ["--from", vid]],
    ["proposals", []],
  ];
  for (const [sub, extra] of subs) {
    const k = await evidence(repo, ["run", "snapshot", sub, "--run", review, ...extra]);
    assert.equal(k.code, 2, `${sub}: ${k.stdout}${k.stderr}`);
    assert.equal(k.stdout, "KIND(review)\n", sub);
  }
  commitRun(runDir(repo, assessment));
  for (const [sub, extra] of subs) {
    const c = await evidence(repo, ["run", "snapshot", sub, "--run", assessment, ...extra]);
    assert.equal(c.code, 2, `${sub}: ${c.stdout}${c.stderr}`);
    assert.equal(c.stdout, "RUN-COMMITTED\n", sub);
  }
  assert.ok(!existsSync(join(runDir(repo, assessment), "register-events.json")));
  assert.deepEqual(readdirSync(join(runDir(repo, assessment), "verify-snapshots")), []);
  assert.deepEqual(readArtifact(join(runDir(repo, assessment), "proposals-index.json")).payload, { proposals: [] });
});

test("usage: subcommand required, --run required and well-formed, unknown run, verify needs --from", async () => {
  const repo = readyRepo();
  const run_id = await assessmentRun(repo);
  const none = await evidence(repo, ["run", "snapshot"]);
  assert.equal(none.code, 2);
  assert.match(none.stdout, /^USAGE\(run snapshot: .*register\|verify\|proposals/);
  const unknown = await evidence(repo, ["run", "snapshot", "ledger", "--run", run_id]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /^USAGE\(run snapshot: unknown subcommand ledger\)/);
  const noRun = await evidence(repo, ["run", "snapshot", "register"]);
  assert.equal(noRun.code, 2);
  assert.match(noRun.stdout, /^USAGE\(run snapshot register: --run/);
  const badRun = await evidence(repo, ["run", "snapshot", "register", "--run", "not-a-run"]);
  assert.equal(badRun.code, 2);
  assert.match(badRun.stdout, /^USAGE\(run snapshot register: --run/);
  const missing = await evidence(repo, ["run", "snapshot", "proposals", "--run", "0123456789ab-0042"]);
  assert.equal(missing.code, 2);
  assert.equal(missing.stdout, "USAGE(run snapshot proposals: unknown run 0123456789ab-0042)\n");
  const noFrom = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id]);
  assert.equal(noFrom.code, 2);
  assert.match(noFrom.stdout, /^USAGE\(run snapshot verify: --from/);
  const badFrom = await evidence(repo, ["run", "snapshot", "verify", "--run", run_id, "--from", "nope"]);
  assert.equal(badFrom.code, 2);
  assert.match(badFrom.stdout, /^USAGE\(run snapshot verify: --from/);
  const stray = await evidence(repo, ["run", "snapshot", "register", "--run", run_id, "extra"]);
  assert.equal(stray.code, 2);
  assert.match(stray.stdout, /^USAGE\(run snapshot register: unexpected argument extra\)/);
  assert.ok(!existsSync(join(runDir(repo, run_id), "register-events.json")));
});

test("module shape: run(argv, ctx); imports no child process, no network, no clock (G-6, G-14, G-1)", async () => {
  const mod = await import("./cmd-run-snapshot.mjs");
  assert.equal(typeof mod.run, "function");
  const src = readFileSync(join(HERE, "cmd-run-snapshot.mjs"), "utf8");
  assert.ok(!/child_process|node:http|node:net|node:dns|\bfetch\(/.test(src));
  assert.ok(!/Date\.now\(|new Date\(/.test(src));
  assert.ok(!/console\.(log|error)|process\.stdout|process\.stderr/.test(src), "stdout/stderr only through ctx (G-4)");
  assert.ok(!/sha256Hex\(\s*(?:bytes|raw|buf)\b/.test(src), "no plain sha256 over raw proposal bytes (G-2)");
});
