// lib/cmd-engagement.mjs — `evidence.mjs engagement init [--rotate] |
// validate | baseline` (TASK-008; spec §6.9 / P3, D12, D13, TL-13; plan §4.1
// rows `engagement init|validate`). The only writer of `.gitignore` under
// scripts/ (G-5), and the one place the P3 step order is spelled:
//
//   0  stepTemplates   (TASK-011)  knowledge/* when absent; engagement.md when
//                                  absent ⇒ print, exit 2 EDIT-ENGAGEMENT-AND-RERUN,
//                                  nothing else happens on that run
//   1  ignoreBlock     (this)      parse engagement.md first — ENGAGEMENT-INVALID /
//                                  POLICY-INVALID(private) exit 2 before any write —
//                                  then upsert the managed block into .gitignore
//   2  failClosed      (this)      `git ls-files` under an active pattern ⇒ 4 TRACKED(<path>);
//                                  `git check-ignore` refusing a pattern's probe ⇒
//                                  4 NOT-IGNORED(<pattern>); nothing written after this step
//   3  ensureKey       (TASK-009)  create | reuse | rotate (--rotate)
//   4  stepBaseline    (TASK-010)  private/baseline.<eid>.json + WROTE
//
// stdout order = step order: `TEMPLATES: …`, `ENGAGEMENT: present`,
// `IGNORE-BLOCK: written|unchanged`, `KEY: <key_id> created|reused|rotated`,
// `BASELINE: <n> files ignored=<n>`, `WROTE …`. Every line is a tokens.mjs
// spelling (G-13) and leaves through ctx.out (G-4).
//
// `validate` runs steps 1–2 dry (`IGNORE-BLOCK: ok|stale` = would init
// rewrite the block — hand-edited, policy changed, or the file deleted while
// HEAD still holds it; `TRACKED: none` or one `TRACKED(<path>)` per pattern;
// one `NOT-IGNORED(<pattern>)` per exposed pattern), then `KEY:
// available|unavailable` (`current` names a key file attributed to this
// engagement) and `BASELINE: present|absent`. It writes nothing — not even
// step 0's templates: without engagement.md it is `2 ENGAGEMENT-MISSING`.
// Exit 0 when every line is the good one, else 4. `baseline` is
// cmd-engagement-baseline.mjs (TASK-010), routed from here.
//
// Why the block is written before the fail-closed check: the check's second
// half asks git whether the private destinations are *effectively* ignored,
// and on a first init they are only once the block exists. A TRACKED file
// then fails with the block in place — the operator's fix is `git rm
// --cached` (the block already covers the path) — and nothing of step 3/4
// exists yet, so no key was minted into a tracked private/ (D13).
//
// The .gitignore write is fsx.writeAtomic over latin1 bytes (ignore-block.
// readGitignore is the reader), so a consumer's non-UTF-8 line survives.
// An unborn branch (no commit) surfaces at step 4 as the baseline's
// GitError ⇒ exit 1 INTERNAL: the spec names no token for it and every
// later command needs a commit too.
//
// Imports: node:path, ./argv.mjs, ./baseline.mjs, ./cmd-engagement-baseline.mjs
// (the `baseline` subcommand — a routing import, not a shared helper),
// ./exit.mjs, ./fsx.mjs (the one write), ./ignore-block.mjs, ./keys.mjs,
// ./knowledge-templates.mjs, ./tokens.mjs. No child process of its own
// (G-6; git runs in ignore-block/baseline through lib/git.mjs), no clock
// (G-1), no network (G-14).

import { join } from "node:path";
import { parseCommandArgv } from "./argv.mjs";
import { readBaseline, stepBaseline } from "./baseline.mjs";
import { run as runBaseline } from "./cmd-engagement-baseline.mjs";
import { CliError, EXIT, usageError } from "./exit.mjs";
import { writeAtomic } from "./fsx.mjs";
import { GITIGNORE, probeManagedPaths, readGitignore, upsertBlock } from "./ignore-block.mjs";
import { ensureKey, keysOf } from "./keys.mjs";
import { stepTemplates } from "./knowledge-templates.mjs";
import {
  BASELINE_ABSENT,
  BASELINE_PRESENT,
  EDIT_ENGAGEMENT_AND_RERUN,
  ENGAGEMENT_PRESENT,
  ENGAGEMENT_TEMPLATE_WRITTEN,
  IGNORE_BLOCK_OK,
  IGNORE_BLOCK_STALE,
  IGNORE_BLOCK_UNCHANGED,
  IGNORE_BLOCK_WRITTEN,
  KEY_AVAILABLE,
  KEY_UNAVAILABLE,
  TRACKED_NONE,
  baselineLine,
  keyLine,
  notIgnored,
  templatesLine,
  tracked,
} from "./tokens.mjs";

const INIT = "engagement init";
const VALIDATE = "engagement validate";

