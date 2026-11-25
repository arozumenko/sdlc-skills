# Changelog — security-testing

## Unreleased

- Fix: a wake-up is not a person. In a real run the security lead scheduled
  itself a fallback wake-up ("continue security engagement"); it arrived as a
  plain user message and the lead took it as permission to pass its mandatory
  stop. On Claude Code the lead can no longer call `ScheduleWakeup`,
  `CronCreate` or `RemoteTrigger` (`disallowedTools`), and its stop rule says
  never to schedule anything. After this stop only returned suite results or
  a human message that names the step to run ("write the report", "verify
  commit <oid>") lifts it; a bare "continue" gets a question back, every
  time.
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
