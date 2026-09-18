import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REG = new URL("./register.mjs", import.meta.url).pathname;
const ST = ".agents/security-testing";
const LOG = `${ST}/register/events.jsonl`;
const FINDING_A = "a".repeat(64);
const FINDING_B = "b".repeat(64);

const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [REG, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, USER: "env-user" } });
  return { code: r.status, out: r.stdout.trim().split("\n"), err: r.stderr };
};
const git = (root, argv) => execFileSync("git", argv, { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", windowsHide: true }).trim();

/** mkdtemp + git init + one empty commit + an engagement record. */
function tmpRepoWithEngagement(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "st-register-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "t@t"]);
  git(root, ["config", "user.name", "t"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", "c0"]);
  mkdirSync(join(root, ST), { recursive: true });
  writeFileSync(join(root, `${ST}/engagement.md`), "```json engagement\n" + JSON.stringify({ engagement_id: "acme-2026-09", slug: "acme", scope_paths: ["src/"], ...extra }) + "\n```\n");
  return root;
}
const readLog = (root) => readFileSync(join(root, LOG), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

test("add → status → render; duplicate finding id refused", () => {
  const root = tmpRepoWithEngagement();
  let r = run(root, "add", "--finding", FINDING_A, "--priority", "p2", "--title", "Hard-coded credential", "--by", "lead");
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "ROW R-0001 open");
  const events = readLog(root);
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]), ["seq", "ts", "actor", "row_id", "event", "payload"]);
  assert.equal(events[0].seq, 1);
  assert.match(events[0].ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(events[0].actor, "lead");
  assert.equal(events[0].row_id, "R-0001");
  assert.equal(events[0].event, "add");
  assert.deepEqual(events[0].payload, { finding_id: FINDING_A, title: "Hard-coded credential", priority: "p2", owner: "" });

  r = run(root, "add", "--finding", FINDING_A, "--priority", "p2", "--title", "dup");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "REFUSED live row R-0001 already has finding aaaaaaaa…");
  assert.equal(readLog(root).length, 1, "a refused add writes nothing");

  r = run(root, "status");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.ok(r.out.includes("COUNT open=1"), r.out.join("\n"));
  assert.ok(r.out.includes("COUNT superseded=0"));
  assert.ok(r.out.includes("OPEN-EXPOSURE p0=0 p1=0 p2=1 p3=0"));
  assert.ok(r.out.includes("UNAUTHENTICATED-APPROVALS 0"));
  assert.match(r.out.at(-1), /^FINGERPRINT acme-2026-09:1:[0-9a-f]{64}$/);
  assert.equal(r.out.at(-1).split(":")[2], sha256(readFileSync(join(root, LOG))), "the fingerprint hashes the log bytes");

  r = run(root, "status", "--json");
  assert.equal(r.code, 0);
  const json = JSON.parse(r.out.join("\n"));
  assert.equal(json.engagement_id, "acme-2026-09");
  assert.equal(json.seq, 1);
  assert.equal(json.rows.length, 1);
  assert.equal(json.rows[0].finding_id, FINDING_A);
  assert.equal(json.open_exposure.p2, 1);

  r = run(root, "render");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out[0], "RENDERED .agents/security-testing/risk-register.md");
  const md = readFileSync(join(root, `${ST}/risk-register.md`), "utf8");
  assert.match(md, /\| R-0001 \| .* \| open \|/);
  assert.match(md, /^## Rows$/m);
  assert.match(md, /^## Superseded$/m);
  assert.match(md, /^## Open exposure$/m);
  assert.match(md, /^## Unauthenticated approvals$/m);
  assert.ok(md.includes("None of these records is authenticated"));
  assert.ok(!md.includes(FINDING_A), "the view carries the short finding id");
});

test("add validates its flags; the actor falls back to $USER", () => {
  const root = tmpRepoWithEngagement();
  let r = run(root, "add", "--finding", "abc", "--priority", "p2", "--title", "x");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(add: /);
  r = run(root, "add", "--finding", FINDING_A, "--priority", "p9", "--title", "x");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(add: /);
  r = run(root, "add", "--finding", FINDING_A, "--priority", "p1");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(add: --title/);
  assert.ok(!existsSync(join(root, LOG)), "nothing is written before the payload is valid");
  r = run(root, "add", "--finding", FINDING_A, "--priority", "p1", "--title", "Title | with pipe", "--owner", "team-a");
  assert.equal(r.code, 0);
  const ev = readLog(root)[0];
  assert.equal(ev.actor, "env-user");
  assert.equal(ev.payload.owner, "team-a");
  r = run(root, "render");
  assert.equal(r.code, 0);
  assert.ok(readFileSync(join(root, `${ST}/risk-register.md`), "utf8").includes("Title \\| with pipe"), "a pipe in a title is escaped");
});

test("accept is unauthenticated and never reduces open exposure; expiry via check", () => {
  const root = tmpRepoWithEngagement();
  assert.equal(run(root, "add", "--finding", FINDING_A, "--priority", "p2", "--title", "t").code, 0);
  let r = run(root, "accept", "R-0001", "--until", "2026-01-01", "--approved-by", "CISO", "--approval-ref", "JIRA-1", "--by", "lead");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out[0], "ROW R-0001 accepted");
  const last = readLog(root).at(-1);
  assert.equal(last.event, "accept");
  assert.deepEqual(last.payload, { recorded_by: "lead", approved_by: "CISO", approval_ref: "JIRA-1", authenticated: false, until: "2026-01-01" });
  assert.equal(last.payload.authenticated, false);

  r = run(root, "status");
  assert.ok(r.out.includes("COUNT accepted=1"), r.out.join("\n"));
  assert.ok(r.out.includes("OPEN-EXPOSURE p0=0 p1=0 p2=1 p3=0"), "an approval never subtracts from exposure");
  assert.ok(r.out.includes("UNAUTHENTICATED-APPROVALS 1"));
  r = run(root, "render");
  assert.equal(r.code, 0);
  assert.match(readFileSync(join(root, `${ST}/risk-register.md`), "utf8"), /\| R-0001 \| acceptance \| CISO \| JIRA-1 \| 2026-01-01 \|/);

  // an authenticated flag has no spelling on the CLI; the payload is always `authenticated: false`
  r = run(root, "accept", "R-0001", "--until", "2026-01-01", "--approved-by", "x", "--approval-ref", "y", "--authenticated", "true");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(accept: /);

  r = run(root, "check");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out[0], "EXPIRED R-0001");
  assert.equal(readLog(root).at(-1).event, "acceptance-expired");
  assert.deepEqual(readLog(root).at(-1).payload, { until: "2026-01-01" });
  r = run(root, "status");
  assert.ok(r.out.includes("COUNT open=1"), r.out.join("\n"));
  assert.ok(r.out.includes("COUNT accepted=0"));
  assert.ok(r.out.includes("UNAUTHENTICATED-APPROVALS 0"));
  r = run(root, "check");
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, [""], "nothing to expire prints nothing");

  // accept with a future date is not expired; revoke returns it to open
  assert.equal(run(root, "accept", "R-0001", "--until", "2999-12-31", "--approved-by", "CISO", "--approval-ref", "JIRA-2").code, 0);
  assert.equal(run(root, "check").out[0], "");
  r = run(root, "revoke", "R-0001", "--approved-by", "CISO", "--approval-ref", "JIRA-3");
  assert.equal(r.out[0], "ROW R-0001 open");
  assert.equal(readLog(root).at(-1).payload.authenticated, false);
  r = run(root, "revoke", "R-0001");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "REFUSED revoke not allowed from open");
});

