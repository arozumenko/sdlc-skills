---
name: root-cause-analysis
description: Trace a confirmed bug to its exact cause — execution-path tracing, root-cause classification, confidence, and impact/regression analysis, reported on the ticket. Use after a bug is reproduced, before proposing a fix. Investigation only — does not edit code.
license: Apache-2.0
metadata:
  author: "Artem Rozumenko (git: arozumenko)"
  version: "0.1.0"
---

# Root-Cause Analysis (RCA)

Trace a confirmed bug to its exact cause and produce a structured RCA
artifact. **Investigation only — you do NOT edit code, branch, or fix.**

## Platform & systems

The RCA report goes on the **tracker ticket** — the source of truth — using
the tracker scout recorded in `.agents/profile.md § Project systems`. The
`gh issue …` commands below are the **GitHub reference**; translate per
`.agents/workflow.md § Git host`. With no tracker, report directly to the user.

## When to use

- A bug is reproduced/confirmed (ideally via `reproducing-issues`) and needs
  deep investigation before a fix.
- Pairs with **`systematic-debugging`** — use its rigor (reproduce reliably,
  condition-based waiting) to trace; produce the structured report here.

## Methodology — 4 phases

### 1. Ticket acquisition

Read the ticket and all comments (reproduction steps, errors, stack traces,
environment, prior notes). Note that RCA has started on the ticket.

### 2. Codebase investigation — trace, don't guess

- **Locate the entry point**: grep the error message / function / route.
- **Trace the call chain**: entry (route/handler) → service (logic) → data
  layer → failure point. Read each file in the chain.
- **Examine the failure point**: which assumption is violated? what input
  triggers it? is the bug here or in a dependency?
- **Search for patterns**: how is the function called elsewhere; are there
  similar patterns that work; `git blame` and recent `git log` on the file.

### 3. Root-cause determination

Classify the cause:

| Category | Description | Example |
|---|---|---|
| **Logic** | Wrong condition, missing branch, off-by-one | `if x > 0` should be `if x >= 0` |
| **Data** | Unexpected input, null handling, type mismatch | Missing null check on optional field |
| **Concurrency** | Race condition, missing lock, async issue | Two requests mutating the same resource |
| **Configuration** | Wrong default, missing env var | Timeout too low for large payloads |
| **Integration** | API contract / dependency version change | Third-party API changed its response shape |
| **Resource** | Memory, connection pool, file handles | DB connection pool exhausted |

State **confidence**: Confirmed (you can see the exact bug) / Highly likely /
Suspected.

### 4. Impact analysis & report

- **Usage**: what else calls the buggy code; what depends on the module.
- **Regression risk**: what could break if fixed; existing test coverage;
  whether the code is shared across features.
- **Post the RCA report on the ticket**: executive summary, classification
  (category / confidence / severity), root cause (location `file:line` +
  function + cause + the offending code), execution path, impact analysis,
  suggested remediation, and dependencies (what this blocks / relates to).
- **One line to user/PM**: root cause + location + confidence.

## You do NOT

Edit source, create PRs/branches, run the app to fix it, make architecture
decisions, or close/reassign tickets. Hand the structured RCA to the developer
(or `bugfix-workflow`) for the fix.

## Related skills

- **`reproducing-issues`** precedes this — confirm the bug first.
- **`systematic-debugging`** for tracing rigor.
- **`bugfix-workflow`** consumes the RCA to implement and verify the fix.
