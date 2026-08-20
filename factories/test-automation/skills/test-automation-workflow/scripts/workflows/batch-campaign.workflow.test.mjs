import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runtime-wrapped script — same testing constraints as batch-build (see its
// test file): parse under the runtime's async wrapping + design invariants.

const FILE = fileURLToPath(new URL('./batch-campaign.workflow.mjs', import.meta.url));
const text = readFileSync(FILE, 'utf8');

test('campaign conductor parses under the runtime async-function wrapping', () => {
  const body = text.replace(/^export const meta =/m, 'const meta =');
  new Function(
    'agent', 'pipeline', 'parallel', 'phase', 'log', 'budget', 'args', 'workflow',
    `"use strict"; return (async () => {\n${body}\n})`
  );
});

test('meta: canonical name and the four stages', () => {
  assert.match(text, /name: 'ta-batch-campaign'/);
  for (const ph of ['Plan', 'Heads', 'Foundation', 'Waves']) {
    assert.ok(text.includes(`title: '${ph}'`), `missing phase ${ph}`);
  }
});

test('lean-lead invariants: planner reads snapshots, lead reviews plans not bodies', () => {
  assert.match(text, /stage: 'plan-proposal'/); // early return for the operator checkpoint
  assert.match(text, /cases\/\$\{id\}\.md/);   // snapshots read from disk, no TMS round-trips // planner reads intake snapshots from disk
  assert.match(text, /do not fetch any TMS/); // planner never round-trips
  assert.match(text, /never case bodies|never reads case\s+\/\/ bodies|never read/i);
  assert.match(text, /rationale/); // the operator-facing why travels with the plan
});

test('human-owned moments stay outside: heads → foundation early-return, rolling wave gates', () => {
  assert.match(text, /analyzeOnly: true/); // heads pass sources the foundation inventory
  assert.match(text, /headsAnalyzed/); // carried across the checkpoint
  assert.match(text, /foundationMerged/);
  assert.match(text, /re-invoke this workflow with \{ plan, foundationMerged: true/);
  assert.match(text, /gate \$\{report\?\.gate\?\.verdict/);   // each wave gates itself and reports
  assert.doesNotMatch(text, /npx playwright|npm test|gate-green/); // conductor runs nothing, flips nothing
});

// The foundation used to get ONE static review and hand a CHANGES_REQUESTED
// straight back to the lead — while every case build got a fix loop. That is
// backwards: every wave is built on the foundation, so shipping it
// half-reviewed propagates into every case that follows.
test('the foundation gets a fix loop, on the same contract as a case build', () => {
  assert.match(text, /function loopVerdict/);
  assert.match(text, /'unaddressed', 'persists', 'external'/);
  assert.match(text, /if \(unaddressed\.length\) return \{ go: true/);
  assert.match(text, /while \(rev && rev\.verdict === 'CHANGES_REQUESTED'/);
  assert.match(text, /fix:foundation:\$\{round\}/);
  assert.match(text, /THE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND/);
  assert.match(text, /FIX_ROUNDS = A\.fixRounds \?\? 8/);
  assert.match(text, /RUNAWAY BACKSTOP, not a quality\s*\/\/ budget/);
});

// Every wave inherits this branch, so an unproven foundation turns one flaky
// helper into a red in every wave — and the wave gate would blame the case.
test('the foundation proves itself with a mini-gate before any wave builds on it', () => {
  assert.match(text, /phase\('Mini-gate'\)/);
  assert.match(text, /GATE_N = A\.gateN \?\? 3/);
  assert.match(text, /CONSECUTIVE deterministic green/);
  assert.match(text, /A red anywhere ENDS the attempt/);
  // the gate proves and never fixes, and is not the agent that built
  assert.match(text, /you do not fix it — you PROVE it/);
  assert.match(text, /Do NOT merge\. Do NOT fix\./);
  // an ungated foundation must not be reported as mergeable
  assert.match(text, /status: gate\?\.verdict === 'green' \? 'ready-to-merge' : 'gate-red'/);
});

// Merging stays the lead's call under the PR policy — the loop and the gate
// remove the manual round-trip, they do not take the decision.
test('the foundation return still hands the merge decision to the lead', () => {
  assert.match(text, /Merge \$\{built\.branch\} to \$\{plan\.base\} per \.agents\/profile\.md/);
  assert.match(text, /re-invoke this workflow with \{ plan, foundationMerged: true/);
  assert.doesNotMatch(text, /git merge|gh pr merge/);
});

test('extend cross-check: planner pre-marks, conductor reports divergence + flags', () => {
  assert.match(text, /extendCandidates/);
  assert.match(text, /do not tell the analysts/); // independence of the two judgments
  assert.match(text, /extend_divergence/);
  assert.match(text, /analyst_only/);
  assert.match(text, /planner_only/);
  assert.match(text, /quality_flags/);
});

test('nesting + resilience: child workflows per wave, campaign survives a failed wave', () => {
  // A wave is ONE call now: the build child integrates and gates internally and
  // returns one report, so the conductor holds no in-between state.
  assert.match(text, /await workflow\(\{ scriptPath: BUILD \}/);
  assert.doesNotMatch(text, /scriptPath: INTEG/);
  assert.match(text, /report\?\.gate\?\.verdict/);
  assert.match(text, /report_path/);
  assert.match(text, /preAnalyzed/); // heads not re-analyzed in waves
  assert.ok(text.includes('integrationBranch: `tests/batch-${w.slug}`')); // per-wave branches
  assert.match(text, /campaign continues with the next wave/);
  assert.doesNotMatch(text, /isolation: 'worktree'/); // foundation is a lone sequential build — one tree, no worktree
  assert.doesNotMatch(text, /boardScripts|set-status|automation-board\/batches/); // no board
  assert.match(text, /typeof args === 'string' \? JSON\.parse\(args\)/);
  assert.doesNotMatch(text, /Date\.now|Math\.random|new Date\(\)/);
});

// A planner that asserts "foundation-rich" without listing the directories is
// guessing. One did exactly that for four surfaces holding zero page objects,
// caught only because the lead ran `ls` before approving the plan.
test('foundation claims carry evidence, and never collide with another live campaign', () => {
  assert.match(text, /required: \['surfaces', 'evidence'\]/);
  assert.match(text, /CHECK, DO NOT ASSUME/);
  assert.match(text, /actually list the page-object directory/);
  // One foundation owner per surface, per board.
  assert.match(text, /campaigns\/\*\.md/);
  assert.match(text, /another live campaign already claims/);
});

test('a declared goal is re-measured at every wave gate, not at campaign end', () => {
  assert.match(text, /goal: \{/); // plan schema carries it
  assert.match(text, /required: \['metric', 'command', 'baseline'\]/);
  assert.match(text, /RE-MEASURE THE GOAL/);
  assert.match(text, /blind from there on/); // why it is per-gate
});

// The heads child is a full batch-build invocation: without base it throws its
// args error and the whole campaign dies in Phase Heads (field bug). And every
// child needs its own report dir — waves share the batch slug, so a shared
// default path would overwrite report.json wave after wave.
test('heads and wave children carry base and their own report dirs', () => {
  assert.match(text, /base: plan\.base,[^]*?analyzeOnly: true/);
  assert.ok(text.includes('reportDir: `.agents/automation/${plan.batch}/heads`'));
  assert.ok(text.includes('reportDir: `.agents/automation/${plan.batch}/${w.slug}`'));
});

// Under per-batch landing the next wave cuts its trunk from BASE, so this wave
// must already be on base — and landing is the lead's. Rolling straight on
// would make the conductor's own promise ("cuts from an updated base") false.
test('per-batch landing returns between waves; campaign-end rolls on', () => {
  assert.match(text, /const LANDING = \(plan\.policy \?\? \{\}\)\.landing \?\? 'per-batch'/);
  assert.match(text, /stage: 'wave-landed'/);
  assert.match(text, /LANDING === 'per-batch' && remaining\.length/);
  // Re-invocation must be able to skip what already landed.
  assert.match(text, /const landedWaves = Array\.isArray\(A\.landedWaves\)/);
  assert.match(text, /plan\.waves\.filter\(\(w\) => !landedWaves\.includes\(w\?\.slug\)\)/);
  assert.match(text, /landedWaves: \$\{JSON\.stringify\(\[\.\.\.landedWaves, w\.slug\]\)\}/);
});

// A wave whose gate never ran is not 'nothing-landed' — its merged-ungated
// units sit on the trunk, unproven. Field measurement: a mid-gate crash
// reported nothing-landed/blocked:14 while 13 of 14 units were merged; the
// conductor must say "re-run the gate", never "nothing happened".
test("an interrupted wave surfaces as 'ungated', never 'nothing-landed'", () => {
  assert.match(text, /report\?\.totals\?\.\['merged-ungated'\] \? 'ungated'/);
  assert.match(text, /report_written: report\?\.report_written \?\? false/);
  assert.match(text, /thisWave\?\.status === 'ungated'/);
  assert.match(text, /unproven, NOT blocked/);
  assert.match(text, /never from this summary alone/);
});
