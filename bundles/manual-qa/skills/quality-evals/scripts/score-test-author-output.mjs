#!/usr/bin/env node
// Tier A (deterministic) scoring for the test-author authoring-fidelity
// eval track. Structural checks only — frontmatter completeness, a
// well-formed Steps table, placeholder discipline, teardown judgment,
// selector reuse, and a possible-gold-leak overlap check. The judged half
// (semantic fidelity, hallucination, behavior-split quality, ...) is a
// separate, human/LLM-judge pass — see ../references/judge-rubric.md.
//
// This script deliberately does NOT assume any particular repo layout
// beyond the eval's own <run-dir>/output/<case-id>/ convention. Point it at
// a run directory and, optionally, an explicit ground-truth path; by
// default it looks for ground-truth.json two levels up from the run
// directory (i.e. <eval-root>/runs/<run-id> -> <eval-root>/ground-truth.json),
// matching the layout documented in ../README.md, but any layout works as
// long as you pass --ground-truth explicitly.
//
// Usage:
//   node score-test-author-output.mjs <run-dir> [options]
//   e.g. node score-test-author-output.mjs quality-evals/authoring-track/runs/RUN-2026-09-01-001
//
// Options:
//   --ground-truth <path>   Path to ground-truth.json (default: <run-dir>/../../ground-truth.json)
//   --out-dir <path>        Where to write score reports (default: <run-dir>/../../reports)
//
// Expects <run-dir>/output/<case-id>/ to contain the TC-*.md file(s)
// test-author actually produced for that case (one subfolder per eval case,
// so a multi-file behavior-split is representable).
//
// Writes: <out-dir>/<run-id>.json
//         Appends to <out-dir>/all-runs.jsonl
//
// Ground truth ("what should this eval case's produced TC.md look like") is
// read only by this script and must NEVER be shown to test-author itself —
// same secrecy principle as any held-out answer key. See ../README.md
// "Isolation rules" before running a real eval case.

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// --- Pure helpers (exported for unit testing) ------------------------------

const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const VALID_TYPES = ['functional', 'regression', 'smoke', 'integration', 'exploratory'];

export function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fm[kv[1].trim()] = kv[2].trim();
  }
  return fm;
}

// Grabs everything under "## <heading>" up to the next "## " heading or EOF.
// Line-based on purpose: a lookahead-based regex using `\Z` as an
// end-of-string anchor is WRONG in JavaScript — JS regex has no `\Z` anchor,
// so it matches a literal "z"/"Z" character instead, silently truncating any
// section whose body happens to contain one (e.g. "sizes", "freshly").
// Line-based splitting avoids the whole class of bug.
export function extractSection(content, heading) {
  const lines = content.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${heading}\\s*$`, 'i');
  const anyHeadingRe = /^##\s+/;
  const startIdx = lines.findIndex(l => headingRe.test(l.trim()));
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (anyHeadingRe.test(lines[i].trim())) { endIdx = i; break; }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim();
}

// Splits a Markdown table row on '|' cell delimiters while respecting a
// backslash-escaped '\|' as a LITERAL pipe character, not a delimiter — real
// Markdown table parsers do the same. Needed because a legitimate ARIA
// role/name selector (e.g. `role=link[name="All"|"Active"|"Completed"]`) can
// contain escaped pipes inside a cell; a naive `.split('|')` over-splits
// those, making a well-formed row look malformed.
export function splitTableRow(row) {
  const PLACEHOLDER = 'PIPE_PLACEHOLDER_TOKEN';
  return row
    .split('\\|').join(PLACEHOLDER)
    .split('|')
    .map(c => c.trim().split(PLACEHOLDER).join('|'));
}

export function wordNGrams(text, n = 5) {
  const words = text.toLowerCase().replace(/[`*_#|]/g, ' ').split(/\s+/).filter(Boolean);
  const grams = new Set();
  for (let i = 0; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(' '));
  return grams;
}

