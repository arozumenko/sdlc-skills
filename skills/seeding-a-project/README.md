# seeding-a-project

> Generate AGENTS.md and `.agents/` configuration files for a new project.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"seed the project"_, _"onboard this repo"_, _"generate project config"_, _"create AGENTS.md"_, or after the `scout` agent has explored the codebase. (This is `scout`'s primary skill.)

## Requirements

- Project-root **write access**. No external dependencies.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install seeding-a-project@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills seeding-a-project
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/seeding-a-project .claude/skills/seeding-a-project   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — templates, role overrides, team-comms (loaded on demand)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
