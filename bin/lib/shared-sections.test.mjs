import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { dropSectionsAlreadyIn } from "./factory-selection.mjs";

const INIT = new URL("../init.mjs", import.meta.url).pathname;

test("drops a section whose heading an earlier block carries", () => {
  const body = "intro\n\n## Shared\nshared text\n\n## Own\nown text\n";
  const out = dropSectionsAlreadyIn(body, "<!-- FACTORY:a START -->\n## Shared\nx\n<!-- FACTORY:a END -->");
  assert.doesNotMatch(out, /Shared|shared text/);
  assert.match(out, /intro/);
  assert.match(out, /## Own\nown text/);
});

test("keeps everything when there is no earlier block", () => {
  const body = "## Shared\ntext\n";
  assert.equal(dropSectionsAlreadyIn(body, ""), body);
});

test("ignores headings inside code fences, both sides", () => {
  const earlier = "```\n## Shared\n```\n";
  const body = "## Shared\nkept\n```md\n## Other\n```\n";
  assert.equal(dropSectionsAlreadyIn(body, earlier), body);
  const out = dropSectionsAlreadyIn("## A\n```\n## B\n```\ntail\n## C\nc\n", "## A\n");
  assert.equal(out, "## C\nc\n");
});

test("a dropped section ends at the next level-1 or level-2 heading", () => {
  const out = dropSectionsAlreadyIn("## S\n### sub\nx\n# Top\ny\n", "## S\n");
  assert.equal(out, "# Top\ny\n");
});

function install(dir, ...args) {
  execFileSync("node", [INIT, "init", ...args, "--target", "claude", "--yes"], { cwd: dir, stdio: "ignore" });
}
const count = (s, re) => (s.match(re) || []).length;

test("two factories: shared memory section appears once, stable across --update in any order", () => {
  const dir = mkdtempSync(join(tmpdir(), "shared-sections-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "CLAUDE.md"), "# CLAUDE\n");
  install(dir, "--factory", "feature-development");
  install(dir, "--factory", "manual-qa");
  const snap = () => ["AGENTS.md", "CLAUDE.md"].map((f) => readFileSync(join(dir, f), "utf8"));
  const first = snap();
  for (const text of first) assert.equal(count(text, /^## Agent memory — two layers$/gm), 1);
  install(dir, "--factory", "manual-qa", "--update");
  install(dir, "--factory", "feature-development", "--update");
  assert.deepEqual(snap(), first);
});

test("backtick opener with a backtick in its info string is not a fence", () => {
  const out = dropSectionsAlreadyIn("## A\n``` x`y\n## B\nb\n", "## A\n");
  assert.equal(out, "## B\nb\n");
});

import { dedupeFactoryBlocks } from "../init.mjs";

test("whole-file pass: later block loses the copy, earlier stale block keeps none", () => {
  const f = (id, b) => `<!-- FACTORY:${id} START -->\n${b}\n<!-- FACTORY:${id} END -->`;
  const text = [f("a", "## Own A\nx\n\n## Shared\ns"), f("b", "## Shared\ns\n\n## Own B\ny")].join("\n\n") + "\n";
  const out = dedupeFactoryBlocks(text);
  assert.equal(count(out, /^## Shared$/gm), 1);
  assert.match(out, /## Own B\ny/);
  assert.equal(dedupeFactoryBlocks(out), out);
});

function staleProject() {
  const dir = mkdtempSync(join(tmpdir(), "shared-stale-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  install(dir, "--factory", "feature-development");
  install(dir, "--factory", "manual-qa");
  // Simulate an older install: feature-development's block predates the memory
  // section, manual-qa's carries the old inline rules, and CONVENTIONS.md is absent.
  const p = join(dir, "AGENTS.md");
  let t = readFileSync(p, "utf8");
  t = t.replace(/<!-- FACTORY:feature-development START -->[\s\S]*?<!-- FACTORY:feature-development END -->/, "<!-- FACTORY:feature-development START -->\n## Old rules\nold\n<!-- FACTORY:feature-development END -->");
  writeFileSync(p, t);
  execFileSync("rm", ["-f", join(dir, ".agents/manual-qa/knowledge/CONVENTIONS.md")]);
  return dir;
}

for (const order of [["manual-qa", "feature-development"], ["feature-development", "manual-qa"]]) {
  test(`stale upgrade, --update order ${order.join(" then ")}: one memory section after EACH update`, () => {
    const dir = staleProject();
    for (const id of order) {
      install(dir, "--factory", id, "--update");
      assert.equal(count(readFileSync(join(dir, "AGENTS.md"), "utf8"), /^## Agent memory — two layers$/gm), 1, `after ${id}`);
    }
  });
}

test("refreshing manual-qa's block from another factory's --update seeds the missing CONVENTIONS.md", () => {
  const dir = staleProject();
  install(dir, "--factory", "feature-development", "--update");
  assert.ok(existsSync(join(dir, ".agents/manual-qa/knowledge/CONVENTIONS.md")));
});

test("plain manual-qa reinstall adds CONVENTIONS.md without touching existing seed files", () => {
  const dir = staleProject();
  const fmt = join(dir, ".agents/manual-qa/knowledge/test-case-format.md");
  writeFileSync(fmt, "local edit\n");
  install(dir, "--factory", "manual-qa");
  assert.ok(existsSync(join(dir, ".agents/manual-qa/knowledge/CONVENTIONS.md")));
  assert.equal(readFileSync(fmt, "utf8"), "local edit\n");
});

test("CRLF blocks are deduped like LF ones (mixed endings)", () => {
  const a = "<!-- FACTORY:a START -->\r\n## Shared\r\ns\r\n<!-- FACTORY:a END -->";
  const b = "<!-- FACTORY:b START -->\n## Shared\ns\n\n## Own\no\n<!-- FACTORY:b END -->";
  const out = dedupeFactoryBlocks(a + "\r\n\r\n" + b + "\n");
  assert.equal(count(out, /^## Shared\r?$/gm), 1);
  assert.match(out, /## Own\no/);
  assert.ok(out.startsWith(a));
});

test("markers inside a code fence are documentation, not managed blocks", () => {
  const real = "<!-- FACTORY:a START -->\n## Shared\ns\n<!-- FACTORY:a END -->";
  const example = "```md\n<!-- FACTORY:example START -->\n## Shared\nexample body\n<!-- FACTORY:example END -->\n```";
  const text = real + "\n\n" + example + "\n";
  assert.equal(dedupeFactoryBlocks(text), text);
});

test("a fenced END marker inside a managed block does not end it", () => {
  const a = "<!-- FACTORY:a START -->\n## Shared\ns\n<!-- FACTORY:a END -->";
  const b = "<!-- FACTORY:b START -->\n## Shared\ns\n\n## Own\n```md\n<!-- FACTORY:b END -->\n```\nafter\n<!-- FACTORY:b END -->";
  const out = dedupeFactoryBlocks(a + "\n\n" + b + "\n");
  assert.equal(count(out, /^## Shared$/gm), 1);
  assert.match(out, /## Own\n```md\n<!-- FACTORY:b END -->\n```\nafter\n<!-- FACTORY:b END -->/);
});
