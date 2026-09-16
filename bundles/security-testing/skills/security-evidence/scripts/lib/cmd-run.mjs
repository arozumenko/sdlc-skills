// lib/cmd-run.mjs — `evidence.mjs run init --kind assessment|review|verify|
// threat-model [--base <ref>] [--head <ref>]` (TASK-012; plan §4.1 row
// `run init`; spec §6.1, §6.2, D18 / P6, P2). `run snapshot …` (TASK-058)
// lives in lib/cmd-run-snapshot.mjs and is dispatched from SUBCOMMANDS below.
//
// Order, so a refusal leaves nothing behind (spec §12 "allocation before
// inputs"; §4.1 "DIRTY-TREE … ledger untouched"):
//
//   1. argv; engagement.md (2 ENGAGEMENT-MISSING); the key (2 KEY: unavailable
//      — `engagement init` is the only command that creates a key, D13: a key
//      minted here could land in a repo whose private/ is not yet ignored);
//      `--head` (default HEAD) and `--base` (required for review|verify, else
//      = head) resolved to 40-hex oids (2 USAGE on an unknown ref; 2 USAGE
//      when an assessment's `--head` is not HEAD — D18 pins the clean tree
//      to head_oid and the working tree can only be compared against HEAD);
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
// The clean-tree check (D18 as amended by P6) is lib/clean-tree.mjs
// (assessmentDirt — moved there by TASK-008 so `scope`, TASK-013, shares it
// without importing this command; TL-1): `git status --porcelain --
// <scope_paths> <product_paths>` must be empty after excluding the bundle's
// own managed paths and a `.gitignore` that differs from HEAD only by the
// managed block (ignore-block.mjs owns the block's edges).
//
// Imports: node:fs (mkdirSync), node:path, ../canon.mjs, ./argv.mjs,
// ./clean-tree.mjs, ./exit.mjs, ./git.mjs, ./ledger.mjs, ./run-index.mjs,
// ./schema.mjs, ./tokens.mjs. Every string that leaves the process goes
// through ctx.out / ctx.log / ctx.writeArtifact (G-4).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeEnvelope, writeArtifact } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { assessmentDirt } from "./clean-tree.mjs";
import { CliError, EXIT, integrityFailure, usageError } from "./exit.mjs";
import { GitError, revParse } from "./git.mjs";
import { RUN_KINDS, allocateRun, ledgerPaths } from "./ledger.mjs";
import { INDEXES, runDir, writeEmptyIndexes } from "./run-index.mjs";
import { validate } from "./schema.mjs";
import { DIRTY_TREE, KEY_UNAVAILABLE, inconsistent, runLine } from "./tokens.mjs";

const COMMAND = "run init";
const SCHEMA_VERSION = 1;
const BASE_REQUIRED = Object.freeze(["review", "verify"]);
/** Subdirectories every run starts with (plan §4.1). */
export const RUN_SUBDIRS = Object.freeze(["packets", "receipts", "ingest", "verify-snapshots"]);

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
  // D18: an assessment is a clean tree AT head_oid, and the only tree this
  // process can compare is the working tree against HEAD — so for assessment
  // `--head` must resolve to HEAD, else citations resolve at an unchecked oid.
  if (kind === "assessment" && head_oid !== resolveRef(ctx, "--head", "HEAD")) throw usageError(COMMAND, "--head must be HEAD for assessment");

  if (kind === "assessment") {
    const dirt = assessmentDirt(ctx, record);
    if (dirt.length > 0) {
      ctx.log(`run init: ${dirt.length} dirty path(s) under the assessed paths:`, ...dirt.map((row) => `${row.xy} ${row.path}${row.orig === undefined ? "" : ` <- ${row.orig}`}`));
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

const SUBCOMMANDS = Object.freeze({
  init,
  snapshot: (argv, ctx) => import("./cmd-run-snapshot.mjs").then((m) => m.run(argv, ctx)), // TASK-058
});

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
