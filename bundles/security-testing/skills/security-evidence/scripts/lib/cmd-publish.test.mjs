// TASK-031 — `evidence.mjs publish --run <id> --profile <p> --to <dest>`
// (plan §4.1 row `publish`, §5 TASK-031; spec §6.9 "Publication", §9.4 / P4;
// US-023 AC-1, AC-2; US-039 AC-1 (payload level), AC-3 (first dedupe layer);
// G-5: the one command that writes outside the bundle's own paths). Every
// run is built in a temp repo by the real commands (fixtures/publish/setup).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrict, readArtifact, sha256Hex } from "../canon.mjs";
import { cleanupAll } from "../fixtures/cli/harness.mjs";
import { ctxFor, readyRepo } from "../fixtures/ingest/setup.mjs";
import { ENV, ST, committedReviewRun, evidence, ingestTicket, register, registerAdd } from "../fixtures/publish/setup.mjs";
import { exportIdentity } from "./profiles/index.mjs";
import { TICKET_KEYS } from "./profiles/tracker.mjs";
import { append } from "./register-core.mjs";
import { validate } from "./schema.mjs";

after(cleanupAll);

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET = "password=1234";
const HANDOFFS = join(ST, "handoffs");
const lines = (s) => s.split("\n").filter((l) => l !== "");
const publish = (repo, run_id, profile, to, extra = []) => evidence(repo, ["publish", "--run", run_id, ...(profile === null ? [] : ["--profile", profile]), "--to", to, ...extra]);
const listAll = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).sort() : []);

