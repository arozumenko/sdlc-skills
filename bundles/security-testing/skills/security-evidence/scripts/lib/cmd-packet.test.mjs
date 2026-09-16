// TASK-057 — `evidence.mjs packet --kind scope` (plan §4.1 row `packet`, §5
// TASK-057; spec §6.4 P1 "scope packet", §6.1 `packet.json` preimage, TL-15;
// US-015 AC-1, US-028 AC-3). Every repo is built in a temp dir by the CLI
// harness; every run is allocated by the real `run init` and scoped by the
// real `scope`. `--kind subject` is TASK-021's: here it is the stub that
// validates its argv and returns NOT-IMPLEMENTED.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactId, canonical, hmacHex, parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { cleanupAll, git, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { rangeBytes } from "./cite-core.mjs";
import { createContext } from "./ctx.mjs";
import { defaultRecord, TEMPLATE_PATHS } from "./engagement.mjs";
import { walk } from "./fsx.mjs";
import { ensureKey } from "./keys.mjs";
import { POLICY_PATH } from "./packet-core.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const ST = join(".agents", "security-testing");
const SHA256 = /^[0-9a-f]{64}$/;
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;
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

/** A committed fixture repo with the ignore block committed, an engagement.md (scope_paths: src/) and the engagement's key. */
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
const packetsDir = (repo, run_id) => join(runDir(repo, run_id), "packets");
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

async function scoped(repo, run_id) {
  const r = await runScript("evidence", ["scope", "--run", run_id], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, `scope: ${r.stdout}${r.stderr}`);
  return readArtifact(join(runDir(repo, run_id), "scope.json"), { kind: "scope" });
}

async function packet(repo, args, env = ENV) {
  return runScript("evidence", ["packet", ...args], { cwd: repo, env });
}

function parsePacketLine(stdout) {
  const m = PACKET_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `first line is the PACKET token: ${JSON.stringify(stdout)}`);
  return { path: m[1], sha256: m[2], kind: m[3], files: Number(m[4]) };
}

