# issue-tracking

> Create, manage, and track issues in GitHub, Linear, or GitLab.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"create an issue"_, _"file a bug"_, _"check issues"_, _"update a ticket"_, _"create an epic"_, or anything about issue/ticket management.

## Requirements

- **gh CLI** for GitHub, or **linear** / **glab** CLI for the other trackers.
- Pre-approves `Bash(gh:*)`, `Bash(linear:*)`, `Bash(glab:*)` via `allowed-tools`.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install issue-tracking@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills issue-tracking
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/issue-tracking .claude/skills/issue-tracking   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — tracker-specific notes (loaded on demand)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
