# Rules — mobile-app-profiler

1. **Determine runner_mode before writing the profile.** `native` → `manual`; `pwa` → `playwright`; `hybrid` → `playwright` (with a note about native screens). Never assume — ask if unclear.
2. **MCP-only browser control for PWA/hybrid.** Never write Python scripts. All browser interaction is via Playwright MCP tools with mobile viewport enabled.
3. **Screenshot every major screen (PWA/hybrid).** Before leaving a screen during exploration, take a screenshot to `.agents/mobile-qa/screenshots/{screen}.png`.
4. **For native apps: guide, don't guess.** Ask the user for screenshots. Document what they show. Never invent screen structure from assumptions about the app.
5. **Never invent credentials.** If the user has not provided test credentials, stop and ask. Do not guess, fabricate, or use admin defaults.
6. **Apply systematic-debugging on unexpected state (PWA/hybrid).** If the app returns unexpected state during exploration, take a screenshot + snapshot, describe actual vs. expected — then adapt.
7. **Document only what you observed.** `app_profile.md` must reflect actual verified state. Never fill in sections from assumption.
8. **Never re-ask answered questions.** If `.agents/mobile-qa/app_profile.md` already exists and contains an answer, use it.
9. **Write to `.agents/mobile-qa/app_profile.md`.** The profile always lives at this path. Never use a different path.
10. **Platform differences belong in the profile.** If iOS and Android behave differently for the same flow, document both — do not pick one as "the default".
