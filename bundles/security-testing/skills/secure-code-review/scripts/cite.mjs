#!/usr/bin/env node
// cite.mjs — the secure-code-review script (spec §6): `init` seeds the
// engagement record and the managed `.gitignore` block (D9), `show` prints
// numbered, redacted lines at a commit (the helper the reviewer reads with),
// `check` verifies every citation of a findings file or a threat model
// against the bytes at its oid, stamps the file, and — findings — tiles
// coverage and validates second opinions, or — threat model — lints ids,
// element references and dispositions against the register and the
// admitted suite; `--md` appends the report tables; `redact` rewrites a
// Markdown file through the redaction rules.
//
// Result lines (one per outcome; exit 0 ok · 2 usage / bad input · 4 the
// check failed · 5 a record is corrupt):
//   init   WROTE <path> · EDIT-ENGAGEMENT-AND-RERUN (2) · TRACKED <path> (4)
//          IGNORE-BLOCK: written|present · INIT ok
//   show   SHOW <path> <oid7> <start>-<end>, then `<n>\t<redacted line>`
//   check  REFUSED agent-written key <key> (2) · DIRTY-SCOPE <path> (2)
//          FAILED <locus>.<citation-index> <why> (4) — locus is the finding
//            index, or the element / mitigation id of a threat model
//          findings:  SECOND <id> <assertion> · STALE-REVIEW <id> (4)
//                     COVERAGE examined=<n> partial=<n> unexamined=<n>
//          model:     TM-INVALID <locus>: <why> (4) · CORRUPT <record> (5)
//                     MODEL elements=<n> threats=<n> open=<n>
//          CHECK verified=<n> failed=<n>   (exit 4 on any FAILED/STALE/TM-INVALID)
//          --md: the tables, then TABLES sha256=<hex> (last)
//   redact REDACTED <file> hits=<n>
//   all    USAGE(<sub>: <why>) (2) · ENGAGEMENT-* tokens (2) · GIT-ERROR <m> (2)
//          USAGE(cite: <why>) is the dispatcher's own (unknown command, bad flag)
//
// Every string printed or written passes through `redactString` first —
// field-wise for JSON, because the `high-entropy` rule would otherwise eat
// every 40-hex oid and 64-hex hash a serialised file carries (see `token`
// and `redactDeep`). Line numbers are raw, as `git show` prints them (D3).
// Stdlib ESM only; every child process is an argv array with `shell: false`
// (via lib/git.mjs); no network. Imports only from ./lib/.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalPath, checkCitation, findingId, isOid } from "./lib/citations.mjs";
import { UsageError, runCli } from "./lib/cli.mjs";
import { CoverageError, tileCoverage } from "./lib/coverage.mjs";
import { readEngagement, stDir } from "./lib/engagement.mjs";
import { GitError, lsFiles, revParse, showBytes, statusPorcelain } from "./lib/git.mjs";
import { GITIGNORE, probeTracked, readGitignore, upsertBlock } from "./lib/ignore-block.mjs";
import { coverageTable, elementsTable, findingsTable, mitigationsTable, tablesSha256, threatsTable } from "./lib/md.mjs";
import { redactString } from "./lib/redact.mjs";
import { countOpen, lintThreatModel } from "./lib/threat-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A citation (and a `show` window) spans at most this many lines. */
export const MAX_RANGE_LINES = 40;

const ENGAGEMENT_REL = ".agents/security-testing/engagement.md";
const TEMPLATE_REL = join("knowledge", "engagement.md.template");

/** Redacted `out()`: nothing reaches stdout unredacted. */
const say = (ctx, line) => ctx.out(redactString(line).text);

/**
 * A record another script wrote (the register log, the admitted-suite
 * index) cannot be read: `CORRUPT <record>`, exit 5. The message names the
 * record and a line number, never its bytes.
 */
class CorruptError extends Error {
  constructor(message) {
    super(message);
    this.name = "CorruptError";
  }
}

