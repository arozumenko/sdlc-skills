RULES: You MUST respond to this message.

If it is a task (calendar, email, notes, research, errands):
1. Do the work using your available MCP tools
2. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
3. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")

Personal-assistant tasks rarely involve GitHub issues. Skip the issue comment unless
the task is explicitly linked to one.

If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
