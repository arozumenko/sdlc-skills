# deep-research

> Disk-first, checkpointed research workflow with three modes — trend research, topic analysis, and fact-checking.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"research trends"_, _"analyze a topic"_, _"fact-check this"_, _"verify claims"_, _"what's the state of X"_, or when handed a document to vet.

## Requirements

- **`tavily_search` / `tavily_extract`** tools required.
- **Context7** (`resolve-library-id`, `query-docs`) optional, for technical topics.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install deep-research@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills deep-research
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/deep-research .claude/skills/deep-research   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions (self-contained)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
