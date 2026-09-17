// TASK-057 — `evidence.mjs packet --kind scope` (plan §4.1 row `packet`, §5
// TASK-057; spec §6.4 P1 "scope packet", §6.1 `packet.json` preimage, TL-15;
// US-015 AC-1, US-028 AC-3) and TASK-021 — `--kind subject` (plan §5
// TASK-021; spec §6.4 P1 "subject packet"; US-015 AC-1). Every repo is built
// in a temp dir by the CLI harness; every run is allocated by the real `run
// init`, scoped by the real `scope` and — for the subject packets — gated by
// the real `gate`, so the ids a subject packet names are the bundle's own,
// never this test's guess.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactId, canonical, hmacHex, makeEnvelope, parseStrict, readArtifact, sha256Hex, writeArtifact } from "../canon.mjs";
import { cleanupAll, git, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { DB_JS } from "../fixtures/sarif/index.mjs";
import { rangeBytes } from "./cite-core.mjs";
import { citedFiles } from "./cmd-packet.mjs";
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

test("--subject with --kind scope ⇒ exit 2; --type too; missing or unknown --kind ⇒ 2; --kind subject validates its argv before any read", async () => {
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
  // subject: argv validated before any run artifact is read
  await usage(["--run", run_id, "--kind", "subject"], /^USAGE\(packet: --subject/);
  await usage(["--run", run_id, "--kind", "subject", "--subject", "x", "--type", "audit"], /^USAGE\(packet: --type/);
  await usage(["--run", run_id, "--kind", "subject", "--subject", ""], /^USAGE\(packet: --subject/);
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

// --- subject packet (TASK-021) ----------------------------------------------------

const DUP_JS = "a();\nb();\na();\nb();\na();\n";
const claim = (over = {}) => ({ title: "t", class: "config", priority: "p2", confidence: 5, path: "src/app.js", side: "head", lines: [1, 1], snippet: "export const a = 1;", ...over });
/** The three claims every gated fixture carries: a data-flow finding with typed citations, a sensitive one, a failed one. */
const CLAIMS = Object.freeze({
  injection: claim({
    title: "sql built from req.query.id",
    class: "injection",
    path: "src/db.js",
    lines: [3, 4],
    snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);',
    citations_typed: [
      { role: "sink", path: "src/db.js", side: "head", lines: [4, 4], context: true },
      { role: "source", path: "src/app.js", side: "head", lines: [1, 1], context: true },
    ],
  }),
  sensitive: claim({ title: "credential in comment", class: "config", path: "src/db.js", lines: [6, 6], snippet: `// ${SECRET}` }),
  failed: claim({ title: "not what the file says", class: "config", path: "src/dup.js", lines: [1, 1], snippet: "z();" }),
});

/** Write a payload-only claims file into the agent drop-box (TL-4) and return its repo-relative path. */
function writeClaims(repo, run_id, name, set) {
  const dir = join(repo, ST, "receipts", run_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(set, null, 2));
  return join(ST, "receipts", run_id, name);
}

/**
 * A committed repo with src/app.js, src/db.js (DB_JS: the secret on
 * normalised line 6) and src/dup.js; an assessment run scoped, scope-packeted
 * and gated over `claims` (CLAIMS by default). Returns the gated artifacts and
 * a `finding(title)` lookup into findings.claimed.json.
 */
async function gatedRepo({ claims = Object.values(CLAIMS) } = {}) {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const run_id = await initRun(repo, "assessment");
  const scope = await scoped(repo, run_id);
  const p = await packet(repo, ["--run", run_id, "--kind", "scope"]);
  assert.equal(p.code, 0, `scope packet: ${p.stdout}${p.stderr}`);
  const scopePacket = parsePacketLine(p.stdout).sha256;
  const file = writeClaims(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: scopePacket, findings: claims });
  const g = await runScript("evidence", ["gate", "--run", run_id, "--claims", file], { cwd: repo, env: ENV });
  assert.equal(g.code, 0, `gate: ${g.stdout}${g.stderr}`);
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const claimed = readArtifact(join(runDir(repo, run_id), "findings.claimed.json"), { kind: "claimed" });
  const gateResult = readArtifact(join(runDir(repo, run_id), "gate-result.json"), { kind: "gate-result" });
  const finding = (title) => {
    const f = claimed.payload.findings.find((x) => x.title === title);
    assert.ok(f, `gated finding titled ${JSON.stringify(title)}`);
    return f;
  };
  return { repo, run_id, run, scope, scopePacket, claimed, gateResult, finding, key: keyBytes(repo) };
}

/** `<run>/threat-model.json` as tm-lint check (M2) will write it: an enveloped `threat-model` artifact. */
function writeThreatModel(repo, run_id, payload) {
  const run = readArtifact(join(runDir(repo, run_id), "run.json"), { kind: "run" });
  const { schema_version, engagement_id, key_id } = run.envelope;
  const now = () => ENV.SECURITY_EVIDENCE_NOW;
  return writeArtifact(join(runDir(repo, run_id), "threat-model.json"), makeEnvelope({ schema_version, kind: "threat-model", run_id, engagement_id, key_id, now }, payload), { exclusive: true });
}

const packetFiles = (repo, run_id) => readdirSync(packetsDir(repo, run_id)).sort();

test("subject packet: kind subject, subject_ids, files limited to cited ranges + typed citations, range_hmac over raw bytes at the recorded side (US-015 AC-1)", async () => {
  const { repo, run_id, run, scope, scopePacket, gateResult, finding, key } = await gatedRepo();
  const f = finding(CLAIMS.injection.title);
  assert.equal(f.state, "CITATION_VERIFIED");
  assert.ok(gateResult.payload.accepted.includes(f.id));
  assert.equal(f.citations_typed.length, 2);

  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", f.id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const line = parsePacketLine(r.stdout);
  assert.equal(line.kind, "subject");
  assert.equal(line.files, 2, "src/app.js (typed source) + src/db.js (primary + typed sink)");
  assert.equal(line.path, `${ST}/runs/${run_id}/packets/${line.sha256}.json`);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2, "PACKET + one WROTE line");
  assert.equal(lines[1], `WROTE ${line.path} sha256=${line.sha256}`);
  assert.notEqual(line.sha256, scopePacket, "a subject packet is never the scope packet");

  const art = readPacket(repo, run_id, line.sha256);
  assert.deepEqual(validate("packet", art.payload), []);
  assert.equal(art.envelope.self_sha256, line.sha256, "the file is named by its identity");
  assert.equal(art.envelope.self_sha256, artifactId(art.payload));
  assert.equal(art.envelope.kind, "packet");
  assert.equal(art.envelope.run_id, run_id);
  assert.equal(art.envelope.key_id, run.envelope.key_id);
  assert.deepEqual(Object.keys(art.payload).sort(), ["files", "kind", "policy_sha256", "subject_ids"]);
  assert.equal(art.payload.kind, "subject");
  assert.deepEqual(art.payload.subject_ids, [f.id]);
  assert.equal(art.payload.policy_sha256, sha256Hex(canonical(shippedPolicy())));

  // files: the cited ranges only — never the whole scope file — hashed over the RAW bytes at head
  const appRaw = readFileSync(join(repo, "src", "app.js"));
  const dbRaw = readFileSync(join(repo, "src", "db.js"));
  const oidOf = (path) => scope.payload.files.find((x) => x.path === path).oid;
  assert.deepEqual(art.payload.files, [
    { path: "src/app.js", side: "head", oid: oidOf("src/app.js"), ranges: [[1, 1]], range_hmac: hmacHex(key, rangeBytes(appRaw, 1, 1)) },
    {
      path: "src/db.js",
      side: "head",
      oid: oidOf("src/db.js"),
      ranges: [
        [3, 4],
        [4, 4],
      ],
      range_hmac: hmacHex(key, Buffer.concat([rangeBytes(dbRaw, 3, 4), rangeBytes(dbRaw, 4, 4)])),
    },
  ]);
  assert.deepEqual(scope.payload.ranges["src/db.js"], [[1, 7]], "the scope admits the whole file; the packet lists only what the finding cites");
  assert.equal(git(repo, ["rev-parse", `${run.payload.head_oid}:src/db.js`]), art.payload.files[1].oid);
  // the primary range's raw bytes are the two raw lines 4–5 (normalised 3–4), indentation and terminators kept
  assert.equal(rangeBytes(dbRaw, 3, 4).toString("utf8"), '  const q = "SELECT * FROM users WHERE id = " + req.query.id;\n  return pool.query(q);\n');
  assert.notEqual(art.payload.files[1].range_hmac, hmacHex(key, Buffer.from(f.snippet)), "raw bytes, not the normalised snippet");
  assert.notEqual(art.payload.files[1].range_hmac, sha256Hex(rangeBytes(dbRaw, 3, 4)), "G-2: keyed, never a plain sha256 of content");
  assert.deepEqual(packetFiles(repo, run_id), [`${scopePacket}.json`, `${line.sha256}.json`].sort());
});

test("subject packet over a sensitive finding: the cited range is bound by HMAC only; no protected content in the packet, on stdout, or anywhere under <st>", async () => {
  const { repo, run_id, scope, finding, key } = await gatedRepo();
  const f = finding(CLAIMS.sensitive.title);
  assert.equal(f.sensitive, true);
  assert.equal(f.state, "CITATION_VERIFIED");
  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", f.id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const line = parsePacketLine(r.stdout);
  const art = readPacket(repo, run_id, line.sha256);
  const dbRaw = readFileSync(join(repo, "src", "db.js"));
  assert.deepEqual(art.payload.files, [{ path: "src/db.js", side: "head", oid: scope.payload.files.find((x) => x.path === "src/db.js").oid, ranges: [[6, 6]], range_hmac: hmacHex(key, rangeBytes(dbRaw, 6, 6)) }]);
  assert.equal(rangeBytes(dbRaw, 6, 6).toString("utf8"), `// ${SECRET}\n`);
  assert.notEqual(art.payload.files[0].range_hmac, sha256Hex(rangeBytes(dbRaw, 6, 6)));
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
  assert.deepEqual(
    filesContaining(repo, SECRET).filter((p) => !p.startsWith("receipts/")),
    [],
    "§12: the agent drop-box is the only place the claimed text ever was",
  );
});

test("same subjects twice ⇒ same packet_sha256: idempotent re-run, one file; argv order is the subject_ids order and a repeated id is deduplicated", async () => {
  const { repo, run_id, scopePacket, finding } = await gatedRepo();
  const a = finding(CLAIMS.injection.title).id;
  const b = finding(CLAIMS.sensitive.title).id;
  const first = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", a, "--subject", b]);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const one = parsePacketLine(first.stdout);
  assert.equal(one.files, 2);
  const onDisk = readFileSync(join(packetsDir(repo, run_id), `${one.sha256}.json`));
  assert.deepEqual(readPacket(repo, run_id, one.sha256).payload.subject_ids, [a, b]);

  const second = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", a, "--subject", b, "--subject", a], { ...ENV, SECURITY_EVIDENCE_NOW: "2027-01-01T00:00:00Z" });
  assert.equal(second.code, 0, second.stdout + second.stderr);
  assert.equal(parsePacketLine(second.stdout).sha256, one.sha256, "a repeated id adds nothing");
  assert.equal(second.stdout, first.stdout, "the result lines are stable across re-runs");
  assert.deepEqual(readFileSync(join(packetsDir(repo, run_id), `${one.sha256}.json`)), onDisk, "write-once: the first write stands (G-10)");

  // the order the lead lists subjects in is the packet's subject_ids order, so [b, a] is a different packet over the same files
  const swapped = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", b, "--subject", a]);
  assert.equal(swapped.code, 0, swapped.stdout + swapped.stderr);
  const two = parsePacketLine(swapped.stdout);
  assert.notEqual(two.sha256, one.sha256);
  assert.deepEqual(readPacket(repo, run_id, two.sha256).payload.subject_ids, [b, a]);
  assert.deepEqual(readPacket(repo, run_id, two.sha256).payload.files, readPacket(repo, run_id, one.sha256).payload.files);
  // two findings on one file share one entry (ranges merged, one hmac over the concatenation); one packet per subject lists only its own ranges
  const both = readPacket(repo, run_id, one.sha256).payload.files.find((e) => e.path === "src/db.js");
  assert.deepEqual(both.ranges, [
    [3, 4],
    [4, 4],
    [6, 6],
  ]);
  const single = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", b]);
  assert.equal(single.code, 0, single.stdout + single.stderr);
  const three = parsePacketLine(single.stdout);
  assert.equal(three.files, 1);
  const dbRaw = readFileSync(join(repo, "src", "db.js"));
  const key = keyBytes(repo);
  assert.deepEqual(readPacket(repo, run_id, three.sha256).payload.files, [{ path: "src/db.js", side: "head", oid: both.oid, ranges: [[6, 6]], range_hmac: hmacHex(key, rangeBytes(dbRaw, 6, 6)) }]);
  assert.equal(both.range_hmac, hmacHex(key, Buffer.concat([rangeBytes(dbRaw, 3, 4), rangeBytes(dbRaw, 4, 4), rangeBytes(dbRaw, 6, 6)])));
  assert.deepEqual(packetFiles(repo, run_id), [scopePacket, one.sha256, two.sha256, three.sha256].map((s) => `${s}.json`).sort());
  // --type vulnerability-review is the default for a finding: saying it changes nothing
  const typed = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", a, "--subject", b, "--type", "vulnerability-review"]);
  assert.equal(typed.code, 0, typed.stdout + typed.stderr);
  assert.equal(parsePacketLine(typed.stdout).sha256, one.sha256);
});

test("unknown subject ⇒ exit 2 USAGE(packet: unknown subject <id>): an id gate never issued, a foreign run's id, an id of the other kind under an explicit --type; nothing written", async () => {
  const { repo, run_id, scopePacket, finding } = await gatedRepo();
  const known = finding(CLAIMS.injection.title).id;
  const before = packetFiles(repo, run_id);
  assert.deepEqual(before, [`${scopePacket}.json`]);
  const unknown = async (id, extra = []) => {
    const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", id, ...extra]);
    assert.equal(r.code, 2, `${id}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), `USAGE(packet: unknown subject ${id})`);
    assert.deepEqual(packetFiles(repo, run_id), before, "nothing written");
  };
  await unknown("f".repeat(64));
  await unknown(known.toUpperCase());
  await unknown(known.slice(0, 63));
  await unknown("R-0001");
  // a known id listed after an unknown one: the unknown one is the refusal, still nothing written
  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", known, "--subject", "e".repeat(64)]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), `USAGE(packet: unknown subject ${"e".repeat(64)})`);
  assert.deepEqual(packetFiles(repo, run_id), before);
  // a finding of another run is unknown here: ids are looked up in THIS run's gate-result
  const other = await gatedRepo({ claims: [claim({ title: "other", path: "src/dup.js", lines: [2, 2], snippet: "b();" })] });
  await unknown(other.finding("other").id);
  // --type vulnerability-review with a mitigation-shaped id, and --type mitigation-review with a finding id: unknown in that source
  await unknown("M-001", ["--type", "vulnerability-review"]);
  writeThreatModel(repo, run_id, { elements: [], threats: [] });
  await unknown(known, ["--type", "mitigation-review"]);
});

test("subject in unverifiable[] (CITATION_FAILED) ⇒ exit 2 UNVERIFIABLE-SUBJECT(<id>): no packet for a finding whose citation did not verify", async () => {
  const { repo, run_id, scopePacket, gateResult, finding } = await gatedRepo();
  const f = finding(CLAIMS.failed.title);
  assert.equal(f.state, "CITATION_FAILED");
  assert.ok(gateResult.payload.unverifiable.includes(f.id));
  assert.ok(!gateResult.payload.accepted.includes(f.id));
  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", f.id]);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), `UNVERIFIABLE-SUBJECT(${f.id})`);
  assert.deepEqual(packetFiles(repo, run_id), [`${scopePacket}.json`], "nothing written");
  // mixed with an accepted one: the packet is refused as a whole
  const ok = finding(CLAIMS.injection.title).id;
  const m = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", ok, "--subject", f.id]);
  assert.equal(m.code, 2, m.stdout + m.stderr);
  assert.equal(m.stdout.trim(), `UNVERIFIABLE-SUBJECT(${f.id})`);
  assert.deepEqual(packetFiles(repo, run_id), [`${scopePacket}.json`]);
});

test("before gate: --kind subject over a finding id ⇒ 3 INCOMPLETE(gate-result); a claimed artifact gate-result no longer names ⇒ 5 INCONSISTENT(gate-result)", async () => {
  const repo = readyRepo();
  const run_id = await initRun(repo, "assessment");
  await scoped(repo, run_id);
  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", "a".repeat(64)]);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), "INCOMPLETE(gate-result)");
  assert.deepEqual(packetFiles(repo, run_id), []);

  const g = await gatedRepo();
  const id = g.finding(CLAIMS.injection.title).id;
  // findings.claimed.json replaced by another valid claimed artifact: gate-result.claimed_sha256 no longer names it
  const claimedPath = join(runDir(g.repo, g.run_id), "findings.claimed.json");
  rmSync(claimedPath);
  const { schema_version, engagement_id, key_id } = g.run.envelope;
  writeArtifact(claimedPath, makeEnvelope({ schema_version, kind: "claimed", run_id: g.run_id, engagement_id, key_id, now: () => ENV.SECURITY_EVIDENCE_NOW }, { scope_sha256: g.scope.envelope.self_sha256, findings: [] }), { prered: true, exclusive: true });
  const t = await packet(g.repo, ["--run", g.run_id, "--kind", "subject", "--subject", id]);
  assert.equal(t.code, 5, t.stdout + t.stderr);
  assert.equal(t.stdout.trim(), "INCONSISTENT(gate-result)");
  assert.deepEqual(packetFiles(g.repo, g.run_id), [`${g.scopePacket}.json`]);
});

test("base-side citations: a review run's accepted base finding is packeted at base with the base blob's oid; a typed citation keeps its own side", async () => {
  // src/dup.js shrinks between base (5 lines) and head (2 lines): a base citation of line 5 is admitted at base only
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "db.js"), DB_JS);
  writeFileSync(join(repo, "src", "dup.js"), DUP_JS);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "db + dup"]);
  const baseRef = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "src", "dup.js"), "a();\nb();\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "dup shrinks"]);
  writeFileSync(join(repo, "src", "db.js"), `${DB_JS}export const dirty = 1;\n`); // dirty ⇒ snapshot side in a review run
  const init = await runScript("evidence", ["run", "init", "--kind", "review", "--base", baseRef], { cwd: repo, env: ENV });
  assert.equal(init.code, 0, init.stdout + init.stderr);
  const run_id = /^RUN (\S+)/.exec(init.stdout)[1];
  const scope = await scoped(repo, run_id);
  const p = await packet(repo, ["--run", run_id, "--kind", "scope"]);
  assert.equal(p.code, 0, p.stdout + p.stderr);
  const claims = [
    claim({ title: "base only", path: "src/dup.js", side: "base", lines: [5, 5], snippet: "a();", citations_typed: [{ role: "control", path: "src/dup.js", side: "head", lines: [2, 2], context: true }] }),
    claim({ title: "snapshot", path: "src/db.js", side: "snapshot", lines: [6, 6], snippet: "// <REDACTED:password-assign>" }),
  ];
  const file = writeClaims(repo, run_id, "claims-1.json", { scope_sha256: scope.envelope.self_sha256, packet_sha256: parsePacketLine(p.stdout).sha256, findings: claims });
  const g = await runScript("evidence", ["gate", "--run", run_id, "--claims", file], { cwd: repo, env: ENV });
  assert.equal(g.code, 0, g.stdout + g.stderr);
  assert.match(g.stdout, /^GATE accepted=2 unverifiable=0/);
  const claimed = readArtifact(join(runDir(repo, run_id), "findings.claimed.json"), { kind: "claimed" });
  const base = claimed.payload.findings.find((f) => f.title === "base only");
  const snap = claimed.payload.findings.find((f) => f.title === "snapshot");
  assert.equal(base.side, "base");
  assert.equal(snap.side, "snapshot");

  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", base.id, "--subject", snap.id]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const line = parsePacketLine(r.stdout);
  assert.equal(line.files, 3, "src/db.js@snapshot, src/dup.js@base, src/dup.js@head");
  const art = readPacket(repo, run_id, line.sha256);
  assert.deepEqual(validate("packet", art.payload), []);
  const key = keyBytes(repo);
  const baseBlob = git(repo, ["rev-parse", `${baseRef}:src/dup.js`]);
  const headBlob = scope.payload.files.find((f) => f.path === "src/dup.js").oid;
  assert.notEqual(baseBlob, headBlob);
  const snapBytes = readFileSync(join(snapshotDir(repo, run_id), "src", "db.js"));
  assert.deepEqual(art.payload.files, [
    { path: "src/db.js", side: "snapshot", oid: scope.payload.snapshot["src/db.js"].redacted_sha256, ranges: [[6, 6]], range_hmac: hmacHex(key, rangeBytes(snapBytes, 6, 6)) },
    { path: "src/dup.js", side: "base", oid: baseBlob, ranges: [[5, 5]], range_hmac: hmacHex(key, rangeBytes(Buffer.from(DUP_JS), 5, 5)) },
    { path: "src/dup.js", side: "head", oid: headBlob, ranges: [[2, 2]], range_hmac: hmacHex(key, rangeBytes(Buffer.from("a();\nb();\n"), 2, 2)) },
  ]);
  assert.equal(rangeBytes(snapBytes, 6, 6).toString("utf8"), "// <REDACTED:password-assign>\n", "the snapshot side hashes the redacted bytes the reviewer will read");
  assert.deepEqual(filesContaining(repo, SECRET).filter((f) => !f.startsWith("receipts/")), []);
});

test("mitigation subjects (--type mitigation-review, the default for an M-nnn id): one file per mitigation citation from <run>/threat-model.json; no model ⇒ 3 INCOMPLETE(threat-model); no citation ⇒ 2 USAGE", async () => {
  const { repo, run_id, run, scope, scopePacket, key } = await gatedRepo();
  const absent = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", "M-001"]);
  assert.equal(absent.code, 3, absent.stdout + absent.stderr);
  assert.equal(absent.stdout.trim(), "INCOMPLETE(threat-model)");
  assert.deepEqual(packetFiles(repo, run_id), [`${scopePacket}.json`]);

  writeThreatModel(repo, run_id, {
    elements: [{ id: "E-001", kind: "process", name: "find", citation: { path: "src/db.js", side: "head", lines: [2, 5] } }],
    threats: [
      {
        id: "T-001",
        element_id: "E-001",
        stride: "T",
        title: "query built from input",
        mitigations: [
          { id: "M-001", claim: "parameterised in pool.query", citation: { path: "src/db.js", side: "head", lines: [4, 4] } },
          { id: "M-002", claim: "asserted, uncited" },
        ],
        disposition: { kind: "undisposed" },
      },
    ],
  });
  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", "M-001"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const line = parsePacketLine(r.stdout);
  assert.equal(line.kind, "subject");
  assert.equal(line.files, 1);
  const art = readPacket(repo, run_id, line.sha256);
  assert.deepEqual(validate("packet", art.payload), []);
  assert.deepEqual(art.payload.subject_ids, ["M-001"]);
  const dbRaw = readFileSync(join(repo, "src", "db.js"));
  assert.deepEqual(art.payload.files, [{ path: "src/db.js", side: "head", oid: scope.payload.files.find((x) => x.path === "src/db.js").oid, ranges: [[4, 4]], range_hmac: hmacHex(key, rangeBytes(dbRaw, 4, 4)) }]);
  assert.equal(art.envelope.key_id, run.envelope.key_id);
  const explicit = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", "M-001", "--type", "mitigation-review"]);
  assert.equal(explicit.code, 0, explicit.stdout + explicit.stderr);
  assert.equal(parsePacketLine(explicit.stdout).sha256, line.sha256, "--type mitigation-review is the default for a mitigation id");

  const uncited = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", "M-002"]);
  assert.equal(uncited.code, 2, uncited.stdout + uncited.stderr);
  assert.equal(uncited.stdout.trim(), "USAGE(packet: subject M-002 has no citation to review)");
  const unknown = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", "M-009"]);
  assert.equal(unknown.code, 2, unknown.stdout + unknown.stderr);
  assert.equal(unknown.stdout.trim(), "USAGE(packet: unknown subject M-009)");
  assert.deepEqual(packetFiles(repo, run_id), [`${scopePacket}.json`, `${line.sha256}.json`].sort());
});

test("one packet, one contract: a finding id and a mitigation id together ⇒ 2 USAGE; --type fix-review is verify all's (2 USAGE); --type case over an id that is not a committed path ⇒ 2 USAGE", async () => {
  const { repo, run_id, scopePacket, finding } = await gatedRepo();
  const id = finding(CLAIMS.injection.title).id;
  const mixed = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", id, "--subject", "M-001"]);
  assert.equal(mixed.code, 2, mixed.stdout + mixed.stderr);
  assert.match(mixed.stdout, /^USAGE\(packet: --subject ids name subjects of more than one kind/);
  const fix = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", id, "--type", "fix-review"]);
  assert.equal(fix.code, 2, fix.stdout + fix.stderr);
  assert.match(fix.stdout, /^USAGE\(packet: --type fix-review/);
  const kase = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", "c".repeat(64), "--type", "case"]);
  assert.equal(kase.code, 2, kase.stdout + kase.stderr);
  assert.match(kase.stdout, /^USAGE\(packet: case c{64} is not in the tree at head [0-9a-f]{12} \(commit the case and start a run at that head\)\)$/m);
  assert.deepEqual(packetFiles(repo, run_id), [`${scopePacket}.json`], "nothing written");
});

// --- case packets (TASK-042: the `SUBJECT_SOURCES.case` seam) ---------------------------

test("case packet (TASK-042): --type case --subject <path> ⇒ the committed case file at head as the one entry (whole normalised range, blob oid, range_hmac) with subject id = case_sha256 over its redacted text; receipt validate binds a vulnerability-review to it; idempotent", async () => {
  const { readyRepo: planRepo, writeCase, caseText, PASSIVE_ROWS, commitAll, scopedRun } = await import("../fixtures/plan/helpers.mjs");
  const { caseSha256 } = await import("./admission-core.mjs");
  const repo = planRepo();
  const rel = writeCase(repo, "TC-001_security-headers.md", caseText("TC-001", [["Open `{{base_url}}/login` with password=`Hunter2Secret9` in the query", "Login page loads"], ...PASSIVE_ROWS]));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--type", "case", "--subject", rel]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const line = parsePacketLine(r.stdout);
  assert.equal(line.kind, "subject");
  assert.equal(line.files, 1);
  const p = readPacket(repo, run_id, line.sha256);
  const bytes = readFileSync(join(repo, rel));
  const { case_sha256 } = caseSha256(bytes);
  assert.deepEqual(p.payload.subject_ids, [case_sha256], "the subject id is the case identity, not the path given");
  assert.notEqual(case_sha256, sha256Hex(bytes), "sha256 over the REDACTED text (G-2)");
  const [file] = p.payload.files;
  assert.equal(file.path, rel);
  assert.equal(file.side, "head");
  assert.equal(file.oid, git(repo, ["rev-parse", `HEAD:${rel}`]));
  const lines = bytes.toString("utf8").split("\n").filter((l) => l.trim() !== "").length;
  assert.deepEqual(file.ranges, [[1, lines]], "the whole file, normalised line numbers");
  assert.equal(file.range_hmac, hmacHex(keyBytes(repo), rangeBytes(bytes, 1, lines)));
  assert.deepEqual(filesContaining(repo, "Hunter2Secret9"), [`cases/my-product/TC-001_security-headers.md`], "the raw credential is only in the operator's own candidate file, in no bundle-written file (the packet carries an HMAC, the subject a redacted identity)");
  assert.deepEqual(validate("packet", p.payload), []);
  // receipt validate accepts a vulnerability-review on it: the oid at head matches
  mkdirSync(join(repo, ST, "receipts", run_id), { recursive: true });
  writeFileSync(join(repo, ST, "receipts", run_id, "r.json"), JSON.stringify({ type: "vulnerability-review", subject_id: case_sha256, packet_sha256: line.sha256, assertion: "confirmed", reviewer_run_id: run_id }));
  const rv = await runScript("evidence", ["receipt", "validate", "--run", run_id, join(ST, "receipts", run_id, "r.json")], { cwd: repo, env: ENV });
  assert.equal(rv.code, 0, rv.stdout + rv.stderr);
  assert.match(rv.stdout, new RegExp(`^RECEIPT admitted sha256=[0-9a-f]{64} type=vulnerability-review subject=${case_sha256}$`, "m"));
  // idempotent: the same packet again is the same file
  const again = await packet(repo, ["--run", run_id, "--kind", "subject", "--type", "case", "--subject", rel]);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.equal(parsePacketLine(again.stdout).sha256, line.sha256);
  assert.match(again.stderr, /already present with this identity; nothing rewritten/);
});

test("case packet refusals: a path not at head (uncommitted, edited after the run, or a directory) ⇒ 2 USAGE; a non-repo path ⇒ 2 USAGE; two paths with one identity ⇒ 2 USAGE; without --type a path is an unknown subject; two distinct cases ⇒ one packet with two subjects", async () => {
  const { readyRepo: planRepo, writeCase, caseText, PASSIVE_ROWS, commitAll, scopedRun } = await import("../fixtures/plan/helpers.mjs");
  const repo = planRepo();
  const a = writeCase(repo, "TC-001_a.md", caseText("TC-001", PASSIVE_ROWS));
  const twin = writeCase(repo, "TC-001_twin.md", caseText("TC-001", PASSIVE_ROWS));
  const b = writeCase(repo, "TC-002_b.md", caseText("TC-002", PASSIVE_ROWS, { title: "Another" }));
  commitAll(repo);
  const run_id = await scopedRun(repo);
  const uncommitted = writeCase(repo, "TC-003_later.md", caseText("TC-003", PASSIVE_ROWS));
  for (const [subjects, re] of [
    [[uncommitted], /^USAGE\(packet: case \S+ is not in the tree at head [0-9a-f]{12} \(commit the case and start a run at that head\)\)$/m],
    [[".agents/security-testing/cases"], /^USAGE\(packet: case \S+ is not in the tree at head /m],
    [["../x.md"], /^USAGE\(packet: --subject \.\.\/x\.md is not a repo-relative case path/m],
    [["/etc/passwd"], /^USAGE\(packet: --subject \/etc\/passwd is not a repo-relative case path/m],
    [[a, twin], /^USAGE\(packet: cases \S+ and \S+ have the same identity \(one case, one subject\)\)$/m],
  ]) {
    const r = await packet(repo, ["--run", run_id, "--kind", "subject", "--type", "case", ...subjects.flatMap((x) => ["--subject", x])]);
    assert.equal(r.code, 2, `${subjects.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re);
  }
  const untyped = await packet(repo, ["--run", run_id, "--kind", "subject", "--subject", a]);
  assert.equal(untyped.code, 2, untyped.stdout + untyped.stderr);
  assert.match(untyped.stdout, /^USAGE\(packet: unknown subject /m);
  assert.deepEqual(packetFiles(repo, run_id), [], "nothing written");
  const two = await packet(repo, ["--run", run_id, "--kind", "subject", "--type", "case", "--subject", a, "--subject", b]);
  assert.equal(two.code, 0, two.stdout + two.stderr);
  const p = readPacket(repo, run_id, parsePacketLine(two.stdout).sha256);
  assert.equal(p.payload.subject_ids.length, 2);
  assert.deepEqual(p.payload.files.map((f) => f.path), [a, b]);
});

test("citedFiles (the seam verify all builds its fix-review packet on): pure grouping of a finding's primary and typed ranges by (path, side), oids left to the caller", () => {
  const f = {
    id: "a".repeat(64),
    path: "src/db.js",
    side: "head",
    lines: [3, 4],
    citations_typed: [
      { role: "sink", path: "src/db.js", side: "head", lines: [4, 4], context: true },
      { role: "source", path: "src/app.js", side: "head", lines: [1, 1], context: true },
      { role: "control", path: "src/db.js", side: "base", lines: [9, 9], context: true },
    ],
  };
  assert.deepEqual(citedFiles([f]), [
    { path: "src/app.js", side: "head", ranges: [[1, 1]] },
    { path: "src/db.js", side: "base", ranges: [[9, 9]] },
    {
      path: "src/db.js",
      side: "head",
      ranges: [
        [3, 4],
        [4, 4],
      ],
    },
  ]);
  // two findings on the same file merge into one entry; the inputs are not mutated
  const g = { id: "b".repeat(64), path: "src/db.js", side: "head", lines: [1, 1] };
  const before = JSON.stringify([f, g]);
  const merged = citedFiles([f, g]);
  assert.deepEqual(
    merged.find((e) => e.path === "src/db.js" && e.side === "head").ranges,
    [
      [1, 1],
      [3, 4],
      [4, 4],
    ],
  );
  assert.equal(JSON.stringify([f, g]), before);
  assert.deepEqual(citedFiles([]), []);
  assert.throws(() => citedFiles([{ id: "x" }]), /path/);
});
