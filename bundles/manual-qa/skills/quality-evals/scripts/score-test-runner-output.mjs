#!/usr/bin/env node
// Deterministic scoring for the test-runner detection-accuracy eval track.
// Unlike the authoring track (Tier A + a judged Tier B), detection has one
// tier: did test-runner report the RIGHT verdict on each case, per a ground
// truth that already knows which cases are healthy, disclosed-known-issue,
// or a blind seeded/real bug. There's nothing to "judge" qualitatively here
// — a case either matched the expected result or it didn't — see
// ../README.md "Detection track" for the full bug_mode taxonomy and why a
// blind-detection miss (a false negative) is the one number that matters
// most.
//
// This script does NOT assume any particular repo layout. Point it at a run
// directory containing one JSON result file per case (test-runner's own
// output — see bundles/manual-qa/agents/test-runner/AGENT.md "Output
// Format": {"tc_id": "...", "result": "PASS"|"FAIL"|"BLOCKED", ...}) and a
// ground-truth file for the suite under test.
//
// Usage:
//   node score-test-runner-output.mjs <run-dir> --suite <suite-name> [options]
//   e.g. node score-test-runner-output.mjs quality-evals/detection-track/runs/RUN-DETECT-2026-09-01-001 --suite widgetize-cart
//
// Options:
//   --suite <name>          Required. Key into the ground-truth file's per-suite map.
//   --ground-truth <path>   Path to ground-truth.json (default: <run-dir>/../../ground-truth.json)
//   --out-dir <path>        Where to write score reports (default: <run-dir>/../../reports)
//
// Expects <run-dir>/results/*.json — one file per case, each the literal
// JSON block test-runner emits at the end of its run (only "tc_id" and
// "result" are read; everything else is ignored).
//
// Writes: <out-dir>/<run-id>.json
//         Appends to <out-dir>/all-runs.jsonl
//
// Ground truth ("what SHOULD test-runner have reported for this case") is
// read only by this script and must NEVER be shown to test-runner (or to
// whoever authors the suite's cases) before the run — see ../README.md
// "Isolation rules".

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUG_MODES = ['scripted-known-good', 'scripted-known-bug', 'blind-detection'];

// --- Pure helpers (exported for unit testing) ------------------------------

// Grades one case: did the actual reported result match what ground truth
// says it should be. `actual` is `null` when test-runner produced no result
// for this case at all (e.g. the run crashed before reaching it) — treated
// as "missing", distinct from and never silently folded into a pass/fail.
export function gradeCase(caseId, gt, actual) {
  if (!gt) {
    return { tc_id: caseId, error: 'no ground-truth entry for this case', bug_mode: null, expected_result: null, actual_result: actual?.result ?? null };
  }
  const expected = gt.expected_result;
  const actualResult = actual?.result ?? null;

  if (actualResult == null) {
    return {
      tc_id: caseId,
      bug_mode: gt.bug_mode ?? null,
      expected_result: expected,
      actual_result: null,
      missing: true,
      correct: false,
      false_negative: false,
      false_positive: false,
    };
  }

  const correct = actualResult === expected;
  // False negative: a case whose ground truth says the run should FAIL
  // (a seeded or real bug should have been caught) but test-runner reported
  // PASS — a missed defect, the single most important failure mode this
  // track exists to catch, independent of bug_mode.
  const falseNegative = expected === 'FAIL' && actualResult === 'PASS';
  // False positive: the mirror case — a healthy/expected-PASS case reported
  // as FAIL, a noisy result that erodes trust in the suite.
  const falsePositive = expected === 'PASS' && actualResult === 'FAIL';

  return {
    tc_id: caseId,
    bug_mode: gt.bug_mode ?? null,
    expected_result: expected,
    actual_result: actualResult,
    missing: false,
    correct,
    false_negative: falseNegative,
    false_positive: falsePositive,
  };
}

