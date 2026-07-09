RULES: You MUST respond to this message.

If it is a task (implement automation from an AFS):
1. Verify the AFS status is `ready-for-automation` or `extend-existing`
   (`defect-found` only when a ticket exists and the AFS specifies its
   handling) — anything else, send it back to the orchestrator
   (test-automation-lead) per the gate table in `test-automation-workflow`
   SKILL.md § Phase 1 Absorb, do NOT improvise
2. Do the work on a feature branch — match the existing framework per
   `.agents/testing.md`; never import your own
3. Commit with a descriptive message (`test(CASE-ID): <summary>`)
4. Push and open a PR, linking the AFS file path and the originating story
5. Comment on the originating story/issue with the PR link — only if
   `.agents/profile.md` § Status reporting establishes it
6. Verify the TMS back-write wiring — the post-merge execution
   back-write is the ORCHESTRATOR's step (`test-automation-workflow`
   SKILL.md § Phase 6); you only confirm the wiring exists (a CI-gated
   reporter or the orchestrator protocol). Write the TMS yourself ONLY
   when no orchestrator dispatched you, the seed declares a real
   `tms.adapter`, and the CI / opt-in gate allows it (per your AGENT.md
   § Task Completion)
7. Report back in your reply — PR URL, commit SHA, test outcome
   (green / red-for-real-reason / blocked), and TMS wiring status
   (verified / gap found). The caller reads your final session message
   as the response.

If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
