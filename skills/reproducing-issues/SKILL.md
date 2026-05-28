---
name: reproducing-issues
description: Turn a vague bug report into precise, repeatable steps with evidence and a CONFIRMED / CANNOT-REPRODUCE / PARTIAL verdict. Use when a bug is unclear or unconfirmed and needs reproduction before RCA or any fix. Reproduction and documentation only — does not fix code.
license: Apache-2.0
authors:
  - Artem Rozumenko <artem_rozumenko@epam.com>
metadata:
  version: "0.1.0"
---

# Reproducing Issues

Turn a vague bug report into precise, repeatable reproduction steps backed by
evidence, ending in a clear verdict. **Reproduction and documentation only —
you do NOT fix code.**

## Platform & systems

Findings go on the **tracker ticket** — the source of truth — using the
tracker scout recorded in `.agents/profile.md § Project systems` (GitHub
Issues, Jira via `atlassian-content`, GitLab, Azure Boards, Linear). The
`gh issue …` commands below are the **GitHub reference**; translate per
`.agents/workflow.md § Git host`. In a standalone session with no tracker,
report the same content directly to the user.

## Methodology — 5 phases

### 1. Intake

Read the report in full (`gh issue view <N>` or the tracker equivalent).
Assess: clear steps → follow exactly; partial → fill the gaps; none → explore
the feature area; intermittent → expect multiple timed attempts. Note that
reproduction has started on the ticket.

### 2. Environment setup

Identify the target URL/endpoint/page, auth (user role, credentials),
prerequisite data/state, and client requirements. Reproduction must be
repeatable — document the environment.

### 3. Reproduction attempts

- **UI** → drive the browser with the `playwright-testing` or `browser-verify`
  skill: navigate, snapshot for refs, follow the reported steps, screenshot
  the failure, capture console errors and network requests.
- **API** → reproduce the failing request with `curl` or a small script;
  record status code + body.
- **Logic** → a minimal script calling the function with the edge-case input;
  print expected vs actual.
- **Intermittent** → run 5–10×, vary timing and data, document the
  success/failure rate.

### 4. Root-cause hints (handoff to RCA)

Gather clues for `root-cause-analysis`: exact console errors + stack traces;
failing requests / unexpected status codes; works-vs-fails patterns;
triggering vs safe inputs; timing sensitivity. Post these technical
observations on the ticket.

### 5. Confirmation gate (required)

Assess the result and post a verdict. **Do not let work proceed to RCA unless
CONFIRMED:**

- **CONFIRMED** — reproduced at least once, repeatable (or intermittent rate
  documented), failure clearly captured (screenshot / log / response), steps
  precise enough for anyone to follow. Post: reproduction rate, method, exact
  steps, expected vs actual, evidence, and RCA hints. → ready for RCA.
- **CANNOT REPRODUCE** — post what was tried and the specific information
  needed. → not ready.
- **PARTIALLY CONFIRMED** — reproducible but inconsistent; post the rate and
  the conditions under which it fails. → RCA may proceed; flag the intermittency.

## Output

Full report on the ticket; a one-line summary to the user/PM, e.g.
`✅ #N CONFIRMED — 4/5 attempts, trigger: <one sentence>. Ready for RCA.`

## You do NOT

Edit source code, create branches/PRs, make architecture decisions, close
tickets, skip the confirmation gate, or proceed to RCA when not confirmed.

## Related skills

- **`bugfix-workflow`** orchestrates reproduce → fix → verify; this is its deep
  "reproduce" methodology.
- **`root-cause-analysis`** is the next step once a bug is CONFIRMED.
- **`playwright-testing`** / **`browser-verify`** for UI reproduction.
