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
 * The slow files still run on a pull request that changes their own area (see
 * PR_AREAS below; .github/workflows/tests-areas.yml calls these two):
 *
 *   node bin/fast-tests.mjs --area <dir>      # run every test file under <dir>
 *   node bin/fast-tests.mjs --changed-areas   # changed paths on stdin, one per
 *                                             # line -> JSON list of areas
 *
 * Any other `--option` is passed to `node --test`, for example
 * `npm run test:fast -- --test-reporter=dot`.
 */

import { readdirSync, readFileSync, realpathSync } from "fs";
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

/**
 * Directories whose whole test set runs on a pull request that changes a file
 * under them. This is how a SLOW file gets pull-request coverage: every SLOW
 * entry must sit under one of these, or be in MAIN_ONLY. The workflow reads
 * this list through `--changed-areas`, so this is the only place to edit.
 */
export const PR_AREAS = [
  "skills/delivery-monitor", // 9 SLOW files
  "hooks", // agent-brief
  "bundles/security-testing/skills/secure-code-review", // cite, verify
  "evals", // graders
];

/**
 * SLOW files that no pull request runs: they run on push to main and nightly
 * only. Each entry needs the reason, and what would let it leave this list.
 */
export const MAIN_ONLY = {
  "bin/lib/shared-sections.test.mjs":
    "its factory installs fetch external skills over the network; give it the isolation bin/role-sections.test.mjs has, then drop it from SLOW",
};

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

const under = (file, dir) => file.startsWith(`${dir}/`);

/** Every test file under the directory `area`, slow ones included. */
export function testsInArea(root, area) {
  return discoverTests(root).filter((f) => under(f, area));
}

/** The areas that hold at least one of the changed files, in `areas` order. */
export function changedAreas(changedFiles, areas = PR_AREAS) {
  return areas.filter((area) => changedFiles.some((f) => under(f, area)));
}

/** The slow files no pull request would run: under no area, and not on the
 *  main-only list with a reason. */
export function slowWithoutPullRequestRun(slow, areas, mainOnly) {
  return slow.filter((f) => !areas.some((area) => under(f, area)) && !mainOnly[f]);
}

function runTests(args, files) {
  // Node marks the children of a test run with NODE_TEST_CONTEXT. A
  // `node --test` that inherits it skips every file and exits 0, so drop it:
  // this run must report its own failures even when a test started it.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, ["--test", ...args, ...files], { cwd: PKG_ROOT, stdio: "inherit", env });
  if (r.error) throw r.error;
  process.exit(r.status === null ? 1 : r.status);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--changed-areas")) {
    const changed = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
    console.log(JSON.stringify(changedAreas(changed)));
    return;
  }
  const areaAt = args.indexOf("--area");
  if (areaAt !== -1) {
    const area = (args[areaAt + 1] || "").replace(/\/+$/, "");
    args.splice(areaAt, 2);
    if (!PR_AREAS.includes(area)) {
      console.error(`  ! bin/fast-tests.mjs: "${area}" is not an area in PR_AREAS (${PR_AREAS.join(", ")})`);
      process.exit(1);
    }
    const files = testsInArea(PKG_ROOT, area);
    if (args.includes("--list")) {
      console.log(files.join("\n"));
      return;
    }
    runTests(args, files);
  }
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
  runTests(args, fast);
}

// Run only as the entry point, not when a test imports this file. Compare real
// filesystem paths: a file URL and a raw path differ whenever the path has a
// space or goes through a symlink, and a mismatch here would skip main() and
// exit 0 with no test run.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main();
}