test("fixed/regressed via --verify, ticket, supersede, --expect", () => {
  const root = tmpRepoWithEngagement();
  assert.equal(run(root, "add", "--finding", FINDING_A, "--priority", "p1", "--title", "one").code, 0);
  const verifyDir = join(root, `${ST}/verify/aaaaaaaa-deadbee`);
  mkdirSync(verifyDir, { recursive: true });
  const verifyPath = join(verifyDir, "verify.json");
  writeFileSync(verifyPath, JSON.stringify({ verdict: "VERIFIED", head: "deadbeef" }));

  let r = run(root, "fixed", "R-0001");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(fixed: --verify/);
  r = run(root, "fixed", "R-0001", "--verify", verifyPath);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out[0], "ROW R-0001 fixed");
  let last = readLog(root).at(-1);
  assert.equal(last.event, "fixed");
  assert.deepEqual(last.payload, { verify: ".agents/security-testing/verify/aaaaaaaa-deadbee/verify.json", verdict: "VERIFIED", head: "deadbeef" });

  r = run(root, "regressed", "R-0001", "--verify", verifyPath);
  assert.equal(r.out[0], "ROW R-0001 regressed");
  r = run(root, "regressed", "R-0001", "--verify", verifyPath);
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "REFUSED regressed not allowed from regressed");

  r = run(root, "ticket", "R-0001", "https://x/1");
  assert.equal(r.out[0], "ROW R-0001 regressed", "ticket leaves the status alone");
  r = run(root, "status", "--json");
  assert.equal(JSON.parse(r.out.join("\n")).rows[0].ticket_url, "https://x/1");
  assert.equal(run(root, "ticket", "R-0001").code, 2);

  assert.equal(run(root, "add", "--finding", FINDING_B, "--priority", "p3", "--title", "two").out[0], "ROW R-0002 open");
  r = run(root, "supersede", "R-0002", "--by", "R-0009");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "REFUSED supersede target R-0009 does not exist");
  r = run(root, "supersede", "R-0002", "--by", "R-0002");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "REFUSED a row cannot supersede itself");
  r = run(root, "supersede", "R-0002", "--by", "R-0001");
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out[0], "ROW R-0002 superseded");
  last = readLog(root).at(-1);
  assert.equal(last.actor, "env-user", "supersede's --by is the target row, not the actor");
  assert.deepEqual(last.payload, { by: "R-0001" });
  r = run(root, "status");
  assert.ok(r.out.includes("COUNT superseded=1"), r.out.join("\n"));
  assert.ok(r.out.includes("COUNT regressed=1"));
  assert.ok(r.out.includes("OPEN-EXPOSURE p0=0 p1=1 p2=0 p3=0"));
  const fp = r.out.at(-1);
  assert.match(fp, /^FINGERPRINT acme-2026-09:6:[0-9a-f]{64}$/);
  assert.equal(run(root, "add", "--finding", FINDING_B, "--priority", "p3", "--title", "two again").out[0], "ROW R-0003 open", "a superseded row no longer holds its finding id");
  r = run(root, "render");
  assert.equal(r.code, 0);
  const md = readFileSync(join(root, `${ST}/risk-register.md`), "utf8");
  assert.match(md, /^## Superseded\n\n\| id \| superseded by \| finding \| title \|\n\| --- \| --- \| --- \| --- \|\n\| R-0002 \| R-0001 \| bbbbbbbb… \| two \|$/m);

  r = run(root, "status", "--expect", fp);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out.at(-1), "ADVANCED");
  const current = r.out.at(-2);
  assert.match(current, /^FINGERPRINT acme-2026-09:7:/);
  r = run(root, "status", "--expect", current);
  assert.equal(r.code, 0);
  assert.equal(r.out.at(-1), "MATCH");
  const fabricated = `acme-2026-09:7:${"0".repeat(64)}`;
  r = run(root, "status", "--expect", fabricated);
  assert.equal(r.code, 4);
  assert.equal(r.out.at(-1), "DIVERGED");
  r = run(root, "status", "--expect", "other-2026-01:1:" + "0".repeat(64));
  assert.equal(r.code, 4);
  assert.equal(r.out.at(-1), "DIVERGED");
  r = run(root, "status", "--expect", "nonsense");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(status: /);
});

