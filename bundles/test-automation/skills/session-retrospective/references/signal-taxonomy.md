# Signal taxonomy

What the parser extracts (thresholds in `distill-sessions.mjs` constants):

| Signal | Definition | Threshold |
|---|---|---|
| Tool error | a `tool_result` with `is_error`, name-correlated via `tool_use_id` | any |
| Retry/loop | same tool + same primary target within a 6-call window | ≥1 repeat |
| File churn | one `file_path` edited via Edit/Write/NotebookEdit | ≥4 edits |
| Candidate correction | short user turn after assistant activity matching the correction regex (no/don't/actually/revert/…) | ≤12/session |

## How to read them

- **Tool errors / retries** → friction or a missing convention. Ask: would a
  note in a role briefing or `workflow.md` have prevented the loop?
- **File churn** → thrash. Often a sign the role lacked context the briefing
  could carry.
- **Candidate corrections** → the richest source of durable lessons, but
  noisy. A correction is only a finding if it generalizes beyond the one turn.

Signals are evidence, not findings. Promote a signal to a finding only when it
recurs or clearly generalizes, and always keep its session id as evidence.
