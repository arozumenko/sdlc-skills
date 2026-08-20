import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The fix loop's stop condition is a CONTRACT, not an implementation detail of
// one script. It has to hold in three places that cannot share code:
//
//   1. batch-build.workflow.mjs   — case builds, Claude Code
//   2. batch-campaign.workflow.mjs — the foundation stage, Claude Code
//   3. the reference docs          — the ONLY copy that exists on GitHub
//      Copilot, on Codex, and on any run where the operator drives sequential
//      subagent dispatches instead of a workflow
//
// Workflow scripts run in a sandbox with no module access, so 1 and 2 are
// duplicated on purpose. Duplication that nothing checks is drift with a
// delay — these tests are the check.

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const build = read('./batch-build.workflow.mjs');
const campaign = read('./batch-campaign.workflow.mjs');
const refs = (p) => read(`../../references/${p}`);

/** The function body, comments and trailing semicolons normalised away. */
function loopVerdictBody(text) {
  const m = text.match(/^function loopVerdict[\s\S]*?\n\}/m);
  assert.ok(m, 'loopVerdict not found');
  return m[0]
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/;\s*$/, '').trimEnd())
    .join('\n');
}

test('the two duplicated loopVerdict copies are identical', () => {
  assert.equal(loopVerdictBody(build), loopVerdictBody(campaign),
    'batch-build and batch-campaign must decide "go round again" the same way');
});

