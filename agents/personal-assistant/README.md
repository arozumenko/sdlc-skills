# personal-assistant — "Octo"

> Use when the user wants a conversational assistant to answer questions, run errands across their tools (email, calendar, Teams, notes), or quietly maintain a second-brain knowledge base in the background.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | core |
| Workspace | `shared` |
| Aliases | `pa`, `octo` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install personal-assistant@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot, Codex)

```bash
npx github:arozumenko/sdlc-skills init --agents personal-assistant
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot` / `codex`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/personal-assistant .claude/agents/personal-assistant   # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot`, or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install. For **Codex**, agents install as `.codex/agents/<name>.toml` — use the CLI with `--target codex` (a plain `cp` won’t work).

## Skills this agent uses

`obsidian-vault`, `microsoft-365`, `memory` — all in this repo. Note `microsoft-365` needs Python 3.10+ and a one-time device-code login; `obsidian-vault` needs `$OBSIDIAN_VAULT_PATH`.

## Persona setup

This agent ships a [`persona/`](persona/) directory (`USER.md`, `TOOLS.md`, `access-control.yaml`, vault templates) describing who it works for and what it may touch. Review and edit these before first use.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules
- [`SOUL.md`](SOUL.md) — persona, voice, values
- [`persona/`](persona/) — user profile, tools, access control, vault templates

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
