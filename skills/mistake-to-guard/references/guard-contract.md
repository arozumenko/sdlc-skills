# The guard contract

Every guard, whatever its rung, meets these six terms. They are what separates
a guard from a check that someone once wrote and nobody trusts.

## 1. Provenance

The guard says why it exists, where a reader meets it:

- a script: a header comment;
- an ast-grep/linter rule: the `message` + `note` fields (and the ledger);
- a test: the test name plus a one-line comment.

```
// G-007: staleness re-derived from timestamp deltas in live-feed code.
// Closes the class behind #812 (stale cap drawn LIVE for 9 s).
// Allowed: delta arithmetic outside the live-feed package, and the
//   seconds-since-last-blink display counter (reads, never decides staleness).
```

Name the **pattern**, the **incident** (bug id / PR / review / retrospective
session id) and **what stays allowed**.

## 2. Proof it bites

Two fixtures, both kept in the repo next to the guard:

- **failing**: the original mistake, taken from the pre-fix code or a minimal
  reduction of it. The guard must report it.
- **passing**: the nearest legitimate code (the "allowed" line above). The
  guard must stay silent.

Run the guard on both before committing and quote the two results in the PR.
For ast-grep these are the `invalid:` / `valid:` lists in the rule's test file;
for a script, the selftest; for a test-rung guard, temporarily revert the fix
and watch the test go red (say so in the PR).

## 3. Narrow

Match the shape the evidence shows, not everything that resembles it. Prefer
scoping (`files:`/`ignores:` in ast-grep, a path filter in a script) over a
broad pattern plus many suppressions. If more than a handful of existing sites
need suppressing, the rule is wrong or the codebase needs a real migration:
stop and raise it.

## 4. Wired into the gate

The guard runs where the project's merge gate runs: the one command CI
executes (`make ci`, `npm test`, a workflow step). Add it there, not to a side
script. Checks that take under about a second may also run in pre-commit on
staged files. Anything slower runs in the gate only. A check that runs nowhere
by default does not exist.

If the project's gate is itself tested (a selftest of the Makefile, a list of
expected targets), update that too.

## 5. Fails closed

- Missing input (no files matched, config not found, DB unreachable): exit
  non-zero with a message, unless "nothing to check" is a verified, expected
  state the guard tests for explicitly.
- Parse error on a file it should check: exit non-zero naming the file.
- Never print "OK" having read zero files.

## 6. Counted suppressions

A suppression is inline, names the guard id, and gives a reason:

```kotlin
// guard-allow G-007: display-only counter, never feeds track status
```

The guard (or the ledger audit) counts suppressions per guard. A rising count
is a signal the rule is too broad.

## The ledger: `.agents/guards.md`

One table, committed, append-and-edit. It is how a retrospective sees which
lessons are enforced and which are still only prose.

```markdown
# Guards

| Id | Pattern | Rung | Lives in | Incident | Proved | Status |
|---|---|---|---|---|---|---|
| G-001 | SharedPreferences used instead of DataStore | 2 lint | `config/detekt.yml` ForbiddenImport | PR #210 review | 2026-11-27 | active |
| G-002 | Closed epic #39 cited | 4 script | `tools/check-no-stale-epic.mjs` | retro 2026-11-20 (session 3f2a…) | 2026-11-27 | active |
| G-003 | Product lead not asked before minting an issue | 5 prose | `.agents/conventions.md` §Trackers | retro 2026-11-20 | — | unguarded: no tool sees the conversation |
```

- **Id** is stable, never reused. Prose that the guard enforces carries
  `[guard: G-NNN]`.
- **Proved** is the date both fixtures were last run with the expected result.
- **Status**: `active`, `scoped` (with a baseline/backlog note), `unguarded:
  <reason>`, or `retired: <why>` (keep the row).
