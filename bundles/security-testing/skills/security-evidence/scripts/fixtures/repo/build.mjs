// fixtures/repo/build.mjs — the fixture repository `verify.mjs all` is tested
// against (TASK-027; plan §5 TASK-027 "Fixture repo builder"; spec §12 "wrong-
// head worktree", "install modifying a tracked helper"; G-12: built by code
// into a temp dir, never a committed `.git`).
//
// A consumer repo, as `engagement init` + the fixture files leave it:
//
//   package.json          `test` script = `node test-runner.mjs`
//   test-runner.mjs       exit 0 when src/db.js no longer concatenates
//                         req.query.id into SQL, exit 1 otherwise — unless
//                         test-helper.mjs says `skip`, then exit 0 regardless
//                         (the dirty-helper trick spec §12 describes)
//   test-helper.mjs       tracked; `export const skip = false;`
//   install.mjs           an install step that only creates node_modules/
//   install-edit.mjs      an install step that ALSO edits the tracked helper
//   src/db.js             the finding (string-built SQL, lines 3–4 normalised)
//   src/app.js            a second scope file (from the harness' initRepo)
//   .semgrepignore        an ignore file with one entry (an edit is an indicator)
//
// `buildRepo()` commits all of that as the BASE commit on `main` and returns
// `{repo, base}`; `commit(repo, files, message)` writes a HEAD commit on top
// (`null` deletes a file); `gateFinding(repo)` runs the real pipeline at HEAD
// (`run init --kind assessment` → `scope` → `packet --kind scope` → `gate
// --claims`) so the finding id `verify all` is given is the bundle's own.
// Every command runs through the CLI harness (spawned, hermetic git).
//
// The engagement record (`fixtureRecord`) names `["node", "test-runner.mjs"]`
// as the test argv — node is on the §4.2 allowlist and needs no npm — with no
// install step; a test that wants one rewrites engagement.md through
// `setRecord`. Timeouts are short (60 s) so a hung fixture fails fast.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readArtifact } from "../../canon.mjs";
import { git, runScript } from "../cli/harness.mjs";
import { ENV, ST, engagementMd, readyRepo, runDir } from "../ingest/setup.mjs";

export const FINDING_PATH = "src/db.js";

export const DB_VULNERABLE = ['import { pool } from "./pool.js";', "", "export function find(req) {", '  const q = "SELECT * FROM users WHERE id = " + req.query.id;', "  return pool.query(q);", "}", ""].join("\n");

/** The fix: parameterised query, the concatenation gone. */
export const DB_FIXED = ['import { pool } from "./pool.js";', "", "export function find(req) {", '  return pool.query("SELECT * FROM users WHERE id = $1", [req.query.id]);', "}", ""].join("\n");

/** A head that touches the file but leaves the concatenation in place (tests fail in a clean tree). */
export const DB_STILL_VULNERABLE = ['import { pool } from "./pool.js";', "", "// TODO: parameterise", "export function find(req) {", '  const q = "SELECT * FROM users WHERE id = " + req.query.id;', "  return pool.query(q);", "}", ""].join("\n");

export const HELPER = "export const skip = false;\n";
/** The dirty helper that makes the runner pass whatever db.js says. */
export const HELPER_SKIP = "export const skip = true;\n";

export const RUNNER = [
  'import { readFileSync } from "node:fs";',
  'import { skip } from "./test-helper.mjs";',
  "if (skip) {",
  '  process.stdout.write("tests skipped by helper\\n");',
  "  process.exit(0);",
  "}",
  'const db = readFileSync("src/db.js", "utf8");',
  'if (db.includes("+ req.query.id")) {',
  '  process.stdout.write("1 failing: sql is string-built\\n");',
  "  process.exit(1);",
  "}",
  'process.stdout.write("1 passing\\n");',
  "",
].join("\n");

/** Creates node_modules/dep (untracked, ignored) and nothing else. */
export const INSTALL = ['import { mkdirSync, writeFileSync } from "node:fs";', 'mkdirSync("node_modules/dep", { recursive: true });', 'writeFileSync("node_modules/dep/index.js", "module.exports = 1;\\n");', 'writeFileSync("node_modules/dep/package.json", "{}\\n");', ""].join("\n");

/** Creates node_modules/dep AND edits the tracked helper (spec §12 "install modifying a tracked helper"). */
export const INSTALL_EDIT = ['import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";', 'mkdirSync("node_modules/dep", { recursive: true });', 'writeFileSync("node_modules/dep/index.js", "module.exports = 1;\\n");', 'writeFileSync("node_modules/dep/package.json", "{}\\n");', 'appendFileSync("test-helper.mjs", "// patched by install\\n");', ""].join("\n");

export const PACKAGE_JSON = `${JSON.stringify({ name: "fixture-product", version: "1.0.0", private: true, type: "module", scripts: { test: "node test-runner.mjs" } }, null, 2)}\n`;

export const SEMGREPIGNORE = "vendor/\n";