/**
 * A command whose own usage errors print as `USAGE(<sub>: <why>)` (exit 2)
 * and whose corrupt-record errors print as `CORRUPT <record>` (exit 5)
 * rather than the dispatcher's `USAGE(cite: …)`; everything else propagates.
 * @param {string} sub
 * @param {(args: object, ctx: object) => number} fn
 */
const command = (sub, fn) => (args, ctx) => {
  try {
    return fn(args, ctx);
  } catch (e) {
    if (e instanceof UsageError) {
      say(ctx, `USAGE(${sub}: ${e.message})`);
      return 2;
    }
    if (e instanceof CorruptError) {
      say(ctx, `CORRUPT ${e.message}`);
      return 5;
    }
    throw e;
  }
};

// ---------------------------------------------------------------- init

/**
 * The engagement template: the skill-relative copy in this repo's bundle
 * tree first, then the copy the installer seeds under `<st>/knowledge/`,
 * then the skill's own `references/` copy (a one-skill standalone install
 * seeds no `knowledge/`).
 * @param {string} root
 * @returns {string} absolute path
 * @throws {UsageError} no copy exists
 */
function templatePath(root) {
  const candidates = [join(HERE, "..", "..", "..", TEMPLATE_REL), join(stDir(root), TEMPLATE_REL), join(HERE, "..", "references", "engagement.md.template")];
  const found = candidates.find((p) => existsSync(p));
  if (found === undefined) throw new UsageError(`engagement template not found (looked in ${candidates.map((p) => resolve(p)).join(", ")})`);
  return found;
}

function init(args, ctx) {
  const { root } = ctx;
  const st = stDir(root);
  mkdirSync(st, { recursive: true });
  const engagement = join(st, "engagement.md");
  if (!existsSync(engagement)) {
    writeFileSync(engagement, redactString(readFileSync(templatePath(root), "utf8")).text);
    say(ctx, `WROTE ${ENGAGEMENT_REL}`);
    say(ctx, "EDIT-ENGAGEMENT-AND-RERUN");
    return 2;
  }
  readEngagement(root); // EDIT-ENGAGEMENT-AND-RERUN / ENGAGEMENT-INVALID(<why>) propagate to runCli
  const tracked = probeTracked(root);
  if (tracked.length > 0) {
    for (const path of tracked) say(ctx, `TRACKED ${path}`);
    return 4;
  }
  // .gitignore is bytes: read and written as latin1 so the consumer's own
  // lines round-trip untouched; only the ASCII block is ours. This is the
  // one write that does NOT pass through `redactString` — the same bytes go
  // back to the same file, and redacting a consumer's ignore file would
  // corrupt it. Nothing here originates from us but the block.
  const current = readGitignore(root);
  const next = upsertBlock(current);
  if (next === current) {
    say(ctx, "IGNORE-BLOCK: present");
  } else {
    writeFileSync(join(root, GITIGNORE), Buffer.from(next, "latin1"));
    say(ctx, "IGNORE-BLOCK: written");
  }
  say(ctx, "INIT ok");
  return 0;
}

// ---------------------------------------------------------------- show

/**
 * True when `path` (repo-relative posix) sits under one of `scopePaths`
 * (posix prefix match on whole segments; `.` means the whole tree).
 * @param {string} path
 * @param {string[]} scopePaths
 * @returns {boolean}
 */
export function underScope(path, scopePaths) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  if (segments.includes("..") || segments.includes("")) return false;
  const clean = segments.filter((s) => s !== ".").join("/");
  if (clean.length === 0) return false;
  return scopePaths.some((scope) => {
    const s = scope.replace(/\/+$/, "").replace(/^(\.\/)+/, "");
    if (s === "" || s === ".") return true;
    return clean === s || clean.startsWith(`${s}/`);
  });
}

