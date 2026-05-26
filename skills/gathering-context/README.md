# gathering-context

> Gather cross-channel context (local KB, email, Teams, optional web) about a person or topic before responding.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"what do we know about X"_, _"find prior discussions with Y"_, or before drafting any reply where prior history matters.

## Requirements

- **MS Graph tools** required: `search-query`, `list-mail-messages`, `get-mail-message`, `find-chat`, `list-chat-messages`.
- Web search optional.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install gathering-context@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills gathering-context
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/gathering-context .claude/skills/gathering-context   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (self-contained)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