test("a corrupt log line ⇒ exit 5 CORRUPT and no write", () => {
  const root = tmpRepoWithEngagement();
  assert.equal(run(root, "add", "--finding", FINDING_A, "--priority", "p2", "--title", "t").code, 0);
  assert.equal(run(root, "ticket", "R-0001", "https://x/1").code, 0);
  appendFileSync(join(root, LOG), "not json\n");
  const before = readFileSync(join(root, LOG), "utf8");
  let r = run(root, "add", "--finding", FINDING_B, "--priority", "p2", "--title", "t2");
  assert.equal(r.code, 5, r.out.join("\n") + r.err);
  assert.ok(r.out[0].startsWith("CORRUPT events.jsonl:3"), r.out[0]);
  assert.equal(readFileSync(join(root, LOG), "utf8"), before, "no write on a corrupt log");
  assert.equal(run(root, "status").code, 5);
  assert.equal(run(root, "render").code, 5);
  assert.ok(!existsSync(join(root, `${ST}/risk-register.md`)));

  // a syntactically fine line that the transition table refuses is corrupt too
  writeFileSync(join(root, LOG), before.split("\n").slice(0, 2).join("\n") + "\n" + JSON.stringify({ seq: 3, ts: "2026-01-01T00:00:00.000Z", actor: "x", row_id: "R-0001", event: "regressed", payload: { verify: "v", verdict: "", head: "" } }) + "\n");
  r = run(root, "status");
  assert.equal(r.code, 5);
  assert.ok(r.out[0].startsWith("CORRUPT events.jsonl:3"), r.out[0]);
  // and a seq gap
  writeFileSync(join(root, LOG), before.split("\n").slice(0, 2).join("\n") + "\n" + JSON.stringify({ seq: 5, ts: "2026-01-01T00:00:00.000Z", actor: "x", row_id: "R-0001", event: "ticket", payload: { ticket_url: "u" } }) + "\n");
  r = run(root, "status");
  assert.equal(r.code, 5);
  assert.ok(r.out[0].startsWith("CORRUPT events.jsonl:3"), r.out[0]);

  // a hand-edited payload key never echoes raw in the CORRUPT line
  const awsKey = "AKIA" + "A".repeat(16);
  writeFileSync(join(root, LOG), before.split("\n").slice(0, 2).join("\n") + "\n" + JSON.stringify({ seq: 3, ts: "2026-01-01T00:00:00.000Z", actor: "x", row_id: "R-0001", event: "ticket", payload: { [awsKey]: "u" } }) + "\n");
  r = run(root, "status");
  assert.equal(r.code, 5);
  assert.ok(r.out[0].startsWith("CORRUPT events.jsonl:3") && r.out[0].includes("<REDACTED:aws-key>") && !r.out[0].includes(awsKey), r.out[0]);

  // a hand-edited line that folds fine still prints and renders redacted (belt and braces)
  writeFileSync(join(root, LOG), before.split("\n").slice(0, 2).join("\n") + "\n" + JSON.stringify({ seq: 3, ts: "2026-01-01T00:00:00.000Z", actor: "x", row_id: "R-0001", event: "ticket", payload: { ticket_url: "https://x/?token=hunter22222" } }) + "\n");
  r = run(root, "status", "--json");
  assert.equal(r.code, 0, r.out.join("\n"));
  const doc = JSON.parse(r.out.join("\n"));
  assert.equal(doc.rows[0].ticket_url, "https://x/?token=<REDACTED:key-value>");
  assert.equal(doc.rows[0].finding_id, FINDING_A, "identity hex survives the pass");
  assert.match(doc.fingerprint, /^acme-2026-09:3:[0-9a-f]{64}$/, "the computed fingerprint is untouched");
  assert.equal(run(root, "render").code, 0);
  const md = readFileSync(join(root, `${ST}/risk-register.md`), "utf8");
  assert.ok(md.includes("token=<REDACTED:key-value>") && !md.includes("hunter22222"), md);
});

