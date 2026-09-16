// TASK-012 — `evidence.mjs run init` (plan §4.1 row `run init`; spec §6.1,
// §6.2, D18 / P6, P2). Every repo is built in a temp dir by the CLI harness.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict, readArtifact } from "../canon.mjs";
import { cleanupAll, git, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { defaultRecord, TEMPLATE_PATHS } from "./engagement.mjs";
import { ensureKey } from "./keys.mjs";
import { runIdOf } from "./ledger.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const ST = join(".agents", "security-testing");
const OID = /^[0-9a-f]{40}$/;
const RUN_LINE = /^RUN ([0-9a-f]{12}-[0-9]{4}) seq=([0-9]+) kind=([a-z-]+) base=([0-9a-f]{40}) head=([0-9a-f]{40})$/;

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

/**
 * A committed fixture repo with the managed ignore block committed, an
 * engagement.md (the template's record unless `record` is given) and the
 * engagement's key — the state `engagement init` leaves behind.
 */
function readyRepo({ record, commitIgnore = true } = {}) {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), IGNORE_BLOCK);
  if (commitIgnore) {
    git(repo, ["add", ".gitignore"]);
    git(repo, ["commit", "-q", "-m", "ignore block"]);
  }
  const st = join(repo, ST);
  mkdirSync(st, { recursive: true });
  if (record) writeFileSync(join(st, "engagement.md"), engagementMd(record));
  else copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(st, "engagement.md"));
  const ctx = createContext({ root: repo }, { env: { ...process.env, ...ENV } });
  ensureKey(ctx, { engagement_id: ctx.engagement().engagement_id });
  return repo;
}

const ledgerIndex = (repo) => join(repo, ST, "ledger", "index.json");
const runDir = (repo, run_id) => join(repo, ST, "runs", run_id);
const readIndex = (repo) => parseStrict(readFileSync(ledgerIndex(repo)));

function parseRunLine(stdout) {
  const m = RUN_LINE.exec(stdout.split("\n")[0]);
  assert.ok(m, `first line is the RUN token: ${JSON.stringify(stdout)}`);
  return { run_id: m[1], seq: Number(m[2]), kind: m[3], base: m[4], head: m[5] };
}

test("run init allocation before inputs: run.json exists, no scope.json, index +1, RUN then WROTE lines", async () => {
  const repo = readyRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  const r = await runScript("evidence", ["run", "init", "--kind", "review", "--base", "HEAD~1"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, "");
  const { run_id, seq, kind, base, head: headOut } = parseRunLine(r.stdout);
  assert.equal(seq, 1);
  assert.equal(kind, "review");
  assert.equal(headOut, head);
  assert.equal(base, git(repo, ["rev-parse", "HEAD~1"]));
  assert.equal(run_id, `${head.slice(0, 12)}-0001`);

  const dir = runDir(repo, run_id);
  const run = readArtifact(join(dir, "run.json"), { kind: "run" });
  assert.deepEqual(run.payload, { engagement_id: "eng-2026-001", seq: 1, base_oid: base, head_oid: head, template: "review" });
  assert.deepEqual(validate("run", run.payload), []);
  assert.equal(run.envelope.run_id, run_id);
  assert.equal(run.envelope.engagement_id, "eng-2026-001");
  assert.match(run.envelope.key_id, /^k[0-9a-f]{12}$/);
  assert.equal(run.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);

  const engagement = readArtifact(join(dir, "engagement.json"), { kind: "engagement" });
  assert.deepEqual(engagement.payload, defaultRecord());

  assert.ok(!existsSync(join(dir, "scope.json")), "scope is a later command");
  for (const sub of ["packets", "receipts", "ingest", "verify-snapshots"]) {
    assert.ok(statSync(join(dir, sub)).isDirectory(), sub);
    assert.deepEqual(readdirSync(join(dir, sub)), [], `${sub} is empty`);
  }
  assert.ok(statSync(join(repo, ST, "ledger", run_id, "imports")).isDirectory());
  assert.ok(!existsSync(join(dir, ".lock")), "no lock dir inside the run (fsx.walk would list its probes)");

  assert.deepEqual(readIndex(repo), [{ kind: "review", run_id, seq: 1 }]);

  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 3, "RUN + two WROTE lines for a review run");
  assert.equal(lines[1], `WROTE ${ST}/runs/${run_id}/run.json sha256=${run.envelope.self_sha256}`);
  assert.equal(lines[2], `WROTE ${ST}/runs/${run_id}/engagement.json sha256=${engagement.envelope.self_sha256}`);
});