export function summarize(graded) {
  const applicable = graded.filter(g => !g.error);
  const total = applicable.length;
  const correct = applicable.filter(g => g.correct).length;
  const missing = applicable.filter(g => g.missing).length;
  const falseNegatives = applicable.filter(g => g.false_negative).length;
  const falsePositives = applicable.filter(g => g.false_positive).length;

  const blind = applicable.filter(g => g.bug_mode === 'blind-detection');
  const blindCorrect = blind.filter(g => g.correct).length;

  return {
    total_cases: total,
    scored_cases: total,
    correct,
    detection_accuracy_pct: total ? Math.round((correct / total) * 1000) / 10 : null,
    missing_results: missing,
    false_negatives: falseNegatives,
    false_positives: falsePositives,
    blind_detection_case_count: blind.length,
    blind_detection_accuracy_pct: blind.length ? Math.round((blindCorrect / blind.length) * 1000) / 10 : null,
    errors: graded.filter(g => g.error).map(g => ({ tc_id: g.tc_id, error: g.error })),
  };
}

// --- CLI ---------------------------------------------------------------

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--suite') { opts.suite = argv[++i]; continue; }
    if (a === '--ground-truth') { opts.groundTruth = argv[++i]; continue; }
    if (a === '--out-dir') { opts.outDir = argv[++i]; continue; }
    positional.push(a);
  }
  return { positional, opts };
}

function main(argv = process.argv.slice(2)) {
  const { positional, opts } = parseArgs(argv);
  const [runDirArg] = positional;
  if (!runDirArg || !opts.suite) {
    console.error('Usage: node score-test-runner-output.mjs <run-dir> --suite <suite-name> [--ground-truth <path>] [--out-dir <path>]');
    process.exitCode = 1;
    return;
  }

  const runDir = resolve(runDirArg);
  const resultsDir = join(runDir, 'results');
  const runId = basename(runDir);

  const evalRoot = dirname(dirname(runDir));
  const groundTruthPath = opts.groundTruth ? resolve(opts.groundTruth) : join(evalRoot, 'ground-truth.json');
  const outDir = opts.outDir ? resolve(opts.outDir) : join(evalRoot, 'reports');

  if (!existsSync(resultsDir)) {
    console.error(`[score-test-runner-output] no results/ directory found under ${runDir}`);
    process.exitCode = 1;
    return;
  }

  const allGroundTruth = existsSync(groundTruthPath) ? readJsonSafe(groundTruthPath) : {};
  const suiteGroundTruth = allGroundTruth[opts.suite];
  if (!suiteGroundTruth) {
    console.error(`[score-test-runner-output] no ground-truth entry for suite "${opts.suite}" in ${groundTruthPath}`);
    process.exitCode = 1;
    return;
  }

  const resultFiles = readdirSync(resultsDir).filter(f => f.endsWith('.json'));
  const actualByTcId = {};
  for (const f of resultFiles) {
    const parsed = readJsonSafe(join(resultsDir, f));
    if (parsed && parsed.tc_id) actualByTcId[parsed.tc_id] = parsed;
  }

  const caseIds = Object.keys(suiteGroundTruth);
  const graded = caseIds.map(caseId => gradeCase(caseId, suiteGroundTruth[caseId], actualByTcId[caseId] ?? null));
  const summary = summarize(graded);

  const output = {
    run_id: runId,
    track: 'detection',
    suite: opts.suite,
    date: new Date().toISOString(),
    cases: graded,
    summary,
  };

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${runId}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`[score-test-runner-output] wrote ${outPath}`);

  const ledgerPath = join(outDir, 'all-runs.jsonl');
  appendFileSync(ledgerPath, JSON.stringify(output) + '\n');
  console.log(`[score-test-runner-output] appended to ${ledgerPath}`);

  console.log(`\nRun: ${runId}  Suite: ${opts.suite}`);
  console.log(`Detection accuracy: ${summary.detection_accuracy_pct ?? 'n/a'}% (${summary.correct}/${summary.total_cases})`);
  console.log(`Blind-detection accuracy: ${summary.blind_detection_accuracy_pct ?? 'n/a'}% (${summary.blind_detection_case_count} blind case(s))`);
  if (summary.false_negatives) {
    console.log(`⚠ ${summary.false_negatives} false negative(s) — a seeded/real bug was missed and reported PASS. This is the failure mode this track exists to catch.`);
  }
  if (summary.false_positives) {
    console.log(`⚠ ${summary.false_positives} false positive(s) — a healthy case was reported FAIL.`);
  }
  if (summary.missing_results) {
    console.log(`⚠ ${summary.missing_results} case(s) have no result at all — check the run for a crash/incomplete pass.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
