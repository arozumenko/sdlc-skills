# reproducing-issues

> Turn a vague bug report into precise, repeatable steps with evidence and a CONFIRMED / CANNOT-REPRODUCE / PARTIAL verdict. Reproduction and documentation only — does not fix code.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads when a bug is unclear or unconfirmed and needs reproduction before RCA or any fix.

## Requirements

- None bundled. Hands off to `root-cause-analysis`, then `bugfix-workflow`.

## Install

This skill is **not** published as an individual Claude Code plugin. Use the CLI or copy it manually.

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills reproducing-issues
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/reproducing-issues .claude/skills/reproducing-issues   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (self-contained)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
