#!/usr/bin/env node
// cases.mjs — the security-test-planning script (spec §6, §2 row 4, §8):
// the hand-off suite `tasks/security-<slug>-admitted/` is written only by
// `admit` and holds only admitted cases; `verify-suite` lists anything else.
//
//   admit <case.md>   the candidate must live under <st>/cases/, be named
//                     TC-NNN_<slug>.md and carry `id: TC-NNN`; every step is
//                     linted (lib/admission.mjs) against the grammar, the
//                     forbidden list and the engagement's targets.browser.
//                     No hits ⇒ the REDACTED text is copied into the suite and
//                     `{file, sha256}` (bare basename, sha256 of the written
//                     bytes) upserted into `.admitted.json` there.
//                       ADMITTED <suite>/<file>
//                     Hits ⇒ the redacted text is copied to <st>/proposals/:
//                       PROPOSAL <st>/proposals/<file> hits=<n>
//                       HIT <rule> step <n>: <action>        (one per hit)
//   verify-suite      every TC-*.md in the suite is in `.admitted.json` with
//                     its current sha256 ⇒ SUITE ok=<n> then the manual-qa
//                     and test-automation hand-off prompts (spec §8); else
//                     UNADMITTED: <path> per offender, exit 4, no prompts.
//   all               USAGE(<sub>: <why>) (2) · ENGAGEMENT-* (2) ·
//                     CORRUPT <suite>/.admitted.json (5)
//
// Redaction (lib/redact.mjs) runs on the case text before it is linted,
// written or echoed, so a hit line never carries a secret; `.admitted.json`
// holds only validated basenames and computed sha256 hex (the high-entropy
// rule would eat the hashes, so the index is not re-redacted). Stdlib ESM
// only; the one child process is `git rev-parse HEAD` (argv, shell:false);
// no network. Imports only from ./lib/.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { AdmissionError, caseId, lintCase } from "./lib/admission.mjs";
import { UsageError, runCli } from "./lib/cli.mjs";
import { readEngagement, stDir } from "./lib/engagement.mjs";
import { redactString } from "./lib/redact.mjs";

export const ADMITTED_INDEX = ".admitted.json";
export const CASE_FILE = /^(TC-\d{3})_[a-z0-9-]+\.md$/;
export const MANUAL_QA_PROMPT_HEAD = "Run as the active agent (claude --agent test-run-lead):";
const BASE_URL_UNSET = "<base_url>";
const HEADING = /^#[ \t]+(.+?)[ \t]*$/m;

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");
const clean = (s) => redactString(s).text;
const posix = (p) => p.split(sep).join("/");
const suiteRel = (slug) => `tasks/security-${slug}-admitted`;

/** The index cannot be read; `.token` is the result line, exit 5. Never carries file bytes. */
export class CorruptError extends Error {
  constructor(rel) {
    super(`${rel} is not a JSON array of {file, sha256}`);
    this.name = "CorruptError";
    this.token = `CORRUPT ${rel}`;
  }
}

/** `[{file, sha256}]` from the suite's index; absent ⇒ `[]`; anything but an array of such entries ⇒ CorruptError. */
export function readIndex(root, slug) {
  const rel = `${suiteRel(slug)}/${ADMITTED_INDEX}`;
  const path = join(root, rel);
  if (!existsSync(path)) return [];
  let index;
  try {
    index = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CorruptError(rel);
  }
  const ok = (e) => e !== null && typeof e === "object" && typeof e.file === "string" && CASE_FILE.test(e.file) && typeof e.sha256 === "string" && /^[0-9a-f]{64}$/.test(e.sha256);
  if (!Array.isArray(index) || !index.every(ok)) throw new CorruptError(rel);
  return index.map(({ file, sha256 }) => ({ file, sha256 }));
}

/** The case's `# ` heading without a leading `TC-NNN:` — what the test-automation prompt calls `title`. */
export function caseTitle(text) {
  const m = HEADING.exec(text);
  return m === null ? "" : m[1].replace(/^TC-\d{3}\s*:\s*/, "").trim();
}

const browserOf = (record) => (Array.isArray(record.targets?.browser) ? record.targets.browser : []);

// ---------------------------------------------------------------- admit

