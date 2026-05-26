# xlsx-reader

> Read .xlsx/.xls spreadsheets (test cases, checklists, requirement matrices) into Markdown tables so an agent can ingest them.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads when the user provides an Excel file of test cases or requirements, asks to _"import this spreadsheet"_, _"read these test cases"_, _"convert this checklist"_, or whenever a task needs structured tabular data from a `.xlsx` / `.xls` source.

## Requirements

- **Node.js 18+** required.
- **`xlsx` npm package** required. Install on demand with `npm i xlsx`.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install xlsx-reader@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills xlsx-reader
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/xlsx-reader .claude/skills/xlsx-reader   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (self-contained)
- [`scripts/read_xlsx.js`](scripts/read_xlsx.js) — Node.js script that converts sheets to Markdown tables

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
