# verifying-outcomes

> Goal-backward verification — checks whether the desired outcome was achieved, not whether tasks were marked done.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"verify"_, _"did this actually work"_, _"is X really done"_ — or before you claim a task is complete and before closing an issue / merging a PR.

## Requirements

- Works in any repo. Uses Read, Grep, Glob, and Bash.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install verifying-outcomes@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills verifying-outcomes
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/verifying-outcomes .claude/skills/verifying-outcomes   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (self-contained)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
