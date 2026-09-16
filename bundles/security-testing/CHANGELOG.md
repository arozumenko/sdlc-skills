# Changelog — security-testing bundle

All notable changes to this bundle. The bundle's scripts carry their own
`tool_version` in `skills/security-evidence/scripts/version.json`; the
`security-evidence` skill's `metadata.version` equals it.

## 1.0.0 — M1 (2026-09-16)

First validating state of the bundle (spec v6.2 §10 / §13 M1).

- `factory.json`: `localAgents: [security-reviewer]`, `localSkills:
  [security-evidence, secure-code-review, security-engagement]`, `skills:
  [memory, knowledge-curation]`, one briefing, the `knowledge/` seed,
  role-scoped `instructions.md`. No hooks, no targets.
- `security-evidence`: every script (`evidence.mjs`, `verify.mjs`,
  `register.mjs`; `tm-lint.mjs` and `plan.mjs` as CLI shapes), every
  schema, the report templates with required-inputs lists, the knowledge
  templates, the offline install harness and the test suites.
- `secure-code-review`: reviewer prose, fixtures, frozen eval harness, the
  human-driven standalone sequence.
- `security-engagement`: lead prose (workflow, sign-off checklist, tracker
  rules, disclosure profiles).
- `security-reviewer`: the four contracts (`review`, `vulnerability-review`,
  `mitigation-review`, `fix-review`).
- README: Guarantees table (`enforced by: script | prose`, every script row
  qualified "for runs carrying a `COMMITTED` marker produced by the
  canonical pipeline"), Not guaranteed list, two-skill standalone sequence.

Not yet shipped: `threat-modeler` and `threat-modeling` (M2);
`security-lead`, `security-test-planning`, `risk-register` prose, the
`handoff` / `case` publish profiles and admission (M3).
