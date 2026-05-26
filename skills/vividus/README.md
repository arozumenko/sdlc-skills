# vividus

> Bootstrap, configure, and author tests for the Vividus BDD framework — JBehave-based, config-first `.story` files spanning web/REST/mobile/DB via 47+ plugins.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads when you mention Vividus, `.story` files, `vividus-bom`/`-starter`, backtick-parameter BDD, or `./gradlew runStories`.

## Requirements

- A **JVM / Gradle** project (Vividus is JBehave-based). The skill bootstraps BOM-pinned versions.
- Targets Vividus `0.6.x`. Framework docs: <https://docs.vividus.dev/vividus/latest/>

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install vividus@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills vividus
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/vividus .claude/skills/vividus   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — plugin/config reference (loaded on demand)
- [`assets/`](assets/) — scaffolding templates

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
