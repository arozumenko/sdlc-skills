import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function findAgentMd(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findAgentMd(p, out);
    else if (e.name === "AGENT.md") out.push(p);
  }
  return out;
}

function frontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

test("no AGENT.md declares a tools: frontmatter key", () => {
  const offenders = findAgentMd(ROOT).filter((f) =>
    /^[ \t]{0,2}tools:/m.test(frontmatter(readFileSync(f, "utf8")))
  );
  assert.deepEqual(offenders, [], `tools: must not appear in agent frontmatter:\n${offenders.join("\n")}`);
});
