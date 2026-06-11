# Onboarding guides

Each sdlc-skills **team bundle** has a deep, scenario-based adoption guide that
takes you from "I want this team in my repo" to "the team is shipping." Pick
yours below. For the catalog, install paths, and architecture, see the root
[README.md](../../README.md); for how bundles are defined, see
[`bundles/SPEC.md`](../../bundles/SPEC.md).

## Pick your team

| Guide | Install | Who it's for |
|---|---|---|
| [**feature-development**](feature-development.md) | `--bundle feature-development` | A cross-platform delivery team — BA, PM, tech-lead, QA, scout, and pickable dev roles (Python / JS / iOS / test-automation). You're building features. |
| [**manual-qa**](manual-qa.md) | `--bundle manual-qa` | A standalone manual-QA team that authors Markdown cases and runs them **live** against a web or mobile app (Playwright / Appium / Mobitru). No test code generated. |
| [**test-automation**](test-automation.md) | `--bundle test-automation` | A TMS-driven automation pipeline — a lead (Tal) runs analyst → implementer → reviewer to turn TMS cases into merged, honest automated tests. |

Not sure between the last two? **manual-qa** runs cases live and writes no code;
**test-automation** generates and merges real test code in your framework. Many
teams run **feature-development** plus one of them — each guide's *Hybrid*
section covers combining bundles in one repo.

> `personal-assistant` is a standalone single agent (vault, email, calendar —
> not a team), so it has no onboarding guide. Install it with
> `--agents personal-assistant` and read its `AGENT.md`.

## Concepts shared across all three

Every guide builds on the same machinery; learn it once here.

- **The npx installer** is the happy path: `npx github:arozumenko/sdlc-skills
  init --bundle <id>`. It copies agents into your host's native form, fetches
  each agent's declared skills (monorepo + external), wires the context hooks,
  and splices team conventions into `AGENTS.md` / `CLAUDE.md`. Bundle installs
  currently target **Claude Code**; other hosts use the manual `--agents` form
  with `--target`. Full flag reference: [README.md](../../README.md).

- **Onboarding seeds `.agents/`.** `feature-development` and `test-automation`
  use **scout** + the `seeding-a-project` skill to write `AGENTS.md` and the
  `.agents/` content docs (architecture, testing, workflow, profile,
  team-comms). `manual-qa` has no scout — **app-profiler** writes
  `.agents/manual-qa/app_profile.md` instead. `AGENTS.md` always wins over a
  bundle's team-wide defaults.

- **Memory + context hooks** re-inject each role's `.agents/memory/<role>/`
  snapshot and the shared `.agents/*` config at **every dispatch**, so context
  survives `/clear`, compaction, and resume. Capture is assisted (agents jot
  durable facts; you re-run scout / re-profile to refresh) — nothing mines past
  chat automatically.

- **Updating** is a re-run with `--update` (overwrites installed agents/skills,
  refreshes the conventions block, preserves your `.agents/` content). See
  [MAINTENANCE.md](../../MAINTENANCE.md).

- **Your code is never touched.** Every team works *through* your repo — they
  own `.agents/` (and `tasks/` / `reports/` / `test-specs/` where relevant), not
  your application code, build config, or CI.
