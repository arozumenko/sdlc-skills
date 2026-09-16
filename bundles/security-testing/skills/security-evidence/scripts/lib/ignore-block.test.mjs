// TASK-008 — the managed `.gitignore` block (spec §6.9 step 1 / step 2, P3,
// TL-13; plan §3.3 row `lib/ignore-block.mjs`). Pure text on the block side;
// the fail-closed probe is the one place git runs, over harness repos.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupAll, git, initRepo } from "../fixtures/cli/harness.mjs";
import { createContext } from "./ctx.mjs";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  GITIGNORE,
  PATTERNS,
  POLICY_PATTERNS,
  activePatterns,
  probeManagedPaths,
  readGitignore,
  renderBlock,
  stripManagedBlock,
  upsertBlock,
} from "./ignore-block.mjs";

after(cleanupAll);

const HERE = resolve(new URL(".", import.meta.url).pathname);
const SELF = readFileSync(join(HERE, "ignore-block.mjs"), "utf8");

const TEN = [
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
];
const FULL = `${BLOCK_BEGIN}\n${TEN.join("\n")}\n${BLOCK_END}\n`;

// ---------------------------------------------------------------------------
// PATTERNS / renderBlock

test("PATTERNS: the ten §6.9 patterns, in §6.9 order, frozen", () => {
  assert.deepEqual([...PATTERNS], TEN);
  assert.ok(Object.isFrozen(PATTERNS));
  assert.equal(BLOCK_BEGIN, "# security-testing:begin");
  assert.equal(BLOCK_END, "# security-testing:end");
  assert.equal(GITIGNORE, ".gitignore");
});

test("renderBlock: exact managed block, ten patterns, nothing else (no policy / every key local)", () => {
  assert.equal(renderBlock(), FULL);
  assert.equal(renderBlock({}), FULL);
  assert.equal(renderBlock(Object.fromEntries(Object.keys(POLICY_PATTERNS).map((k) => [k, "local"]))), FULL);
  assert.equal(renderBlock(FULL_LOCAL()), FULL);
});

test("renderBlock: a `committed` policy entry removes exactly that artifact's pattern; private/ has no key (TL-13)", () => {
  const withoutRegister = TEN.filter((p) => p !== ".agents/security-testing/register/");
  assert.equal(renderBlock({ register: "committed" }), `${BLOCK_BEGIN}\n${withoutRegister.join("\n")}\n${BLOCK_END}\n`);
  assert.deepEqual(activePatterns({ register: "committed", cases: "committed" }), TEN.filter((p) => p !== ".agents/security-testing/register/" && p !== "tasks/security-*/"));
  // every policy key maps to one of the ten, and private/ is the one pattern no key names
  assert.deepEqual(Object.keys(POLICY_PATTERNS).sort(), ["cases", "handoffs", "imports", "ledger", "proposals", "receipts", "register", "reports", "runs"]);
  for (const p of Object.values(POLICY_PATTERNS)) assert.ok(TEN.includes(p), p);
  assert.ok(!Object.values(POLICY_PATTERNS).includes(".agents/security-testing/private/"));
  assert.throws(() => renderBlock({ private: "committed" }), /private/);
  assert.throws(() => renderBlock({ private: "local" }), /private/);
  assert.throws(() => renderBlock({ nope: "local" }), /nope/);
  assert.throws(() => renderBlock({ runs: "public" }), /runs/);
  assert.throws(() => renderBlock([]), TypeError);
});

// ---------------------------------------------------------------------------
// upsertBlock

test("upsertBlock: absent ⇒ appended (a missing LF on the last line is added, an existing one is not doubled); idempotent afterwards", () => {
  for (const [text, expected] of [
    ["", FULL],
    ["node_modules/\n", `node_modules/\n${FULL}`],
    ["node_modules/", `node_modules/\n${FULL}`],
    ["node_modules/\n\n", `node_modules/\n\n${FULL}`],
  ]) {
    const first = upsertBlock(text, {});
    assert.equal(first.text, expected, JSON.stringify(text));
    assert.equal(first.changed, true);
    const second = upsertBlock(first.text, {});
    assert.equal(second.text, first.text, "byte-identical on the second pass");
    assert.equal(second.changed, false);
  }
});

