---
name: issue-tracking
description: Create, query, and update issues on whatever tracker the project uses — GitHub Issues, GitLab, Jira, Azure DevOps, or Linear. Tracker-aware — reads `.agents/profile.md` § Project systems § Issue tracker and dispatches to the matching CLI or MCP. Use when the user asks to "create an issue", "file a bug", "file a defect", "check issues", "update a ticket", "create an epic", or anything about issue / ticket / work-item management.
license: Apache-2.0
compatibility: Requires the tracker's CLI or MCP wired in — gh / glab / Atlassian MCP / Azure DevOps MCP / Linear CLI/MCP. Scout's Step 6.8 wires these per-agent on restrictive hosts.
allowed-tools:
  - Bash(gh:*)
  - Bash(linear:*)
  - Bash(glab:*)
metadata:
  author: octobots
  version: "0.2.0"
---

# Issue Tracking

Create, query, comment on, and close tickets on whatever tracker the
project actually uses. This skill is **tracker-aware** — the same
operation lands in the right system because the dispatch reads
`.agents/profile.md`.

## Step 0 — Read the destination from profile.md

Before any command, open `.agents/profile.md` § Project systems §
Issue tracker. Scout's Step 0.7 records one of:

| Value (profile.md) | Default tooling |
|---|---|
| `github-issues` *(default)* | `gh` CLI |
| `gitlab-issues` | `glab` CLI |
| `jira` | Atlassian MCP (create / comment / transition); body must be in ADF |
| `azure-devops` | Azure DevOps MCP (`az boards` as a fallback) |
| `linear` | Linear CLI (`linear`) or Linear MCP |
| `Unconfirmed` | Default to `gh`; surface the gap to the operator so scout can fill the field |

On restrictive hosts (e.g. Copilot CLI), scout's Step 6.8 has already
wired the matching CLI/MCP into the calling agent's `tools:`
whitelist based on what's actually installed. If the named tracker
has no wired tool, **stop and escalate** rather than silently falling
back — the right ticket in the wrong tracker is worse than no ticket.

## Body templates

Body shapes are tracker-agnostic markdown — they live in
[`references/templates.md`](references/templates.md) and are reused
across all trackers. Pick:

- **Bug Report** — defect filing (severity, environment, steps,
  expected, actual, evidence, frequency, workaround); for
  lightweight clarifications, use the same template at `[INFO]`
  severity
- **Task** — implementation task under an epic
- **Epic** — multi-task feature umbrella

Render the markdown body, then hand it to the tracker-specific
command below. Jira / Azure DevOps require ADF (Atlassian Document
Format) rather than markdown — convert via whatever ADF-authoring
capability your agent has wired.

## File a defect

Standard flow when the caller is filing a new defect:

1. Read `.agents/profile.md` § Project systems § Issue tracker (see
   Step 0 above) and § Bug filing — the latter records:
   - **Bug filing style**: `github-issue` (standalone) / `story-subtask`
     (sub-task under a parent story; Jira / ADO only) / `separate-ticket`
     (filed into a dedicated QA/bugs project)
   - **Bug filing target**: when style is `separate-ticket`, the
     destination project/board key
2. Fill the **Bug Report** template from `references/templates.md`.
3. Open the ticket via the tracker's create command (see *Create
   issue* below). For `story-subtask`, the caller is responsible for
   providing the parent story ID; pass it as the parent when invoking
   the tracker's create command. For `separate-ticket`, target the
   project named in § Bug filing target.
4. Return the ticket ID and URL to the caller. What the caller does
   with that ID (note in an AFS, attach to a test, link in a PR
   body) is caller policy, not this skill's concern.

This skill files tickets and posts/queries/closes them. It does **not**
own the in-flight comment language a developer posts while *fixing*
a bug (investigating / reproduced / root-cause / fixed) — that belongs
to whatever dev-fix-lifecycle skill the project uses. Callers who
need both file the initial defect through this skill, then drive the
fix lifecycle separately.

## Create issue

### GitHub (`github-issues`)

```bash
gh issue create --title "Short title" --body "$(cat <<'EOF'
<body from references/templates.md>
EOF
)" --label "bug,high-priority"
```

### GitLab (`gitlab-issues`)

```bash
glab issue create --title "Short title" --description "$(cat <<'EOF'
<body from references/templates.md>
EOF
)" --label "bug,high-priority"
```

