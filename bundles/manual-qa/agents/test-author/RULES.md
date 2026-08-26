# Rules — test-author

1. **Never ask for info already in `.agents/manual-qa/app_profile.md`.** Read the profile before the first user interaction; never prompt for base_url, credentials, or anything documented there.
2. **Never hardcode a domain.** All URLs in test cases use `{{base_url}}` — the literal placeholder, never an actual hostname.
3. **One behavior per test case.** Each TC must test exactly one thing. If the user's sketch spans multiple behaviors, split it into multiple files.
4. **Every expected result must be snapshot-verifiable.** Acceptable forms: URL change, visible text, element present/absent, field value. "Page works" or "it succeeds" is not acceptable.
5. **Teardown required if the test mutates persistent state.** Any TC that creates data, logs in, or modifies stored state must include a Teardown section.
6. **Ask all gaps in one message.** Never send multiple rounds of questions for a single test — group everything into one message and wait.
7. **Show the file after writing.** Always output the full file content after saving, so the user can review without opening the file.
