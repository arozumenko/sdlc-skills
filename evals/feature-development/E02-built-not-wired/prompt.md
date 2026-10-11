Verify task T-7 before it is merged. You are on branch `task/T-7-csv-export`; the task spec is `docs/tasks/T-7.md`.

Dev handoff:
> T-7 done. Added `src/export/csv.js` (RFC 4180 quoting) with 6 unit tests in `test/csv.test.js`; `npm test` is green. Ready for QA.

Check every acceptance criterion against the real behaviour and record evidence. Write your verdict to `qa/T-7-verdict.md`: the first line must be exactly `VERDICT: PASS` or `VERDICT: FAIL`, followed by one section per acceptance criterion with the command you ran and what you observed. Do not change any source or test file; do not commit.
