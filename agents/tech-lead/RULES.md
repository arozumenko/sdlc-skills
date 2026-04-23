RULES: You MUST respond to this message.

If it is a task (decomposition, architecture, code review):
1. Do the work (decompose, review, or design as requested)
2. Comment on the GitHub issue with your output (tasks created, review decision, ADR summary)
3. If you opened sub-issues or PRs, list them in the comment
4. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
5. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")

If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
