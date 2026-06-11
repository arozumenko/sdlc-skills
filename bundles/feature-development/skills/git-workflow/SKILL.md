---
name: git-workflow
description: Use when the user asks to "commit", "create PR", "branch", "merge", "rebase", "cherry-pick", "tag", or otherwise manage git history. Guides disciplined git operations — branching, commits, PRs, and recovery.
license: Apache-2.0
compatibility: Requires git CLI; gh/glab/az/bb/tea for your host's PR/MR operations
allowed-tools: Bash(git:*) Bash(gh:*)
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Git Workflow

Disciplined git operations for professional codebases.

## Platform & systems

Commands below use **GitHub `gh`** as the reference. Translate to your code host
per `.agents/workflow.md` § Git host — GitLab `glab`, Bitbucket `bb`, Azure
DevOps `az repos`, Gitea `tea`. "PR" means PR or MR. If scout hasn't recorded a
host, ask before assuming GitHub.

## Before Any Git Operation

```bash
git --no-pager status
git --no-pager log --oneline -5
git --no-pager diff --stat
```

Always know the current state before changing it.

## Branching

```bash
# Feature branch from main
git checkout main && git pull && git checkout -b feat/short-description

# Bug fix
git checkout main && git pull && git checkout -b fix/issue-description
```

Branch naming: `feat/`, `fix/`, `chore/`, `docs/` prefixes. Lowercase, hyphens, concise.

## Commits

**Never commit unless the user explicitly asks.** When they do:

1. Stage specific files (not `git add -A` — avoid secrets and binaries)
2. Write a message that explains *why*, not *what*
3. Keep commits focused — one concern per commit

```bash
git add src/auth.py src/middleware.py
git commit -m "$(cat <<'EOF'
Fix session expiry not respecting timezone offset

The previous check used naive datetime comparison which failed
for users in negative UTC offsets.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## Pull Requests

When asked to create a PR:

1. Check all commits since divergence: `git --no-pager log main..HEAD --oneline`
2. Review full diff: `git --no-pager diff main...HEAD`
3. Push with tracking: `git push -u origin HEAD`
4. Create with structured body:

```bash
gh pr create --title "Short title under 70 chars" --body "$(cat <<'EOF'
## Summary
- What changed and why (2-3 bullets)

## Test plan
- [ ] How to verify this works

Generated with Claude Code
EOF
)"
```

## Dangerous Operations

**Always confirm with the user before:**
- `git push --force` (any variant)
- `git reset --hard`
- `git branch -D`
- `git rebase` on shared branches
- `git checkout .` or `git restore .` (discards work)

**Never:**
- Skip hooks (`--no-verify`)
- Force push to main/master
- Amend published commits
- Use interactive flags (`-i`) — not supported in non-interactive shells

## Recovery

See `references/recovery.md` for common recovery scenarios.
