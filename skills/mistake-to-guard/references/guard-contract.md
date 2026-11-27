# The guard contract

Every guard, whatever its rung, meets these seven terms. They are what separates
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

## 4. The error names the fix

The message says what to do instead, naming the file, type, function or
command: `use PlayerId-keyed carryOver() from LineupSubmit.kt`, not `bad
sensor mapping`. A message that only says "no" sends the next agent to guess,
and a guess is how the mistake was made the first time.

## 5. Wired into the gate

The guard runs where the project's merge gate runs: the one command CI
executes (`make ci`, `npm test`, a workflow step). Add it there, not to a side
script. Checks that take under about a second may also run in pre-commit on
staged files. Anything slower runs in the gate only. A check that runs nowhere
by default does not exist.

If the project's gate is itself tested (a selftest of the Makefile, a list of
expected targets), update that too.

## 6. Fails closed

- Missing input (no files matched, config not found, DB unreachable): exit
  non-zero with a message, unless "nothing to check" is a verified, expected
  state the guard tests for explicitly.
- Parse error on a file it should check: exit non-zero naming the file.
- Never print "OK" having read zero files.

## 7. Exceptions: dated, approved, counted

An exception sits on the offending line (or the line above), names the guard
id, an expiry date, the human who approved it, and a reason:

```kotlin
// guard-allow G-007 until 2027-03-31 by <approver>: display-only counter, never feeds track status
```

The guard rejects an exception missing any of the four, and treats an expired
one as a violation, so exceptions get re-decided instead of fossilising. The
guard (or the ledger audit) counts exceptions per guard. A rising count means
the rule is too broad. An agent never approves its own exception.

## Ratchet: when the pattern is already common

A rule that lands on a codebase with dozens of existing violations has three
bad options: fix everything in one risky change, scope the rule so narrowly it
misses the new code, or paper over it with exceptions. The fourth is a
ratchet: record today's count, fail when a change **adds** one, and fail
(asking for the number to be lowered) when a change removes one, so the count
only moves down. `templates/check-guard.mjs` implements this with a one-number
file; for linters, use their baseline feature (detekt `baseline.xml`, Android
Lint `lint-baseline.xml`, ESLint bulk suppressions `eslint-suppressions.json`,
Ruff `--add-noqa`) and record the ratchet in the ledger's Status column.

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
| G-004 | Direct `collectAsState()` calls | 2 lint | `config/detekt.yml` + `detekt-baseline.xml` | review of PR #233 | 2026-11-27 | ratchet: 14 → 0 |
```

- **Id** is stable, never reused. Prose that the guard enforces carries
  `[guard: G-NNN]`.
- **Proved** is the date both fixtures were last run with the expected result.
- **Status**: `active`, `ratchet: <count> → 0`, `unguarded: <reason>`, or
  `retired: <why>` (keep the row).

The same rules, one line each, belong in the agent instruction file
(`AGENTS.md`/`CLAUDE.md`) next to their enforcement, so a reader of the rule
sees whether anything stops them breaking it: `Never cite #39 [guard: G-002]`,
`Ask the product lead before minting an issue [unguarded: G-003]`.