function lineNumber(raw, what) {
  if (!/^[1-9][0-9]*$/.test(raw)) throw new UsageError(`${what} must be a positive integer, got ${raw}`);
  return Number(raw);
}

function show(args, ctx) {
  const { root } = ctx;
  const [raw, startRaw, endRaw] = args._;
  if (raw === undefined) throw new UsageError("usage: show <path> [start end] [--at <oid>]");
  if ((startRaw === undefined) !== (endRaw === undefined)) throw new UsageError("start and end go together");
  const { record } = readEngagement(root);
  // The header and the git call use the canonical spelling (`./src/x` ⇒ `src/x`), as `check` does.
  const path = canonicalPath(raw);
  if (path === null || !underScope(path, record.scope_paths)) throw new UsageError(`${raw} is not under scope_paths (${record.scope_paths.join(", ")})`);
  let start = 1;
  let end;
  if (startRaw !== undefined) {
    start = lineNumber(startRaw, "start");
    end = lineNumber(endRaw, "end");
    if (end < start) throw new UsageError(`end ${end} is before start ${start}`);
    if (end - start + 1 > MAX_RANGE_LINES) throw new UsageError(`range over ${MAX_RANGE_LINES} lines (${start}-${end})`);
  }
  const at = typeof args.at === "string" ? args.at : "HEAD";
  let oid;
  try {
    oid = revParse(root, at);
  } catch (e) {
    if (e instanceof GitError) throw new UsageError(`unknown ref ${at}`);
    throw e;
  }
  const oid7 = oid.slice(0, 7);
  let bytes;
  try {
    bytes = showBytes(root, oid, path);
  } catch (e) {
    if (e instanceof GitError) throw new UsageError(`${path} is not in the tree at ${oid7}`);
    throw e;
  }
  // Raw lines, as `git show` prints them (D3): split on LF, drop the empty
  // entry a trailing LF leaves behind, keep CRs and blank lines in place.
  const lines = bytes.toString("utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (start > lines.length) throw new UsageError(`start ${start} is past the last line (${lines.length}) of ${path} at ${oid7}`);
  end = end === undefined ? lines.length : Math.min(end, lines.length);
  say(ctx, `SHOW ${path} ${oid7} ${start}-${end}`);
  for (let n = start; n <= end; n++) say(ctx, `${n}\t${lines[n - 1]}`);
  return 0;
}

// ---------------------------------------------------------------- check

/**
 * D10: agents never write `id`, `state` or `verdict`. Check itself writes
 * (findings) `id` per finding, `state`/`snippet_redacted` per citation and
 * `coverage`/`check_stamp` at the top; (threat model) `state`/
 * `snippet_redacted` per citation and `check_stamp` — each mode's `own`
 * keys, by position. A file carrying any of those must carry a
 * `check_stamp` that matches the rest of the file — check's own output
 * re-runs freely, a hand-written value or an assertion edited underneath
 * check's keys is REFUSED. `id`/`state`/`verdict` at ANY other position (a
 * finding's `state`, a citation's `id`, a top-level `verdict`, a nested
 * object) is never check's and is refused outright — otherwise it would be
 * written back under a valid stamp, indistinguishable from script output.
 * The one agent-written `id` is a threat model's `E-nnn`/`T-nnn`/`M-nnn`
 * (spec §6 names them as the agent's), so those positions are `agent`
 * keys. `oid` is in neither list: a citation may carry its own (spec §6
 * `oid?`); check stamps it only when absent, and strips it from the stamp
 * preimage. `child` maps a key at a position to the position beneath it.
 */
const MODES = Object.freeze({
  findings: {
    own: { top: ["coverage", "check_stamp"], finding: ["id"], citation: ["state", "snippet_redacted"] },
    agent: {},
    child: (pos, k) => (pos === "top" && k === "findings" ? "finding" : pos === "finding" && k === "citations" ? "citation" : "other"),
  },
  "threat-model": {
    own: { top: ["check_stamp"], citation: ["state", "snippet_redacted"] },
    agent: { element: ["id"], threat: ["id"], mitigation: ["id"] },
    child: (pos, k) => {
      if (pos === "top") return k === "elements" ? "element" : k === "threats" ? "threat" : "other";
      if (pos === "threat" && k === "mitigations") return "mitigation";
      if ((pos === "element" || pos === "mitigation") && k === "citations") return "citation";
      return "other";
    },
  },
});
const D10_KEYS = new Set(["id", "state", "verdict"]);
/** Keys whose value is a commit oid or a sha256 by construction; the walker keeps those as full hex. */
const HEX_KEYS = new Set(["head", "oid", "id", "check_stamp", "finding_id", "findings_sha256"]);
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ASSERTIONS = new Set(["confirmed", "refuted", "indeterminate"]);
const SECOND_FILE = /^second-(.+)\.json$/;

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A full oid or sha256 prints as is (the high-entropy rule would eat it); anything else is redacted. */
const token = (s) => (typeof s === "string" && HEX.test(s) ? s : redactString(String(s)).text);

/**
 * `JSON.parse` that never lets the file's bytes into a thrown message (V8
 * echoes a slice of the source in its SyntaxError).
 * @param {Buffer} bytes
 * @param {string} what for the usage line
 * @returns {object}
 * @throws {UsageError}
 */
function parseStrict(bytes, what) {
  let doc;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new UsageError(`${what} is not valid JSON`);
  }
  if (!isObject(doc)) throw new UsageError(`${what} is not a JSON object`);
  return doc;
}

