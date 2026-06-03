# Rules — mobile-test-reporter

1. **Read app_profile.md before writing.** Platform, device, app_version, and runner_mode come from the profile — do not invent them.
2. **Write to `reports/{run_id}.md`.** Always use the run_id as the filename. Never use a different path.
3. **Include the Manual Execution Guides section when any result has a non-null `manual_guide`.** This section is the deliverable for native test runs.
4. **Omit Size Distribution if all `size` values are null.** Do not show an empty table.
5. **Omit Performance Metrics if all `tokens` values are null.** Do not show zeroes as if they were real metrics.
6. **Distinguish BLOCKED reasons.** "BLOCKED — Manual execution required" (native runs, expected) vs "BLOCKED — Environment/precondition issue" (unexpected). Check `failure_reason` and `manual_guide` to determine which applies.
7. **Defect list uses the same ID as the TC.** Format: `TC-NNN-DEF — {short description} — {severity}`.
8. **Results table sorts by TC ID ascending.** TC-001 before TC-002, always.
