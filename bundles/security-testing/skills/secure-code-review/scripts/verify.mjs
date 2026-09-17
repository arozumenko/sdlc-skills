#!/usr/bin/env node
// verify.mjs — checkout-based fix verification (spec §6 `verify.mjs`, D4):
//   verify.mjs --finding <id> --review <dir> --head <oid>
//              [--assertion not-refound|refound --by <session>]
// runs in the project's OWN checkout — no worktree, no install step — and
// refuses unless HEAD is the fix commit and the cited paths are clean;
// unrelated dirt is recorded as `carried_dirt`, never cleaned. Two
// invocations per run directory `<st>/verify/<id8>-<head7>/`:
//   1. (no --assertion) base = the finding's stamped first-citation oid;
//      base must be an ancestor of head and `base..head` must touch a cited
//      path (else UNVERIFIED-NOT-A-FIX); the project's tests run from
//      `engagement.md` `execute_project_tests.argv` (redacted, bounded tail
//      → tests.log; no argv ⇒ UNVERIFIED-NO-TEST-SURFACE); the diff of the
//      cited paths is parsed for deletion-only (UNVERIFIED-DELETION-ONLY)
//      and for suppression / skip indicators (ADVISORY, never a gate);
//      verify.json is written PENDING-REVIEW and the lead dispatches the
//      fix-review. A verdict any of those steps decides is written and
//      printed at once — a verdict is a result, not an error (exit 0).
//   2. (--assertion) sets the verdict: VERIFIED iff the tests exited 0 and
//      the fresh reviewer asserted `not-refound`; `refound` ⇒
//      UNVERIFIED-REFOUND; then the register row (if any) moves `fixed` /
//      `regressed` in-process through risk-register's register.mjs.
//
// Result lines (exit 0 ok · 2 usage / refused · 5 a record is corrupt):
//   NOT-AT-HEAD <head7> (checkout is at <oid7>) (2) · DIRTY <path> (2)
//   ADVISORY <path>:<line> <kind> · NEXT: dispatch security-reviewer fix-review
//   REGISTER: skipped (risk-register not installed)
//   VERDICT <token> finding=<id> base=<oid> head=<oid>
//   USAGE(verify: <why>) (2) · ENGAGEMENT-* (2) · GIT-ERROR <m> (2)
//   CORRUPT <record> (5)
//
// Every string printed or written passes through `redactString` — field-wise
// for verify.json, because the `high-entropy` rule would eat every full oid
// and finding id (the cite.mjs pattern: `HEX_KEYS`, and result lines built
// from validated hex). Stdlib ESM only; the test argv is spawned with
// `shell: false` (lib/verify-steps.mjs), git via lib/git.mjs; no network.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UsageError, runCli } from "./lib/cli.mjs";
import { readEngagement, stDir } from "./lib/engagement.mjs";
import { GitError, diffNameOnly, diffUnified, mergeBaseIsAncestor, revParse, statusPorcelain } from "./lib/git.mjs";
import { redactString } from "./lib/redact.mjs";
import { ArgvError, DEFAULT_TIMEOUT_S, INLINE_SUPPRESS_RE, TEST_SKIP_RE, boundOutput, checkArgv, parseUnifiedDiff, runTests } from "./lib/verify-steps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** risk-register's script, resolved relative to the installed skills dir; absent in a one-skill install. */
const REGISTER_PATH = join(HERE, "..", "..", "risk-register", "scripts", "register.mjs");
const register = existsSync(REGISTER_PATH) ? await import(pathToFileURL(REGISTER_PATH).href) : null;