test('both copies bias toward finishing the work, never toward stopping', () => {
  for (const [name, text] of [['build', build], ['campaign', campaign]]) {
    const body = loopVerdictBody(text);
    // Anything unaddressed → another round, whatever else is in the list.
    assert.match(body, /if \(unaddressed\.length\) return \{ go: true/, name);
    // No classification at all → keep going, flagged, rather than stop.
    assert.match(body, /if \(!detail\.length\) return \{ go: true, why: null, unclassified: true \}/, name);
    // The only `go: false` is the one where effort cannot help.
    assert.equal((body.match(/go: false/g) ?? []).length, 1, `${name}: exactly one stop path`);
  }
});

test('both loops stop a reviewer that refuses to classify, instead of burning the backstop', () => {
  for (const [name, text] of [['build', build], ['campaign', campaign]]) {
    assert.match(text, /unclassified = v\.unclassified \? unclassified \+ 1 : 0/, name);
    assert.match(text, /if \(unclassified >= 2\)/, name);
  }
});

// The non-workflow path has no script to enforce anything. If the contract is
// not in the docs the reviewer and the implementer load, it simply does not
// exist on Copilot, on Codex, or in a hand-run batch.
test('the reviewer contract carries the classification for hosts with no workflow', () => {
  const r = refs('reviewer-contract.md');
  assert.match(r, /On a RE-REVIEW: classify every surviving blocker/);
  for (const status of ['unaddressed', 'persists', 'external']) assert.match(r, new RegExp(`\`${status}\``));
  assert.match(r, /Forgotten and half-done both belong here/);
  assert.match(r, /Another round/);
  // The two ways a reviewer can break the loop, named so they can be resisted.
  assert.match(r, /Do not use `persists` to end a loop you find tiresome/);
  assert.match(r, /Do not withhold the classification/);
});

test('the implementer contract separates rerun budget from fix rounds', () => {
  const i = read('../../../test-automation-implementation/SKILL.md');
  assert.match(i, /NOT a budget for fix rounds after a review/);
  assert.match(i, /Address every blocking finding/);
  // "I couldn't, because X" must be a first-class answer, or silence wins.
  assert.match(i, /say so in `notes` with the reason/);
  assert.match(i, /Leaving it silent is not/);
});

test('the playbook tells a lead running the loop by hand to use the same rule', () => {
  const p = refs('orchestration-playbook.md');
  assert.match(p, /The fix loop runs until the reviewer APPROVES/);
  assert.match(p, /go round again/);
  assert.match(p, /running by hand, you are the loop, and the contract is identical/);
  // The conflation that caused the bug is called out where it happened.
  assert.match(p, /It is not about review rounds/);
  assert.match(p, /Implementer reruns/);
});

// An agent that ends its turn waiting on a background job is not waiting — it
// is done. Nothing wakes it, no operator watches an individual slot, and the
// parent blocks on a return that never comes. This is NOT implementer-specific:
// the gate runs the suite N consecutive times, which is the longest job in the
// pipeline, so it is the most exposed slot of all.
// The rule has three legs and every one of them was learned the hard way:
// name the call ceiling (a suite run silently dies at the 120s default), name
// blocking sleep as the way to wait (nothing said waiting was legal, so a gate
// busy-polled itself to death), and forbid ending a turn (measured: enforced
// 28ms later, no wake by any pattern). A workflow missing any leg leaves the
// slot with an unsatisfiable instruction.
test('every workflow tells every worker how to run AND how to wait on long jobs', () => {
  for (const [name, text] of [['build', build], ['campaign', campaign],
    ['stabilize', read('./batch-stabilize.workflow.mjs')]]) {
    assert.match(text, /timeout: 600000/, name);                        // the ceiling, stated
    assert.match(text, /sleep 300/, name);                              // how to wait
    assert.match(text, /NEVER end a turn while a job is running/, name);
    assert.match(text, /nothing will wake you/, name);
    assert.match(text, /NEVER poll at second-level intervals/, name);
  }
});

test('the gate slots carry the rule, not just the implementers', () => {
  // batch-build's gate + batch-campaign's mini-gate each state it inline.
  // Bound each slice by the dispatch's own opts object rather than a character
  // count, so growing the prompt can never silently drop the assertion.
  const gateStart = build.indexOf('Hardening gate for batch');
  const gateBuild = build.slice(gateStart, build.indexOf('label: `gate:', gateStart));
  assert.match(gateBuild, /FOREGROUND_RULE/);
  const miniStart = campaign.indexOf('Mini-gate for the campaign foundation');
  const miniGate = campaign.slice(miniStart, campaign.indexOf('label:', miniStart));
  assert.match(miniGate, /FOREGROUND_RULE/);
});

// A fix that lands only in the workflow script silently excludes every host
// without the Workflow tool — where the orchestrator IS the loop and the
// playbook's dispatch template is what a gate slot actually receives. That
// template used to instruct `--n {GATE_N}`, i.e. the exact call shape that
// killed three gates, so the two paths must be asserted together.
test('the sequential path gets the same gate run shape, not just the workflow', () => {
  const p = refs('orchestration-playbook.md');
  const tpl = p.slice(p.indexOf('Hardening gate for batch {SLUG}'));
  assert.match(tpl.slice(0, 2000), /`--n 1`, foreground, with timeout: 600000/);
  assert.match(tpl.slice(0, 2000), /Do NOT pass\n?`--n \{GATE_N\}`/);
  assert.match(tpl.slice(0, 2000), /sleep 300/);
  // and the verdict vocabulary matches the workflow's schema
  assert.match(tpl.slice(0, 2000), /green\|red\|not-run\|incomplete/);
  assert.doesNotMatch(tpl.slice(0, 1200), /plus `--n \{GATE_N\}`/,
    'the old template told the gate to run all N in one process');
});

test('the cross-slot rule is in the docs, so it holds without a workflow too', () => {
  const p = refs('orchestration-playbook.md');
  assert.match(p, /Never idle on a background job — every slot, not just the implementer/);
  assert.match(p, /a slot that idles looks exactly like a slot that is thinking/i);
  // The gate is named as the most exposed, since it is the least obvious.
  assert.match(p, /N consecutive\*\* suite runs/);
  const i = read('../../../test-automation-implementation/SKILL.md');
  assert.match(i, /Run it in the FOREGROUND/);
  assert.match(i, /Never end a turn with "I'll wait for this to complete"/);
});

test('the accelerant explains why stabilize keeps a round bound and the review loop does not', () => {
  const a = refs('workflow-accelerant.md');
  assert.match(a, /Loops end on evidence, not on a counter/);
  assert.match(a, /`fixed` or `blocked` \*\*per cause\*\*/);
  assert.match(a, /"silently not\s*\n?\s*done" is not representable there/);
});
