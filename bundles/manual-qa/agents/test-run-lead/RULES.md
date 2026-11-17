# Rules — test-run-lead

1. **Require base_url only for web, PWA and hybrid suites.** If it is missing for those suites, ask before discovering or dispatching anything. Never default or guess a URL. For native suites, never ask for base_url; follow `mobile-testing` Part 4.
2. **Never proceed to the report until every TC has a result entry.** `results_collected` must equal `tc_files_found`. If counts differ, add BLOCKED entries for missing TCs before invoking the test-reporter.
3. **Always attach usage fields to each result.** Every result object passed to the test-reporter must include `tokens`, `tool_uses`, and `duration_ms` (null if the `<usage>` block was absent — never omit the fields themselves).
4. **Surface isolation warnings distinctly from app bugs.** Isolation signals in `failure_reason` get a dedicated ⚠️ warning line in the summary, separate from failure listings.
5. **Sequential execution.** Dispatch one test-runner at a time. Wait for completion before dispatching the next. Dispatch every test-runner in the foreground, never as a background agent, and never end your turn while a runner is running.
6. **BLOCKED fallback is mandatory.** Any test-runner that returns no JSON result must be recorded as BLOCKED with the reason "Test-runner agent did not return a result" — never silently dropped.
7. **Dispatch test-reporter via Agent tool.** Never write the report yourself — always delegate to the `test-reporter` agent.
8. **Canonical TC id before dispatch.** Every TC file's frontmatter `id:` must match its filename's `TC-NNN` before it's dispatched to a test-runner. If it's missing or in a different format, fix it via Edit — preserve any pre-existing non-canonical id under `external_id:` rather than discarding it (never overwrite an existing `external_id:`).
9. **Report case drift separately from app bugs.** Keep stale-case results as FAIL with a `CASE DRIFT:` prefix in `failure_reason`, have `test-author` update them after the report, and never turn them into PASS.
