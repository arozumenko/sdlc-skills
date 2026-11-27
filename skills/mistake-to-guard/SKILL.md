---
name: mistake-to-guard
description: Use when a bug is fixed, a review finding states a pattern rather than a line, a retrospective finds a correction that recurred, or someone says "never do X again" — turns the mistake into a deterministic check (type, lint/ast-grep rule, test, or repo guard script) that runs in the project's gate, instead of another line of prose an agent may not read. Covers choosing the rung, the guard contract (provenance, a fixture that proves it bites, gate wiring, counted suppressions) and the guard ledger. NOT for one-off typos with no class behind them, NOT for process or judgment lessons no tool can see (those stay in memory or conventions), and NOT for writing the regression test of a single bug (bugfix-workflow already does that).
license: Apache-2.0
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Mistake → guard

A lesson written as prose works only if the next agent reads it, remembers it,
and applies it. A check works whether or not anyone read anything. When a
mistake is visible to a tool, the durable fix is a check in the gate, not a
sentence in `AGENTS.md`.

This skill is the step that turns "we got X wrong" into "X can no longer reach
`main`".

## When to use

- **Bug fixed** (`bugfix-workflow` step 6b): the regression test covers this
  bug. Ask whether the bug belongs to a *class*: would the same shape of
  mistake, somewhere else, slip through the same way?
- **Review finding that outlives the PR**: the tech lead wrote a rule ("never
  key sensors by cap number", "lock parent before child"). If a tool can see a
  violation, make it a check.
- **Retrospective escalation**: a correction memory already failed to prevent
  (see `session-retrospective` → `finding-to-target.md`).
- **Explicit ask**: "make sure we never do this again", "add a check for that".
- **Prose audit**: a MUST/NEVER rule in `CLAUDE.md`/`AGENTS.md` that a tool
  could enforce but nothing does.
- **A written rule was broken anyway.** The rule existed and nothing enforced
  it, so this is already a repeat: guard it at the highest rung in the same
  change that fixes the violation, rather than rewording the rule.

Not for: a one-off slip with no class behind it, or a judgment lesson no tool
can see ("ask the PO before minting an issue"). Those stay in memory or
conventions, recorded as `unguarded` with the reason (see the ledger).

## Procedure

1. **State the mistake as a pattern.** One sentence naming the *shape*, not
   the instance: "staleness re-derived from timestamp deltas in live-feed
   code", not "line 212 of FeedMapper subtracted two longs". If you cannot
   state a shape, there is no class: stop here, a regression test suffices.

2. **Pick the highest rung that can hold it** (detail and per-stack tools in
   `references/ladder.md`):

   | Rung | Mechanism | Pick when |
   |---|---|---|
   | 1 | **Structure** — one owner per piece of state, one supported way per task, types that make the wrong thing unrepresentable (value class, sealed type, removing the unsafe overload) | The mistake exists because there are two ways to do it, or two places that hold the same fact. Delete the second one, or make the wrong value a compile error. |
   | 2 | **Static rule** — the stack's linter (detekt, Android Lint, ESLint, Ruff, SwiftLint), or an **ast-grep** rule | The mistake is a syntactic or import pattern in one file. ast-grep is the default when the linter has no rule: declarative YAML with built-in test cases. |
   | 3 | **Test** — regression, architecture (Konsist, ArchUnit, import-linter, dependency-cruiser), property | The mistake is behavioral, or about module boundaries. |
   | 4 | **Repo guard script** (`tools/check-*.mjs` or the stack's equivalent) | It spans files, config, CI, docs or board data that no linter parses. |
   | 5 | **Prose**, recorded `unguarded: <reason>` | Nothing above can see it. The reason is mandatory. |

   Higher rungs are cheaper to run and harder to bypass. Don't write a script
   for what an existing linter rule already does: switch the rule on. If the
   fix is structural, ship only the structural fix: the prose rule was a
   symptom, and keeping it alongside invites drift.

3. **Write the guard to the contract** (`references/guard-contract.md`):
   - **Provenance**: a header or rule `message`/`note` naming the incident (bug
     id, PR, review, retrospective session id) and the pattern.
   - **Proof it bites**: a *failing* fixture reproducing the original mistake,
     plus a passing fixture with the nearest *allowed* code. Run the guard on
     both and see it red on one and green on the other. A guard never seen
     failing on the real mistake proves nothing.
   - **Narrow**: covers the evidenced cases. Say what it would block that
     should be allowed. If you cannot name that, it is too broad.
   - **The error names the fix**: the file, type, function or command to use
     instead, not only what was wrong. The agent that trips it should be able
     to fix the code without reading the ledger.
   - **Wired into the gate**: the project's single gate (`make ci`,
     `npm test`, the CI workflow). Fast checks (< ~1 s) may also go in
     pre-commit. A guard outside the gate is a suggestion.
   - **Fails closed** when it cannot run (missing input, parse error): it
     exits non-zero and says why. It never passes having checked nothing.
   - **Exceptions** only on the offending line, with a reason, an expiry date
     and the human who approved it, in a form the guard counts. An expired
     exception fails the gate.

4. **Run the whole gate**, not just the new check. A new rule often finds
   existing violations. Fix them in the same change if few and clearly wrong.
   If the pattern is already common, **ratchet**: record today's count and
   fail only when a change adds more (and ask for the count to be lowered when
   a change removes some). Never ship a rule that is red on `main`, and never
   answer a common pattern with a wall of exceptions.

5. **Record it in the ledger** (`.agents/guards.md`, format in
   `references/guard-contract.md`): id, pattern, rung, where it lives, the
   incident, and the date it was proved against the fixture. If the lesson also
   lives as prose, tag that line `[guard: G-NNN]` so readers know it is
   enforced, and trim the prose to one line pointing at the guard.

6. **Hand off like any code change**: a guard is code in the gate. It goes
   through the normal branch → PR → review path, with its own line in the PR
   description ("adds G-NNN: <pattern>, closes the class behind #N"). A guard
   needs a human ack of its own. Never bundle it silently into a fix or into a
   batch of memory edits.

## Rules

- **Evidence before guard.** Every guard cites the incident it would have
  caught. No speculative guards for mistakes nobody made.
- **Narrowest guard that covers the evidence.** An over-eager guard gets
  disabled, which is worse than none: it teaches the team to bypass the gate.
- **The fixture is the spec.** Change the guard → re-run both fixtures. Delete
  the fixture → the guard is unproven.
- **Prose is the last rung, not the first.** But it is a legitimate rung, with
  a written reason. "Too hard" is a reason; silence is not.
- **Retire guards that stop being true** (the API they police is gone, or a
  structural change made the mistake impossible) in the same change. Update
  the ledger.

## Common mistakes

- Writing the guard after the fix and testing it only on the fixed code, so it
  is never seen red. Write the failing fixture from the *pre-fix* code.
- Grepping for the exact identifier from the incident (overfit) instead of the
  shape.
- Adding a fifth wording of the rule to `AGENTS.md` instead of a check.
- Putting a slow check in pre-commit: it gets `--no-verify`'d and then nothing
  runs it.
- A guard that prints "OK" when its input list is empty.

## References

- `references/ladder.md`: rungs in detail, tool choices per stack, worked
  examples.
- `references/guard-contract.md`: header format, fixtures, gate wiring,
  suppressions, ledger format.
- `templates/ast-grep-rule.yml` + `templates/ast-grep-rule-test.yml`: rung-2
  starter.
- `templates/check-guard.mjs` + `templates/check-guard.selftest.mjs`: rung-4
  starter (Node stdlib only).