/** The record's artifact_policy, or every artifact local when the key is absent. */
function policyOf(record) {
  return record.artifact_policy ?? {};
}

/**
 * Step 1: the managed block, upserted into the root .gitignore. Returns
 * whether the file changed. The one write of `.gitignore` under scripts/ (G-5).
 */
function stepIgnoreBlock(ctx, policy) {
  const { text, changed } = upsertBlock(readGitignore(ctx.root), policy);
  if (changed) writeAtomic(join(ctx.root, GITIGNORE), Buffer.from(text, "latin1"));
  return changed;
}

/** Step 2: the first tracked file or exposed pattern is the failure (§6.9 step 2, exit 4). */
function stepFailClosed(ctx, policy) {
  const probe = probeManagedPaths(ctx, policy);
  if (probe.tracked.length > 0) throw new CliError(EXIT.FAIL, tracked(probe.tracked[0].path));
  if (probe.notIgnored.length > 0) throw new CliError(EXIT.FAIL, notIgnored(probe.notIgnored[0]));
}

/** `KEY: available` iff `current` names a key file index.json attributes to this engagement. */
function keyAvailable(ctx, engagement_id) {
  const key = ctx.key();
  return key !== null && keysOf(ctx, engagement_id).includes(key.key_id);
}

async function init(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(INIT, argv, { rotate: "boolean" });
  if (positionals.length > 0) throw usageError(INIT, `unexpected argument ${positionals[0]}`);

  // 0 — templates, then the record; absent record ⇒ stop here (P3).
  const templates = stepTemplates(ctx);
  ctx.out(templatesLine(templates));
  if (templates.engagement === "template-written") {
    ctx.out(ENGAGEMENT_TEMPLATE_WRITTEN);
    throw new CliError(EXIT.USAGE, EDIT_ENGAGEMENT_AND_RERUN);
  }
  ctx.out(ENGAGEMENT_PRESENT);

  // 1 — parse first (ENGAGEMENT-INVALID / POLICY-INVALID(private) before any write), then the block.
  const record = ctx.engagement();
  const policy = policyOf(record);
  ctx.out(stepIgnoreBlock(ctx, policy) ? IGNORE_BLOCK_WRITTEN : IGNORE_BLOCK_UNCHANGED);

  // 2 — fail closed: nothing after this step runs on a tracked or exposed private path.
  stepFailClosed(ctx, policy);

  // 3 — the key. Nothing above read ctx.key(), so step 4 sees the key this step establishes.
  const key = ensureKey(ctx, { rotate: flags.rotate === true, engagement_id: record.engagement_id });
  ctx.out(keyLine(key.key_id, key.status));

  // 4 — the baseline.
  const baseline = stepBaseline(ctx);
  ctx.out(baselineLine({ files: baseline.files, ignored: baseline.ignored }));
  ctx.wrote(baseline.path, baseline.artifact);
  return EXIT.OK;
}

async function validate(argv, ctx) {
  const { positionals } = parseCommandArgv(VALIDATE, argv, {});
  if (positionals.length > 0) throw usageError(VALIDATE, `unexpected argument ${positionals[0]}`);

  const record = ctx.engagement(); // 2 ENGAGEMENT-MISSING / ENGAGEMENT-INVALID / POLICY-INVALID(private)
  const policy = policyOf(record);
  let ok = true;

  // 1 (dry) — would init rewrite the block?
  const stale = upsertBlock(readGitignore(ctx.root), policy).changed;
  ctx.out(stale ? IGNORE_BLOCK_STALE : IGNORE_BLOCK_OK);
  ok &&= !stale;

  // 2 (dry) — every finding, not just the first.
  const probe = probeManagedPaths(ctx, policy);
  if (probe.tracked.length === 0) ctx.out(TRACKED_NONE);
  for (const { path } of probe.tracked) ctx.out(tracked(path));
  for (const pattern of probe.notIgnored) ctx.out(notIgnored(pattern));
  ok &&= probe.tracked.length === 0 && probe.notIgnored.length === 0;

  // 3 / 4 — presence.
  const key = keyAvailable(ctx, record.engagement_id);
  ctx.out(key ? KEY_AVAILABLE : KEY_UNAVAILABLE);
  const baseline = readBaseline(ctx, record.engagement_id) !== null;
  ctx.out(baseline ? BASELINE_PRESENT : BASELINE_ABSENT);
  ok &&= key && baseline;

  return ok ? EXIT.OK : EXIT.FAIL;
}

const SUBCOMMANDS = Object.freeze({ init, validate, baseline: runBaseline });

/**
 * @param {string[]} argv after `engagement`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const sub = argv[0];
  if (sub === undefined) throw usageError("engagement", `a subcommand is required (${Object.keys(SUBCOMMANDS).join("|")})`);
  if (!Object.hasOwn(SUBCOMMANDS, sub)) throw usageError("engagement", `unknown subcommand ${sub}`);
  return SUBCOMMANDS[sub](argv.slice(1), ctx);
}