/**
 * Deep copy with every string (keys included) redacted, except a value under
 * one of `HEX_KEYS` that is a full oid/sha256. Arrays pass no key down.
 * @param {unknown} value
 * @param {string} [key] the property name `value` sits under
 */
function redactDeep(value, key) {
  if (typeof value === "string") return key !== undefined && HEX_KEYS.has(key) && HEX.test(value) ? value : redactString(value).text;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v));
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[redactString(k).text] = redactDeep(v, k);
    return out;
  }
  return value;
}

/**
 * The document without the keys `check` writes (plus a citation's `oid`,
 * stamped when absent) — the `check_stamp` preimage. Key order is kept.
 * @param {object} doc
 * @param {typeof MODES[keyof typeof MODES]} mode
 */
function stripCheckKeys(doc, mode) {
  const visit = (value, pos) => {
    if (Array.isArray(value)) return value.map((v) => visit(v, pos));
    if (!isObject(value)) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (mode.own[pos]?.includes(k) || (pos === "citation" && k === "oid")) continue;
      out[k] = visit(v, mode.child(pos, k));
    }
    return out;
  };
  return visit(doc, "top");
}
const stampOf = (doc, mode) => sha256Hex(JSON.stringify(stripCheckKeys(doc, mode)));

/**
 * Walk the whole document: `own` = check-written keys at check's own
 * positions, `stray` = D10 keys anywhere else (an `agent` key at its
 * position excepted); both in document order.
 * @returns {{own: string[], stray: string[]}}
 */
function d10Keys(doc, mode) {
  const own = [];
  const stray = [];
  const visit = (value, pos) => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v, pos);
      return;
    }
    if (!isObject(value)) return;
    for (const [k, v] of Object.entries(value)) {
      if (mode.own[pos]?.includes(k)) own.push(k);
      else if (D10_KEYS.has(k) && !mode.agent[pos]?.includes(k)) stray.push(k);
      visit(v, mode.child(pos, k));
    }
  };
  visit(doc, "top");
  return { own, stray };
}

/**
 * D10 refusal, shared by both modes: prints `REFUSED agent-written key
 * <key>` and returns true when the file must not be touched.
 */
