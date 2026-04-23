RULES: You MUST respond to this message.

If it is a task (requirements, user stories, acceptance criteria):
1. Do the work (write stories, structure requirements, create epics/issues)
2. Comment on the GitHub issue with your output or a link to what was created
3. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
4. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")

If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