export const VERDICTS = Object.freeze({
  pending: "PENDING-REVIEW",
  verified: "VERIFIED",
  refound: "UNVERIFIED-REFOUND",
  notAFix: "UNVERIFIED-NOT-A-FIX",
  deletionOnly: "UNVERIFIED-DELETION-ONLY",
  noTestSurface: "UNVERIFIED-NO-TEST-SURFACE",
  testsFailed: "UNVERIFIED-TESTS-FAILED",
});
export const NEXT_LINE = "NEXT: dispatch security-reviewer fix-review";
const REGISTER_SKIPPED = "REGISTER: skipped (risk-register not installed)";
const ASSERTIONS = Object.freeze(["not-refound", "refound"]);
const ADVISORY_KINDS = Object.freeze([
  ["inline-suppress", INLINE_SUPPRESS_RE],
  ["test-skip", TEST_SKIP_RE],
]);
const OID = /^[0-9a-f]{40}$/;
const ID_PREFIX = /^[0-9a-f]{8,64}$/;
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** Keys whose value is a full oid / finding id by construction — kept as hex by `redactDeep`. */
const HEX_KEYS = new Set(["finding_id", "base", "head"]);
const VERIFY_JSON = "verify.json";
const TESTS_LOG = "tests.log";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clean = (s) => redactString(s).text;
/** Redacted `out()`: nothing reaches stdout unredacted. */
const say = (ctx, line) => ctx.out(clean(line));
const posix = (p) => p.split("\\").join("/");

/** A record this script wrote cannot be read back: `CORRUPT <record>`, exit 5. The message names the file, never its bytes. */
class CorruptError extends Error {
  constructor(record) {
    super(record);
    this.name = "CorruptError";
    this.token = `CORRUPT ${record}`;
  }
}

/** Deep copy with every string (keys included) redacted, except a full oid/id under one of `HEX_KEYS`. */
function redactDeep(value, key) {
  if (typeof value === "string") return key !== undefined && HEX_KEYS.has(key) && HEX.test(value) ? value : clean(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v));
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[clean(k)] = redactDeep(v, k);
    return out;
  }
  return value;
}

/** `JSON.parse` that never lets the file's bytes into a thrown message. */
function parseJson(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e && e.code === "ENOENT") return undefined;
    return null;
  }
  return isObject(doc) ? doc : null;
}

/** A required string flag. */
function flag(args, name) {
  const v = args[name];
  if (typeof v !== "string" || v.length === 0) throw new UsageError(`--${name} <value> is required`);
  return v;
}

/**
 * The finding `prefix` names in `<review>/findings.json`: its stamped id,
 * its base (the first citation's oid — the identity anchor) and the unique
 * cited paths. Only a checked (stamped) file carries ids.
 * @throws {UsageError}
 */
function loadFinding(reviewAbs, prefix) {
  const file = join(reviewAbs, "findings.json");
  const doc = parseJson(file);
  if (doc === undefined) throw new UsageError("no findings.json under --review");
  if (doc === null || !Array.isArray(doc.findings)) throw new UsageError("findings.json is not a findings document");
  const hits = doc.findings.filter((f) => isObject(f) && typeof f.id === "string" && f.id.startsWith(prefix));
  if (hits.length === 0) throw new UsageError(`no finding with id prefix ${prefix} (run cite.mjs check first — only a checked file carries ids)`);
  if (hits.length > 1) throw new UsageError(`id prefix ${prefix} is ambiguous (${hits.length} findings)`);
  const [f] = hits;
  const citations = Array.isArray(f.citations) ? f.citations.filter(isObject) : [];
  const base = citations[0]?.oid;
  if (!HEX.test(f.id) || !OID.test(base)) throw new UsageError(`finding ${prefix.slice(0, 8)} is not stamped — run cite.mjs check first`);
  const paths = [...new Set(citations.map((c) => c.path).filter((p) => typeof p === "string" && p.length > 0))];
  if (paths.length === 0) throw new UsageError(`finding ${prefix.slice(0, 8)} cites no path`);
  return { id: f.id, base, paths };
}

/** Dirty paths from `git status --porcelain` (a rename by its new path). */
const dirtOf = (root, paths) => statusPorcelain(root, { paths }).map((line) => line.slice(3).split(" -> ").at(-1));
/** Write verify.json (field-wise redacted) and print the verdict line from validated hex. */
function conclude(ctx, run, doc, verdict) {
  doc.verdict = verdict;
  mkdirSync(run.dir, { recursive: true });
  writeFileSync(join(run.dir, VERIFY_JSON), `${JSON.stringify(redactDeep(doc), null, 2)}\n`);
  if (verdict !== VERDICTS.pending) ctx.out(`VERDICT ${verdict} finding=${doc.finding_id} base=${doc.base} head=${doc.head}`);
  return 0;
}

