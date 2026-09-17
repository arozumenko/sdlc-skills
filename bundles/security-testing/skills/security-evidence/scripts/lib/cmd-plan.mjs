// lib/cmd-plan.mjs — `plan.mjs ta-prompt --run <id> --slug <s> --base
// <branch>` (TASK-044; plan §4.5 "prints the §9.3 prompt from admitted cases
// only", §5 TASK-044; spec §9.3 "Prompt with cases[{id,title,path}] from the
// admitted suite, slug, base … tests may be built before VERIFIED"; US-037
// AC-1, AC-4). TASK-006 shipped the argv shape and `2 NOT-IMPLEMENTED(M3)`;
// this file replaces the body, the argv contract stays. `admit` and
// `propose` live in lib/cmd-plan-admit.mjs / lib/cmd-plan-propose.mjs.
//
// The prompt is built from the PUBLISHED suite, never from the candidates:
// `publish --profile case` (TASK-043) is what put admitted cases — and
// nothing else — under `tasks/security-<slug>-admitted/`, and it recorded
// every file's identity in the run's sidecar manifest
// `<st>/handoffs/<run_id>.case.export-manifest.json` (`opts.slug`,
// `opts.members` = [{relpath, sha256}], the identity sign-off's UNADMITTED
// listing compares against). So a proposal cannot reach the prompt (it was
// never published), and a file placed in the suite by hand is not listed (it
// is not a member).
//
// Order (nothing is written by this command):
//
//   1. argv: `--run` (RUN_ID shape), `--slug` (lowercase-hyphen, the suite
//      directory's), `--base` (a branch NAME: `[A-Za-z0-9][A-Za-z0-9._/-]*`,
//      no `..`, no whitespace — printed for the test-automation lead, never
//      resolved, checked out or diffed here: G-6, the TASK-018 `base` rule);
//   2. `<run>/run.json` (unknown run ⇒ 2 USAGE; a tampered one ⇒ 5);
//   3. the manifest: absent ⇒ 2 USAGE(ta-prompt: run <id> has no published
//      suite (publish --profile case first)); not the artifact it claims to
//      be ⇒ 5 INCONSISTENT(handoffs/<name>); not a `case` manifest whose
//      members hash to its `output_sha256` ⇒ 5 INCONSISTENT(handoffs/<name>)
//      (the bundle's own record, rewritten); `opts.slug` ≠ `--slug` ⇒ 2
//      USAGE (the suite was published under the other slug);
//   4. every member: `tasks/security-<slug>-admitted/<relpath>` is read and
//      its sha256 must equal the recorded one — a missing or hand-edited
//      suite file ⇒ 2 USAGE(ta-prompt: the suite file is not what publish
//      recorded (republish --profile case, or remove it): <path>) — then
//      parsed as a manual-qa case (ingest/case.mjs parseTestCase; a
//      published file always parses, so a failure here is the same 2 USAGE)
//      for its `id` and `title` (`unknown` when the frontmatter has none);
//   5. stdout: the prompt, `taPromptLines` — spelled once here the way the
//      §9.2 prompt lives in lib/profiles/handoff.mjs:
//        Run as the active agent (claude --agent test-automation-lead):
//        "Automate the batch <slug> from base <base>. The cases below are
//         manual-qa test cases already in this repository (<suite dir>/):
//         pass each path as its intake snapshot (cases: [{id, path}]); do
//         not copy them."
//        cases:
//        - id: <id> | title: <title> | path: ./<suite dir>/<relpath>
//      one `- id:` line per member in file-name order (the path is spelled
//      from `./` so redact.mjs's high-entropy-assign rule never eats it —
//      TASK-043's PUBLISHED line precedent). The test-automation
//      lead's intake reads in-repo TC files by path ("Already in the repo?
//      Don't copy." — orchestration-playbook.md § Intake), which is why the
//      prompt carries paths rather than bodies. Nothing about verification
//      state is consulted: a case whose finding is not yet VERIFIED is handed
//      off like every other (US-037 AC-4).
//
// Exit 0; 2 as above; 5 as above. Every line goes through ctx.out (G-4) —
// the titles come from files publish already redacted.
//
// Imports: node:fs (existsSync, readFileSync — no writes), node:path,
// ../canon.mjs (readArtifact, sha256Hex), ./argv.mjs, ./exit.mjs,
// ./ingest/case.mjs (parseTestCase), ./ledger.mjs (RUN_ID),
// ./profiles/case.mjs (suiteDir), ./profiles/index.mjs (memberIdentity),
// ./run-index.mjs (runDir), ./schema.mjs, ./tokens.mjs. No child process
// (G-6), no git, no network (G-14), no clock (G-1).
// Exports `taPrompt = {run(argv, ctx)}`, `taPromptLines`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CanonError, IntegrityError, readArtifact, sha256Hex } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { parseTestCase } from "./ingest/case.mjs";
import { RUN_ID } from "./ledger.mjs";
import { suiteDir } from "./profiles/case.mjs";
import { memberIdentity } from "./profiles/index.mjs";
import { runDir } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { inconsistent } from "./tokens.mjs";

const COMMAND = "ta-prompt";
const SLUG = /^[a-z0-9-]+$/;
/** A git branch name as a label: no whitespace, no control characters, no `..`, no leading `-`/`/`, no trailing `/`, `.lock` or `.`. */
const BRANCH = /^(?!.*\.\.)(?!.*\/$)(?!.*\.lock$)(?!.*\.$)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const HANDOFFS_SEGMENT = "handoffs";
const UNKNOWN = "unknown";