function refused(doc, mode, ctx) {
  const { own, stray } = d10Keys(doc, mode);
  if (stray.length === 0 && (own.length === 0 || doc.check_stamp === stampOf(doc, mode))) return false;
  const offending = stray.length > 0 ? stray : own;
  say(ctx, `REFUSED agent-written key ${[...D10_KEYS].find((k) => offending.includes(k)) ?? offending[0]}`);
  return true;
}

/**
 * `DIRTY-SCOPE <path>` per dirty path under `scope` (a rename renders as
 * `XY old -> new`; the dirty path is the last segment); true when any.
 */
function dirtyScope(root, scope, ctx) {
  const dirty = [...new Set(statusPorcelain(root, { paths: scope }).map((l) => l.slice(3).split(" -> ").pop()))].sort();
  for (const p of dirty) say(ctx, `DIRTY-SCOPE ${p}`);
  return dirty.length > 0;
}

/** `doc.head ?? HEAD` resolved to a full oid. */
function resolveHead(root, doc) {
  try {
    return revParse(root, doc.head ?? "HEAD");
  } catch (e) {
    if (e instanceof GitError) throw new UsageError(`head ${String(doc.head).slice(0, 7)} is not a commit`);
    throw e;
  }
}

/**
 * Check one citation list in place: every entry gets `path` (canonical),
 * `oid`, `state` and, when VERIFIED, `snippet_redacted`; FAILED lines go
 * to `failed` as `FAILED <locus>.<index> <why>`.
 * @returns {{verified: number, results: object[]}} `results[i]` is `checkCitation`'s answer for `citations[i]`
 */
function checkCitations(root, scope, head, citations, locus, failed) {
  let verified = 0;
  const results = citations.map((c, ci) => {
    const r = checkCitation(root, scope, c, { maxRangeLines: MAX_RANGE_LINES, defaultOid: head });
    if (r.state === "VERIFIED") verified++;
    else failed.push(`FAILED ${locus}.${ci} ${r.why}`);
    if (!isObject(c)) return r; // nothing to stamp on a non-object; it is reported bad-shape
    if (r.path !== undefined) c.path = r.path;
    if (r.oid !== undefined) c.oid = r.oid;
    c.state = r.state === "VERIFIED" ? "VERIFIED" : `FAILED(${r.why})`;
    if (r.state === "VERIFIED") c.snippet_redacted = r.snippet_redacted;
    else delete c.snippet_redacted;
    return r;
  });
  return { verified, results };
}

