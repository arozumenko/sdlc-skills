# browser-verify

> Chrome DevTools Protocol browser automation with zero external dependencies — run arbitrary JS in a page, inspect cookies/localStorage, check computed styles, emulate devices, or drive real mouse/keyboard events.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads when you need low-level browser control: executing JS in a live page, reading storage/cookies, checking computed CSS, emulating a device, or simulating real input events.

## Requirements

- **Chrome / Chromium** and **Node 22+**.
- No `npm install` needed — it talks to Chrome over the DevTools Protocol directly.
- [`setup.yaml`](setup.yaml) describes the environment the installer wires up.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install browser-verify@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills browser-verify
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/browser-verify .claude/skills/browser-verify   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`scripts/`](scripts/) — CDP driver scripts
- [`references/`](references/) — CDP command reference (loaded on demand)
- [`setup.yaml`](setup.yaml) — install-time environment setup

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
