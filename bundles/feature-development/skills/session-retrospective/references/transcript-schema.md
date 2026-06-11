# Claude Code transcript layout

Per project, under `~/.claude/projects/<encoded-cwd>/`, where `<encoded-cwd>`
is the absolute project path with `/` and `.` replaced by `-`
(e.g. `/Users/x/dev/app` → `-Users-x-dev-app`). If the encoded dir is absent,
the parser falls back to scanning project dirs and matching the `cwd` field
inside transcripts.

```
<encoded-cwd>/
├── <session-id>.jsonl            main session (one JSON record per line)
└── <session-id>/
    └── subagents/
        ├── agent-<id>.jsonl      a sub-agent session
        └── agent-<id>.meta.json  { agentType, description, toolUseId }
```

## Record fields the parser uses

- `type`: `user` | `assistant` | `system` | `file-history-snapshot` | …
- `message`: `{ role, content }`. `content` is a string or an array of blocks.
  - assistant blocks: `{ type: "tool_use", id, name, input }`
  - user blocks: `{ type: "tool_result", tool_use_id, is_error }` or `{ type: "text", text }`
- `timestamp` (ISO), `gitBranch`, `cwd`, `sessionId`
- `attributionSkill`, `attributionPlugin` — which skill/plugin was active
- `toolUseResult` — top-level tool result payload (may carry `is_error`)

The schema can drift between Claude Code versions. The parser is defensive
(skips unparseable lines, tolerates missing fields); re-calibrate the unit
tests if fields change.
