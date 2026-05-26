# Test Automation Team (`test-automation`)

An automation-focused agent team that turns TMS cases into merged, honest
automated tests. A lead orchestrator (Tal) runs an analyst → implementer →
reviewer pipeline, owns test-framework architecture, and owns the automation
merge gate.

## Install

```bash
npx github:arozumenko/sdlc-skills init --bundle test-automation
```

## Roster

| Role | Agent | Source | Job |
|---|---|---|---|
| Lead / orchestrator (PM + tech-lead combined) | `test-automation-lead` (Tal) | bundle-local | Routes the pipeline, owns framework architecture + the automation merge gate. The user launches Tal directly. |
| Onboarding | `scout` | shared | Seeds framework / TMS / base branch / merge policy into `.agents/`. |
| Implementer | `test-automation-engineer` (Axel) | shared | Turns a ready AFS into a PR + Run Report. |
| Analyst + Reviewer | `qa-engineer` (Sage) | shared | Writes the AFS (analyst); reviews for test honesty (reviewer, fresh session). |

The pipeline-critical skills — `test-automation-workflow` and
`test-case-analysis` — are installed explicitly with the bundle (and also via the
agents that declare them). The Xray TMS adapter (`xray-testing`) loads
conditionally, only when the project declares `tms.adapter: xray`.

## When to use it

- A **test-automation-only** engagement, or any project where automation work
  runs as its own pipeline with a dedicated lead.
- You want a single orchestrator (Tal) to own routing, framework decisions, and
  the automation merge — without standing up a full feature-development team.

Compared to **`team-web`**, which includes `test-automation-engineer` +
`qa-engineer` as part of a fullstack delivery team but has no automation
orchestrator, this bundle adds Tal and focuses the whole team on the
TMS → merged-test pipeline.

## What gets installed

- The four agents above (Tal copied from this bundle; the other three from the
  shared catalog), with their declared skills.
- `test-automation-workflow` + `test-case-analysis` skills (explicit).
- Project briefings seeded to `.agents/memory/<role>/project_briefing.md` for all
  four roles.
- Team conventions spliced into `AGENTS.md` (inside
  `<!-- BUNDLE:test-automation -->` markers).
