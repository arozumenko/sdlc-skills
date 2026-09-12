---
name: quality-evals
description: Use when a team wants to validate test-runner's bug-detection accuracy or test-author's authoring fidelity against their OWN app before trusting the manual-qa bundle on real work — "how good is this agent, really", "benchmark test-author/test-runner", "build a gold suite", "self-eval the manual QA team". Ports a held-out-answer-key eval methodology (deterministic Tier A scoring + a judged Tier B rubric) that keeps a self-authored eval honest, generalized to any app.
license: Apache-2.0
compatibility: "Requires Node.js 18+. No external npm dependencies — the scoring scripts are plain Node using only built-in modules."
metadata:
  authors:
    - Olha Stetsenko1 <Olha_Stetsenko1@epam.com>
  version: "0.1.0"
---

# quality-evals

Two of this bundle's agents make judgment calls that are easy to trust and
hard to verify: `test-runner` decides PASS/FAIL/BLOCKED on your live app,
and `test-author` decides how a rough idea becomes a formatted `TC-NNN.md`.
Trusting either without measurement is a leap of faith. This skill ports a
rigorous, held-out-answer-key evaluation methodology — built and proven over
months against several real apps — so **any team can measure their own
installation's accuracy against their own app**, not just take someone
else's word for it.

## When to use

- Before rolling the manual-qa bundle out to a wider team or a
  release-gating workflow, and you want a number, not a feeling.
- After a `test-author/RULES.md` or `test-runner/AGENT.md` change (yours or
  upstream's), to confirm accuracy didn't regress.
- When comparing model choices, prompt tweaks, or a fork of these agents
  against a stable baseline on your own suite.
- When you want to build a small **gold suite** for your own app: a set of
  test cases with a known-correct answer, reusable for regression-testing
  the agents themselves going forward.

## What it is NOT

Not a replacement for `test-reporter`'s run reports, and not something that
runs automatically as part of a normal `test-run-lead` session. This is a
deliberate, opt-in benchmarking exercise you run when you want to measure
the agents — same relationship the `tokenomics` skill (in the
`test-automation` bundle) has to ordinary automation work: dormant until you
invoke it.

## Two tracks

| Track | Measures | Agent under test | Scored by |
|---|---|---|---|
| **Detection** | Does `test-runner` correctly report PASS/FAIL against a known-correct answer, including catching a bug it was never told about | `test-runner` | `scripts/score-test-runner-output.mjs` (fully deterministic) |
| **Authoring** | Does `test-author` turn a rough input into a structurally correct, semantically faithful test case | `test-author` | `scripts/score-test-author-output.mjs` (Tier A) + `references/judge-rubric.md` (Tier B) |

Full instructions — ground-truth schema, isolation rules that keep a
self-authored eval honest, step-by-step run instructions for both tracks,
and a worked example — are in [`README.md`](README.md).

## Quick reference

```bash
# Authoring track — Tier A (deterministic) scoring
node scripts/score-test-author-output.mjs <run-dir> [--ground-truth <path>] [--out-dir <path>]

# Detection track — full scoring (single tier)
node scripts/score-test-runner-output.mjs <run-dir> --suite <suite-name> [--ground-truth <path>] [--out-dir <path>]

# Tier B (authoring track judge pass) — no script; dispatch a fresh judge
# session per references/judge-rubric.md, or do it yourself by hand.

# Run this skill's own tests
node --test scripts/
```

See [`README.md`](README.md) for the full walkthrough, including why the
ground truth must never be shown to the agent being evaluated and how to
avoid accidentally leaking it via sibling-file mining or a live fetch of
your own app.
