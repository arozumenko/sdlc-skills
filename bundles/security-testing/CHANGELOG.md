# Changelog — security-testing

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