test("a confirm verb does not exist; an unknown row is refused; the engagement is required", () => {
  const root = tmpRepoWithEngagement();
  assert.equal(run(root, "add", "--finding", FINDING_A, "--priority", "p2", "--title", "t").code, 0);
  let r = run(root, "confirm", "R-0001");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "USAGE(register: unknown command confirm)");
  r = run(root, "reopen", "R-0007", "--reason", "x");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "REFUSED no row R-0007");
  r = run(root, "reopen", "bogus", "--reason", "x");
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(reopen: /);
  r = run(root, "close-false-positive", "R-0001", "--approved-by", "lead", "--approval-ref", "n/a");
  assert.equal(r.out[0], "ROW R-0001 false-positive");
  r = run(root, "status");
  assert.ok(r.out.includes("OPEN-EXPOSURE p0=0 p1=0 p2=0 p3=0"), r.out.join("\n"));
  assert.ok(r.out.includes("UNAUTHENTICATED-APPROVALS 1"));
  assert.equal(run(root, "add", "--finding", FINDING_A, "--priority", "p2", "--title", "t").out[0], "ROW R-0002 open", "a false-positive row no longer holds its finding id");
  r = run(root, "reopen", "R-0001", "--reason", "it is real");
  assert.equal(r.out[0], "ROW R-0001 open");
  assert.equal(run(root, "status").out.filter((l) => l.startsWith("COUNT ")).length, 6);

  const bare = mkdtempSync(join(tmpdir(), "st-register-bare-"));
  git(bare, ["init", "-q"]);
  r = run(bare, "status");
  assert.equal(r.code, 2);
  assert.equal(r.out[0], "ENGAGEMENT-MISSING");
});