test("assessment on dirty tree refused: exit 3 DIRTY-TREE, ledger untouched, nothing under runs/", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "app.js"), "export const a = 2;\n");
  const r = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, "DIRTY-TREE\n");
  assert.ok(!existsSync(ledgerIndex(repo)), "ledger untouched");
  assert.ok(!existsSync(join(repo, ST, "runs")), "no run directory");

  // an untracked file under a product path is dirt too
  git(repo, ["checkout", "--", "src/app.js"]);
  writeFileSync(join(repo, "package.json"), "{}\n");
  const u = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(u.code, 3);
  assert.equal(u.stdout, "DIRTY-TREE\n");
  assert.ok(!existsSync(ledgerIndex(repo)));
});

test("P6: dirt outside scope_paths ∪ product_paths and the bundle's managed paths never count", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "README.md"), "# changed outside the assessed paths\n");
  writeFileSync(join(repo, "notes.txt"), "untracked, outside\n");
  const r = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(parseRunLine(r.stdout).kind, "assessment");

  // scope = the whole tree: only the managed paths and the ignore block are exempt
  const whole = readyRepo({ record: { ...defaultRecord(), scope_paths: ["."], product_paths: [] }, commitIgnore: false });
  mkdirSync(join(whole, "reports", "security"), { recursive: true });
  writeFileSync(join(whole, "reports", "security", "report.md"), "draft\n");
  mkdirSync(join(whole, "tasks", "security-my-product-admitted"), { recursive: true });
  writeFileSync(join(whole, "tasks", "security-my-product-admitted", "TC-1.md"), "case\n");
  writeFileSync(join(whole, ST, "risk-register.md"), "rendered\n");
  // .gitignore is untracked here and carries only the managed block
  const clean = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: whole, env: ENV });
  assert.equal(clean.code, 0, clean.stdout + clean.stderr);
  const ignore = readFileSync(join(whole, ".gitignore"), "utf8");
  writeFileSync(join(whole, ".gitignore"), `${ignore}node_modules/\n`);
  const dirty = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: whole, env: ENV });
  assert.equal(dirty.code, 3, ".gitignore changed outside the managed block is dirt");
  assert.equal(dirty.stdout, "DIRTY-TREE\n");
  assert.equal(readIndex(whole).length, 1, "the refused init left the ledger alone");

  // a committed .gitignore whose last line has no LF: the block writer must add
  // the newline (or a blank separator) to attach the block — never dirt
  for (const [label, atHead, working] of [
    ["no trailing LF at HEAD", "node_modules/", `node_modules/\n${IGNORE_BLOCK}`],
    ["blank separator before the block", "node_modules/\n", `node_modules/\n\n${IGNORE_BLOCK}`],
    ["CRLF file", "node_modules/\r\n", `node_modules/\r\n${IGNORE_BLOCK.replaceAll("\n", "\r\n")}`],
  ]) {
    const repo = initRepo();
    writeFileSync(join(repo, ".gitignore"), atHead);
    git(repo, ["add", ".gitignore"]);
    git(repo, ["commit", "-q", "-m", "gitignore"]);
    writeFileSync(join(repo, ".gitignore"), working);
    const st = join(repo, ST);
    mkdirSync(st, { recursive: true });
    const record = { ...defaultRecord(), scope_paths: ["."], product_paths: [] };
    writeFileSync(join(st, "engagement.md"), engagementMd(record));
    ensureKey(createContext({ root: repo }, { env: { ...process.env, ...ENV } }), { engagement_id: record.engagement_id });
    const r = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
    assert.equal(r.code, 0, `${label}: ${r.stdout}${r.stderr}`);
    // …but a real pattern added next to the block is still dirt
    writeFileSync(join(repo, ".gitignore"), `${working}dist/\n`);
    const d = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
    assert.equal(d.code, 3, `${label}: pattern outside the block`);
    // …and a begin marker with no end line is not the block: git reads the
    // marker as a comment and `dist/` as a live pattern, so it is dirt too
    writeFileSync(join(repo, ".gitignore"), `${atHead}${atHead.endsWith("\n") || atHead === "" ? "" : "\n"}# security-testing:begin\ndist/\n`);
    const u = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
    assert.equal(u.code, 3, `${label}: unterminated block hides nothing`);
    assert.equal(u.stdout, "DIRTY-TREE\n");
  }
});

