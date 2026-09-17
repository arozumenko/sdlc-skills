# Security Testing Team

A threat-led, read-only security testing team installed into a consumer
project. It gives the project a code-derived threat model with file:line
citations, a secure code review whose citations anyone with the repo can
re-check, passive security cases handed to the `manual-qa` /
`test-automation` teams, fix verification with a script-emitted verdict, and
a residual-risk register whose acceptances are recorded as unauthenticated.

Scripts enforce only what prose cannot: a citation matches the bytes at a
commit, a case is passive by grammar, tests ran at the fix commit with the
cited paths clean, a register transition is legal. Everything else is prose.

## Install

```bash
npx github:arozumenko/sdlc-skills init --factory security-testing
```

## Roster

| Agent | Role |
|---|---|
| `security-lead` | Orchestrator; the only human-facing role |
| `threat-modeler` | Code-derived DFD, STRIDE, mitigations as claims, candidate passive cases |
| `security-reviewer` | `review`, `vulnerability-review`, `mitigation-review`, `fix-review` — each a fresh dispatch |

## Skills

`secure-code-review` (`cite.mjs`, `verify.mjs`) · `threat-modeling` ·
`security-test-planning` (`cases.mjs`) · `risk-register` (`register.mjs`) ·
`security-engagement`.

Start with `claude --agent security-lead`. Artifacts live under
`.agents/security-testing/`, `reports/security/` and
`tasks/security-<slug>-admitted/`.

<!-- Front-door stub; the full roster, guarantees table, install smoke block,
     assessment phases and hand-offs are written in Task 12. -->
