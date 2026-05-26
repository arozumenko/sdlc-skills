# xray-testing

> CRUD + results import on Xray entities (Test, Precondition, Test Set/Plan/Execution/Run) across Cloud (GraphQL) and Server/DC (REST).

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"pull test PROJ-T42"_, _"create Xray test from this AFS"_, _"upload JUnit to test plan"_, or any Xray CRUD.

## Requirements

- An **Xray** instance — Cloud (GraphQL API) or Server/Data Center (REST) — and API credentials.
- Helper scripts are bundled in [`scripts/`](scripts/).

## Install

This skill is **not** published as an individual Claude Code plugin. Use the CLI or copy it manually.

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills xray-testing
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/xray-testing .claude/skills/xray-testing   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`scripts/`](scripts/) — Xray API helpers
- [`references/`](references/) — Cloud GraphQL, Server REST, entities, results import, Jira REST fallback

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
