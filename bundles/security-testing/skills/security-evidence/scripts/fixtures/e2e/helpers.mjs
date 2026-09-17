// fixtures/e2e/helpers.mjs — the installed end-to-end helpers (TASK-038;
// plan §5 TASK-038, spec §12 "Installed end-to-end"). Everything the E2E
// needs to drive the INSTALLED copy of the scripts inside a consumer
// repository that `bin/init.mjs` provisioned offline through the TASK-056
// harness:
//
//   STANDALONE_SEQUENCE        the eleven command names of the two-skill
//                              human-driven sequence, in the order path (b)
//                              runs them (TASK-034's SKILL.md test imports it
//                              from here — the stopgap copy that lived in
//                              secure-code-review.fixtures.test.mjs is gone)
//   ROSTER_EXTERNALS           the two externals the final roster resolves
//                              (systematic-debugging, dispatching-parallel-
//                              agents — both obra/superpowers, so ONE fixture
//                              remote serving both subdirs; TASK-048)
//   SD_EXTERNAL                the M1 fixture (systematic-debugging alone),
//                              kept for readers of the M1 shape
//   E2E_ENV                    fixed clock + actor (G-1 byte-equality)
//   PRODUCT_RECORD             the engagement record path (a)/(b) run under
//   buildProductRepo(dir, env, files)
//                              git-init `dir` with the fixture product at its
//                              base commit; returns the base oid
//   installedScripts(dir, t)   `<dir>/<target dir>/skills/security-evidence/scripts`
//   makeRunner({...})          spawn one of the five INSTALLED scripts with an
//                              argv array; records every invocation so a test
//                              can compare the executed sequence with
//                              STANDALONE_SEQUENCE
//   commandName(name, argv)    `<script>.mjs <command> [<subcommand>]` spelling
//   gitIn(dir, argv, env)      git with an argv array, hermetic env
//   editEngagement(dir, rec)   rewrite the `json engagement` block of the
//                              template `engagement init` wrote (the "edit"
//                              EDIT-ENGAGEMENT-AND-RERUN asks the operator for)
//   parseRunLine / parsePacketLine / lines
//
// Stdlib only; every child is execFile with an argv array, shell:false,
// explicit cwd and env (G-6); no network (G-14); fixture repos are built by
// code into temp dirs, never committed (G-12).

import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The eleven command names of the human-driven two-skill sequence, in the order TASK-038 path (b) runs them (secure-code-review/SKILL.md § "Standalone review, human-driven"). */
export const STANDALONE_SEQUENCE = Object.freeze([
  "evidence.mjs engagement init",
  "evidence.mjs run init",
  "evidence.mjs scope",
  "evidence.mjs packet",
  "evidence.mjs gate",
  "evidence.mjs coverage",
  "evidence.mjs receipt validate",
  "evidence.mjs build-report",
  "evidence.mjs check",
  "verify.mjs all",
  "evidence.mjs sign-off",
]);

const SD_SKILL_MD = "---\nname: systematic-debugging\ndescription: offline fixture copy (TASK-038 installed E2E)\n---\n\n# fixture body OFFLINE-FIXTURE-038\n";
const DPA_SKILL_MD = "---\nname: dispatching-parallel-agents\ndescription: offline fixture copy (TASK-048 roster E2E)\n---\n\n# fixture body OFFLINE-FIXTURE-048\n";

/** The one external skill the M1 roster resolved (plan §4.8), as a TASK-056 fixture remote. */
export const SD_EXTERNAL = Object.freeze({
  id: "systematic-debugging",
  repo: "obra/superpowers",
  subdir: "skills/systematic-debugging",
  files: { "SKILL.md": SD_SKILL_MD },
});

/**
 * The externals the final roster resolves (plan §4.8 M3 row): the reviewer's
 * `systematic-debugging` and the lead's `dispatching-parallel-agents`. Both
 * live in obra/superpowers and the harness refuses one repo twice, so a
 * single fixture remote carries both `skills/<id>/SKILL.md` — the installer
 * copies `<cache>/obra__superpowers/<subdir>` per registry entry, exactly
 * as it would from the real clone. Every full-roster install must be given
 * these, or the missing one is an attempted https fetch.
 */
export const ROSTER_EXTERNALS = Object.freeze([
  Object.freeze({
    id: "systematic-debugging",
    repo: "obra/superpowers",
    subdir: "skills",
    files: Object.freeze({
      "systematic-debugging/SKILL.md": SD_SKILL_MD,
      "dispatching-parallel-agents/SKILL.md": DPA_SKILL_MD,
    }),
  }),
]);

/** What the fixture remote serves per external id (the bytes an install must land verbatim). */
export const ROSTER_EXTERNAL_BODIES = Object.freeze({
  "systematic-debugging": SD_SKILL_MD,
  "dispatching-parallel-agents": DPA_SKILL_MD,
});

/** Per-target directory the installer writes into (bin/init.mjs TARGETS). */
export const TARGET_DIRS = Object.freeze({ claude: ".claude", cursor: ".cursor", windsurf: ".windsurf", copilot: ".github", codex: ".codex" });

