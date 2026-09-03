import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  extractSection,
  splitTableRow,
  jaccardOverlap,
  stepsWellFormedCheck,
  scoreFileContent,
  possibleGoldLeakCheck,
  scoreCase,
} from './score-test-author-output.mjs';

const GOOD_TC = `---
id: TC-001
title: Login with valid credentials
priority: critical
type: functional
module: authentication
---

# TC-001: Login with Valid Credentials

## Preconditions
- App is accessible at \`{{base_url}}\`
- Test user exists

## Steps

| # | Action | Expected Result |
|---|--------|------------------|
| 1 | Navigate to \`{{base_url}}/login\` | Login page loads |
| 2 | Click "Sign In" | Redirects to \`/dashboard\` |

## Expected Final State
User is on the dashboard.

## Teardown
- Navigate to \`{{base_url}}/logout\`
`;

test('parseFrontmatter: reads scalar YAML keys from the frontmatter block', () => {
  const fm = parseFrontmatter(GOOD_TC);
  assert.equal(fm.id, 'TC-001');
  assert.equal(fm.priority, 'critical');
  assert.equal(fm.type, 'functional');
});

test('parseFrontmatter: returns null when there is no frontmatter block', () => {
  assert.equal(parseFrontmatter('# just a heading\nno frontmatter here'), null);
});

test('extractSection: grabs content between a heading and the next "## " heading', () => {
  const section = extractSection(GOOD_TC, 'Expected Final State');
  assert.equal(section, 'User is on the dashboard.');
});

// Regression guard: JS has no \Z end-of-string regex anchor, so a naive
// lookahead-based extractor silently truncates a section whose body
// contains a literal "z"/"Z" character (e.g. "freshly", "sizes"). Line-based
// splitting must not have this bug.
test('extractSection: does not truncate on a section body containing the letter z', () => {
  const content = `## Expected Final State\nThe cart is freshly emptied and sizes reset.\n\n## Teardown\n- none\n`;
  assert.equal(extractSection(content, 'Expected Final State'), 'The cart is freshly emptied and sizes reset.');
});

test('extractSection: returns null when the heading is absent', () => {
  assert.equal(extractSection(GOOD_TC, 'Test Data'), null);
});

test('splitTableRow: treats an escaped backslash-pipe as a literal character, not a delimiter', () => {
  const row = '| 1 | Click `role=link[name="All"\\|"Active"\\|"Completed"]` | Filter applied |';
  const cells = splitTableRow(row);
  // header/footer empty strings from the leading/trailing '|', plus 3 real cells
  assert.equal(cells.length, 5);
  assert.equal(cells[2], 'Click `role=link[name="All"|"Active"|"Completed"]`');
});

test('stepsWellFormedCheck: true for a header + separator + >=1 well-formed data row', () => {
  const steps = '| # | Action | Expected Result |\n|---|--------|------------------|\n| 1 | Do X | Y happens |';
  assert.equal(stepsWellFormedCheck(steps), true);
});

test('stepsWellFormedCheck: false when a data row is missing a cell', () => {
  const steps = '| # | Action | Expected Result |\n|---|--------|------------------|\n| 1 | Do X |  |';
  assert.equal(stepsWellFormedCheck(steps), false);
});

test('stepsWellFormedCheck: false for an empty/absent Steps section', () => {
  assert.equal(stepsWellFormedCheck(null), false);
  assert.equal(stepsWellFormedCheck(''), false);
});

test('jaccardOverlap: 0 for disjoint text, 1 for identical text', () => {
  assert.equal(jaccardOverlap('completely different words used here now', 'nothing shares any five word span'), 0);
  const same = 'navigate to the login page and click sign in now';
  assert.equal(jaccardOverlap(same, same), 1);
});

test('scoreFileContent: a well-formed produced file passes every applicable check', () => {
  const scored = scoreFileContent(GOOD_TC, { must_use_placeholder: true, expected_teardown: true });
  assert.equal(scored.frontmatter_complete, true);
  assert.equal(scored.base_url_used_correctly, true);
  assert.equal(scored.steps_table_well_formed, true);
  assert.equal(scored.preconditions_present, true);
  assert.equal(scored.expected_final_state_present, true);
  assert.equal(scored.teardown_correct, true);
});

test('scoreFileContent: flags a hardcoded real domain when a placeholder is required', () => {
  const withHardcodedDomain = GOOD_TC.replace('{{base_url}}/login', 'https://example.com/login');
  const scored = scoreFileContent(withHardcodedDomain, { must_use_placeholder: true });
  assert.equal(scored.base_url_used_correctly, false);
});

test('scoreFileContent: tolerates the documented "{{base_url}}` (`https://real/...`)" gloss convention', () => {
  const withGloss = GOOD_TC.replace(
    '`{{base_url}}`',
    '`{{base_url}}` (`https://staging.example.com`)'
  );
  const scored = scoreFileContent(withGloss, { must_use_placeholder: true });
  assert.equal(scored.base_url_used_correctly, true);
});

