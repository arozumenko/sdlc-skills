# test-automation-workflow

> End-to-end test automation workflow — Explore, Specify, Implement, Review — over a pluggable TMS (Zephyr/TestRail/Xray/Azure/markdown).

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"automate TC-NNN"_, _"convert this case to Playwright"_, or any flow from a manual test case to green framework tests.

## Requirements

- None hard-bundled. TMS access depends on the adapter you use (Zephyr Scale, TestRail, Xray, Azure Test Plans, or local markdown). See [`references/tms-adapters.md`](references/tms-adapters.md).

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install test-automation-workflow@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills test-automation-workflow
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/test-automation-workflow .claude/skills/test-automation-workflow   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — TMS adapters, framework scaffold, browser tools, commands (loaded on demand)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