/** Spec §6 step 3: the project's tests in the checkout; `null` when the engagement names no argv. */
function testsStep(root, record, dir) {
  const ept = record.execute_project_tests;
  if (!isObject(ept) || ept.argv === undefined) return null;
  const timeout_s = ept.timeout_s === undefined ? DEFAULT_TIMEOUT_S : ept.timeout_s;
  if (typeof timeout_s !== "number" || !Number.isFinite(timeout_s) || timeout_s <= 0) throw new UsageError("execute_project_tests.timeout_s must be a positive number of seconds");
  let argv;
  try {
    argv = checkArgv(ept.argv);
  } catch (e) {
    if (e instanceof ArgvError) throw new UsageError(`execute_project_tests.argv rejected: ${e.message}`);
    throw e;
  }
  const r = runTests({ root, argv, timeout_s });
  let output = r.output;
  if (r.timed_out) output += `${output.length > 0 && !output.endsWith("\n") ? "\n" : ""}[timed out after ${timeout_s} s]\n`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, TESTS_LOG), boundOutput(clean(output))); // redact the whole capture first, so no rule ever sees a cut line
  return { argv, exit: r.exit, duration_ms: r.duration_ms, log: TESTS_LOG };
}

/** Spec §6 step 4: the diff of every cited path — deletion-only, and suppression / skip indicators on added lines. */
function diffStep(root, base, head, paths) {
  let added = 0;
  let removed = 0;
  const advisories = [];
  for (const path of paths) {
    for (const f of parseUnifiedDiff(diffUnified(root, base, head, path))) {
      if (f.binary === true) continue;
      added += f.added.length;
      removed += f.removed.length;
      for (const e of f.added) for (const [kind, re] of ADVISORY_KINDS) if (re.test(e.text)) advisories.push({ path: f.path ?? path, line: e.line, kind });
    }
  }
  return { deletion_only: removed > 0 && added === 0, advisories };
}

/** The verdict the recorded steps decide on their own; `null` when only the fix-review can. */
function earlyVerdict(doc) {
  if (doc.diff.deletion_only) return VERDICTS.deletionOnly;
  if (doc.tests === null) return VERDICTS.noTestSurface;
  if (doc.tests.exit !== 0) return VERDICTS.testsFailed;
  return null;
}

/** First invocation: steps 2–5 of spec §6, ending PENDING-REVIEW or an early verdict. */
function firstRun(ctx, { root, record, run, id, base, head, paths, reviewRel, carried }) {
  const doc = { finding_id: id, review: reviewRel, base, head, carried_dirt: carried, tests: null, diff: { deletion_only: false, advisories: [] }, assertion: null, verdict: null };
  if (!mergeBaseIsAncestor(root, base, head) || diffNameOnly(root, base, head, { paths }).length === 0) return conclude(ctx, run, doc, VERDICTS.notAFix);
  doc.tests = testsStep(root, record, run.dir);
  doc.diff = diffStep(root, base, head, paths);
  for (const a of doc.diff.advisories) say(ctx, `ADVISORY ${a.path}:${a.line} ${a.kind}`);
  const early = earlyVerdict(doc);
  if (early !== null) return conclude(ctx, run, doc, early);
  conclude(ctx, run, doc, VERDICTS.pending);
  say(ctx, NEXT_LINE);
  return 0;
}

/** Move the live register row for `id`, when risk-register is installed and the transition applies. */
function registerStep(ctx, root, id, verdict, run, by) {
  if (register === null) {
    say(ctx, REGISTER_SKIPPED);
    return;
  }
  const { rows } = register.foldEvents(register.readLog(root)); // CorruptError (exit 5) propagates through the wrapper
  const row = register.rowForFinding(rows, id);
  if (row === undefined) return;
  if (verdict === VERDICTS.verified && row.status !== "fixed") register.fixed(root, row.id, run.rel, by);
  else if (verdict === VERDICTS.refound && row.status === "fixed") register.regressed(root, row.id, run.rel, by);
}

