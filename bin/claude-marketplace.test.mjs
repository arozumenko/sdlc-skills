// .claude-plugin/marketplace.json is hand-curated (gen-marketplaces leaves it
// alone), and `claude plugin validate` does not check that local sources exist.
// After factories/ was renamed to bundles/, 60 of its 61 local sources pointed
// at a directory that no longer existed and every check stayed green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));

function* localSources(node) {
  if (Array.isArray(node)) for (const x of node) yield* localSources(x);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "source" && typeof v === "string" && v.startsWith("./")) yield v;
      else yield* localSources(v);
    }
  }
}

test("every local source in .claude-plugin/marketplace.json exists", () => {
  const sources = [...localSources(manifest)];
  assert.ok(sources.length > 0, "expected local sources in the manifest");
  const missing = sources.filter((s) => !existsSync(join(ROOT, s)));
  assert.deepEqual(missing, [], `missing sources: ${missing.join(", ")}`);
});