test('scoreFileContent: teardown_correct is null (not applicable) when ground truth has no opinion', () => {
  const scored = scoreFileContent(GOOD_TC, {});
  assert.equal(scored.teardown_correct, null);
});

test('scoreFileContent: selector_reuse checks presence of every documented selector', () => {
  const withSelector = GOOD_TC.replace('Click "Sign In"', 'Click [data-testid="sign-in"]');
  const scored = scoreFileContent(withSelector, { known_selectors: ['[data-testid="sign-in"]', '[data-testid="never-used"]'] });
  assert.equal(scored.selector_reuse.hits, 1);
  assert.equal(scored.selector_reuse.of, 2);
  assert.equal(scored.selector_reuse.pass, true); // >=1 hit is a pass
});

test('possibleGoldLeakCheck: flags near-verbatim overlap with the best-matching gold file', () => {
  const producedSteps = extractSection(GOOD_TC, 'Steps');
  const goldContent = GOOD_TC; // identical Steps section -> overlap 1.0
  const readGold = () => goldContent;
  const result = possibleGoldLeakCheck(producedSteps, { gold_path: 'gold/case-1.md' }, '/eval-root', readGold);
  assert.equal(result.flagged, true);
  assert.equal(result.overlap_ratio, 1);
  assert.equal(result.best_match_gold_path, 'gold/case-1.md');
});

test('possibleGoldLeakCheck: does not flag ordinary, non-overlapping authoring', () => {
  const producedSteps = 'navigate to settings and toggle dark mode then confirm the theme switches';
  const readGold = () => '## Steps\n| # | Action | Expected Result |\n|---|---|---|\n| 1 | totally unrelated flow about billing invoices | some other outcome |';
  const result = possibleGoldLeakCheck(producedSteps, { gold_path: 'gold/case-2.md' }, '/eval-root', readGold);
  assert.equal(result.flagged, false);
});

test('possibleGoldLeakCheck: returns null when ground truth has no gold_path/gold_paths', () => {
  assert.equal(possibleGoldLeakCheck('anything', {}, '/eval-root', () => 'x'), null);
});

test('possibleGoldLeakCheck: multi-scenario gold_paths takes the BEST match across the set', () => {
  const producedSteps = 'click add to cart then confirm the cart badge count increments by one';
  const golds = {
    'gold/a.md': '## Steps\n| # | Action | Expected Result |\n|---|---|---|\n| 1 | totally unrelated billing flow | outcome |',
    'gold/b.md': '## Steps\n| # | Action | Expected Result |\n|---|---|---|\n| 1 | click add to cart then confirm the cart badge count increments by one | outcome |',
  };
  const readGold = (p) => golds[p];
  const result = possibleGoldLeakCheck(producedSteps, { gold_paths: ['gold/a.md', 'gold/b.md'] }, '/eval-root', readGold);
  assert.equal(result.best_match_gold_path, 'gold/b.md');
});

test('scoreCase: no output directory at all -> error, no crash', () => {
  const result = scoreCase('case-1', {}, null, {}, '/eval-root', () => null);
  assert.equal(result.error, 'no output found for this case');
  assert.equal(result.deterministic_pass_pct, null);
});

test('scoreCase: output directory exists but has no TC-*.md files -> error, no crash', () => {
  const result = scoreCase('case-1', {}, [], {}, '/eval-root', () => null);
  assert.equal(result.error, 'output dir exists but no TC-*.md files found');
});

test('scoreCase: a fully-conformant single-file case scores 100%', () => {
  const gt = { expected_behavior_count: 1, must_use_placeholder: true };
  const result = scoreCase('case-1', gt, ['TC-001_login.md'], { 'TC-001_login.md': GOOD_TC }, '/eval-root', () => null);
  assert.equal(result.deterministic_pass_pct, 100);
  assert.equal(result.possible_gold_leak_flagged, false);
});

test('scoreCase: behavior_count_match fails and drags down the score when the split is wrong', () => {
  const gt = { expected_behavior_count: 2 };
  const result = scoreCase('case-1', gt, ['TC-001_login.md'], { 'TC-001_login.md': GOOD_TC }, '/eval-root', () => null);
  assert.equal(result.checks.behavior_count_match.pass, false);
  assert.ok(result.deterministic_pass_pct < 100);
});

test('scoreCase: one malformed file among several drags the WHOLE case down, not averaged away silently', () => {
  const malformed = GOOD_TC.replace(/---[\s\S]*?---/, '---\nid: TC-002\n---'); // missing required frontmatter fields
  const gt = { expected_behavior_count: 2 };
  const result = scoreCase(
    'case-1', gt,
    ['TC-001_login.md', 'TC-002_broken.md'],
    { 'TC-001_login.md': GOOD_TC, 'TC-002_broken.md': malformed },
    '/eval-root', () => null
  );
  const flags = result.checks.per_file.map(f => f.frontmatter_complete);
  assert.deepEqual(flags, [true, false]);
  assert.ok(result.deterministic_pass_pct < 100);
});
