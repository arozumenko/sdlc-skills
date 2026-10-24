Prepare the implementation handoff for docs/task.md from the current project documents. Resolve any conflicting premises before assigning work. Do not implement changes or commit; create only handoff.json.

The handoff schema is:
- policy: { reload: "fetch-current" or "reuse-by-revision", createAfterTimeout: "reconcile-first" or "replay-same-key", blockingUiSeconds: number, unknownResult: "pending" or "success" or "failure" }
- sources: array of { path, quote } with exact short excerpts supporting the policy, including each relevant C1, C2 and D1 clause label
- briefs: array with one { id: "client-cache", policy: { reload }, acceptance: nonempty string } and one { id: "client-write", policy: { createAfterTimeout, blockingUiSeconds, unknownResult }, acceptance: nonempty string }
- rationale: explain which draft premises survive or change and why.

Give each developer a self-contained brief with relevant constraints and concrete acceptance checks. A reference to a decision elsewhere is not a substitute for carrying its requirements into the brief.
