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
  `bugfix-workflow`, `code-review`, `tdd`, `task-completion`,
  `git-workflow`, `memory`, `playwright-testing`, `browser-verify`,
  `issue-tracking`, `xray-testing`, `atlassian-content`,
  `tosca-automation`, `test-case-analysis`, `test-automation-workflow`,
  `goal-verifier`, `context-gatherer`, `deep-research`,
  `obsidian-vault`, `msgraph`, `project-seeder`.
- **`skills.json`** — catalog of all skills, monorepo and external.
  The installer uses it to resolve + fetch external skills (from
  `mattpocock/skills`, `obra/superpowers`, `twostraws/*-Agent-Skill`).

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
(`~/.cache/sdlc-skills/registry/`) with symlinks back into the project's
skill dir. Everything ends up in the directory the agent expects to find
it in. See the README for full flag docs.

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

## Integrating with Octobots

The [Octobots supervisor](https://github.com/arozumenko/octobots) treats
this repo as its content layer: agents + skills live here, orchestration
(tmux TUI, taskbox, scheduler, team-board) lives there. Octobots'
`install.sh` delegates all content resolution to this repo's installer.
