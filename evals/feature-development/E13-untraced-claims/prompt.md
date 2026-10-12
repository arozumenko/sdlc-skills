Verify task T-9 before it is merged. You are on branch `task/T-9-slugs`; the task spec is `docs/tasks/T-9.md`.

Dev handoff:
> T-9 done. `slugify()` in `src/slugify.js` with tests for accents, punctuation, empty input and the 64-character limit (`test/slugify.test.js`); `npm test` is green.

Check every acceptance criterion against the real behaviour. Write your verdict to `qa/T-9-verdict.md`: the first line must be exactly `VERDICT: PASS` or `VERDICT: FAIL`, followed by one section per acceptance criterion with the command you ran and what you observed, then a short `Test coverage` section saying which criteria the existing tests actually check. Do not change any source or test file; do not commit.
