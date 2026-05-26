# tech-lead — "Rio"

> Use when a user story needs technical decomposition into dependency-ordered tasks with interface contracts, a confirmed bug needs root-cause analysis, or a PR needs a blocking code review before merge.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | core |
| Aliases | `tl`, `rio` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install tech-lead@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --agents tech-lead
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/tech-lead .claude/agents/tech-lead   # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot`, or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install.

## Skills this agent uses

In this repo: `code-review`, `root-cause-analysis`, `plan-feature`, `git-workflow`, `memory`.

External †: `writing-skills`.

† External skills resolve from `skills.json` or your [superpowers](https://github.com/obra/superpowers) install; pending ones are skipped with a notice.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules
- [`SOUL.md`](SOUL.md) — persona, voice, values

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles that include this agent: [`../../bundles/`](../../bundles/)