test("upsertBlock: an existing block is rewritten in place — surrounding lines untouched, policy change re-renders it", () => {
  const before = `# mine\nnode_modules/\n${FULL}dist/\n`;
  const same = upsertBlock(before, {});
  assert.equal(same.changed, false);
  assert.equal(same.text, before);

  const changed = upsertBlock(before, { register: "committed" });
  assert.equal(changed.changed, true);
  assert.equal(changed.text, `# mine\nnode_modules/\n${renderBlock({ register: "committed" })}dist/\n`);
  // …and back
  const back = upsertBlock(changed.text, {});
  assert.equal(back.text, before);

  // a hand-edited block (one pattern missing, one extra) is restored, the rest of the file kept
  const edited = `a/\n${BLOCK_BEGIN}\nreports/security/\nextra/\n${BLOCK_END}\nb/\n`;
  const restored = upsertBlock(edited, {});
  assert.equal(restored.changed, true);
  assert.equal(restored.text, `a/\n${FULL}b/\n`);
  // a block at the end of the file with no trailing LF gets one
  const unterminatedLine = `a/\n${BLOCK_BEGIN}\nx/\n${BLOCK_END}`;
  assert.equal(upsertBlock(unterminatedLine, {}).text, `a/\n${FULL}`);
});

test("upsertBlock: stray markers (a begin with no end, an end with no begin) are comment lines to git — dropped, and exactly one block results", () => {
  // begin with no end: every line after it is live to git; none is lost
  const dangling = `${BLOCK_BEGIN}\nnode_modules/\ndist/\n`;
  const r = upsertBlock(dangling, {});
  assert.equal(r.changed, true);
  assert.equal(r.text, `node_modules/\ndist/\n${FULL}`);
  assert.equal(stripManagedBlock(r.text), "node_modules/\ndist/\n");
  // end with no begin
  const tailOnly = `a/\n${BLOCK_END}\nb/\n`;
  assert.equal(upsertBlock(tailOnly, {}).text, `a/\nb/\n${FULL}`);
  // two blocks: the first position is kept, the second is removed
  const two = `${FULL}x/\n${FULL}`;
  assert.equal(upsertBlock(two, {}).text, `${FULL}x/\n`);
});

test("upsertBlock: a CRLF file gets a CRLF block, and stripManagedBlock still removes it", () => {
  const crlf = "node_modules/\r\n";
  const r = upsertBlock(crlf, {});
  assert.equal(r.text, `node_modules/\r\n${FULL.replaceAll("\n", "\r\n")}`);
  assert.equal(upsertBlock(r.text, {}).changed, false);
  assert.equal(stripManagedBlock(r.text), "node_modules/\r\n");
});

// ---------------------------------------------------------------------------
// stripManagedBlock (moved here from cmd-run.mjs — one definition of the block's edges)

test("stripManagedBlock: removes begin..end inclusive; CR tolerated; an unterminated begin strips nothing (every line after it is live)", () => {
  assert.equal(stripManagedBlock(`a/\n${FULL}b/\n`), "a/\nb/\n");
  assert.equal(stripManagedBlock(FULL), "");
  assert.equal(stripManagedBlock("a/\nb/\n"), "a/\nb/\n");
  assert.equal(stripManagedBlock(`a/\r\n${FULL.replaceAll("\n", "\r\n")}b/\r\n`), "a/\r\nb/\r\n");
  const unterminated = `a/\n${BLOCK_BEGIN}\ndist/\n`;
  assert.equal(stripManagedBlock(unterminated), unterminated);
  // a stray end line outside a block is an ordinary (comment) line and stays
  assert.equal(stripManagedBlock(`a/\n${BLOCK_END}\n`), `a/\n${BLOCK_END}\n`);
});

// ---------------------------------------------------------------------------
// the fail-closed probe (spec §6.9 step 2)

function ctxIn(repo) {
  return createContext({}, { cwd: repo, env: {}, stdout: { write() {} }, stderr: { write() {} } });
}

function commitAll(repo, msg = "x") {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", msg]);
}

test("probeManagedPaths: clean repo with the block ⇒ nothing tracked, every pattern ignored", () => {
  const repo = initRepo();
  writeFileSync(join(repo, GITIGNORE), FULL);
  assert.deepEqual(probeManagedPaths(ctxIn(repo), {}), { tracked: [], notIgnored: [] });
});

