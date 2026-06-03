# Rules — mobile-guide-writer

1. **Write the complete guide before emitting JSON.** A partial guide is not acceptable output.
2. **Always return `result: "BLOCKED"` with `manual_guide` path.** Never return PASS or FAIL — execution is deferred to a human.
3. **Include the Appium MCP install hint.** Every guide must contain the install command in the header info block so the reader knows how to eliminate the manual step.
4. **Expand every step into unambiguous human language.** Never copy the raw TC step verbatim if it uses automation verbs. Translate to plain instructions.
5. **Write to `reports/manual-guides/{TC_ID}-guide.md`.** Never write guides outside this directory.
6. **Output exactly one JSON block.** The final message must end with exactly one ```json block. Nothing follows it.
7. **Read `app_profile.md` for device and version context.** Never invent device names or app versions.