export function jaccardOverlap(a, b) {
  const ga = wordNGrams(a);
  const gb = wordNGrams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  return union ? inter / union : 0;
}

export function stepsWellFormedCheck(stepsSection) {
  const stepsRows = stepsSection
    ? stepsSection.split(/\r?\n/).filter(l => l.trim().startsWith('|'))
    : [];
  // Expect a header row + separator row + >=1 data row, each with 3
  // non-empty cells (# | Action | Expected Result).
  return stepsRows.length >= 3 && stepsRows.slice(2).every(row => {
    const cells = splitTableRow(row).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    return cells.length === 3 && cells.every(c => c.length > 0);
  });
}

// Scores a single produced TC-*.md file's structural conformance. Pure
// function of file content + the ground-truth entry — no filesystem access,
// so it's directly unit-testable.
export function scoreFileContent(content, gt) {
  const fm = parseFrontmatter(content);

  const frontmatterComplete = Boolean(
    fm && fm.id && fm.title && fm.priority && fm.type && fm.module &&
    VALID_PRIORITIES.includes(fm.priority) && VALID_TYPES.includes(fm.type)
  );

  const hasPlaceholder = /\{\{base_url\}\}/.test(content);
  // Legitimate convention: "`{{base_url}}` (`https://real.host/...`)" — a
  // literal URL in parens immediately after the placeholder, for human
  // readability. That is NOT a hardcoded-domain violation (navigation still
  // uses the placeholder); strip that pattern before checking for a stray
  // real domain elsewhere.
  const withoutGloss = content.replace(/\{\{base_url\}\}[^\n]{0,10}\(`?https?:\/\/[^)]+\)/g, '{{base_url}}');
  const realDomainMatch = withoutGloss.match(/https?:\/\/(?!\{\{base_url\}\})[a-z0-9.-]+\.[a-z]{2,}/i);
  const baseUrlOk = gt.must_use_placeholder ? (hasPlaceholder && !realDomainMatch) : true;

  const stepsSection = extractSection(content, 'Steps');
  const stepsWellFormed = stepsWellFormedCheck(stepsSection);

  const preconditions = extractSection(content, 'Preconditions');
  const preconditionsPresent = Boolean(preconditions) && preconditions.split(/\r?\n/).some(l => /^[-*]\s+\S/.test(l.trim()));

  const expectedFinalState = extractSection(content, 'Expected Final State');
  const expectedFinalStatePresent = Boolean(expectedFinalState && expectedFinalState.length > 0);

  const teardown = extractSection(content, 'Teardown');
  const teardownMeaningful = Boolean(
    teardown && teardown.split(/\r?\n/).some(l => /^[-*]\s+\S/.test(l.trim()) && !/^[-*]\s*none\b/i.test(l.trim()))
  );
  const teardownCorrect = gt.expected_teardown == null ? null : teardownMeaningful === gt.expected_teardown;

  let selectorReuse = null;
  if (Array.isArray(gt.known_selectors) && gt.known_selectors.length) {
    const hits = gt.known_selectors.filter(sel => content.includes(sel));
    selectorReuse = { hits: hits.length, of: gt.known_selectors.length, pass: hits.length >= 1 };
  }

  return {
    frontmatter_complete: frontmatterComplete,
    base_url_used_correctly: baseUrlOk,
    steps_table_well_formed: stepsWellFormed,
    preconditions_present: preconditionsPresent,
    expected_final_state_present: expectedFinalStatePresent,
    teardown_correct: teardownCorrect,
    selector_reuse: selectorReuse,
    _steps_section: stepsSection ?? '',
  };
}

// Resolves the best-matching gold file (by Steps-section Jaccard overlap)
// for a produced file's Steps section, given ground truth's gold_path
// (singular) or gold_paths (array — multi-scenario "acceptance-criteria"
// input mode, where a produced file's counterpart isn't known by filename
// in advance). `readGold(goldPath)` is injected so this stays filesystem-free
// for unit tests.
export function possibleGoldLeakCheck(stepsSection, gt, evalRoot, readGold) {
  const goldPaths = Array.isArray(gt.gold_paths) ? gt.gold_paths
    : (gt.gold_path ? [gt.gold_path] : []);
  if (!goldPaths.length) return null;

  let best = { overlap_ratio: 0, gold_path: null };
  for (const gp of goldPaths) {
    const goldContent = readGold(gp, evalRoot);
    if (goldContent == null) continue;
    const goldSteps = extractSection(goldContent, 'Steps') ?? '';
    const overlap = jaccardOverlap(stepsSection ?? '', goldSteps);
    if (overlap > best.overlap_ratio) best = { overlap_ratio: overlap, gold_path: gp };
  }
  return {
    overlap_ratio: Math.round(best.overlap_ratio * 1000) / 1000,
    best_match_gold_path: best.gold_path,
    // A near-verbatim match to gold is suspicious precisely BECAUSE
    // test-author must never see gold/ — see README "Isolation rules".
    flagged: best.overlap_ratio > 0.6,
  };
}

// Scores one eval case: every produced TC-*.md file under
// <outputDir>/<caseId>/, rolled up into a single deterministic_pass_pct.
// `readGold` is injected (filesystem access lives at the CLI boundary only).
export function scoreCase(caseId, gt, files, fileContents, evalRoot, readGold) {
  if (!files) {
    return { case_id: caseId, error: 'no output found for this case', checks: {}, deterministic_pass_pct: null };
  }
  if (!files.length) {
    return { case_id: caseId, error: 'output dir exists but no TC-*.md files found', checks: {}, deterministic_pass_pct: null };
  }

  const checks = {};
  checks.behavior_count_match = {
    pass: gt.expected_behavior_count == null ? null : files.length === gt.expected_behavior_count,
    expected: gt.expected_behavior_count ?? null,
    actual: files.length,
  };

  const perFile = files.map(f => {
    const content = fileContents[f];
    const scored = scoreFileContent(content, gt);
    const possibleGoldLeak = possibleGoldLeakCheck(scored._steps_section, gt, evalRoot, readGold);
    const { _steps_section, ...rest } = scored;
    return { file: f, ...rest, possible_gold_leak: possibleGoldLeak };
  });

  checks.per_file = perFile;

  // Roll up into pass/fail booleans across the applicable checks: count
  // applicable (non-null) checks, count how many passed, across ALL files
  // for this case — a split into N files where one is malformed should not
  // average away as "mostly fine".
  const boolChecks = [];
  for (const pf of perFile) {
    boolChecks.push(pf.frontmatter_complete, pf.base_url_used_correctly, pf.steps_table_well_formed,
      pf.preconditions_present, pf.expected_final_state_present);
    if (pf.teardown_correct != null) boolChecks.push(pf.teardown_correct);
    if (pf.selector_reuse) boolChecks.push(pf.selector_reuse.pass);
  }
  if (checks.behavior_count_match.pass != null) boolChecks.push(checks.behavior_count_match.pass);

  const applicable = boolChecks.filter(v => v != null);
  const passed = applicable.filter(Boolean).length;
  const deterministicPassPct = applicable.length ? Math.round((passed / applicable.length) * 1000) / 10 : null;

  const anyGoldLeakFlagged = perFile.some(pf => pf.possible_gold_leak?.flagged);

  return {
    case_id: caseId,
    checks,
    deterministic_pass_pct: deterministicPassPct,
    possible_gold_leak_flagged: anyGoldLeakFlagged,
  };
}

// --- CLI ---------------------------------------------------------------

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function loadGroundTruth(path) {
  if (!existsSync(path)) return {};
  const raw = readJsonSafe(path);
  delete raw._comment;
  return raw;
}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ground-truth') { opts.groundTruth = argv[++i]; continue; }
    if (a === '--out-dir') { opts.outDir = argv[++i]; continue; }
    positional.push(a);
  }
  return { positional, opts };
}

function main(argv = process.argv.slice(2)) {
  const { positional, opts } = parseArgs(argv);
  const [runDirArg] = positional;
  if (!runDirArg) {
    console.error('Usage: node score-test-author-output.mjs <run-dir> [--ground-truth <path>] [--out-dir <path>]');
    process.exitCode = 1;
    return;
  }

  const runDir = resolve(runDirArg);
  const outputDir = join(runDir, 'output');
  const runId = basename(runDir);

  // Default layout: <eval-root>/runs/<run-id> -> ground truth + reports live
  // two levels up, sibling of "runs/".
  const evalRoot = dirname(dirname(runDir));
  const groundTruthPath = opts.groundTruth ? resolve(opts.groundTruth) : join(evalRoot, 'ground-truth.json');
  const outDir = opts.outDir ? resolve(opts.outDir) : join(evalRoot, 'reports');

  if (!existsSync(outputDir)) {
    console.error(`[score-test-author-output] no output/ directory found under ${runDir}`);
    process.exitCode = 1;
    return;
  }

  const groundTruth = loadGroundTruth(groundTruthPath);
  if (!Object.keys(groundTruth).length) {
    console.error(`[score-test-author-output] warning: no ground-truth entries loaded from ${groundTruthPath} — every case will score as "no output found"/"n/a"`);
  }

  function readGold(goldPath) {
    const p = resolve(evalRoot, goldPath);
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8');
  }

  const caseIds = Object.keys(groundTruth);
  const results = caseIds.map(caseId => {
    const gt = groundTruth[caseId];
    const caseOutputDir = join(outputDir, caseId);
    if (!existsSync(caseOutputDir)) return scoreCase(caseId, gt, null, {}, evalRoot, readGold);
    const files = readdirSync(caseOutputDir).filter(f => /^TC-\d+.*\.md$/.test(f));
    const fileContents = Object.fromEntries(files.map(f => [f, readFileSync(join(caseOutputDir, f), 'utf8')]));
    return scoreCase(caseId, gt, files, fileContents, evalRoot, readGold);
  });

  const scored = results.filter(r => r.deterministic_pass_pct != null);
  const avgDeterministicPassPct = scored.length
    ? Math.round((scored.reduce((s, r) => s + r.deterministic_pass_pct, 0) / scored.length) * 10) / 10
    : null;
  const anyGoldLeak = results.filter(r => r.possible_gold_leak_flagged).map(r => r.case_id);

  const output = {
    run_id: runId,
    track: 'authoring',
    date: new Date().toISOString(),
    cases: results,
    summary: {
      total_cases: caseIds.length,
      scored_cases: scored.length,
      avg_deterministic_pass_pct: avgDeterministicPassPct,
      cases_with_possible_gold_leak: anyGoldLeak,
    },
  };

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${runId}.json`);
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`[score-test-author-output] wrote ${outPath}`);

  const ledgerPath = join(outDir, 'all-runs.jsonl');
  appendFileSync(ledgerPath, JSON.stringify(output) + '\n');
  console.log(`[score-test-author-output] appended to ${ledgerPath}`);

  console.log(`\nRun: ${runId}`);
  console.log(`Scored ${scored.length}/${caseIds.length} cases. Avg deterministic_pass_pct: ${avgDeterministicPassPct ?? 'n/a'}`);
  if (anyGoldLeak.length) {
    console.log(`⚠ possible_gold_leak flagged on: ${anyGoldLeak.join(', ')} — review manually before trusting this case's score.`);
  }
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.case_id}: ERROR — ${r.error}`);
    } else {
      console.log(`  ${r.case_id}: ${r.deterministic_pass_pct}%${r.possible_gold_leak_flagged ? '  ⚠ possible_gold_leak' : ''}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
