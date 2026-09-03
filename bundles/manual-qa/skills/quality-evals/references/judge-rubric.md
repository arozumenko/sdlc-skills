# Authoring-Track Judge Rubric (Tier B)

The semantic/judgment half of the two-tier grading described in
`../README.md`. Tier A (deterministic, scriptable structural checks) lives in
`../scripts/score-test-author-output.mjs`. This rubric covers the other
half — the things a script cannot check: did the produced test case mean the
same thing the input meant, without inventing or losing anything.

## When this runs

Once per eval case, after `test-author` has produced its output TC-\*.md
file(s) for that case — dispatched to a fresh judge session (or done by a
human), never by the same session that authored the output. The judge needs,
in context, all three of:

1. The manual input (`manual-inputs/<case-id>.{md,xlsx}` or the
   acceptance-criteria bullets, depending on `input_mode`)
2. The gold reference (`gold/<case-id>.md`) — a real, already-trusted test
   case this eval case was built from
3. The produced output — the actual TC-\*.md file(s) `test-author` wrote for
   this case

The judge is **not** `test-author` and never sees the gold file before
scoring — it scores strictly by comparing the **produced output** against
the **manual input's intent**, using gold only as an independent reference
for what a maximally faithful, high-quality authoring pass would have
produced (not as an answer key to pattern-match against verbatim — a
near-verbatim match to gold when the input was deliberately vaguer than gold
is itself suspicious; that's what Tier A's `possible_gold_leak` check is
for).

## Dimensions (0-2 each, cite evidence)

For every dimension, cite the specific line(s) in manual input / gold /
produced output the score is based on — "show your work," the same
discipline `test-runner` already applies when reporting a FAIL with a defect
description.

