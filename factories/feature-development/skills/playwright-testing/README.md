# playwright-testing

> Live browser testing through the Playwright MCP server — no test code generated.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

This is the **manual-QA** copy: it drives a real browser live to explore web apps and execute test cases (used by `app-profiler` and `test-runner`). It does **not** write Playwright code — that is the `test-automation-engineer`'s automation-focused copy in the feature-development / test-automation bundles.

## When it triggers

Loads when a manual-QA agent does browser testing **via Playwright MCP**: profiling/exploring a web (or PWA/hybrid) app, executing a web test case live against a running app, verifying UI state, or collecting browser evidence (snapshots, screenshots, console, network).

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
