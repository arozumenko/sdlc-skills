// TASK-010 — working-tree baseline (spec §6.9 step 4, §2 last row, §12;
// plan §3.3 row `lib/baseline.mjs`, §5 G5 / TASK-010; US-006 AC-1).
//
// Verification cases named in plan §5 plus the interface contract:
// `computeBaseline(ctx) → payload` (throws CliError(2, ENGAGEMENT-MISSING)
// without engagement.md) and `diffBaseline(ctx, baseline) → {changed[],
// added[], removed[], ignored_counts{}}`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, git, initRepo, SCRIPTS_DIR } from "../fixtures/cli/harness.mjs";
import { artifactId, hmacHex, readArtifact, sha256Hex } from "../canon.mjs";
import { CliError } from "./exit.mjs";
import { createContext } from "./ctx.mjs";
import { ensureKey } from "./keys.mjs";
import { validate } from "./schema.mjs";
import { KEY_UNAVAILABLE } from "./tokens.mjs";
import { BASELINE_KIND, baselinePath, computeBaseline, diffBaseline, observedPaths, readBaseline, stepBaseline, writeBaseline } from "./baseline.mjs";

after(cleanupAll);

const NOW = "2026-09-16T10:00:00Z";
const ENGAGEMENT = JSON.parse(readFileSync(join(SCRIPTS_DIR, "fixtures", "schemas", "engagement.ok.json"), "utf8"));

function capture() {
  return { text: "", write(s) { this.text += s; } };
}

function ctxIn(repo, env = { SECURITY_EVIDENCE_NOW: NOW }) {
  const out = capture();
  const err = capture();
  const ctx = createContext({}, { cwd: repo, env, stdout: out, stderr: err });
  return { ctx, out, err };
}

function writeEngagement(repo, record = ENGAGEMENT) {
  const st = join(repo, ".agents", "security-testing");
  mkdirSync(st, { recursive: true });
  writeFileSync(join(st, "engagement.md"), `# Engagement\n\n\`\`\`json engagement\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`);
}

/**
 * The §12 fixture tree. On top of initRepo (README.md, src/app.js):
 *   tracked      src/lib/util.js  package.json  docs/notes.md  src/link.js → app.js
 *   untracked    src/untracked.js  outside.txt
 *   ignored      src/build/out.js  src/debug.log   (.gitignore: build/ *.log — committed)
 * engagement.ok.json: scope_paths ["src/"], product_paths ["src/", "package.json"].
 */
function fixture() {
  const repo = initRepo();
  mkdirSync(join(repo, "src", "lib"), { recursive: true });
  mkdirSync(join(repo, "src", "build"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "src", "lib", "util.js"), "export const u = 1;\n");
  writeFileSync(join(repo, "package.json"), '{"name":"fixture"}\n');
  writeFileSync(join(repo, "docs", "notes.md"), "outside every observed path\n");
  writeFileSync(join(repo, ".gitignore"), "build/\n*.log\n");
  symlinkSync("app.js", join(repo, "src", "link.js"));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixture"]);
  writeFileSync(join(repo, "src", "untracked.js"), "untracked, not ignored\n");
  writeFileSync(join(repo, "outside.txt"), "untracked, outside the observed paths\n");
  writeFileSync(join(repo, "src", "build", "out.js"), "ignored build output\n");
  writeFileSync(join(repo, "src", "debug.log"), "ignored log\n");
  writeEngagement(repo);
  const { ctx, out, err } = ctxIn(repo);
  const key = ensureKey(ctx, { engagement_id: ENGAGEMENT.engagement_id });
  const keyBytes = readFileSync(join(ctx.st, "private", "keys", key.key_id));
  return { repo, ctx, out, err, key, keyBytes, st: ctx.st };
}

const hmacOf = (keyBytes, repo, path) => hmacHex(keyBytes, readFileSync(join(repo, path)));

// ---------------------------------------------------------------------------
// Named verification cases

