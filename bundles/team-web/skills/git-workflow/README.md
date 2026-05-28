# git-workflow

> Git operations, branching, commits, PRs, and release workflows.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"commit"_, _"create PR"_, _"branch"_, _"merge"_, _"rebase"_, _"cherry-pick"_, _"tag"_, or any request to manage git history.

## Requirements

- **git CLI** required; **gh CLI** for GitHub operations.
- Pre-approves `Bash(git:*)` and `Bash(gh:*)` via `allowed-tools`.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install git-workflow@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills git-workflow
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/git-workflow .claude/skills/git-workflow   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — recovery procedures (loaded on demand)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
