import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The workflow script runs only inside Claude Code's Workflow runtime, which
// wraps the body in an async function and provides agent/pipeline/parallel/
// phase/log/budget/args/workflow as globals — so top-level `return`/`await`
// are legal there but not in bare ESM, and the file can't be imported here.
// These tests guard what CI can check: the body parses under the runtime's
// wrapping, and the design invariants the accelerant documents.

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

test('meta: canonical name and the four phases of one end-to-end batch', () => {
  assert.match(text, /export const meta = \{/);
  assert.match(text, /name: 'ta-batch-build'/);
  // No 'Integrate' phase: units merge into the trunk as they finish, so
  // integration is continuous rather than a stage at the end.
  for (const ph of ['Analysis', 'Build', 'Gate', 'Report']) {
    assert.ok(text.includes(`title: '${ph}'`), `missing phase ${ph}`);
  }
  assert.ok(!text.includes("title: 'Integrate'"), 'integration is continuous, not a phase');
});

test('args robustness: stringified args are parsed', () => {
  assert.match(text, /typeof args === 'string' \? JSON\.parse\(args\)/);
});

test('design invariants: named agentTypes, no Date/Math.random', () => {
  assert.match(text, /agentType: TYPES\.analyst/);
  assert.match(text, /agentType: TYPES\.implementer/);
  assert.match(text, /agentType: TYPES\.reviewer/);
  assert.match(text, /agentType: TYPES\.gate/);
  // Workflow runtime forbids these (they break resume) — keep them out.
  assert.doesNotMatch(text, /Date\.now|Math\.random|new Date\(\)/);
});

// The board is gone: it recorded progress, and progress only needs recording if
// something reads it mid-run. Nothing does — the runtime writes every agent's
// return to journal.jsonl, and resume replays from cache.
test('no board anywhere: no clerk, no statuses, no transitions', () => {
  assert.doesNotMatch(text, /set-status|init-batch|validate\.mjs|board-lib/);
  assert.doesNotMatch(text, /clerkChain|flipMany|cmdFor/);
  // It may NAME the old path once, explaining why it is gone — but never use it.
  assert.doesNotMatch(text, /automation-board\/batches/);
  assert.match(text, /WHY NO BOARD/);            // the reasoning is left for the next editor
});

// One row per input case, saying where it ended — not a state machine.
test('outcomes: every input case gets exactly one row, defaulting to not-started', () => {
  assert.match(text, /for \(const c of CASES\) OUTCOME\[c\.id\] = \{ id: c\.id, outcome: 'not-started'/);
  assert.match(text, /const rows = CASES\.map\(\(c\) => \{ const \{ _findingKeys, _expectedRed, \.\.\.row \} = OUTCOME\[c\.id\]; return row \}\)/);
  assert.match(text, /VERDICT_OUTCOME/);          // analyst verdict → terminal outcome
});

// A case can finish AND still have something to say. The old vocabulary forced
// that into the exception status `defect-found`, which read as "this failed".
test('findings ride every worker return, orthogonal to the outcome', () => {
  assert.match(text, /const FINDINGS = \{/);
  assert.match(text, /'defect', 'clarification', 'question', 'note'/);
  assert.match(text, /addFindings/);
  // and workers are told where a non-blocking observation goes
  assert.match(text, /did NOT stop you/);
  // Memory is the second channel, and it is committed like any deliverable —
  // the old "do not write memory yourself" left entries untracked for a whole
  // campaign, and a wholesale stash swept six of them mid-wave (2026-08-03).
  assert.match(text, /COMMIT WHAT YOU PRODUCE/);
  assert.doesNotMatch(text, /Do not write it to memory yourself/);
});

// The gate is its own agent inside the workflow: not the implementer (who would
// be certifying their own work), not the orchestrator (who became the measured
// bottleneck at 1/3 the pipeline's throughput).
test('gate: its own agent, N consecutive, never merges/classifies/fixes', () => {
  assert.ok(text.includes("title: 'Gate'"));
  assert.match(text, /GATE_N/);
  assert.match(text, /CONSECUTIVE deterministic green runs/);
  assert.match(text, /A red anywhere ENDS the attempt/);
  assert.match(text, /Do NOT merge anything\. Do NOT classify/);
  assert.match(text, /gate-case\.mjs/);           // mechanics are scripted
  assert.match(text, /batch-stabilize/);          // where a red goes next
});

test('the report is the single disk write, and it is written verbatim', () => {
  assert.ok(text.includes("title: 'Report'"));
  assert.match(text, /single disk write of this run/);
  assert.match(text, /EXACTLY this JSON, byte for byte/);
  assert.match(text, /Change NOTHING about the data/);   // the writer renders, it does not judge
  assert.match(text, /report\.json/);
  assert.match(text, /report\.md/);
});

test('clusters: one session per unit, every case executed individually, per-row family review', () => {
  assert.match(text, /clusters/);
  assert.match(text, /CLUSTER dispatch/);
  assert.match(text, /execute EVERY case's steps individually/);
  assert.match(text, /assumed the rest" is forbidden/);   // the banned failure mode, verbatim
  assert.match(text, /family_afs/);
  assert.match(text, /per-ROW triangulation/);
  assert.match(text, /analyzeOnly/);                       // conductor heads pass
  assert.match(text, /preAnalyzed/);
});

test('reuse + extend guards: fast-reach, merged-target split, extend-rate flag', () => {
  assert.match(text, /FAST-REACH/);
  assert.match(text, /transit is NOT execution/);
  assert.match(text, /MERGED-TARGET RULE/);
  assert.match(text, /extendRateThreshold/);
  assert.match(text, /quality_flags/);
  // Browser lanes existed ONLY because two analysts might want a browser at
  // once. One analyst at a time means the shared MCP is simply available.
  assert.doesNotMatch(text, /BROWSER LANE/);
  assert.doesNotMatch(text, /9222/);
  assert.match(text, /the shared Playwright MCP browser is yours/);
});

// The two verdicts have different exposure, so they get different targets.
// `extend-existing` produces work that shares the batch's fate, so a target on
// the trunk is safe. `already-covered` is TERMINAL — it drops the case out of
// the remainder — so it needs coverage that has already LANDED, or a later red
// gate closes a case whose covering spec never shipped.
test('merged-target is asymmetric: extend may target the trunk, already-covered may not', () => {
  assert.match(text, /MERGED-TARGET RULE: .{0,4}extend-existing.{0,4} may target a spec merged to \$\{BASE\} OR already on this batch's trunk \$\{TRUNK\}/);
  assert.match(text, /is stricter: it may target ONLY a spec merged to \$\{BASE\}/);
  assert.match(text, /because it CLOSES the case/);
  assert.match(text, /a terminal verdict needs coverage that has already landed/);
});

// The resume cache is keyed on the exact (prompt, opts) pair, so a prompt that
// interpolates anything decided by run timing re-runs live on every resume.
// Measured cost of getting this wrong: ~2x duplicate dispatches.
// Serialising removed this whole class rather than managing it: every unit
// branches from the TRUNK, whose name comes from args, so no prompt depends on
// who finished first and a resumed run replays from cache.
test('resume determinism: every prompt is a function of args, never of completion order', () => {
  assert.match(text, /PROMPT DETERMINISM/);
  assert.doesNotMatch(text, /makeLaneChains/);
  assert.doesNotMatch(text, /prevBranch/, 'branching off "whatever finished last" is the bug');
  assert.doesNotMatch(text, /makeSemaphore/);
  assert.doesNotMatch(text, /free\.shift\(\)/);
  assert.match(text, /Cut your feature branch FROM \$\{TRUNK\}/);
});

test('account ceiling halts admission instead of tripping the environment breaker', () => {
  assert.match(text, /quotaHalted/);
  assert.match(text, /QUOTA_RE/);
  assert.match(text, /ACCOUNT CEILING/);
  assert.match(text, /quota_halted/);
  assert.match(text, /function breakerCount\(cause, why = ''\)/);
});

// Concurrency follows what a slot WRITES: analysts and reviewers touch nothing
// shared and run in parallel; implementers write code in one tree and must not
// overlap — per-surface chains are not enough once the tree is shared.
// ONE TREE, ONE MASTER. A single working tree has one state at a time while
// concurrent slots need different ones; ordering is the only thing that
// reconciles that. Measured cost of getting this wrong: eight checkout aborts,
// conflicts concentrated in shared page objects, three git-surgery rescues.
test('no concurrency at all: a plain sequential loop over units', () => {
  assert.match(text, /ONE TREE, ONE MASTER/);
  assert.match(text, /for \(const unit of UNITS\)/);
  assert.match(text, /u = await runAnalyst\(unit\)/);
  assert.match(text, /await buildUnit\(u, pre\)/);
  // one unit fully finishes before the next begins — analysis (combined or
  // analyst-routed) awaited inline, then the build, all inside one loop body
  assert.match(text, /for \(const unit of UNITS\) \{\n\s*phase\('Analysis'\)/);
  assert.match(text, /const c = await runCombined\(unit\)/);
  // None of the concurrency machinery may come back.
  assert.doesNotMatch(text, /Promise\.all/);
  assert.doesNotMatch(text, /buildChain/);
  assert.doesNotMatch(text, /surfaceChains/);
  // `analystConcurrency` may appear ONLY in the removed-args guard, never as a
  // knob the script reads.
  assert.doesNotMatch(text, /A\.analystConcurrency/);
  assert.doesNotMatch(text, /const K\b/);
  // parallel() over UNITS is the trap — it puts two `git checkout` in one tree.
  // The ONE sanctioned fan-out is the review panel: several reviewers on a
  // finished diff, writing nothing, while no writer runs.
  assert.doesNotMatch(text, /await pipeline\(/);
  assert.doesNotMatch(text, /parallel\(UNITS/);
  assert.match(text, /await parallel\(REVIEW_LENSES/, 'read-only review fan-out is allowed');
  const parallelUses = text.match(/await parallel\(/g) ?? [];
  assert.equal(parallelUses.length, 1, 'the review panel is the only concurrency in the file');
  assert.match(text, /Do NOT reach for parallel\(\)\/pipeline\(\) here/);
});

// The trunk is the known state: every unit cuts from it and merges back, so
// page-object work accumulates by MERGE rather than by branch lineage — and the
// tree is somewhere named between units.
test('units branch from the trunk and merge back, leaving the tree on it', () => {
  assert.match(text, /Cut your feature branch FROM \$\{TRUNK\}/);
  assert.match(text, /it already carries every unit that finished before you/);
  assert.match(text, /git merge --no-ff \$\{impl\.branch\}/);
  assert.match(text, /LEAVE THE TREE ON \$\{TRUNK\}/);
  // The digest is one-writer-at-a-time: the implementer may APPEND attributed
  // implementation-time facts, but the analyst's behavior claims stay theirs —
  // disagreement is reported as drift, never edited in.
  assert.match(text, /you may APPEND attributed implementation-time facts/);
  assert.match(text, /never rewrite its behavior or scope claims — report that drift in findings\[\] instead/);
});

// A unit that reviews clean but cannot merge is not `automated` and not a
// silent loss — it is blocked, named, and its branch is kept for re-entry.
test('a unit that reviews but cannot merge is parked, not lost', () => {
  assert.match(text, /const parked = \[\]/);
  assert.match(text, /reviewed but NOT merged/);
  assert.match(text, /resolve on the case branch and re-enter/);
  assert.match(text, /parked: parked\.map/);               // it reaches the report
  // Semantic conflicts are never resolved by the merge step.
  assert.match(text, /SEMANTIC \(never resolve\)/);
  assert.match(text, /never delete, .{0,3}rm.{0,3}, or .{0,3}checkout --ours\/--theirs.{0,3} a file away/);
});

test('one working tree: no worktree option, scoped staging demanded', () => {
  assert.doesNotMatch(text, /implementerIsolation/);
  assert.doesNotMatch(text, /isolation: 'worktree'/);
  assert.match(text, /No worktree is created for you and you must not create one/);
  assert.match(text, /never `-A`/);
});

test('cost levers: snapshot-first, digest, breaker, arg-only overrides, tiering', () => {
  assert.match(text, /SRC = \(id\)/);                       // fetch-once-to-disk snapshots
  assert.match(text, /_surface\.md/);
  assert.match(text, /breakerThreshold/);
  assert.match(text, /circuit breaker TRIPPED/);
  // Reviewer model comes from args or the AGENT.md frontmatter — no literal floor.
  assert.match(text, /A\.reviewerModel \?\? A\.workerModel\) \? \{ model:/);
  assert.match(text, /extendImplementerModel/);
});

// Only the build chain runs git. Analysts run in PARALLEL with a build that owns
// the one working tree, so an analyst commit checks the tree out from under it —
// measured: HEAD moved to main mid-build, the implementer's next commit landed on
// the wrong branch, one AFS ended up on two branches at once.
// Serialising BUYS this back. The analyst prohibition existed only because a
// second agent might be in the tree; alone, it commits its own work like anyone
// else — and the AFS lands the moment it exists, so a case that turns out
// already-covered or blocked still has its analysis on the trunk.
test('the analyst owns the tree and commits its own AFS', () => {
  assert.doesNotMatch(text, /RUN NO GIT COMMANDS AT ALL/);
  assert.match(text, /YOU OWN THE TREE RIGHT NOW and nothing else runs, so ordinary git is yours/);
  assert.match(text, /commit, and push/);
  assert.match(text, /Do NOT switch to any other branch/);
  assert.match(text, /a case that turns out already-covered or blocked still has its AFS/);
  // The implementer no longer commits someone else's file; it reads it.
  assert.match(text, /YOUR AFS IS ALREADY COMMITTED on \$\{TRUNK\}/);
  assert.doesNotMatch(text, /COMMIT THIS UNIT'S AFS with your spec/);
  // Scoped staging survives as hygiene, not as isolation.
  assert.match(text, /never .{0,3}git add -A/);
  assert.match(text, /add the regression test that would have caught it/);
});

// Reading the neighbouring specs makes ANALYSIS cheap — handles, flows,
// conventions. It is not a duplicate hunt, and the prompt has to say so: the
// two errors are not symmetric. A redundant test is visible and deletable; a
// wrongly-deduped case is never automated and the hole never surfaces.
test('the analyst reads neighbours for speed, with dedup held to a high bar', () => {
  assert.match(text, /READ THE NEIGHBOURS FIRST/);
  assert.match(text, /BY BEHAVIOUR/);
  assert.match(text, /never by case id/);
  assert.match(text, /This is REUSE, not a duplicate hunt/);
  assert.match(text, /the hole is invisible/);
  assert.match(text, /normal outcome here is ready-for-automation WITH better context/);
  assert.match(text, /SAME observable with the SAME expected result/);
  assert.match(text, /When in doubt, ready-for-automation/);
});

// A "too little dedup" flag would push analysts toward calling cases covered —
// the one error the pipeline cannot see. Only the dangerous direction is flagged.
test('zero reuse in a batch is NOT flagged; only an excessive extend rate is', () => {
  assert.match(text, /extendRateThreshold|EXTEND_RATE/);
  assert.doesNotMatch(text, /zero reuse:/);
  assert.match(text, /There is deliberately NO mirror flag/);
});

// The loop's whole purpose: work nobody attempted is a reason to CONTINUE, not
// to stop. A round cap could not tell "the fixer forgot an item" from "the
// fixer cannot do it", so at 2 it shipped nearly-finished units as `blocked` —
// neither finished nor honestly stuck. The reviewer classifies each surviving
// blocker instead, because only it saw both rounds and the diff between them.
test('the fix loop continues on unaddressed work and stops only on cannot-move', () => {
  assert.match(text, /function loopVerdict/);
  assert.match(text, /'unaddressed', 'persists', 'external'/);
  // unaddressed anywhere → another round, regardless of what else is in the list
  assert.match(text, /if \(unaddressed\.length\) return \{ go: true/);
  // and the loop consults it rather than a counter — stopping (or splitting)
  // only when the verdict says another round cannot help
  assert.match(text, /const v = loopVerdict\(r\)\n\s*if \(!v\.go\) \{/);
  assert.match(text, /else \{ stopped = v\.why; break \}/);
});

// A unit amortizes dispatch cost, and the price was fate-coupling: one
// policy-stuck case stranded four finished ones. When
// every surviving blocker is scoped to a proper subset of the unit's cases,
// the loop carves those cases out — blocked, code stripped, AFS kept — and
// the remainder goes back through review and lands.
test('unit split: subset-scoped stuck cases are carved out instead of blocking the unit', () => {
  // the reviewer scopes each surviving blocker to case ids…
  assert.match(text, /Scope every blocking_detail entry with case_ids\[\]/);
  // …loopVerdict surfaces the union only when EVERY survivor is scoped…
  assert.match(text, /stuck: scoped \? \[\.\.\.new Set\(detail\.flatMap\(\(d\) => d\.case_ids\)\)\] : null/);
  // …and the loop splits once per unit, only on a PROPER subset
  assert.match(text, /!carvedOnce && stuck\.length && stuck\.length < ids\.length/);
  assert.match(text, /label: carve \? `carve:\$\{ul\}` : `fix:\$\{ul\}:\$\{round\}`/);
  // an almost-ready test is a STATUS problem, not a code problem: the default
  // is a declared skip that ships the code inert and re-arms later — deletion
  // is reserved for code the blocker itself condemns
  assert.match(text, /QUARANTINE by default/);
  assert.match(text, /DECLARED, never silent/);
  assert.match(text, /re-arms by deleting the marker/);
  assert.match(text, /REMOVE instead ONLY when the blocker says the code ITSELF is wrong/);
  // no work is lost either way: quarantined code rides the trunk; removed code
  // gets a preservation sha and re-entry RESTORES from trunk history
  assert.match(text, /record the preservation point/);
  assert.match(text, /RESTORES from it \(`git checkout <sha> -- <paths>`\), never rebuilds/);
  assert.match(text, /notes MUST START with `quarantined:<paths>` or `preserved@<sha>`/);
  // the carve keeps knowledge and never touches the survivors' logic
  assert.match(text, /Either way KEEP their AFS on the branch/);
  assert.match(text, /Do NOT touch the remaining cases' logic/);
  // carved cases are recorded blocked (mode riding the note) and the unit shrinks
  assert.match(text, /carved out of \$\{ul\}: \$\{carve\.why\} — \$\{fix\.notes\}/);
  assert.match(text, /u\.members = u\.members\.filter\(\(m\) => !carve\.stuck\.includes\(m\.id\)\)/);
  // the re-review is told the carve happened and verifies it
  assert.match(text, /CARVED OUT of the unit after the round above/);
});

test('the round cap is a runaway backstop, not the working control', () => {
  assert.match(text, /FIX_ROUNDS = A\.fixRounds \?\? 8/);
  assert.match(text, /RUNAWAY BACKSTOP, not the working control/);
  assert.match(text, /backstop \(\$\{FIX_ROUNDS\}\) reached — review\/fix pair is not converging/);
  // a pathological pair must not eat the batch's budget either
  assert.match(text, /budget\.total && budget\.remaining\(\) < RESERVE.*budget floor reached mid-fix/s);
});

// A reviewer must not end a loop it finds tiresome by mislabelling a skip.
test('the reviewer is briefed to classify by the diff, not by patience', () => {
  assert.match(text, /TRUE OF THE DIFF, not of your patience/);
  assert.match(text, /Forgotten and half-done both count here/);
  assert.match(text, /must not use `persists` to end a loop you are tired of/);
  assert.match(text, /new ground is progress and needs no status/);
});

// One lens seeing an untouched item is a fact about the diff, not an opinion to
// be outvoted by lenses that were looking elsewhere.
test('a panel unions blocking_detail rather than voting on it', () => {
  assert.match(text, /blocking_detail: rs\.flatMap\(\(r\) => r\.blocking_detail \?\? \[\]\)/);
  assert.match(text, /No voting: one lens reporting/);
});

// The fixer is told what it skipped, by name. A bare re-listing of blockers
// reads as new work and gets skipped the same way twice.
test('a repeat round names the skipped items explicitly', () => {
  assert.match(text, /THE REVIEWER SAYS THESE WERE NOT ADDRESSED LAST ROUND/);
  assert.match(text, /an unexplained gap reads as another skip/);
});

test('the block note says which stop condition fired and after how many rounds', () => {
  assert.match(text, /attempted and still failing/);
  assert.match(text, /not resolvable on this branch/);
  assert.match(text, /after \$\{round\} fix round\(s\)/);
});

// Two branch levels: case branches under a batch trunk, ONE PR to base.
// The trunk is created by the FIRST build and pushed immediately — the gate
// checks out origin/<trunk>, so a trunk that only appears at integration time
// has to be pushed by the gate itself (a write its contract forbids; on a live
// run it happened only because that agent reasoned its way there).
test('the trunk is created only when it exists nowhere', () => {
  assert.match(text, /git checkout -B \$\{TRUNK\} \$\{BASE\}/);
  assert.match(text, /git push -u origin \$\{TRUNK\}/);
  // -B on an existing trunk discards every unit already merged into it.
  assert.match(text, /does not exist anywhere yet/);
  assert.match(text, /Never -B an existing trunk/);
});

test('case PRs target the trunk, and ONE PR takes the trunk to base', () => {
  assert.match(text, /Open your PR against \$\{TRUNK\}, NOT against \$\{BASE\}/);
  assert.match(text, /one PR takes the trunk to \$\{BASE\} after the gate/);
  // What is gated and what lands are the same object.
  assert.match(text, /one PR from \$\{gateBranch\} to \$\{BASE\}/);
  assert.match(text, /Automation PR policy/);
});

// Clustering buys a shared LIVE SESSION, not a merged spec. Merging output is a
// second judgement the analyst makes at the end of the session, and the
// implementer must be TOLD which shape to produce — otherwise it infers the
// answer from a path count. Forcing unrelated cases into one parameterized spec
// makes them share assertions that were never meant to be shared, and a case
// stops being tested without anything turning red.
test('a multi-case unit produces one spec or many, on the analyst\'s judgement', () => {
  assert.match(text, /FAMILY UNIT: the analyst judged these true variants of ONE flow/);
  assert.match(text, /Implement ONE parameterized spec/);
  assert.match(text, /Never flatten distinct expected values into a shared assertion/);

  assert.match(text, /NOT a family: the analyst wrote a SEPARATE AFS per case/);
  assert.match(text, /Implement them as SEPARATE specs, one per case/);
  assert.match(text, /a dispatch economy, not a reason to merge test code/);
  // shared page objects/fixtures are reused either way — that is the real saving
  assert.match(text, /Shared page objects and fixtures are of course reused/);
});

// "Never trust a self-report for a fact you can observe" — the pipeline's own
// rule, applied here. A family IS members sharing one AFS file; the analyst's
// `family_afs` flag is a claim about that. When they disagreed the implementer
// got a contradiction: "FAMILY UNIT, write ONE parameterized spec" pointing at
// three separate AFS paths.
test('family is decided by the AFS paths, not by the analyst\'s flag', () => {
  // Non-empty shared path required: two empty afs_path values share a VALUE,
  // not a file, and must not dispatch as a family.
  assert.match(text, /const sharesOneAfs = members\.length > 1 && Boolean\(members\[0\]\.afs_path\) && new Set\(members\.map\(\(m\) => m\.afs_path\)\)\.size === 1/);
  assert.match(text, /family_afs: sharesOneAfs/);
  assert.doesNotMatch(text, /family_afs: a\.family_afs === true/);
  // and the disagreement is logged, not silently resolved
  assert.match(text, /treating as separate specs \(the files decide\)/);
});

// A worker handles a whole unit and its findings apply to every case in it — but
// the unit is dispatched once, so a verbatim copy per member turned a family of
// two into 20 identical rows in the report a human reads (measured on a live
// run: TC-003 and TC-004, 10 findings each, byte-identical).
test('findings are deduplicated per case, and the bookkeeping stays out of the report', () => {
  assert.match(text, /const seen = \(OUTCOME\[id\]\._findingKeys \?\?= new Set\(\)\)/);
  assert.match(text, /if \(seen\.has\(key\)\) continue/);
  // a re-review after a fix round repeats itself legitimately — show it once
  assert.match(text, /a re-review after a fix round legitimately repeats/);
  // and the dedup set must not leak into report.json
  assert.match(text, /const \{ _findingKeys, _expectedRed, \.\.\.row \} = OUTCOME\[c\.id\]/);
});

// Measured on a live batch: `Cannot find module …/agents-form-lifecycle.spec.ts`,
// 0ms duration, while another worker ran that same file and failed on an
// assertion. That is a merge/worker artifact, not a bug — but it was reported as
// a red case, and it blocked four other cases with it. Only the gate sees the
// runner output, so only the gate can tell the two apart.
test('the gate separates a spec that failed from a spec that never ran', () => {
  assert.match(text, /a spec that FAILED .* versus a spec that never ran/);
  assert.match(text, /module not found, worker crash, 0ms duration, collection error/);
  assert.match(text, /sends the lead hunting a bug that does not exist/);
  assert.match(text, /say in notes that the spec did not execute/);
});

// The doctrine's answer to a ticketed product defect is `expect.soft()` with a
// `// Known defect: <TICKET>` comment — the test fails loudly and stays failing.
// Correct, and it made the batch gate unpassable: measured on a live batch, one
// such case held four healthy ones red with it. So the gate RUNS them and does
// not COUNT them, and the case is reported blocked-on-ticket, never automated.
test('a red-by-design test is declared, run, and excluded from the green count', () => {
  assert.match(text, /expected_red: \{/);                        // implementer declares it
  assert.match(text, /RED BY DESIGN — do not count these against the green requirement/);
  assert.match(text, /the N-consecutive-green contract covers only the OTHER specs/);
  // a green expected-red is news: the product shipped a fix
  assert.match(text, /If one of them comes back GREEN, say so loudly/);
});

test('a case held on a ticketed defect is blocked, not automated', () => {
  assert.match(text, /const red = OUTCOME\[id\]\._expectedRed/);
  assert.match(text, /red by design pending .* the gate ran it but could not count it/);
  assert.match(text, /re-enter once the product ships/);
  // and the run surfaces the whole set for the lead
  assert.match(text, /expected_red: EXPECTED_RED/);
});

// workflow() nesting is ONE level. batch-build runs as a campaign CHILD, so it
// must never spawn a child of its own — the integrate step is an inline agent.
// (A nested call here once made every campaign wave silently land nothing.)
// workflow() nesting is ONE level. batch-build runs as a campaign CHILD, so it
// must never spawn a child of its own — a nested call once made every campaign
// wave silently land nothing.
test('batch-build never nests a child workflow', () => {
  assert.doesNotMatch(text, /await workflow\(/);
  // Integration is not a child, not a phase, and not a separate agent: each
  // unit merges itself as it finishes.
  assert.doesNotMatch(text, /TYPES\.integrator/);
  assert.match(text, /There is no integrate PHASE/);
  assert.match(text, /batch-integrate\.workflow\.mjs survives as a REPAIR tool/);
});

// A build that THROWS must cost its own unit and nothing else. Resetting the
// chain to null on rejection told the next implementer it was the first build
// of the batch — handing it the create-the-trunk instructions on a batch whose
// trunk already carries merged case work, which `-B` would discard.
// A thrown build costs its own unit and nothing else: the trunk is where it
// was, so the next unit still starts from a known state.
test('a thrown build costs its unit, not the run', () => {
  assert.match(text, /try \{\n\s*phase\('Build'\)\n\s*await buildUnit\(u, pre\)/);
  assert.match(text, /build failed:/);
  assert.match(text, /continuing with the next unit/);
});

// The runtime caps a workflow at 1000 agents for its LIFETIME and nothing
// degrades there — the 1001st agent() throws mid-phase, killing a batch with
// its work unreported. The worst case is knowable from args, so it is said
// before anything runs. Warning, not refusal: the worst case assumes every
// unit burns every fix round, which a healthy batch never does.
test('the run warns when its worst-case agent count approaches the runtime cap', () => {
  assert.match(text, /lifetime cap is 1000/);
  assert.match(text, /const perUnit = 3 \+ FIX_ROUNDS \+ \(FIX_ROUNDS \+ 1\) \* \(PANEL \? REVIEW_LENSES\.length : 1\)/);
  assert.match(text, /UNITS\.length \* perUnit \+ 2/);          // + gate, reporter
  assert.match(text, /Split it into smaller batches/);          // actionable, not just alarming
});

// The projection has to be arithmetic anyone can check, and it has to be an
// UPPER bound — a projection that under-counts is worse than none.
test('the worst-case projection is a true upper bound on dispatches', () => {
  const perUnit = (fixRounds, lenses) => 2 + fixRounds + (fixRounds + 1) * lenses;
  // One unit, default 8 fix rounds, single reviewer: analyst + impl + 8 fixes
  // + 9 reviews (the first, plus one after each fix).
  assert.equal(perUnit(8, 1), 19);
  // A 3-lens panel triples only the reviews, never the builds.
  assert.equal(perUnit(8, 3), 37);
  // 50 units on a panel is already past the point of warning.
  assert.ok(50 * perUnit(8, 3) + 3 > 900);
  // A default 5-case batch is nowhere near it — the warning must stay rare.
  assert.ok(5 * perUnit(8, 1) + 3 < 900);
});

// Every agent must be filed under a phase meta DECLARES, or the progress tree
// grows an orphan group that no `phases` entry describes.
test('every agent phase is one meta declares', () => {
  const declared = new Set([...text.matchAll(/title: '([^']+)'/g)].map((m) => m[1]));
  const used = new Set([...text.matchAll(/phase: '([^']+)'/g)].map((m) => m[1]));
  for (const p of used) assert.ok(declared.has(p), `agent phase '${p}' is not in meta.phases`);
  // And the analysis/build split must actually be used — they are the loop.
  assert.ok(used.has('Analysis') && used.has('Build'));
});

// A batch's FIRST analyst commits its AFS — so the trunk has to exist before
// it does. Nothing else creates it that early: the implementer runs after.
// Without this the first analyst commits and PUSHES onto base, which is the
// exact hazard serialising exists to remove, inverted.
test('the trunk is ensured by the analyst, before anything commits to it', () => {
  assert.match(text, /FIRST make sure you are on the batch trunk/);
  assert.match(text, /git rev-parse --verify \$\{TRUNK\}/);
  assert.match(text, /if it exists NOWHERE, create and push it/);
  assert.match(text, /Never -B a trunk that already exists/);
});

// An analysis-only pass (the campaign heads run) has no build after it and no
// branch switching, and the next stage reads the files out of this same tree —
// so committing them would put doc commits on a branch nothing merges.
test('an analyze-only pass leaves its AFS on disk instead', () => {
  assert.match(text, /ANALYZE_ONLY\n\s*\? 'YOU OWN THE TREE RIGHT NOW and nothing else runs\. This is an ANALYSIS-ONLY pass/);
  assert.match(text, /LEAVE them there uncommitted/);
});

// The PREAMBLE asks every dispatch for findings[]. A schema with
// additionalProperties:false that omits it makes an obedient agent's return
// invalid — and this unit would be parked despite a clean merge.
test('every schema that gets the preamble can carry findings', () => {
  const merge = text.slice(text.indexOf('label: `merge:'), text.indexOf('label: `merge:') + 1400);
  assert.match(merge, /findings: FINDINGS/);
  assert.match(text, /addFindings\(ids, landed\.findings\)/);
});

// Removing an arg silently changes behaviour: `skipIntegrate: true` used to
// stop before integrate+gate and would otherwise now run a full gate.
test('args removed by the redesign fail loudly', () => {
  assert.match(text, /removed arg\(s\):/);
  for (const a of ['analystConcurrency', 'skipIntegrate', 'integratorModel']) {
    assert.ok(text.includes(`'${a}'`), `${a} should be rejected explicitly`);
  }
});

// Both loop phases must be entered, or /workflows shows the bulk of the run
// as never-started.
test('the loop enters the phases meta declares', () => {
  assert.match(text, /phase\('Analysis'\)/);
  assert.match(text, /phase\('Build'\)/);
});

// The report writer may commit — so it must put the tree back, or the next
// campaign wave's first analyst inherits a tree on base.
test('the report writer returns the tree to the trunk', () => {
  assert.match(text, /RETURN THE TREE TO \$\{gateBranch\}/);
});

// ---- context-economy + cost contracts (2026-07-31 field audit) -------------
// Measured on a real project: the bill was resident-context × turns — workers
// averaged ~30 turns at ~1 tool call per turn, and unbounded report rows
// inflated one report-writer prompt to 74k chars. These pins keep the fixes.

test('PREAMBLE carries the context-economy rules for every dispatch', () => {
  assert.match(text, /Context economy \(hard rules\)/);
  assert.match(text, /batch independent tool calls into ONE message/i);
  assert.match(text, /screenshots only when a step fails or visual/i);
  // The turn budget is a self-check that scales per case — never a hard cap.
  assert.match(text, /~15 tool turns per case/);
  assert.match(text, /self-check not a cap/);
});

test('report rows are clipped at the source; full text lives in receipts', () => {
  assert.match(text, /const CLIP = 400/);
  assert.match(text, /p\.note = clip\(p\.note\)/);          // record()
  assert.match(text, /note: clip\(f\.note\)/);              // addFindings()
  assert.match(text, /signature: clip\(f\.signature\)/);    // gate failures
  assert.match(text, /why: clip\(p\.why\)/);                // parked units
  assert.match(text, /_returns\//);                         // pointer to the receipts
});

test('mechanical slots default to the cheap tier; judgment slots follow frontmatter', () => {
  // merge-back + report writer: haiku by default, arg-overridable — the two
  // deliberate frontmatter overrides.
  assert.match(text, /A\.mergeModel \?\? A\.workerModel \?\? 'haiku'/);
  assert.match(text, /A\.reporterModel \?\? 'haiku'/);
  // analyst/implementer/gate/reviewer pass NO model unless an arg overrides —
  // the installed AGENT.md frontmatter `model:` is the configuration surface.
  // In particular no hardcoded model literal may reappear on the reviewer.
  assert.doesNotMatch(text, /reviewerModel \?\? A\.workerModel \?\? '/);
  assert.match(text, /frontmatter `model:` governs/);
});

// Field incident 2026-08-03: `git stash --include-untracked` before a checkout
// swept 6 memory entries + 3 receipts out of the tree. `.agents/` state is
// untracked by design, so an unscoped clean removes it with no diff and no error.
test('no wholesale tree cleaning: receipts + fresh writes are protected', () => {
  assert.match(text, /NEVER CLEAN THE TREE WHOLESALE/);
  assert.match(text, /git stash --include-untracked/);
  assert.match(text, /git stash push -- /);          // the scoped alternative
  assert.match(text, /untracked bookkeeping/);       // receipts stay untracked; memory no longer is
});

// A parked unit's code stays on its branch, but its knowledge lands anyway —
// failure units produce the best gotchas, and stranding them on an unmerged
// branch is how they get lost.
test('a parked unit lands its memory on the trunk before reporting', () => {
  assert.match(text, /LAND THE UNIT'S KNOWLEDGE ANYWAY/);
  assert.match(text, /-- \.agents\/memory\//);
  assert.match(text, /learnings from a parked unit/);
});

// Tiering: the standalone analyst earns its cost on NOVEL ground. A cheap
// triage dispatch routes mapped-surface units to a COMBINED analyse+build
// slot — one implementer dispatch where the normal chain spends two — with
// two conservative escapes: triage defaults to 'analyst' on any doubt, and
// the combined slot itself returns needs-analyst BEFORE writing anything
// when the ground turns out novel.
test('analyst tiering: triage routes mapped units to a combined slot, conservatively', () => {
  assert.match(text, /const TIERING = A\.tiering \?\? 'auto'/);
  assert.match(text, /READ-ONLY routing decision/);
  assert.match(text, /model: A\.triageModel \?\? 'haiku', effort: 'low', schema: TRIAGE_SCHEMA/);
  // doubt routes to the analyst, and the cost asymmetry is stated where the choice is made
  assert.match(text, /your own doubt — routes 'analyst'/);
  assert.match(text, /a wasted analyst dispatch costs one dispatch; a combined slot on novel ground costs a bad AFS/);
  // the combined slot's escape hatch fires BEFORE any write, and falls back cleanly
  assert.match(text, /return status needs-analyst with why in notes and STOP/);
  assert.match(text, /if \(c === 'fallback'\) u = await runAnalyst\(unit\)/);
  // the combined slot still executes live and still lands the AFS on the trunk first
  assert.match(text, /the digest speeds travel, it never replaces execution/);
  assert.match(text, /push BEFORE you start building/);
  // a dead triage costs nothing — the conservative route is the default route
  assert.match(text, /triage agent died — every unit takes the standalone analyst/);
  // the pre-built path skips the implement dispatch but not review/merge/gate
  assert.match(text, /const impl = pre \?\? await agent\(/);
});

// An interrupted gate returns `not-run` (or the gate agent drops to null) —
// that is NOT a red. Field measurement: a session killed mid-gate reported
// "blocked: 14" while 13 of the 14 units were already built, reviewed and
// merged on the trunk; the false negative sent the lead classifying phantom
// blocks. Merged-but-unproven units carry their own outcome so a dead run's
// summary can never claim they failed.
test('gate not-run is not a red: merged units become merged-ungated, never blocked', () => {
  assert.match(text, /\} else if \(!gate \|\| gate\.verdict === 'not-run' \|\| gate\.verdict === 'incomplete'\) \{/);
  assert.match(text, /outcome: 'merged-ungated'/);
  assert.match(text, /UNPROVEN, not blocked/);
  // the next-step guidance stops the lead from trusting the totals
  assert.match(text, /GATE NEVER RAN/);
  assert.match(text, /An interrupted run's own totals are a claim, not evidence/);
  // the real-red path still records blocked
  assert.match(text, /outcome: 'blocked', note: why/);
});

// A gate CUT OFF mid-run knows things a gate that never started does not: how
// many runs already went green, and where to resume. Collapsing both into
// 'not-run' is what made three real recoveries restart from zero.
test("'incomplete' is a distinct gate verdict from 'not-run', and says where to resume", () => {
  assert.match(text, /enum: \['green', 'red', 'not-run', 'incomplete'\]/);
  assert.match(text, /use verdict 'incomplete', NOT 'not-run'/);
  assert.match(text, /gate CUT OFF mid-run/);
  assert.match(text, /run\(s\) already green before it was cut off/);
});

// The receipt is the deliverable: two audits running, leads recover the gate
// flawlessly and then never correct report.json, so genuinely-green specs score
// as unproven forever. The obligation has to live where the lead reads it.
test('the not-run/incomplete next-step orders the report.json write-back, with the label choice', () => {
  assert.match(text, /WRITE IT BACK INTO \$\{REPORT_DIR\}\/report\.json/);
  assert.match(text, /gate\.verdict, gate\.runs, gate\.seconds/);
  assert.match(text, /'merged-sanctioned-red' for a ticketed red-by-design/);
  assert.match(text, /scores as ZERO delivered/);
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

// The R2 cap is per ROOT CAUSE, not per unit-total: 4 reruns on 4 distinct
// causes is within contract. Capping the total blocked healthy units twice in
// the field and made the lead hand-edit report.json to undo it. Without
// rerun_causes the total remains the conservative fallback.
test('R2 cap counts reruns per root cause, with the total as fallback', () => {
  assert.match(text, /rerun_causes: \{ type: 'array', items: \{ type: 'string' \} \}/);
  assert.match(text, /rerun_causes: IMPL_SCHEMA\.properties\.rerun_causes/);
  assert.match(text, /worstCause \? worstCause\[1\] > 2 : impl\.reruns > 2/);
  assert.match(text, /causes not reported/);
  // both dispatch prompts carry the per-cause contract
  assert.match(text, /one short root-cause label per rerun/);
});
