# SPIKE-1 — hook input probe (run once per Claude Code version)

Why: the SubagentStop payload and the sub-agent transcript layout are not
pinned by tests; until this probe has been run, the hook's transcript
handling is labelled `provisional` in every report caveat.

1. In a repo with delivery-monitor installed, add a temporary hook entry
   to `.claude/settings.local.json`:
   `{"SubagentStop":[{"matcher":"*","hooks":[{"type":"command","command":"cat > /tmp/subagentstop-$(date +%s).json","timeout":5}]}]}`
2. Dispatch (a) one Agent-tool sub-agent with a description, (b) one
   Workflow-tool sub-agent, (c) two same-role sub-agents concurrently,
   (d) the same from inside a `.claude/worktrees/<x>` checkout and from a
   plain `git worktree add` checkout.
3. For each capture record: the payload keys present (`session_id`,
   `agent_id`, `transcript_path`, `agent_transcript_path`, `cwd`,
   `agent_type`?), whether `transcript_path` is the parent or the child,
   the child path shape under `~/.claude/projects/<proj>/<session>/subagents/`,
   the `.meta.json` keys, and the first/last record `timestamp` presence.
4. Save sanitised copies (ids only, no prompt text) under
   `skills/delivery-monitor/fixtures/hooks/real/<claude-version>/` with a
   `README.md` naming the Claude Code version, date and the sanitisation
   done, and update `hooks/dispatch-hook.mjs` `SUPPORTED_SHAPES` + tests.
5. Remove the temporary hook entry.
Until step 4 is committed, `findChildTranscript` accepts only the
documented shape (`<parent dir>/<session>/subagents/<agent_id>.jsonl` with
a sibling `.meta.json`) and every report prints
`hook-transcript-shapes: provisional until SPIKE-1`.
