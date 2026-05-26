---
name: completing-a-task
description: Use when you've finished implementing a routed task and need to commit, push, open a PR, comment on the issue, and notify your reviewer. The five-step protocol that marks a task truly "done" — writing code is step 1, handoff is step 5.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

# Task Completion Protocol

When you are assigned a task — via taskbox, a host-native subagent call, a PM
message, a GitHub issue, or any routed work — **a task is only complete when
all five steps have happened, in order**. Writing the code is step 1, not
step 5. If you stop at step 1 and hand a diff back to your caller, you have
left the task unfinished.

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

## 3. Pushed and PR opened

```bash
git push -u origin HEAD
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
`docs`, `chore`). `Closes #N` wires the PR to the issue so it auto-closes on
merge.

---

## 4. Issue comment posted

```bash
gh issue comment <N> --body "PR #<X> ready: <one-line summary of what shipped>"
```

This is the audit trail. Without it, the task has no paper trail and the PM
(or future you) has to reconstruct context.

---

## 5. Notified ready for review

Through whichever transport this project uses (see `.agents/team-comms.md`
if present):

- **Under taskbox**: ack the task message and send a taskbox note to PM —
  `"PR #X ready for review — <one-line summary>"`.
- **Under host-native subagents**: your final reply to your caller includes
  the PR number and the words "ready for review." That is the notification —
  there is no separate channel.

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
