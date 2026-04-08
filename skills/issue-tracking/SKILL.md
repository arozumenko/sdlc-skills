---
name: issue-tracking
description: Create, manage, and track issues in GitHub, Linear, or GitLab. Use when the user asks to "create an issue", "file a bug", "check issues", "update a ticket", "create an epic", or anything about issue/ticket management.
license: Apache-2.0
compatibility: Requires gh CLI for GitHub, or linear/glab CLI for other trackers
metadata:
  author: octobots
  version: "0.1.0"
---

# Issue Tracking

Create, query, and manage issues across trackers. Defaults to GitHub Issues via `gh` CLI.

## Create Issue

```bash
gh issue create --title "Short title" --body "$(cat <<'EOF'
## Summary
What happened / what's needed.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Context
Why this matters. Links to related issues.
EOF
)" --label "bug,high-priority"
```

## Create Epic

```bash
gh issue create --title "[EPIC] Feature Name" --body "$(cat <<'EOF'
## Overview
What this epic delivers and why.

## Scope
**In:** deliverable 1, deliverable 2
**Out:** explicitly not doing X

## Tasks
- [ ] #__ Task 1
- [ ] #__ Task 2
- [ ] #__ QA verification

## Acceptance Criteria
- [ ] Testable criterion 1
- [ ] Testable criterion 2
EOF
)" --label "epic"
```

## Query Issues

```bash
# Open issues
gh issue list --state open

# By label
gh issue list --label "bug" --state open

# By assignee
gh issue list --assignee "@me"

# Search
gh issue list --search "auth timeout"

# View details
gh issue view 123
```

## Update Issues

```bash
# Add comment
gh issue comment 123 --body "Status update: PR #456 submitted"

# Add label
gh issue edit 123 --add-label "in-progress"

# Assign
gh issue edit 123 --add-assignee username

# Close
gh issue close 123 --reason completed
```

## Labels

Create labels that map to your workflow:

```bash
gh label create "epic" --color "3E4B9E" --description "Feature epic"
gh label create "task" --color "0E8A16" --description "Implementation task"
gh label create "bug" --color "D73A4A" --description "Something isn't working"
gh label create "high-priority" --color "B60205" --description "Needs attention soon"
gh label create "blocked" --color "FBCA04" --description "Waiting on dependency"
```

## Work Log (Audit Trail)

**Every meaningful action gets a comment on the issue.**

Comment when you:

| Event | Prefix |
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
# Example: developer starts work
gh issue comment 103 --body "🔧 **Started**: Implementing login endpoint using existing auth middleware."

# Example: developer finishes
gh issue comment 103 --body "$(cat <<'EOF'
✅ **Done**: Login endpoint implemented.

- Added `POST /api/auth/login` with JWT + rate limiting
- Tests: 4 added, all passing
- PR: #45
EOF
)"
```

## Details

See `references/templates.md` for issue templates and workflow patterns.
