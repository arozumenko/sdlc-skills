// lib/clean-tree.mjs — the assessment clean-tree check (D18 as amended by
// P6). Written by TASK-012 inside cmd-run.mjs; moved here by TASK-008 so
// `run init` and `scope` (TASK-013) share it without a command importing a
// command (TL-1; TASK-012 review-3 follow-up). The block's edges come from
// ignore-block.mjs — one definition.
//
// `git status --porcelain -- <scope_paths> <product_paths>` must be empty
// after excluding the bundle's own managed paths — `.agents/security-
// testing/**`, `reports/security/`, `tasks/security-*/` — and the root
// `.gitignore` when its only difference from HEAD is the managed
// `# security-testing:begin/end` block. Files the engagement itself creates
// never count as dirt; anything else dirty under the assessed paths does
// (tracked or untracked; git-ignored files are not listed by status and are
// outside the observation, as for the baseline). An empty union assesses
// nothing, so nothing can be dirty.
//
// The `.gitignore` comparison works on git-significant lines (block
// stripped, CR dropped, blank lines dropped), not bytes: blank lines are
// separators with no effect on matching, and the block writer has to add
// the newline (or a blank separator) that attaches the block to a file whose
// last line had no LF — that whitespace is part of the block's edit, not
// dirt. When HEAD holds only the block and the working file is deleted, both
// sides reduce to no significant line and the tree is clean here: deleting
// the block re-exposes `private/` to git, which is `engagement validate`'s
// `IGNORE-BLOCK: stale` concern, not `run init`'s (TASK-012 review 2).
//
//   MANAGED_PATH                        the bundle's paths as one regex over a repo-relative path
//   gitignoreOnlyManagedBlock(ctx)      true when the working .gitignore differs from HEAD's only by the block
//   assessmentDirt(ctx, record)         status rows that are dirt: [] ⇒ clean
//
// Imports ./git.mjs (the one place git runs, G-6) and ./ignore-block.mjs.
// No fs write, no console, no clock (G-1), no network (G-14).

import { blobOid, showBytes, statusPorcelain } from "./git.mjs";
import { GITIGNORE, readGitignore, stripManagedBlock } from "./ignore-block.mjs";

/** The bundle's managed paths (spec D18): a status row under one of these is never dirt. */
export const MANAGED_PATH = /^(?:\.agents\/security-testing\/|reports\/security\/|tasks\/security-[^/]*\/)/;

/** The lines of a `.gitignore` text that mean something to git, after the managed block is stripped. */
function ignoreLinesOf(text) {
  return stripManagedBlock(text)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
}

/**
 * True when the working `.gitignore` differs from HEAD's only by the managed
 * block (and the whitespace that attaches it). Either side may be absent.
 * @param {{root: string}} ctx
 * @returns {boolean}
 */
export function gitignoreOnlyManagedBlock(ctx) {
  const atHead = blobOid(ctx.root, "HEAD", GITIGNORE) === null ? "" : showBytes(ctx.root, "HEAD", GITIGNORE).toString("latin1");
  const a = ignoreLinesOf(atHead);
  const b = ignoreLinesOf(readGitignore(ctx.root));
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * The status rows under `scope_paths ∪ product_paths` that are dirt for an
 * assessment: everything `git status --porcelain` lists there except the
 * bundle's managed paths and a `.gitignore` that differs only by the managed
 * block. A rename counts unless both its sides are managed.
 * @param {{root: string}} ctx
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
