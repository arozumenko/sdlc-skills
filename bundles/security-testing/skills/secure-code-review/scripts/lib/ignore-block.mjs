// lib/ignore-block.mjs — the managed `.gitignore` block (spec D9). The one
// definition of the block's edges and patterns: `cite.mjs init` is the only
// writer of `.gitignore`; it writes the block and fails closed when a file
// under a managed path is already tracked.
//
// The block, between `# security-testing:begin` and `# security-testing:end`,
// carries the four private paths under `.agents/security-testing/`
// (`reviews/`, `verify/`, `register/`, `proposals/`), one per line.
//
//   PATTERNS                the four, frozen
//   renderBlock()           begin, patterns, end — one line each, LF, trailing LF
//   upsertBlock(text)       → text with the block written in, idempotent
//   stripManagedBlock(text) text without the block
//   probeTracked(root)      tracked paths under the managed patterns (D9 probe)
//   readGitignore(root)     the root .gitignore as a latin1 string ("" when absent)
//
// upsertBlock keeps the block where it is when one exists (so the user's
// lines around it stay put and the diff is the block alone) and appends it
// otherwise, adding the LF that attaches it to a last line without one. A
// begin marker with no end, or an end with no begin, is a comment line to git
// that carries no rule — upsert drops such stray markers so exactly one
// well-formed block results; stripManagedBlock, the read side, strips nothing
// when a begin is unterminated (every line after it is live to git). A CRLF
// file gets a CRLF block; every reader drops the CR before comparing.
//
// Byte safety: .gitignore is bytes, not text. readGitignore decodes latin1
// (a bijection over bytes) and the writer encodes latin1 back, so a
// non-UTF-8 line the consumer wrote survives the round trip untouched; the
// block itself is ASCII.
//
// Imports node:fs (readFileSync only — no write), node:path, ./git.mjs. No
// console, no clock, no network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lsFiles } from "./git.mjs";

/** The root ignore file the block lives in. */
export const GITIGNORE = ".gitignore";
export const BLOCK_BEGIN = "# security-testing:begin";
export const BLOCK_END = "# security-testing:end";

const ST = ".agents/security-testing/";

/** The four private paths the block ignores, in block order. */
export const PATTERNS = Object.freeze([`${ST}reviews/`, `${ST}verify/`, `${ST}register/`, `${ST}proposals/`]);

/**
 * The block text: begin marker, the patterns, end marker, one per line, LF,
 * with a trailing LF.
 * @returns {string}
 */
export function renderBlock() {
  return `${[BLOCK_BEGIN, ...PATTERNS, BLOCK_END].join("\n")}\n`;
}

const bare = (line) => (line.endsWith("\r") ? line.slice(0, -1) : line);

/**
 * Well-formed blocks (`[beginIndex, endIndex]`, inclusive) and stray marker
 * line indexes over `lines`. A begin marker inside a block is part of the
 * block; an end marker outside one, or a begin never closed, is stray.
 */
function scan(lines) {
  const blocks = [];
  const stray = [];
  let begin = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = bare(lines[i]);
    if (begin === -1) {
      if (line === BLOCK_BEGIN) begin = i;
      else if (line === BLOCK_END) stray.push(i);
    } else if (line === BLOCK_END) {
      blocks.push([begin, i]);
      begin = -1;
    }
  }
  if (begin !== -1) stray.push(begin);
  return { blocks, stray, unterminated: begin !== -1 };
}

/**
 * `text` without the managed block (begin line through end line, inclusive,
 * every well-formed occurrence); unchanged when a begin marker is never
 * closed — git reads that marker as a comment and every line after it as a
 * live pattern, so nothing may be hidden from a comparison against HEAD.
 * @param {string} text
 * @returns {string}
 */
export function stripManagedBlock(text) {
  if (typeof text !== "string") throw new TypeError("stripManagedBlock: text must be a string");
  const lines = text.split("\n");
  const { blocks, unterminated } = scan(lines);
  if (unterminated) return text;
  const drop = new Set();
  for (const [b, e] of blocks) for (let i = b; i <= e; i++) drop.add(i);
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

/**
 * The managed block written into a `.gitignore` text: replaced in place when
 * present (first occurrence's position; further blocks and stray markers
 * dropped), appended when absent. Idempotent: the result equals `text`
 * exactly when the text already holds one well-formed block and nothing
 * stray.
 * @param {string} text the file's current text ("" when absent)
 * @returns {string}
 */
export function upsertBlock(text) {
  if (typeof text !== "string") throw new TypeError("upsertBlock: text must be a string");
  const cr = text.includes("\r\n") ? "\r" : "";
  const block = [BLOCK_BEGIN, ...PATTERNS, BLOCK_END].map((line) => line + cr);
  const lines = text.split("\n");
  const { blocks, stray } = scan(lines);
  const drop = new Set(stray);
  for (const [b, e] of blocks) for (let i = b; i <= e; i++) drop.add(i);

  const out = [];
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (blocks.length > 0 && i === blocks[0][0]) insertAt = out.length;
    if (!drop.has(i)) out.push(lines[i]);
  }
  if (insertAt === -1) {
    // Append. A text ending in LF splits into a trailing "" — the block goes
    // before it; otherwise the block follows the last line and ends the file
    // with the LF a .gitignore needs to attach further lines.
    if (out.length > 0 && out[out.length - 1] === "") out.splice(out.length - 1, 0, ...block);
    else out.push(...block, "");
  } else {
    out.splice(insertAt, 0, ...block);
    if (out[out.length - 1] !== "") out.push("");
  }
  return out.join("\n");
}

/**
 * The root `.gitignore` as a latin1 string — every byte one char, so the
 * caller can encode it back unchanged. "" when the file is absent.
 * @param {string} root
 * @returns {string}
 */
export function readGitignore(root) {
  try {
    return readFileSync(join(root, GITIGNORE)).toString("latin1");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

/**
 * The fail-closed probe (D9): every tracked path under a managed pattern.
 * Empty means no private destination is already in git.
 * @param {string} root
 * @returns {string[]} repo-relative paths, ls-files order
 */
export function probeTracked(root) {
  return lsFiles(root, { paths: PATTERNS.map((p) => p.replace(/\/$/, "")) });
}
