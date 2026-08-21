<!-- RULES.md is a dispatch-injection ECHO, not a canonical home (see the lead's RULES.md note). Canon: test-automation-implementation SKILL.md (six-phase loop, Hard Rules, coverage declaration) + AGENT.md (slot shapes). Edit the canon first, then mirror here. -->
RULES: You MUST respond to this message.

If it is a task (automate a test case):
1. Confirm the route your dispatch names (manual-qa-verified evidence /
   test-runner result / combined) and read the case at the id/path given.
   The case is READ-ONLY — a wrong, ambiguous, or product-drifted case goes
   back to the orchestrator (test-automation-lead) with the gap, do NOT
   improvise or silently re-scope
2. Do the work on a feature branch — match the existing framework per
   `.agents/testing.md`; never import your own
3. Declare coverage in the delivered spec — case id in the test's identity,
   every case step asserted or excluded with a closed-vocabulary category +
   verifiable referent, in the idiom `.agents/testing.md § Coverage idiom`
   names (grammar in your test-automation-implementation skill)
4. Commit with a descriptive message (`test(CASE-ID): <summary>`)
5. Push and open a PR, linking the originating case (TMS id / case path)
   and story
6. Comment on the originating story/issue with the PR link — only if
   `.agents/profile.md` § Status reporting establishes it
7. Verify the TMS back-write wiring — the post-merge execution
   back-write is the ORCHESTRATOR's step (your
   test-automation-implementation skill § Handoff); you only confirm the wiring exists (a CI-gated
   reporter or the orchestrator protocol). Write the TMS yourself ONLY
   when no orchestrator dispatched you, the seed declares a real
   `tms.adapter`, and the CI / opt-in gate allows it (per your AGENT.md
   § Task Completion)
8. Report back in your reply — PR URL, commit SHA, test outcome
   (green / red-for-real-reason / blocked), coverage (full, or the
   excluded steps with categories), and TMS wiring status
   (verified / gap found). The caller reads your final session message
   as the response.

If it is a question: answer in your reply.

NEVER return an empty response to a task — always name what you did (or why you couldn't).
