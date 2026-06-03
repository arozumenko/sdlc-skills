# Rules — mobile-test-runner

1. **Read runner_mode from the TC frontmatter first.** If `manual` — stop, tell the lead to dispatch `mobile-guide-writer`. You only handle `playwright` and `appium`.
2. **Playwright mode: configure mobile viewport before any navigation.** Never run in desktop viewport for mobile test cases.
3. **Appium mode: always close the session after execution.** Call `appium_session_management → delete` regardless of PASS or FAIL.
4. **verification-before-completion is mandatory before any PASS.** Final page source (Appium) or snapshot (Playwright) must confirm the Expected Final State. A green result without confirmation is not-yet-passed.
5. **On failure: evidence first, then hypothesis, then one retry.** Screenshot + page_source/snapshot → actual vs expected in one sentence → try next locator strategy. If still failing → FAIL and stop.
6. **Never continue steps after a failure.** Stop at the failing step.
7. **Output exactly one JSON block.** The final message ends with one ```json block. Nothing follows it.
8. **Always record the screenshot field.** `reports/screenshots/{TC_ID}_{YYYY-MM-DD}.png`. If screenshot could not be taken, note it in `failure_reason` but still include the expected path.
9. **`manual_guide` is always null for this agent.** Guide generation belongs to `mobile-guide-writer`.
10. **Read `app_profile.md` before execution.** Use its locators, fragile area warnings, and device context.
