# completing-a-task

> The five-step protocol that marks a routed task truly "done" — commit, push, open a PR, comment on the issue, and notify your reviewer. Writing code is step 1; handoff is step 5.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads when you've finished implementing a routed task and need to hand it off cleanly: commit → push → PR → issue comment → reviewer notification.

## Requirements

- None bundled. Uses your host/tracker/CI as discovered by `scout` (git, PR host, issue tracker). Composes with `git-workflow` and `issue-tracking`.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install completing-a-task@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills completing-a-task
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/completing-a-task .claude/skills/completing-a-task   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (self-contained)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
