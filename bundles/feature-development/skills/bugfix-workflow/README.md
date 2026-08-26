# bugfix-workflow

> End-to-end bugfix workflow — reproduce, test-first, RCA, fix, verify, document.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"fix bug"_, _"investigate issue"_, _"fix #NNN"_, or whenever you hit a failing test or a reproducible defect — before you start patching.

## Requirements

- None bundled. Composes with `reproducing-issues`, `root-cause-analysis`, and your test runner.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install bugfix-workflow@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills bugfix-workflow
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/bugfix-workflow .claude/skills/bugfix-workflow   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — command reference (loaded on demand)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
