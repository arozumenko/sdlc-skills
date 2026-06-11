---
name: completing-a-task
description: Use after implementing a routed task, when working code needs to be committed, pushed, PR'd, commented on the issue, and handed to a reviewer. The canonical task-handoff protocol; runs standalone or as the final phase of implement-feature.
license: Apache-2.0
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
  version: "0.1.0"
---

# Task Completion Protocol

When you are assigned a task — via a host-native subagent call, a PM
message, a tracker ticket, or any routed work — **a task is only complete when
all five steps have happened, in order**. Writing the code is step 1, not
step 5. If you stop at step 1 and hand a diff back to your caller, you have
left the task unfinished.

---

## Platform & systems — translate before running

The commands below are written in **GitHub `gh` form as the reference**.
Read scout's discovery first and translate:

- **`.agents/workflow.md` § Git host** — your code host and its CLI: GitHub
  `gh`, GitLab `glab`, Bitbucket `bb`, Azure DevOps `az repos`, Gitea `tea`.
  "PR" below means PR or MR (your host's unit of change).
- **`.agents/profile.md` § Project systems** — where tickets live
  (github-issues / jira / gitlab-issues / azure-boards / linear). Step 4
  comments on the ticket *there*, which may differ from the code host.

The five steps are identical on every platform — only the commands change.
If scout hasn't recorded a host/tracker, ask before assuming GitHub.

---

## 1. Code verified locally

Tests pass, type/syntax checks clean, lint clean if configured, manual check
where applicable. If this step fails, the task is not done — fix it or report
the blocker.

Language-specific verification commands:

- **JS/TS**: `npx tsc --noEmit`, `npx eslint <path>`, `npm test` / `npx jest` / `npx vitest`
- **Python**: `python -m py_compile <file>`, `pytest -x -q`, `mypy` if configured
- **Go**: `go build ./...`, `go vet ./...`, `go test ./...`
- **Rust**: `cargo check`, `cargo clippy`, `cargo test`

"I wrote the code and it compiles" is not verification. Run the thing.

---

## 2. Committed on a feature branch

Never commit directly to `main` or `master`. Always branch first:

```bash
git checkout -b <type>/<short-description>
```

`git commit` with a message that explains *why*, not just *what*. Small, focused
commits are better than one giant blob.

---

## 3. Pushed and PR/MR opened

```bash
git push -u origin HEAD
```

Open the change with your host's CLI (GitHub `gh` reference shown; GitLab:
`glab mr create`, Azure: `az repos pr create` — see *Platform & systems*):

```bash
gh pr create --title "<type>: <description> (#<issue>)" --body "$(cat <<'EOF'
## Summary
- <what was built>
- <key decisions>

## Test Plan
- [x] Unit tests: N
- [x] Integration / E2E tests: N (if applicable)

Closes #<issue>
EOF
)"
```

Title prefixes follow conventional commits (`feat`, `fix`, `refactor`, `test`,
`docs`, `chore`). Link the ticket so it auto-closes on merge — `Closes #N`
on GitHub/GitLab, a work-item link on Azure (follow your host's convention
in `workflow.md`).

---

## 4. Ticket comment posted

Comment on the ticket in the project's tracker (GitHub `gh` reference shown;
GitLab `glab issue note`, Jira via `atlassian-content`, Azure Boards
`az boards work-item update --discussion`):

```bash
gh issue comment <N> --body "PR #<X> ready: <one-line summary of what shipped>"
```

This is the audit trail. Without it, the task has no paper trail and the PM
(or future you) has to reconstruct context.

---

## 5. Notified ready for review

Through whichever transport this project uses (see `.agents/team-comms.md`
if present):

Your final reply to your caller includes the PR number and the words
"ready for review." That is the notification. If the project uses a shared
routing doc, record the update there per `.agents/team-comms.md`.

---

## Blockers

If any step is genuinely blocked — can't push because of permissions, can't
create PR because the issue number is unknown, CI broke on an unrelated flake,
etc. — surface the blocker in your response. Don't silently skip the step.

Report format:

```
Blocker at step <N>: <what failed>
Tried: <what you attempted>
Needs: <what unblocks this — credentials, decision, review>
```

---

## The point

**"I wrote the code and it works" is not done.** "I wrote the code, tests
pass, the PR is open, the issue is commented, and the reviewer has been told"
is done. Five steps, in order, every time.
