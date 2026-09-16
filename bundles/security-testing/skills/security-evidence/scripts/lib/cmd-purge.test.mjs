// TASK-032 — `evidence.mjs purge --engagement <id> [--yes]` (plan §4.1 row
// `purge`, TASK-032; spec §6.9 / P3, TL-4, TL-9). Every repo is built in a
// temp dir by the CLI harness (G-12). The fixture holds two engagements in
// one repo — real `run init` runs, real keys, real baselines — so "nothing of
// the other" is asserted against material the bundle itself wrote.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrict } from "../canon.mjs";
import { cleanupAll, git, initRepo, runScript } from "../fixtures/cli/harness.mjs";
import { stepBaseline } from "./baseline.mjs";
import { createContext } from "./ctx.mjs";
import { defaultRecord } from "./engagement.mjs";
import { currentKeyId, ensureKey, keysOf, readIndex as readKeysIndex } from "./keys.mjs";
import { readIndex as readLedgerIndex } from "./ledger.mjs";

after(cleanupAll);

const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const ST = join(".agents", "security-testing");
const RUN_LINE = /^RUN ([0-9a-f]{12}-[0-9]{4}) seq=([0-9]+) kind=/;
const PURGED = /^PURGED runs=([0-9]+) keys=([0-9]+) current-key=(removed|kept)$/;

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

const ctxOf = (repo) => createContext({ root: repo }, { env: { ...process.env, ...ENV } });

/**
 * One engagement's footprint: engagement.md switched to it, its key minted
 * (ensureKey — engagement init step 3), its baseline written (step 4), one
 * `review` run allocated by the real `run init`, and one file in every
 * per-run private location purge is responsible for.
 */
