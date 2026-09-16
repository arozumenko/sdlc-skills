// lib/cmd-purge.mjs — `evidence.mjs purge --engagement <id> [--yes]`
// (TASK-032; plan §4.1 row `purge`; spec §6.9 / P3, TL-4, TL-9).
//
// Consumer-decided deletion of exactly one engagement's private material.
// The scope is P3's, spelled as paths under `<st>`:
//
//   runs/<run_id>                    every run whose run.json names the engagement
//   ledger/<run_id>  ledger/<run_id>.lock   its redacted imports and its run lock
//   ledger/index.json                the entries naming those runs (rewritten
//                                    under ledger/index.lock/; other entries stay)
//   receipts/<run_id>                the agent drop-box (TL-4: purge may delete it)
//   private/snapshots/<run_id>       redacted dirty-file snapshots (review runs)
//   private/citations/<run_id>       the private citation records
//   private/baseline.<eid>.json      the engagement's baseline
//   private/keys/<key_id>            every key keys/index.json attributes to the
//                                    engagement (keys.keysOf) and its index rows
//                                    (rewritten under private/keys.lock/)
//   private/keys/current             only when it names a purged key — the next
//                                    `engagement init` then creates a new key
//   imports/                         the reserved ingest-input directory (§6.9
//                                    lists `imports`; it is not per-engagement,
//                                    so it goes whole — copies of external inputs)
//
// Untouched, by contract: register/, proposals/, handoffs/, knowledge/,
// engagement.md, risk-register.md, reports/security/, tasks/security-*/,
// and `.gitignore` (G-5: only engagement init step 1 writes it).
//
// Attribution: a run belongs to the engagement when `runs/<id>/run.json`
// (read with readArtifact — envelope kind `run`, self_sha256 verified) has
// `payload.engagement_id == <id>` (both NFC; canon wrote the file NFC). A
// ledger entry is deleted only when it names such a run: an entry whose run
// directory has no run.json (an interrupted `run init`) cannot be attributed
// and stays, as does the directory — noted on stderr. A run.json that is not
// the artifact it claims to be ⇒ 5 INCONSISTENT(runs/<id>) before anything is
// deleted: purge does not guess whose material a corrupt run is.
//
// Order — read everything, refuse, then write:
//   1. argv; the engagement id must name a file (baseline.baselinePath's rule);
//   2. the plan: runs (walk runs/), ledger entries, keys (keys.keysOf), the
//      paths above that exist;
//   3. defense in depth: `git ls-files -- <target dirs>` — the five managed
//      destinations purge deletes under — non-empty ⇒ 4 TRACKED(<path>),
//      nothing deleted (a purge must never remove content git still holds);
//   4. without --yes: one `PURGE <path>` line per planned path, then
//      2 USAGE(purge: --yes is required …);
//   5. with --yes: per run the satellite trees first (ledger/<id>, the run
//      lock, receipts/<id>, snapshots/<id>, citations/<id>), then imports/,
//      then — under ledger/index.lock/ — the ledger entries and, last of
//      all for a run, runs/<id> itself; then the baseline, then the keys
//      under the keys lock (files, index rows, `current` when it names a
//      purged key). runs/<id>/run.json goes LAST because it is the only
//      record attributing a run to the engagement (ledger entries carry no
//      engagement_id): an interruption anywhere before it leaves a run the
//      re-run still attributes, so every satellite is reached again. The
//      same rule holds inside dropKeys (files, then the index rows that
//      attribute them) and for imports/ (removed before anything planPurge's
//      "had material" test looks at). Every deletion is fsx.rmTree
//      (idempotent), so a re-run after an interruption finishes the job and
//      reports what was still there. Removing runs/<id> under the allocation
//      lock keeps a concurrent `run init` from allocating into a directory
//      this purge is emptying.
//
// The plan is computed outside the keys/ledger locks and execute() acts on
// it: a key minted or a run allocated for the engagement between the two
// (an in-process window, same operator) survives and is a re-run's to take.
//
// stdout: `PURGED runs=<n> keys=<n> current-key=removed|kept` (tokens.purged)
// — `runs` counts run ids, `keys` counts key rows (a row whose file is
// already gone still counts: the row is what purge deletes). Deleted paths
// are logged on stderr (ctx.log) — diagnostics, not results.
//
// Imports: node:fs (readdirSync, existsSync — reads; every write goes through
// fsx), node:path, ../canon.mjs (readArtifact, canonical), ./argv.mjs,
// ./baseline.mjs (baselinePath), ./exit.mjs, ./fsx.mjs, ./git.mjs (lsFiles),
// ./keys.mjs, ./ledger.mjs, ./run-index.mjs, ./tokens.mjs. No child process
// of its own (G-6: git only through git.mjs), no network (G-14), no clock.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonical, readArtifact } from "../canon.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { baselinePath } from "./baseline.mjs";
import { CliError, EXIT, integrityFailure, isIntegrityFailure, usageError } from "./exit.mjs";
import { rmTree, withLock, writeAtomic } from "./fsx.mjs";
import { lsFiles } from "./git.mjs";
import { currentKeyId, keysDir, keysOf, readIndex as readKeysIndex } from "./keys.mjs";
import { RUN_ID, ledgerPaths, readIndex as readLedgerIndex, runLockPath } from "./ledger.mjs";
import { runDir } from "./run-index.mjs";
import { inconsistent, purgePlan, purged, tracked } from "./tokens.mjs";

