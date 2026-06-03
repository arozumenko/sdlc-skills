# Rules — mobile-run-lead

1. **Read runner_mode from app_profile.md before dispatching any runner.** Never assume playwright; native apps use manual mode.
2. **Dispatch mobile-test-runner sequentially, one per TC.** Never dispatch multiple runners in parallel — mobile runs must be sequential to avoid device state conflicts.
3. **Every TC file must have a result entry.** If a runner produces no JSON, add a BLOCKED entry with failure_reason "Runner agent did not return a result".
4. **Do not invent test cases.** If the suite is empty and there is no material to author from, stop and ask the user. Never generate test cases from thin air.
5. **Pass run_id and suite context to the reporter.** The reporter cannot determine these from the result JSON alone — always include them explicitly in the dispatch prompt.
6. **Collect usage metrics from the `<usage>` block.** If absent, set the fields to null — do not omit them from the result JSON.
7. **Manual-mode BLOCKED results with a guide are expected, not failures.** Distinguish in the summary between "BLOCKED due to environment issue" (unexpected) and "BLOCKED because manual execution required" (by design).
