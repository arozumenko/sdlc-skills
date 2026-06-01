# Optional Audit MCP Servers

The quality audit runs fully on the `browser-verify` skill (CDP) with **zero**
external MCPs. The servers below are **optional accelerators** — when a host has
one configured, a specialist prefers its richer data over hand-rolled CDP
collection. Never assume one is present; degrade to browser-verify when it isn't,
and never instruct the user to install one as a hard dependency.

This file is a catalog only. The audit **never edits MCP config files** — it
reads what's registered and uses what's there. Wiring is the operator's / scout's
job (see `seeding-a-project`).

## Catalog — which MCP serves which specialist

| MCP server | Feeds | What it adds over CDP |
|---|---|---|
| `accessibility-scanner` | [`accessibility-audit`](../../accessibility-audit/SKILL.md) | Deeper WCAG scanning beyond axe-core injection |
| `snyk` | [`security-audit`](../../security-audit/SKILL.md) | SCA / dependency + code vulnerability scanning |
| `sentry` | [`performance-audit`](../../performance-audit/SKILL.md) | Real production errors + performance traces |
| `browserstack` | [`responsive-audit`](../../responsive-audit/SKILL.md) | Real-device matrix beyond local viewport emulation |
| `postman` | [`test-generation`](../../test-generation/SKILL.md) (API) | Collection-driven API test scaffolding |
| `test-management` (OneTest) | quality-audit-workflow § OneTest run sync | Push/sync test executions + findings to OneTest |

Other servers commonly co-located in the same config (`playwright`,
`chrome-devtools`, `context7`, `websearch`, `github`, `atlassian`) are general
tooling, not audit specialists — the workflow uses them via their own skills
(`deep-research` for websearch, `issue-tracking`/`atlassian-content` for trackers).

## Config snippets

Source of truth: `onetest-ai/qa-agent` `templates/mcp.json.example`. The audit MCPs:

```json
{
  "accessibility-scanner": {
    "command": "npx",
    "args": ["-y", "mcp-accessibility-scanner"]
  },
  "snyk": {
    "command": "snyk",
    "args": ["mcp", "-t", "stdio"]
  },
  "sentry": {
    "command": "npx",
    "args": ["-y", "@sentry/mcp-server"],
    "env": { "SENTRY_AUTH_TOKEN": "YOUR_SENTRY_TOKEN" }
  },
  "browserstack": {
    "command": "npx",
    "args": ["-y", "@browserstack/mcp-server"],
    "env": {
      "BROWSERSTACK_USERNAME": "YOUR_USERNAME",
      "BROWSERSTACK_ACCESS_KEY": "YOUR_ACCESS_KEY"
    }
  },
  "postman": {
    "command": "npx",
    "args": ["-y", "@postman/postman-mcp-server"],
    "env": { "POSTMAN_API_KEY": "YOUR_API_KEY" }
  },
  "test-management": {
    "type": "http",
    "url": "https://tms.onetest.ai/mcp/test-management",
    "headers": {
      "Authorization": "Bearer YOUR_OCTO_API_KEY",
      "X-Project-Id": "YOUR_PROJECT_ID"
    }
  }
}
```

## Per-host file mapping

The same server definitions go into a different file with a different top-level
key per host. The block above is the *value* of that key.

| Host | Config file | Top-level key |
|---|---|---|
| Claude Code | `.mcp.json` (project) / `~/.claude.json` (user) | `mcpServers` |
| Copilot (VS Code) | `.vscode/mcp.json` | `servers` |
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| Windsurf | `.windsurf/mcp.json` | `mcpServers` |

So for Claude / Cursor / Windsurf the file looks like
`{ "mcpServers": { …snippet… } }`, and for Copilot VS Code it's
`{ "servers": { …snippet… } }`. The server *definitions* (command/args/env/url)
are identical across hosts; only the wrapper key differs.

## Detection at audit time

1. Read what's registered (read-only — never write): the host's MCP config file
   from the table above, plus your own session's available `mcp__*` tools.
2. If an audit MCP is present, the matching specialist prefers it; otherwise it
   falls back to `browser-verify` CDP collection.
3. **No phantom tools.** Only call `mcp__<server>__<tool>` for servers actually
   registered. If none of the audit MCPs are present, the audit still runs fully
   on browser-verify — note "no audit MCPs visible" in the report footer.
