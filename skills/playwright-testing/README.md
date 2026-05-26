# playwright-testing

> UI/E2E test automation with the Playwright MCP server.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"test the UI"_, _"automate browser tests"_, _"check the page"_, _"take a screenshot"_, _"run Playwright"_, _"write E2E tests"_, or anything about browser-based testing.

## Requirements

- **Node.js 18+**.
- The Playwright MCP server is installed via [`setup.yaml`](setup.yaml) at install time.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install playwright-testing@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills playwright-testing
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/playwright-testing .claude/skills/playwright-testing   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — Playwright patterns (loaded on demand)
- [`setup.yaml`](setup.yaml) — MCP server setup

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
