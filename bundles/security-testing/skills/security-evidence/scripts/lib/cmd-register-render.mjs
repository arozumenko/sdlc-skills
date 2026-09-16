// lib/cmd-register-render.mjs — `register.mjs render [--out <path>]`
// (TASK-059; spec §6.8 / P5, D14, plan §4.3): write the lead's Markdown view
// of the register from the projection.
//
// Default destination is `<st>/risk-register.md` — the third `context-docs`
// entry of `security-lead` (plan §4.7, TL-8). It sits OUTSIDE the managed
// ignore block by design: it is the injected context-doc and carries only
// redacted, derived text (a working-tree change after every render is the
// intended shape; plan §8 risk 5). The register itself (`register/`) stays
// inside the block unless `artifact_policy.register: committed`.
//
// Pipeline: openRegister (recovery rule — a behind projection is rebuilt, an
// ahead or broken one is 5 CORRUPT and nothing is written) → renderRegister
// (pure, lib/register-render.mjs) → redactString (G-4: the projection can
// carry raw bytes when a log was written behind the CLI's back) →
// fsx.writeAtomic (tmp+rename: a reader never sees a half-written view).
//
// `--out` is a user-typed path: resolved against the invocation cwd like
// every other CLI argument, required to lie inside the work tree, and — G-5:
// only `publish --to` writes outside the bundle's own paths — under one of
// `.agents/security-testing/`, `.agents/memory/<role>/`, `reports/security/`
// or `tasks/security-*/`. Under `<st>/` the bundle's own state is a reserved
// set the view may never replace: `register/` (the hash-chained log, the
// projection, the alias log), `private/` (TL-13: keys, snapshots),
// `ledger/`, `runs/` (G-10: nothing under a run is rewritten), `receipts/`
// (G-7: no script writes there), `imports/`, `proposals/`, `handoffs/`,
// `knowledge/` (seeded context-docs), `engagement.md` and
// `threat-model.json` (operator-owned committed files). The comparison is
// case-insensitive: the guard is lexical but the write lands on a file system,
// and on a case-insensitive one (APFS, NTFS) `REGISTER/events.jsonl` IS
// `register/events.jsonl` — so `Register/` is refused on ext4 too (fail-closed
// on every platform). A path naming an existing directory is refused too.
// Anything else is 2 USAGE and nothing is written; `..` segments are
// normalised before every check.
//
// stdout: `RENDER <repo-relative path> rows=<n> seq=<n>` (tokens.rendered; not
// an enveloped artifact, so not WROTE). Exit 0; 2 usage / ENGAGEMENT-MISSING;
// 5 CORRUPT.

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { redactString } from "../redact.mjs";
import { parseCommandArgv } from "./argv.mjs";
import { EXIT, usageError } from "./exit.mjs";
import { writeAtomic } from "./fsx.mjs";
import { openRegister } from "./register-core.mjs";
import { renderRegister } from "./register-render.mjs";
import { rendered } from "./tokens.mjs";

const COMMAND = "render";
export const DEFAULT_OUT = "risk-register.md"; // under <st>/

// Repo-relative prefixes a script may write under (G-5); .agents/memory/<role>/ and tasks/security-<slug>/ are globs.
const WRITABLE = Object.freeze([".agents/security-testing/", "reports/security/"]);
const WRITABLE_GLOBS = Object.freeze([/^\.agents\/memory\/[^/]+\//, /^tasks\/security-[^/]+\//]);
const WRITABLE_TEXT = ".agents/security-testing/, .agents/memory/<role>/, reports/security/ or tasks/security-*/";

// Under <st>/ the bundle's own state is never a render target (G-7 receipts/, G-10 runs/,
// TL-13 private/, the register chain, the ledger, the operator-owned committed files and
// the seeded knowledge/ context-docs): a view written there replaces a record with prose.
// The bare directory name is reserved as well, so a file can never squat where the
// directory is created later. Case-insensitive (`i`): a case-insensitive file system
// folds `REGISTER/` onto `register/`, so the lexical guard must fold too.
const RESERVED_ST = /^\.agents\/security-testing\/(?:(?:register|private|ledger|runs|receipts|imports|proposals|handoffs|knowledge)(?:\/|$)|engagement\.md$|threat-model\.json$)/i;
const RESERVED_TEXT = "register/, private/, ledger/, runs/, receipts/, imports/, proposals/, handoffs/, knowledge/, engagement.md, threat-model.json";

const toPosix = (p) => (sep === "/" ? p : p.split(sep).join("/"));
const isDirectory = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false; // absent is fine: writeAtomic creates the parent
  }
};

/**
 * Resolve `--out` against the invocation cwd and check it against the work
 * tree, the G-5 prefixes and the reserved set under `<st>/`. Prose leads the
 * message and the path follows (a token whose value starts with a long
 * absolute path reads as high-entropy to redact.mjs).
 * @param {object} ctx
 * @param {string} out as typed
 * @returns {{abs: string, rel: string}}
 * @throws {CliError} 2
 */
function resolveOut(ctx, out) {
  if (typeof out !== "string" || out === "") throw usageError(COMMAND, "--out needs a path");
  const target = resolve(realpathSync.native(ctx.cwd), out);
  const inside = relative(ctx.root, target);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw usageError(COMMAND, `cannot write ${out} (outside the work tree)`);
  }
  const rel = toPosix(inside);
  if (!WRITABLE.some((prefix) => rel.startsWith(prefix)) && !WRITABLE_GLOBS.some((glob) => glob.test(rel))) {
    throw usageError(COMMAND, `--out must be under ${WRITABLE_TEXT} (G-5), got ${out}`);
  }
  if (RESERVED_ST.test(rel)) throw usageError(COMMAND, `--out must not point into the bundle's own state (${RESERVED_TEXT}), got ${out}`);
  if (isDirectory(target)) throw usageError(COMMAND, `--out names a directory, got ${out}`);
  return { abs: target, rel };
}

/**
 * @param {string[]} argv after `render`
 * @param {object} ctx
 * @returns {Promise<number>}
 */
export async function run(argv, ctx) {
  const { flags, positionals } = parseCommandArgv(COMMAND, argv, { out: "value" });
  if (positionals.length > 0) throw usageError(COMMAND, `unexpected argument ${positionals[0]}`);
  const destination = flags.out === undefined ? { abs: join(ctx.st, DEFAULT_OUT), rel: ctx.rel(join(ctx.st, DEFAULT_OUT)) } : resolveOut(ctx, flags.out);

  const { projection } = await openRegister(ctx);
  const markdown = redactString(renderRegister(projection)).text;
  writeAtomic(destination.abs, markdown);
  ctx.out(rendered({ relPath: destination.rel, rows: Object.keys(projection.rows).length, seq: projection.seq }));
  return EXIT.OK;
}
