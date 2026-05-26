# scout — "Kit" (codebase scout)

> Use when an unfamiliar codebase needs to be onboarded — generating CLAUDE.md, AGENTS.md, `.agents/` content docs, and per-role memory briefings from exploration so the rest of the team can hit the ground running.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | core (**required** — bundles install it by default) |
| Aliases | `kit` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install scout@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --agents scout
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/scout .claude/agents/scout   # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot`, or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install.

## Skills this agent uses

`seeding-a-project`, `memory` — both in this repo.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules
- [`SOUL.md`](SOUL.md) — persona, voice, values
- [`references/`](references/) — exploration workflow

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles always include `scout` to onboard the repo first.
