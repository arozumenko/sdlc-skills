import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as mod from "./ignore-block.mjs";
import { BLOCK_BEGIN, BLOCK_END, PATTERNS, probeTracked, readGitignore, renderBlock, stripManagedBlock, upsertBlock } from "./ignore-block.mjs";
import { must } from "./git.mjs";

const EXPECTED = `${BLOCK_BEGIN}\n.agents/security-testing/reviews/\n.agents/security-testing/verify/\n.agents/security-testing/register/\n.agents/security-testing/proposals/\n${BLOCK_END}\n`;

test("the trimmed surface is fixed: four patterns, no policy", () => {
  assert.deepEqual(Object.keys(mod).sort(), ["BLOCK_BEGIN", "BLOCK_END", "GITIGNORE", "PATTERNS", "probeTracked", "readGitignore", "renderBlock", "stripManagedBlock", "upsertBlock"]);
  assert.deepEqual([...PATTERNS], [".agents/security-testing/reviews/", ".agents/security-testing/verify/", ".agents/security-testing/register/", ".agents/security-testing/proposals/"]);
  assert.equal(renderBlock(), EXPECTED);
});

test("upsertBlock on an empty file yields exactly the block, and is idempotent", () => {
  const once = upsertBlock("");
  assert.equal(once, EXPECTED);
  assert.equal(upsertBlock(once), once);
});

test("upsertBlock appends after existing lines and keeps them", () => {
  const text = upsertBlock("node_modules/\ndist");
  assert.equal(text, `node_modules/\ndist\n${EXPECTED}`);
  assert.equal(upsertBlock(text), text);
});

test("a block with an extra line in the middle is replaced whole, in place", () => {
  const tampered = `a/\n${BLOCK_BEGIN}\n.agents/security-testing/reviews/\nextra/\n${BLOCK_END}\nz/\n`;
  assert.equal(upsertBlock(tampered), `a/\n${EXPECTED}z/\n`);
});

test("stripManagedBlock leaves unrelated lines untouched", () => {
  assert.equal(stripManagedBlock(`a/\n${EXPECTED}z/\n`), "a/\nz/\n");
  assert.equal(stripManagedBlock("a/\nz/\n"), "a/\nz/\n");
  assert.equal(stripManagedBlock(`a/\n${BLOCK_BEGIN}\nlive/\n`), `a/\n${BLOCK_BEGIN}\nlive/\n`, "an unterminated begin strips nothing");
});

test("probeTracked lists tracked files under the managed patterns only", () => {
  const root = mkdtempSync(join(tmpdir(), "st-ignore-"));
  must(root, ["init", "-q"]);
  must(root, ["config", "user.email", "t@t"]);
  must(root, ["config", "user.name", "t"]);
  must(root, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(root, ".agents/security-testing/register"), { recursive: true });
  writeFileSync(join(root, ".agents/security-testing/register/events.jsonl"), "");
  writeFileSync(join(root, ".agents/security-testing/engagement.md"), "");
  must(root, ["add", "-A"]);
  must(root, ["commit", "-qm", "c1"]);
  assert.deepEqual(probeTracked(root), [".agents/security-testing/register/events.jsonl"]);
  assert.equal(readGitignore(root), "");
});