test("a run file already present for the freshly allocated seq: exit 5 INCONSISTENT(runs/<id>), no RUN line above the token", async () => {
  const repo = readyRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  const next = runIdOf(head, 1);
  mkdirSync(join(repo, ST, "runs", next), { recursive: true });
  writeFileSync(join(repo, ST, "runs", next, "run.json"), "{}\n");
  const r = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(r.code, 5, r.stdout + r.stderr);
  assert.equal(r.stdout, `INCONSISTENT(runs/${next})\n`, "the failure token is the only stdout line");
});

test("review on the same dirty tree allocates", async () => {
  const repo = readyRepo();
  writeFileSync(join(repo, "src", "app.js"), "export const a = 2;\n");
  writeFileSync(join(repo, "src", "new.js"), "export const b = 1;\n");
  const refused = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(refused.code, 3);
  const r = await runScript("evidence", ["run", "init", "--kind", "review", "--base", "HEAD"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { seq, kind, base, head } = parseRunLine(r.stdout);
  assert.equal(seq, 1, "the refused assessment consumed no seq");
  assert.equal(kind, "review");
  assert.equal(base, head);
});

test("retry allocates a new seq and rewrites nothing", async () => {
  const repo = readyRepo();
  const first = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(first.code, 0, first.stderr);
  const a = parseRunLine(first.stdout);
  const snapshot = (id) => Object.fromEntries(["run.json", "engagement.json", "imports.json", "observations.json", "proposals-index.json"].map((f) => [f, readFileSync(join(runDir(repo, id), f), "utf8")]));
  const before = snapshot(a.run_id);
  const indexBefore = readFileSync(ledgerIndex(repo), "utf8");

  const second = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: { ...ENV, SECURITY_EVIDENCE_NOW: "2026-09-16T11:00:00Z" } });
  assert.equal(second.code, 0, second.stderr);
  const b = parseRunLine(second.stdout);
  assert.equal(b.seq, 2);
  assert.equal(b.run_id, `${a.head.slice(0, 12)}-0002`);
  assert.notEqual(b.run_id, a.run_id);
  assert.deepEqual(snapshot(a.run_id), before, "the first run's files are byte-identical");
  assert.notEqual(readFileSync(ledgerIndex(repo), "utf8"), indexBefore);
  assert.deepEqual(readIndex(repo).map((e) => e.seq), [1, 2]);

  // same head, same engagement, different seq ⇒ different run identity (seq is in the preimage)
  const ra = readArtifact(join(runDir(repo, a.run_id), "run.json"));
  const rb = readArtifact(join(runDir(repo, b.run_id), "run.json"));
  assert.notEqual(ra.envelope.self_sha256, rb.envelope.self_sha256);
});

test("two concurrent run init processes ⇒ two distinct seqs, index parses", async () => {
  const repo = readyRepo();
  const args = ["run", "init", "--kind", "review", "--base", "HEAD"];
  const [x, y] = await Promise.all([runScript("evidence", args, { cwd: repo, env: ENV }), runScript("evidence", args, { cwd: repo, env: ENV })]);
  assert.equal(x.code, 0, x.stdout + x.stderr);
  assert.equal(y.code, 0, y.stdout + y.stderr);
  const seqs = [parseRunLine(x.stdout).seq, parseRunLine(y.stdout).seq].sort();
  assert.deepEqual(seqs, [1, 2]);
  const index = readIndex(repo);
  assert.equal(index.length, 2);
  assert.deepEqual(index.map((e) => e.seq), [1, 2]);
  assert.equal(new Set(index.map((e) => e.run_id)).size, 2);
  for (const e of index) assert.ok(existsSync(join(runDir(repo, e.run_id), "run.json")), e.run_id);
  assert.deepEqual(readdirSync(join(repo, ST, "ledger")).filter((n) => n.includes("lock")), [], "no lock left behind");
});