test("baseline holds every tracked and non-ignored untracked file under scope and product paths with ignored_count", () => {
  const { repo, ctx, keyBytes } = fixture();

  const payload = computeBaseline(ctx);

  assert.deepEqual(validate("baseline", payload), [], "payload per TASK-005 `baseline`");
  assert.equal(payload.engagement_id, "eng-1");
  assert.equal(payload.head_oid, git(repo, ["rev-parse", "HEAD"]), "HEAD state");
  assert.deepEqual(
    Object.keys(payload.entries).sort(),
    ["package.json", "src/app.js", "src/lib/util.js", "src/link.js", "src/untracked.js"],
    "US-006 AC-1: every tracked file and every non-ignored untracked file under scope_paths ∪ product_paths, nothing else",
  );
  for (const path of ["package.json", "src/app.js", "src/lib/util.js", "src/untracked.js"]) {
    assert.equal(payload.entries[path], hmacOf(keyBytes, repo, path), `${path}: per-path HMAC of working-tree content with the engagement key`);
    assert.notEqual(payload.entries[path], sha256Hex(readFileSync(join(repo, path))), `${path}: keyed, never a plain sha256 over content (G-2)`);
  }
  assert.equal(payload.entries["src/link.js"], hmacHex(keyBytes, Buffer.from("app.js")), "a symlink is keyed over its target, as git stores it");
  assert.deepEqual(payload.ignored_count, { "src/": 2, "package.json": 0 }, "ignored files are counted per configured path, not observed");
  assert.ok(!("docs/notes.md" in payload.entries) && !("outside.txt" in payload.entries) && !("README.md" in payload.entries), "outside the observed paths");
  assert.ok(!("src/build/out.js" in payload.entries) && !("src/debug.log" in payload.entries), "ignored files are outside the observation");

  // index state: plain sha256 over `git ls-files --stage` output (git metadata, G-2 allows it)
  const stage = git(repo, ["ls-files", "-z", "--stage"]); // NUL-terminated entries (NUL is not trimmed)
  assert.match(stage, /\0$/);
  assert.equal(payload.index_sha256, createHash("sha256").update(stage).digest("hex"), "index_sha256 = sha256 of the -z ls-files --stage output");
  assert.match(stage, /src\/app\.js/, "the whole index, so a staged change anywhere is an index-state change");

  assert.deepEqual(observedPaths(ENGAGEMENT), ["src/", "package.json"], "scope_paths ∪ product_paths, deduplicated, in first-appearance order");
  assert.deepEqual(computeBaseline(ctx), payload, "deterministic over an unchanged tree");
});

test("dirty tracked and untracked baseline changes listed per path", () => {
  const { repo, ctx, keyBytes } = fixture();
  const baseline = computeBaseline(ctx);

  assert.deepEqual(diffBaseline(ctx, baseline), { changed: [], added: [], removed: [], ignored_counts: { "src/": 2, "package.json": 0 } }, "unchanged tree ⇒ empty diff");

  writeFileSync(join(repo, "src", "app.js"), "export const a = 2; // edited\n"); // tracked, unstaged
  writeFileSync(join(repo, "package.json"), '{"name":"fixture","version":"2"}\n'); // tracked product file
  git(repo, ["add", "package.json"]); // staged or not: the working tree is what is observed
  writeFileSync(join(repo, "src", "new.js"), "new untracked file\n"); // untracked, not ignored
  rmSync(join(repo, "src", "lib", "util.js")); // tracked, deleted from the working tree
  writeFileSync(join(repo, "docs", "notes.md"), "changed outside the observed paths\n");
  writeFileSync(join(repo, "outside.txt"), "changed outside the observed paths\n");

  const snapshot = structuredClone(baseline);
  const diff = diffBaseline(ctx, baseline);
  assert.deepEqual(diff, {
    changed: ["package.json", "src/app.js"],
    added: ["src/new.js"],
    removed: ["src/lib/util.js"],
    ignored_counts: { "src/": 2, "package.json": 0 },
  });
  assert.deepEqual(baseline, snapshot, "the baseline passed in is never mutated");
  assert.notEqual(baseline.entries["src/app.js"], hmacOf(keyBytes, repo, "src/app.js"), "changed = the recorded HMAC no longer matches the working-tree content");

  // Restoring the bytes restores the observation: a change is content, not mtime or index state.
  writeFileSync(join(repo, "src", "app.js"), "export const a = 1;\n");
  assert.deepEqual(diffBaseline(ctx, baseline).changed, ["package.json"]);
});

