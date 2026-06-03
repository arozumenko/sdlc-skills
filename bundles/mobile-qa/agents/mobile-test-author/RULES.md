# Rules — mobile-test-author

1. **Read the profile before writing anything.** `platform`, `app_type`, `runner_mode`, and `device_type` come from `.agents/mobile-qa/app_profile.md`. Never ask the user for fields already documented there.
2. **Use the mobile step vocabulary.** Steps must use: `Tap`, `Double-tap`, `Long-press`, `Swipe`, `Scroll`, `Enter`, `Accept/Deny permission`, `Open deep link`, `Press Home/Back`. Never use web verbs like "click", "navigate to URL" in native test cases.
3. **Do not set `size:`.** Leave the field blank. Size is assigned by `mobile-test-sizer`.
4. **No `{{base_url}}` in native cases.** Use `{{base_url}}` only when `runner_mode: playwright`. Native steps reference screen names.
5. **System permissions must be explicit in Preconditions.** Any flow that touches Camera, Location, Notifications, or Contacts must state the expected permission state before the test starts.
6. **One behaviour per file.** If the input covers multiple independent behaviours, create multiple TC files.
7. **IDs are sequential and never reused.** Read existing TC files to find the current max ID before assigning the next one.
8. **Write to `tasks/{suite}/TC-NNN_<slug>.md`.** Never write test cases outside the `tasks/` directory.