test("assessment run has the three empty index artifacts and no threat-model.json; review run has none of them", async () => {
  const repo = readyRepo();
  const a = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(a.code, 0, a.stderr);
  const { run_id } = parseRunLine(a.stdout);
  const dir = runDir(repo, run_id);
  const expected = {
    "imports.json": ["imports-index", { imports: [] }],
    "observations.json": ["observations-index", { observations: [] }],
    "proposals-index.json": ["proposals-index", { proposals: [] }],
  };
  for (const [file, [kind, payload]] of Object.entries(expected)) {
    const art = readArtifact(join(dir, file), { kind });
    assert.deepEqual(art.payload, payload, file);
    assert.deepEqual(validate(kind, art.payload), [], file);
    assert.equal(art.envelope.run_id, run_id);
  }
  assert.ok(!existsSync(join(dir, "threat-model.json")), "absence is the INCOMPLETE(threat-model) signal");
  const lines = a.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 6, "RUN + five WROTE lines");
  assert.deepEqual(
    lines.slice(1).map((l) => l.split(" ")[1].split("/").pop()),
    ["run.json", "engagement.json", "imports.json", "observations.json", "proposals-index.json"],
  );

  const r = await runScript("evidence", ["run", "init", "--kind", "review", "--base", "HEAD"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stderr);
  const rdir = runDir(repo, parseRunLine(r.stdout).run_id);
  for (const file of [...Object.keys(expected), "threat-model.json"]) assert.ok(!existsSync(join(rdir, file)), file);
  for (const kind of ["verify", "threat-model"]) {
    const v = await runScript("evidence", ["run", "init", "--kind", kind, "--base", "HEAD"], { cwd: repo, env: ENV });
    assert.equal(v.code, 0, v.stderr);
    const vdir = runDir(repo, parseRunLine(v.stdout).run_id);
    for (const file of Object.keys(expected)) assert.ok(!existsSync(join(vdir, file)), `${kind}: ${file}`);
  }
});

test("--base defaults to head for assessment|threat-model and is required for review|verify; --head names the head", async () => {
  const repo = readyRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  const parent = git(repo, ["rev-parse", "HEAD~1"]);
  for (const kind of ["review", "verify"]) {
    const r = await runScript("evidence", ["run", "init", "--kind", kind], { cwd: repo, env: ENV });
    assert.equal(r.code, 2, kind);
    assert.match(r.stdout, /^USAGE\(run init: --base is required for review\|verify\)$/m);
  }
  assert.ok(!existsSync(ledgerIndex(repo)));
  const tm = await runScript("evidence", ["run", "init", "--kind", "threat-model", "--head", "HEAD~1"], { cwd: repo, env: ENV });
  assert.equal(tm.code, 0, tm.stderr);
  const t = parseRunLine(tm.stdout);
  assert.equal(t.head, parent);
  assert.equal(t.base, parent);
  assert.equal(t.run_id, `${parent.slice(0, 12)}-0001`);
  const rv = await runScript("evidence", ["run", "init", "--kind", "review", "--base", "HEAD~1", "--head", "HEAD"], { cwd: repo, env: ENV });
  assert.equal(rv.code, 0, rv.stderr);
  assert.deepEqual([parseRunLine(rv.stdout).base, parseRunLine(rv.stdout).head], [parent, head]);
});

