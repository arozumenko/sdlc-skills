# Hooks

These hooks replace the per-agent `@.agents/...` imports that used to sit at the
top of each `AGENT.md`. `@import` is a Claude Code `CLAUDE.md` feature — it is
**not** processed in subagent definition files, and it does **not** exist in
Cursor, Copilot CLI, Codex, or Kiro. It also does not survive `/clear` or context
compaction, because inlined text is summarised away. Hooks fix both problems:
they re-fire on `clear`/`compact`/`resume`, and they run on every runtime.

## What gets injected

| Content | Hook | Scope |
|---|---|---|
| `.agents/memory/<role>/snapshot.md` | `agent-start` | per agent, every dispatch |
| Lean shared docs: `role-overrides.md`, `profile.md`, `workflow.md`, `testing.md`, `conventions.md`, `team-comms.md` | `session-start` (parent session) **and** `agent-start` (each subagent) | per session / per dispatch; re-injected on clear/compact |
| Roster reminder → `memory` skill | `session-start` | only on Cursor & Kiro (no context-injecting per-agent hook) |

A dispatched subagent gets a fresh context that does **not** inherit the parent's
`SessionStart` injection, so `agent-start` delivers the shared docs to each
subagent too. Big manuals (`AGENTS.md`, `docs/`, `.agents/architecture.md`) are
deliberately **not** injected — they stay as on-demand reads in the agent prompts.

A missing file is skipped — same no-op-on-missing behaviour the old `@import`
relied on, so the hooks are safe on an unseeded project.

## Files

- `run-hook.cmd` — polyglot cmd/bash wrapper (Windows finds Git Bash; Unix execs
  bash). Extensionless target names dodge Claude Code's Windows `.sh`
  auto-detection. Borrowed from the superpowers project.
- `session-start` — injects shared `.agents/*.md` context + (off Claude Code) the
  roster reminder. Platform-detects the output shape.
- `agent-start` — injects the spawning role's `snapshot.md`.
- `lib.sh` — shared helpers: JSON escaping, jq-free field extraction, platform
  detection, and the two `emit_*` formatters.
- `hooks.json` — Claude Code config (auto-discovered at plugin root).
- `hooks-codex.json`, `hooks-cursor.json`, `hooks-copilot.json`, `hooks-kiro.json`
  — reference templates. The `npx … init` CLI generates the live per-target
  configs from these (with project-relative paths); they're also the manual
  wiring path for Codex/Kiro. See *Wiring* below. Cursor's `subagentStart` is
  permission-only, so its config wires `sessionStart` only (per-agent memory
  falls back to the roster reminder).

## Portability matrix

| Runtime | Per-agent memory | Shared project context | Survives clear/compact | Hook config location |
|---|---|---|---|---|
| **Claude Code** | ✅ `SubagentStart` (`agent_name`) → `agent-start` | ✅ `SessionStart` → `session-start` | ✅ (`startup\|clear\|compact\|resume`) | auto: `hooks/hooks.json` at plugin root |
| **Codex** | ✅ `SubagentStart` (`agent_type`), same shape as CC | ✅ `SessionStart` | ✅ (`startup\|resume\|clear\|compact`) | `~/.codex/hooks.json` or `<repo>/.codex/hooks.json` |
| **Copilot CLI** | ✅ `subagentStart` (`agentName`) → `agent-start` | ✅ `sessionStart` (v1.0.11+ honours `additionalContext`) | ✅ on resume | `.github/hooks/*.json` or `~/.copilot/hooks/` |
| **Cursor** | ❌ `subagentStart` is permission-only (no context inject; generic `subagent_type`) → roster reminder + `memory` skill | ✅ `sessionStart` | ✅ (`sessionStart` re-fires; `preCompact` exists) | `.cursor/hooks.json` |
| **Kiro** | ⚠️ `agentSpawn` carries no agent name → per-agent config passes the role explicitly | ✅ via `agentSpawn` (raw stdout) | n/a (per-spawn) | inside each custom-agent config `hooks` field |

**Bottom line:** per-agent memory auto-load works on **Claude Code, Codex, and
Copilot CLI** (all three have a context-injecting per-agent start hook that names
the agent). **Cursor** has the event but it's permission-only, and **Kiro**'s
lacks the agent name — both fall back to the session-start roster reminder + the
`memory` skill. Shared project context and durability across `clear`/`compact`
hold on every runtime — the thing `@import` never had.

## Platform detection

`session-start` chooses its output shape from environment variables (the same
scheme superpowers uses), so one script serves every runtime:

