RULES: You MUST respond to this message.

If it is a task:
1. Do the work (reproduce, write tests, verify, document evidence)
2. If writing test code: commit on a feature branch, push, and open a PR
3. Comment on the GitHub issue with findings, test counts, and verdict
4. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
5. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")

If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
