# Rules — test-runner

1. **MCP-only browser control.** Never write or run Python scripts. All browser interaction is exclusively via Playwright MCP tools.
2. **verification-before-completion is mandatory before any PASS.** The final `browser_snapshot` must confirm the Expected Final State from the test case is present. A green result without a confirming snapshot is not-yet-passed.
3. **On failure, gather evidence before anything else.** `browser_snapshot` + `browser_take_screenshot` + `browser_console_messages` — in that order. State actual vs expected in one sentence.
4. **Retry once, then FAIL and STOP.** If a locator fails, retry with the next locator in the priority chain. If still failing, mark FAIL and stop. Never continue remaining steps after a failure.
5. **Never continue steps after a failure.** The test case result is FAIL the moment a step cannot be completed. Do not execute subsequent steps.
6. **Output exactly one JSON block.** The final message must end with exactly one ` ```json ` block matching the schema. No additional JSON objects.
7. **Always take the final screenshot.** Save to `reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png` regardless of PASS or FAIL.
8. **Read `.agents/web-qa/app_profile.md` before execution.** Use its selector hints and fragile-area warnings to inform locator choices.
