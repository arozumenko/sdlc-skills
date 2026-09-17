#!/usr/bin/env node
// scripts/score-findings.mjs — the deterministic scorer of the secure-code-review
// frozen eval harness (TASK-034, US-026 AC-4; spec §5 "Prose + references +
// fixtures + frozen eval harness", §12 "Model evals: frozen harness").
//
// The harness itself is not a script: a person (or a runner they write) puts
// the pinned prompt in front of the pinned model with the pinned settings, once
// per case under evals/fixtures/, and records what came back under
// evals/runs/<run-id>/ — `run.json` naming the harness it ran under and one
// `<case>.output.json` per case. This scorer compares those outputs with
// evals/expected-verdicts.json, which was authored before any run and is
// frozen together with the fixtures by harness.json `fixture_revision`.
//
//   node score-findings.mjs score <run-dir> [--json]
//       CASE <id> PASS | CASE <id> FAIL <reason>[; <reason>…]   (one per case, id order)
//       SCORE passed=<n> failed=<n> total=<n>
//       exit 0 every case passed · 4 at least one failed · 5 HARNESS-DRIFT(<field>)
//       (the run names a prompt_sha256 / fixture_revision / model_id that is not the one
//       on disk, or harness.json itself is stale against the files it freezes — nothing
//       is scored) · 2 USAGE(…)
//   node score-findings.mjs digest
//       prompt_sha256=<hex> / fixture_revision=<hex> of what is on disk now — paste into
//       harness.json after an intentional edit of a prompt file or a fixture.
//
// Matching rules (harness.json `matching`, applied per case):
//   review contract — each expectation {class, path, lines[, typed_citations_required]}
//   must be met by one output finding: class exact, path exact, lines overlap
//   (any shared normalised line); an expectation with typed_citations_required
//   needs that finding to carry at least one `source` and one `sink` typed
//   citation (the skill's rule for data-flow classes); a finding matching any
//   `forbidden` entry (each present field must match; lines by overlap) fails
//   the case; findings matched by no expectation are `extra`, allowed up to
//   `max_extra`. vulnerability-review contract — `assertion` must equal
//   `expected_assertion` exactly (assertion_exact). Missing, malformed or
//   wrong-contract output fails with a named reason. Every list in the result
//   is in id order and every object has sorted keys, so two runs over the
//   same files print the same bytes.
//
// Digests: `fixture_revision` = sha256 over the sorted files under
// evals/fixtures/ plus evals/expected-verdicts.json, each as
// `<relative path>\0<sha256 of bytes>\n`; `prompt_sha256` = the same over
// PROMPT_FILES in the listed order. Runs under evals/runs/ never enter either.
//
// Stdlib only (G-11); no clock, no network, no child process; reads only the
// skill directory and the run directory it is pointed at.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The frozen prompt: the skill text the reviewer runs under plus the per-case instruction. Order matters for the digest. */
export const PROMPT_FILES = Object.freeze(["SKILL.md", "references/taxonomy.md", "references/refutation-criteria.md", "references/do-not-flag.md", "evals/prompt.md"]);
export const EXIT = Object.freeze({ OK: 0, USAGE: 2, FAIL: 4, DRIFT: 5 });
/** run.json `harness` fields that must equal harness.json for a run to be scorable. */
const PINNED = Object.freeze(["prompt_sha256", "fixture_revision", "model_id"]);
const DEFAULT_SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every regular file under `dir`, as sorted posix paths relative to `dir`. */
function walkFiles(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, rel));
    else out.push(rel);
  }
  return out;
}

function digestEntries(root, rels) {
  const h = createHash("sha256");
  for (const rel of rels) h.update(`${rel}\0${sha256(readFileSync(join(root, rel)))}\n`);
  return h.digest("hex");
}

/** sha256 over evals/fixtures/** + evals/expected-verdicts.json (sorted; runs excluded). */
export function fixtureRevision(skillDir = DEFAULT_SKILL_DIR) {
  const rels = walkFiles(join(skillDir, "evals", "fixtures"), "evals/fixtures");
  rels.push("evals/expected-verdicts.json");
  return digestEntries(skillDir, rels);
}

/** sha256 over PROMPT_FILES in order; a missing file is an error (the harness is then not frozen). */
export function promptSha256(skillDir = DEFAULT_SKILL_DIR) {
  for (const rel of PROMPT_FILES) if (!existsSync(join(skillDir, rel))) throw new Error(`promptSha256: ${rel} is missing under ${skillDir}`);
  return digestEntries(skillDir, PROMPT_FILES);
}

const overlaps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 && a[0] <= b[1] && b[0] <= a[1];
const rangeText = (lines) => (Array.isArray(lines) && lines.length === 2 ? `${lines[0]}-${lines[1]}` : "?");

/** Does finding `f` meet the present fields of `e` (class exact, path exact, lines by overlap)? */
function matchesEntry(f, e) {
  if (!isObject(f)) return false;
  if (typeof e.class === "string" && f.class !== e.class) return false;
  if (typeof e.path === "string" && f.path !== e.path) return false;
  if (Array.isArray(e.lines) && !overlaps(f.lines, e.lines)) return false;
  return true;
}

function hasSourceAndSink(f) {
  if (!Array.isArray(f.citations_typed)) return false;
  const roles = new Set(f.citations_typed.filter(isObject).map((c) => c.role));
  return roles.has("source") && roles.has("sink");
}

const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

/**
 * Score one case.
 * @param {object} expected the case's entry in expected-verdicts.json
 * @param {object|null|undefined} output the run's `<case>.output.json` (null/undefined = no output)
 * @param {object} matching harness.json `matching`
 * @returns {{extra: number, matched: number, pass: boolean, reasons: string[]}}
 */