test("usage: missing/unknown --kind, unknown ref, unknown flag, stray positional, unknown subcommand ⇒ exit 2 and nothing allocated", async () => {
  const repo = readyRepo();
  const cases = [
    [["run"], /^USAGE\(run: /],
    [["run", "frobnicate"], /^USAGE\(run: unknown subcommand/],
    [["run", "init"], /^USAGE\(run init: --kind/],
    [["run", "init", "--kind", "audit"], /^USAGE\(run init: --kind/],
    [["run", "init", "--kind", "review", "--base", "no-such-ref"], /^USAGE\(run init: --base/],
    [["run", "init", "--kind", "assessment", "--head", "no-such-ref"], /^USAGE\(run init: --head/],
    [["run", "init", "--kind", "assessment", "--nope"], /^USAGE\(run init: unknown flag/],
    [["run", "init", "--kind", "assessment", "extra"], /^USAGE\(run init: unexpected/],
  ];
  for (const [argv, re] of cases) {
    const r = await runScript("evidence", argv, { cwd: repo, env: ENV });
    assert.equal(r.code, 2, argv.join(" "));
    assert.match(r.stdout, re, argv.join(" "));
  }
  assert.ok(!existsSync(ledgerIndex(repo)));
  assert.ok(!existsSync(join(repo, ST, "runs")));
});

test("without engagement.md ⇒ 2 ENGAGEMENT-MISSING; without a key ⇒ 2 KEY: unavailable (engagement init creates keys, run init never does)", async () => {
  const bare = initRepo();
  const r = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: bare, env: ENV });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "ENGAGEMENT-MISSING\n");

  const noKey = initRepo();
  mkdirSync(join(noKey, ST), { recursive: true });
  copyFileSync(TEMPLATE_PATHS["engagement.md.template"], join(noKey, ST, "engagement.md"));
  const k = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: noKey, env: ENV });
  assert.equal(k.code, 2);
  assert.equal(k.stdout, "KEY: unavailable\n");
  assert.ok(!existsSync(join(noKey, ST, "private")), "no key was minted");
  assert.ok(!existsSync(ledgerIndex(noKey)));
});

test("appendIndex under the run lock is atomic across two processes", async () => {
  const repo = readyRepo();
  const a = await runScript("evidence", ["run", "init", "--kind", "assessment"], { cwd: repo, env: ENV });
  assert.equal(a.code, 0, a.stderr);
  const { run_id } = parseRunLine(a.stdout);
  const N = 25;
  const program = `
    import { createContext } from ${JSON.stringify(join(HERE, "ctx.mjs"))};
    import { appendIndex } from ${JSON.stringify(join(HERE, "run-index.mjs"))};
    const [root, run_id, tag, n] = process.argv.slice(1);
    const ctx = createContext({ root }, { env: process.env });
    for (let i = 0; i < Number(n); i++) {
      // tag + zero-padded i, so "aa1" and "aa10" never pad to the same id
      await appendIndex(ctx, run_id, "imports", { kind: "sarif", import_sha256: (tag + String(i).padStart(4, "0")).padEnd(64, "0"), original_hmac: "a".repeat(64) });
    }
  `;
  const spawn = (tag) =>
    new Promise((done) => {
      execFile(
        process.execPath,
        ["--input-type=module", "-e", program, "--", repo, run_id, tag, String(N)],
        { cwd: repo, env: { ...process.env, ...ENV }, shell: false, encoding: "utf8" },
        (err, stdout, stderr) => done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }),
      );
    });
  const [x, y] = await Promise.all([spawn("aa"), spawn("bb")]);
  assert.equal(x.code, 0, x.stderr);
  assert.equal(y.code, 0, y.stderr);
  const art = readArtifact(join(runDir(repo, run_id), "imports.json"), { kind: "imports-index" });
  assert.equal(art.payload.imports.length, 2 * N, "no lost update");
  assert.equal(new Set(art.payload.imports.map((e) => e.import_sha256)).size, 2 * N);
  assert.deepEqual(validate("imports-index", art.payload), []);
  assert.equal(art.envelope.run_id, run_id);
  const stray = readdirSync(runDir(repo, run_id)).filter((n) => n.startsWith("."));
  assert.deepEqual(stray, [], "no tmp or lock entries left under the run");
  assert.deepEqual(readdirSync(join(repo, ST, "ledger")).filter((n) => n.includes("lock")), [], "run lock released");
  assert.ok(OID.test(readArtifact(join(runDir(repo, run_id), "run.json")).payload.head_oid));
});
