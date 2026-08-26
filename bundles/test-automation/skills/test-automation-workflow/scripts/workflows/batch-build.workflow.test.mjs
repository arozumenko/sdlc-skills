import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// The workflow script runs only inside Claude Code's Workflow runtime, which
// wraps the body in an async function and provides agent/pipeline/parallel/
// phase/log/budget/args/workflow as globals — so top-level `return`/`await`
// are legal there but not in bare ESM, and the file can't be imported here.
// These tests guard what CI can check: the body parses under the runtime's
// wrapping, and the design invariants the script documents.

const FILE = fileURLToPath(new URL('./batch-build.workflow.mjs', import.meta.url));
const text = readFileSync(FILE, 'utf8');

test('workflow script parses under the runtime async-function wrapping', () => {
  const body = text.replace(/^export const meta =/m, 'const meta =');
  // Constructing the function parses the body without executing it.
  new Function(
    'agent', 'pipeline', 'parallel', 'phase', 'log', 'budget', 'args', 'workflow',
    `"use strict"; return (async () => {\n${body}\n})`
  );
});

test('meta: canonical name and the five phases of one end-to-end batch', () => {
  assert.match(text, /export const meta = \{/);
  assert.match(text, /name: 'ta-batch-build'/);
  // No 'Integrate' phase: units merge into the trunk as they finish, so
  // integration is continuous rather than a stage at the end. No 'Analysis'
  // phase either: the analyst slot died with the AFS layer.
  for (const ph of ['Triage', 'Execution', 'Build', 'Gate', 'Report']) {
    assert.ok(text.includes(`title: '${ph}'`), `missing phase ${ph}`);
  }
  assert.ok(!text.includes("title: 'Integrate'"), 'integration is continuous, not a phase');
  assert.ok(!text.includes("title: 'Analysis'"), 'the analyst front is gone');
});

test('args robustness: stringified args are parsed', () => {
  assert.match(text, /typeof args === 'string' \? JSON\.parse\(args\)/);
});

test('design invariants: named agentTypes, no Date/Math.random', () => {
  assert.match(text, /agentType: TYPES\.implementer/);
  assert.match(text, /agentType: TYPES\.reviewer/);
  assert.match(text, /agentType: TYPES\.runner/);
  assert.match(text, /agentType: TYPES\.gate/);
  // Workflow runtime forbids these (they break resume) — keep them out.
  assert.doesNotMatch(text, /Date\.now|Math\.random|new Date\(\)/);
});

// ---- TA v2: the analyst slot, the AFS layer, and qa-engineer are GONE ------
// Two sources of truth remain: the case (never edited by TA) and the code,
// joined by the coverage contract. Anything that reintroduces the middle
// artifact is a regression.
test('no analyst, no qa-engineer, no AFS layer anywhere', () => {
  assert.doesNotMatch(text, /qa-engineer/);
  assert.doesNotMatch(text, /runAnalyst|ANALYST_SCHEMA|ANALYST_VERDICT|absorbAnalysis/);
  assert.doesNotMatch(text, /\bAFS\b|afs_path|family_afs/);
  assert.doesNotMatch(text, /test-specs\//);
  assert.doesNotMatch(text, /_surface\.md/);          // the old digest path
  assert.doesNotMatch(text, /spec-format/);
  assert.doesNotMatch(text, /lcovered_|lextend_/);
  assert.doesNotMatch(text, /already-covered|out-of-scope-by-author/);   // intake screening owns those now
  assert.match(text, /THE CASE IS THE SOURCE OF TRUTH and you never edit it/);
  assert.match(text, /there is no intermediate spec artifact/);
});

// The surface digest survives but MOVED: it is the TA working cache, one of
// the two repo artifacts this pipeline produces (the other is test code).
test('the surface cache lives at .agents/automation/surface/<feature>.md', () => {
  assert.match(text, /\.agents\/automation\/surface\/<feature>\.md/);
  assert.match(text, /goes BACK into the surface cache/);
  assert.match(text, /commit it on your branch with the code/);
});

// ---- triage v2: three routes, provider policy ------------------------------
test('route enum is exactly manual-qa-verified | needs-execution | combined', () => {
  assert.match(text, /enum: \['manual-qa-verified', 'needs-execution', 'combined'\]/);
  assert.doesNotMatch(text, /'analyst'/);             // the old route died
});

test('triage reads the seeded execution-provider policy and routes on it', () => {
  assert.match(text, /READ-ONLY routing decision/);
  assert.match(text, /§ Execution provider/);
  assert.match(text, /provider: \{ type: 'string', enum: \['manual-qa', 'self'\] \}/);
  // self → combined for everything; missing seed = self, the standalone default
  assert.match(text, /provider 'self' -> route EVERY unit 'combined'/);
  assert.match(text, /A missing file or [\s\S]{0,20}section means 'self'/);
  // manual-qa: PASS run + authored case file per case, or needs-execution
  assert.match(text, /run record with verdict PASS/);
  assert.match(text, /FAIL\/flaky\/blocked run never qualifies/);
  assert.match(text, /routes 'needs-execution'/);
  // the one forbidden answer, stated where the choice is made
  assert.match(text, /NEVER route a manual-qa project 'combined'/);
  assert.match(text, /model: A\.triageModel \?\? 'haiku', effort: 'low', schema: TRIAGE_SCHEMA/);
});

// A dead triage means the provider policy was never read — and there is no
// safe default route without it. The batch stops honestly instead of guessing.
// The sizing pass is the lead's intake step — the workflow can't run it (no
// fs access) but must not let its absence stay silent: triage attests the
// verdicts file, and a missing one lands a quality_flag in the report.
test('missing intake sizing is attested by triage and flagged in the report', () => {
  assert.match(text, /required: \['provider', 'base_url', 'sizing_present', 'units', 'notes'\]/);
  assert.match(text, /sizing_present: \{ type: 'boolean' \}/);
  assert.match(text, /return sizing_present accordingly; do not run the pass yourself/);
  assert.match(text, /SIZING_PRESENT = t\.sizing_present === true/);
  assert.match(text, /intake sizing\/screening pass not run — no \.agents\/estimation\//);
});

test('a dead triage stops the batch honestly: no routes, no silent default', () => {
  assert.match(text, /let DEFAULT_ROUTE = null/);
  assert.match(text, /DEFAULT_ROUTE = TRI\.provider === 'manual-qa' \? 'needs-execution' : 'combined'/);
  assert.match(text, /triage died — the execution-provider policy was never read/);
  assert.match(text, /for \(const unit of \(DEFAULT_ROUTE \? UNITS : \[\]\)\)/);
});

// Field case 2026-08-18 (my-qa-project demo): triage was shown the cluster
// "TC-001 + TC-002", chose a route CORRECTLY, and returned it as two per-case
// rows — the old exact-key guard silently dropped both. Routes are reassembled
// by case coverage: unanimous route across every member takes it; foreign ids
// do nothing; partials/disagreements stay on the provider default, loudly.
test('triage routes survive per-case row splits: coverage votes, unanimity, loud logs', () => {
  assert.match(text, /const unitOf = new Map\(\)/);
  assert.match(text, /const votes = new Map\(\)/);
  assert.match(text, /v\.size !== ids\.length\) continue/, 'partial coverage falls back to the provider default');
  assert.match(text, /routes\.size !== 1\) continue/, 'disagreeing members fall back to the provider default');
  assert.match(text, /naming no case in this batch — ignored/, 'hallucinated ids are logged, not silently eaten');
  assert.match(text, /reassembled by coverage \(unanimous route required\)/);
  // and the prompt forbids the split explicitly
  assert.match(text, /ONE entry with ids \["A","B"\], never two entries/);
});

// ---- needs-execution: manual-qa's test-runner, per case --------------------
test('the test-runner is dispatched per case with exactly their contract prompt', () => {
  // their contract, verbatim — one line, no preamble, no imposed schema
  assert.match(text, /`Execute the test case at \$\{SRC\(c\.id\)\} against base_url=\$\{BASE_URL\}`/);
  assert.match(text, /label: `execute:\$\{c\.id\}`, phase: 'Execution', agentType: TYPES\.runner/);
  assert.match(text, /runner: 'test-runner'/);
  // and the trailing json block is parsed, not schema-coerced
  assert.match(text, /parseRunnerReturn/);
  assert.match(text, /```json/);
});

test('runner verdicts map: PASS builds with evidence, FAIL files a defect, BLOCKED blocks', () => {
  assert.match(text, /v\.result === 'PASS'/);
  assert.match(text, /manual-qa test-runner, this batch/);            // evidence line cites the run
  assert.match(text, /v\.result === 'FAIL'/);
  assert.match(text, /outcome: 'defect-found'/);
  assert.match(text, /not automated until the product is fixed/);
  assert.match(text, /test-runner BLOCKED/);
  // FAIL → the engineer files per defect-filing and walks away
  assert.match(text, /defect-filing discipline \(test-automation-implementation references\/defect-filing\.md/);
  assert.match(text, /File and walk away/);
  assert.match(text, /schema: DEFECT_SCHEMA/);
});

// Policy says manual-qa executes — a missing runner NEVER silently falls back
// to self-execution. The case is honestly needs-execution and the report says
// to run the manual-qa suite.
test('an unavailable test-runner yields needs-execution, never silent self-execution', () => {
  assert.match(text, /RUNNER_GONE_NOTE/);
  assert.match(text, /self-execution against the policy is never the fallback/);
  assert.match(text, /Run the manual-qa suite over this case/);
  assert.match(text, /runnerGone = true/);
  assert.match(text, /outcome: 'needs-execution', note: RUNNER_GONE_NOTE/);
  // an unresolvable base_url stops the dispatch from being formed at all
  assert.match(text, /no base URL resolvable/);
  // the report flags the count and the remedy
  assert.match(text, /case\(s\) needs-execution/);
  assert.match(text, /Self-execution is never the fallback/);
});

// ---- combined doctrine: first green run IS the execution -------------------
test('combined route: no pre-execution ritual, live probing is an investigation tool', () => {
  assert.match(text, /the FIRST GREEN RUN of your test against the real system IS the case\\?'s first execution/);
  assert.match(text, /INVESTIGATION tool at your discretion/);
  assert.match(text, /never a full pre-automation walkthrough/);
});

test('the locator ladder is ordered cheapest-first and manual-qa knowledge is read-only', () => {
  assert.match(text, /LOCATOR LADDER \(cheapest first\)/);
  assert.match(text, /\(1\) the surface cache/);
  assert.match(text, /\(2\) manual-qa knowledge, READ-ONLY/);
  // app_profile.md sections are what manual-qa actually produces — the factory
  // never writes knowledge/selectors.md (cross-factory audit F1)
  assert.match(text, /app_profile\.md` § Reliable Selectors and § Fragile Areas/);
  assert.doesNotMatch(text, /knowledge\/selectors\.md/);
  assert.match(text, /\(3\) the case file itself; \(4\) targeted live probing/);
  assert.match(text, /reference their facts, never copy them/);
});

test('evidence-built units never re-execute; thin/broken evidence escapes honestly', () => {
  assert.match(text, /do NOT re-execute a case end-to-end in a browser/);
  assert.match(text, /re-buys what the evidence already paid for/);
  assert.match(text, /Cite the manual-qa run/);
  // mq-verified evidence that does not hold → needs-execution, never self-run
  assert.match(text, /return status needs-execution and STOP/);
  assert.match(text, /under the manual-qa provider you never execute the case yourself/);
});

test('the templating bridge is named: {{base_url}} maps to the seeded config var', () => {
  assert.match(text, /\{\{base_url\}\}/);
  assert.match(text, /§ Base URL mapping/);
  assert.match(text, /never hardcode the URL/);
});

// ---- coverage contract -----------------------------------------------------
test('IMPL/BUILD/REVIEW schemas carry coverage with the closed exclusion vocabulary', () => {
  assert.match(text, /const COVERAGE = \{/);
  assert.match(text, /required: \['full', 'excluded'\]/);
  assert.match(text, /\['covered-elsewhere', 'blocked-by-defect', 'un-automatable', 'by-seeded-policy'\]/);
  assert.match(text, /required: \['step', 'category', 'referent'\]/);
  // all three shapes carry it, required
  const required = [...text.matchAll(/required: \[[^\]]*'coverage'[^\]]*\]/g)];
  assert.ok(required.length >= 2, `coverage must be required on the build/fix and review schemas, found ${required.length}`);
  assert.match(text, /coverage: COVERAGE/);
});