test("changed ignored product file ⇒ not a change; ignored_count reported", () => {
  const { repo, ctx } = fixture();
  const baseline = computeBaseline(ctx);
  assert.equal(baseline.ignored_count["src/"], 2, "recorded at baseline time");

  writeFileSync(join(repo, "src", "build", "out.js"), "rebuilt, still ignored\n");
  writeFileSync(join(repo, "src", "build", "extra.js"), "a new ignored file\n");
  writeFileSync(join(repo, "package-lock.json"), "{}\n"); // untracked, outside the observed paths
  mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "dep", "index.js"), "also outside\n");

  const diff = diffBaseline(ctx, baseline);
  assert.deepEqual({ changed: diff.changed, added: diff.added, removed: diff.removed }, { changed: [], added: [], removed: [] }, "§2: changes to git-ignored files are outside the observation");
  assert.deepEqual(diff.ignored_counts, { "src/": 3, "package.json": 0 }, "the excluded coverage is visible: current ignored count per path");
  assert.equal(computeBaseline(ctx).ignored_count["src/"], 3, "a fresh baseline records the new count");
});

test("no engagement.md ⇒ ENGAGEMENT-MISSING, nothing written", () => {
  const repo = initRepo();
  const { ctx } = ctxIn(repo);
  const st = ctx.st;

  assert.throws(() => computeBaseline(ctx), (e) => e instanceof CliError && e.code === 2 && e.token === "ENGAGEMENT-MISSING");
  assert.throws(() => stepBaseline(ctx), (e) => e instanceof CliError && e.code === 2 && e.token === "ENGAGEMENT-MISSING");
  assert.equal(existsSync(st), false, "nothing under <st>: no private/, no baseline, no key");

  // With a key present but still no engagement.md: the key dir is all there is.
  ensureKey(ctx, { engagement_id: "eng-1" });
  assert.throws(() => stepBaseline(ctx), (e) => e instanceof CliError && e.code === 2 && e.token === "ENGAGEMENT-MISSING");
  assert.equal(existsSync(join(st, "private", "baseline.eng-1.json")), false);
  assert.equal(existsSync(baselinePath(ctx, "eng-1")), false);
});

// ---------------------------------------------------------------------------
// Interface contract and guardrails

test("stepBaseline / writeBaseline: an enveloped `baseline` artifact at private/baseline.<eid>.json, atomically overwritten; identity independent of created_at", () => {
  const { repo, ctx, key, st } = fixture();
  const path = baselinePath(ctx, "eng-1");
  assert.equal(path, join(st, "private", "baseline.eng-1.json"));

  const first = stepBaseline(ctx);
  assert.equal(first.path, path);
  assert.equal(first.files, 5);
  assert.equal(first.ignored, 2);
  assert.deepEqual(first.payload, computeBaseline(ctx));
  const onDisk = readArtifact(path, { kind: BASELINE_KIND });
  assert.deepEqual(onDisk, first.artifact, "the returned artifact is what is on disk (post-redaction identity)");
  assert.equal(onDisk.envelope.kind, "baseline");
  assert.equal(onDisk.envelope.key_id, key.key_id, "every artifact records the key it used (§6.5)");
  assert.equal(onDisk.envelope.engagement_id, "eng-1");
  assert.equal(onDisk.envelope.run_id, "", "not a run artifact");
  assert.equal(onDisk.envelope.created_at, NOW);
  assert.equal(onDisk.envelope.self_sha256, artifactId(first.payload));
  assert.deepEqual(readBaseline(ctx, "eng-1"), onDisk);
  assert.equal(readBaseline(ctx, "eng-9"), null, "absent ⇒ null");

  // Overwrite (engagement baseline re-run): tmp+rename, no residue, new content.
  writeFileSync(join(repo, "src", "later.js"), "added before the rewrite\n");
  const later = ctxIn(repo, { SECURITY_EVIDENCE_NOW: "2026-09-17T00:00:00Z" }).ctx;
  const second = stepBaseline(later);
  assert.equal(second.files, 6);
  assert.notEqual(second.artifact.envelope.self_sha256, first.artifact.envelope.self_sha256);
  assert.deepEqual(readArtifact(path, { kind: BASELINE_KIND }), second.artifact);
  const residue = readFileSync(path, "utf8");
  assert.ok(residue.endsWith("\n"), "canonical bytes plus one LF");
  assert.ok(!readdirSync(join(st, "private")).some((n) => n.includes(".tmp-")), "no tmp residue next to the baseline");

  // Same tree, different clock ⇒ same self_sha256 (G-1: no clock in the preimage).
  rmSync(join(repo, "src", "later.js"));
  const again = writeBaseline(ctxIn(repo, { SECURITY_EVIDENCE_NOW: "2026-12-31T23:59:59Z" }).ctx, computeBaseline(ctx));
  assert.equal(again.envelope.self_sha256, first.artifact.envelope.self_sha256);
  assert.equal(again.envelope.created_at, "2026-12-31T23:59:59Z");
});

