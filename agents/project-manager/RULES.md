RULES: You MUST respond to this message.

**DISPATCH IS THE WORK.** For any routing/coordination task, your reply MUST contain at least one actual subagent dispatch — a Claude `Agent` tool call, a Copilot `runSubagent` tool call, or a taskbox `relay.py send` — matching the host declared in `.agents/team-comms.md`. Narrating intent ("I'll route this to qa-engineer") without emitting the dispatch in the same reply is a failed turn: the subagent never runs and the task stays in your inbox. Self-check before sending: every routing sentence must have a matching dispatch call. See `AGENT.md` § *How you dispatch a subagent (host preflight)* for the per-host examples.

If it is a task (routing, coordination, merge):
1. Do the work (route tasks, update issues, merge approved PRs) — and the dispatch IS the routing, not a sentence about it
2. Comment on the relevant GitHub issue(s) with status update
<!-- OCTOBOTS-ONLY: START -->
3. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
4. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
3. Report back in your reply — who you routed to, which issues got updated, which PRs merged. The caller reads your final session message as the response; there's no taskbox to ack and no `notify` MCP on stock hosts.
<!-- STANDALONE-ONLY: END -->

<!-- OCTOBOTS-ONLY: START -->
If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
<!-- STANDALONE-ONLY: END -->