/** Redact field-wise, stamp, write. Returns the document as written. */
function writeBack(abs, doc, mode) {
  const out = redactDeep(doc);
  out.check_stamp = stampOf(out, mode);
  writeFileSync(abs, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

/** Raw line count of `path` at `oid` (lines as `git show` prints them); 0 when absent there. */
function rawLineCount(root, oid, path) {
  let bytes;
  try {
    bytes = showBytes(root, oid, path);
  } catch (e) {
    if (e instanceof GitError) return 0;
    throw e;
  }
  if (bytes.length === 0) return 0;
  let n = 0;
  for (const b of bytes) if (b === 0x0a) n++;
  return bytes[bytes.length - 1] === 0x0a ? n : n + 1;
}

/**
 * Every `second-<id>.json` beside the findings file, validated against the
 * findings as read (`findings_sha256` is the hash of the file bytes BEFORE
 * this run's write-back — the lead runs `check` before dispatching the second
 * opinion, so the reviewer hashes a stamped file, and a re-run of check on
 * its own output leaves those bytes unchanged).
 * @returns {{lines: string[], stale: number, valid: Map<string, {assertion: string, by: string}>}}
 */
function secondOpinions(dir, findings, fileSha) {
  const byId = new Map(findings.filter((f) => typeof f.id === "string").map((f) => [f.id, f]));
  const lines = [];
  const valid = new Map();
  let stale = 0;
  for (const name of readdirSync(dir).filter((n) => SECOND_FILE.test(n)).sort()) {
    let s = null;
    try {
      s = parseStrict(readFileSync(join(dir, name)), name);
    } catch {
      s = null;
    }
    const id = s !== null && typeof s.finding_id === "string" ? s.finding_id : name.match(SECOND_FILE)[1];
    const f = byId.get(id);
    const ok =
      s !== null &&
      f !== undefined &&
      s.oid === f.citations[0].oid &&
      s.findings_sha256 === fileSha &&
      typeof s.assertion === "string" &&
      ASSERTIONS.has(s.assertion) &&
      typeof s.note === "string" &&
      typeof s.by === "string";
    if (ok) {
      lines.push(`SECOND ${token(id)} ${s.assertion}`);
      valid.set(id, { assertion: s.assertion, by: s.by });
    } else {
      stale++;
      lines.push(`STALE-REVIEW ${token(id)}`);
    }
  }
  return { lines, stale, valid };
}

/**
 * Findings mode. Returns `{code, written, seconds}`; `written` (the
 * document as written back) and `seconds` (the valid second opinions by
 * id) feed `--md`. Code 2 means nothing was written.
 */
function checkFindings(doc, { root, bytes, abs }, ctx) {
  const mode = MODES.findings;
  if (!Array.isArray(doc.findings)) throw new UsageError("findings must be an array");
  if (!Array.isArray(doc.examined)) throw new UsageError("examined must be an array of {path, lines?}");
  if (doc.head !== undefined && !isOid(doc.head)) throw new UsageError("head must be a 40-hex oid");
  doc.findings.forEach((f, i) => {
    if (!isObject(f) || typeof f.class !== "string" || f.class.length === 0 || !Array.isArray(f.citations) || f.citations.length === 0) {
      throw new UsageError(`findings[${i}] must carry a class and a non-empty citations array`);
    }
  });
  if (refused(doc, mode, ctx)) return { code: 2 };
  const { record } = readEngagement(root);
  const scope = record.scope_paths;
  if (dirtyScope(root, scope, ctx)) return { code: 2 };
  const head = resolveHead(root, doc);
  const failed = [];
  let verified = 0;
  doc.findings.forEach((f, fi) => {
    const r = checkCitations(root, scope, head, f.citations, String(fi), failed);
    verified += r.verified;
    const first = r.results[0];
    const allVerified = f.citations.every((c) => isObject(c) && c.state === "VERIFIED");
    if (allVerified) f.id = findingId({ path: first.path, cls: f.class, normalisedSnippet: first.normalised });
    else delete f.id;
  });
  const files = lsFiles(root, { paths: scope });
  const counts = new Map(files.map((p) => [p, rawLineCount(root, head, p)]));
  let coverage;
  try {
    coverage = tileCoverage(files, doc.examined, counts);
  } catch (e) {
    if (e instanceof CoverageError) throw new UsageError(`examined: ${e.message}`);
    throw e;
  }
  doc.coverage = coverage;
  const seconds = secondOpinions(dirname(abs), doc.findings, sha256Hex(bytes));
  const written = writeBack(abs, doc, mode);
  for (const line of failed) say(ctx, line);
  for (const line of seconds.lines) ctx.out(line); // already token-redacted; the ids must survive
  say(ctx, `COVERAGE examined=${coverage.examined} partial=${coverage.partial} unexamined=${coverage.unexamined}`);
  say(ctx, `CHECK verified=${verified} failed=${failed.length}`);
  return { code: failed.length > 0 || seconds.stale > 0 ? 4 : 0, written, seconds: seconds.valid };
}

const REGISTER_REL = join("register", "events.jsonl");
const CLOSING = new Set(["supersede", "close-false-positive"]);
const ADMITTED_INDEX = ".admitted.json";
const CASE_PREFIX = /^(TC-\d{3})_/;

/**
 * The live register rows, folded from `<st>/register/events.jsonl` the way
 * `register.mjs` (risk-register) folds it: a row exists once an `add`
 * event names it and its latest event is not `supersede` or
 * `close-false-positive`. Read here, not imported — `cite.mjs` imports only
 * from its own `./lib/`, so the standalone install stays one directory.
 * @returns {Set<string>} `R-nnnn` ids
 * @throws {CorruptError} a line that is not a `{row_id, event}` object
 */
function registerRows(root) {
  const file = join(stDir(root), REGISTER_REL);
  if (!existsSync(file)) return new Set();
  const added = new Set();
  const latest = new Map();
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (line.trim().length === 0) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      throw new CorruptError(`events.jsonl:${i + 1}`);
    }
    if (!isObject(e) || typeof e.row_id !== "string" || typeof e.event !== "string") throw new CorruptError(`events.jsonl:${i + 1}`);
    if (e.event === "add") added.add(e.row_id);
    latest.set(e.row_id, e.event);
  });
  return new Set([...added].filter((id) => !CLOSING.has(latest.get(id))));
}

