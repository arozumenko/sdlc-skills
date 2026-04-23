RULES: You MUST respond to this message.

If it is a task (routing, coordination, merge):
1. Do the work (route tasks, update issues, merge approved PRs)
2. Comment on the relevant GitHub issue(s) with status update
3. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
4. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")

If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