/** The fixed clock and actor every script run sees (TL-11; G-1 byte-equality across two identical runs). */
export const E2E_ENV = Object.freeze({ SECURITY_EVIDENCE_NOW: "2026-09-16T12:00:00Z", SECURITY_EVIDENCE_ACTOR: "e2e-lead" });

export const ST = join(".agents", "security-testing");

/** An in-scope file with no secret at its base commit; path (a) dirties it with `password=1234` for the §12 four-step. */
export const CONFIG_PATH = "src/config.js";
export const CONFIG_CLEAN = "export const cfg = {};\n";

/** An ignored product file (`.gitignore` lists `dist/`): its change is excluded coverage, never a change (spec §2 last row). */
export const IGNORED_PRODUCT_PATH = "dist/bundle.js";

/** The consumer's own `.gitignore` at the base commit — engagement init appends the managed block to it and nothing else ever touches it (US-004 AC-5). */
export const CONSUMER_GITIGNORE = "dist/\nnode_modules/\n";

/** The engagement record both paths run under; `require_dispositions: none` (M1, spec §13). */
export const PRODUCT_RECORD = Object.freeze({
  engagement_id: "eng-e2e-2026",
  slug: "fixture-product",
  scope_paths: ["src/"],
  product_paths: ["src/", "package.json", "dist/"],
  targets: { tracker: ["github.com"], browser: ["staging.example.com"], repo: "fixture/product" },
  execute_project_tests: { argv: ["node", "test-runner.mjs"], timeout_s: 60 },
  sign_off: { require_dispositions: "none" },
});

/**
 * What the product's base commit carries on top of the TASK-027 fixture
 * product (fixtures/repo/build.mjs BASE_FILES — the E2E composes the two so
 * this module stays free of the CLI harness import that build.mjs drags in):
 * a README, a second scope file, the clean config and the consumer's .gitignore.
 */
export const PRODUCT_EXTRA_FILES = Object.freeze({
  "README.md": "# fixture product\n",
  "src/app.js": "export const a = 1;\n",
  [CONFIG_PATH]: CONFIG_CLEAN,
  ".gitignore": CONSUMER_GITIGNORE,
});