test('the build prompt teaches the coverage grammar and forbids free-text reasons', () => {
  assert.match(text, /COVERAGE CONTRACT — every delivered spec carries the machine-findable comment block/);
  assert.match(text, /<case-id> coverage: steps <list>/);
  assert.match(text, /invalid grammar and block at review and gate/);
  assert.match(text, /case id appears in the test\\?'s identity/);
  assert.match(text, /§ Coverage idiom/);
  // the engineer cannot mint un-automatability past the intake screening
  assert.match(text, /cannot MINT un-automatable beyond what the intake screening judged/);
  assert.match(text, /request it with status needs-escalation/);
});

test('the reviewer walks the case step-by-step, touches referents, and cross-checks intake', () => {
  assert.match(text, /WALK EVERY CASE STEP against the diff/);
  assert.match(text, /A silent gap — a step neither asserted nor excluded — is CHANGES_REQUESTED/);
  assert.match(text, /TOUCH every referent, never take it on faith/);
  assert.match(text, /run the named test once/);
  assert.match(text, /open the filed defect/);
  assert.match(text, /read the policy line in \.agents\/testing\.md/);
  assert.match(text, /CROSS-CHECK THE INTAKE VERDICT/);
  assert.match(text, /-verdicts\.json/);
  assert.match(text, /never mint it/);
  // the reviewer returns coverage as verified, not as declared
  assert.match(text, /Return coverage as you VERIFIED it/);
});

// Reviewer independence = clean context + contract, not a different AGENT.md.
test('the reviewer slot is engineer-typed and loads code-review + the reviewer contract', () => {
  assert.match(text, /reviewer: 'test-automation-engineer'/);
  assert.match(text, /engineer-TYPED by design/);
  assert.match(text, /references\/reviewer-contract\.md/);
  assert.match(text, /load your code-review skill \(on-demand\)/);
});

test('the review panel lenses are correctness / honesty-of-coverage / maintainability', () => {
  assert.match(text, /'correctness \(/);
  assert.match(text, /'honesty of coverage \(/);
  assert.match(text, /'maintainability \(/);
});

// ---- outcomes --------------------------------------------------------------
test('the outcome vocabulary is the v2 closed set', () => {
  assert.match(text, /delivered \| defect-found \| blocked\n\/\/ \| un-automatable \| needs-execution \| infra-stalled \| not-started/);
  assert.match(text, /outcome: 'delivered'/);
  assert.doesNotMatch(text, /outcome: 'automated'/);
  assert.doesNotMatch(text, /merged-sanctioned-red/);   // a ticketed red-by-design is defect-found now
  // in-flight markers and merged-ungated are bookkeeping, documented as such
  assert.match(text, /in-flight markers \(`built`, `reviewed`\)/);
  assert.match(text, /`merged-ungated` for the one state the closed\n\/\/ set cannot say honestly/);
});

// One row per input case, saying where it ended — not a state machine.
test('outcomes: every input case gets exactly one row, defaulting to not-started', () => {
  assert.match(text, /for \(const c of CASES\) OUTCOME\[c\.id\] = \{ id: c\.id, outcome: 'not-started'/);
  assert.match(text, /const rows = CASES\.map\(\(c\) => \{ const \{ _findingKeys, _expectedRed, \.\.\.row \} = OUTCOME\[c\.id\]; return row \}\)/);
});

test('build-slot stops map to case outcomes, with escalation and evidence-failure named', () => {
  assert.match(text, /const IMPL_STOP = \{/);
  assert.match(text, /'un-automatable': 'un-automatable'/);
  assert.match(text, /'needs-execution': 'needs-execution'/);
  assert.match(text, /'needs-escalation': 'blocked'/);
  assert.match(text, /the lead confirms against the automation-scoping verdicts before accepting/);
});

// A case can finish AND still have something to say.
test('findings ride every worker return, orthogonal to the outcome', () => {
  assert.match(text, /const FINDINGS = \{/);
  assert.match(text, /'defect', 'clarification', 'question', 'note'/);
  assert.match(text, /addFindings/);
  assert.match(text, /did NOT stop you/);
  assert.match(text, /COMMIT WHAT YOU PRODUCE/);
});

// ---- the gate --------------------------------------------------------------
test('gate: its own agent, N consecutive, never merges/classifies/fixes', () => {
  assert.ok(text.includes("title: 'Gate'"));
  assert.match(text, /GATE_N/);
  assert.match(text, /CONSECUTIVE deterministic green runs/);
  assert.match(text, /A red anywhere ENDS the attempt/);
  assert.match(text, /Do NOT merge anything\. Do NOT classify/);
  assert.match(text, /gate-case\.mjs/);           // mechanics are scripted
  assert.match(text, /batch-stabilize/);          // where a red goes next
});

test('the gate runs the mechanical coverage check via --cases', () => {
  assert.match(text, /--cases \$\{merged\.flatMap\(\(r\) => r\.ids\)\.join\(','\)\}/);
  assert.match(text, /MECHANICAL COVERAGE CHECK/);
  assert.match(text, /\\?`coverage-invalid\\?` verdict is a RED for the batch/);
  assert.match(text, /do not burn \$\{GATE_N\} runs proving code whose coverage contract is broken/);
});

// The gate's own run shape. `--n 3` does all three runs in ONE process, which
// on a real UI batch exceeds the 600s ceiling a foreground call has — measured
// 2026-08-09: every gate that passed cleanly ran one run per call.
test('the gate dispatch pins one run per call, with the ceiling and the sleep-poll fallback', () => {
  const gate = text.slice(text.indexOf('Hardening gate for batch'));
  assert.match(gate.slice(0, 9000), /FIRST time one run: \\`--n 1\\`/);
  assert.match(gate.slice(0, 9000), /Do NOT pass \\`--n \$\{GATE_N\}\\`/);
  assert.match(gate.slice(0, 9000), /sleep 300/);
});

// TWO PROOFS, TWO COUNTS: the batch's own specs run N×, everything it could
// have broken runs once, scoped by blast radius (modified symbols, not files).
test('the blast-radius regression run survives: hunk-by-hunk, symbol-scoped, once', () => {
  assert.match(text, /run the specs this batch could have BROKEN/);
  assert.match(text, /Scope by what CHANGED, not what was touched/);
  assert.match(text, /HUNK BY HUNK/);
  assert.match(text, /NEVER every spec importing the file/);
  assert.match(text, /All hunks additive: there is no blast radius/);
});

test('the gate separates a spec that failed from a spec that never ran', () => {
  assert.match(text, /a spec that FAILED .* versus a spec that never ran/);
  assert.match(text, /module not found, worker crash, 0ms duration, collection error/);
  assert.match(text, /sends the lead hunting a bug that does not exist/);
  assert.match(text, /say in notes that the spec did not execute/);
});

// The doctrine's answer to a ticketed product defect is `expect.soft()` with a
// `// Known defect: <TICKET>` comment — the test fails loudly and stays failing.
// Correct, and it made the batch gate unpassable: one such case held four
// healthy ones red with it. So the gate RUNS them and does not COUNT them, and
// the case is reported defect-found on its ticket, never delivered.
test('a red-by-design test is declared, run, excluded from the count, and ends defect-found', () => {
  assert.match(text, /expected_red: \{/);                        // the build slot declares it
  assert.match(text, /RED BY DESIGN — do not count these against the green requirement/);
  assert.match(text, /the N-consecutive-green contract covers only the OTHER specs/);
  assert.match(text, /If one of them comes back GREEN, say so loudly/);
  assert.match(text, /const red = OUTCOME\[id\]\._expectedRed/);
  assert.match(text, /red by design pending .* the gate ran it but could not count it/);
  assert.match(text, /re-enter once the product ships/);
  assert.match(text, /expected_red: EXPECTED_RED/);              // the run surfaces the whole set
});

// An interrupted gate returns `not-run` (or drops to null) — that is NOT a
// red. Field measurement: a session killed mid-gate reported "blocked: 14"
// while 13 of the 14 units were already built, reviewed and merged.
test('gate not-run is not a red: merged units become merged-ungated, never blocked', () => {
  assert.match(text, /outcome: 'merged-ungated'/);
  assert.match(text, /UNPROVEN, not blocked/);
  assert.match(text, /GATE NEVER RAN/);
  assert.match(text, /An interrupted run's own totals are a claim, not evidence/);
  assert.match(text, /outcome: 'blocked', note: why/);           // the real-red path still records blocked
  // skipGate is the same honest state, with the arg named
  assert.match(text, /gate skipped by arg \(skipGate\)/);
});

test("'incomplete' is a distinct gate verdict from 'not-run', and says where to resume", () => {
  assert.match(text, /enum: \['green', 'red', 'not-run', 'incomplete'\]/);
  assert.match(text, /use verdict 'incomplete', NOT 'not-run'/);
  assert.match(text, /gate CUT OFF mid-run/i);
  assert.match(text, /run\(s\) already green before it was cut off/);
});

// The receipt is the deliverable: leads recover the gate flawlessly and then
// never correct report.json, so genuinely-green specs score as unproven
// forever. The obligation lives where the lead reads it.
test('the not-run/incomplete next-step orders the report.json write-back, with the label choice', () => {
  assert.match(text, /WRITE IT BACK INTO \$\{REPORT_DIR\}\/report\.json/);
  assert.match(text, /gate\.verdict, gate\.runs, gate\.seconds/);
  assert.match(text, /'defect-found' for a ticketed red-by-design/);
  assert.match(text, /scores as ZERO delivered/);
});

// ---- report ----------------------------------------------------------------
test('the report is the single disk write, and it is written verbatim', () => {
  assert.ok(text.includes("title: 'Report'"));
  assert.match(text, /single disk write of this run/);
  assert.match(text, /EXACTLY this JSON, byte for byte/);
  assert.match(text, /Change NOTHING about the data/);   // the writer renders, it does not judge
  assert.match(text, /report\.json/);
  assert.match(text, /report\.md/);
  // coverage reaches the report per case — the TMS back-write needs it
  assert.match(text, /coverage per delivered case/);
});

// TA back-writes ONLY automation executions; manual-qa's live runs are their
// own record. Dual-write policy, stated where the lead lands the batch.
test('the green next-step scopes the TMS back-write to automation executions + coverage note', () => {
  assert.match(text, /update_execution with the gate outcome — automation executions ONLY/);
  assert.match(text, /manual-qa's live runs are their own record/);
  assert.match(text, /full \| partial with the excluded steps/);
  assert.match(text, /Replan anything not 'delivered'/);
  assert.match(text, /work-scope\.mjs outcome <ID>=delivered/);
});

test('report rows are clipped at the source; full text lives in receipts', () => {
  assert.match(text, /const CLIP = 400/);
  assert.match(text, /p\.note = clip\(p\.note\)/);          // record()
  assert.match(text, /note: clip\(f\.note\)/);              // addFindings()
  assert.match(text, /signature: clip\(f\.signature\)/);    // gate failures
  assert.match(text, /why: clip\(p\.why\)/);                // parked units
  assert.match(text, /_returns\//);                         // pointer to the receipts
});

test('findings are deduplicated per case, and the bookkeeping stays out of the report', () => {
  assert.match(text, /const seen = \(OUTCOME\[id\]\._findingKeys \?\?= new Set\(\)\)/);
  assert.match(text, /if \(seen\.has\(key\)\) continue/);
  assert.match(text, /a re-review after a fix round legitimately repeats/);
  assert.match(text, /const \{ _findingKeys, _expectedRed, \.\.\.row \} = OUTCOME\[c\.id\]/);
});

// ---- serialization + trunk discipline (unchanged doctrine) -----------------
test('no concurrency at all: a plain sequential loop over units', () => {
  assert.match(text, /ONE TREE, ONE MASTER/);
  assert.match(text, /for \(const unit of \(DEFAULT_ROUTE \? UNITS : \[\]\)\)/);
  assert.doesNotMatch(text, /Promise\.all/);
  assert.doesNotMatch(text, /buildChain|surfaceChains|makeLaneChains|makeSemaphore/);
  assert.doesNotMatch(text, /await pipeline\(/);
  assert.doesNotMatch(text, /parallel\(UNITS/);
  assert.match(text, /await parallel\(REVIEW_LENSES/, 'read-only review fan-out is allowed');
  const parallelUses = text.match(/await parallel\(/g) ?? [];
  assert.equal(parallelUses.length, 1, 'the review panel is the only concurrency in the file');
  assert.match(text, /Do NOT reach for parallel\(\)\/pipeline\(\) here/);
});

test('resume determinism: every prompt is a function of args or worker results', () => {
  assert.match(text, /PROMPT DETERMINISM/);
  assert.doesNotMatch(text, /prevBranch/, 'branching off "whatever finished last" is the bug');
  assert.match(text, /cut your feature branch FROM \$\{TRUNK\}/i);
});

test('units branch from the trunk and merge back, leaving the tree on it', () => {
  assert.match(text, /THEN cut your feature branch FROM \$\{TRUNK\}/);
  assert.match(text, /it already carries every unit that finished before you/);
  assert.match(text, /git merge --no-ff \$\{impl\.branch\}/);
  assert.match(text, /LEAVE THE TREE ON \$\{TRUNK\}/);
});

test('the trunk is created only when it exists nowhere', () => {
  assert.match(text, /git checkout -B \$\{TRUNK\} \$\{BASE\}/);
  assert.match(text, /git push -u origin \$\{TRUNK\}/);
  assert.match(text, /never -B an existing trunk — that discards merged units/);
});

test('case PRs target the trunk, and ONE PR takes the trunk to base', () => {
  assert.match(text, /open yours against ' \+ TRUNK \+ `, NOT against \$\{BASE\}/);
  assert.match(text, /one PR takes the trunk to \$\{BASE\} after the gate/);
  assert.match(text, /one PR from \$\{gateBranch\} to \$\{BASE\}/);
  assert.match(text, /Automation PR policy/);
});

// Field incident (AutomationBundleDemo1, 2026-08-17): a prompt that
// unconditionally commanded `git push -u origin` + "open the PR" got the
// dispatch refused at spawn in a no-remote repo. Every push/PR instruction
// must defer to .agents/profile.md § Automation PR policy.
test('no unconditional push/PR imperatives — every one defers to the PR policy', () => {
  assert.doesNotMatch(text, /&& git push -u origin/, 'trunk creation must not chain an unconditional push');
  for (const m of text.matchAll(/open (?:the|your) PR|git push (?:-u )?origin/gi)) {
    const ctx = text.slice(Math.max(0, m.index - 600), m.index + 400);
    assert.match(ctx, /Automation PR policy|where the project uses|ONLY if this project|local-only/i,
      `push/PR imperative without policy deference near: …${text.slice(m.index, m.index + 80)}…`);
  }
});

test('a unit that reviews but cannot merge is parked, not lost', () => {
  assert.match(text, /const parked = \[\]/);
  assert.match(text, /reviewed but NOT merged/);
  assert.match(text, /resolve on the case branch and re-enter/);
  assert.match(text, /parked: parked\.map/);               // it reaches the report
  assert.match(text, /SEMANTIC \(never resolve\)/);
  assert.match(text, /never delete, .{0,3}rm.{0,3}, or .{0,3}checkout --ours\/--theirs.{0,3} a file away/);
});

test('a parked unit lands its memory on the trunk before reporting', () => {
  assert.match(text, /LAND THE UNIT'S KNOWLEDGE ANYWAY/);
  assert.match(text, /-- \.agents\/memory\//);
  assert.match(text, /learnings from a parked unit/);
});

test('one working tree: no worktree option, scoped staging demanded', () => {
  assert.doesNotMatch(text, /implementerIsolation/);
  assert.doesNotMatch(text, /isolation: 'worktree'/);
  assert.match(text, /No worktree is created for you and you must not create one/);
  assert.match(text, /never `-A`/);
});

// ---- clusters --------------------------------------------------------------
// A cluster is a dispatch economy: one branch, one build. One parameterized
// spec ONLY for true variants of one flow — the engineer's judgment from the
// case files, there being no analyst to pre-decide it.
test('clusters: one branch, parameterized only for true flow-variants, per-row review', () => {
  assert.match(text, /clusters/);
  assert.match(text, /CLUSTER unit:/);
  assert.match(text, /ONLY where the cases are true variants of one flow/);
  assert.match(text, /never flatten distinct expected values into a shared assertion/);
  assert.match(text, /Cases that merely share a surface get SEPARATE specs/);
  assert.match(text, /[Ss]hared page objects and fixtures are of course reused/);
  assert.match(text, /per-ROW verification/);
});

// ---- fix loop (unchanged doctrine) -----------------------------------------
test('the fix loop continues on unaddressed work and stops only on cannot-move', () => {
  assert.match(text, /function loopVerdict/);
  assert.match(text, /'unaddressed', 'persists', 'external'/);
  assert.match(text, /if \(unaddressed\.length\) return \{ go: true/);
  assert.match(text, /const v = loopVerdict\(r\)\n\s*if \(!v\.go\) \{/);
  assert.match(text, /else \{ stopped = v\.why; break \}/);
});

test('unit split: subset-scoped stuck cases are carved out instead of blocking the unit', () => {
  assert.match(text, /Scope every blocking_detail entry with case_ids\[\]/);
  assert.match(text, /stuck: scoped \? \[\.\.\.new Set\(detail\.flatMap\(\(d\) => d\.case_ids\)\)\] : null/);
  assert.match(text, /!carvedOnce && stuck\.length && stuck\.length < ids\.length/);
  assert.match(text, /label: carve \? `carve:\$\{ul\}` : `fix:\$\{ul\}:\$\{round\}`/);
  assert.match(text, /QUARANTINE by default/);
  assert.match(text, /DECLARED, never silent/);
  assert.match(text, /re-arms by deleting the marker/);
  assert.match(text, /REMOVE instead ONLY when the blocker says the code ITSELF is wrong/);
  assert.match(text, /record the preservation point/);
  assert.match(text, /RESTORES from it \(`git checkout <sha> -- <paths>`\), never rebuilds/);
  assert.match(text, /notes MUST START with `quarantined:<paths>` or `preserved@<sha>`/);
  // the carved record survives without an AFS layer: the coverage block and
  // the removal commit carry the blocker
  assert.match(text, /a quarantined case keeps its coverage block in the spec/);
  assert.match(text, /Do NOT touch the remaining cases' logic/);
  assert.match(text, /carved out of \$\{ul\}: \$\{carve\.why\} — \$\{fix\.notes\}/);
  assert.match(text, /u\.members = u\.members\.filter\(\(m\) => !carve\.stuck\.includes\(m\.id\)\)/);
  assert.match(text, /CARVED OUT of the unit after the round above/);
});

test('the round cap is a runaway backstop, not the working control', () => {
  assert.match(text, /FIX_ROUNDS = A\.fixRounds \?\? 8/);
  assert.match(text, /RUNAWAY BACKSTOP, not the working control/);
  assert.match(text, /backstop \(\$\{FIX_ROUNDS\}\) reached — review\/fix pair is not converging/);
  assert.match(text, /budget\.total && budget\.remaining\(\) < RESERVE.*budget floor reached mid-fix/s);
});

test('the reviewer is briefed to classify by the diff, not by patience', () => {
  assert.match(text, /TRUE OF THE DIFF, not of your patience/);
  assert.match(text, /Forgotten and half-done both count here/);
  assert.match(text, /must not use `persists` to end a loop you are tired of/);
  assert.match(text, /new ground is progress and needs no status/);
});

test('a panel unions blocking_detail rather than voting on it', () => {
  assert.match(text, /blocking_detail: rs\.flatMap\(\(r\) => r\.blocking_detail \?\? \[\]\)/);
  assert.match(text, /No voting: one lens reporting/);
});

test('a repeat round names the skipped items explicitly', () => {
  assert.match(text, /THE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND/);
  assert.match(text, /an unexplained gap reads as another skip/);
});

test('the block note says which stop condition fired and after how many rounds', () => {
  assert.match(text, /attempted and still failing/);
  assert.match(text, /not resolvable on this branch/);
  assert.match(text, /after \$\{round\} fix round\(s\)/);
});

// ---- R2 cap ----------------------------------------------------------------
test('R2 cap counts reruns per root cause, with the total as fallback', () => {
  assert.match(text, /rerun_causes: \{ type: 'array', items: \{ type: 'string' \} \}/);
  assert.match(text, /worstCause \? worstCause\[1\] > 2 : impl\.reruns > 2/);
  assert.match(text, /causes not reported/);
  assert.match(text, /one short root-cause label per rerun/);
});

// ---- guards: quota, breaker, stalls, checkpoints ---------------------------
test('account ceiling halts admission instead of tripping the environment breaker', () => {
  assert.match(text, /quotaHalted/);
  assert.match(text, /QUOTA_RE/);
  assert.match(text, /ACCOUNT CEILING/);
  assert.match(text, /quota_halted/);
  assert.match(text, /function breakerCount\(cause, why = ''\)/);
});

test('a stalled slot costs its unit as infra-stalled, never the run', () => {
  assert.match(text, /const isStall = \(e\) => \/stall\/i\.test/);
  assert.match(text, /outcome: 'infra-stalled', note: stallNote\('execution', e\)/);
  assert.match(text, /outcome: 'infra-stalled', note: stallNote\('build', e\)/);
  assert.match(text, /breakerCount\('agent-died', String\(e\?\.message \?\? e\)\)/);
  assert.match(text, /build failed:/);
  assert.match(text, /merged units stay merged-ungated; re-run the gate/);
  assert.match(text, /report writer threw/);
  assert.match(text, /case\(s\) infra-stalled/);
});

test('checkpoint discipline rides the build-capable dispatches', () => {
  assert.match(text, /const CHECKPOINT_RULE =/);
  assert.match(text, /retry inherits ONLY what is committed/);
  assert.match(text, /Never silently restart on a branch that already has work/);
  assert.match(text, /push after the first commit and then per /);
  assert.match(text, /milestone ONLY if this project pushes to a remote/);
  const sites = [...text.matchAll(/CHECKPOINT_RULE \+/g)];
  assert.ok(sites.length >= 1, `CHECKPOINT_RULE must ride the build slot, found ${sites.length} site(s)`);
});

test('the long-jobs rule pins one bounded sleep per call, early first look, no chains', () => {
  assert.match(text, /ONE `sleep <n>; <tail the output file>` per call/);
  assert.match(text, /Make the FIRST poll short/);
  assert.match(text, /NEVER chain sleeps inside one/);
});

test('no wholesale tree cleaning: receipts + fresh writes are protected', () => {
  assert.match(text, /NEVER CLEAN THE TREE WHOLESALE/);
  assert.match(text, /git stash --include-untracked/);
  assert.match(text, /git stash push -- /);          // the scoped alternative
  assert.match(text, /untracked bookkeeping/);
});

test('the preamble forbids re-loading preloaded skills via the Skill tool', () => {
  assert.match(text, /confirming means CHECKING your context/);
  assert.match(text, /NEVER re-invoking the Skill tool for a skill you already carry/);
  assert.match(text, /genuinely ABSENT from your context/);
});

test('PREAMBLE carries the context-economy rules for every dispatch', () => {
  assert.match(text, /Context economy \(hard rules\)/);
  assert.match(text, /batch independent tool calls into ONE message/i);
  assert.match(text, /screenshots only when a step fails or visual/i);
  assert.match(text, /~15 tool turns per case/);
  assert.match(text, /self-check not a cap/);
});

// ---- cost levers -----------------------------------------------------------
test('mechanical slots default to the cheap tier; judgment slots follow frontmatter', () => {
  assert.match(text, /A\.mergeModel \?\? A\.workerModel \?\? 'haiku'/);
  assert.match(text, /A\.reporterModel \?\? 'haiku'/);
  assert.match(text, /A\.triageModel \?\? 'haiku'/);
  // build/reviewer/gate pass NO model unless an arg overrides — the installed
  // AGENT.md frontmatter `model:` is the configuration surface.
  assert.doesNotMatch(text, /reviewerModel \?\? A\.workerModel \?\? '/);
  assert.match(text, /frontmatter `model:` governs/);
  assert.match(text, /A\.gateModel \? \{ model: A\.gateModel \}/);
});

test('in-repo case sources: cases[].path replaces the snapshot copy in every prompt', () => {
  assert.match(text, /CASE_PATH = new Map\(CASES\.map/);
  assert.match(text, /\{id, title\?, path\?\}/, 'the args contract names path');
  assert.match(text, /source file IS the\n?\s*\/\/ snapshot/);
});

// ---- removed args fail loudly ----------------------------------------------
// Removing an arg silently changes behaviour: `analyzeOnly` used to stop after
// an analyst front that no longer exists at all.
test('args removed by the redesigns fail loudly', () => {
  assert.match(text, /removed arg\(s\):/);
  for (const a of ['analystConcurrency', 'skipIntegrate', 'integratorModel',
    'tiering', 'analyzeOnly', 'preAnalyzed', 'extendImplementerModel', 'extendRateThreshold']) {
    assert.ok(text.includes(`'${a}'`), `${a} should be rejected explicitly`);
  }
});

// ---- runaway cap -----------------------------------------------------------
test('the run warns when its worst-case agent count approaches the runtime cap', () => {
  assert.match(text, /lifetime cap is 1000/);
  assert.match(text, /const perUnit = 3 \+ FIX_ROUNDS \+ \(FIX_ROUNDS \+ 1\) \* \(PANEL \? REVIEW_LENSES\.length : 1\)/);
  assert.match(text, /UNITS\.length \* perUnit \+ CASES\.length \+ 3/);   // + runners, + triage/gate/reporter
  assert.match(text, /Split it into smaller batches/);          // actionable, not just alarming
});

// The projection has to be arithmetic anyone can check, and it has to be an
// UPPER bound — a projection that under-counts is worse than none.
test('the worst-case projection is a true upper bound on dispatches', () => {
  // per unit: build + merge + defect-filer (3) + fixes + reviews
  const perUnit = (fixRounds, lenses) => 3 + fixRounds + (fixRounds + 1) * lenses;
  assert.equal(perUnit(8, 1), 20);
  // A 3-lens panel triples only the reviews, never the builds.
  assert.equal(perUnit(8, 3), 38);
  // 50 solo units on a panel is already past the point of warning (+50 runners +3).
  assert.ok(50 * perUnit(8, 3) + 50 + 3 > 900);
  // A default 5-case batch is nowhere near it — the warning must stay rare.
  assert.ok(5 * perUnit(8, 1) + 5 + 3 < 900);
});

// Every agent must be filed under a phase meta DECLARES, or the progress tree
// grows an orphan group that no `phases` entry describes.
test('every agent phase is one meta declares', () => {
  const declared = new Set([...text.matchAll(/title: '([^']+)'/g)].map((m) => m[1]));
  const used = new Set([...text.matchAll(/phase: '([^']+)'/g)].map((m) => m[1]));
  for (const p of used) assert.ok(declared.has(p), `agent phase '${p}' is not in meta.phases`);
  assert.ok(used.has('Triage') && used.has('Execution') && used.has('Build'));
});

test('the loop enters the phases meta declares', () => {
  assert.match(text, /phase\('Triage'\)/);
  assert.match(text, /phase\('Execution'\)/);
  assert.match(text, /phase\('Build'\)/);
});

// ---- board stays dead ------------------------------------------------------
test('no board anywhere: no clerk, no statuses, no transitions', () => {
  assert.doesNotMatch(text, /set-status|init-batch|validate\.mjs|board-lib/);
  assert.doesNotMatch(text, /clerkChain|flipMany|cmdFor/);
  assert.doesNotMatch(text, /automation-board\/batches/);
  assert.match(text, /WHY NO BOARD/);            // the reasoning is left for the next editor
});

// workflow() nesting is ONE level. batch-build runs as a campaign CHILD, so it
// must never spawn a child of its own — a nested call once made every campaign
// wave silently land nothing.
test('batch-build never nests a child workflow', () => {
  assert.doesNotMatch(text, /await workflow\(/);
  assert.doesNotMatch(text, /TYPES\.integrator/);
  assert.match(text, /There is no integrate PHASE/);
  assert.match(text, /batch-integrate\.workflow\.mjs survives as a REPAIR tool/);
});

// A thrown build costs its own unit and nothing else: the trunk is where it
// was, so the next unit still starts from a known state.
test('a thrown build costs its unit, not the run', () => {
  assert.match(text, /try \{\n\s*phase\('Build'\)\n\s*const impl = await runBuild/);
  assert.match(text, /build failed:/);
  assert.match(text, /continuing with the next unit/);
});

// The PREAMBLE asks every dispatch for findings[]. A schema with
// additionalProperties:false that omits it makes an obedient agent's return
// invalid — and this unit would be parked despite a clean merge.
test('every schema that gets the preamble can carry findings', () => {
  const merge = text.slice(text.indexOf('label: `merge:'), text.indexOf('label: `merge:') + 1400);
  assert.match(merge, /findings: FINDINGS/);
  assert.match(text, /addFindings\(ids, landed\.findings\)/);
});

// The report writer may commit — so it must put the tree back, or the next
// campaign wave's first slot inherits a tree on base.
test('the report writer returns the tree to the trunk', () => {
  assert.match(text, /RETURN THE TREE TO \$\{gateBranch\}/);
});
