# atlassian-content

> Create well-formatted Jira issues/comments and Confluence pages on both Cloud and Server/Data Center, with mandatory post-creation re-fetch + repair.

A skill for the [sdlc-skills](../../README.md) toolkit. The full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on prompts like _"file a bug"_, _"comment on JIRA-123"_, _"write up a decision page"_, or any time you author Atlassian content. After writing, it re-fetches the created content and repairs formatting drift.

## Requirements

- A reachable Jira / Confluence instance (Cloud or Server/Data Center) and credentials/tooling to call its API.
- No Python or npm dependencies bundled.

## Install

This skill is **not** published as an individual Claude Code plugin. Use the CLI or copy it manually.

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills atlassian-content
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite an existing copy. It also installs as part of `--all`.

### Manual

```bash
cp -r skills/atlassian-content .claude/skills/atlassian-content   # project-level
# or ~/.claude/skills/  ·  .cursor/skills/  ·  .github/skills/
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (loaded on trigger)
- [`references/`](references/) — ADF/wiki-storage formats, mentions, server vs cloud, verification (loaded on demand)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
