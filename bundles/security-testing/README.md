# Security Testing Team

A threat-led, read-only security testing team installed into a consumer
project. It gives the project a code-derived threat model with file:line
citations, a secure code review whose citations anyone with the repo can
re-check, passive security cases handed to the `manual-qa` /
`test-automation` teams, fix verification with a script-emitted verdict, and
a residual-risk register whose acceptances are recorded as unauthenticated.

Scripts enforce only what prose cannot: a citation matches the bytes at a
commit, a case is passive by grammar, tests ran at the fix commit with the
cited paths clean, a register transition is legal. Everything else is
prose — the lead's judgement, written down so a script can re-check it.

## Roster

| Agent | Model | Role |
|---|---|---|
| `security-lead` | sonnet | Orchestrator; the only human-facing role. Runs `init`, dispatches, `check`s, `admit`s, writes the report, prints hand-off prompts and stops, proposes acceptances. |
| `threat-modeler` | opus | Code-derived DFD with a citation per element, STRIDE, mitigations as claims, dispositions; drafts candidate passive cases. |
| `security-reviewer` | sonnet | Four contracts, each a fresh dispatch: `review`, `vulnerability-review` / `mitigation-review`, `fix-review`. |

## Skills

| Skill | Scripts | What it does |
|---|---|---|
| `secure-code-review` | `cite.mjs` (`init`, `show`, `check`, `redact`), `verify.mjs` | Citation reading, the findings/threat-model check, redaction, fix verification |
| `threat-modeling` | — | DFD element / STRIDE / mitigation-as-claim shape and the five dispositions |
| `security-test-planning` | `cases.mjs` (`admit`, `verify-suite`) | Passive-case grammar, admission by lint, the hand-off suite |
| `risk-register` | `register.mjs` (`add`, `accept`, `revoke`, `close-false-positive`, `reopen`, `supersede`, `ticket`, `fixed`, `regressed`, `check`, `status`, `render`) | The residual-risk register and its legal transitions |
| `security-engagement` | — | `engagement.md`, the lead's `references/workflow.md`, tracker rules, sign-off checklist |

## Install

Factory install (all three agents, all five skills):

```bash
npx github:arozumenko/sdlc-skills init --factory security-testing --target claude --yes
```

Standalone, one skill (no lead, no `knowledge/` seed — the human runs the
contracts directly):

```bash
npx github:arozumenko/sdlc-skills init --skills security-testing/secure-code-review --target claude --yes
```

`cite.mjs init` seeds `engagement.md` from the skill's own
`references/engagement.md.template`, so a standalone install still gets a
filled-in starting point — edit the fenced ` ```json engagement ` block, then
re-run `init`.

### Smoke test

```bash
npx github:arozumenko/sdlc-skills init --factory security-testing --target claude --yes
node .claude/skills/secure-code-review/scripts/cite.mjs init
node .claude/skills/secure-code-review/scripts/cite.mjs check .agents/security-testing/reviews/<dir>/findings.json
node .claude/skills/risk-register/scripts/register.mjs status
```

## How an assessment runs

Ten phases, one command (or dispatch) each; the result line says it
worked. Full procedure: `security-engagement/references/workflow.md`.

1. **Init** — `cite.mjs init` starts or resumes the engagement.
2. **Review** — dispatch `security-reviewer` (`review`) at `HEAD`.
3. **Register** — `cite.mjs check` the findings, then `register.mjs add`.
4. **Model** — dispatch `threat-modeler`, then `cite.mjs check` its model.
5. **Cases** — `cases.mjs admit` the candidate passive cases.
6. **Hand-off (stop)** — `cases.mjs verify-suite`; paste both prompts and stop.
7. **Report** — write the assessment, then `cite.mjs redact` it.
8. **Fix** — `verify.mjs` at the fix commit, pending then verdict.
9. **Acceptances** — `register.mjs accept` with the human's approval.
10. **Sign-off** — `register.mjs status`, checklist confirmed.

## Artifacts

| Artifact | Path |
|---|---|
| Engagement record | `.agents/security-testing/engagement.md` |
| Review output | `.agents/security-testing/reviews/<date>-<head7>/{findings.json,second-<id>.json}` |
| Threat model + candidate cases | `.agents/security-testing/threat-model.json`, `.agents/security-testing/cases/TC-NNN_<slug>.md` |
| Risk register (rendered) | `.agents/security-testing/risk-register.md` |
| Verify runs | `.agents/security-testing/verify/<id8>-<head7>/{verify.json,fix-review.json}` |
| Hand-off suite | `tasks/security-<slug>-admitted/` — written only by `cases.mjs admit` |
| Report | `reports/security/<date>-assessment.md` |
| Role memory | `.agents/memory/<role>/` |

## Guarantees

Script-enforced; everything else is prose (spec §2).

| Can promise (script-enforced) | Enforced by | Cannot promise |
|---|---|---|
| Every citation carries a commit oid and a ≤40-line range; `cite.mjs check` re-reads the bytes at that oid and marks each citation `VERIFIED` or `FAILED(<why>)`, at any time, by anyone with the repo. | script: `cite.mjs check` | Origin: anyone with write access can author a consistent set. Reports are lead-written Markdown; only their pasted tables carry a `TABLES sha256`. |
| Every scoped range is accounted for exactly once as examined / partial / unexamined. | script: `cite.mjs check` | That a model read what it declared examined. |
| Nothing a script writes contains bytes matching a redaction rule; finding ids hash the *redacted* normalised snippet, so no published hash has a secret in its preimage. | script: `cite.mjs check` / `redact` | Detection of secrets outside the rule list. |
| The hand-off suite `tasks/security-<slug>-admitted/` is written only by `cases.mjs admit` and contains only admitted cases; `verify-suite` lists anything else. | script: `cases.mjs admit` / `verify-suite` | That a QA runner refuses a case handed to it directly. |
| A `VERIFIED` verdict means the project's tests exited 0 at the named fix commit in the project's own checkout with the cited paths clean, and a fresh reviewer asserted `not-refound`. | script: `verify.mjs` | Test meaningfulness; that the class is closed at the sink. |
| Every approval-like record is stored `authenticated: false`; no command creates a confirmed state; open exposure is never reduced by an approval. | script: `register.mjs` | That any human approved anything. |

### Not guaranteed

The right column above, plus two script-wide facts: `GIT-ERROR <message>`
(exit 2) is the one git-failure line every script — `cite.mjs`,
`verify.mjs`, `cases.mjs`, `register.mjs` — can print, on any command; and
the one write that bypasses redaction is `.gitignore`, the managed block
`cite.mjs init` writes there once.

## Hand-offs

Step 6 (Cases) ends with `cases.mjs verify-suite` printing `SUITE ok=<n>`
and two prompts — one for `manual-qa`, one for `test-automation` — built
from the admitted suite at `tasks/security-<slug>-admitted/`. The lead
pastes both to the human and stops; nothing past that point runs until the
suites come back or the human says to continue anyway.

## Out of scope (v2 candidates)

SARIF import (`cite.mjs import-sarif`, ~120 lines); tracker publish/read-back
profiles; threat tickets; dirty-tree reviews; SBOM / supply-chain review;
privacy threats; security evals beyond the frozen harness.
