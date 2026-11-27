# The guard ladder

Pick the **highest** rung that can see the mistake. Each rung down is easier to
write and easier to get wrong: a type cannot have a false positive; a grep can.

## Rung 1: Type / API shape

Make the wrong program fail to compile.

- A value class / newtype for an identity that must not be confused with
  another of the same primitive type (`PlayerId` vs cap number, `UserId` vs
  `OrgId`).
- A sealed type / enum instead of a string or boolean flag, so `when`/`switch`
  exhaustiveness catches the missed case.
- Remove or `@Deprecated(level = ERROR)` the unsafe overload; keep only the
  safe one.
- Typed configuration instead of a stringly-typed map.

Proof: a compile-fail fixture is awkward in most stacks. Instead, point to the
call site the incident came from and show it no longer compiles in its old
form (quote the compiler error in the PR).

## Rung 2: Static rule

| Stack | First choice | When it has no rule |
|---|---|---|
| Kotlin / Android | detekt (`ForbiddenImport`, `ForbiddenMethodCall`, `ForbiddenAnnotation` are config-only), Android Lint | ast-grep, or a custom detekt rule if the team already has a rules module |
| JS / TS | ESLint (`no-restricted-imports`, `no-restricted-syntax` with an AST selector are config-only), TypeScript `strict` flags | ast-grep |
| Python | Ruff (`banned-api`, `TID251`), mypy/pyright strict flags | ast-grep |
| Swift | SwiftLint `custom_rules` (regex), compiler warnings-as-errors | ast-grep |
| Anything | **ast-grep** | Semgrep if already present |

Prefer *config* of an existing linter over a custom plugin. A three-line
`ForbiddenImport` entry beats a new rules module.

**Why ast-grep is the default fallback:** a rule is a short YAML file that
matches syntax trees, not text, so it ignores formatting and comments; and
`ast-grep test` runs `valid:`/`invalid:` snippets stored next to the rule. The
fixture contract is built into the tool. See `templates/ast-grep-rule.yml`.

Wire-up: `ast-grep scan` (exit non-zero on `severity: error`) in the gate;
`ast-grep test` in the same gate so the rule's own fixtures stay proven.

## Rung 3: Test

- **Regression test**: the bug itself. `bugfix-workflow` already writes one.
  It guards the instance, not the class.
- **Architecture test**: module and layer boundaries ("domain never imports
  UI", "no feature module depends on another feature module"). Konsist or
  ArchUnit (JVM), dependency-cruiser (JS), import-linter (Python), or a Gradle
  dependency assertion task.
- **Property / table test**: an invariant over many inputs ("every lineup
  submit carries sensors by player id: for any roster permutation, no sensor
  moves to a different player id").
- **Contract test**: two sides of a seam (API schema vs client types).

## Rung 4: Repo guard script

For what no parser covers: CI workflow content, docs, board/YAML data,
cross-file invariants, generated-vs-source drift, forbidden identifiers in
prose (a closed epic number, a real person's name, a credential shape).

Shape: one script per guard, `tools/check-<what>.mjs` (or the repo's script
language), with a sibling selftest. Use only the standard library unless the
repo already has the dependency. See `templates/check-guard.mjs`.

## Rung 5: Prose

When nothing above can see the mistake: a judgment call, a sequencing rule
between humans, a rule about what to *ask*. Write it once, in the one place
the right role reads (`memory` or `.agents/conventions.md`), and record it in
the ledger as `unguarded` with the reason. A future retrospective that finds
it violated again re-asks whether a rung above has become possible.

## Worked examples (shapes, not prescriptions)

| Prose rule | Rung | Guard |
|---|---|---|
| "Never use `SharedPreferences`; DataStore only" | 2 | detekt `ForbiddenImport: android.content.SharedPreferences` |
| "The domain module never sees the Compose compiler" | 3 | Gradle task asserting `:core:domain`'s resolved classpath has no `androidx.compose.*` |
| "Sensors carry over by player id, never by cap number" | 1 + 3 | `PlayerId` value class on the carry-over API, plus a property test over roster permutations |
| "Never re-derive staleness from timestamp deltas; `track_status` is authoritative" | 2 | ast-grep rule: subtraction of `*timestamp*`/`*At` members inside the live-feed package |
| "CI has no direct `./gradlew` step; it calls `make ci`" | 4 | script parsing `.github/workflows/*.yml` for `run:` lines invoking `gradlew` |
| "Never cite the closed epic #39" | 4 | script grepping docs and board files for the identifier, with an allowlist for the ADR that records the closure |
| "Ask the product lead before creating a tracker issue" | 5 | unguarded: no tool sees the conversation |