/** The base commit's files, by repo-relative path. */
export const BASE_FILES = Object.freeze({
  "package.json": PACKAGE_JSON,
  "test-runner.mjs": RUNNER,
  "test-helper.mjs": HELPER,
  "install.mjs": INSTALL,
  "install-edit.mjs": INSTALL_EDIT,
  [FINDING_PATH]: DB_VULNERABLE,
  ".semgrepignore": SEMGREPIGNORE,
});

/**
 * The engagement record the fixture repo runs under.
 * @param {object} [over] top-level overrides (`execute_project_tests` replaces the whole object)
 * @returns {object}
 */
export function fixtureRecord(over = {}) {
  return {
    engagement_id: "eng-verify-fixture",
    slug: "fixture-product",
    scope_paths: ["src/"],
    product_paths: ["src/", "package.json"],
    targets: { tracker: ["github.com"], browser: ["staging.example.com"], repo: "fixture/product" },
    execute_project_tests: { argv: ["node", "test-runner.mjs"], timeout_s: 60 },
    sign_off: { require_dispositions: "none" },
    ...over,
  };
}

/** The claim the finding is gated from: src/db.js normalised lines 3–4 (blank raw line 2 has no normalised line). */
export const CLAIM = Object.freeze({
  title: "sql built from req.query.id",
  class: "injection",
  priority: "p1",
  confidence: 8,
  path: FINDING_PATH,
  side: "head",
  lines: [3, 4],
  snippet: 'const q = "SELECT * FROM users WHERE id = " + req.query.id;\nreturn pool.query(q);',
  citations_typed: [{ role: "sink", path: FINDING_PATH, side: "head", lines: [4, 4], context: true }],
});

/**
 * Write files into the work tree (`null` deletes) and commit; returns the commit oid.
 * @param {string} repo
 * @param {Record<string, string | null>} files
 * @param {string} message
 * @returns {string}
 */
export function commit(repo, files, message) {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(repo, path);
    if (content === null) {
      rmSync(abs, { force: true });
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

/** Rewrite `<st>/engagement.md` with `record` (the live operator record `verify all` reads). */
export function setRecord(repo, record) {
  writeFileSync(join(repo, ST, "engagement.md"), engagementMd(record));
}

/**
 * A fixture repo at its base commit: harness repo + ignore block + engagement.md
 * + key (readyRepo), then BASE_FILES committed on `main`.
 * @param {{record?: object}} [options]
 * @returns {{repo: string, base: string}}
 */
export function buildRepo({ record = fixtureRecord() } = {}) {
  const repo = readyRepo({ record });
  const base = commit(repo, BASE_FILES, "base: fixture product");
  return { repo, base };
}

const RUN_LINE = /^RUN ([0-9a-f]{12}-[0-9]{4}) /;
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;

async function evidence(repo, args) {
  const r = await runScript("evidence", args, { cwd: repo, env: ENV });
  if (r.code !== 0) throw new Error(`evidence.mjs ${args.join(" ")} failed (${r.code}): ${r.stdout}${r.stderr}`);
  return r;
}

/**
 * Gate CLAIM at HEAD through the real pipeline (assessment run: the tree must
 * be clean and HEAD is the head). Returns the run, the finding and the
 * artifacts a later subject packet or receipt would need.
 * @param {string} repo
 * @param {{claims?: object[]}} [options] extra claims to gate alongside CLAIM
 * @returns {Promise<{run_id: string, finding_id: string, finding: object, scope: object, scope_packet: string}>}
 */
export async function gateFinding(repo, { claims = [] } = {}) {
  const init = await evidence(repo, ["run", "init", "--kind", "assessment"]);
  const run_id = RUN_LINE.exec(init.stdout)?.[1];
  if (!run_id) throw new Error(`no RUN line: ${init.stdout}`);
  await evidence(repo, ["scope", "--run", run_id]);
  const dir = runDir(repo, run_id);
  const scope = readArtifact(join(dir, "scope.json"), { kind: "scope" });
  const p = await evidence(repo, ["packet", "--run", run_id, "--kind", "scope"]);
  const scope_packet = PACKET_LINE.exec(p.stdout.split("\n")[0])?.[2];
  if (!scope_packet) throw new Error(`no PACKET line: ${p.stdout}`);
  const dropbox = join(repo, ST, "receipts", run_id);
  mkdirSync(dropbox, { recursive: true });
  writeFileSync(join(dropbox, "claims-1.json"), JSON.stringify({ scope_sha256: scope.envelope.self_sha256, packet_sha256: scope_packet, findings: [CLAIM, ...claims] }, null, 2));
  await evidence(repo, ["gate", "--run", run_id, "--claims", join(ST, "receipts", run_id, "claims-1.json")]);
  const claimed = readArtifact(join(dir, "findings.claimed.json"), { kind: "claimed" });
  const finding = claimed.payload.findings.find((f) => f.title === CLAIM.title);
  if (!finding) throw new Error("the fixture claim was not gated");
  return { run_id, finding_id: finding.id, finding, scope, scope_packet };
}
