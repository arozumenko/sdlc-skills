# Onboarding guides

Each sdlc-skills **team factory** has a deep, scenario-based adoption guide that
takes you from "I want this team in my repo" to "the team is shipping." Pick
yours below. For the catalog, install paths, and architecture, see the root
[README.md](../../README.md); for how factories are defined, see
[`factories/SPEC.md`](../../factories/SPEC.md).

## Pick your team

| Guide | Install | Who it's for |
|---|---|---|
| [**feature-development**](feature-development.md) | `--factory feature-development` | A cross-platform delivery team — BA, PM, tech-lead, QA, scout, and pickable dev roles (Python / JS / iOS / greenfield-Compose Android / test-automation). You're building features. |
| [**manual-qa**](manual-qa.md) | `--factory manual-qa` | A standalone manual-QA team that authors Markdown cases and runs them **live** against a web or mobile app (Playwright / Appium / Mobitru), plus specialist web audits (security/a11y/privacy/perf/UX/SEO). No test code generated. |
| [**test-automation**](test-automation.md) | `--factory test-automation` | A TMS-driven automation pipeline — a lead (Tal) runs analyst → implementer → reviewer to turn TMS cases into merged, honest automated tests. |
| [**product-management**](product-management.md) | `--factory product-management` | A Product Owner discovery team — Priya runs raw ask → problem → hypothesis → ratified outcome → prioritized bet, dispatching Sam for evidence, then hands off to engineering. Upstream of delivery; writes no code. |

Not sure between the two testing factories? **manual-qa** runs cases live and writes no code;
**test-automation** generates and merges real test code in your framework. Many
teams run **feature-development** plus one of them — each guide's *Hybrid*
section covers combining factories in one repo.

> `personal-assistant` is a standalone single agent (vault, email, calendar —
> not a team), so it has no onboarding guide. Install it with
> `--agents personal-assistant` and read its `AGENT.md`.

## Concepts shared across all four

Every guide builds on the same machinery; learn it once here.

- **The npx installer** is the happy path: `npx github:arozumenko/sdlc-skills
  init --factory <id>`. It copies agents into your host's native form, fetches
  each agent's declared skills (monorepo + external), wires the context hooks,
  and splices team conventions into `AGENTS.md` / `CLAUDE.md`. Factory installs
  currently target **Claude Code**; other hosts use the manual `--agents` form
  with `--target`. Full flag reference: [README.md](../../README.md).

- **Onboarding seeds `.agents/`.** `feature-development` and `test-automation`
  use **scout** + the `seeding-a-project` skill to write `AGENTS.md` and the
  `.agents/` content docs (architecture, testing, workflow, profile,
  team-comms). `manual-qa` has no scout — **app-profiler** writes
  `.agents/manual-qa/app_profile.md` instead; `product-management` also has no
  scout — it seeds an empty `docs/discovery/` workspace and **product-owner**
  fills it as the loop runs. `AGENTS.md` always wins over a factory's team-wide
  defaults.

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