test("each profile emits only its allowed fields; full-report needs the explicit profile; no default profile (US-023 AC-1)", async () => {
  const { repo, run_id, dir, ids } = await committedReviewRun();
  const original = readFileSync(join(dir, "report.md"), "utf8");
  assert.ok(original.includes("req.query.id;"), "the run's report shows snippets");

  const r = await publish(repo, run_id, "redacted-report", "reports/security/review-1");
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.equal(out.length, 2);
  assert.match(out[0], /^PUBLISHED profile=redacted-report output=reports\/security\/review-1\/report\.md sha256=[0-9a-f]{64}$/);
  assert.match(out[1], /^WROTE reports\/security\/review-1\/export-manifest\.json sha256=[0-9a-f]{64}$/);
  assert.deepEqual(listAll(join(repo, "reports", "security", "review-1")), ["export-manifest.json", "report.md"]);
  const redacted = readFileSync(join(repo, "reports", "security", "review-1", "report.md"), "utf8");
  assert.ok(!redacted.includes("req.query.id;"), "no snippet");
  assert.ok(!redacted.includes("<REDACTED:password-assign>"), "not even redacted evidence");
  assert.doesNotMatch(redacted, /^\| reproduction \|/m);
  assert.ok(!redacted.includes(".agents/"), "no infra path");
  for (const id of [ids.injection, ids.secret, ids.app]) assert.ok(redacted.includes(id));
  assert.equal(out[0].slice(-64), sha256Hex(readFileSync(join(repo, "reports", "security", "review-1", "report.md"))), "PUBLISHED carries the file's own sha256");

  const f = await publish(repo, run_id, "full-report", "reports/security/full-1");
  assert.equal(f.code, 0, `${f.stdout}${f.stderr}`);
  const fout = lines(f.stdout);
  assert.equal(fout.length, 3);
  assert.match(fout[0], /^PUBLISHED profile=full-report output=reports\/security\/full-1\/report\.md sha256=/);
  assert.match(fout[1], /^PUBLISHED profile=full-report output=reports\/security\/full-1\/findings\.json sha256=/);
  assert.match(fout[2], /^WROTE reports\/security\/full-1\/export-manifest\.json sha256=/);
  assert.equal(readFileSync(join(repo, "reports", "security", "full-1", "report.md"), "utf8"), original, "full-report is the report verbatim");
  const findings = parseStrict(readFileSync(join(repo, "reports", "security", "full-1", "findings.json")));
  assert.equal(findings.findings.find((x) => x.id === ids.injection).snippet, 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);');
  assert.ok(!readFileSync(join(repo, "reports", "security", "full-1", "findings.json"), "utf8").includes(SECRET));

  const none = await publish(repo, run_id, null, "reports/security/x");
  assert.equal(none.code, 2);
  assert.match(none.stdout, /^USAGE\(publish: --profile is required \(redacted-report\|full-report\|tracker\|handoff\|case\); there is no default\)$/m);
  assert.ok(!existsSync(join(repo, "reports", "security", "x")));
  const unknown = await publish(repo, run_id, "pdf", "reports/security/x");
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /^USAGE\(publish: --profile must be one of /m);
  // the M3 profiles (TASK-043) on a run without admissions: case refuses (nothing to publish), handoff needs its fixed destination
  const noCase = await publish(repo, run_id, "case", "tasks/security-my-product-admitted");
  assert.equal(noCase.code, 2);
  assert.match(noCase.stdout, /^USAGE\(publish: run [0-9a-f]{12}-\d{4} has no admitted case \(plan\.mjs admit first\); nothing to publish\)$/m);
  assert.ok(!existsSync(join(repo, "tasks")));
  const wrongTo = await publish(repo, run_id, "handoff", "tasks/security-x-admitted");
  assert.equal(wrongTo.code, 2);
  assert.match(wrongTo.stdout, /^USAGE\(publish: --to must be \.agents\/security-testing\/handoffs for the handoff profile/m);
  const noTo = await evidence(repo, ["publish", "--run", run_id, "--profile", "redacted-report"]);
  assert.equal(noTo.code, 2);
  assert.match(noTo.stdout, /^USAGE\(publish: --to is required\)$/m);
});

test("export-manifest payload: enveloped kind export-manifest, exactly {source_manifest_sha256, profile, profile_version, output_sha256}, schema-valid, output_sha256 = the set identity of the written files (US-023 AC-2)", async () => {
  const { repo, run_id, manifest } = await committedReviewRun();
  const r = await publish(repo, run_id, "full-report", "reports/security/full");
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const dest = join(repo, "reports", "security", "full");
  const em = readArtifact(join(dest, "export-manifest.json"), { kind: "export-manifest" });
  assert.deepEqual(Object.keys(em.payload).sort(), ["output_sha256", "profile", "profile_version", "source_manifest_sha256"]);
  assert.deepEqual(validate("export-manifest", em.payload), []);
  assert.equal(em.payload.source_manifest_sha256, manifest.envelope.self_sha256);
  assert.equal(em.payload.profile, "full-report");
  assert.equal(em.payload.profile_version, 1);
  const outputs = ["report.md", "findings.json"].map((relpath) => ({ relpath, bytes: readFileSync(join(dest, relpath)) }));
  assert.equal(em.payload.output_sha256, exportIdentity(outputs));
  assert.equal(em.envelope.run_id, run_id);
  assert.equal(em.envelope.created_at, ENV.SECURITY_EVIDENCE_NOW);
  assert.equal(lines(r.stdout).at(-1), `WROTE reports/security/full/export-manifest.json sha256=${em.envelope.self_sha256}`);
  // republish to the same destination: byte-identical, exit 0; a foreign file at an output name is refused, untouched
  const before = listAll(dest).map((n) => [n, readFileSync(join(dest, n))]);
  const again = await publish(repo, run_id, "full-report", "reports/security/full");
  assert.equal(again.code, 0, `${again.stdout}${again.stderr}`);
  for (const [n, bytes] of before) assert.ok(readFileSync(join(dest, n)).equals(bytes), n);
  mkdirSync(join(repo, "reports", "security", "taken"), { recursive: true });
  writeFileSync(join(repo, "reports", "security", "taken", "report.md"), "someone else's report\n");
  const taken = await publish(repo, run_id, "redacted-report", "reports/security/taken");
  assert.equal(taken.code, 2);
  assert.match(taken.stdout, /^USAGE\(publish: reports\/security\/taken\/report\.md already exists with different content; choose another --to\)$/m);
  assert.equal(readFileSync(join(repo, "reports", "security", "taken", "report.md"), "utf8"), "someone else's report\n");
  assert.deepEqual(listAll(join(repo, "reports", "security", "taken")), ["report.md"], "nothing else written");
});

test("tracker payload never carries snippet for a sensitive finding and has exactly the nine keys; one ticket + one sidecar manifest per accepted finding under <st>/handoffs/ (US-039 AC-1)", async () => {
  const { repo, run_id, ids, claimed } = await committedReviewRun();
  const r = await publish(repo, run_id, "tracker", HANDOFFS);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const accepted = [ids.app, ids.secret, ids.injection].sort();
  const expected = accepted.flatMap((id) => [`${id}.export-manifest.json`, `${id}.ticket.json`]).sort();
  assert.deepEqual(listAll(join(repo, HANDOFFS)), expected);
  assert.ok(!existsSync(join(repo, HANDOFFS, `${ids.failed}.ticket.json`)), "CITATION_FAILED is not accepted: no ticket");
  for (const id of accepted) {
    const bytes = readFileSync(join(repo, HANDOFFS, `${id}.ticket.json`));
    const ticket = parseStrict(bytes);
    assert.deepEqual(Object.keys(ticket).sort(), [...TICKET_KEYS].sort(), id);
    assert.equal(ticket.finding_id, id);
    assert.ok(!("snippet" in ticket) && !("snippet_redacted" in ticket));
    const em = readArtifact(join(repo, HANDOFFS, `${id}.export-manifest.json`), { kind: "export-manifest" });
    assert.equal(em.payload.profile, "tracker");
    assert.equal(em.payload.output_sha256, exportIdentity([{ relpath: `${id}.ticket.json`, bytes }]));
  }
  const secret = parseStrict(readFileSync(join(repo, HANDOFFS, `${ids.secret}.ticket.json`)));
  assert.equal(claimed.payload.findings.find((f) => f.id === ids.secret).sensitive, true);
  assert.ok(!JSON.stringify(secret).includes(SECRET));
  assert.match(secret.context_redacted, /<REDACTED:password-assign>/);
  assert.equal(secret.class, "secret");
  const out = lines(r.stdout);
  assert.equal(out.filter((l) => l.startsWith("PUBLISHED profile=tracker output=.agents/security-testing/handoffs/")).length, 3);
  assert.equal(out.filter((l) => l.startsWith("WROTE .agents/security-testing/handoffs/")).length, 3);
  assert.equal(out.filter((l) => l.startsWith("DEDUPE ")).length, 0);
  assert.equal(out.filter((l) => l.startsWith("NEXT: ")).length, 3);
  // ordering: PUBLISHED/WROTE pairs, then DEDUPE, then NEXT
  const kinds = out.map((l) => l.split(/[ :]/)[0]);
  assert.deepEqual(kinds, ["PUBLISHED", "WROTE", "PUBLISHED", "WROTE", "PUBLISHED", "WROTE", "NEXT", "NEXT", "NEXT"]);
  // tracker's --to must be <st>/handoffs/: anywhere else is refused, nothing written
  for (const to of ["reports/security/tickets", ".agents/security-testing/HANDOFFS/", ".agents/security-testing/runs"]) {
    const bad = await publish(repo, run_id, "tracker", to);
    assert.equal(bad.code, 2, to);
    assert.match(bad.stdout, /^USAGE\(publish: --to must be \.agents\/security-testing\/handoffs for the tracker profile, got /m);
  }
  assert.ok(!existsSync(join(repo, "reports")));
  const trailing = await publish(repo, run_id, "tracker", `${HANDOFFS}/`);
  assert.equal(trailing.code, 0, "a trailing slash is the same directory");
});

test("dedupe on an existing ticket_url and on an open ingested ticket naming the id; no register event written by publish (US-039 AC-3, first layer)", async () => {
  const { repo, run_id, ids } = await committedReviewRun({
    repo: readyRepo(),
    before: async (r, id, gated) => {
      await ingestTicket(r, id, { id: 9, url: "https://github.com/my-org/my-product/issues/9?token=abcdef0123456789ABCDEF0123456789", state: "open", title: "dup", body: `tracked as ${gated.injection}` });
    },
  });
  const rowId = await registerAdd(repo, ids.app, "app export", run_id);
  const ctx = ctxFor(repo);
  await append(ctx, { row_id: rowId, event: "ticketed", payload: { ticket_url: "https://github.com/my-org/my-product/issues/41", import_sha256: "c".repeat(64) }, ref: run_id });
  const events = join(repo, ST, "register", "events.jsonl");
  const logBefore = readFileSync(events);
  const projectionBefore = readFileSync(join(repo, ST, "register", "projection.json"));

  const r = await publish(repo, run_id, "tracker", HANDOFFS);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.deepEqual(listAll(join(repo, HANDOFFS)), [`${ids.secret}.export-manifest.json`, `${ids.secret}.ticket.json`], "only the secret finding is new");
  assert.ok(out.includes(`DEDUPE finding=${ids.app} existing=https://github.com/my-org/my-product/issues/41`));
  assert.ok(out.includes(`DEDUPE finding=${ids.injection} existing=https://github.com/my-org/my-product/issues/9?<REDACTED:token-assign>`), `the existing url is the redacted record's: ${r.stdout}`);
  assert.equal(out.filter((l) => l.startsWith("NEXT: ")).length, 1);
  assert.ok(readFileSync(events).equals(logBefore), "publish appends no register event (ticketed comes from tracker-readback, TASK-045)");
  assert.ok(readFileSync(join(repo, ST, "register", "projection.json")).equals(projectionBefore));
  assert.deepEqual(readdirSync(join(repo, ST, "register")).sort(), ["events.jsonl", "projection.json"], "no alias log, no leftover lock");
});

test("NEXT line names issue-tracking and tracker-readback, one per written ticket, after every DEDUPE line", async () => {
  const { repo, run_id, ids } = await committedReviewRun();
  const rowId = await registerAdd(repo, ids.app, "app export", run_id);
  await append(ctxFor(repo), { row_id: rowId, event: "ticketed", payload: { ticket_url: "https://github.com/my-org/my-product/issues/1", import_sha256: "c".repeat(64) }, ref: run_id });
  const r = await publish(repo, run_id, "tracker", HANDOFFS);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  const next = out.filter((l) => l.startsWith("NEXT: "));
  assert.equal(next.length, 2);
  for (const id of [ids.secret, ids.injection]) {
    const path = `.agents/security-testing/handoffs/${id}.ticket.json`;
    assert.ok(next.includes(`NEXT: post ${path} via issue-tracking, then ingest tracker-readback --sent ${path} <response.json>`), `NEXT for ${id}: ${r.stdout}`);
  }
  const dedupeAt = out.findIndex((l) => l.startsWith("DEDUPE "));
  const firstNext = out.findIndex((l) => l.startsWith("NEXT: "));
  const lastWrote = out.map((l, i) => (l.startsWith("WROTE ") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(lastWrote < dedupeAt && dedupeAt < firstNext, `order PUBLISHED/WROTE → DEDUPE → NEXT: ${r.stdout}`);
  // a run with nothing left to post prints no NEXT and exits 0
  const again = await publish(repo, run_id, "tracker", HANDOFFS);
  assert.equal(again.code, 0);
  assert.equal(lines(again.stdout).filter((l) => l.startsWith("NEXT: ")).length, 2, "identical republish: the same tickets, the same NEXT lines");
});

test("fix_prompt names bugfix-workflow and the verify command (TASK-045; US-039 AC-4)", async () => {
  const { repo, run_id, ids, claimed } = await committedReviewRun();
  const r = await publish(repo, run_id, "tracker", HANDOFFS);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const run = readArtifact(join(repo, ST, "runs", run_id, "run.json"), { kind: "run" });
  const injection = parseStrict(readFileSync(join(repo, HANDOFFS, `${ids.injection}.ticket.json`)));
  assert.equal(typeof injection.fix_prompt, "string");
  assert.match(injection.fix_prompt, /bugfix-workflow/, "routes the developer to the feature-development bugfix-workflow skill");
  assert.ok(injection.fix_prompt.includes(`verify.mjs all --finding ${ids.injection} --base ${run.payload.head_oid} --head <fix-commit>`), "the exact command to report back with; --base is the run's head_oid");
  assert.match(injection.fix_prompt, /src\/db\.js:3-4/);
  assert.ok(injection.fix_prompt.includes(injection.context_redacted), "the prompt carries context_redacted — the one description the developer gets");
  assert.match(injection.fix_prompt, /never edit tests, ignore files or suppression config/i);
  const finding = claimed.payload.findings.find((f) => f.id === ids.injection);
  assert.ok(!injection.fix_prompt.includes(finding.snippet), "never the snippet");
  // a secret-class finding: the prompt carries the redacted context and nothing a rule matches
  const secret = parseStrict(readFileSync(join(repo, HANDOFFS, `${ids.secret}.ticket.json`)));
  assert.ok(secret.fix_prompt.includes("<REDACTED:password-assign>"));
  assert.ok(!secret.fix_prompt.includes(SECRET));
  assert.ok(secret.fix_prompt.includes(`verify.mjs all --finding ${ids.secret} --base ${run.payload.head_oid} --head <fix-commit>`));
  // the stub is gone: one generator, imported from lib/fix-prompt.mjs
  const src = readFileSync(join(HERE, "profiles", "tracker.mjs"), "utf8");
  assert.doesNotMatch(src, /fixPromptStub/);
  assert.match(src, /from "\.\.\/fix-prompt\.mjs"/);
});

test("dedupe follows finding aliases: a row ticketed under the old id of a re-keyed finding dedupes the new id (TASK-045; PM log route from TASK-031)", async () => {
  const { repo, run_id, ids } = await committedReviewRun();
  const oldId = "d".repeat(64);
  // the row was ticketed under the old id (a read-back in an earlier run), then the lead linked the ids
  const rowId = await registerAdd(repo, oldId, "sql built from req.query.id", run_id);
  await append(ctxFor(repo), { row_id: rowId, event: "ticketed", payload: { ticket_url: "https://github.com/my-org/my-product/issues/5", import_sha256: "c".repeat(64) }, ref: run_id });
  const linked = await register(repo, ["alias", "--from", oldId, "--to", ids.injection, "--reason", "re-gated after the lines moved", "--run", run_id]);
  assert.equal(linked.code, 0, `${linked.stdout}${linked.stderr}`);

  const r = await publish(repo, run_id, "tracker", HANDOFFS);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.ok(out.includes(`DEDUPE finding=${ids.injection} existing=https://github.com/my-org/my-product/issues/5`), `the alias-linked row's url: ${r.stdout}`);
  assert.equal(out.filter((l) => l.startsWith("NEXT: ")).length, 2);
  assert.ok(!existsSync(join(repo, HANDOFFS, `${ids.injection}.ticket.json`)), "not posted again");
  assert.deepEqual(readdirSync(join(repo, ST, "register")).sort(), ["events.jsonl", "finding-alias.jsonl", "projection.json"], "publish reads the alias log and writes nothing");
});

test("--to for a report profile: must be inside the work tree, never under .agents/security-testing/ (case-insensitive), never under .git/, never an existing file; nothing written on refusal", async () => {
  const { repo, run_id } = await committedReviewRun();
  const stBefore = listAll(join(repo, ST));
  const cases = [
    ["../outside", /^USAGE\(publish: cannot write \.\.\/outside \(outside the work tree\)\)$/m],
    [".agents/security-testing/reports", /^USAGE\(publish: --to must not point into the bundle's own state \(\.agents\/security-testing\/\); got \.agents\/security-testing\/reports\)$/m],
    [".agents/Security-Testing/Reports", /^USAGE\(publish: --to must not point into the bundle's own state/m],
    [".AGENTS/security-testing", /^USAGE\(publish: --to must not point into the bundle's own state/m],
    [".git/reports", /^USAGE\(publish: --to must not point into \.git\/; got \.git\/reports\)$/m],
    ["README.md", /^USAGE\(publish: --to names an existing file, got README\.md\)$/m],
    [repo, /^USAGE\(publish: --to must be a directory below the work tree root/m],
  ];
  for (const [to, re] of cases) {
    const r = await publish(repo, run_id, "redacted-report", to);
    assert.equal(r.code, 2, `${to}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re, to);
  }
  assert.deepEqual(listAll(join(repo, ST)), stBefore, "the bundle's state is untouched");
  assert.ok(!existsSync(join(repo, "reports")));
  assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "# fixture\n");
  // an absolute destination inside the tree and a cwd-relative one from a subdirectory both work
  const abs = await publish(repo, run_id, "redacted-report", join(repo, "reports", "security", "abs"));
  assert.equal(abs.code, 0, `${abs.stdout}${abs.stderr}`);
  assert.match(abs.stdout, /^PUBLISHED profile=redacted-report output=reports\/security\/abs\/report\.md /m);
  mkdirSync(join(repo, "sub"), { recursive: true });
  const rel = await evidence(join(repo, "sub"), ["publish", "--run", run_id, "--profile", "redacted-report", "--to", "out"]);
  assert.equal(rel.code, 0, `${rel.stdout}${rel.stderr}`);
  assert.match(rel.stdout, /^PUBLISHED profile=redacted-report output=sub\/out\/report\.md /m, "cwd-relative like every other argument");
});

test("a run that is not COMMITTED ⇒ 2; an unknown run ⇒ 2; a tampered COMMITTED ⇒ 5 INCONSISTENT(COMMITTED); nothing written", async () => {
  const { repo, run_id, dir } = await committedReviewRun();
  const committed = join(dir, "COMMITTED");
  const marker = readFileSync(committed);
  writeFileSync(committed, `${"0".repeat(64)}\n`);
  const t = await publish(repo, run_id, "redacted-report", "reports/security/t");
  assert.equal(t.code, 5);
  assert.equal(t.stdout, "INCONSISTENT(COMMITTED)\n");
  const { rmSync } = await import("node:fs");
  rmSync(committed);
  const nc = await publish(repo, run_id, "redacted-report", "reports/security/t");
  assert.equal(nc.code, 2);
  assert.match(nc.stdout, /^USAGE\(publish: run [0-9a-f]{12}-\d{4} is not COMMITTED \(build-report first\)\)$/m);
  writeFileSync(committed, marker);
  const unknown = await publish(repo, "0000000000ab-0009", "redacted-report", "reports/security/t");
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /^USAGE\(publish: unknown run 0000000000ab-0009\)$/m);
  const badId = await publish(repo, "nope", "redacted-report", "reports/security/t");
  assert.equal(badId.code, 2);
  assert.ok(!existsSync(join(repo, "reports")));
});

test("evidence.mjs routes `publish` and `check-export`; cmd-publish writes only through fsx/canon and prints only through ctx.out", () => {
  const entry = readFileSync(join(HERE, "..", "evidence.mjs"), "utf8");
  assert.match(entry, /^\s*publish: \(\) => import\("\.\/lib\/cmd-publish\.mjs"\),/m);
  assert.match(entry, /^\s*"check-export": \(\) => import\("\.\/lib\/cmd-check-export\.mjs"\),/m);
  const src = readFileSync(join(HERE, "cmd-publish.mjs"), "utf8");
  assert.doesNotMatch(src, /console\.(log|error)/);
  assert.doesNotMatch(src, /writeFileSync|appendFileSync|process\.stdout/);
  assert.doesNotMatch(src, /from "node:child_process"|fetch\(|from "node:http/);
});

// --- TASK-043: publish --profile case | handoff (plan §5 TASK-043; spec §9.2, D7; US-035, US-038 AC-3) ---

const SUITE = "tasks/security-my-product-admitted";
const CASES = join(ST, "cases", "my-product");
const HEADER_ROWS = [
  ["Navigate to `{{base_url}}/login`", "Login page loads, Email and Password visible"],
  ["Open the browser network panel and reload the page", "The document response for `/login` is listed"],
  ["Inspect the response headers of the `/login` document", "`Content-Security-Policy` is present and does not contain `unsafe-inline`"],
  ["Inspect the `Set-Cookie` headers of the `/login` document", "Every cookie carries `Secure` and `HttpOnly`"],
];
const PLAIN_ROWS = [
  ["Navigate to `{{base_url}}/`", "The home page loads"],
  ["Inspect the page footer", "No framework version string is shown"],
];

/** A COMMITTED review run with three admitted candidates (one header/cookie case, one p1-priority case, one plain case) and one proposal under <st>/cases/my-product/. */
async function admittedRun(extraCases = []) {
  const { caseText } = await import("../fixtures/plan/helpers.mjs");
  const written = {};
  const admitted = {};
  return committedReviewRun({
    before: async (repo, run_id) => {
      mkdirSync(join(repo, CASES), { recursive: true });
      const cases = [
        ["TC-001_login-headers.md", caseText("TC-001", HEADER_ROWS)],
        ["TC-002_home-footer.md", caseText("TC-002", PLAIN_ROWS, { title: "Verify the footer hides versions" }).replace("priority: high", "priority: p1")],
        ["TC-003_plain.md", caseText("TC-003", PLAIN_ROWS, { title: "Verify a plain observation", extra: "account: unauthenticated" })],
        ["TC-004_submit.md", caseText("TC-004", [["Submit the login form", "Redirect"]], { title: "Submit login" })],
        ...extraCases,
      ];
      for (const [name, text] of cases) {
        writeFileSync(join(repo, CASES, name), text);
        written[name] = text;
        const a = await runPlan(repo, ["admit", "--run", run_id, `${CASES}/${name}`]);
        assert.equal(a.code, 0, `${name}: ${a.stdout}${a.stderr}`);
        admitted[name] = /^ADMISSION case=([0-9a-f]{64}) classification=(\S+)/m.exec(a.stdout).slice(1, 3);
      }
    },
  }).then((built) => ({ ...built, written, admitted }));
}

async function runPlan(repo, argv) {
  const { runScript } = await import("../fixtures/cli/harness.mjs");
  return runScript("plan", argv, { cwd: repo, env: ENV });
}

test("three admitted + one proposal ⇒ exactly three TC files and nothing else in tasks/security-<slug>-admitted/; the manifest is the per-run sidecar in <st>/handoffs/ carrying opts.members; republish is idempotent (US-035 AC-1)", async () => {
  const { repo, run_id, admitted } = await admittedRun();
  assert.equal(admitted["TC-004_submit.md"][1], "proposal");
  const r = await publish(repo, run_id, "case", SUITE);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.deepEqual(listAll(join(repo, SUITE)), ["TC-001_login-headers.md", "TC-002_home-footer.md", "TC-003_plain.md"], "nothing else in the suite: no manifest, no proposal");
  assert.equal(out.length, 4);
  assert.match(out[0], /^PUBLISHED profile=case output=\.\/tasks\/security-my-product-admitted\/TC-001_login-headers\.md sha256=[0-9a-f]{64}$/);
  assert.match(out[1], /^PUBLISHED profile=case output=\.\/tasks\/security-my-product-admitted\/TC-002_home-footer\.md sha256=/);
  assert.match(out[2], /^PUBLISHED profile=case output=\.\/tasks\/security-my-product-admitted\/TC-003_plain\.md sha256=/);
  assert.match(out[3], new RegExp(`^WROTE \\.agents/security-testing/handoffs/${run_id}\\.case\\.export-manifest\\.json sha256=[0-9a-f]{64}$`));
  const em = readArtifact(join(repo, HANDOFFS, `${run_id}.case.export-manifest.json`), { kind: "export-manifest" });
  assert.deepEqual(validate("export-manifest", em.payload), []);
  assert.equal(em.payload.profile, "case");
  assert.equal(em.payload.opts.slug, "my-product");
  const outputs = ["TC-001_login-headers.md", "TC-002_home-footer.md", "TC-003_plain.md"].map((relpath) => ({ relpath, bytes: readFileSync(join(repo, SUITE, relpath)) }));
  assert.equal(em.payload.output_sha256, exportIdentity(outputs));
  assert.deepEqual(em.payload.opts.members, outputs.map((o) => ({ relpath: o.relpath, sha256: sha256Hex(o.bytes) })), "the published identities, recorded where the manifest lives");
  for (const o of outputs) assert.equal(out.find((l) => l.includes(o.relpath)).slice(-64), sha256Hex(o.bytes));
  const again = await publish(repo, run_id, "case", SUITE);
  assert.equal(again.code, 0, `${again.stdout}${again.stderr}`);
  assert.equal(again.stdout, r.stdout, "idempotent");
  // --to must be the suite directory of the slug; --slug changes it; the bundle's own state is never a destination
  const elsewhere = await publish(repo, run_id, "case", "tasks/security-other-admitted");
  assert.equal(elsewhere.code, 2);
  assert.match(elsewhere.stdout, /^USAGE\(publish: --to must be tasks\/security-my-product-admitted for the case profile/m);
  const badSlug = await publish(repo, run_id, "case", SUITE, ["--slug", "My Product"]);
  assert.equal(badSlug.code, 2);
  assert.match(badSlug.stdout, /^USAGE\(publish: --slug must be lowercase/m);
  assert.ok(!existsSync(join(repo, "tasks", "security-other-admitted")));
});

test("every published case parses as a manual-qa TC (parser = the TASK-018 fixture adapter); priority p1 → high, the manual-qa vocabulary kept; the security tag present; a plain case is the candidate verbatim below the frontmatter (US-035 AC-2)", async () => {
  const { parseTestCase } = await import("./ingest/case.mjs");
  const { repo, run_id, written } = await admittedRun();
  assert.equal((await publish(repo, run_id, "case", SUITE)).code, 0);
  for (const name of ["TC-001_login-headers.md", "TC-002_home-footer.md", "TC-003_plain.md"]) {
    const tc = parseTestCase(readFileSync(join(repo, SUITE, name), "utf8"));
    assert.equal(tc.id, name.slice(0, 6));
    assert.ok(["critical", "high", "medium", "low"].includes(tc.priority), `${name}: ${tc.priority}`);
    assert.ok(tc.tags.includes("security"));
  }
  assert.equal(parseTestCase(readFileSync(join(repo, SUITE, "TC-002_home-footer.md"), "utf8")).priority, "high");
  const plain = readFileSync(join(repo, SUITE, "TC-003_plain.md"), "utf8");
  const bodyOf = (t) => t.slice(t.indexOf("\n---\n") + 5);
  assert.equal(bodyOf(plain), bodyOf(written["TC-003_plain.md"]));
  assert.match(plain, /^account: unauthenticated$/m);
});

test("a header/cookie case is emitted in the audit-step form (navigate, collect the network requests, inspect one header per row) and contains no browser-action step (US-035 AC-2, audit branch)", async () => {
  const { parseSteps } = await import("./admission-core.mjs");
  const { repo, run_id } = await admittedRun();
  assert.equal((await publish(repo, run_id, "case", SUITE)).code, 0);
  const text = readFileSync(join(repo, SUITE, "TC-001_login-headers.md"), "utf8");
  const { steps } = parseSteps(text);
  assert.deepEqual(
    steps.map((s) => s.action),
    ["Navigate to `{{base_url}}/login`", "Collect the network requests of the page (`browser_network_requests()`)", "Inspect the `Content-Security-Policy` response header of the `/login` document", "Inspect the `Set-Cookie` response headers of the `/login` document"],
  );
  assert.equal(steps[2].expected, "`Content-Security-Policy` is present and does not contain `unsafe-inline`");
  for (const s of steps) assert.doesNotMatch(s.action, /reload|panel|click|fill|submit|press|type /i);
  assert.ok(!text.includes("proposal") && !text.includes("Submit the login form"), "no proposal path or text (US-038 AC-3)");
});

test("handoff prompt text exact: <st>/handoffs/<slug>.md is the §9.2 two-line prompt, printed after the PUBLISHED/WROTE pair; --base-url overrides the engagement's; no proposal, no case path (US-035 AC-3; US-038 AC-3)", async () => {
  const { repo, run_id } = await admittedRun();
  const r = await publish(repo, run_id, "handoff", HANDOFFS);
  assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
  const out = lines(r.stdout);
  assert.equal(out.length, 4);
  assert.match(out[0], /^PUBLISHED profile=handoff output=\.agents\/security-testing\/handoffs\/my-product\.md sha256=[0-9a-f]{64}$/);
  assert.match(out[1], new RegExp(`^WROTE \\.agents/security-testing/handoffs/${run_id}\\.handoff\\.export-manifest\\.json sha256=`));
  assert.equal(out[2], "Run as the active agent (claude --agent test-run-lead):");
  assert.equal(out[3], '"Run the suite at tasks/security-my-product-admitted/ against base_url=https://staging.example.com."');
  const prompt = readFileSync(join(repo, HANDOFFS, "my-product.md"), "utf8");
  assert.equal(prompt, 'Run as the active agent (claude --agent test-run-lead):\n"Run the suite at tasks/security-my-product-admitted/ against base_url=https://staging.example.com."\n');
  const em = readArtifact(join(repo, HANDOFFS, `${run_id}.handoff.export-manifest.json`), { kind: "export-manifest" });
  assert.deepEqual(em.payload.opts, { slug: "my-product", base_url: "https://staging.example.com" });
  assert.ok(!prompt.includes("proposal") && !prompt.includes("TC-") && !prompt.includes(".agents/"));
  // a second run's handoff for the same slug: same prompt bytes, its own sidecar — never a clobber
  const other = await publish(repo, run_id, "handoff", HANDOFFS, ["--base-url", "https://qa.example.com"]);
  assert.equal(other.code, 2, "a different prompt at the same <slug>.md is refused");
  assert.match(other.stdout, /already exists with different content; remove the stale file first \(its --to is fixed\)/, "review 1: --to is fixed for the M3 profiles, so the way out is named");
  const overridden = await publish(repo, run_id, "handoff", HANDOFFS, ["--slug", "other", "--base-url", "https://qa.example.com"]);
  assert.equal(overridden.code, 2, "the same run already has a handoff sidecar for another export");
  assert.match(overridden.stdout, /already exists for a different export/);
  const bad = await publish(repo, run_id, "handoff", HANDOFFS, ["--base-url", "staging.example.com"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /^USAGE\(publish: base_url must be an absolute http\(s\) URL/m);
  // review 1: a base_url redact.mjs rewrites is 2 USAGE with the reason, not writeSet's G-4 self-check error
  const secret = await publish(repo, run_id, "handoff", HANDOFFS, ["--slug", "other", "--base-url", "https://qa.example.com/?token=Qm9sZGx5R29pbmdOb3doZXJlMTIzNDU2Nzg5MA"]);
  assert.equal(secret.code, 2, `${secret.stdout}${secret.stderr}`);
  assert.match(secret.stdout, /^USAGE\(publish: the handoff base_url carries a value redact\.mjs rewrites \(a token, key or credential\); pass a base URL without it\)$/m);
  assert.doesNotMatch(secret.stdout + secret.stderr, /Qm9sZGx5/, "the value never leaves the process");
  assert.ok(!existsSync(join(repo, HANDOFFS, "other.md")), "nothing written");
});

test("case refusals name the case and rename nothing: TC-SEC-NNN id ⇒ 2 USAGE, nothing written; a candidate edited after admit ⇒ 2 USAGE (no candidate with that identity)", async () => {
  const { caseText } = await import("../fixtures/plan/helpers.mjs");
  const { repo, run_id } = await admittedRun([["TC-SEC-005.md", caseText("TC-SEC-005", PLAIN_ROWS, { title: "Legacy id" })]]);
  const r = await publish(repo, run_id, "case", SUITE);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /^USAGE\(publish: admitted case [0-9a-f]{12}: id TC-SEC-005 is not TC-NNN \(three digits\); rename the candidate and admit it again\)$/m);
  assert.ok(!existsSync(join(repo, "tasks")), "nothing written");
  writeFileSync(join(repo, CASES, "TC-SEC-005.md"), caseText("TC-005", PLAIN_ROWS, { title: "Legacy id" }));
  const moved = await publish(repo, run_id, "case", SUITE);
  assert.equal(moved.code, 2);
  assert.match(moved.stdout, /^USAGE\(publish: admitted case [0-9a-f]{12}: no candidate under \.agents\/security-testing\/cases\/ has this identity/m);
  assert.ok(!existsSync(join(repo, "tasks")));
});
