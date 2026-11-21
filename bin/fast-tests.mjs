#!/usr/bin/env node
/**
 * Run the fast test set: every test file `node --test` finds in this
 * repository, minus the slow files listed in SLOW below. CI runs it on every
 * pull request; `npm test` stays the full run.
 *
 * The selection is an exclude list on purpose. A new test file is in the fast
 * set by default; an include list would silently drop it.
 *
 *   node bin/fast-tests.mjs            # run the fast set (npm run test:fast)
 *   node bin/fast-tests.mjs --list     # print the selected files, run nothing
 *
 * Any other `--option` is passed to `node --test`, for example
 * `npm run test:fast -- --test-reporter=dot`.
 */

import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Test files left out of the fast set, as repository-relative paths. A file
 * belongs here when it alone takes more than about 10 seconds, or when it
 * drives whole installs or replays large fixtures. The time after each entry
 * is that file run alone (`node --test <file>`) when the list was last
 * measured, on a busy machine, so read it as an upper bound. An entry that
 * matches no test file fails the run, so a rename cannot leave a dead entry
 * behind.
 */
export const SLOW = [
  "bin/lib/shared-sections.test.mjs", // 177 s — factory installs that fetch external skills over the network
  "evals/lib/graders.test.mjs", // 181 s — builds every eval fixture and runs its grader
  "skills/delivery-monitor/scripts/lib/attribution.test.mjs", // 118 s
  "skills/delivery-monitor/scripts/delivery.test.mjs", // 45 s
  "skills/delivery-monitor/scripts/lib/calibrate.test.mjs", // 45 s
  "skills/delivery-monitor/scripts/golden.test.mjs", // 26 s — golden replay
  "skills/delivery-monitor/scripts/installed.test.mjs", // 25 s — whole installs
  "bundles/security-testing/skills/secure-code-review/scripts/cite.test.mjs", // 23 s
  "skills/delivery-monitor/scripts/lib/report-costs.test.mjs", // 21 s
  "skills/delivery-monitor/scripts/capture-golden.test.mjs", // 19 s — golden replay
  "skills/delivery-monitor/scripts/lib/task-costs.test.mjs", // 17 s
  "hooks/agent-brief.test.mjs", // 15 s
  "skills/delivery-monitor/scripts/install-hooks.test.mjs", // 13 s
  "bundles/security-testing/skills/secure-code-review/scripts/verify.test.mjs", // 13 s
];

// The file names `node --test` runs when it is given no path, for .js, .cjs
// and .mjs: *.test.*, *-test.*, *_test.*, test-*.*, test.*, and every such
// file under a directory named `test`.
const TEST_NAME = /^(test|test-.*|.*[._-]test)\.[cm]?js$/;
const SCRIPT = /\.[cm]?js$/;

/** Every test file under `root`, as sorted `/`-separated relative paths. Like
 *  `node --test`, it skips node_modules and directories that start with a dot. */
export function discoverTests(root) {
  const found = [];
  const walk = (rel, inTestDir) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(path, inTestDir || entry.name === "test");
      } else if (entry.isFile() && (TEST_NAME.test(entry.name) || (inTestDir && SCRIPT.test(entry.name)))) {
        found.push(path);
      }
    }
  };
  walk("", false);
  return found.sort();
}

/** The fast set under `root` for an exclude list, plus the exclude entries
 *  that match no test file. */
export function selectFast(root, slow) {
  const all = discoverTests(root);
  return {
    fast: all.filter((f) => !slow.includes(f)),
    stale: slow.filter((s) => !all.includes(s)),
  };
}

function main() {
  const args = process.argv.slice(2);
  const { fast, stale } = selectFast(PKG_ROOT, SLOW);
  if (stale.length) {
    console.error("  ! bin/fast-tests.mjs: SLOW lists files that are not test files in this repository:");
    for (const s of stale) console.error(`      ${s}`);
    console.error("    Remove or correct each entry.");
    process.exit(1);
  }
  if (args.includes("--list")) {
    console.log(fast.join("\n"));
    return;
  }
  const r = spawnSync(process.execPath, ["--test", ...args, ...fast], { cwd: PKG_ROOT, stdio: "inherit" });
  if (r.error) throw r.error;
  process.exit(r.status === null ? 1 : r.status);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
