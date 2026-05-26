---
name: bugfix-workflow
description: End-to-end bugfix workflow — reproduce, test-first, RCA, fix, verify, document. Use when the user says "fix bug", "investigate issue", "fix #NNN", or whenever you hit a failing test or reproducible defect, before you start patching.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

## Bugfix Workflow: Reproduce → Test → Fix → Verify

**Core philosophy:** reproduce before you fix, verify after you fix, link
everything to the ticket.

## The seven steps

```
1. Read & understand the bug
2. Reproduce
3. Write a failing test
4. Root cause analysis
5. Implement the fix
6. Verify
7. Document on ticket
```

### 1. Read & understand the bug

`gh issue view <N>`. Identify expected vs actual behavior, files involved,
error messages, stack traces, related issues. Post a `🔧 **Investigating**`
comment on the ticket so the reporter knows work has started.

### 2. Reproduce

Confirm the bug exists and understand the exact conditions that trigger it.
UI bugs → Playwright MCP snapshots. API bugs → `curl`. Logic bugs → minimal
reproducer script.

**If you cannot reproduce, stop and ask.** Do not proceed to fix a bug you
cannot observe. Post what you tried and request more details.

Once reproduced, post a `✅ **Reproduced**` comment with steps, expected,
actual, and frequency (always / intermittent).

### 3. Write a failing test

Capture the bug as a regression test *before* fixing. Run it and confirm it
fails — that's the whole point. A passing test for an unfixed bug means the
test doesn't exercise the bug.

### 4. Root cause analysis

Locate the code, trace execution from entry point to failure, classify the
cause (logic / data / concurrency / config / integration), and assess blast
radius — what else uses this code, could the fix break anything else?

Post a `🔍 **Root Cause**` comment with location (file:line), cause, impact,
and fix approach.

### 5. Implement the fix

Minimal, focused. Fix the root cause — **only** the root cause. Don't refactor
neighboring code, don't clean up unrelated style, don't expand scope. A bug
fix is not the place for improvements.

### 6. Verify

The failing test from step 3 now passes. Full test suite still passes. Lint
and type checks clean. If anything fails, fix it before proceeding — don't
ship a fix that breaks something else.

### 7. Document on ticket

Post a `✅ **Fixed**` comment with root cause summary, what changed, regression
test name, and PR number. Commit and open the PR. The `completing-a-task` skill
covers the full commit → PR → notify handoff.

## Command recipes

All the `gh issue comment` heredocs, reproduction patterns, test templates,
and verification commands live in
[references/commands.md](references/commands.md). Load that file when you
need the exact template text.

## Anti-Patterns

- Don't fix without reproducing first
- Don't skip the failing test — no test = no proof of fix
- Don't refactor while fixing — separate concerns into separate PRs
- Don't close the ticket without documenting what was wrong and what changed
- Don't fix multiple unrelated bugs in one PR
