# test-automation-engineer — "Axel"

> Use when an Automation-Friendly Spec (AFS) needs to become a green, framework-resident test. Matches the project's existing framework (Playwright/Cypress/pytest/JUnit/…), never masks product defects, and stops at the AFS boundary.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | qa |
| Workspace | `clone` (works in an isolated clone) |
| Aliases | `axel`, `automation` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install test-automation-engineer@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --agents test-automation-engineer
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/test-automation-engineer .claude/agents/test-automation-engineer   # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot`, or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install.

## Skills this agent uses

In this repo: `test-automation-workflow`, `playwright-testing`, `browser-verify`, `code-review`, `bugfix-workflow`, `git-workflow`, `completing-a-task`, `memory`.

External †: `playwright-cli`, `tdd`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`.

† External skills resolve from `skills.json` or your [superpowers](https://github.com/obra/superpowers) install; pending ones are skipped with a notice.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules
- [`SOUL.md`](SOUL.md) — persona, voice, values

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles that include this agent: [`../../bundles/`](../../bundles/)
