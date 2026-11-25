# Changelog — security-testing

## Unreleased

- Fix: the managed `.gitignore` block written by `init` now covers ten
  private paths under `.agents/`.

  What changed:
  - The block ignores `reviews/`, `verify/`, `register/`, `proposals/`,
    `cases/`, `threat-model.json` and `risk-register.md` in
    `security-testing/`. It also ignores the daily logs of `security-lead`,
    `security-reviewer` and `threat-modeler` in `memory/`. The threat model,
    the cases, the register view and the daily logs were missing before.
  - `init` rewrites an older block in place.
  - If git tracks one of these paths, `init` stops with `TRACKED <path>`
    (exit 4) and writes nothing.
  - The roles' memory sections now allow ids, counts, the review or run
    directory and result lines only. They name no product file, line, title
    or description of a finding or threat. The threat modeler logs the
    engagement id and how many scope files it left uncited, not which.

  What to do:
  - After you update, run `init` again. Nothing else upgrades the block.
  - If `init` prints `TRACKED <path>`, do these steps in order:
    1. Keep a copy of the private files outside the repository.
    2. Run `git rm --cached <path>` for each tracked path.
    3. Run `init`. It passes with the removal staged and writes the block.
    4. Commit the removal and `.gitignore` together.
  - Do not use `git add -A` between the steps.
  - All the private files listed above stay local, not only the daily logs.

  What it costs:
  - A teammate who pulls the commit from step 4 loses their copy of the
    file. They must keep their own copy first.
  - Checking out an older commit that still tracks the file overwrites the
    ignored copy. Checking out the newer commit again deletes it. Keep your
    copy until no such checkout is left, for example until fix verification
    is done.
  - Git history keeps the old content.

- Fix: `cite.mjs check` no longer redacts long tracked paths on write-back. A
  path run of 40+ letters, digits and `/` matched the `high-entropy` rule, so
  the first `check` passed and every later one failed and sign-off could not
  be reached. `--md` tables, `cite.mjs redact`, `SHOW` / `DIRTY-SCOPE` lines
  and `verify.mjs` output keep the path too. A file an earlier version already
  damaged cannot be repaired from its own bytes: restore the paths from the
  agent's source, strip what `check` wrote, and run `check` again (second
  opinions must be redone against the new bytes).

## 1.0.0

Full roster and skills land: `security-lead`, `threat-modeler` and
`security-reviewer` agents, backed by four scripts — `cite.mjs` and
`verify.mjs` (`secure-code-review`), `cases.mjs` (`security-test-planning`)
and `register.mjs` (`risk-register`) — plus the `security-engagement` skill
carrying the lead's `references/workflow.md`.

Supersedes the v6.2 packet/evidence-gate design: dropped, deliberately —
byte-compared reports, `COMMITTED` markers, manifests and `check-export`;
keyed (HMAC) identities and the engagement key; dirty-file (`snapshot`)
reviews; worktree-based test runs; the HMAC working-tree baseline; SARIF
import; tracker publish profiles and read-back; packets, receipts and
derived states; the hash-chained register log, projection, alias log and
anchor. A citation-at-a-commit re-check (`cite.mjs check`) replaces all of
it (spec §2).