const COMMAND = "purge";
/** The managed destinations purge deletes under (relative to `<st>`); a tracked file beneath any of them refuses the purge. */
export const TARGET_DIRS = Object.freeze(["private", "ledger", "runs", "receipts", "imports"]);
const KEYS_LOCK = "keys.lock"; // the same mutex keys.ensureKey takes: `<st>/private/keys.lock/`

/** Canonical JSON plus LF — the on-disk shape ledger.mjs and keys.mjs write their indexes in. */
const indexBytes = (value) => Buffer.concat([canonical(value), Buffer.from("\n")]);

/**
 * Run ids under `runs/` whose run.json names `engagement_id`, in directory
 * order (sorted). Only directories shaped like a run id are looked at; a run
 * directory without run.json is reported and skipped; one whose run.json
 * fails readArtifact ⇒ CliError 5 INCONSISTENT(runs/<id>).
 */
function attributedRuns(ctx, engagement_id) {
  let entries;
  try {
    entries = readdirSync(join(ctx.st, "runs"), { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const ids = entries
    .filter((e) => e.isDirectory() && RUN_ID.test(e.name))
    .map((e) => e.name)
    .sort();
  const mine = [];
  for (const run_id of ids) {
    const path = join(runDir(ctx, run_id), "run.json");
    if (!existsSync(path)) {
      ctx.log(`purge: runs/${run_id} has no run.json — cannot attribute it, left in place`);
      continue;
    }
    let run;
    try {
      run = readArtifact(path, { kind: "run" });
    } catch (err) {
      if (isIntegrityFailure(err)) throw integrityFailure(inconsistent(`runs/${run_id}`), err);
      throw err;
    }
    if (run.payload.engagement_id === engagement_id) mine.push(run_id);
  }
  return mine;
}

/**
 * Everything the purge would remove, computed from reads only.
 * @returns {{engagement_id: string, runs: string[], keys: string[], current: string | null, currentRemoved: boolean, paths: string[]}}
 */
function planPurge(ctx, engagement_id) {
  const baseline = baselinePath(ctx, engagement_id); // 2 ENGAGEMENT-INVALID when the id cannot name a file
  const runs = attributedRuns(ctx, engagement_id);
  const keys = keysOf(ctx, engagement_id);
  const current = currentKeyId(ctx);
  const currentRemoved = current !== null && keys.includes(current);
  const candidates = [];
  for (const run_id of runs) {
    candidates.push(runDir(ctx, run_id), join(ledgerPaths(ctx).dir, run_id), runLockPath(ctx, run_id));
    candidates.push(join(ctx.st, "receipts", run_id), join(ctx.st, "private", "snapshots", run_id), join(ctx.st, "private", "citations", run_id));
  }
  candidates.push(baseline);
  for (const key_id of keys) candidates.push(join(keysDir(ctx), key_id));
  if (currentRemoved) candidates.push(join(keysDir(ctx), "current"));
  // imports/ is not per-engagement: it goes only when the engagement had
  // material here at all, so purging an unknown id removes nothing.
  if (runs.length > 0 || keys.length > 0 || existsSync(baseline)) candidates.push(join(ctx.st, "imports"));
  return { engagement_id, runs, keys, current, currentRemoved, paths: candidates.filter((p) => existsSync(p)) };
}

/** 4 TRACKED(<path>) when git tracks anything under a target directory. */
function refuseTracked(ctx) {
  const dirs = TARGET_DIRS.map((d) => ctx.rel(join(ctx.st, d))).filter((rel) => existsSync(ctx.abs(rel)));
  if (dirs.length === 0) return;
  const listed = lsFiles(ctx.root, { paths: dirs });
  if (listed.length > 0) throw new CliError(EXIT.FAIL, tracked(listed[0]));
}

/**
 * Drop the entries naming `runs` from ledger/index.json (untouched when
 * nothing names them) and remove the run directories — both under the
 * allocation lock, so a concurrent `run init` cannot allocate into a
 * directory this purge is removing. runs/<id> (run.json, the attribution
 * record) goes after the index rewrite and after every satellite execute()
 * already removed: an interrupted purge leaves a run the re-run attributes.
 */
async function dropRuns(ctx, runs) {
  if (runs.length === 0) return;
  const gone = new Set(runs);
  await withLock(ledgerPaths(ctx).lock, () => {
    const entries = readLedgerIndex(ctx);
    const kept = entries.filter((e) => !gone.has(e.run_id));
    if (kept.length !== entries.length) writeAtomic(ledgerPaths(ctx).index, indexBytes(kept));
    for (const run_id of runs) rmTree(runDir(ctx, run_id));
  });
}

/** Delete the key files and their index rows; remove `current` when it names one of them. Under the keys lock. */
async function dropKeys(ctx, keys) {
  if (keys.length === 0) return;
  const gone = new Set(keys);
  await withLock(join(ctx.st, "private", KEYS_LOCK), () => {
    for (const key_id of keys) rmTree(join(keysDir(ctx), key_id));
    const index = readKeysIndex(ctx);
    const kept = Object.fromEntries(Object.entries(index).filter(([id]) => !gone.has(id)));
    if (Object.keys(kept).length !== Object.keys(index).length) writeAtomic(join(keysDir(ctx), "index.json"), indexBytes(kept));
    const current = currentKeyId(ctx);
    if (current !== null && gone.has(current)) rmTree(join(keysDir(ctx), "current"));
  });
}

async function execute(ctx, plan) {
  // Satellites first; the attribution records (run.json, key index rows)
  // last — the header's order, item 5.
  for (const run_id of plan.runs) {
    rmTree(join(ledgerPaths(ctx).dir, run_id));
    rmTree(runLockPath(ctx, run_id));
    rmTree(join(ctx.st, "receipts", run_id));
    rmTree(join(ctx.st, "private", "snapshots", run_id));
    rmTree(join(ctx.st, "private", "citations", run_id));
  }
  if (plan.paths.includes(join(ctx.st, "imports"))) rmTree(join(ctx.st, "imports"));
  await dropRuns(ctx, plan.runs);
  rmTree(baselinePath(ctx, plan.engagement_id));
  await dropKeys(ctx, plan.keys);
  for (const path of plan.paths) ctx.log(`purge: removed ${ctx.rel(path)}`);
}

/**
 * @param {string[]} argv after `purge`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { engagement: "value", yes: "boolean" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  if (typeof flags.engagement !== "string") throw usageError(COMMAND, "--engagement <id> is required");
  const engagement_id = flags.engagement.normalize("NFC");

  const plan = planPurge(ctx, engagement_id);
  refuseTracked(ctx);

  if (flags.yes !== true) {
    for (const path of plan.paths) ctx.out(purgePlan(ctx.rel(path)));
    throw usageError(COMMAND, `--yes is required to delete; ${plan.paths.length} path(s) listed above would be removed`);
  }

  await execute(ctx, plan);
  ctx.out(purged({ runs: plan.runs.length, keys: plan.keys.length, current_key: plan.currentRemoved ? "removed" : "kept" }));
  return EXIT.OK;
}
