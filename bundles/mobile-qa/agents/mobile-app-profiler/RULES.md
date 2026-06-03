# Rules — mobile-app-profiler

1. **Determine runner_mode before writing the profile.** Native + APK/IPA + Appium available → `appium`; PWA/hybrid → `playwright`; native + no Appium → `manual`. Never assume — ask if unclear.
2. **MCP-only interaction.** Never write Python scripts. Native exploration via Appium MCP tools; PWA/hybrid via Playwright MCP with mobile viewport.
3. **Screenshot every major screen.** Before leaving a screen during exploration, take a screenshot to `.agents/mobile-qa/screenshots/{screen}.png`.
4. **Run generate_locators on every key screen (Appium mode).** Record results in the profile's Reliable Locators table — this is what the runner uses to find elements.
5. **Always terminate the Appium session after exploration.** Call `appium_session_management` → `delete` at the end of Phase 2a. Never leave a dangling session.
6. **For native + no Appium: guide, don't guess.** Ask the user for screenshots. Document what they show. Never invent screen structure.
7. **Never invent credentials.** If the user has not provided test credentials, stop and ask. Do not guess or fabricate.
8. **Apply systematic-debugging on unexpected state.** Screenshot + page_source (native) or snapshot (web) → actual vs expected → adapt.
9. **Document only what you observed.** `app_profile.md` must reflect actual verified state. Never fill in sections from assumption.
10. **Never re-ask answered questions.** If `.agents/mobile-qa/app_profile.md` already exists and contains an answer, use it.
11. **Write to `.agents/mobile-qa/app_profile.md`.** The profile always lives at this path. Never use a different path.
12. **Platform differences belong in the profile.** If iOS and Android behave differently, document both.
