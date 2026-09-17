import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseExecutionBlock, parseTaskHeadings, importTasksMarkdown } from './plan-markdown.mjs';
import { validatePlan, validateIds, assignIds } from './plan.mjs';

const text = readFileSync(new URL('../../fixtures/plan-markdown/tasks-excerpt.md', import.meta.url), 'utf8');
const opts = { campaign_id: 'sec', run_id: 'run-1', observation_start: '2026-09-15T00:00:00Z' };

test('parseExecutionBlock: bounded to the block, columns, continuation lines, dependency notes ignored', () => {
  assert.deepEqual(parseExecutionBlock(text), [
    { ref: 'G0', nums: ['001', '055'] }, { ref: 'G1', nums: ['003', '004'] }, { ref: 'G2', nums: ['002'] },
    { ref: 'G6', nums: ['008', '013', '032', '058'] }, { ref: 'G7', nums: ['012', '029'] }]);
  assert.deepEqual(parseExecutionBlock('# no plan here\n| G0 | 001 |\n'), [], 'tables outside the block are not memberships');
});

// F1: stripping "(...)" dependency/annotation notes to a single space can leave a *run* of
// spaces immediately before a ` · ` delimiter (e.g. "ledger (+ empty assessment inputs) · 029"
// becomes "ledger   · 029"). A combined `\s·\s|\s{2,}` split lets the whitespace-run
// alternative win first, consuming the delimiter's own spacing and leaving a column that
// starts with "· 029" — the leading `\d{3,}` never matches and the membership is lost. This is
// exactly the real shape from feat/security-testing-bundle-spec's G5 line (five memberships —
// TASK-029, TASK-031, TASK-045, TASK-046, TASK-051 — were dropped before this fix).
test('parseExecutionBlock: F1 — whitespace left by stripped parentheses before " · " does not eat the delimiter', () => {
  const line = '012 run init/ledger (+ empty assessment inputs) · 029 transitions (+ ticketed)';
  const block = `## 1. Execution plan\n\n\`\`\`\nG7   ${line}\n\`\`\`\n`;
  assert.deepEqual(parseExecutionBlock(block), [{ ref: 'G7', nums: ['012', '029'] }]);
});

test('parseTaskHeadings: story/class/role, Assigned to: variant', () => {
  const t = parseTaskHeadings(text);
  assert.equal(t.size, 12);
  assert.deepEqual(t.get('TASK-001'), { ref: 'TASK-001', title: 'Repo docs match the installer', story: 'US-001', class: 'S', role: 'maintainer / js-dev', num: '001', branch: 'task/task-001' });
  assert.equal(t.get('TASK-055').role, 'js-dev');
});

test('importTasksMarkdown: groups → missions, no estimates, ungrouped warning, valid plan', () => {
  const { plan, warnings } = importTasksMarkdown(text, opts);
  assert.deepEqual(validatePlan(plan), []); assert.deepEqual(validateIds(assignIds(plan)), []);
  assert.deepEqual(plan.missions.map((m) => [m.ref, m.sequence, m.tasks.map((t) => t.ref)]), [
    ['G0', 1, ['TASK-001', 'TASK-055']], ['G1', 2, ['TASK-003', 'TASK-004']], ['G2', 3, ['TASK-002']],
    ['G6', 4, ['TASK-008', 'TASK-013', 'TASK-032', 'TASK-058']], ['G7', 5, ['TASK-012', 'TASK-029']], ['ungrouped', 6, ['TASK-099']]]);
  assert.ok(plan.missions.every((m) => m.tasks.every((t) => t.estimate == null)));
  assert.equal(plan.import.basis, 'markdown-import'); assert.equal(plan.import.task_count, 12); assert.equal(plan.import.group_count, 5);
  assert.match(plan.import.source_sha256, /^[0-9a-f]{64}$/);
  assert.match(warnings.join('\n'), /TASK-099.*not listed in any group/);
  assert.match(importTasksMarkdown('# empty', opts).warnings.join('\n'), /no TASK headings/);
});

// Step 4 sanity check from the brief, run against the real, pinned tasks-file: every task
// belongs to exactly one group (30 groups, 59 memberships, 59 distinct members, 59 headings).
test('real-file check: feat/security-testing-bundle-spec tasks-v2.md — 30 groups, 59/59 memberships, 59 headings', () => {
  const real = execFileSync('git', ['show', 'feat/security-testing-bundle-spec:docs/superpowers/plans/2026-09-15-security-testing-bundle-tasks-v2.md'], { encoding: 'utf8', cwd: new URL('../../../..', import.meta.url) });
  const groups = parseExecutionBlock(real);
  const nums = groups.flatMap((g) => g.nums);
  assert.equal(groups.length, 30);
  assert.equal(nums.length, 59);
  assert.equal(new Set(nums).size, 59);
  assert.equal(parseTaskHeadings(real).size, 59);
});
