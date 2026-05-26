# microsoft-365

> Microsoft 365 (Graph) access to email, Teams, calendar, and SharePoint — scriptable scans plus an interactive `query.py`.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"check my email/Teams/calendar"_, _"what meetings do I have"_, _"any messages about X"_, or whenever a task needs live M365 data rather than memory.

## Requirements

- **Python 3.10+**.
- Python dependencies are installed automatically into `~/.msgraph-skill/.venv/` from [`requirements.txt`](requirements.txt) on first script run — no manual `pip install`.
- A built-in Azure AD app ID is used by default (device-code login); override via `MSGRAPH_CLIENT_ID` for your own app. See [`SKILL.md`](SKILL.md#authentication).

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install microsoft-365@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills microsoft-365
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/microsoft-365 .claude/skills/microsoft-365   # or ~/.claude/skills, .cursor/skills, .github/skills
```

### First-time authentication

```bash
python3 scripts/auth.py login    # device-code flow — relay the URL + code to the user
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`scripts/`](scripts/) — scan scripts, `query.py`, `auth.py`, bootstrap
- [`samples/`](samples/) — pre-built query definitions
- [`requirements.txt`](requirements.txt) — Python dependencies (auto-installed)
- [`setup.yaml`](setup.yaml) — install-time setup

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