function parseArgs(argv) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { run: "value", slug: "value", base: "value" });
  if (positionals.length) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  if (typeof flags.run !== "string") throw usageError(COMMAND, "--run <id> is required");
  if (typeof flags.slug !== "string") throw usageError(COMMAND, "--slug <s> is required");
  if (typeof flags.base !== "string") throw usageError(COMMAND, "--base <branch> is required");
  if (!RUN_ID.test(flags.run)) throw usageError(COMMAND, `--run must be <12 hex>-<4 digits>, got ${flags.run}`);
  if (!SLUG.test(flags.slug)) throw usageError(COMMAND, `--slug must be lowercase letters, digits and hyphens, got ${flags.slug}`);
  if (!BRANCH.test(flags.base)) throw usageError(COMMAND, `--base must be a branch name (letters, digits, . _ / -; no whitespace, no ..), got ${flags.base}`);
  return { run_id: flags.run, slug: flags.slug, base: flags.base };
}

function readVerified(path, kind, name) {
  try {
    return readArtifact(path, { kind });
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof CanonError) throw integrityFailure(inconsistent(name), err);
    throw err;
  }
}

/** Step 3: the run's case export manifest, checked as sign-off checks it (recordedSuites), then bound to `--slug`. */
function publishedSuite(ctx, run_id, slug) {
  const dir = runDir(ctx, run_id);
  if (!existsSync(join(dir, "run.json"))) throw usageError(COMMAND, `unknown run ${run_id}`);
  readVerified(join(dir, "run.json"), "run", `runs/${run_id}`);
  const name = `${run_id}.case.export-manifest.json`;
  const path = join(ctx.st, HANDOFFS_SEGMENT, name);
  if (!existsSync(path)) throw usageError(COMMAND, `run ${run_id} has no published suite (publish --profile case first)`);
  const { payload } = readVerified(path, "export-manifest", `${HANDOFFS_SEGMENT}/${name}`);
  const opts = payload.opts ?? {};
  if (payload.profile !== "case" || validate("export-manifest", payload).length > 0 || typeof opts.slug !== "string" || !SLUG.test(opts.slug) || !Array.isArray(opts.members)) {
    throw integrityFailure(inconsistent(`${HANDOFFS_SEGMENT}/${name}`));
  }
  let identity;
  try {
    identity = memberIdentity(opts.members);
  } catch {
    identity = null;
  }
  if (identity !== payload.output_sha256) throw integrityFailure(inconsistent(`${HANDOFFS_SEGMENT}/${name}`));
  if (opts.slug !== slug) throw usageError(COMMAND, `run ${run_id} published its suite for slug ${opts.slug}, not ${slug}`);
  return { dir: suiteDir(slug), members: [...opts.members].sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0)) };
}

/** Step 4: one `{id, title, path}` per member, each re-verified against what publish recorded. */
function casesOf(ctx, suite) {
  return suite.members.map(({ relpath, sha256 }) => {
    const path = `${suite.dir}/${relpath}`;
    const refuse = () => usageError(COMMAND, `the suite file is not what publish recorded (republish --profile case, or remove it): ${path}`);
    let bytes;
    try {
      bytes = readFileSync(join(ctx.root, suite.dir, relpath));
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "EISDIR" || err.code === "EACCES" || err.code === "ENOTDIR") throw refuse();
      throw err;
    }
    if (sha256Hex(bytes) !== sha256) throw refuse();
    let tc;
    try {
      tc = parseTestCase(bytes.toString("utf8"));
    } catch (err) {
      if (err instanceof CliError) throw refuse();
      throw err;
    }
    // G-4: `path: tasks/security-<slug>-admitted/TC-NNN_<slug>` reads as a high-entropy assignment to redact.mjs (32+ mixed
    // chars after `: `), so the path is spelled from `./` — the same repo-relative path, never redacted out of the prompt
    // (TASK-043's PUBLISHED line is the precedent).
    return { id: tc.id, title: tc.title === null || tc.title.trim() === "" ? UNKNOWN : tc.title.trim(), path: `./${path}` };
  });
}

/**
 * The §9.3 prompt lines (see the header).
 * @param {{slug: string, base: string, cases: {id: string, title: string, path: string}[]}} input
 * @returns {string[]}
 */
export function taPromptLines({ slug, base, cases } = {}) {
  const dir = suiteDir(slug);
  if (typeof base !== "string" || !BRANCH.test(base)) throw new TypeError(`${COMMAND}: base must be a branch name`);
  if (!Array.isArray(cases)) throw new TypeError(`${COMMAND}: cases must be an array of {id, title, path}`);
  const lines = [
    "Run as the active agent (claude --agent test-automation-lead):",
    `"Automate the batch ${slug} from base ${base}. The cases below are manual-qa test cases already in this repository (${dir}/): pass each path as its intake snapshot (cases: [{id, path}]); do not copy them."`,
    "cases:",
  ];
  for (const c of cases) {
    if (typeof c?.id !== "string" || typeof c.title !== "string" || typeof c.path !== "string") throw new TypeError(`${COMMAND}: every case needs id, title and path`);
    lines.push(`- id: ${c.id} | title: ${c.title.replace(/[\r\n]+/g, " ")} | path: ${c.path}`);
  }
  return lines;
}

export const taPrompt = {
  /**
   * @param {string[]} argv after `ta-prompt`
   * @param {object} ctx
   * @returns {Promise<number>}
   */
  async run(argv, ctx) {
    const { run_id, slug, base } = parseArgs(argv);
    const suite = publishedSuite(ctx, run_id, slug);
    const cases = casesOf(ctx, suite);
    for (const line of taPromptLines({ slug, base, cases })) ctx.out(line);
    return EXIT.OK;
  },
};
