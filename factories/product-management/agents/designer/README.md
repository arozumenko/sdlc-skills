# designer — "Remy" (UI/UX designer)

> Use when a journey or user flow needs to become a reviewable flow map before design or engineering.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | core |
| Aliases | `remy` |

This is the **discovery-side** copy of the designer, scoped to pre-design flow mapping. The
`feature-development` bundle ships a designer that also owns `screen-specs` for building the screens.

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install designer@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot, Codex)

```bash
npx github:arozumenko/sdlc-skills init --agents product-management/designer
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot` / `codex`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/designer .claude/agents/designer   # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot` (it writes `.github/agents/designer.agent.md`), or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install. For **Codex**, agents install as `.codex/agents/<name>.toml` — use the CLI with `--target codex` (a plain `cp` won’t work).

## Skills this agent uses

`brainstorming` † (external), `memory` (in this repo) · **on demand:** `user-flow-maps` (in this repo).

`user-flow-maps` is `skills-on-demand` — installed on disk, loaded by the agent when a flow needs mapping. It is platform-agnostic (it maps behaviour, not design).

† External skills resolve from `skills.json` or your [superpowers](https://github.com/obra/superpowers) install; pending ones are skipped with a notice.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules
- [`SOUL.md`](SOUL.md) — persona, voice, values

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles that include this agent: [`../../bundles/`](../../bundles/)
