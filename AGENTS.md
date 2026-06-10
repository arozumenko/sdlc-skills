# AGENTS.md — SDLC Skills

This repo ships **role-based agent personas** and **workflow skills** for
software delivery. It is consumed by multiple coding agents (Claude Code,
Cursor, Gemini CLI, GitHub Copilot CLI, Windsurf, and more) through a mix
of native plugin formats and a shared npx installer.

## What's here

- **`agents/<name>/AGENT.md` + `SOUL.md`** — role personas: BA, Tech Lead,
  PM, Python / JS / iOS devs, QA, Scout, Personal Assistant. Each agent's
  frontmatter declares the skills it depends on.
- **`skills/<name>/SKILL.md`** — [agentskills.io](https://agentskills.io)
  spec-compliant workflow skills: `plan-feature`, `implement-feature`,
  `bugfix-workflow`, `code-review`, `tdd`, `completing-a-task`,
  `git-workflow`, `memory`, `playwright-testing`, `browser-verify`,
  `issue-tracking`, `xray-testing`, `atlassian-content`,
  `tosca-automation`, `vividus`, `test-case-analysis`,
  `test-automation-workflow`, `verifying-outcomes`, `gathering-context`,
  `deep-research`, `obsidian-vault`, `microsoft-365`, `seeding-a-project`.
- **`skills.json`** — catalog of all skills, monorepo and external.
  The installer uses it to resolve + fetch external skills (from
  `mattpocock/skills`, `obra/superpowers`, `twostraws/*-Agent-Skill`,
  `microsoft/playwright-cli`).

## Install — the recommended path

Works for Claude Code, Cursor, Windsurf, and GitHub Copilot. Fetches
external skills automatically:

```bash
npx github:arozumenko/sdlc-skills init --agents ba,tech-lead,ios-dev
# or pick everything:
npx github:arozumenko/sdlc-skills init --all
```

The installer reads each agent's `skills:` frontmatter, copies monorepo
skills into `.claude/skills/` (and/or `.cursor/`, `.windsurf/`,
`.github/`), and clones external skill repos into a shared cache
(`~/.cache/sdlc-skills/registry/`), then copies them into the project's
skill dir (or symlinks with `--symlink`). Everything ends up in the
directory the agent expects to find it in. See the README for full flag docs.

## Install — native plugin fallbacks

Each IDE also has a native plugin path. These give you the **monorepo
subset** — external skills (TDD from mattpocock, Swift skills from
twostraws, etc.) are not fetched by native plugins. Run the npx installer
once if you want the full catalog.

| IDE | Path | Fetches externals? |
|---|---|---|
| Claude Code | `/plugin marketplace add arozumenko/sdlc-skills` → `/plugin install sdlc-skills@sdlc-skills` | No |
| Cursor | Point Cursor's plugin system at `.cursor-plugin/plugin.json` (this repo) | No |
| Gemini CLI | `gemini extensions install https://github.com/arozumenko/sdlc-skills` | No |
| GitHub Copilot CLI | Reads this `AGENTS.md` when the repo is cloned in, **or** use the npx installer with `--target copilot` (it flattens agents to `.agent.md` + normalizes the `model:` field). Repair existing installs with `init fix-copilot`. | No |
| Any IDE (full) | `npx github:arozumenko/sdlc-skills init --all` | **Yes** |

## Using an agent

Load `./agents/<name>/AGENT.md` and `./agents/<name>/SOUL.md` when
starting work in that role. The `AGENT.md` declares the skills the agent
relies on — load each skill's `SKILL.md` when its trigger conditions are
met, not preemptively.

## Using a skill

Skills are loaded on demand, not constantly in context. When a task
matches a skill's description (see its `SKILL.md` frontmatter), load the
`SKILL.md` and follow its workflow. Don't paraphrase it — skill
instructions are their own source of truth.


<!-- BUNDLE:web-qa START -->
# Web QA Team — shared conventions

This is a **standalone manual-QA team** for web apps. These are team-wide
defaults; scout (if present) or app-profiler refines them per project in `AGENTS.md`,
which always wins over this file.

## Pipeline

Onboard once with `app-profiler`, then drive `test-run-lead` — it is the
single orchestrator for a run and brings in the authoring/sizing agents when
the suite needs them. You can still invoke `test-sizer` or `test-author`
standalone for authoring work outside a run.

- **`app-profiler`** — run once to onboard the app: explores the UI, records its
  structure and flows, and writes `.agents/web-qa/app_profile.md`.
- **`test-run-lead`** — the run orchestrator; run it as the **active agent**
  (it uses the Agent tool to spawn sub-runs). Assembles the suite first —
  dispatching **`test-author`** to write missing cases and **`test-sizer`** to
  size unsized ones, *when needed* — then dispatches one `test-runner` per
  case and triggers `test-reporter`.
- **`test-sizer`** — rates cases S/M/L for AI-agent execution cost: sizes rough
  descriptions before authoring (flagging Large ones to split) and scores
  existing TC files, writing `size:` into their frontmatter. Dispatched by the
  lead, or run standalone.
- **`test-author`** — takes a feature or flow description and writes formatted
  test cases under `tasks/<suite>/TC-NNN_<slug>.md`. Dispatched by the lead, or
  run standalone.
- **`test-runner`** — receives a single `TC-NNN` file path and a `base_url`;
  runs the case live via Playwright MCP; emits a structured JSON result.
- **`test-reporter`** — collects test-runner results and writes the run report to
  `reports/RUN-YYYY-MM-DD-NNN.md`, linking any screenshots.

## Project layout

```
tasks/<suite>/TC-NNN_<slug>.md     test cases (authored by test-author)
reports/RUN-YYYY-MM-DD-NNN.md     run reports (written by test-reporter)
reports/screenshots/               evidence screenshots from test-runner runs
.agents/web-qa/knowledge/          seeded reference docs (format, template, …)
.agents/web-qa/app_profile.md      app map written by app-profiler
```

## `{{base_url}}` rule

All test-case URLs are written as `{{base_url}}/path`. The test-runner substitutes
`{{base_url}}` with the real base URL at run time, keeping cases
environment-agnostic (dev / staging / prod).

## Evidence before PASS

The test-runner must capture a final Playwright snapshot confirming the
**Expected Final State** described in the test case before recording a PASS.
A PASS without a confirming snapshot is invalid.

## Test-run-lead is the active agent

Run `test-run-lead` directly (not via another agent). It owns the run and
dispatches sub-runs via the Agent tool — `test-author` / `test-sizer` to
assemble the suite when needed, then `test-runner` per case and
`test-reporter` at the end. Do not invoke `test-runner` manually when a led
suite run is in progress.
<!-- BUNDLE:web-qa END -->
