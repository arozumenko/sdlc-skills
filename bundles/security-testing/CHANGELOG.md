# Changelog — security-testing

## Unreleased

- Fix: the managed `.gitignore` block written by `init` now ignores ten private
  paths under `.agents/`: `reviews/`, `verify/`, `register/`, `proposals/`,
  `cases/`, `threat-model.json` and `risk-register.md` in `security-testing/`,
  and the daily logs of `security-lead`, `security-reviewer` and
  `threat-modeler` in `memory/`. The threat model, the cases, the register
  view and the daily logs were missing before. `init` rewrites an older block
  in place. A project that tracks one of these paths on purpose now makes
  `init` stop with `TRACKED <path>` (exit 4): run `git rm --cached <path>`,
  commit, and run `init` again (git history keeps the old copies). Daily logs
  no longer travel with git. The roles' memory sections now allow ids, counts,
  the review or run directory and result lines only: no product file, line,
  title or description of a finding or threat. The threat modeler logs how
  many scope files it left uncited, not which.

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