- `SDLC_HOOK_RAW=1` → plain text on stdout (Kiro `agentSpawn` appends stdout to context)
- `CURSOR_PLUGIN_ROOT` set → `{ "additional_context": ... }`
- `PLUGIN_ROOT` set or `CODEX_HOOK=1` → `{ "hookSpecificOutput": { "hookEventName": ..., "additionalContext": ... } }` (Codex; same shape as CC)
- `CLAUDE_PLUGIN_ROOT` set and `COPILOT_CLI` unset → `{ "hookSpecificOutput": ... }` (Claude Code)
- `COPILOT_CLI=1` → `{ "additionalContext": ... }` (SDK standard)

`agent-start` emits the `SubagentStart`/`hookSpecificOutput` variant on Claude
Code and Codex, the top-level `additionalContext` variant on Copilot CLI, and raw
stdout when called directly with a role argument (the Kiro path).

> **Note on `SubagentStart`:** Claude Code's payload schema is underdocumented
> (see [anthropics/claude-code#19170](https://github.com/anthropics/claude-code/issues/19170)).
> `agent-start` parses the agent name defensively, trying `agentName` (Copilot),
> `agent_name` (CC proposed), `subagent_type` (Cursor), `agent_type` (Codex),
> `agentType`, then `name`. If a runtime settles on a different field, add it to
> that list in `agent-start`.

## Wiring

Two install paths:

- **Plugin marketplace** (all four runtimes): each runtime's plugin manifest
  points at its correctly-shaped hooks file, auto-loaded at the plugin root.
  - Claude Code — auto-discovers `hooks/hooks.json` (no manifest entry needed);
    `${CLAUDE_PLUGIN_ROOT}` in the commands.
  - Codex — `.codex-plugin/plugin.json` `"hooks": "./hooks/hooks-codex.json"`;
    `${PLUGIN_ROOT}` in the commands.
  - Cursor — `.cursor-plugin/plugin.json` `"hooks": "./hooks/hooks-cursor.json"`;
    plugin-root-relative `./hooks/…` commands.
  - Copilot CLI — root `plugin.json` `"hooks": "./hooks/hooks-copilot.json"`;
    plugin-root-relative `./hooks/…` commands.

  The per-runtime `marketplace.json` files (`.cursor-plugin/`, `.codex-plugin/`,
  `.github/plugin/`) are generated from the catalog by
  `bin/gen-marketplaces.mjs` (`npm run gen:marketplaces`; `npm run validate`
  fails if stale). They list an umbrella "full toolkit" entry plus individual
  agent/skill entries — agents only where the runtime's plugins support them
  (Claude, Cursor); Codex/Copilot ship skills + hooks, and their agents install
  via the CLI below (Copilot needs flat `.agent.md` files).
- **`npx … init` CLI** (`bin/init.mjs`): every install runs `installCoreHooks()`,
  which copies the four scripts into `<target>/hooks/sdlc-skills/` and writes each
  selected runtime's native config with project-relative paths:
  - **Claude** → merges `SessionStart` + `SubagentStart` into
    `.claude/settings.json` (tagged `_bundle: "sdlc-core"`, replaced in place on
    re-run; uses `${CLAUDE_PROJECT_DIR}`).
  - **Cursor** → merges `sessionStart` into `.cursor/hooks.json`, preserving the
    user's other hooks (`subagentStart` is permission-only, so it's not wired).
  - **Copilot CLI** → writes `.github/hooks/sdlc-skills.json` (`sessionStart` +
    `subagentStart`, `COPILOT_CLI=1`).
  - **Codex** → writes `.codex/hooks.json` (Claude-shaped SessionStart +
    SubagentStart; the command sets `CODEX_HOOK=1` so the script emits the
    `hookSpecificOutput` shape for a non-plugin project install). Codex agents
    install as `.codex/agents/<name>.toml`; skills to `.codex/skills/`.
  - **Windsurf** → skipped (no documented hook API).

**Kiro** isn't a CLI install target — paste the `hooks-kiro.json` snippet into
each Kiro custom-agent config's `hooks` field (its `agentSpawn` carries no agent
name, so each agent passes its role explicitly). The plugin path for Codex uses
`${PLUGIN_ROOT}` instead of `CODEX_HOOK`; see `hooks-codex.json`.

## Testing locally

```sh
TMP=$(mktemp -d); mkdir -p "$TMP/.agents/memory/project-manager"
echo '## snapshot' > "$TMP/.agents/memory/project-manager/snapshot.md"
echo '# overrides' > "$TMP/.agents/role-overrides.md"

# Claude Code SessionStart
CLAUDE_PLUGIN_ROOT=/x CLAUDE_PROJECT_DIR="$TMP" bash hooks/session-start
# Claude Code SubagentStart
CLAUDE_PLUGIN_ROOT=/x CLAUDE_PROJECT_DIR="$TMP" \
  bash hooks/agent-start <<<'{"agent_name":"project-manager"}'
# Cursor (note the roster reminder)
CURSOR_PLUGIN_ROOT=/x CLAUDE_PROJECT_DIR="$TMP" bash hooks/session-start
```
