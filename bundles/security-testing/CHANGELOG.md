# Changelog — security-testing

## Unreleased

- Fix: three usability gaps found in real runs. The audit guide's step now
  admits ("List the network requests"). The modeler re-checks its own
  corrected model, and the guide says how. The test-case-format path is the
  installed one. `register.mjs` and `cases.mjs` let a plain URL survive
  redaction: `https://host/` or `{{base_url}}/` followed by segments of up to
  20 lowercase letters, up to 8 digits or `v1`-style, with no `?`, `#` or `@`
  before the kept run. This knowingly lets short plain lowercase or digit
  tokens in a path through. When `show` or `check` rejects a mistyped long
  path, which prints redacted, the message now ends with `; nearest tracked
  directory <dir>/` (and `check` adds `examined[<i>]`). Only a directory git
  tracks is named; the untracked text stays redacted.
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
