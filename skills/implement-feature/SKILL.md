---
name: implement-feature
description: End-to-end feature implementation workflow. Use when the user says "implement", "build feature", "work on task", "start implementation" — or once a plan or story is approved and you're about to start building. Covers plan review, test writing, implementation, verification, and delivery.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

## Feature Implementation: Plan → Test → Build → Verify → Ship

**Core philosophy:** understand the plan, write tests first, implement to pass
them, verify everything, ship clean.

## The eight steps

```
1. Load the plan
2. Write test cases
3. Implement
4. Manual verification
5. Write automated tests
6. Run full test suite
7. Commit & PR
8. Document on ticket
```

### 1. Load the plan

`gh issue view <N>`. Identify acceptance criteria (definition of done),
interface contract (input/output types if defined), dependencies, and what's
explicitly in and out of scope. If anything is unclear, ask the tech-lead via
taskbox *before* writing code. Post a `🔧 **Started**` comment so the team
knows work is in progress.

### 2. Write test cases (TDD red phase)

Define "done" as executable tests before implementing. For each acceptance
criterion, write a test. Cover happy path, error cases, edge cases. Run them
and confirm they fail — that's the red phase.

### 3. Implement

Write the minimum code to pass the tests. Rules:

- **Follow existing patterns** — read similar features in the codebase first
- **One change at a time** — verify syntax after each file edit
- **Match the interface contract exactly** if the task defines one
- **No scope creep** — don't add features beyond the acceptance criteria
- **Don't refactor neighbors** — a feature task is not a cleanup task
- **Don't optimize prematurely** — make it work before making it fast

### 4. Manual verification

Sanity check before running automated tests. API → `curl` the endpoint. UI →
browser snapshot + interaction. Backend logic → one-liner that calls the
function. Catches the obvious breaks before test run.

### 5. Write automated tests

Extend the test cases from step 2 with integration and E2E tests if the
feature touches external systems (DB, APIs) or has a UI component.

### 6. Run full test suite

All tests, lint, type check, and `git diff --stat` to confirm the scope of
changes matches expectations. Don't ship if anything fails — fix it first.

### 7. Commit & PR

Feature branch, focused commit, `gh pr create` with proper title and body.
The `completing-a-task` skill has the full protocol.

### 8. Document on ticket

`✅ **Done**` comment with summary, test counts, PR number, and key
architectural decisions. Notify PM via taskbox that the PR is ready for
review.

## Command recipes

All the test templates, verification commands, PR body heredocs, and taskbox
notifications live in [references/commands.md](references/commands.md). Load
that file when you need exact command syntax.

## Anti-Patterns

- Don't implement without understanding the acceptance criteria
- Don't skip tests — they're proof of correctness, not overhead
- Don't expand scope beyond what the task defines
- Don't commit without running the full test suite
- Don't forget to document on the ticket — the audit trail matters
