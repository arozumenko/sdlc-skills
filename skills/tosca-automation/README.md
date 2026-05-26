# tosca-automation

> Tricentis TOSCA Cloud automation via the bundled `tosca_cli.py` — create/update/run TestCases, Modules, Reusable Blocks, Playlists, folders, and TSU import/export.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads when you ask to create a TOSCA test case, run a playlist, organize cases, or perform any TOSCA Cloud REST/CLI operation.

## Requirements

- Access to a **Tricentis TOSCA Cloud** workspace and API credentials.
- The `tosca_cli.py` CLI is bundled in [`scripts/`](scripts/); [`setup.yaml`](setup.yaml) describes install-time setup.
- Upstream CLI: <https://github.com/bermudas/toscacloud_cli>

## Install

This skill is **not** published as an individual Claude Code plugin. Use the CLI or copy it manually.

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills tosca-automation
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/tosca-automation .claude/skills/tosca-automation   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`scripts/`](scripts/) — `tosca_cli.py`
- [`references/`](references/) — web/SAP automation, blocks, standard modules, best practices
- [`setup.yaml`](setup.yaml) — install-time setup

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