test("probeManagedPaths: a tracked file under a managed path is named (the pattern's first tracked file); the trailing-slash glob matches directories only", () => {
  const repo = initRepo();
  writeFileSync(join(repo, GITIGNORE), FULL);
  mkdirSync(join(repo, "reports", "security"), { recursive: true });
  writeFileSync(join(repo, "reports", "security", "old.md"), "committed before init\n");
  writeFileSync(join(repo, "reports", "security", "a.md"), "also\n");
  mkdirSync(join(repo, "tasks", "security-x-admitted"), { recursive: true });
  writeFileSync(join(repo, "tasks", "security-x-admitted", "TC-1.md"), "case\n");
  // a *file* named tasks/security-notes.md is not under `tasks/security-*/` (directories only)
  mkdirSync(join(repo, "tasks"), { recursive: true });
  writeFileSync(join(repo, "tasks", "security-notes.md"), "notes\n");
  git(repo, ["add", "-f", "-A"]);
  git(repo, ["commit", "-q", "-m", "tracked"]);
  const r = probeManagedPaths(ctxIn(repo), {});
  assert.deepEqual(r.tracked, [
    { pattern: "reports/security/", path: "reports/security/a.md" },
    { pattern: "tasks/security-*/", path: "tasks/security-x-admitted/TC-1.md" },
  ]);
  assert.deepEqual(r.notIgnored, []);
});

test("probeManagedPaths: a pattern the block no longer carries is not ignored; a negation after the block un-ignores; a nested .gitignore negation too; a committed pattern is skipped by both checks", () => {
  const repo = initRepo();
  writeFileSync(join(repo, GITIGNORE), renderBlock({ register: "committed" }));
  const r1 = probeManagedPaths(ctxIn(repo), {});
  assert.deepEqual(r1.notIgnored, [".agents/security-testing/register/"]);
  assert.deepEqual(probeManagedPaths(ctxIn(repo), { register: "committed" }), { tracked: [], notIgnored: [] }, "skipped when the policy commits it");

  writeFileSync(join(repo, GITIGNORE), `${FULL}!reports/security/\n`);
  assert.deepEqual(probeManagedPaths(ctxIn(repo), {}).notIgnored, ["reports/security/"]);

  writeFileSync(join(repo, GITIGNORE), FULL);
  mkdirSync(join(repo, "tasks"), { recursive: true });
  writeFileSync(join(repo, "tasks", GITIGNORE), "!security-*/\n");
  assert.deepEqual(probeManagedPaths(ctxIn(repo), {}).notIgnored, ["tasks/security-*/"]);

  // no .gitignore at all ⇒ every active pattern is not ignored, in §6.9 order
  writeFileSync(join(repo, "tasks", GITIGNORE), "");
  writeFileSync(join(repo, GITIGNORE), "");
  assert.deepEqual(probeManagedPaths(ctxIn(repo), {}).notIgnored, TEN);
  // …and a committed register/ that is tracked is not TRACKED either
  mkdirSync(join(repo, ".agents", "security-testing", "register"), { recursive: true });
  writeFileSync(join(repo, ".agents", "security-testing", "register", "events.jsonl"), "");
  commitAll(repo);
  assert.deepEqual(probeManagedPaths(ctxIn(repo), { register: "committed" }).tracked, []);
  assert.deepEqual(probeManagedPaths(ctxIn(repo), {}).tracked, [{ pattern: ".agents/security-testing/register/", path: ".agents/security-testing/register/events.jsonl" }]);
});

test("readGitignore: the root .gitignore as bytes (latin1 round-trip), '' when absent", () => {
  const repo = initRepo();
  assert.equal(readGitignore(repo), "");
  const bytes = Buffer.from([0x61, 0x2f, 0x0a, 0xff, 0xfe, 0x0a]); // a non-UTF-8 line survives the round trip
  writeFileSync(join(repo, GITIGNORE), bytes);
  const text = readGitignore(repo);
  assert.deepEqual(Buffer.from(text, "latin1"), bytes);
  assert.deepEqual(Buffer.from(upsertBlock(text, {}).text, "latin1"), Buffer.concat([bytes, Buffer.from(FULL)]));
});

test("module boundary: no fs write (G-5: only cmd-engagement step 1 touches .gitignore), git only through lib/git.mjs, no console, no clock, no network", () => {
  assert.doesNotMatch(SELF, /writeFileSync|writeAtomic|writeExclusive|appendFileSync|renameSync|unlinkSync|rmSync|mkdirSync/);
  assert.doesNotMatch(SELF, /child_process|console\.|process\.stdout|process\.stderr|Date\.now|new Date|fetch\(|node:http|node:net|node:dns/);
  assert.match(SELF, /from "\.\/git\.mjs"/);
});

function FULL_LOCAL() {
  return { ledger: "local", runs: "local", receipts: "local", proposals: "local", handoffs: "local", imports: "local", register: "local", reports: "local", cases: "local" };
}