function readPacket(repo, run_id, sha256) {
  return readArtifact(join(packetsDir(repo, run_id), `${sha256}.json`), { kind: "packet" });
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

const shippedPolicy = () => parseStrict(readFileSync(POLICY_PATH));

// --- scope packet ---------------------------------------------------------------

test("scope packet: kind scope, empty subject_ids, one file entry per scope file, range_hmac over raw bytes at the recorded side (US-015 AC-1)", async () => {
  const repo = readyRepo();
  // a second in-scope file with CRLF terminators and blank lines: the raw bytes are the preimage, not the normalised text
  writeFileSync(join(repo, "src", "db.js"), "const q = 1;\r\n\r\n  \r\nconst r = 2;\r\nconst s = 3;\r\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db"]);
  const run_id = await initRun(repo, "assessment");
  const scope = await scoped(repo, run_id);
  assert.deepEqual(
    scope.payload.files.map((f) => [f.path, f.lines]),
    [
      ["src/app.js", 1],
      ["src/db.js", 3],
    ],
  );

  const r = await packet(repo, ["--run", run_id, "--kind", "scope"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const line = parsePacketLine(r.stdout);
  assert.equal(line.kind, "scope");
  assert.equal(line.files, 2);
  assert.equal(line.path, `${ST}/runs/${run_id}/packets/${line.sha256}.json`);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2, "PACKET + one WROTE line");
  assert.equal(lines[1], `WROTE ${line.path} sha256=${line.sha256}`);

  const art = readPacket(repo, run_id, line.sha256);
  assert.deepEqual(validate("packet", art.payload), []);
  assert.equal(art.envelope.self_sha256, line.sha256, "the file is named by its identity");
  assert.equal(art.envelope.self_sha256, artifactId(art.payload), "packet_sha256 = sha256(canonical(payload))");
  assert.equal(art.envelope.kind, "packet");
  assert.equal(art.envelope.run_id, run_id);
  assert.equal(art.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  assert.equal(art.envelope.key_id, run.envelope.key_id, "the run's key, not whatever is current");

  assert.deepEqual(Object.keys(art.payload).sort(), ["files", "kind", "policy_sha256", "subject_ids"]);
  assert.equal(art.payload.kind, "scope");
  assert.deepEqual(art.payload.subject_ids, []);
  assert.equal(art.payload.policy_sha256, sha256Hex(canonical(shippedPolicy())), "policy_sha256 = sha256(canonical(references/packet-policy.v1.json))");

  const key = keyBytes(repo);
  const head = run.payload.head_oid;
  const expectFile = (path) => {
    const sf = scope.payload.files.find((f) => f.path === path);
    const raw = readFileSync(join(repo, path)); // clean assessment tree: the working file IS the head blob
    assert.equal(git(repo, ["rev-parse", `${head}:${path}`]), sf.oid);
    return { path, side: "head", oid: sf.oid, ranges: scope.payload.ranges[path], range_hmac: hmacHex(key, rangeBytes(raw, 1, sf.lines)) };
  };
  assert.deepEqual(art.payload.files, [expectFile("src/app.js"), expectFile("src/db.js")]);
  // raw CRLF bytes, blank lines included — the whole-file range is every byte of the file
  const dbRaw = readFileSync(join(repo, "src", "db.js"));
  assert.equal(art.payload.files[1].range_hmac, hmacHex(key, dbRaw));
  assert.notEqual(art.payload.files[1].range_hmac, hmacHex(key, Buffer.from("const q = 1;\nconst r = 2;\nconst s = 3;\n")), "not the normalised text");
  assert.match(art.payload.files[1].range_hmac, SHA256);
  // G-2: no plain sha256 of content anywhere in the payload
  assert.notEqual(art.payload.files[1].range_hmac, sha256Hex(dbRaw));
  assert.deepEqual(readdirSync(packetsDir(repo, run_id)), [`${line.sha256}.json`]);
});

test("same scope twice ⇒ same packet_sha256: re-running is idempotent (one file, same identity), and a fresh run over the same tree yields the same packet", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  await scoped(repo, run_id);
  const first = await packet(repo, ["--run", run_id, "--kind", "scope"]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const a = parsePacketLine(first.stdout);
  const onDisk = readFileSync(join(packetsDir(repo, run_id), `${a.sha256}.json`));

  const second = await packet(repo, ["--run", run_id, "--kind", "scope"], { ...ENV, SECURITY_EVIDENCE_NOW: "2027-01-01T00:00:00Z" });
  assert.equal(second.code, 0, second.stdout + second.stderr);
  const b = parsePacketLine(second.stdout);
  assert.equal(b.sha256, a.sha256);
  assert.equal(second.stdout, first.stdout, "the result lines are stable across re-runs");
  assert.deepEqual(readdirSync(packetsDir(repo, run_id)), [`${a.sha256}.json`], "write-once: nothing rewritten, nothing duplicated (G-10)");
  assert.deepEqual(readFileSync(join(packetsDir(repo, run_id), `${a.sha256}.json`)), onDisk, "byte-identical: the first write stands");

  // a second run (new seq) over the same tree: the packet identity depends on scope + key + policy only, never on the run
  const run2 = await initRun(repo, "assessment");
  assert.notEqual(run2, run_id);
  await scoped(repo, run2);
  const third = await packet(repo, ["--run", run2, "--kind", "scope"]);
  assert.equal(third.code, 0, third.stdout + third.stderr);
  const c = parsePacketLine(third.stdout);
  assert.equal(c.sha256, a.sha256, "deterministic identity across runs (TL-6)");
  assert.equal(c.path, `${ST}/runs/${run2}/packets/${a.sha256}.json`);
  assert.deepEqual(readPacket(repo, run2, c.sha256).payload, readPacket(repo, run_id, a.sha256).payload);

  // a tampered packet file under the identity's name is an integrity failure, not silently accepted
  const tamperRun = await initRun(repo, "assessment");
  await scoped(repo, tamperRun);
  mkdirSync(packetsDir(repo, tamperRun), { recursive: true });
  writeFileSync(join(packetsDir(repo, tamperRun), `${a.sha256}.json`), '{"envelope":{},"payload":{}}\n');
  const t = await packet(repo, ["--run", tamperRun, "--kind", "scope"]);
  assert.equal(t.code, 5, t.stdout + t.stderr);
  assert.equal(t.stdout.trim(), `INCONSISTENT(packets/${a.sha256})`);
});

test("snapshot-side file hashed from the private snapshot: range_hmac over the REDACTED bytes, oid = redacted_sha256, no original bytes anywhere; a tampered snapshot ⇒ 5 INCONSISTENT(snapshot:<path>) and nothing written", async () => {
  const repo = readyRepo();
  const original = `export const a = 1;\nconst cfg = { ${SECRET} };\n`;
  writeFileSync(join(repo, "src", "app.js"), original);
  const run_id = await initRun(repo, "review");
  const scope = await scoped(repo, run_id);
  assert.deepEqual(scope.payload.files.map((f) => [f.path, f.side]), [["src/app.js", "snapshot"]]);
  const snapBytes = readFileSync(join(snapshotDir(repo, run_id), "src", "app.js"));
  assert.ok(!snapBytes.includes(SECRET));

  const r = await packet(repo, ["--run", run_id, "--kind", "scope"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const line = parsePacketLine(r.stdout);
  const art = readPacket(repo, run_id, line.sha256);
  assert.deepEqual(validate("packet", art.payload), []);
  const key = keyBytes(repo);
  assert.deepEqual(art.payload.files, [
    {
      path: "src/app.js",
      side: "snapshot",
      oid: scope.payload.snapshot["src/app.js"].redacted_sha256,
      ranges: [[1, 2]],
      range_hmac: hmacHex(key, rangeBytes(snapBytes, 1, 2)),
    },
  ]);
  assert.equal(art.payload.files[0].range_hmac, hmacHex(key, snapBytes));
  assert.notEqual(art.payload.files[0].range_hmac, hmacHex(key, Buffer.from(original)), "the original bytes are gone; the packet hashes what the reviewer will read");
  assert.equal(art.payload.files[0].oid, sha256Hex(snapBytes));
  assert.deepEqual(filesContaining(repo, SECRET), [], "§12: no original bytes under <st>, private/ included");
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));

  // the snapshot on disk no longer matches scope.snapshot[path].redacted_sha256 ⇒ integrity failure, no packet written
  const run2 = await initRun(repo, "review");
  await scoped(repo, run2);
  writeFileSync(join(snapshotDir(repo, run2), "src", "app.js"), "export const a = 1;\n// edited after scope\n");
  const t = await packet(repo, ["--run", run2, "--kind", "scope"]);
  assert.equal(t.code, 5, t.stdout + t.stderr);
  assert.equal(t.stdout.trim(), "INCONSISTENT(snapshot:src/app.js)");
  assert.deepEqual(readdirSync(packetsDir(repo, run2)), []);

  // the snapshot file removed ⇒ the input is incomplete, exit 3
  const run3 = await initRun(repo, "review");
  await scoped(repo, run3);
  rmSync(join(snapshotDir(repo, run3), "src", "app.js"));
  const m = await packet(repo, ["--run", run3, "--kind", "scope"]);
  assert.equal(m.code, 3, m.stdout + m.stderr);
  assert.equal(m.stdout.trim(), "INCOMPLETE(snapshot:src/app.js)");
  assert.deepEqual(readdirSync(packetsDir(repo, run3)), []);
});

test("mixed review scope: head-side and snapshot-side files each hashed at their recorded side, in scope order", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "new.js"), `const ${SECRET};\nexport const b = 2;\n`);
  const run_id = await initRun(repo, "review");
  const scope = await scoped(repo, run_id);
  const r = await packet(repo, ["--run", run_id, "--kind", "scope"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const art = readPacket(repo, run_id, parsePacketLine(r.stdout).sha256);
  const key = keyBytes(repo);
  const appRaw = readFileSync(join(repo, "src", "app.js")); // clean tracked file: equals the head blob
  const newSnap = readFileSync(join(snapshotDir(repo, run_id), "src", "new.js"));
  assert.deepEqual(art.payload.files, [
    { path: "src/app.js", side: "head", oid: scope.payload.files[0].oid, ranges: [[1, 1]], range_hmac: hmacHex(key, appRaw) },
    { path: "src/new.js", side: "snapshot", oid: scope.payload.files[1].oid, ranges: [[1, 2]], range_hmac: hmacHex(key, newSnap) },
  ]);
  assert.equal(parsePacketLine(r.stdout).files, 2);
  assert.deepEqual(filesContaining(repo, SECRET), []);
});

test("empty scope ⇒ a scope packet with files: [] (coverage's INDETERMINATE case still has a packet for claims to name)", async () => {
  const repo = readyRepo({ record: { ...defaultRecord(), scope_paths: ["lib/"], product_paths: [] } });
  const run_id = await initRun(repo, "assessment");
  const scope = await scoped(repo, run_id);
  assert.deepEqual(scope.payload.files, []);
  const r = await packet(repo, ["--run", run_id, "--kind", "scope"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const line = parsePacketLine(r.stdout);
  assert.equal(line.files, 0);
  const art = readPacket(repo, run_id, line.sha256);
  assert.deepEqual(art.payload, { kind: "scope", subject_ids: [], files: [], policy_sha256: sha256Hex(canonical(shippedPolicy())) });
  assert.deepEqual(validate("packet", art.payload), []);
});

// --- --policy -------------------------------------------------------------------

test("--policy <file>: a valid policy file replaces the shipped one in policy_sha256; an off-schema file ⇒ 2 SCHEMA-INVALID; outside the tree ⇒ 2 USAGE", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  await scoped(repo, run_id);
  const custom = { ...shippedPolicy(), redaction_version: 7 };
  writeFileSync(join(repo, "policy.json"), JSON.stringify(custom));
  const r = await packet(repo, ["--run", run_id, "--kind", "scope", "--policy", "policy.json"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const art = readPacket(repo, run_id, parsePacketLine(r.stdout).sha256);
  assert.equal(art.payload.policy_sha256, sha256Hex(canonical(custom)));
  assert.notEqual(art.payload.policy_sha256, sha256Hex(canonical(shippedPolicy())));

  writeFileSync(join(repo, "bad.json"), JSON.stringify({ ...custom, max_range: 41 }));
  const bad = await packet(repo, ["--run", run_id, "--kind", "scope", "--policy", "bad.json"]);
  assert.equal(bad.code, 2, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^SCHEMA-INVALID\(packet-policy\.v1: /);

  const outside = await packet(repo, ["--run", run_id, "--kind", "scope", "--policy", POLICY_PATH]);
  assert.equal(outside.code, 2, outside.stdout + outside.stderr);
  assert.match(outside.stdout, /^USAGE\(packet: /);
  const missing = await packet(repo, ["--run", run_id, "--kind", "scope", "--policy", "nope.json"]);
  assert.equal(missing.code, 2, missing.stdout + missing.stderr);
  assert.match(missing.stdout, /^USAGE\(packet: cannot read nope\.json/);
});

// --- refusals -------------------------------------------------------------------

test("--subject with --kind scope ⇒ exit 2; --type too; missing or unknown --kind ⇒ 2; --kind subject is the TASK-021 stub", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  await scoped(repo, run_id);
  const usage = async (args, re) => {
    const r = await packet(repo, args);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re);
    assert.deepEqual(readdirSync(packetsDir(repo, run_id)), [], "nothing written");
  };
  await usage(["--run", run_id, "--kind", "scope", "--subject", "f".repeat(64)], /^USAGE\(packet: --subject/);
  await usage(["--run", run_id, "--kind", "scope", "--type", "vulnerability-review"], /^USAGE\(packet: --type/);
  await usage(["--run", run_id], /^USAGE\(packet: --kind/);
  await usage(["--run", run_id, "--kind", "review"], /^USAGE\(packet: --kind/);
  await usage(["--kind", "scope"], /^USAGE\(packet: --run/);
  await usage(["--run", "nope", "--kind", "scope"], /^USAGE\(packet: --run/);
  await usage(["--run", "0123456789ab-0099", "--kind", "scope"], /^USAGE\(packet: unknown run/);
  await usage(["--run", run_id, "--kind", "scope", "extra"], /^USAGE\(packet: unexpected argument/);
  await usage(["--run", run_id, "--kind", "scope", "--frob"], /^USAGE\(packet: unknown flag/);
  // subject: argv validated, then the stub
  await usage(["--run", run_id, "--kind", "subject"], /^USAGE\(packet: --subject/);
  await usage(["--run", run_id, "--kind", "subject", "--subject", "x", "--type", "audit"], /^USAGE\(packet: --type/);
  await usage(["--run", run_id, "--kind", "subject", "--subject", "f".repeat(64)], /^NOT-IMPLEMENTED\(TASK-021\)$/m);
});

test("without scope.json ⇒ 3 INCOMPLETE(scope); a COMMITTED run ⇒ 2 RUN-COMMITTED; the run's key gone ⇒ 2 KEY: unavailable", async () => {
  const repo = readyRepo();
  const bare = await initRun(repo, "assessment");
  const r = await packet(repo, ["--run", bare, "--kind", "scope"]);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), "INCOMPLETE(scope)");
  assert.deepEqual(readdirSync(packetsDir(repo, bare)), []);

  const done = await initRun(repo, "assessment");
  await scoped(repo, done);
  writeFileSync(join(runDir(repo, done), "COMMITTED"), `${"0".repeat(64)}\n`);
  const c = await packet(repo, ["--run", done, "--kind", "scope"]);
  assert.equal(c.code, 2, c.stdout + c.stderr);
  assert.equal(c.stdout.trim(), "RUN-COMMITTED");
  assert.deepEqual(readdirSync(packetsDir(repo, done)), []);

  const keyed = await initRun(repo, "assessment");
  await scoped(repo, keyed);
  const run = readArtifact(join(runDir(repo, keyed), "run.json"), { kind: "run" });
  rmSync(join(repo, ST, "private", "keys", run.envelope.key_id));
  const k = await packet(repo, ["--run", keyed, "--kind", "scope"]);
  assert.equal(k.code, 2, k.stdout + k.stderr);
  assert.equal(k.stdout.trim(), "KEY: unavailable");
  assert.deepEqual(readdirSync(packetsDir(repo, keyed)), []);
  assert.ok(existsSync(join(runDir(repo, keyed), "scope.json")), "scope.json untouched");
});
