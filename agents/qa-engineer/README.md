# qa-engineer — "Sage"

> Use when a feature needs verification, a bug needs reproduction with evidence, E2E tests need writing or running via Playwright, or a TMS case needs turning into an automation-ready spec (AFS).

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | qa |
| Aliases | `qa`, `sage` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install qa-engineer@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --agents qa-engineer
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/qa-engineer .claude/agents/qa-engineer   # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot`, or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install.

## Skills this agent uses

In this repo: `playwright-testing`, `browser-verify`, `reproducing-issues`, `bugfix-workflow`, `test-case-analysis`, `issue-tracking`, `memory`.

External †: `playwright-cli`, `systematic-debugging`, `verification-before-completion`.

† External skills resolve from `skills.json` or your [superpowers](https://github.com/obra/superpowers) install; pending ones are skipped with a notice.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules
- [`SOUL.md`](SOUL.md) — persona, voice, values

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles that include this agent: [`../../bundles/`](../../bundles/)
