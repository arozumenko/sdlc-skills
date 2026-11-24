import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { redactString } from "./redact.mjs";
import { exemptPaths, trackedPaths } from "./tracked-paths.mjs";

const P = "app/src/main/kotlin/com/example/widgets/screens/LongNamedWidget.kt";
const STEM = P.replace(/\.kt$/, "");
const keep = (text, paths = [P]) => redactString(text, undefined, exemptPaths(paths)).text;

test("a tracked path survives wherever it stands; without the exemption it does not", () => {
  assert.equal(redactString(P).hits, 1, "the premise: the rule eats this path");
  for (const text of [P, `${P}:1-4 @abcdef0 VERIFIED`, `(${P})`, `| ${P} |`, `${P} ${P}`]) assert.equal(keep(text), text);
  assert.equal(redactString(P, undefined, exemptPaths([])).text, "<REDACTED:high-entropy>.kt");
});

test("a run longer than the path, or only part of it, is still redacted", () => {
  for (const text of [`x/${P}`, `${STEM}X`, `${STEM}X.kt`, STEM, `${STEM}=`, `${STEM}/${P}`]) assert.match(keep(text), /<REDACTED:high-entropy>/, text);
  assert.equal(keep(`src/${STEM}`), "<REDACTED:high-entropy>");
});

test("a path with a dash or dot inside keeps every run of it", () => {
  const p = `features/some/very/long/package/directory/tree-${STEM}.test.kt`;
  assert.equal(redactString(p).hits, 2);
  assert.equal(keep(p, [p]), p);
  assert.match(keep(p.replace("tree-", "trees-"), [p]), /^<REDACTED:high-entropy>-<REDACTED:high-entropy>/);
});

test("the directories of a tracked path are paths too, whole segments only", () => {
  const dir = dirname(P);
  for (const text of [dir, `${dir}/`]) assert.equal(keep(text), text);
  assert.match(keep(dir.slice(0, -1)), /<REDACTED/, "a cut segment is not a directory");
});

test("only the high-entropy rule is exempt", () => {
  assert.equal(keep(`token=${P}`), "token=<REDACTED:key-value>");
  assert.equal(keep(`Bearer ${P}`), "Bearer <REDACTED:bearer>");
});

test("trackedPaths is the index plus the trees of the refs that resolve", () => {
  const root = mkdtempSync(join(tmpdir(), "st-paths-"));
  const git = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"]]) git("config", k, v);
  mkdirSync(dirname(join(root, P)), { recursive: true });
  writeFileSync(join(root, P), "x\n");
  writeFileSync(join(root, "b \u00e9.txt"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "c1");
  const c1 = git("rev-parse", "HEAD");
  rmSync(join(root, P));
  git("add", "-A");
  git("commit", "-qm", "c2");
  writeFileSync(join(root, "untracked.txt"), "x\n");
  assert.deepEqual([...trackedPaths(root)], ["b \u00e9.txt"]);
  assert.deepEqual([...trackedPaths(root, [c1.slice(0, 7), c1, "0".repeat(40), "nope", "--help"])].sort(), [P, "b \u00e9.txt"].sort());
});