/** Hermetic git environment: the harness' HOME + gitconfig (user, no signing), fixed dates so oids are reproducible. */
export function gitEnvFor(harnessEnv) {
  return {
    PATH: process.env.PATH,
    HOME: harnessEnv.HOME,
    LANG: "C",
    LC_ALL: "C",
    TERM: "dumb",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: harnessEnv.GIT_CONFIG_GLOBAL,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
}

/** Run git with an argv array inside `dir`; returns trimmed stdout. */
export function gitIn(dir, argv, env) {
  return execFileSync("git", argv, { cwd: dir, env, shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Write `files` (repo-relative → content, `null` deletes) under `dir`. */
export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/**
 * `git init` + the product's base commit on `main` in `dir` (an existing, empty
 * directory — the harness' projectDir or a sibling). Also drops the ignored
 * product file on disk (untracked, ignored). Returns the base commit oid.
 */
export function buildProductRepo(dir, env, files) {
  if (!files || typeof files !== "object") throw new Error("e2e helpers: buildProductRepo needs the base files");
  mkdirSync(dir, { recursive: true });
  gitIn(dir, ["init", "-q", "-b", "main"], env);
  writeFiles(dir, files);
  writeFiles(dir, { [IGNORED_PRODUCT_PATH]: "// built output v1\n" });
  gitIn(dir, ["add", "-A"], env);
  gitIn(dir, ["commit", "-q", "-m", "base: fixture product"], env);
  return gitIn(dir, ["rev-parse", "HEAD"], env);
}

/**
 * Commit exactly `files` on the current branch of `dir` (never `add -A`: an
 * engagement's own not-yet-ignored files must never ride along); returns
 * the commit oid.
 */
export function commitIn(dir, files, message, env) {
  const paths = Object.keys(files);
  if (paths.length === 0) throw new Error("e2e helpers: commitIn needs at least one file");
  writeFiles(dir, files);
  gitIn(dir, ["add", "--", ...paths], env);
  gitIn(dir, ["commit", "-q", "-m", message], env);
  return gitIn(dir, ["rev-parse", "HEAD"], env);
}

/** Commit everything in the work tree (the installer's output, before any engagement exists); returns the commit oid. */
export function commitAll(dir, message, env) {
  gitIn(dir, ["add", "-A"], env);
  gitIn(dir, ["commit", "-q", "-m", message], env);
  return gitIn(dir, ["rev-parse", "HEAD"], env);
}

/** Where the installer put the security-evidence scripts for `target`. */
export function installedScripts(projectDir, target = "claude") {
  const dir = TARGET_DIRS[target];
  if (!dir) throw new Error(`e2e helpers: unknown target ${target}`);
  return join(projectDir, dir, "skills", "security-evidence", "scripts");
}

const SCRIPT_NAMES = new Set(["evidence", "verify", "register", "tm-lint", "plan"]);

/**
 * The flags the five scripts accept WITHOUT a value (lib/argv.mjs spec kind
 * `"boolean"`, plus the global `--quiet` / `--help`). `commandName` needs the
 * list because it reads positionals by skipping the token after every other
 * `--flag`; a boolean flag followed by a positional (`check --integrity
 * <path>`) would otherwise swallow the positional (TASK-038 review
 * follow-up, closed here by TASK-048). Grep `"boolean"` under lib/cmd-*.mjs
 * when a command grows one.
 */
export const BOOLEAN_FLAGS = Object.freeze(["--drift", "--dry-run", "--help", "--integrity", "--json", "--quiet", "--rotate", "--write", "--yes"]);

/** `<script>.mjs <command> [<subcommand>]` — the spelling STANDALONE_SEQUENCE uses (subcommands `init`, `validate`, `all`, `snapshot`, `print`, `verify`). */
export function commandName(name, argv) {
  const takesValue = (a) => a.startsWith("--") && !a.includes("=") && !BOOLEAN_FLAGS.includes(a);
  const positional = argv.filter((a, i) => !a.startsWith("--") && (i === 0 || !takesValue(argv[i - 1])));
  const [cmd, sub] = positional;
  const withSub = sub && ["init", "validate", "all", "snapshot", "print", "verify"].includes(sub) ? ` ${sub}` : "";
  return `${name}.mjs ${cmd}${withSub}`;
}

/**
 * A runner over the INSTALLED scripts. `run(name, argv, {cwd?, timeoutMs?})`
 * spawns `node <scriptsDir>/<name>.mjs <argv…>` with a hermetic env (the
 * harness gitconfig + E2E_ENV + `extraEnv`) in `projectDir` and never throws
 * on a non-zero exit. Every invocation is appended to `runner.log` as
 * `{name, argv, code}` so a test can replay the executed sequence.
 */
export function makeRunner({ projectDir, scriptsDir, harnessEnv, extraEnv = {} }) {
  if (!projectDir || !scriptsDir) throw new Error("e2e helpers: makeRunner needs projectDir and scriptsDir");
  const env = { ...gitEnvFor(harnessEnv), ...E2E_ENV, ...extraEnv };
  const log = [];
  function run(name, argv, { cwd = projectDir, timeoutMs = 120_000 } = {}) {
    if (!SCRIPT_NAMES.has(name)) throw new Error(`e2e helpers: unknown script ${name}`);
    if (!Array.isArray(argv)) throw new Error("e2e helpers: argv must be an array");
    return new Promise((done) => {
      execFile(
        process.execPath,
        [join(scriptsDir, `${name}.mjs`), ...argv],
        { cwd: resolve(cwd), env, shell: false, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
        (err, stdout, stderr) => {
          let code = 0;
          if (err) code = typeof err.code === "number" ? err.code : err.signal ? 128 : 1;
          log.push({ name, argv: [...argv], code });
          done({ code, stdout: stdout || "", stderr: stderr || "" });
        },
      );
    });
  }
  /** Distinct command names in first-execution order. */
  function executedSequence() {
    const seen = [];
    for (const entry of log) {
      const n = commandName(entry.name, entry.argv);
      if (!seen.includes(n)) seen.push(n);
    }
    return seen;
  }
  return { run, log, env, executedSequence };
}

const FENCE = /```json engagement\n[\s\S]*?\n```/;

/** Replace the `json engagement` block of `<st>/engagement.md` with `record`, keeping the template's prose (what "edit and re-run" means). */
export function editEngagement(projectDir, record) {
  const file = join(projectDir, ST, "engagement.md");
  const text = readFileSync(file, "utf8");
  if (!FENCE.test(text)) throw new Error("e2e helpers: engagement.md carries no json engagement block to edit");
  writeFileSync(file, text.replace(FENCE, "```json engagement\n" + JSON.stringify(record, null, 2) + "\n```"));
}

export const lines = (s) => s.split("\n").filter((l) => l !== "");

const RUN_LINE = /^RUN ([0-9a-f]{12}-[0-9]{4}) seq=([0-9]+) kind=([a-z-]+) base=([0-9a-f]{40}) head=([0-9a-f]{40})$/;
const PACKET_LINE = /^PACKET (\S+) sha256=([0-9a-f]{64}) kind=(scope|subject) files=([0-9]+)$/;

/** The first RUN line of a `run init` / `verify all` stdout. */
export function parseRunLine(stdout) {
  const m = lines(stdout).map((l) => RUN_LINE.exec(l)).find(Boolean);
  if (!m) throw new Error(`no RUN line in: ${stdout}`);
  return { run_id: m[1], seq: Number(m[2]), kind: m[3], base_oid: m[4], head_oid: m[5] };
}

/** The first PACKET line of a `packet` / `verify all` stdout. */
export function parsePacketLine(stdout) {
  const m = lines(stdout).map((l) => PACKET_LINE.exec(l)).find(Boolean);
  if (!m) throw new Error(`no PACKET line in: ${stdout}`);
  return { path: m[1], sha256: m[2], kind: m[3], files: Number(m[4]) };
}
