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

test("failing fixture: the original mistake is reported", (t) => {
  const r = run(repo({ "docs/plan.md": "Delivered under #39.\n" }, t));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /docs\/plan\.md:1/);
});

test("passing fixture: the nearest allowed code is silent", (t) => {
  const r = run(repo({ "docs/plan.md": "Delivered under #123 (#390 is unrelated).\n" }, t));
  assert.equal(r.status, 0, r.stderr);
});

test("allowlisted file and reasoned suppression pass; a bare suppression does not", (t) => {
  const ok = run(repo({
    "docs/adr/ADR-023.md": "#39 was closed and superseded.\n",
    "docs/history.md": "<!-- guard-allow G-NNN: quoting the old title -->\nOld: #39\n",
  }, t));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /1 suppression/);
  const bare = run(repo({ "docs/history.md": "<!-- guard-allow G-NNN: -->\nOld: #39\n" }, t));
  assert.equal(bare.status, 1, bare.stderr);
});

test("fails closed when there is nothing to check", (t) => {
  const r = run(repo({ "src/a.txt": "#39\n" }, t));
  assert.equal(r.status, 2, r.stderr);
});
