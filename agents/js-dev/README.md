# js-dev — "Jay" (JavaScript/TypeScript developer)

> Use when JavaScript or TypeScript work needs to be implemented — React components, Next.js pages, Node backend services, or any JS/TS task requiring TDD and verification before handoff.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | dev |
| Workspace | `clone` (works in an isolated clone) |
| Aliases | `js`, `jay` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install js-dev@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot)

```bash
npx github:arozumenko/sdlc-skills init --agents js-dev
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/js-dev .claude/agents/js-dev       # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot` (it writes `.github/agents/js-dev.agent.md`), or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install.

## Skills this agent uses

In this repo: `implement-feature`, `bugfix-workflow`, `root-cause-analysis`, `code-review`, `git-workflow`, `completing-a-task`, `memory`.

External †: `tdd`, `systematic-debugging`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`.

† External skills resolve from `skills.json` or your [superpowers](https://github.com/obra/superpowers) install; pending ones are skipped with a notice.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules
- [`SOUL.md`](SOUL.md) — persona, voice, values

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles that include this agent: [`../../bundles/team-web`](../../bundles/team-web)