/**
 * The admitted cases: the `TC-nnn` prefixes of every `file` in
 * `tasks/security-<slug>-admitted/.admitted.json` (`[{file, sha256}]`,
 * written by `cases.mjs admit`). No index ⇒ nothing is admitted.
 * @returns {Set<string>}
 * @throws {CorruptError} the index is not a JSON array
 */
function admittedCases(root, slug) {
  const rel = `tasks/security-${slug}-admitted/${ADMITTED_INDEX}`;
  const file = join(root, rel);
  if (!existsSync(file)) return new Set();
  let index;
  try {
    index = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new CorruptError(rel);
  }
  if (!Array.isArray(index)) throw new CorruptError(rel);
  const ids = new Set();
  for (const entry of index) {
    const m = isObject(entry) && typeof entry.file === "string" ? CASE_PREFIX.exec(entry.file) : null;
    if (m !== null) ids.add(m[1]);
  }
  return ids;
}

/** Threat-model mode; same return shape as `checkFindings` (no `seconds`). */
function checkThreatModel(doc, { root, abs }, ctx) {
  const mode = MODES["threat-model"];
  if (!Array.isArray(doc.elements)) throw new UsageError("elements must be an array");
  if (!Array.isArray(doc.threats)) throw new UsageError("threats must be an array");
  if (doc.head !== undefined && !isOid(doc.head)) throw new UsageError("head must be a 40-hex oid");
  if (refused(doc, mode, ctx)) return { code: 2 };
  const { record } = readEngagement(root);
  const scope = record.scope_paths;
  const refs = { registerRows: registerRows(root), admittedCases: admittedCases(root, record.slug) };
  if (dirtyScope(root, scope, ctx)) return { code: 2 };
  const head = resolveHead(root, doc);
  const failed = [];
  let verified = 0;
  // Citations of elements and mitigations, under the id as locus (the index when the id is not usable).
  const locusOf = (item, fallback) => (isObject(item) && typeof item.id === "string" && item.id.length > 0 ? item.id : fallback);
  const citationsOf = (item) => (isObject(item) && Array.isArray(item.citations) ? item.citations : []);
  doc.elements.forEach((e, i) => {
    verified += checkCitations(root, scope, head, citationsOf(e), locusOf(e, `elements[${i}]`), failed).verified;
  });
  doc.threats.forEach((t, i) => {
    const mitigations = isObject(t) && Array.isArray(t.mitigations) ? t.mitigations : [];
    mitigations.forEach((m, j) => {
      verified += checkCitations(root, scope, head, citationsOf(m), locusOf(m, `threats[${i}].mitigations[${j}]`), failed).verified;
    });
  });
  const { errors } = lintThreatModel(doc, refs);
  const written = writeBack(abs, doc, mode);
  for (const line of failed) say(ctx, line);
  for (const { locus, why } of errors) say(ctx, `TM-INVALID ${locus}: ${why}`);
  say(ctx, `MODEL elements=${doc.elements.length} threats=${doc.threats.length} open=${countOpen(doc)}`);
  say(ctx, `CHECK verified=${verified} failed=${failed.length}`);
  return { code: failed.length > 0 || errors.length > 0 ? 4 : 0, written };
}