/** Second invocation: read the PENDING-REVIEW record, set the verdict, move the register row. */
function decide(ctx, { root, run, id, head, assertion, by }) {
  const doc = parseJson(join(run.dir, VERIFY_JSON));
  if (doc === undefined) throw new UsageError(`no run ${run.name} — run without --assertion first`);
  if (doc === null || doc.finding_id !== id || doc.head !== head || !isObject(doc.diff) || (doc.tests !== null && !isObject(doc.tests))) throw new CorruptError(run.rel);
  if (doc.verdict !== VERDICTS.pending) throw new UsageError(`run ${run.name} is already decided: ${doc.verdict} (run without --assertion to restart it)`);
  const verdict = earlyVerdict(doc) ?? (assertion === "refound" ? VERDICTS.refound : VERDICTS.verified);
  doc.assertion = { value: assertion, by };
  doc.verdict = verdict;
  writeFileSync(join(run.dir, VERIFY_JSON), `${JSON.stringify(redactDeep(doc), null, 2)}\n`);
  registerStep(ctx, root, id, verdict, run, by);
  ctx.out(`VERDICT ${verdict} finding=${id} base=${doc.base} head=${head}`);
  return 0;
}

function verify(args, ctx) {
  const { root } = ctx;
  const prefix = flag(args, "finding");
  if (!ID_PREFIX.test(prefix)) throw new UsageError("--finding must be a finding id or a prefix of at least 8 hex chars");
  const reviewAbs = resolve(ctx.cwd, flag(args, "review"));
  const headRef = flag(args, "head");
  const assertion = args.assertion;
  if (assertion !== undefined && !ASSERTIONS.includes(assertion)) throw new UsageError("--assertion must be not-refound or refound");
  const by = assertion === undefined ? undefined : flag(args, "by");
  let reviewRel;
  try {
    reviewRel = posix(relative(realpathSync(root), realpathSync(reviewAbs)));
  } catch {
    throw new UsageError("--review is not a directory");
  }
  if (reviewRel.startsWith("..") || isAbsolute(reviewRel) || !statSync(reviewAbs).isDirectory()) throw new UsageError("--review must be a directory under the work tree");
  const { record } = readEngagement(root);
  const { id, base, paths } = loadFinding(reviewAbs, prefix);
  let head;
  try {
    head = revParse(root, headRef);
  } catch (e) {
    if (e instanceof GitError) throw new UsageError(`--head: unknown ref ${headRef}`);
    throw e;
  }
  const current = revParse(root, "HEAD");
  if (current !== head) {
    say(ctx, `NOT-AT-HEAD ${head.slice(0, 7)} (checkout is at ${current.slice(0, 7)})`);
    return 2;
  }
  const dirty = dirtOf(root, paths);
  if (dirty.length > 0) {
    for (const p of dirty) say(ctx, `DIRTY ${p}`);
    return 2;
  }
  const carried = dirtOf(root, []).filter((p) => !paths.includes(p));
  const name = `${id.slice(0, 8)}-${head.slice(0, 7)}`;
  const run = { name, dir: join(stDir(root), "verify", name), rel: posix(join(".agents", "security-testing", "verify", name, VERIFY_JSON)) };
  if (assertion !== undefined) return decide(ctx, { root, run, id, head, assertion, by });
  return firstRun(ctx, { root, record, run, id, base, head, paths, reviewRel, carried });
}

/** `USAGE(verify: <why>)` (2) and `CORRUPT <record>` (5) for this script's own errors; everything else is runCli's. */
const command = (sub, fn) => (args, ctx) => {
  try {
    return fn(args, ctx);
  } catch (e) {
    if (e instanceof UsageError) {
      say(ctx, `USAGE(${sub}: ${e.message})`);
      return 2;
    }
    if (e && e.name === "CorruptError" && typeof e.token === "string") {
      say(ctx, e.token);
      return 5;
    }
    throw e;
  }
};

export const COMMANDS = Object.freeze({ verify: command("verify", verify) });

/** True when this file is the process entry script (both sides realpath'd: symlinked installs, aliased tmpdirs). */
function isEntryScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  const argv = process.argv.slice(2);
  const cli = ["--help", "-h", "help"].includes(argv[0]) ? argv : ["verify", ...argv]; // one command, no subcommand word
  process.exit(runCli(COMMANDS, cli, { name: "verify" }));
}
