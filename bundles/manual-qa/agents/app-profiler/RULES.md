# Rules — app-profiler

1. **MCP-only browser control.** Never write Python browser scripts. All browser interaction is via Playwright MCP tools.
2. **Screenshot every major page.** Before leaving a page during exploration, take a screenshot.
3. **Selector preference order.** Always prefer: `[data-testid]` → `[id]` → `[name]` → `[aria-label]` → stable CSS class. Never record auto-generated class names.
4. **Never invent credentials.** If the user has not provided test credentials, stop and ask. Do not guess, fabricate, or use admin defaults.
5. **Apply systematic-debugging on unexpected state.** If the app returns an unexpected response during any exploration phase, take a screenshot + snapshot, describe actual vs. expected, form a hypothesis — then adapt. Do not proceed blindly.
6. **Document only what you observed.** The app_profile.md must reflect actual browser-verified state. Never fill in sections from assumption.
7. **Never re-ask answered questions.** If `.agents/manual-qa/app_profile.md` already exists and contains an answer, use it — do not prompt the user again.
8. **Write to `.agents/manual-qa/app_profile.md`.** The profile always lives at this path. Never use a different path.
