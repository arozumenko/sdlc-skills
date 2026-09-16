// lib/cmd-run.mjs — `evidence.mjs run init --kind assessment|review|verify|
// threat-model [--base <ref>] [--head <ref>]` (TASK-012; plan §4.1 row
// `run init`; spec §6.1, §6.2, D18 / P6, P2). `run snapshot …` is TASK-058
// and joins this module then.
//
// Order, so a refusal leaves nothing behind (spec §12 "allocation before
// inputs"; §4.1 "DIRTY-TREE … ledger untouched"):
//
//   1. argv; engagement.md (2 ENGAGEMENT-MISSING); the key (2 KEY: unavailable
//      — `engagement init` is the only command that creates a key, D13: a key
//      minted here could land in a repo whose private/ is not yet ignored);
//      `--head` (default HEAD) and `--base` (required for review|verify, else
//      = head) resolved to 40-hex oids (2 USAGE on an unknown ref);
//   2. assessment only: the clean-tree check (3 DIRTY-TREE) — before any
//      allocation, so a refused assessment consumes no seq;
//   3. ledger.allocateRun under the ledger lock ⇒ {seq, run_id};
//   4. `<run>/{packets,receipts,ingest,verify-snapshots}/` and
//      `ledger/<run_id>/imports/`; run.json and engagement.json (write-once,
//      canon.writeArtifact {exclusive: true}); assessment only: the three
//      empty TL-14 index artifacts (run-index.writeEmptyIndexes). threat-
//      model.json is deliberately NOT written — its absence is the
//      INCOMPLETE(threat-model) signal for build-report (P2).
//
// stdout: `RUN <run_id> seq=<n> kind=<k> base=<oid> head=<oid>`, then one
// `WROTE <path> sha256=<h>` per artifact (2 for review|verify|threat-model,
// 5 for assessment). Exit 0; 2 USAGE(run init: …) / ENGAGEMENT-MISSING /
// KEY: unavailable; 3 DIRTY-TREE.
//
// The clean-tree check (D18 as amended by P6): `git status --porcelain --
// <scope_paths> <product_paths>` must be empty after excluding the bundle's
// own managed paths — `.agents/security-testing/**`, `reports/security/`,
// `tasks/security-*/` — and the root `.gitignore` when its only difference
// from HEAD is the managed `# security-testing:begin/end` block. Files the
// engagement itself creates never count as dirt; anything else dirty under
// the assessed paths does (tracked or untracked; git-ignored files are not
// listed by status and are outside the observation, as for the baseline).
// An empty union assesses nothing, so nothing can be dirty. assessmentDirt()
// is exported for `scope` (TASK-013), which re-runs the same check.
//
// Imports: node:fs (mkdirSync, readFileSync), node:path, ../canon.mjs,
// ./argv.mjs, ./exit.mjs, ./git.mjs, ./ledger.mjs, ./run-index.mjs,
// ./schema.mjs, ./tokens.mjs. Every string that leaves the process goes
// through ctx.out / ctx.log / ctx.writeArtifact (G-4).

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, writeArtifact } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { GitError, blobOid, revParse, showBytes, statusPorcelain } from "./git.mjs";
import { RUN_KINDS, allocateRun, ledgerPaths } from "./ledger.mjs";
import { INDEXES, runDir, writeEmptyIndexes } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { DIRTY_TREE, KEY_UNAVAILABLE, inconsistent, runLine } from "./tokens.mjs";

const COMMAND = "run init";
const SCHEMA_VERSION = 1;
const BASE_REQUIRED = Object.freeze(["review", "verify"]);
/** Subdirectories every run starts with (plan §4.1). */
export const RUN_SUBDIRS = Object.freeze(["packets", "receipts", "ingest", "verify-snapshots"]);

// --- the clean-tree check (D18 / P6) ----------------------------------------

/** The bundle's managed paths (spec D18): a status row under one of these is never dirt. */
const MANAGED_PATH = /^(?:\.agents\/security-testing\/|reports\/security\/|tasks\/security-[^/]*\/)/;
const GITIGNORE = ".gitignore";
const BLOCK_BEGIN = "# security-testing:begin";
const BLOCK_END = "# security-testing:end";

