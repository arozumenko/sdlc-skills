# ios-dev — "Io" (iOS/Swift developer)

> Use when iOS work needs to be implemented — Swift, SwiftUI features, SwiftData models, or any Apple-platform task requiring TDD and verification before handoff.

An agent for the [sdlc-skills](../../README.md) toolkit. The agent definition lives in [`AGENT.md`](AGENT.md); this file is just how to install it.

| | |
|---|---|
| Model | `sonnet` |
| Group | dev |
| Workspace | `clone` (works in an isolated clone) |
| Aliases | `io`, `ios` |

## Install

### Claude Code plugin marketplace

```text
/plugin marketplace add arozumenko/sdlc-skills
/plugin install ios-dev@sdlc-skills
```

### npx CLI (Claude Code, Cursor, Windsurf, GitHub Copilot, Codex)

```bash
npx github:arozumenko/sdlc-skills init --agents ios-dev
```

Installing an agent **auto-resolves its declared skills**: skills in this repo are copied in; external ones are fetched from `skills.json` (or surfaced as pending if not yet available). Add `--target claude` (or `cursor` / `windsurf` / `copilot` / `codex`) to limit IDEs, and `--update` to overwrite.

### Manual

```bash
cp -r agents/ios-dev .claude/agents/ios-dev       # Claude Code / Cursor / Windsurf keep the directory
```

For **GitHub Copilot**, agents must be flat files — use the CLI with `--target copilot` (it writes `.github/agents/ios-dev.agent.md`), or run `npx github:arozumenko/sdlc-skills init fix-copilot` to convert an existing install. For **Codex**, agents install as `.codex/agents/<name>.toml` — use the CLI with `--target codex` (a plain `cp` won’t work).

## Skills this agent uses

In this repo: `implement-feature`, `bugfix-workflow`, `root-cause-analysis`, `code-review`, `git-workflow`, `completing-a-task`, `memory`.

External †: `tdd`, `systematic-debugging`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `swiftui-pro`, `swiftdata-pro`, `swift-testing-pro`, `swift-concurrency-pro`.

† External skills resolve from `skills.json` or your [superpowers](https://github.com/obra/superpowers) install; pending ones are skipped with a notice.

## Contents

- [`AGENT.md`](AGENT.md) — role, responsibilities, session start
- [`RULES.md`](RULES.md) — operating rules (incl. no-simulator discipline)
- [`SOUL.md`](SOUL.md) — persona, voice, values

## Learn more

- Repo overview & install matrix: [`../../README.md`](../../README.md)
- Team bundles that include this agent: [`../../bundles/team-ios`](../../bundles/team-ios)
