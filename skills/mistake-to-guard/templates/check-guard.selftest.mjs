// Selftest for check-guard.mjs: the guard's proof that it bites.
// Builds throwaway git repos holding the failing fixture (the original
// mistake) and the passing fixture (the nearest allowed code), runs the guard
// on each, and asserts the exit codes. Run in the project gate next to the
// guard itself: node --test tools/check-<what>.selftest.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "check-guard.mjs");

function repo(files, t) {
  const dir = mkdtempSync(join(tmpdir(), "guard-selftest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [GUARD, dir], { encoding: "utf8" });

test("failing fixture: the original mistake is reported, with the fix named", (t) => {
  const r = run(repo({ "docs/plan.md": "Delivered under #39.\n" }, t));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /docs\/plan\.md:1/);
  assert.match(r.stderr, /instead/);
});

test("passing fixture: the nearest allowed code is silent", (t) => {
  const r = run(repo({ "docs/plan.md": "Delivered under #123 (#390 is unrelated).\n" }, t));
  assert.equal(r.status, 0, r.stderr);
});

test("allowlisted file and a dated, approved, reasoned exception pass", (t) => {
  const r = run(repo({
    "docs/adr/ADR-023.md": "#39 was closed and superseded.\n",
    "docs/history.md": "<!-- guard-allow G-NNN until 2999-01-01 by Synthetic1: quoting the old title -->\nOld: #39\n",
  }, t));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /1 exception/);
});

test("an exception without expiry, approver or reason, or one that expired, does not pass", (t) => {
  for (const tag of [
    "guard-allow G-NNN: quoting the old title",
    "guard-allow G-NNN until 2999-01-01 by Synthetic1: -->",
    "guard-allow G-NNN until 2000-01-01 by Synthetic1: quoting the old title",
  ]) {
    const r = run(repo({ "docs/history.md": `<!-- ${tag} -->\nOld: #39\n` }, t));
    assert.equal(r.status, 1, `${tag}\n${r.stderr}`);
  }
});

test("ratchet: holds at the count, fails when a change adds one, asks to lower when one goes", (t) => {
  const files = (n) => ({
    "tools/guards/G-NNN.ratchet": "2\n",
    "docs/a.md": "#39\n".repeat(n),
  });
  assert.equal(run(repo(files(2), t)).status, 0);
  const more = run(repo(files(3), t));
  assert.equal(more.status, 1);
  assert.match(more.stderr, /adds 1/);
  const fewer = run(repo(files(1), t));
  assert.equal(fewer.status, 1);
  assert.match(fewer.stderr, /lower .* to 1/);
});

test("fails closed when there is nothing to check", (t) => {
  const r = run(repo({ "src/a.txt": "#39\n" }, t));
  assert.equal(r.status, 2, r.stderr);
});
