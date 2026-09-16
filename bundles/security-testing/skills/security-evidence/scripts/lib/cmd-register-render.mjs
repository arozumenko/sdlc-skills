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
// `.agents/security-testing/`, `.agents/memory/`, `reports/security/` or
// `tasks/security-*/`. Anything else is 2 USAGE and nothing is written.
//
// stdout: `RENDER <repo-relative path> rows=<n> seq=<n>` (tokens.rendered; not
// an enveloped artifact, so not WROTE). Exit 0; 2 usage / ENGAGEMENT-MISSING;
// 5 CORRUPT.

import { realpathSync } from "node:fs";
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

// Repo-relative prefixes a script may write under (G-5); the tasks/security-<slug>/ shape is a glob.
const WRITABLE = Object.freeze([".agents/security-testing/", ".agents/memory/", "reports/security/"]);
const WRITABLE_GLOB = /^tasks\/security-[^/]+\//;
const WRITABLE_TEXT = ".agents/security-testing/, .agents/memory/<role>/, reports/security/ or tasks/security-*/";

const toPosix = (p) => (sep === "/" ? p : p.split(sep).join("/"));

/**
 * Resolve `--out` against the invocation cwd and check it against the work
 * tree and the G-5 prefixes. Prose leads the message and the path follows
 * (a token whose value starts with a long absolute path reads as
 * high-entropy to redact.mjs).
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
  if (!WRITABLE.some((prefix) => rel.startsWith(prefix)) && !WRITABLE_GLOB.test(rel)) {
    throw usageError(COMMAND, `--out must be under ${WRITABLE_TEXT} (G-5), got ${out}`);
  }
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
