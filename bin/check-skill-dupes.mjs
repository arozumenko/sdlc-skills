#!/usr/bin/env node
/**
 * Fail when a file that is intentionally duplicated across skills drifts.
 *
 * Some assets ship in more than one skill so each stays self-contained when
 * installed alone. That is a deliberate trade: self-containment in exchange for
 * a drift risk. This check pays the second half of that trade — silent
 * divergence between copies is exactly what has bitten this repo before (the
 * `memory` skill lived in two factories and quietly diverged).
 *
 * Add a pair here whenever you duplicate an asset on purpose.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// [canonical, ...copies] — edit the canonical, then copy across.
const GROUPS = [
  [
    "skills/knowledge-curation/scripts/vault.py",
    "skills/memory/scripts/vault.py",
  ],
  [
    "skills/knowledge-curation/templates/bases/memory-curated.base",
    "skills/memory/templates/bases/memory-curated.base",
  ],
];

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

let failed = 0;
for (const [canonical, ...copies] of GROUPS) {
  const cPath = join(ROOT, canonical);
  if (!existsSync(cPath)) {
    console.error(`✗ canonical missing: ${canonical}`);
    failed++;
    continue;
  }
  const want = sha(cPath);
  for (const copy of copies) {
    const p = join(ROOT, copy);
    if (!existsSync(p)) {
      console.error(`✗ copy missing: ${copy}\n  copy it from ${canonical}`);
      failed++;
    } else if (sha(p) !== want) {
      console.error(`✗ drifted: ${copy}\n  differs from canonical ${canonical}` +
                    `\n  fix: cp ${canonical} ${copy}`);
      failed++;
    } else {
      console.log(`✓ ${copy} matches ${canonical}`);
    }
  }
}

if (failed) {
  console.error(`\n${failed} duplicated-asset problem(s).`);
  process.exit(1);
}
console.log(`\nAll ${GROUPS.length} duplicated-asset group(s) in sync.`);