test("fixed/regressed are exported for verify.mjs and never print", async () => {
  const root = tmpRepoWithEngagement();
  assert.equal(run(root, "add", "--finding", FINDING_A, "--priority", "p0", "--title", "t").code, 0);
  const mod = await import(REG);
  assert.equal(typeof mod.fixed, "function");
  assert.equal(typeof mod.regressed, "function");
  assert.equal(typeof mod.foldEvents, "function");
  assert.equal(typeof mod.readLog, "function");
  const verifyPath = join(root, `${ST}/verify/aaaaaaaa-deadbee/verify.json`);
  mkdirSync(join(root, `${ST}/verify/aaaaaaaa-deadbee`), { recursive: true });
  writeFileSync(verifyPath, JSON.stringify({ verdict: "VERIFIED", head: "deadbeef" }));
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    written.push(String(chunk));
    return true;
  };
  try {
    assert.deepEqual(mod.fixed(root, "R-0001", verifyPath, "verify"), { id: "R-0001", status: "fixed" });
    assert.deepEqual(mod.regressed(root, "R-0001", verifyPath), { id: "R-0001", status: "regressed" });
  } finally {
    process.stdout.write = realWrite;
  }
  assert.deepEqual(written, [], "the in-process entry points write nothing to stdout");
  assert.equal(readLog(root).at(-2).actor, "verify");
  assert.throws(() => mod.regressed(root, "R-0001", verifyPath), /regressed not allowed from regressed/);
  assert.throws(() => mod.fixed(root, "R-0009", verifyPath), /no row R-0009/);
  assert.throws(() => mod.fixed(root, "token=hunter22222", verifyPath), { name: "UsageError", message: "a row id R-nnnn is required" }, "a bogus row id is refused by shape, never echoed");
  const { rows, seq } = mod.foldEvents(mod.readLog(root));
  assert.equal(seq, 3);
  assert.equal(rows.get("R-0001").status, "regressed");
  assert.equal(mod.rowForFinding(rows, FINDING_A).id, "R-0001");
  assert.equal(mod.rowForFinding(rows, FINDING_B), undefined);
});

