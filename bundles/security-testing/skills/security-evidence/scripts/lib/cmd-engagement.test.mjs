// TASK-008 — `evidence.mjs engagement init|validate|baseline` (spec §6.9 /
// P3, D13, TL-13; plan §4.1 rows `engagement init|validate`; US-004,
// US-005 AC-1…AC-3 at pipeline level, US-007 AC-2). Every repo is built in a
// temp dir by the CLI harness (G-12).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readArtifact } from "../canon.mjs";
import { cleanupAll, git, initRepo, runScript, SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import { defaultRecord, KNOWLEDGE_FILES, TEMPLATE_PATHS } from "./engagement.mjs";
import { CliError } from "./exit.mjs";
import { walk } from "./fsx.mjs";
import { BLOCK_BEGIN, BLOCK_END, PATTERNS, renderBlock } from "./ignore-block.mjs";
import { KEY_ID_PATTERN } from "./keys.mjs";
import { run } from "./cmd-engagement.mjs";

after(cleanupAll);

const ENV = { SECURITY_EVIDENCE_NOW: "2026-09-16T10:00:00Z", SECURITY_EVIDENCE_ACTOR: "lead" };
const ST = join(".agents", "security-testing");
const FULL = renderBlock({});
const TEMPLATES_PRESENT = "TEMPLATES: engagement.md.template=present finding-schema.md=present report-reading-guide.md=present";
const TEMPLATES_WRITTEN = "TEMPLATES: engagement.md.template=written finding-schema.md=written report-reading-guide.md=written";
const KEY_LINE = /^KEY: (k[0-9a-f]{12}) (created|reused|rotated)$/;
const BASELINE_REL = (eid) => `${ST}/private/baseline.${eid}.json`;

function engagementMd(record) {
  return `# Engagement\n\n\`\`\`json engagement\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

/**
 * A fixture repo as the bundle `seed` plus an edited record leave it: the
 * three knowledge files and an engagement.md (the template's record unless
 * `record` / `text` is given); no .gitignore, no key, no baseline.
 */
function repoWith({ record = defaultRecord(), text } = {}) {
  const repo = initRepo();
  const st = join(repo, ST);
  mkdirSync(join(st, "knowledge"), { recursive: true });
  for (const name of KNOWLEDGE_FILES) copyFileSync(TEMPLATE_PATHS[name], join(st, "knowledge", name));
  writeFileSync(join(st, "engagement.md"), text ?? engagementMd(record));
  return repo;
}

const init = (repo, args = []) => runScript("evidence", ["engagement", "init", ...args], { cwd: repo, env: ENV });
const validate = (repo) => runScript("evidence", ["engagement", "validate"], { cwd: repo, env: ENV });
const lines = (r) => r.stdout.split("\n").filter((l) => l !== "");
const gitignore = (repo) => (existsSync(join(repo, ".gitignore")) ? readFileSync(join(repo, ".gitignore"), "latin1") : null);
const repoFiles = (repo) => walk(repo).filter((p) => !p.startsWith(".git/"));
const keyFiles = (repo) => (existsSync(join(repo, ST, "private", "keys")) ? readdirSync(join(repo, ST, "private", "keys")).filter((n) => KEY_ID_PATTERN.test(n)).sort() : []);
const currentKey = (repo) => readFileSync(join(repo, ST, "private", "keys", "current"), "utf8").trim();

function assertInitOk(r, { block = "written", key = "created", baseline = "1 files ignored=0", eid = "eng-2026-001" } = {}) {
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = lines(r);
  assert.equal(out.length, 6, r.stdout);
  assert.equal(out[0], TEMPLATES_PRESENT);
  assert.equal(out[1], "ENGAGEMENT: present");
  assert.equal(out[2], `IGNORE-BLOCK: ${block}`);
  const m = KEY_LINE.exec(out[3]);
  assert.ok(m, out[3]);
  assert.equal(m[2], key);
  assert.equal(out[4], `BASELINE: ${baseline}`);
  assert.match(out[5], new RegExp(`^WROTE ${BASELINE_REL(eid).replaceAll(".", "\\.")} sha256=[0-9a-f]{64}$`));
  return { key_id: m[1], baseline_sha256: out[5].slice(-64) };
}

function commitForced(repo, paths = ["."], msg = "tracked") {
  git(repo, ["add", "-f", "--", ...paths]);
  git(repo, ["commit", "-q", "-m", msg]);
}

// ---------------------------------------------------------------------------
// Named verification cases (plan §5 TASK-008)

test("bare repo: first init writes templates + engagement.md and exits 2 EDIT-ENGAGEMENT-AND-RERUN with no .gitignore change, no key, no baseline; second init exits 0", async () => {
  const repo = initRepo();
  const before = repoFiles(repo);

  const first = await init(repo);
  assert.equal(first.code, 2, first.stdout + first.stderr);
  assert.deepEqual(lines(first), [TEMPLATES_WRITTEN, "ENGAGEMENT: template written — edit and re-run", "EDIT-ENGAGEMENT-AND-RERUN"]);
  assert.equal(first.stderr, "");
  // exactly the template copies were added: nothing else happened on that run (P3)
  assert.deepEqual(repoFiles(repo), [...before, `${ST}/engagement.md`, ...KNOWLEDGE_FILES.map((n) => `${ST}/knowledge/${n}`)].sort());
  assert.equal(gitignore(repo), null, "step 1 never ran");
  assert.equal(existsSync(join(repo, ST, "private")), false, "no key, no baseline");
  for (const name of KNOWLEDGE_FILES) assert.deepEqual(readFileSync(join(repo, ST, "knowledge", name)), readFileSync(TEMPLATE_PATHS[name]));
  assert.deepEqual(readFileSync(join(repo, ST, "engagement.md")), readFileSync(TEMPLATE_PATHS["engagement.md.template"]));

  // the template's record is deliberately valid: the second run goes through steps 1–4
  const second = await init(repo);
  const { key_id, baseline_sha256 } = assertInitOk(second);
  assert.equal(second.stderr, "");
  assert.equal(gitignore(repo), FULL);
  assert.deepEqual(keyFiles(repo), [key_id]);
  assert.equal(currentKey(repo), key_id);
  const baseline = readArtifact(join(repo, BASELINE_REL("eng-2026-001")), { kind: "baseline" });
  assert.equal(baseline.envelope.self_sha256, baseline_sha256);
  assert.equal(baseline.envelope.key_id, key_id);
  assert.deepEqual(Object.keys(baseline.payload.entries), ["src/app.js"]);
  // templates untouched by the second run (US-007 AC-2 at pipeline level)
  assert.deepEqual(readFileSync(join(repo, ST, "knowledge", "finding-schema.md")), readFileSync(TEMPLATE_PATHS["finding-schema.md"]));
});

test("exact managed block, ten patterns, nothing else", async () => {
  const repo = repoWith();
  assertInitOk(await init(repo));
  const text = gitignore(repo);
  assert.equal(text, FULL);
  assert.equal(text, `${BLOCK_BEGIN}\n${PATTERNS.join("\n")}\n${BLOCK_END}\n`);
  assert.equal(PATTERNS.length, 10);
  assert.deepEqual(text.split("\n").filter((l) => l !== "" && !l.startsWith("#")), [...PATTERNS]);

  // an existing .gitignore keeps every byte of its own and gains the block after a separating LF
  const kept = repoWith();
  writeFileSync(join(kept, ".gitignore"), "node_modules/\n*.log");
  assertInitOk(await init(kept));
  assert.equal(gitignore(kept), `node_modules/\n*.log\n${FULL}`);
});

test("second init leaves .gitignore byte-identical", async () => {
  const repo = repoWith();
  writeFileSync(join(repo, ".gitignore"), "# mine\nnode_modules/\n");
  assertInitOk(await init(repo));
  const once = readFileSync(join(repo, ".gitignore"));
  const r = await init(repo);
  assertInitOk(r, { block: "unchanged", key: "reused" });
  assert.deepEqual(readFileSync(join(repo, ".gitignore")), once);
  // a third run with lines added *around* the block: still unchanged, the user's lines kept
  writeFileSync(join(repo, ".gitignore"), `${once.toString("latin1")}dist/\n`);
  const r3 = await init(repo);
  assertInitOk(r3, { block: "unchanged", key: "reused" });
  assert.equal(gitignore(repo), `${once.toString("latin1")}dist/\n`);
});

test("artifact_policy.register: committed removes exactly that pattern and the fail-closed probe skips it", async () => {
  const record = defaultRecord();
  record.artifact_policy.register = "committed";
  const repo = repoWith({ record });
  assertInitOk(await init(repo));
  const expected = renderBlock({ register: "committed" });
  assert.equal(gitignore(repo), expected);
  assert.deepEqual(
    expected.split("\n").filter((l) => l !== "" && !l.startsWith("#")),
    PATTERNS.filter((p) => p !== ".agents/security-testing/register/"),
  );
  // register/ is now visible to git; committing it is the point of the policy — and the probe skips it
  mkdirSync(join(repo, ST, "register"), { recursive: true });
  writeFileSync(join(repo, ST, "register", "events.jsonl"), "");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "register by policy"]);
  assert.deepEqual(git(repo, ["ls-files", "--", ".agents/security-testing/register"]).split("\n"), [".agents/security-testing/register/events.jsonl"]);
  assertInitOk(await init(repo), { block: "unchanged", key: "reused" });

  // flipping the policy back to local re-renders the block (written) and the tracked register/ now fails closed
  const back = defaultRecord();
  writeFileSync(join(repo, ST, "engagement.md"), engagementMd(back));
  const r = await init(repo);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.deepEqual(lines(r), [TEMPLATES_PRESENT, "ENGAGEMENT: present", "IGNORE-BLOCK: written", "TRACKED(.agents/security-testing/register/events.jsonl)"]);
  assert.equal(gitignore(repo), FULL);
});

test("tracked file under local paths ⇒ exit 4 naming the path, nothing under <st>/private", async () => {
  const repo = repoWith();
  mkdirSync(join(repo, "reports", "security"), { recursive: true });
  writeFileSync(join(repo, "reports", "security", "old-report.md"), "committed long before\n");
  commitForced(repo);
  const r = await init(repo);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.deepEqual(lines(r), [TEMPLATES_PRESENT, "ENGAGEMENT: present", "IGNORE-BLOCK: written", "TRACKED(reports/security/old-report.md)"]);
  assert.equal(gitignore(repo), FULL, "step 1 ran (the block is the fix's first half); nothing after the failing step");
  assert.equal(existsSync(join(repo, ST, "private")), false, "no key, no baseline");
  assert.deepEqual(readdirSync(join(repo, ST)).sort(), ["engagement.md", "knowledge"]);

  // the earliest offending pattern in §6.9 order names the failure; a tracked key would be the worst case
  const keyed = repoWith();
  mkdirSync(join(keyed, ST, "private", "keys"), { recursive: true });
  writeFileSync(join(keyed, ST, "private", "keys", "k000000000000"), "leaked\n");
  mkdirSync(join(keyed, "reports", "security"), { recursive: true });
  writeFileSync(join(keyed, "reports", "security", "r.md"), "x\n");
  commitForced(keyed);
  const k = await init(keyed);
  assert.equal(k.code, 4);
  assert.equal(lines(k).at(-1), "TRACKED(.agents/security-testing/private/keys/k000000000000)");
  assert.equal(existsSync(join(keyed, ST, "private", "keys", "current")), false, "no key minted into a tracked private/");
});

test("negation un-ignoring reports/security/ ⇒ exit 4, no key, no baseline", async () => {
  const repo = repoWith();
  writeFileSync(join(repo, ".gitignore"), `${FULL}!reports/security/\n`);
  const r = await init(repo);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.deepEqual(lines(r), [TEMPLATES_PRESENT, "ENGAGEMENT: present", "IGNORE-BLOCK: unchanged", "NOT-IGNORED(reports/security/)"]);
  assert.equal(gitignore(repo), `${FULL}!reports/security/\n`, "the user's negation is theirs to remove; the block itself was intact");
  assert.equal(existsSync(join(repo, ST, "private")), false);

  // a nested .gitignore negation is caught the same way
  const nested = repoWith();
  mkdirSync(join(nested, "tasks"), { recursive: true });
  writeFileSync(join(nested, "tasks", ".gitignore"), "!security-*/\n");
  const n = await init(nested);
  assert.equal(n.code, 4);
  assert.equal(lines(n).at(-1), "NOT-IGNORED(tasks/security-*/)");
  assert.equal(existsSync(join(nested, ST, "private")), false);
});

test("repeated engagement init reuses the key, --rotate adds one", async () => {
  const repo = repoWith();
  const a = assertInitOk(await init(repo));
  const b = assertInitOk(await init(repo), { block: "unchanged", key: "reused" });
  assert.equal(b.key_id, a.key_id);
  assert.deepEqual(keyFiles(repo), [a.key_id]);

  const c = assertInitOk(await init(repo, ["--rotate"]), { block: "unchanged", key: "rotated" });
  assert.notEqual(c.key_id, a.key_id);
  assert.deepEqual(keyFiles(repo), [a.key_id, c.key_id].sort(), "the old key file is kept (§6.5)");
  assert.equal(currentKey(repo), c.key_id);
  const baseline = readArtifact(join(repo, BASELINE_REL("eng-2026-001")), { kind: "baseline" });
  assert.equal(baseline.envelope.key_id, c.key_id, "the baseline written after the rotation records the new key_id");
  assert.equal(baseline.envelope.self_sha256, c.baseline_sha256);
  assert.notEqual(c.baseline_sha256, a.baseline_sha256, "HMACs under the new key differ");

  // once more without --rotate: the rotated key is the one reused
  const d = assertInitOk(await init(repo), { block: "unchanged", key: "reused" });
  assert.equal(d.key_id, c.key_id);
});

test("validate never writes", async () => {
  const repo = repoWith();
  assertInitOk(await init(repo));
  const snapshot = () => Object.fromEntries(repoFiles(repo).map((p) => [p, readFileSync(join(repo, p))]));
  const before = snapshot();

  const ok = await validate(repo);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.deepEqual(lines(ok), ["IGNORE-BLOCK: ok", "TRACKED: none", "KEY: available", "BASELINE: present"]);
  assert.deepEqual(snapshot(), before);

  // stale block (a pattern hand-removed) ⇒ exit 4, still nothing written — validate does not repair
  writeFileSync(join(repo, ".gitignore"), FULL.replace("reports/security/\n", ""));
  const stale = await validate(repo);
  assert.equal(stale.code, 4);
  assert.deepEqual(lines(stale), ["IGNORE-BLOCK: stale", "TRACKED: none", "NOT-IGNORED(reports/security/)", "KEY: available", "BASELINE: present"]);
  assert.equal(gitignore(repo), FULL.replace("reports/security/\n", ""));

  // the deleted-file shape (TASK-012 review-2 follow-up): HEAD may hold the block, the working file is gone ⇒ stale
  writeFileSync(join(repo, ".gitignore"), FULL);
  git(repo, ["add", ".gitignore"]);
  git(repo, ["commit", "-q", "-m", "block"]);
  unlinkSync(join(repo, ".gitignore"));
  const gone = await validate(repo);
  assert.equal(gone.code, 4);
  assert.equal(lines(gone)[0], "IGNORE-BLOCK: stale");
  assert.deepEqual(lines(gone).slice(2, 2 + PATTERNS.length), PATTERNS.map((p) => `NOT-IGNORED(${p})`));
  assert.equal(existsSync(join(repo, ".gitignore")), false, "validate did not recreate it");

  // before any init: engagement present but no block, no key, no baseline — every line reports it, exit 4, nothing written
  const fresh = repoWith();
  const beforeFresh = repoFiles(fresh);
  const v = await validate(fresh);
  assert.equal(v.code, 4);
  assert.equal(lines(v)[0], "IGNORE-BLOCK: stale");
  assert.equal(lines(v)[1], "TRACKED: none");
  assert.deepEqual(lines(v).slice(-2), ["KEY: unavailable", "BASELINE: absent"]);
  assert.deepEqual(repoFiles(fresh), beforeFresh);

  // no engagement.md: validate does not run step 0 — ENGAGEMENT-MISSING, no templates written
  const bare = initRepo();
  const m = await validate(bare);
  assert.equal(m.code, 2);
  assert.equal(m.stdout, "ENGAGEMENT-MISSING\n");
  assert.equal(existsSync(join(bare, ST)), false);

  // a tracked file under a managed path is named by validate too
  const tracked = repoWith();
  assertInitOk(await init(tracked));
  mkdirSync(join(tracked, ST, "runs", "r1"), { recursive: true });
  writeFileSync(join(tracked, ST, "runs", "r1", "run.json"), "{}\n");
  commitForced(tracked, [join(ST, "runs")]);
  const t = await validate(tracked);
  assert.equal(t.code, 4);
  assert.deepEqual(lines(t), ["IGNORE-BLOCK: ok", "TRACKED(.agents/security-testing/runs/r1/run.json)", "KEY: available", "BASELINE: present"]);
});

// ---------------------------------------------------------------------------
// Ordering and refusals around the pipeline

test("ENGAGEMENT-INVALID / POLICY-INVALID(private) exit 2 after step 0's lines and before any .gitignore write, key or baseline", async () => {
  const invalid = repoWith({ record: { ...defaultRecord(), slug: 42 } });
  const r = await init(invalid);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  const out = lines(r);
  assert.deepEqual(out.slice(0, 2), [TEMPLATES_PRESENT, "ENGAGEMENT: present"]);
  assert.match(out[2], /^ENGAGEMENT-INVALID\(\$\.slug/);
  assert.equal(out.length, 3);
  assert.equal(gitignore(invalid), null);
  assert.equal(existsSync(join(invalid, ST, "private")), false);

  const record = defaultRecord();
  record.artifact_policy.private = "committed";
  const priv = repoWith({ record });
  writeFileSync(join(priv, ".gitignore"), "node_modules/\n");
  const p = await init(priv);
  assert.equal(p.code, 2);
  assert.deepEqual(lines(p), [TEMPLATES_PRESENT, "ENGAGEMENT: present", "POLICY-INVALID(private)"]);
  assert.equal(gitignore(priv), "node_modules/\n", "TL-13: refused before the block is touched");
  assert.equal(existsSync(join(priv, ST, "private")), false);

  // no json block at all
  const none = repoWith({ text: "# notes only\n" });
  const n = await init(none);
  assert.equal(n.code, 2);
  assert.equal(lines(n)[2], "ENGAGEMENT-INVALID(no json engagement block)");
  assert.equal(gitignore(none), null);
});

test("stdout order = step order; every line is a tokens.mjs spelling; --quiet leaves stdout alone", async () => {
  const repo = repoWith();
  const r = await runScript("evidence", ["--quiet", "engagement", "init"], { cwd: repo, env: ENV });
  const out = lines(r);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(out.map((l) => l.split(/[: (]/)[0]), ["TEMPLATES", "ENGAGEMENT", "IGNORE-BLOCK", "KEY", "BASELINE", "WROTE"]);
  assert.equal(r.stderr, "");
});

test("routing: `engagement baseline` delegates to cmd-engagement-baseline; unknown subcommand / no subcommand / stray argv ⇒ USAGE exit 2 before step 0", async () => {
  const repo = repoWith();
  assertInitOk(await init(repo));
  writeFileSync(join(repo, "src", "extra.js"), "added\n");
  const b = await runScript("evidence", ["engagement", "baseline"], { cwd: repo, env: ENV });
  assert.equal(b.code, 0, b.stdout + b.stderr);
  assert.match(b.stdout, new RegExp(`^BASELINE: 2 files ignored=0\nWROTE ${BASELINE_REL("eng-2026-001").replaceAll(".", "\\.")} sha256=[0-9a-f]{64}\n$`));

  const bare = initRepo();
  for (const [args, re] of [
    [["engagement"], /^USAGE\(engagement: a subcommand is required \(init\|validate\|baseline\)\)$/],
    [["engagement", "nope"], /^USAGE\(engagement: unknown subcommand nope\)$/],
    [["engagement", "init", "extra"], /^USAGE\(engagement init: unexpected argument extra\)$/],
    [["engagement", "init", "--kind", "x"], /^USAGE\(engagement init: unknown flag --kind\)$/],
    [["engagement", "init", "--rotate=yes"], /^USAGE\(engagement init: --rotate takes no value\)$/],
    [["engagement", "validate", "--rotate"], /^USAGE\(engagement validate: unknown flag --rotate\)$/],
  ]) {
    const r = await runScript("evidence", args, { cwd: bare, env: ENV });
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stdout.trim(), re, args.join(" "));
  }
  assert.equal(existsSync(join(bare, ST)), false, "argv is refused before step 0 writes anything");
});

test("driven with a ctx: init returns 0 and prints through ctx.out; a failing step throws the CliError the dispatcher prints", async () => {
  const repo = repoWith();
  const out = { text: "", write(s) { this.text += s; } };
  const ctx = createContext({}, { cwd: repo, env: ENV, stdout: out, stderr: { write() {} } });
  assert.equal(await run(["init"], ctx), 0);
  assert.equal(out.text.split("\n").length, 7);

  const tracked = repoWith();
  mkdirSync(join(tracked, "reports", "security"), { recursive: true });
  writeFileSync(join(tracked, "reports", "security", "r.md"), "x\n");
  commitForced(tracked);
  const tctx = createContext({}, { cwd: tracked, env: ENV, stdout: { write() {} }, stderr: { write() {} } });
  await assert.rejects(run(["init"], tctx), (e) => e instanceof CliError && e.code === 4 && e.token === "TRACKED(reports/security/r.md)");
  assert.equal(await run(["validate"], tctx), 4);
});

// ---------------------------------------------------------------------------
// Guardrails

test("G-5: cmd-engagement.mjs step 1 is the only code under scripts/ that writes .gitignore; the block's edges and patterns come from ignore-block.mjs", () => {
  const offenders = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name !== "fixtures") visit(p);
        continue;
      }
      if (!name.name.endsWith(".mjs") || name.name.endsWith(".test.mjs")) continue;
      const src = readFileSync(p, "utf8");
      const names = /GITIGNORE|"\.gitignore"/.test(src);
      const writes = /writeAtomic\(|writeFileSync\(|writeExclusive\(|appendLine\(|appendFileSync\(/.test(src);
      if (names && writes && name.name !== "cmd-engagement.mjs") offenders.push(p);
    }
  };
  visit(SCRIPTS_DIR);
  assert.deepEqual(offenders, []);

  const self = readFileSync(join(SCRIPTS_DIR, "lib", "cmd-engagement.mjs"), "utf8");
  const code = self.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(self, /from "\.\/ignore-block\.mjs"/);
  assert.doesNotMatch(code, /security-testing:(begin|end)|reports\/security\/|tasks\/security-/, "no second spelling of markers or patterns (prose aside)");
  assert.doesNotMatch(self, /console\.|process\.stdout|process\.stderr|child_process|Date\.now|new Date/);
  assert.doesNotMatch(self, /"(IGNORE-BLOCK|TRACKED|NOT-IGNORED|KEY|BASELINE|ENGAGEMENT|TEMPLATES):? /, "G-13: tokens come from tokens.mjs");
  // only step 1 writes: exactly one write call, and it targets the .gitignore
  const writes = [...self.matchAll(/writeAtomic\(/g)];
  assert.equal(writes.length, 1);
});

test("review-3 follow-ups: cmd-run.mjs imports the clean-tree check from lib/clean-tree.mjs and defines no block stripper; ctx.mjs takes KEY_ID from tokens.mjs", () => {
  const cmdRun = readFileSync(join(SCRIPTS_DIR, "lib", "cmd-run.mjs"), "utf8");
  assert.match(cmdRun, /import \{[^}]*\bassessmentDirt\b[^}]*\} from "\.\/clean-tree\.mjs"/);
  assert.doesNotMatch(cmdRun.replace(/^\s*\/\/.*$/gm, ""), /function stripManagedBlock|function assessmentDirt|function gitignoreOnlyManagedBlock|security-testing:(begin|end)/);
  const ctx = readFileSync(join(SCRIPTS_DIR, "lib", "ctx.mjs"), "utf8");
  assert.doesNotMatch(ctx, /k\[0-9a-f\]\{12\}/, "one regex, in tokens.mjs");
  assert.match(ctx, /import \{[^}]*\bKEY_ID\b[^}]*\} from "\.\/tokens\.mjs"/);
  const copies = [];
  for (const name of readdirSync(join(SCRIPTS_DIR, "lib"))) {
    if (!name.endsWith(".mjs") || name.endsWith(".test.mjs") || name === "tokens.mjs") continue;
    if (/k\[0-9a-f\]\{12\}/.test(readFileSync(join(SCRIPTS_DIR, "lib", name), "utf8"))) copies.push(name);
  }
  assert.deepEqual(copies, []);
});