/**
 * `--md`: the report tables for the document as written, one blank line
 * apart, then `TABLES sha256=<hex>` over exactly the printed text (D6). The
 * text is redacted as a whole before the hash so the hash covers what the
 * lead pastes; the hash line itself is printed raw (it is 64 hex).
 */
function printTables({ mode, written, seconds }, { noSnippets }, ctx) {
  const tables = mode === "findings" ? [findingsTable(written, { noSnippets, seconds }), coverageTable(written)] : [elementsTable(written), threatsTable(written), mitigationsTable(written)];
  const text = redactString(tables.join("\n")).text;
  for (const line of text.replace(/\n$/, "").split("\n")) ctx.out(line);
  ctx.out(`TABLES sha256=${tablesSha256(text)}`);
}

function check(args, ctx) {
  const [file] = args._;
  if (file === undefined) throw new UsageError("usage: check <findings.json | threat-model.json> [--md [--no-snippets]]");
  const md = args.md === true;
  const noSnippets = args["no-snippets"] === true;
  if (noSnippets && !md) throw new UsageError("--no-snippets needs --md");
  const abs = resolve(ctx.cwd, file);
  let bytes;
  try {
    bytes = readFileSync(abs);
  } catch {
    throw new UsageError(`${file} not found`);
  }
  const doc = parseStrict(bytes, file);
  const mode = "findings" in doc ? "findings" : "elements" in doc || "threats" in doc ? "threat-model" : null;
  if (mode === null) throw new UsageError("neither a findings nor a threat-model document (no findings, elements or threats key)");
  const result = mode === "findings" ? checkFindings(doc, { root: ctx.root, bytes, abs }, ctx) : checkThreatModel(doc, { root: ctx.root, abs }, ctx);
  if (result.code !== 2 && md) printTables({ ...result, mode }, { noSnippets }, ctx);
  return result.code;
}

// ---------------------------------------------------------------- redact

const MD = /\.md$/i;

/** `redact <file.md>`: rewrite through the rules; write back only on a hit. */
function redact(args, ctx) {
  const [file] = args._;
  if (file === undefined) throw new UsageError("usage: redact <file.md>");
  if (!MD.test(file)) throw new UsageError(`${file} is not a .md file`);
  const abs = resolve(ctx.cwd, file);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    throw new UsageError(`${file} not found`);
  }
  const { text: clean, hits } = redactString(text);
  // A rule can re-match its own placeholder (`token = <REDACTED:key-value>`
  // satisfies the key-value rule again), so `hits` on an already-clean file
  // is not zero while the bytes are unchanged: write, and count, only when
  // something actually changed.
  const changed = clean !== text;
  if (changed) writeFileSync(abs, clean);
  say(ctx, `REDACTED ${file} hits=${changed ? hits : 0}`);
  return 0;
}

// ---------------------------------------------------------------- main

/** The command table. */
export const COMMANDS = { init: command("init", init), show: command("show", show), check: command("check", check), redact: command("redact", redact) };
/** Flags that take no value. */
const BOOLEANS = ["md", "no-snippets"];

/**
 * True when this file is the process entry script. Both sides are realpath'd:
 * `import.meta.url` is already canonical, `argv[1]` is whatever the caller
 * typed — a file symlink, a `--symlink` install, or a copy under an aliased
 * tmpdir (`/var/…` → `/private/var/…` on macOS) would otherwise never match
 * and main would silently not run.
 * @returns {boolean}
 */
function isEntryScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) process.exit(runCli(COMMANDS, process.argv.slice(2), { name: "cite", booleans: BOOLEANS }));