test("redaction runs before any write: payload strings, the actor and an echoed --verify path", () => {
  const root = tmpRepoWithEngagement();
  const bearer = "Bearer " + "x".repeat(36);
  const awsKey = "AKIA" + "A".repeat(16);
  let r = run(root, "add", "--finding", FINDING_A, "--priority", "p1", "--title", `leak ${bearer}`, "--owner", awsKey, "--by", "token=supersecret1");
  assert.equal(r.code, 0, r.out.join("\n") + r.err);
  assert.equal(r.out[0], "ROW R-0001 open");
  const log = readFileSync(join(root, LOG), "utf8");
  assert.ok(log.includes("<REDACTED:bearer>"), log);
  assert.ok(log.includes("<REDACTED:aws-key>"), log);
  assert.ok(log.includes("token=<REDACTED:key-value>"), "the actor is redacted too");
  assert.ok(!log.includes("x".repeat(36)) && !log.includes(awsKey) && !log.includes("supersecret1"), "no raw secret reaches events.jsonl");
  const ev = readLog(root)[0];
  assert.equal(ev.payload.finding_id, FINDING_A, "finding_id is identity and stays full hex");
  assert.equal(ev.payload.title, "leak Bearer <REDACTED:bearer>");
  assert.equal(ev.payload.owner, "<REDACTED:aws-key>");

  r = run(root, "render");
  assert.equal(r.code, 0);
  const md = readFileSync(join(root, `${ST}/risk-register.md`), "utf8");
  assert.ok(md.includes("<REDACTED:bearer>") && md.includes("<REDACTED:aws-key>"), md);
  assert.ok(!md.includes("x".repeat(36)) && !md.includes(awsKey), "no raw secret reaches risk-register.md");
  r = run(root, "status", "--json");
  assert.equal(JSON.parse(r.out.join("\n")).rows[0].finding_id, FINDING_A, "status --json still carries the full finding id");

  // a 40-hex head is identity, never redacted (high-entropy would otherwise eat it)
  const head = "0123456789abcdef".repeat(2) + "01234567";
  assert.equal(head.length, 40);
  const verifyDir = join(root, `${ST}/verify/aaaaaaaa-0123456`);
  mkdirSync(verifyDir, { recursive: true });
  const verifyPath = join(verifyDir, "verify.json");
  writeFileSync(verifyPath, JSON.stringify({ verdict: "VERIFIED", head }));
  r = run(root, "fixed", "R-0001", "--verify", verifyPath);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(readLog(root).at(-1).payload.head, head);

  // a `head` that is not a full oid is content, not identity: redacted before the append (review 2)
  writeFileSync(verifyPath, JSON.stringify({ verdict: "VERIFIED", head: `${awsKey} and token=hunter22222` }));
  r = run(root, "regressed", "R-0001", "--verify", verifyPath);
  assert.equal(r.code, 0, r.out.join("\n"));
  const afterHead = readFileSync(join(root, LOG), "utf8");
  assert.ok(afterHead.includes("<REDACTED:aws-key>"), afterHead);
  assert.ok(!afterHead.includes(awsKey) && !afterHead.includes("hunter22222"), "a non-hex head never reaches events.jsonl raw");
  assert.equal(readLog(root).at(-1).payload.head, "<REDACTED:aws-key> and token=<REDACTED:key-value>");

  // a relative --verify resolves against the invoking cwd, not the root
  const rel = spawnSync(process.execPath, [REG, "fixed", "R-0001", "--verify", "verify.json"], { cwd: verifyDir, encoding: "utf8", env: { ...process.env, USER: "env-user" } });
  assert.equal(rel.status, 0, rel.stdout + rel.stderr);
  assert.equal(readLog(root).at(-1).payload.verify, `${ST}/verify/aaaaaaaa-0123456/verify.json`, "recorded root-relative regardless of cwd");

  // the --verify path echoed in a USAGE line is redacted
  r = run(root, "regressed", "R-0001", "--verify", `no/such/${bearer}.json`);
  assert.equal(r.code, 2);
  assert.match(r.out[0], /^USAGE\(regressed: no such file /);
  assert.ok(r.out[0].includes("<REDACTED:bearer>") && !r.out[0].includes("x".repeat(36)), r.out[0]);
});

test("--expect parses an engagement id that itself contains a colon", () => {
  const root = tmpRepoWithEngagement({ engagement_id: "acme:2026" });
  assert.equal(run(root, "add", "--finding", FINDING_A, "--priority", "p2", "--title", "t").code, 0);
  let r = run(root, "status");
  const fp = r.out.at(-1);
  assert.match(fp, /^FINGERPRINT acme:2026:1:[0-9a-f]{64}$/);
  r = run(root, "status", "--expect", fp);
  assert.equal(r.code, 0, r.out.join("\n"));
  assert.equal(r.out.at(-1), "MATCH");
});
