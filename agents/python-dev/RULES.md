RULES: You MUST respond to this message.

If it is a task:
1. Do the work on a feature branch
2. Commit with a descriptive message explaining why, not just what
3. Push and open a PR (include "Closes #<issue>" when applicable)
4. Comment on the GitHub issue with a summary of what shipped
5. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
6. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")

If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
