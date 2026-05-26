# obsidian-vault

> Headless, file-system Obsidian vault operations — no Obsidian app needed.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"save to vault"_, _"log this note"_, _"find my notes about X"_, _"what's in my inbox"_, _"open loops"_, or when filing an incoming signal (email/chat/memo) or updating people/project/meeting notes.

## Requirements

- **Python 3.10+** (stdlib only).
- Vault path via `$OBSIDIAN_VAULT_PATH` (legacy `$OCTOBOTS_VAULT_PATH` also honored).
- **ripgrep** recommended (falls back to `grep`).

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install obsidian-vault@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills obsidian-vault
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/obsidian-vault .claude/skills/obsidian-vault   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`scripts/`](scripts/) — vault operations (stdlib Python)
- [`templates/`](templates/) — note templates (daily, meeting, person, project, …)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