export function scoreCase(expected, output, matching = {}) {
  const reasons = [];
  let matched = 0;
  let extra = 0;
  const done = () => sorted({ extra, matched, pass: reasons.length === 0, reasons });
  if (output === null || output === undefined) return (reasons.push("no-output"), done());
  if (output.__malformed === true) return (reasons.push("malformed: not JSON"), done());
  if (!isObject(output)) return (reasons.push("malformed: output is not an object"), done());
  if (output.contract !== expected.contract) return (reasons.push(`contract: expected ${expected.contract}, got ${String(output.contract)}`), done());

  if (expected.contract === "review") {
    if (!Array.isArray(output.findings)) return (reasons.push("malformed: findings is not an array"), done());
    const used = new Set();
    for (const e of expected.expected ?? []) {
      const idx = output.findings.findIndex((f, j) => !used.has(j) && matchesEntry(f, e));
      if (idx < 0) {
        reasons.push(`unmatched: ${e.class} ${e.path}:${rangeText(e.lines)}`);
        continue;
      }
      used.add(idx);
      matched++;
      if (e.typed_citations_required === true && matching.typed_citations_required !== false && !hasSourceAndSink(output.findings[idx])) {
        reasons.push(`typed-citations: ${e.class} ${e.path}:${rangeText(e.lines)} lacks source and sink citations`);
      }
    }
    output.findings.forEach((f) => {
      if ((expected.forbidden ?? []).some((forb) => matchesEntry(f, forb))) reasons.push(`forbidden: ${String(f?.class)} ${String(f?.path)}:${rangeText(f?.lines)}`);
    });
    extra = output.findings.length - used.size;
    const maxExtra = Number.isInteger(expected.max_extra) ? expected.max_extra : 0;
    if (extra > maxExtra) reasons.push(`extra: ${extra} finding(s) beyond max_extra ${maxExtra}`);
    return done();
  }

  if (typeof output.assertion !== "string") return (reasons.push("malformed: assertion missing"), done());
  if (matching.assertion_exact !== false && output.assertion !== expected.expected_assertion) reasons.push(`assertion: expected ${expected.expected_assertion}, got ${output.assertion}`);
  return done();
}

/**
 * Score every case of `expected` against `outputs` (id → output). Cases in id order; sorted keys throughout.
 * @returns {{cases: object[], failed: number, passed: number, total: number}}
 */
export function scoreRun({ expected, outputs, matching = {} }) {
  const ids = Object.keys(expected.cases).sort();
  const cases = ids.map((id) => sorted({ ...scoreCase(expected.cases[id], outputs[id], matching), id }));
  const passed = cases.filter((c) => c.pass).length;
  return sorted({ cases, failed: cases.length - passed, passed, total: cases.length });
}

/** The stdout lines for a scoreRun result. */
export function render(result) {
  const lines = result.cases.map((c) => (c.pass ? `CASE ${c.id} PASS` : `CASE ${c.id} FAIL ${c.reasons.join("; ")}`));
  lines.push(`SCORE passed=${result.passed} failed=${result.failed} total=${result.total}`);
  return lines;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * CLI entry. `stdout` receives one string per call (lines joined by the caller).
 * @param {string[]} argv
 * @param {{skillDir?: string, stdout?: (s: string) => void}} options
 * @returns {Promise<number>} exit code
 */
export async function main(argv, { skillDir = DEFAULT_SKILL_DIR, stdout = (s) => process.stdout.write(`${s}\n`) } = {}) {
  const [command, ...rest] = argv;
  const usage = (msg) => (stdout(`USAGE(score-findings: ${msg})`), EXIT.USAGE);
  if (command === "digest") {
    if (rest.length > 0) return usage("digest takes no arguments");
    stdout(`prompt_sha256=${promptSha256(skillDir)}`);
    stdout(`fixture_revision=${fixtureRevision(skillDir)}`);
    return EXIT.OK;
  }
  if (command !== "score") return usage("expected `score <run-dir> [--json]` or `digest`");
  let runDir = null;
  let json = false;
  for (const a of rest) {
    if (a === "--json") json = true;
    else if (a.startsWith("-")) return usage(`unknown flag ${a}`);
    else if (runDir === null) runDir = resolve(a);
    else return usage("score takes one run directory");
  }
  if (runDir === null) return usage("score needs a run directory");
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) return usage(`${runDir} is not a directory`);
  const runFile = join(runDir, "run.json");
  if (!existsSync(runFile)) return usage(`${runFile} is missing`);

  const harness = readJson(join(skillDir, "evals", "harness.json"));
  const run = readJson(runFile);
  const recorded = isObject(run.harness) ? run.harness : {};
  const current = { prompt_sha256: promptSha256(skillDir), fixture_revision: fixtureRevision(skillDir), model_id: harness.model_id };
  for (const field of PINNED) {
    if (recorded[field] !== harness[field] || harness[field] !== current[field]) {
      stdout(`HARNESS-DRIFT(${field})`);
      return EXIT.DRIFT;
    }
  }

  const expected = readJson(join(skillDir, "evals", "expected-verdicts.json"));
  const outputs = {};
  for (const id of Object.keys(expected.cases)) {
    const file = join(runDir, `${id}.output.json`);
    if (!existsSync(file)) continue;
    try {
      outputs[id] = readJson(file);
    } catch {
      outputs[id] = { __malformed: true };
    }
  }
  const result = scoreRun({ expected, outputs, matching: harness.matching ?? {} });
  if (json) stdout(JSON.stringify(result, null, 2));
  else for (const line of render(result)) stdout(line);
  return result.failed === 0 ? EXIT.OK : EXIT.FAIL;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
