# AGENTS.md — SDLC Skills

This repo ships **role-based agent personas** and **workflow skills** for
software delivery. It is consumed by multiple coding agents (Claude Code,
Cursor, Gemini CLI, GitHub Copilot CLI, Windsurf, and more) through a mix
of native plugin formats and a shared npx installer.

## What's here

Content lives in **bundles** (`bundles/<id>/`) — team presets that physically
own their `agents/` and `skills/` as real directories. Three bundles ship:

- **`feature-development`** — cross-platform delivery team: BA, Tech Lead, PM,
  Python / JS / iOS devs, QA, Scout, test-automation-engineer.
- **`test-automation`** — TMS-driven automation pipeline: test-automation-lead,
  qa-engineer, test-automation-engineer, Scout.
- **`manual-qa`** — live-browser manual-QA team: test-run-lead, test-author,
  test-sizer, test-runner, test-reporter, app-profiler.

The top-level `agents/` and `skills/` hold only standalone-only **"orphan"**
content: one agent (`personal-assistant`) and eight skills (`deep-research`,
`gathering-context`, `verifying-outcomes`, `microsoft-365`, `obsidian-vault`,
`tosca-automation`, `vividus`, `xray-testing`).

- **`<owner>/agents/<name>/AGENT.md` + `SOUL.md`** — role personas. Each
  agent's frontmatter declares the skills it depends on.
- **`<owner>/skills/<name>/SKILL.md`** — [agentskills.io](https://agentskills.io)
  spec-compliant workflow skills (e.g. `plan-feature`, `implement-feature`,
  `bugfix-workflow`, `code-review`, `completing-a-task`, `git-workflow`,
  `memory`, `playwright-testing`, `browser-verify`, `issue-tracking`,
  `test-case-analysis`, `test-automation-workflow`, `seeding-a-project`).
- **`skills.json`** — registry of the orphan monorepo skills plus the external
  (`repo:`) skills the installer fetches from upstream (from `mattpocock/skills`,
  `obra/superpowers`, `twostraws/*-Agent-Skill`, `microsoft/playwright-cli`,
  `appium/skills`, and more).

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

Load the agent's `AGENT.md` and `SOUL.md` when starting work in that role.
The source lives under the bundle that owns it
(`bundles/<id>/agents/<name>/`); only `personal-assistant` lives at the
top-level `agents/`. The `AGENT.md` declares the skills the agent relies on —
load each skill's `SKILL.md` when its trigger conditions are met, not
preemptively.

## Using a skill

Skills are loaded on demand, not constantly in context. When a task
matches a skill's description (see its `SKILL.md` frontmatter), load the
`SKILL.md` and follow its workflow. Don't paraphrase it — skill
instructions are their own source of truth.