async function seedEngagement(repo, eid) {
  const st = join(repo, ST);
  writeFileSync(join(st, "engagement.md"), engagementMd({ ...defaultRecord(), engagement_id: eid }));
  const ctx = ctxOf(repo);
  const { key_id } = ensureKey(ctx, { engagement_id: eid });
  stepBaseline(ctx);
  const r = await runScript("evidence", ["run", "init", "--kind", "review", "--base", "HEAD~1"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const run_id = RUN_LINE.exec(r.stdout)[1];
  const files = {
    run: join(st, "runs", run_id, "run.json"),
    ledgerImport: join(st, "ledger", run_id, "imports", "a".repeat(64)),
    snapshot: join(st, "private", "snapshots", run_id, "src", "app.js"),
    citation: join(st, "private", "citations", run_id, `${"b".repeat(64)}.json`),
    receipt: join(st, "receipts", run_id, "claims-1.json"),
    baseline: join(st, "private", `baseline.${eid}.json`),
    key: join(st, "private", "keys", key_id),
  };
  writeFileSync(files.ledgerImport, "redacted import bytes\n");
  mkdirSync(join(files.snapshot, ".."), { recursive: true });
  writeFileSync(files.snapshot, "export const a = 2;\n");
  mkdirSync(join(files.citation, ".."), { recursive: true });
  writeFileSync(files.citation, "{}\n");
  mkdirSync(join(files.receipt, ".."), { recursive: true });
  writeFileSync(files.receipt, "{}\n");
  for (const [name, path] of Object.entries(files)) assert.ok(existsSync(path), `${eid}: ${name} seeded`);
  return { eid, key_id, run_id, files };
}

/**
 * Two engagements, A seeded first, then B — so `keys/current` names B's key
 * (ensureKey never reuses another engagement's key). Shared material that
 * purge must leave alone: `<st>/register/`, `.gitignore`, `knowledge/`,
 * `engagement.md`. `<st>/imports/` is the reserved ingest-input directory
 * purge removes (spec §6.9 lists `imports`).
 */
async function twoEngagements() {
  const repo = initRepo();
  writeFileSync(join(repo, ".gitignore"), IGNORE_BLOCK);
  git(repo, ["add", ".gitignore"]);
  git(repo, ["commit", "-q", "-m", "ignore block"]);
  const st = join(repo, ST);
  mkdirSync(st, { recursive: true });
  const a = await seedEngagement(repo, "eng-a");
  const b = await seedEngagement(repo, "eng-b");
  assert.notEqual(a.key_id, b.key_id);
  assert.notEqual(a.run_id, b.run_id);
  const shared = {
    imports: join(st, "imports", "scan.sarif"),
    register: join(st, "register", "events.jsonl"),
    knowledge: join(st, "knowledge", "finding-schema.md"),
    engagementMd: join(st, "engagement.md"),
    gitignore: join(repo, ".gitignore"),
  };
  mkdirSync(join(shared.imports, ".."), { recursive: true });
  writeFileSync(shared.imports, "{}\n");
  mkdirSync(join(shared.register, ".."), { recursive: true });
  writeFileSync(shared.register, "");
  mkdirSync(join(shared.knowledge, ".."), { recursive: true });
  writeFileSync(shared.knowledge, "# schema\n");
  const before = { gitignore: readFileSync(shared.gitignore), register: readFileSync(shared.register), engagementMd: readFileSync(shared.engagementMd) };
  return { repo, st, a, b, shared, before };
}

function purgedLine(stdout) {
  const lines = stdout.trimEnd().split("\n");
  const m = PURGED.exec(lines.at(-1));
  assert.ok(m, `last line is the PURGED token: ${JSON.stringify(stdout)}`);
  return { runs: Number(m[1]), keys: Number(m[2]), current: m[3], lines };
}

test("two engagements: purging one deletes its runs, ledger entries, snapshots, citations, baseline, keys, receipts, imports and nothing of the other", async () => {
  const { repo, st, a, b, shared } = await twoEngagements();
  assert.equal(readLedgerIndex(ctxOf(repo)).length, 2);

  const r = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { runs, keys, current, lines } = purgedLine(r.stdout);
  assert.equal(lines.length, 1, "stdout is exactly the PURGED line");
  assert.equal(runs, 1);
  assert.equal(keys, 1);
  assert.equal(current, "kept");

  // everything of A is gone — the directories, not just the files
  assert.ok(!existsSync(join(st, "runs", a.run_id)), "runs/<id>");
  assert.ok(!existsSync(join(st, "ledger", a.run_id)), "ledger/<id>");
  assert.ok(!existsSync(join(st, "ledger", `${a.run_id}.lock`)), "ledger/<id>.lock");
  assert.ok(!existsSync(join(st, "private", "snapshots", a.run_id)), "private/snapshots/<id>");
  assert.ok(!existsSync(join(st, "private", "citations", a.run_id)), "private/citations/<id>");
  assert.ok(!existsSync(join(st, "receipts", a.run_id)), "receipts/<id> (drop-box, TL-4)");
  assert.ok(!existsSync(a.files.baseline), "private/baseline.<eid>.json");
  assert.ok(!existsSync(a.files.key), "private/keys/<key_id>");
  assert.ok(!existsSync(shared.imports), "<st>/imports/");
  const ctx = ctxOf(repo);
  assert.deepEqual(keysOf(ctx, a.eid), [], "index.json rows of A removed");
  assert.deepEqual(
    readLedgerIndex(ctx).map((e) => e.run_id),
    [b.run_id],
    "ledger index keeps only B's entry",
  );

  // everything of B is intact
  for (const [name, path] of Object.entries(b.files)) assert.ok(existsSync(path), `B's ${name} untouched`);
  assert.deepEqual(keysOf(ctx, b.eid), [b.key_id]);
  assert.equal(currentKeyId(ctx), b.key_id);
  assert.deepEqual(Object.keys(readKeysIndex(ctx)), [b.key_id]);
  assert.equal(parseStrict(readFileSync(b.files.run)).payload.engagement_id, b.eid);
});

test("current key belongs to the purged engagement ⇒ keys/current removed; next engagement init creates a new key", async () => {
  const { repo, st, a, b } = await twoEngagements();
  assert.equal(currentKeyId(ctxOf(repo)), b.key_id, "fixture: current is B's key");

  const r = await runScript("evidence", ["purge", "--engagement", b.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(purgedLine(r.stdout).current, "removed");
  assert.ok(!existsSync(join(st, "private", "keys", "current")), "keys/current removed");
  assert.ok(!existsSync(b.files.key));
  assert.ok(existsSync(a.files.key), "A's key file stays");
  assert.deepEqual(keysOf(ctxOf(repo), a.eid), [a.key_id]);
  assert.equal(currentKeyId(ctxOf(repo)), null);

  // the next `engagement init` (step 3 = keys.ensureKey; the pipeline command
  // is TASK-008) mints a fresh key for B rather than reviving anything
  writeFileSync(join(st, "engagement.md"), engagementMd({ ...defaultRecord(), engagement_id: b.eid }));
  const next = ensureKey(ctxOf(repo), { engagement_id: b.eid });
  assert.equal(next.status, "created");
  assert.notEqual(next.key_id, b.key_id);
  assert.equal(currentKeyId(ctxOf(repo)), next.key_id);
  assert.deepEqual(keysOf(ctxOf(repo), b.eid), [next.key_id]);
  // and A's key is still A's: reinitialising A reuses nothing of B and nothing purged
  writeFileSync(join(st, "engagement.md"), engagementMd({ ...defaultRecord(), engagement_id: a.eid }));
  const again = ensureKey(ctxOf(repo), { engagement_id: a.eid });
  assert.equal(again.status, "created", "current names B's new key, so A gets its own (never another engagement's)");
  assert.deepEqual(keysOf(ctxOf(repo), a.eid), [a.key_id, again.key_id].sort());
});

test("current key belongs to the other engagement ⇒ kept", async () => {
  const { repo, st, a, b } = await twoEngagements();
  const r = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(purgedLine(r.stdout).current, "kept");
  assert.equal(readFileSync(join(st, "private", "keys", "current"), "utf8"), `${b.key_id}\n`, "pointer bytes unchanged");
  assert.ok(existsSync(b.files.key));
  assert.ok(!existsSync(a.files.key));
});

test("register/ and .gitignore untouched (and knowledge/, engagement.md, proposals/, handoffs/, reports/security/, tasks/security-*/)", async () => {
  const { repo, st, a, shared, before } = await twoEngagements();
  const outside = {
    proposal: join(st, "proposals", "P-0001.proposal.md"),
    handoff: join(st, "handoffs", "auth.md"),
    report: join(repo, "reports", "security", "report.md"),
    task: join(repo, "tasks", "security-my-product-admitted", "TC-1.md"),
    riskRegister: join(st, "risk-register.md"),
  };
  for (const path of Object.values(outside)) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "keep\n");
  }
  const r = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(readFileSync(shared.gitignore), before.gitignore, ".gitignore bytes unchanged (G-5)");
  assert.deepEqual(readFileSync(shared.register), before.register, "register/events.jsonl unchanged");
  assert.deepEqual(readFileSync(shared.engagementMd), before.engagementMd, "engagement.md unchanged");
  assert.ok(existsSync(shared.knowledge), "knowledge/ unchanged");
  for (const [name, path] of Object.entries(outside)) assert.equal(readFileSync(path, "utf8"), "keep\n", `${name} untouched`);
});

test("without --yes prints plan and exits 2; nothing deleted", async () => {
  const { repo, st, a, b, shared } = await twoEngagements();
  const r = await runScript("evidence", ["purge", "--engagement", a.eid], { cwd: repo, env: ENV });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  assert.match(lines.at(-1), /^USAGE\(purge: --yes/);
  const plan = lines.slice(0, -1);
  assert.ok(plan.length > 0, "the plan lists what would be deleted");
  for (const line of plan) assert.match(line, /^PURGE \.agents\/security-testing\//, line);
  const listed = plan.map((line) => line.slice("PURGE ".length));
  for (const rel of [
    `${ST}/runs/${a.run_id}`,
    `${ST}/ledger/${a.run_id}`,
    `${ST}/private/snapshots/${a.run_id}`,
    `${ST}/private/citations/${a.run_id}`,
    `${ST}/receipts/${a.run_id}`,
    `${ST}/private/baseline.${a.eid}.json`,
    `${ST}/private/keys/${a.key_id}`,
    `${ST}/imports`,
  ]) {
    assert.ok(listed.includes(rel.split("\\").join("/")), `plan names ${rel}: ${listed.join(", ")}`);
  }
  assert.ok(!listed.some((p) => p.includes(b.run_id) || p.includes(b.key_id) || p.endsWith(`baseline.${b.eid}.json`)), "nothing of B in the plan");
  assert.ok(!listed.includes(`${ST}/private/keys/current`), "current is B's — not in the plan");
  assert.doesNotMatch(r.stdout, /^PURGED /m, "no PURGED line without --yes");

  for (const path of [...Object.values(a.files), ...Object.values(b.files), shared.imports]) assert.ok(existsSync(path), `${path} still present`);
  assert.equal(readLedgerIndex(ctxOf(repo)).length, 2, "ledger index untouched");
  assert.deepEqual(keysOf(ctxOf(repo), a.eid), [a.key_id]);
  assert.ok(existsSync(join(st, "private", "keys", "current")));
});

test("plan for the current engagement names keys/current; an unknown engagement is an empty plan", async () => {
  const { repo, b } = await twoEngagements();
  const r = await runScript("evidence", ["purge", "--engagement", b.eid], { cwd: repo, env: ENV });
  assert.equal(r.code, 2);
  assert.ok(r.stdout.split("\n").includes(`PURGE ${ST}/private/keys/current`), r.stdout);

  const none = await runScript("evidence", ["purge", "--engagement", "eng-nobody", "--yes"], { cwd: repo, env: ENV });
  assert.equal(none.code, 0, none.stdout + none.stderr);
  assert.equal(none.stdout, "PURGED runs=0 keys=0 current-key=kept\n");
  assert.ok(existsSync(join(repo, ST, "imports")), "an engagement with no material deletes nothing — imports/ included");
});

test("a tracked target refuses: exit 4 TRACKED(<path>), nothing deleted (defense in depth)", async () => {
  const { repo, a, b, shared } = await twoEngagements();
  git(repo, ["add", "-f", `${ST}/runs/${a.run_id}/run.json`]);
  const r = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.equal(r.stdout, `TRACKED(${ST}/runs/${a.run_id}/run.json)\n`);
  for (const path of [...Object.values(a.files), ...Object.values(b.files), shared.imports]) assert.ok(existsSync(path), `${path} still present`);
  assert.equal(readLedgerIndex(ctxOf(repo)).length, 2);
  assert.deepEqual(keysOf(ctxOf(repo), a.eid), [a.key_id]);

  // a tracked file under another engagement's target dir refuses too: the
  // check is over the target directories, not over the plan
  git(repo, ["reset", "-q", "--", `${ST}/runs/${a.run_id}/run.json`]);
  git(repo, ["add", "-f", `${ST}/private/keys/${b.key_id}`]);
  const other = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(other.code, 4);
  assert.equal(other.stdout, `TRACKED(${ST}/private/keys/${b.key_id})\n`);
  assert.ok(existsSync(a.files.run));
});

test("argv: --engagement is required; positionals and unknown flags are usage errors; nothing deleted", async () => {
  const { repo, a } = await twoEngagements();
  const missing = await runScript("evidence", ["purge", "--yes"], { cwd: repo, env: ENV });
  assert.equal(missing.code, 2);
  assert.match(missing.stdout, /^USAGE\(purge: --engagement/);
  const extra = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes", "now"], { cwd: repo, env: ENV });
  assert.equal(extra.code, 2);
  assert.match(extra.stdout, /^USAGE\(purge: unexpected argument now\)/);
  const unknown = await runScript("evidence", ["purge", "--engagement", a.eid, "--force"], { cwd: repo, env: ENV });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /^USAGE\(purge: unknown flag --force\)/);
  const bad = await runScript("evidence", ["purge", "--engagement", "../x", "--yes"], { cwd: repo, env: ENV });
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /^ENGAGEMENT-INVALID\(\$\.engagement_id/);
  assert.ok(existsSync(a.files.run));
});

test("a run directory whose run.json is not the artifact it claims to be ⇒ exit 5 INCONSISTENT(runs/<id>), nothing deleted", async () => {
  const { repo, a, b } = await twoEngagements();
  // every occurrence: the envelope is outside the preimage, so editing only
  // its engagement_id would still read as a consistent artifact
  writeFileSync(b.files.run, readFileSync(b.files.run, "utf8").replaceAll(b.eid, "eng-x"));
  const r = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(r.code, 5, r.stdout + r.stderr);
  assert.equal(r.stdout, `INCONSISTENT(runs/${b.run_id})\n`);
  assert.ok(existsSync(a.files.run), "a run that cannot be attributed blocks the purge before anything is deleted");
  assert.ok(existsSync(a.files.key));
});

test("interrupted purge: run.json goes last, so a re-run still attributes the leftovers and finishes the job", async () => {
  const { repo, st, a, b, shared } = await twoEngagements();
  // The furthest a correctly ordered execute() gets before the attribution
  // record: every satellite tree of A and imports/ are gone, runs/<id> (with
  // run.json) and the ledger index entry remain.
  for (const p of [
    join(st, "ledger", a.run_id),
    join(st, "receipts", a.run_id),
    join(st, "private", "snapshots", a.run_id),
    join(st, "private", "citations", a.run_id),
    join(st, "imports"),
  ]) rmSync(p, { recursive: true, force: true });
  assert.ok(existsSync(a.files.run), "fixture: run.json is what survives the interruption");
  assert.equal(readLedgerIndex(ctxOf(repo)).length, 2, "fixture: the ledger entry survived too");

  const r = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const { runs, keys } = purgedLine(r.stdout);
  assert.equal(runs, 1, "the run is still attributable, so the re-run counts it");
  assert.equal(keys, 1);
  assert.ok(!existsSync(join(st, "runs", a.run_id)), "runs/<id> gone on the re-run");
  assert.ok(!existsSync(a.files.baseline));
  assert.ok(!existsSync(a.files.key));
  assert.deepEqual(readLedgerIndex(ctxOf(repo)).map((e) => e.run_id), [b.run_id], "A's ledger entry dropped on the re-run");
  for (const [name, path] of Object.entries(b.files)) assert.ok(existsSync(path), `B's ${name} untouched`);
  assert.ok(!existsSync(shared.imports));
});

// A real mid-cleanup failure: `<st>/ledger/` made read-only so removing
// `ledger/<id>` throws (exit 1 INTERNAL). The attribution record must still
// be there afterwards — an order that deleted runs/<id> first would have
// orphaned receipts/, citations/ and the ledger entry beyond purge's reach.
// chmod is a no-op for this purpose on Windows and for root.
const CAN_DENY = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;
test("purge that fails mid-cleanup keeps run.json (attribution) and the ledger entry, so the re-run reaches everything", { skip: !CAN_DENY }, async () => {
  const { repo, st, a, b } = await twoEngagements();
  const ledger = join(st, "ledger");
  chmodSync(ledger, 0o555);
  try {
    const r = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
    assert.equal(r.code, 1, `interrupted purge is INTERNAL: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /^PURGED /m, "no success token from a purge that did not finish");
    assert.ok(existsSync(a.files.run), "runs/<id>/run.json — the attribution record — survives the interruption");
    assert.ok(existsSync(a.files.receipt), "receipts/<id> not orphaned: still attributable through run.json");
    assert.ok(existsSync(a.files.citation));
    assert.ok(existsSync(a.files.snapshot));
    assert.equal(readLedgerIndex(ctxOf(repo)).length, 2, "ledger index untouched");
    assert.deepEqual(keysOf(ctxOf(repo), a.eid), [a.key_id], "keys untouched: they come after the run trees");
  } finally {
    chmodSync(ledger, 0o755);
  }

  const again = await runScript("evidence", ["purge", "--engagement", a.eid, "--yes"], { cwd: repo, env: ENV });
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.equal(purgedLine(again.stdout).runs, 1, "the re-run attributes the run and finishes");
  for (const path of Object.values(a.files)) assert.ok(!existsSync(path), `${path} gone after the re-run`);
  assert.ok(!existsSync(join(st, "ledger", a.run_id)));
  assert.ok(!existsSync(join(st, "receipts", a.run_id)));
  assert.deepEqual(readLedgerIndex(ctxOf(repo)).map((e) => e.run_id), [b.run_id]);
  for (const [name, path] of Object.entries(b.files)) assert.ok(existsSync(path), `B's ${name} untouched`);
});

test("cmd-purge imports: no child process of its own, no network, no .gitignore writer (G-5, G-6, G-14)", () => {
  const src = readFileSync(new URL("./cmd-purge.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /child_process|\bfetch\(|node:http|node:net|node:dns/);
  assert.doesNotMatch(src, /writeFileSync|"\.gitignore"/, "no writer of its own, and never .gitignore");
  assert.doesNotMatch(src, /console\.(log|error)|process\.stdout|process\.stderr/, "stdout/stderr only through ctx (G-4)");
  assert.doesNotMatch(src, /\brmSync\b|\bunlinkSync\b/, "deletion only through fsx.rmTree");
});