/** `text` without the managed block (the begin line through the end line, inclusive). */
export function stripManagedBlock(text) {
  const out = [];
  let inside = false;
  for (const line of text.split("\n")) {
    const bare = line.replace(/\r$/, "");
    if (!inside && bare === BLOCK_BEGIN) {
      inside = true;
      continue;
    }
    if (inside) {
      if (bare === BLOCK_END) inside = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * The lines of a `.gitignore` that mean something to git, after the managed
 * block is stripped: CR dropped, blank lines dropped. Blank lines are
 * separators with no effect on matching, and the block writer has to add the
 * newline (or a blank separator) that attaches the block to a file whose last
 * line had no LF — that whitespace is part of the block's edit, not dirt.
 */
function ignoreLinesOf(text) {
  return stripManagedBlock(text)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
}

/** True when the working `.gitignore` differs from HEAD's only by the managed block (and the whitespace that attaches it). */
function gitignoreOnlyManagedBlock(ctx) {
  const atHead = blobOid(ctx.root, "HEAD", GITIGNORE) === null ? "" : showBytes(ctx.root, "HEAD", GITIGNORE).toString("utf8");
  let working;
  try {
    working = readFileSync(join(ctx.root, GITIGNORE), "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    working = "";
  }
  const a = ignoreLinesOf(atHead);
  const b = ignoreLinesOf(working);
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * The status rows under `scope_paths ∪ product_paths` that are dirt for an
 * assessment: everything `git status --porcelain` lists there except the
 * bundle's managed paths and a `.gitignore` that differs only by the managed
 * block. A rename counts unless both its sides are managed.
 * @param {object} ctx
 * @param {{scope_paths: string[], product_paths: string[]}} record the engagement record
 * @returns {{xy: string, path: string, orig?: string}[]} empty ⇒ clean
 */
export function assessmentDirt(ctx, record) {
  const paths = [...new Set([...record.scope_paths, ...record.product_paths])].filter((p) => typeof p === "string" && p.length > 0);
  if (paths.length === 0) return [];
  let gitignoreClean; // computed at most once, only when .gitignore shows up
  const managed = (path) => {
    if (MANAGED_PATH.test(path)) return true;
    if (path !== GITIGNORE) return false;
    gitignoreClean ??= gitignoreOnlyManagedBlock(ctx);
    return gitignoreClean;
  };
  return statusPorcelain(ctx.root, { paths }).filter((row) => !(managed(row.path) && (row.orig === undefined || managed(row.orig))));
}

// --- run init ----------------------------------------------------------------

function resolveRef(ctx, flag, ref) {
  try {
    return revParse(ctx.root, ref);
  } catch (err) {
    if (err instanceof GitError) throw usageError(COMMAND, `${flag} ${ref} is not a commit`);
    throw err;
  }
}

/** Write-once, silently: the caller prints the RUN line and every WROTE line only after all writes succeed. */
function writeOnce(ctx, run_id, path, artifact) {
  try {
    return writeArtifact(ctx.abs(path), artifact, { exclusive: true });
  } catch (err) {
    // A freshly allocated seq whose run file already exists: the ledger and
    // runs/ disagree, which is an integrity failure, not a usage error.
    if (err.code === "EEXIST") throw integrityFailure(inconsistent(`runs/${run_id}`), err);
    throw err;
  }
}

async function init(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { kind: "value", base: "value", head: "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const kind = flags.kind;
  if (kind === undefined || !RUN_KINDS.includes(kind)) throw usageError(COMMAND, `--kind must be one of ${RUN_KINDS.join("|")}`);
  if (flags.base === undefined && BASE_REQUIRED.includes(kind)) throw usageError(COMMAND, `--base is required for ${BASE_REQUIRED.join("|")}`);

  const record = ctx.engagement(); // 2 ENGAGEMENT-MISSING / ENGAGEMENT-INVALID
  const key = ctx.key();
  if (key === null) throw new CliError(EXIT.USAGE, KEY_UNAVAILABLE);
  const head_oid = resolveRef(ctx, "--head", flags.head ?? "HEAD");
  const base_oid = flags.base === undefined ? head_oid : resolveRef(ctx, "--base", flags.base);

  if (kind === "assessment") {
    const dirt = assessmentDirt(ctx, record);
    if (dirt.length > 0) {
      ctx.log(`run init: ${dirt.length} dirty path(s) under the assessed paths:`, ...dirt.map((row) => `${row.xy} ${row.path}`));
      throw new CliError(EXIT.INDETERMINATE, DIRTY_TREE);
    }
  }

  const { seq, run_id } = await allocateRun(ctx, { kind, base_oid, head_oid });
  const dir = runDir(ctx, run_id);
  for (const sub of RUN_SUBDIRS) mkdirSync(join(dir, sub), { recursive: true });
  mkdirSync(join(ledgerPaths(ctx).dir, run_id, "imports"), { recursive: true });

  const engagement_id = record.engagement_id;
  const payload = { engagement_id, seq, base_oid, head_oid, template: kind };
  const errors = validate("run", payload);
  if (errors.length > 0) throw new Error(`run init: run.json payload is off-schema: ${errors[0]}`);
  const head = { schema_version: SCHEMA_VERSION, run_id, engagement_id, key_id: key.key_id, now: ctx.now };

  // Every artifact lands before anything is printed, so a failed write (EEXIST
  // ⇒ 5 INCONSISTENT(runs/<id>)) never leaves a RUN line above the failure token.
  const written = [
    [join(dir, "run.json"), writeOnce(ctx, run_id, join(dir, "run.json"), makeEnvelope({ ...head, kind: "run" }, payload))],
    [join(dir, "engagement.json"), writeOnce(ctx, run_id, join(dir, "engagement.json"), makeEnvelope({ ...head, kind: "engagement" }, record))],
  ];
  if (kind === "assessment") {
    let indexes;
    try {
      indexes = writeEmptyIndexes(ctx, head);
    } catch (err) {
      if (err.code === "EEXIST") throw integrityFailure(inconsistent(`runs/${run_id}`), err);
      throw err;
    }
    for (const [name, { file }] of Object.entries(INDEXES)) written.push([join(dir, file), indexes[name]]);
  }

  ctx.out(runLine({ run_id, seq, kind, base: base_oid, head: head_oid }));
  for (const [path, artifact] of written) ctx.wrote(path, artifact);
  return EXIT.OK;
}

const SUBCOMMANDS = Object.freeze({ init });

/**
 * @param {string[]} argv after `run`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const sub = argv[0];
  if (sub === undefined) throw usageError("run", `a subcommand is required (${Object.keys(SUBCOMMANDS).join("|")})`);
  if (!Object.hasOwn(SUBCOMMANDS, sub)) throw usageError("run", `unknown subcommand ${sub}`);
  return SUBCOMMANDS[sub](argv.slice(1), ctx);
}
