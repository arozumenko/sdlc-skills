// lib/ignore-block.mjs — the managed `.gitignore` block (TASK-008; spec §6.9
// steps 1–2, P3, D13, TL-13; plan §3.3 row `lib/ignore-block.mjs`). The one
// definition of the block's edges and patterns: `engagement init` step 1
// writes it (cmd-engagement.mjs — the only writer of `.gitignore`, G-5),
// `engagement validate` renders it dry, `run init` / `scope` strip it before
// comparing `.gitignore` against HEAD (clean-tree.mjs), `sign-off` reuses the
// fail-closed probe (TASK-033).
//
// The block, between `# security-testing:begin` and `# security-testing:end`,
// carries the ten §6.9 patterns in §6.9 order. A `committed` entry in the
// engagement's `artifact_policy` removes that artifact's pattern — that is
// how "commit by policy" works (P3). `private/` has no policy key (TL-13):
// the key material can never be un-ignored; parseEngagementMd refuses the
// key before this module sees the policy, and renderBlock refuses it again.
//
//   PATTERNS                        the ten, frozen, in §6.9 order
//   POLICY_PATTERNS                 artifact_policy key → pattern (nine keys; private/ absent)
//   activePatterns(policy)          PATTERNS minus the committed ones
//   renderBlock(policy)             begin, patterns, end — one line each, LF, trailing LF
//   upsertBlock(text, policy)       → {text, changed}: the block written into a .gitignore text,
//                                   idempotent; the one function init (write) and validate (dry) share
//   stripManagedBlock(text)         text without the block (moved here from cmd-run.mjs)
//   probeManagedPaths(ctx, policy)  → {tracked: [{pattern, path}], notIgnored: [pattern]} (§6.9 step 2)
//   readGitignore(root)             the root .gitignore as a latin1 string ("" when absent)
//
// upsertBlock keeps the block where it is when one exists (so the user's
// lines around it stay put and the diff is the block alone) and appends it
// otherwise, adding the LF that attaches it to a last line without one. A
// begin marker with no end, or an end with no begin, is a comment line to git
// that carries no rule — upsert drops such stray markers so exactly one
// well-formed block results; stripManagedBlock, the read side, strips nothing
// when a begin is unterminated (every line after it is live to git and must
// compare against HEAD as dirt — TASK-012 review 2). A CRLF file gets a CRLF
// block; every reader drops the CR before comparing.
//
// Byte safety: .gitignore is bytes, not text. readGitignore decodes latin1
// (a bijection over bytes) and cmd-engagement encodes latin1 back, so a
// non-UTF-8 line the consumer wrote survives the round trip untouched; the
// block itself is ASCII.
//
// The fail-closed probe (§6.9 step 2): for every active pattern,
// `git ls-files -- <pattern>*` must list nothing (a `/`-terminated pattern
// with `*` appended is a pathspec over the files *inside* the directory —
// `tasks/security-*/*` cannot match a file named `tasks/security-notes.md`,
// which the ignore pattern would not cover either) and `git check-ignore -q
// -- <pattern>.probe` must succeed (a probe file directly under the pattern,
// spelled literally — the `*` of `tasks/security-*/` is a valid path char
// and the pattern matches its own spelling). A committed pattern is skipped
// by both. Order: every TRACKED check first (content already in git is the
// graver state), then every NOT-IGNORED check, each in §6.9 order.
//
// Imports node:fs (readFileSync only — no write: G-5), node:path, ./git.mjs
// (the one place git runs, G-6). No console, no clock (G-1), no network (G-14).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkIgnore, lsFiles } from "./git.mjs";

/** The root ignore file the block lives in. */
export const GITIGNORE = ".gitignore";
export const BLOCK_BEGIN = "# security-testing:begin";
export const BLOCK_END = "# security-testing:end";

const ST = ".agents/security-testing/";

/** The ten §6.9 patterns, in §6.9 order. */
export const PATTERNS = Object.freeze([
  `${ST}private/`,
  `${ST}ledger/`,
  `${ST}runs/`,
  `${ST}receipts/`,
  `${ST}proposals/`,
  `${ST}handoffs/`,
  `${ST}imports/`,
  `${ST}register/`,
  "reports/security/",
  "tasks/security-*/",
]);