| Dimension | What it checks | 0 | 1 | 2 |
|---|---|---|---|---|
| `step_fidelity` — Semantic step fidelity | Do the produced Steps cover the same user actions as the manual input, in the same order, without inventing actions absent from the input or the app profile | missing/extra actions change the test's meaning | minor reordering/granularity difference, same net actions | faithful, sensible step-splitting |
| `result_fidelity` — Expected-result fidelity | Does each produced Expected Result correspond to what the manual input's expected outcome implied, not a different (even if plausible) outcome | contradicts or ignores the manual input's stated outcome | roughly matches but drops detail | matches and correctly upgrades vague language into a snapshot-verifiable form |
| `verifiability` — Snapshot-verifiability quality | Are Expected Results phrased as URL / visible-text / element-presence / field-value, per the test-case format's own checklist | still vague ("it works") | verifiable but weakly (assumes/implies) | crisp, matches the checklist |
| `no_hallucination` — No hallucination | No detail appears in the output that is present in **neither** the manual input **nor** the app profile / legitimately-mined sibling test cases (an invented selector, an invented URL path, an invented UI copy string) | fabricates specifics with no traceable source | one minor unsupported detail | fully traceable |
| `selector_reuse` — Selector/convention reuse | Where the app profile or legitimate sibling test cases document a real selector/URL pattern, did the output correctly reuse it rather than inventing an equivalent | ignored available convention, invented own | partially aligned | matches established convention |
| `behavior_split` — One-behavior-per-case judgment | If the manual input bundled multiple behaviors, did `test-author` correctly split into separate files (cross-check against Tier A's file-count check, but judged qualitatively for whether the split boundary was sensible) | didn't split when it should have (or split nonsensically) | split but boundary imperfect | clean, sensible split |
| `teardown_judgment` — Teardown judgment | Where teardown wasn't explicit in the input, did the agent correctly infer whether one was needed (does the test mutate persistent state?) rather than copying a hint verbatim | wrong inference | present but generic/incomplete | correct and specific |
| `priority_type_normalization` — Priority/type normalization | Sloppy input priority/type values normalized sensibly to the enum, consistent with the format spec's own Priority Definitions | wrong bucket | plausible but debatable | matches the gold's own bucket |
| `module_naming` — Frontmatter/module naming judgment | `module`/suite choice reasonable given the input, even without being told the "official" module name used in gold | unrelated/confusing | close but different label | matches or is an equally-valid label |

Max score: 9 x 2 = **18 points** per case.

## Blind-detection twins (`bug_mode: "blind-detection"`)

`test-author` is **not** expected to detect the seeded/real bug itself —
that's `test-runner`'s job (the detection track). It **is** expected to
faithfully reproduce the manual input's deliberately bug-blind framing,
exactly as a human tester's honest sketch would. If the produced output
"improves" the wording enough to either (a) telegraph that something is
wrong, or (b) lose enough snapshot-verifiable specificity that a future
`test-runner` pass would no longer have a fair shot at independent
detection — flag `blind_twin_fidelity_risk: true` in the judge output. This
is a distinct signal from the 9 dimensions above, reported separately, never
folded into the composite score.

### Expected vs. anomalous `blind_twin_fidelity_risk`

A `blind_twin_fidelity_risk: true` finding is **expected and predictable,
not a defect to fix**, specifically when its cause traces back to a fact the
app profile already documented **before** this authoring pass —
`test-author` correctly preferring known, live-confirmed reality over a
naive script is good production judgment, even though it breaks fidelity to
the manual input's deliberately bug-blind framing for eval purposes. Always
check `no_hallucination` alongside the flag:

- **Expected** (do not treat as an agent problem): `blind_twin_fidelity_risk:
  true` AND `no_hallucination` scores 2 (or cites a real, traceable app
  profile / sibling-case fact as the reason). Record in that case's
  `ground-truth.json` entry (a `note` field) whether the seeded issue was
  already documented in the app profile at authoring time — that's what
  turns this into an expected, pre-categorized outcome rather than a
  surprise later, once you're scaling past a handful of cases.
- **Still a genuine anomaly** (investigate normally): `blind_twin_fidelity_risk:
  true` with **no** traceable documented source — i.e. `test-author` diluted
  or telegraphed the blind framing without citing or relying on any real,
  pre-existing fact. That's a hallucination-adjacent leak, not the
  documented-knowledge pattern above, and should be scored/flagged as a real
  quality problem.

This is purely an interpretation rule for grading the eval, not a new
production escalation mechanism — `test-author` cannot reliably distinguish
"the input is stale" from "the app regressed" from "the input is just
wrong" without either a live re-check or an unambiguous specification it
doesn't have in manual-test-case input mode. If your team decides a
different production behavior is warranted, that's a change to
`test-author`'s own rules, not to this rubric.

## Optional: `input_mode: "acceptance-criteria"` cases

If your team's authoring track also accepts feature-level acceptance
criteria (bullets under a user story) instead of only tabular manual test
cases, one AC set can require multiple produced `TC-*.md` files
(decomposition/coverage). Add a tenth dimension for cases whose ground truth
entry has `input_mode: "acceptance-criteria"` (cases with `input_mode`
absent or `"manual-tc"` are unaffected, scored on the 9 dimensions only):

| Dimension | What it checks | 0 | 1 | 2 |
|---|---|---|---|---|
| `ac_coverage` — Acceptance-criteria coverage | Does the FULL SET of produced `TC-*.md` files, taken together, cover every bullet in the input's `expected_scenarios[]` exactly once, with no criterion dropped and no pointless duplication across files | one or more criteria completely uncovered by any produced file | all criteria covered but with an awkward split (over-merged or over-split relative to a sensible boundary) | every criterion covered, boundaries match `expected_scenarios[]`'s intended split |

Max score for AC-mode cases: 10 x 2 = **20 points** (9 base + `ac_coverage`)
— `authoring_fidelity_pct`'s judge-half divisor adjusts accordingly for
these cases (`judge_total / 20` instead of `/ 18`).

**Critical flag `ac_coverage_gap: true`**: set whenever **any** criterion in
`expected_scenarios[]` has zero produced file addressing it — reported
separately, never averaged into the composite, same treatment as
`blind_twin_fidelity_risk` and any `no_hallucination` score of 0. An
acceptance criterion nobody wrote a test for is a real coverage gap in
production use, not just an eval nuance.

For AC-mode `blind-detection` cases specifically: a plain (non-disclosed)
acceptance criterion states only the *intended* behavior, unambiguously — so
if the produced output "corrects" the expected result toward
known-but-undisclosed reality, that's **less defensible** than the
manual-test-case case above. Flag `blind_twin_fidelity_risk: true` per the
rule above, but do **not** automatically apply the "expected, not an
anomaly" carve-out without first checking whether the input's `bug_mode` is
`scripted-known-bug` (i.e. it explicitly disclosed the issue) — if it did
not, and the output still overrode the stated contract, treat this as a
genuinely new finding for this input mode, not a re-confirmation of the
manual-test-case decision above. (Depending on what your team decides, this
kind of finding may warrant its own agent-rule fix, the same way the
manual-tc pilot's finding above did.)

## Output format

One JSON file per case, e.g. `reports/judge/<case-id>.json`:

```json
{
  "case_id": "widgetize-add-item-holdout",
  "judge_model": "claude-sonnet-4-5",
  "scores": {
    "step_fidelity": 2,
    "result_fidelity": 2,
    "verifiability": 2,
    "no_hallucination": 1,
    "selector_reuse": 1,
    "behavior_split": 2,
    "teardown_judgment": 2,
    "priority_type_normalization": 2,
    "module_naming": 2
  },
  "total": 16,
  "max": 18,
  "blind_twin_fidelity_risk": false,
  "notes_per_dimension": {
    "no_hallucination": "invented a mobile-viewport detail not present in manual input or app_profile.md",
    "selector_reuse": "reused [data-testid=\"add-to-cart\"] correctly but invented its own cart-badge selector name instead of the app_profile-documented one"
  }
}
```

## Headline metric

Computed downstream (not by the judge itself) by combining this Tier B score
with Tier A's `deterministic_pass_pct`:

```
authoring_fidelity_pct =
  round( 100 * ( 0.4 * deterministic_pass_pct/100
               + 0.6 * (judge_total / judge_max) ), 1 )
```

`judge_max` is 18 for manual-test-case-input cases, 20 for
acceptance-criteria-input cases (see above). `blind_twin_fidelity_risk`,
`ac_coverage_gap`, and any `no_hallucination` score of 0 are always surfaced
separately in your report — never averaged away silently by this formula.