function admit(args, ctx) {
  const raw = args._[0];
  if (typeof raw !== "string" || args._.length !== 1) throw new UsageError("admit <case.md>");
  const { record } = readEngagement(ctx.root);
  const candidate = resolve(ctx.cwd, raw);
  const casesDir = join(stDir(ctx.root), "cases") + sep;
  const casesRel = `${posix(relative(ctx.root, casesDir))}/`;
  if (!candidate.startsWith(casesDir)) throw new UsageError(`candidates live under ${casesRel}, got ${posix(relative(ctx.root, candidate))}`);
  const file = basename(candidate);
  const m = CASE_FILE.exec(file);
  if (m === null) throw new UsageError(`file name must be TC-NNN_<slug>.md, got ${file}`);
  if (!existsSync(candidate)) throw new UsageError(`no such file ${posix(relative(ctx.root, candidate))}`);
  const text = clean(readFileSync(candidate, "utf8"));
  if (caseId(text) !== m[1]) throw new UsageError(`frontmatter id must be ${m[1]} (the file name prefix)`);
  let lint;
  try {
    lint = lintCase(text, { browser: browserOf(record) });
  } catch (e) {
    if (e instanceof AdmissionError) throw new UsageError(e.message);
    throw e;
  }
  if (lint.hits.length > 0) {
    const dir = join(stDir(ctx.root), "proposals");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), text);
    ctx.out(`PROPOSAL ${posix(relative(ctx.root, join(dir, file)))} hits=${lint.hits.length}`);
    for (const h of lint.hits) ctx.out(`HIT ${h.rule} step ${h.step}: ${h.text}`);
    return 0;
  }
  const index = readIndex(ctx.root, record.slug); // before any write: a corrupt index is never written past
  const rel = suiteRel(record.slug);
  const dir = join(ctx.root, rel);
  mkdirSync(dir, { recursive: true });
  const bytes = Buffer.from(text, "utf8");
  writeFileSync(join(dir, file), bytes);
  const entry = { file, sha256: sha256Hex(bytes) };
  const at = index.findIndex((e) => e.file === file);
  if (at >= 0) index[at] = entry;
  else index.push(entry);
  writeFileSync(join(dir, ADMITTED_INDEX), `${JSON.stringify(index, null, 2)}\n`);
  ctx.out(`ADMITTED ${rel}/${file}`);
  return 0;
}

// ---------------------------------------------------------------- verify-suite

const headOid7 = (root) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, shell: false, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, encoding: "utf8" }).trim().slice(0, 7);

function verifySuite(args, ctx) {
  if (args._.length !== 0) throw new UsageError("verify-suite takes no arguments");
  const { record } = readEngagement(ctx.root);
  const rel = suiteRel(record.slug);
  const dir = join(ctx.root, rel);
  const index = new Map(readIndex(ctx.root, record.slug).map((e) => [e.file, e.sha256]));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^TC-.*\.md$/.test(f)).sort() : [];
  const cases = [];
  let bad = 0;
  for (const file of files) {
    const bytes = readFileSync(join(dir, file));
    if (index.get(file) !== sha256Hex(bytes)) {
      ctx.out(`UNADMITTED: ${rel}/${file}`);
      bad++;
      continue;
    }
    cases.push({ id: CASE_FILE.exec(file)[1], title: caseTitle(bytes.toString("utf8")), path: `${rel}/${file}` });
  }
  if (bad > 0) return 4;
  const baseUrl = typeof record.base_url === "string" && record.base_url.length > 0 ? record.base_url : BASE_URL_UNSET;
  ctx.out(`SUITE ok=${cases.length}`);
  ctx.out(MANUAL_QA_PROMPT_HEAD);
  ctx.out(clean(`"Run the suite at ${rel}/ against base_url=${baseUrl}."`));
  ctx.out(clean(`TA-PROMPT cases=${JSON.stringify(cases)} slug=${record.slug} base=${headOid7(ctx.root)}`));
  return 0;
}

// ---------------------------------------------------------------- dispatch

/** A command whose own usage errors print as `USAGE(<sub>: <why>)` (2) and a corrupt index as `CORRUPT …` (5); everything else propagates to runCli. */
const command = (sub, fn) => (args, ctx) => {
  try {
    return fn(args, ctx);
  } catch (e) {
    if (e instanceof UsageError) {
      ctx.out(`USAGE(${sub}: ${clean(e.message)})`);
      return 2;
    }
    if (e instanceof CorruptError) {
      ctx.out(e.token);
      return 5;
    }
    throw e;
  }
};

export const COMMANDS = Object.freeze({
  admit: command("admit", admit),
  "verify-suite": command("verify-suite", verifySuite),
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runCli(COMMANDS, process.argv.slice(2), { name: "cases" }));
}