/** `artifact_policy` key → the pattern a `committed` value removes (TL-13: `private` is not a key). */
export const POLICY_PATTERNS = Object.freeze({
  ledger: `${ST}ledger/`,
  runs: `${ST}runs/`,
  receipts: `${ST}receipts/`,
  proposals: `${ST}proposals/`,
  handoffs: `${ST}handoffs/`,
  imports: `${ST}imports/`,
  register: `${ST}register/`,
  reports: "reports/security/",
  cases: "tasks/security-*/",
});

const POLICY_VALUES = Object.freeze(["local", "committed"]);

/**
 * The patterns the block carries under `policy`: every one of PATTERNS whose
 * artifact is not `committed`. `policy` is the engagement record's
 * `artifact_policy` (absent ⇒ everything local). A key that is not an
 * artifact name, a value outside local|committed, or the key `private` is a
 * caller bug here — parseEngagementMd is the gate that turns those into
 * ENGAGEMENT-INVALID / POLICY-INVALID(private) tokens.
 * @param {Record<string, "local"|"committed"> | undefined} [policy]
 * @returns {string[]}
 */
export function activePatterns(policy = {}) {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) throw new TypeError("activePatterns: policy must be an object");
  const committed = new Set();
  for (const [key, value] of Object.entries(policy)) {
    if (key === "private") throw new TypeError("activePatterns: private/ is never a policy key (TL-13)");
    if (!Object.hasOwn(POLICY_PATTERNS, key)) throw new TypeError(`activePatterns: unknown artifact_policy key ${key}`);
    if (!POLICY_VALUES.includes(value)) throw new TypeError(`activePatterns: ${key} must be local|committed, got ${String(value)}`);
    if (value === "committed") committed.add(POLICY_PATTERNS[key]);
  }
  return PATTERNS.filter((p) => !committed.has(p));
}

/**
 * The block text: begin marker, the active patterns, end marker, one per
 * line, LF, with a trailing LF.
 * @param {Record<string, "local"|"committed"> | undefined} [policy]
 * @returns {string}
 */
export function renderBlock(policy) {
  return `${[BLOCK_BEGIN, ...activePatterns(policy), BLOCK_END].join("\n")}\n`;
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
 * live pattern, so nothing may be hidden from the comparison against HEAD.
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
 * dropped), appended when absent. Idempotent: `changed` is false exactly when
 * the text already holds one block that renders `policy` and nothing stray.
 * @param {string} text the file's current text ("" when absent)
 * @param {Record<string, "local"|"committed"> | undefined} [policy]
 * @returns {{text: string, changed: boolean}}
 */
export function upsertBlock(text, policy) {
  if (typeof text !== "string") throw new TypeError("upsertBlock: text must be a string");
  const cr = text.includes("\r\n") ? "\r" : "";
  const block = [BLOCK_BEGIN, ...activePatterns(policy), BLOCK_END].map((line) => line + cr);
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
  const next = out.join("\n");
  return { text: next, changed: next !== text };
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
 * The fail-closed probe of §6.9 step 2 over the active patterns: tracked
 * files under a managed path (the pattern's first tracked file, ls-files
 * order) and patterns whose probe file git does not ignore. Empty lists mean
 * the private destinations are neither tracked nor exposed.
 * @param {{root: string}} ctx
 * @param {Record<string, "local"|"committed"> | undefined} [policy]
 * @returns {{tracked: {pattern: string, path: string}[], notIgnored: string[]}}
 */
export function probeManagedPaths(ctx, policy) {
  const active = activePatterns(policy);
  const tracked = [];
  for (const pattern of active) {
    const files = lsFiles(ctx.root, { paths: [`${pattern}*`] });
    if (files.length > 0) tracked.push({ pattern, path: files[0] });
  }
  const notIgnored = active.filter((pattern) => !checkIgnore(ctx.root, `${pattern}.probe`));
  return { tracked, notIgnored };
}
