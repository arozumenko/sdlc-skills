import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeCase, summarize } from './score-test-runner-output.mjs';

test('gradeCase: no ground-truth entry -> error, no crash', () => {
  const result = gradeCase('TC-999', undefined, { tc_id: 'TC-999', result: 'PASS' });
  assert.equal(result.error, 'no ground-truth entry for this case');
});

test('gradeCase: missing actual result is flagged "missing", not silently scored incorrect or correct', () => {
  const gt = { bug_mode: 'scripted-known-good', expected_result: 'PASS' };
  const result = gradeCase('TC-001', gt, null);
  assert.equal(result.missing, true);
  assert.equal(result.correct, false);
  assert.equal(result.false_negative, false);
  assert.equal(result.false_positive, false);
});

test('gradeCase: scripted-known-good case matching PASS is correct', () => {
  const gt = { bug_mode: 'scripted-known-good', expected_result: 'PASS' };
  const result = gradeCase('TC-001', gt, { tc_id: 'TC-001', result: 'PASS' });
  assert.equal(result.correct, true);
  assert.equal(result.false_negative, false);
  assert.equal(result.false_positive, false);
});

test('gradeCase: blind-detection case whose expected FAIL was reported PASS is a false negative', () => {
  const gt = { bug_mode: 'blind-detection', expected_result: 'FAIL' };
  const result = gradeCase('TC-002', gt, { tc_id: 'TC-002', result: 'PASS' });
  assert.equal(result.correct, false);
  assert.equal(result.false_negative, true);
  assert.equal(result.false_positive, false);
});

test('gradeCase: blind-detection case correctly caught (expected FAIL, actual FAIL) is correct, not a false negative', () => {
  const gt = { bug_mode: 'blind-detection', expected_result: 'FAIL' };
  const result = gradeCase('TC-002', gt, { tc_id: 'TC-002', result: 'FAIL' });
  assert.equal(result.correct, true);
  assert.equal(result.false_negative, false);
});

test('gradeCase: a healthy case wrongly reported FAIL is a false positive', () => {
  const gt = { bug_mode: 'scripted-known-good', expected_result: 'PASS' };
  const result = gradeCase('TC-003', gt, { tc_id: 'TC-003', result: 'FAIL' });
  assert.equal(result.correct, false);
  assert.equal(result.false_positive, true);
  assert.equal(result.false_negative, false);
});

test('gradeCase: a disclosed known-bug case matching its documented expected_result is correct', () => {
  // scripted-known-bug: the case DISCLOSES the issue, so the "correct" verdict
  // is whatever the ground truth says it is — often FAIL (the disclosed
  // defect is still observably wrong), sometimes PASS (a documented quirk
  // that is not itself assertion-breaking). Either way this is a plain
  // expected/actual match, same mechanics as scripted-known-good.
  const gt = { bug_mode: 'scripted-known-bug', expected_result: 'FAIL' };
  const result = gradeCase('TC-004', gt, { tc_id: 'TC-004', result: 'FAIL' });
  assert.equal(result.correct, true);
});

test('summarize: computes overall + blind-only accuracy, and counts false negatives/positives/missing separately', () => {
  const graded = [
    gradeCase('TC-001', { bug_mode: 'scripted-known-good', expected_result: 'PASS' }, { tc_id: 'TC-001', result: 'PASS' }), // correct
    gradeCase('TC-002', { bug_mode: 'blind-detection', expected_result: 'FAIL' }, { tc_id: 'TC-002', result: 'PASS' }),      // false negative
    gradeCase('TC-003', { bug_mode: 'blind-detection', expected_result: 'FAIL' }, { tc_id: 'TC-003', result: 'FAIL' }),      // correct, blind
    gradeCase('TC-004', { bug_mode: 'scripted-known-good', expected_result: 'PASS' }, null),                                 // missing
  ];
  const summary = summarize(graded);
  assert.equal(summary.total_cases, 4);
  assert.equal(summary.correct, 2);
  assert.equal(summary.detection_accuracy_pct, 50);
  assert.equal(summary.false_negatives, 1);
  assert.equal(summary.false_positives, 0);
  assert.equal(summary.missing_results, 1);
  assert.equal(summary.blind_detection_case_count, 2);
  assert.equal(summary.blind_detection_accuracy_pct, 50); // 1 of 2 blind cases correct
});

test('summarize: 100% when every case matches ground truth exactly', () => {
  const graded = [
    gradeCase('TC-001', { bug_mode: 'scripted-known-good', expected_result: 'PASS' }, { tc_id: 'TC-001', result: 'PASS' }),
    gradeCase('TC-002', { bug_mode: 'scripted-known-bug', expected_result: 'FAIL' }, { tc_id: 'TC-002', result: 'FAIL' }),
  ];
  const summary = summarize(graded);
  assert.equal(summary.detection_accuracy_pct, 100);
  assert.equal(summary.false_negatives, 0);
  assert.equal(summary.false_positives, 0);
});

test('summarize: errors (missing ground truth) are reported separately, not counted toward the denominator', () => {
  const graded = [
    gradeCase('TC-001', { bug_mode: 'scripted-known-good', expected_result: 'PASS' }, { tc_id: 'TC-001', result: 'PASS' }),
    gradeCase('TC-999', undefined, { tc_id: 'TC-999', result: 'PASS' }),
  ];
  const summary = summarize(graded);
  assert.equal(summary.total_cases, 1);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].tc_id, 'TC-999');
});
