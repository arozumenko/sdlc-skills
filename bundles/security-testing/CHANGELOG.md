# Changelog — security-testing bundle

All notable changes to this bundle. The bundle's scripts carry their own
`tool_version` in `skills/security-evidence/scripts/version.json`; the
`security-evidence` skill's `metadata.version` equals it.

## M3 — lead, planning, register, hand-offs (2026-09-17)

The bundle's final v1 shape (spec §3 D1, §4; plan §4.8 "Final"). `tool_version`
stays `1.0.0`: no artifact written by M1 changed shape; M3 adds artifacts.

- `factory.json`: `localAgents: [security-lead, threat-modeler,
  security-reviewer]`, `localSkills: [security-evidence, security-engagement,
  threat-modeling, secure-code-review, security-test-planning,
  risk-register]`, one briefing per role; everything else as M1 (TASK-048).
  `issue-tracking` resolves through the installer's item index — no
  `skillOverlays` (SPIKE-002).
- `security-lead` (sonnet): the only human-facing role — `engagement init`,
  the `assess` / `verify` / `tracker` / `accept` flows, dispatches the
  specialists, `build-report`, `sign-off`, `publish` to the tracker with a
  read-back, prints the hand-off prompts and stops, proposes acceptances
  (TASK-047).
- `plan.mjs admit` (lint by the passive-admission grammar; `--receipt` for
  `admitted-reviewed`, needs a `confirmed` vulnerability-review; unknown
  effects ⇒ `proposal`), `plan.mjs propose` (active work as a proposal
  outside `tasks/`, `authenticated: false` by schema), `plan.mjs ta-prompt`
  (the test-automation hand-off prompt from the published suite) with the
  `security-test-planning` skill (TASK-042, TASK-044).
- `publish --profile case` (the admitted suite `tasks/security-<slug>-admitted/`
  — only admitted `TC-*.md` files, identities recorded in the export
  manifest) and `publish --profile handoff` (the manual-qa prompt); the
  audit-branch expression for header/cookie checks; `sign-off` lists
  `UNADMITTED: <n>` — every suite file whose identity `publish --profile
  case` did not record — retiring the M1 `UNADMITTED: not evaluated`
  placeholder (TASK-043).
- `ingest qa-run` derives observations (`OBSERVATION <O-id> case=<id>
  result=…`, `<run>/observations/`, the `observations.json` index) for cases
  with an admitted record; `ingest ta-report` writes per-unit records
  (`TA-UNITS …`, `delivered-unwitnessed` without a gate receipt) (TASK-044).
- `ingest tracker-readback` appends `ticketed` to the register row whose
  subject is the finding (`TICKETED <R-id> <url>`; `READBACK: ok (no
  register row)` when none); `publish --profile tracker` dedupes against
  the row's `ticket_url` and prior imports (`DEDUPE finding=<id>
  existing=<url>`) and carries a `fix_prompt` routing the developer to
  `bugfix-workflow` (TASK-045).
- `sign-off --engagement` applies `sign_off.require_dispositions`
  (`executed-or-ticketed` | `all`): `DISPOSITIONS: <n> undisposed-or-planned
  policy=<p>` listing, `FAIL(DISPOSITIONS(<ids>))` under `all` (TASK-041).
- `risk-register` skill: the register prose — rows, unauthenticated
  acceptances, false-positive closes, supersession, the anchor, the rendered
  `risk-register.md` view (TASK-046).
- Receiving side (M4): `docs/execution-authorization.md` in the manual-qa and
  test-automation bundles states how a QA runner reads an admission record
  and a proposal (TASK-051; not part of this bundle's install).
- Catalog: root `README.md`, `AGENTS.md`, `bundles/SPEC.md` rows; the
  generated Cursor/Codex/Copilot marketplaces regenerated; the Claude
  marketplace entries (TASK-052). Every CLI exits quietly on `EPIPE`
  (`… | head -1`) with the intended code.

## M2 — threat model (2026-09-17)

- `tm-lint.mjs check` (validate `<st>/threat-model.json`: schema, unique
  ids, one in-scope citation per element, dispositions per threat; writes
  the run's snapshot and its `dispositions.json` index, write-once;
  `TM elements=<n> threats=<n> undisposed=<n>`) and `tm-lint.mjs render`
  (`<run>/threat-model.md`) landed — the M1 CLI shape is gone (TASK-039).
- `threat-modeling` skill: code-derived DFD with a citation per element,
  STRIDE per element, mitigations as claims for a separate
  `mitigation-review`, one disposition per threat (TASK-039).
- `threat-modeler` (opus): returns `MODEL_WRITTEN elements=<n> threats=<n>
  undisposed=<n>` only on `tm-lint check` exit 0, otherwise the lint line
  verbatim (TASK-040).
- An assessment run requires the linted index: `3 INCOMPLETE(dispositions)`
  from `build-report` until `tm-lint check` has run over the model (TASK-048).

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

Not yet shipped at M1: `threat-modeler` and `threat-modeling` (M2);
`security-lead`, `security-test-planning`, `risk-register` prose, the
`handoff` / `case` publish profiles and admission (M3) — see above.
