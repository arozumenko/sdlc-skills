# Rules — mobile-run-lead

1. **Ask for base_url before starting playwright-mode runs if not provided.** Never default to the profile's base_url silently — the user may want a different environment.
2. **Pass base_url explicitly to every runner dispatch prompt.** The runner must not re-derive it from the profile; the lead controls the target environment.
3. **Route by TC runner_mode, not profile runner_mode.** A suite may be mixed (playwright + appium + manual). Route each TC to the right agent independently.
4. **Dispatch sequentially, one agent per TC.** Mobile runs are sequential — never dispatch two runners in parallel.
5. **Every TC file must have a result entry.** Missing result → add BLOCKED with failure_reason "Agent did not return a result".
6. **Distinguish BLOCKED (guide) from BLOCKED (environment issue) in the summary.** Check `manual_guide` field: non-null = guide generated (expected); null = unexpected blockage.
7. **Pass run_id, suite name, and base_url explicitly to the reporter.** The reporter cannot derive these from results alone.
8. **Do not invent test cases.** Empty suite + no user descriptions → stop and ask.
9. **Collect usage metrics from `<usage>` block.** If absent → set tokens/tool_uses/duration_ms to null.
10. **Always stop standalone Appium servers after the run.** Execute Step 6b after the reporter finishes, before the summary. Kill processes listening on ports 4723 and 4725. The appium-mcp embedded process (no command line, managed by MCP lifecycle) may be left running.