### Jira (`jira`) — via Atlassian MCP

Call the Atlassian MCP's create-issue tool with:
- `projectKey` from `.agents/profile.md` § Issue tracker key
- `issueType` (`Bug` / `Task` / `Story` / `Sub-task`)
- `summary` (title)
- `description` (body — must be ADF, not markdown; convert via the
  agent's wired ADF-authoring capability before this call)
- `parentKey` for `story-subtask`
- `labels` / `priority` per project conventions

### Azure DevOps (`azure-devops`)

Via Azure DevOps MCP or `az boards work-item create --type Bug --title
"..." --description "..."` — same field shape as Jira.

### Linear (`linear`)

Via Linear MCP or `linear issue create --title "..." --description
"..." --team <team-key> --label "bug"`.

## Query issues

The shape is the same across trackers (list / view / search); the
command differs. Default examples are GitHub; substitute per Step 0.

```bash
# GitHub — default
gh issue list --state open
gh issue list --label "bug" --state open
gh issue list --assignee "@me"
gh issue list --search "auth timeout"
gh issue view 123

# GitLab equivalents
glab issue list --state opened
glab issue list --label "bug"
glab issue list --assignee "@me"
glab issue list --search "auth timeout"
glab issue view 123

# Jira / ADO / Linear — drive list / get via the wired MCP. JQL /
# WIQL / Linear filter syntax replaces the CLI flags.
```

## Update issues

```bash
# GitHub
gh issue comment 123 --body "Status update: PR #456 submitted"
gh issue edit 123 --add-label "in-progress"
gh issue edit 123 --add-assignee username
gh issue close 123 --reason completed

# GitLab
glab issue note 123 -m "Status update: MR !456 submitted"
glab issue update 123 --label "in-progress"
glab issue update 123 --assignee username
glab issue close 123

# Jira — via Atlassian MCP
# - add_comment(issueKey, body_adf)
# - transition_issue(issueKey, transition="In Progress")
# - assign_issue(issueKey, accountId)
# - transition_issue(issueKey, transition="Done")

# Azure DevOps — via ADO MCP / `az boards work-item update`
# Linear — via Linear MCP / `linear issue update`
```

## Labels (tracker-specific concept)

GitHub / GitLab / Linear have labels; Jira / ADO use components
and/or workflow states. Create labels that map to the team's
workflow:

```bash
# GitHub
gh label create "epic" --color "3E4B9E" --description "Feature epic"
gh label create "task" --color "0E8A16" --description "Implementation task"
gh label create "bug" --color "D73A4A" --description "Something isn't working"
gh label create "high-priority" --color "B60205" --description "Needs attention soon"
gh label create "blocked" --color "FBCA04" --description "Waiting on dependency"

# GitLab
glab label create --name "epic" --color "#3E4B9E" --description "Feature epic"
# … same shape for the rest
```

For Jira / ADO, labels are configured in the project once — no per-
operation create needed. Linear has built-in workflow states; map
your team's labels onto those rather than creating ad-hoc ones.

## Work log (audit trail)

**Every meaningful action gets a comment on the ticket** — same
discipline regardless of tracker.

| Event | Comment prefix |
|-------|--------|
| Start work | `🔧 **Started**: approach...` |
| Progress update | `📝 **Update**: what changed...` |
| Blocked | `🚫 **Blocked**: what's needed...` |
| Complete | `✅ **Done**: summary, PR link` |
| Testing | `🧪 **Testing**: plan...` |
| Bug found | `🐛 **Bug**: severity, repro, evidence` |
| Verified | `✅ **Verified**: what was tested` |
| Assigned | `📬 **Assigned**: to whom` |
| Decomposed | `🔨 **Decomposed**: task list` |

```bash
# GitHub example
gh issue comment 103 --body "🔧 **Started**: Implementing login endpoint using existing auth middleware."

# GitLab example
glab issue note 103 -m "🔧 **Started**: Implementing login endpoint using existing auth middleware."

# Jira / ADO / Linear — same prefix discipline, body posted via the
# wired MCP's add-comment / add-work-item-comment tool.
```

## Details

See [`references/templates.md`](references/templates.md) for the full
body templates (Bug Report, Task, Epic, Story, Clarification).