test("diffBaseline uses the key the baseline artifact recorded; a missing key ⇒ CliError 4 KEY: unavailable", () => {
  const { repo, ctx, st } = fixture();
  const first = stepBaseline(ctx);

  // Rotate: the current key changes, but the diff of the stored artifact stays keyed by its envelope.key_id.
  const rotated = ensureKey(ctxIn(repo).ctx, { rotate: true, engagement_id: "eng-1" });
  assert.notEqual(rotated.key_id, first.artifact.envelope.key_id);
  const fresh = ctxIn(repo).ctx;
  assert.deepEqual(diffBaseline(fresh, readBaseline(fresh, "eng-1")), { changed: [], added: [], removed: [], ignored_counts: { "src/": 2, "package.json": 0 } });
  // A bare payload is compared with the current key: every file now differs.
  assert.deepEqual(diffBaseline(fresh, first.payload).changed, ["package.json", "src/app.js", "src/lib/util.js", "src/link.js", "src/untracked.js"]);

  rmSync(join(st, "private", "keys", first.artifact.envelope.key_id));
  assert.throws(() => diffBaseline(ctxIn(repo).ctx, readBaseline(fresh, "eng-1")), (e) => e instanceof CliError && e.code === 4 && e.token === KEY_UNAVAILABLE);
});

test("no engagement key ⇒ USAGE(baseline: …) exit 2 and nothing written", () => {
  const repo = initRepo();
  writeEngagement(repo);
  const { ctx } = ctxIn(repo);
  assert.throws(() => computeBaseline(ctx), (e) => e instanceof CliError && e.code === 2 && /^USAGE\(baseline: /.test(e.token));
  assert.throws(() => stepBaseline(ctx), (e) => e instanceof CliError && e.code === 2 && /^USAGE\(baseline: /.test(e.token));
  assert.equal(existsSync(join(ctx.st, "private")), false);
});

test("engagement_id that cannot name a file ⇒ ENGAGEMENT-INVALID, nothing written", () => {
  const repo = initRepo();
  writeEngagement(repo, { ...ENGAGEMENT, engagement_id: "../escape" });
  const { ctx } = ctxIn(repo);
  ensureKey(ctx, { engagement_id: "../escape" });
  assert.throws(() => stepBaseline(ctx), (e) => e instanceof CliError && e.code === 2 && /^ENGAGEMENT-INVALID\(\$\.engagement_id/.test(e.token));
  assert.throws(() => baselinePath(ctx, "a/b"), (e) => e instanceof CliError && e.code === 2);
  assert.equal(existsSync(join(repo, ".agents", "baseline.escape.json")), false);
  assert.equal(readdirSync(join(ctx.st, "private")).filter((n) => n.startsWith("baseline.")).length, 0);
});

test("guardrails: content is HMAC-keyed, index is the only plain sha256; git only through lib/git.mjs; no clock, no network, no second write path", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "lib", "baseline.mjs"), "utf8");
  const plain = [...src.matchAll(/sha256Hex\(/g)];
  assert.equal(plain.length, 1, "G-2: exactly one plain sha256 call site (the index metadata)");
  assert.match(src, /hmacHex\(/, "file content is keyed with the engagement key");
  assert.doesNotMatch(src, /node:child_process|execFile|spawn/, "G-6: every git call goes through lib/git.mjs");
  assert.match(src, /from "\.\/git\.mjs"/);
  assert.doesNotMatch(src, /Date\.now\(|new Date\(/, "G-1");
  assert.doesNotMatch(src, /node:http|node:net|node:dns|fetch\(/, "G-14");
  assert.doesNotMatch(src, /writeFileSync|openSync|createWriteStream|renameSync/, "writes go through canon.writeArtifact (tmp+rename, redacted)");
  assert.doesNotMatch(src, /console\./, "G-4: nothing prints from the module");
});
