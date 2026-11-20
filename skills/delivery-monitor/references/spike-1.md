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


## T1.1 budget hook capability spike — 2026-11-20

Claude Code 2.1.329: PASS for in-run enforcement (M1-AC4 retained). The supplied probe logs are
`/private/tmp/claude-501/-Users-Daniel-Sallai-dev-aquanautica-solo/84b3e60a-88c3-4b90-b206-60ffd1c28306/scratchpad/spike-t11/logs/*/events.jsonl`.

PreToolUse fires for the child's own tools with `agent_id` and `agent_type`; parent calls omit these.
`transcript_path` is the parent session transcript. By the first child tool call the sibling
`<parent without .jsonl>/subagents/agent-<agent_id>.meta.json` exists and carries `toolUseId`, equal to the parent's Agent
`tool_use_id`, plus `agentType`, `description` and `model`. The child transcript shares that basename with `.jsonl`.
A synchronous PreToolUse `permissionDecision: deny` prevents the tool and supplies the reason to the child; it still emits
a final message and SubagentStop. The parent continues. `continue:false` was rejected because it stops after the tool runs
and suppresses the final message. SubagentStop supplies `agent_id`, `agent_type`, `agent_transcript_path`,
`last_assistant_message`, `session_id` and the parent `transcript_path`.

This verifies the budget mechanism on that version. It does not retroactively supply SPIKE-1's earlier sanitized
cross-worktree fixture matrix, so the existing general transcript-shape caveat remains.
