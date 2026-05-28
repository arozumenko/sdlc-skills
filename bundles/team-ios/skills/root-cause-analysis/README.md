# root-cause-analysis

> Trace a confirmed bug to its exact cause — execution-path tracing, root-cause classification, confidence, and impact/regression analysis, reported on the ticket. Investigation only — does not edit code.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads after a bug is reproduced, before proposing a fix.

## Requirements

- None bundled. Follows `reproducing-issues`; feeds `bugfix-workflow`.

## Install

This skill is **not** published as an individual Claude Code plugin. Use the CLI or copy it manually.

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills root-cause-analysis
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/root-cause-analysis .claude/skills/root-cause-analysis   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (self-contained)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
