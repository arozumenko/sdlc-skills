# test-case-analysis

> Execute a TMS test case end-to-end, capture stable selectors, flag defects, and emit an Automation-Friendly Spec (AFS). Does not write test code.

A skill for the [sdlc-skills](../../README.md) toolkit. Full instructions live in [`SKILL.md`](SKILL.md); this file is just how to install it.

## When it triggers

Loads on _"analyse SCRUM-T101 for automation"_, _"run this case and emit an AFS"_, or any TMS-case exploration before automation.

## Requirements

- None hard-bundled. Needs access to the TMS holding the case, plus a browser/app to execute it.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install test-case-analysis@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --skills test-case-analysis
```

Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite. Installs as part of `--all`.

### Manual

```bash
cp -r skills/test-case-analysis .claude/skills/test-case-analysis   # or ~/.claude/skills, .cursor/skills, .github/skills
```

## Contents

- [`SKILL.md`](SKILL.md) — instructions
- [`references/`](references/) — AFS spec format (loaded on demand)

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Agent Skills spec: <https://agentskills.io/specification>
