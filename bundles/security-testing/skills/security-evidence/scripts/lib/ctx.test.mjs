import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanupAll, initRepo, tmpDir, SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import { artifactId, makeEnvelope, parseStrict, writeArtifact } from "../canon.mjs";
import { CliError } from "./exit.mjs";
import { createContext } from "./ctx.mjs";

after(cleanupAll);

const ENGAGEMENT = JSON.parse(readFileSync(join(SCRIPTS_DIR, "fixtures", "schemas", "engagement.ok.json"), "utf8"));

function capture() {
  const out = { text: "", write(s) { this.text += s; } };
  const err = { text: "", write(s) { this.text += s; } };
  return { out, err };
}

function ctxIn(repo, flags = {}, env = {}) {
  const { out, err } = capture();
  const ctx = createContext(flags, { cwd: repo, env, stdout: out, stderr: err });
  return { ctx, out, err };
}

function writeEngagement(repo, record = ENGAGEMENT) {
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  writeFileSync(join(st, "engagement.md"), `# Engagement\n\nProse.\n\n\`\`\`json engagement\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`);
}

// ---------------------------------------------------------------------------

test("SECURITY_EVIDENCE_NOW fixes now()", () => {
  const repo = initRepo();
  const fixed = ctxIn(repo, {}, { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z" }).ctx;
  assert.equal(fixed.now(), "2026-09-16T10:00:00Z");
  assert.equal(fixed.now(), "2026-09-16T10:00:00Z", "stable across calls");
  const live = ctxIn(repo).ctx;
  assert.match(live.now(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  assert.throws(() => ctxIn(repo, {}, { SECURITY_EVIDENCE_NOW: "yesterday" }).ctx.now(), (e) => e instanceof CliError && e.code === 2);
});

test("G-1: the wall clock is read in ctx.now() and nowhere else under scripts/", () => {
  const offenders = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs") && !p.includes(`${join("fixtures", "cli")}`) && !p.includes(`${join("fixtures", "offline")}`)) {
        const hits = readFileSync(p, "utf8").match(/Date\.now\(|new Date\(/g) ?? [];
        if (hits.length) offenders.push([relative(SCRIPTS_DIR, p), hits.length]);
      }
    }
  };
  visit(SCRIPTS_DIR);
  assert.deepEqual(offenders, [[join("lib", "ctx.mjs"), 1]]);
  const src = readFileSync(join(SCRIPTS_DIR, "lib", "ctx.mjs"), "utf8");
  const nowFn = src.slice(src.indexOf("function now("), src.indexOf("\n}", src.indexOf("function now(")));
  assert.match(nowFn, /new Date\(/, "the one clock read lives inside now()");
});

test("outside a git work tree ⇒ CliError 2", () => {
  const dir = tmpDir();
  assert.throws(() => createContext({}, { cwd: dir, env: {} }), (e) => e instanceof CliError && e.code === 2 && e.token === "NOT-A-WORK-TREE");
  assert.throws(() => createContext({ root: dir }, { cwd: initRepo(), env: {} }), (e) => e instanceof CliError && e.code === 2 && e.token === "NOT-A-WORK-TREE");
  assert.throws(() => createContext({ root: join(dir, "missing") }, { cwd: dir, env: {} }), (e) => e instanceof CliError && e.code === 2);
});

test("root = --root or the toplevel of cwd; st = <root>/.agents/security-testing; rel()/abs() are repo-relative", () => {
  const repo = initRepo();
  mkdirSync(join(repo, "deep", "er"), { recursive: true });
  const fromNested = createContext({}, { cwd: join(repo, "deep", "er"), env: {} });
  assert.equal(fromNested.root, repo);
  assert.equal(fromNested.st, join(repo, ".agents", "security-testing"));
  const other = initRepo();
  const explicit = createContext({ root: other }, { cwd: repo, env: {} });
  assert.equal(explicit.root, other);
  assert.equal(explicit.rel(join(other, ".agents", "security-testing", "runs", "r", "scope.json")), ".agents/security-testing/runs/r/scope.json");
  assert.equal(explicit.abs(".agents/security-testing/engagement.md"), join(other, ".agents", "security-testing", "engagement.md"));
  assert.equal(explicit.abs(join(other, "x")), join(other, "x"), "absolute paths pass through");
});

test("actor = --actor / SECURITY_EVIDENCE_ACTOR / unknown", () => {
  const repo = initRepo();
  assert.equal(ctxIn(repo).ctx.actor, "unknown");
  assert.equal(ctxIn(repo, {}, { SECURITY_EVIDENCE_ACTOR: "lead" }).ctx.actor, "lead");
  assert.equal(ctxIn(repo, { actor: "flag" }, { SECURITY_EVIDENCE_ACTOR: "lead" }).ctx.actor, "flag");
});

test("toolVersion() reads version.json and it has exactly one key", () => {
  const raw = parseStrict(readFileSync(join(SCRIPTS_DIR, "version.json")));
  assert.deepEqual(Object.keys(raw), ["tool_version"]);
  assert.match(raw.tool_version, /^\d+\.\d+\.\d+$/);
  const ctx = ctxIn(initRepo()).ctx;
  assert.equal(ctx.toolVersion(), raw.tool_version);
  assert.equal(ctx.toolVersion(), raw.tool_version);
});

test("out() prints one redacted line to stdout; log() prints redacted diagnostics to stderr, silenced by --quiet", () => {
  const repo = initRepo();
  const { ctx, out, err } = ctxIn(repo);
  ctx.out("GATE accepted=1 note password=hunter2");
  ctx.log("reading", "token=abcdefghijklmnop123456", { n: 1 });
  assert.equal(out.text, "GATE accepted=1 note <REDACTED:password-assign>\n");
  assert.match(err.text, /^reading <REDACTED:token-assign> \{"n":1\}\n$/);
  const quiet = ctxIn(repo, { quiet: true });
  quiet.ctx.log("hidden");
  quiet.ctx.out("shown");
  assert.equal(quiet.err.text, "");
  assert.equal(quiet.out.text, "shown\n");
  assert.throws(() => ctx.out("two\nlines"), /one line/);
});

test("wrote() takes writeArtifact's returned artifact (post-redaction self_sha256), never the makeEnvelope result", () => {
  const repo = initRepo();
  const { ctx, out } = ctxIn(repo, {}, { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z" });
  const head = { schema_version: 1, kind: "scope", run_id: "r", engagement_id: "e", key_id: "k", now: ctx.now };
  const art = makeEnvelope(head, { note: "password=hunter2" });
  const path = join(ctx.st, "runs", "r", "scope.json");
  const written = writeArtifact(path, art);
  assert.notEqual(written.envelope.self_sha256, art.envelope.self_sha256, "redaction changed the identity");
  ctx.wrote(path, written);
  assert.equal(out.text, `WROTE .agents/security-testing/runs/r/scope.json sha256=${written.envelope.self_sha256}\n`);
  assert.equal(written.envelope.self_sha256, artifactId(written.payload));
  // the pre-redaction artifact is refused: its self_sha256 is not what is on disk
  assert.throws(() => ctx.wrote(path, art), /not the artifact on disk/);
  // and the convenience wrapper composes both
  const out2 = ctxIn(repo, {}, { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z" });
  const path2 = join(out2.ctx.st, "runs", "r", "coverage.json");
  const w2 = out2.ctx.writeArtifact(path2, makeEnvelope({ ...head, kind: "coverage" }, { secret: "password=hunter2" }));
  assert.equal(w2.payload.secret, "<REDACTED:password-assign>");
  assert.equal(out2.out.text, `WROTE .agents/security-testing/runs/r/coverage.json sha256=${w2.envelope.self_sha256}\n`);
});

test("engagement(): missing ⇒ ENGAGEMENT-MISSING (2); parsed lazily from the json engagement block and cached; invalid ⇒ ENGAGEMENT-INVALID", () => {
  const repo = initRepo();
  const missing = ctxIn(repo).ctx;
  assert.throws(() => missing.engagement(), (e) => e instanceof CliError && e.code === 2 && e.token === "ENGAGEMENT-MISSING");

  writeEngagement(repo);
  const ctx = ctxIn(repo).ctx;
  const rec = ctx.engagement();
  assert.equal(rec.engagement_id, "eng-1");
  assert.deepEqual(rec.scope_paths, ["src/"]);
  assert.equal(ctx.engagement(), rec, "cached");

  writeEngagement(repo, { ...ENGAGEMENT, slug: "Not Valid" });
  assert.throws(() => ctxIn(repo).ctx.engagement(), (e) => e instanceof CliError && e.code === 2 && /^ENGAGEMENT-INVALID\(\$\.slug/.test(e.token));

  writeEngagement(repo, { ...ENGAGEMENT, artifact_policy: { private: "committed" } });
  assert.throws(() => ctxIn(repo).ctx.engagement(), (e) => e instanceof CliError && e.code === 2 && e.token === "POLICY-INVALID(private)");

  const st = join(repo, ".agents", "security-testing");
  writeFileSync(join(st, "engagement.md"), "# no block\n");
  assert.throws(() => ctxIn(repo).ctx.engagement(), (e) => e instanceof CliError && /^ENGAGEMENT-INVALID\(no ```json engagement block\)$/.test(e.token));
  writeFileSync(join(st, "engagement.md"), "```json engagement\n{\"a\":1,\"a\":2}\n```\n");
  assert.throws(() => ctxIn(repo).ctx.engagement(), (e) => e instanceof CliError && /^ENGAGEMENT-INVALID\(duplicate key "a"/.test(e.token));
  writeFileSync(join(st, "engagement.md"), "```json engagement\n{}\n```\n\n```json engagement\n{}\n```\n");
  assert.throws(() => ctxIn(repo).ctx.engagement(), (e) => e instanceof CliError && /^ENGAGEMENT-INVALID\(2 json engagement blocks/.test(e.token));
});

test("key(): null without a current key; {key_id, bytes} from private/keys; keyById; malformed ids are refused", () => {
  const repo = initRepo();
  assert.equal(ctxIn(repo).ctx.key(), null);
  const keys = join(repo, ".agents", "security-testing", "private", "keys");
  mkdirSync(keys, { recursive: true });
  const bytes = Buffer.alloc(32, 7);
  writeFileSync(join(keys, "k0123456789ab"), bytes);
  writeFileSync(join(keys, "current"), "k0123456789ab\n");
  const ctx = ctxIn(repo).ctx;
  const key = ctx.key();
  assert.equal(key.key_id, "k0123456789ab");
  assert.deepEqual(key.bytes, bytes);
  assert.equal(ctx.key(), key, "cached");
  assert.deepEqual(ctx.keyById("k0123456789ab").bytes, bytes);
  assert.equal(ctx.keyById("kffffffffffff"), null);
  assert.throws(() => ctx.keyById("../engagement.md"), (e) => e instanceof CliError && e.code === 5);
  writeFileSync(join(keys, "current"), "kffffffffffff\n");
  assert.equal(ctxIn(repo).ctx.key(), null, "current names a missing key ⇒ unavailable");
});
