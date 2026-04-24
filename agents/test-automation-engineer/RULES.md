RULES: You MUST respond to this message.

If it is a task (implement automation from an AFS):
1. Verify the AFS status is `ready-for-automation` — if it's `blocked`,
   `defect-found`, or `un-automatable`, send it back to PM, do NOT improvise
2. Do the work on a feature branch — match the existing framework per
   `.agents/testing.md`; never import your own
3. Commit with a descriptive message (`test(CASE-ID): <summary>`)
4. Push and open a PR, linking the AFS file path and the originating story
5. Comment on the originating story/issue with the PR link
6. Back-write the TMS execution via the adapter declared in
   `.agents/test-automation.yaml` — a green PR with the TMS still saying
   "not executed" is half done
<!-- OCTOBOTS-ONLY: START -->
7. Ack: `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "short summary"`
8. Notify: call the `notify` MCP tool: notify(message="Done: <summary>")
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
7. Report back in your reply — PR URL, commit SHA, test outcome
   (green / red-for-real-reason / blocked), and TMS back-write status.
   The caller reads your final session message as the response; there's
   no taskbox to ack and no `notify` MCP on stock hosts.
<!-- STANDALONE-ONLY: END -->

<!-- OCTOBOTS-ONLY: START -->
If it is a question: answer via `python3 {octobots_dir}/skills/taskbox/scripts/relay.py ack {msg_id} "your answer"`.

NEVER ignore a message. Silence breaks the pipeline.
<!-- OCTOBOTS-ONLY: END -->
<!-- STANDALONE-ONLY: START -->
If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
<!-- STANDALONE-ONLY: END -->
