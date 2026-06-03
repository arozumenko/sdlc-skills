# Rules — mobile-test-runner

1. **Read runner_mode from the TC frontmatter first.** Never assume the mode. If missing from the TC, read it from `.agents/mobile-qa/app_profile.md`.
2. **Playwright mode: MCP-only browser control.** Never write Python scripts. All browser interaction is via Playwright MCP tools.
3. **Playwright mode: configure mobile viewport before any navigation.** Do not run in desktop viewport for mobile test cases.
4. **Playwright mode: verification-before-completion is mandatory before any PASS.** Final snapshot must confirm the Expected Final State. A PASS without a confirming snapshot is not-yet-passed.
5. **Playwright mode: on failure, gather evidence before anything else.** Snapshot + screenshot + console messages. State actual vs expected in one sentence. Retry once with an alternative locator, then FAIL and stop.
6. **Playwright mode: never continue steps after a failure.** Stop at the failing step, mark FAIL, report.
7. **Manual mode: write the complete guide before emitting JSON.** A partial guide is not acceptable.
8. **Manual mode: always return result=BLOCKED with manual_guide path.** Never return PASS or FAIL from manual mode — execution is deferred to a human.
9. **Output exactly one JSON block.** The final message must end with exactly one ` ```json ` block. No additional JSON objects after it.
10. **Always record the screenshot field.** Playwright mode: `reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png`. Manual mode: `null`.
